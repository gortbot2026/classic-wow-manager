#!/usr/bin/env node

/**
 * One-time Migration Script: wcl_event_pages.events → Cloudflare R2
 *
 * Reads rows where events IS NOT NULL AND r2_key IS NULL,
 * uploads the events JSON blob to R2, then updates the row with
 * r2_key + event_count and NULLs out the events column.
 *
 * Resumable: re-running is safe — only processes unmigrated rows.
 * Batched: processes BATCH_SIZE rows per transaction to stay within memory limits.
 *
 * Usage:
 *   DATABASE_URL=<url> R2_ENDPOINT=<endpoint> R2_ACCESS_KEY_ID=<id> \
 *   R2_SECRET_ACCESS_KEY=<secret> R2_BUCKET=<bucket> node scripts/migrate-events-to-r2.cjs
 *
 * Optional env:
 *   BATCH_SIZE — rows per batch (default 50)
 *   DRY_RUN=true — log what would happen without uploading or updating
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10);
const DRY_RUN = process.env.DRY_RUN === 'true';

// --- Validate environment ---
const required = ['DATABASE_URL', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

/**
 * Generates the R2 key for a given event page.
 * @param {string} reportCode
 * @param {number|string} startTime
 * @param {number|string} endTime
 * @returns {string}
 */
function r2Key(reportCode, startTime, endTime) {
  return `wcl-events/${reportCode}/${startTime}_${endTime}.json`;
}

async function migrate() {
  console.log(`=== WCL Event Pages → R2 Migration ===`);
  console.log(`Batch size: ${BATCH_SIZE} | Dry run: ${DRY_RUN} | Bucket: ${process.env.R2_BUCKET}`);
  console.log();

  // Ensure columns exist
  const setupClient = await pool.connect();
  try {
    await setupClient.query('ALTER TABLE wcl_event_pages ADD COLUMN IF NOT EXISTS r2_key TEXT;');
    await setupClient.query('ALTER TABLE wcl_event_pages ADD COLUMN IF NOT EXISTS event_count INTEGER;');
    await setupClient.query('CREATE INDEX IF NOT EXISTS idx_wcl_event_pages_r2_key ON wcl_event_pages(r2_key);');
    console.log('Schema ready.');
  } finally {
    setupClient.release();
  }

  let totalRows = 0;
  let totalBytes = 0;
  let totalFailed = 0;
  let batchNum = 0;

  // Get total remaining count
  const countResult = await pool.query(
    'SELECT COUNT(*) AS cnt FROM wcl_event_pages WHERE r2_key IS NULL AND events IS NOT NULL'
  );
  const remaining = parseInt(countResult.rows[0].cnt, 10);
  console.log(`Rows to migrate: ${remaining}`);
  console.log();

  while (true) {
    batchNum++;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Select a batch of unmigrated rows, locking them to allow concurrent reads
      const batch = await client.query(`
        SELECT id, report_code, start_time, end_time, events
        FROM wcl_event_pages
        WHERE r2_key IS NULL AND events IS NOT NULL
        ORDER BY id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `, [BATCH_SIZE]);

      if (batch.rows.length === 0) {
        await client.query('ROLLBACK');
        break;
      }

      let batchBytes = 0;
      let batchFailed = 0;

      for (const row of batch.rows) {
        const key = r2Key(row.report_code, row.start_time, row.end_time);
        const eventsArr = Array.isArray(row.events) ? row.events : [];
        const body = JSON.stringify(eventsArr);
        const byteLen = Buffer.byteLength(body, 'utf-8');

        if (DRY_RUN) {
          console.log(`  [DRY] id=${row.id} key=${key} events=${eventsArr.length} bytes=${byteLen}`);
          totalRows++;
          batchBytes += byteLen;
          continue;
        }

        try {
          await r2.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: key,
            ContentType: 'application/json',
            Body: body
          }));

          await client.query(
            'UPDATE wcl_event_pages SET r2_key = $1, event_count = $2, events = NULL WHERE id = $3',
            [key, eventsArr.length, row.id]
          );

          totalRows++;
          batchBytes += byteLen;
        } catch (err) {
          console.error(`  FAILED id=${row.id} key=${key}: ${err.message}`);
          batchFailed++;
          totalFailed++;
          // Continue with next row — allow manual retry later
        }
      }

      await client.query('COMMIT');
      totalBytes += batchBytes;

      const pct = remaining > 0 ? Math.round((totalRows / remaining) * 100) : 100;
      console.log(
        `Batch ${batchNum}: ${batch.rows.length} rows | ` +
        `${(batchBytes / 1024 / 1024).toFixed(2)} MB uploaded | ` +
        `${batchFailed} failed | ` +
        `Progress: ${totalRows}/${remaining} (${pct}%)`
      );
    } catch (err) {
      console.error(`Batch ${batchNum} TRANSACTION ERROR: ${err.message}`);
      try { await client.query('ROLLBACK'); } catch (_) {}
    } finally {
      client.release();
    }
  }

  console.log();
  console.log(`=== Migration Complete ===`);
  console.log(`Total rows migrated: ${totalRows}`);
  console.log(`Total bytes uploaded: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total failures: ${totalFailed}`);

  await pool.end();
}

migrate().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
