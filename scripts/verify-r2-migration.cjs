#!/usr/bin/env node

/**
 * Verification Script: Spot-check R2 migration of wcl_event_pages
 *
 * Picks random migrated rows, confirms:
 * 1. R2 object exists at the expected key
 * 2. R2 object is valid JSON and is an array
 * 3. Array length matches the stored event_count
 *
 * Also reports overall migration progress stats.
 *
 * Usage:
 *   DATABASE_URL=<url> R2_ENDPOINT=<endpoint> R2_ACCESS_KEY_ID=<id> \
 *   R2_SECRET_ACCESS_KEY=<secret> R2_BUCKET=<bucket> node scripts/verify-r2-migration.cjs
 *
 * Optional env:
 *   SAMPLE_SIZE — number of rows to spot-check (default 20)
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');

const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '20', 10);

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

async function verify() {
  console.log('=== R2 Migration Verification ===');
  console.log(`Sample size: ${SAMPLE_SIZE} | Bucket: ${process.env.R2_BUCKET}`);
  console.log();

  // --- Overall Stats ---
  const stats = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE r2_key IS NOT NULL) AS migrated,
      COUNT(*) FILTER (WHERE r2_key IS NULL AND events IS NOT NULL) AS pending,
      COUNT(*) FILTER (WHERE r2_key IS NULL AND events IS NULL) AS orphaned
    FROM wcl_event_pages
  `);
  const s = stats.rows[0];
  console.log('Migration Status:');
  console.log(`  Total rows:    ${s.total}`);
  console.log(`  Migrated (R2): ${s.migrated}`);
  console.log(`  Pending:       ${s.pending}`);
  console.log(`  Orphaned:      ${s.orphaned} (no r2_key, no events — possible issue)`);
  console.log();

  if (parseInt(s.migrated, 10) === 0) {
    console.log('No migrated rows to verify.');
    await pool.end();
    return;
  }

  // --- Spot-check random migrated rows ---
  const sample = await pool.query(`
    SELECT id, report_code, start_time, end_time, r2_key, event_count
    FROM wcl_event_pages
    WHERE r2_key IS NOT NULL
    ORDER BY RANDOM()
    LIMIT $1
  `, [SAMPLE_SIZE]);

  let passed = 0;
  let failed = 0;

  for (const row of sample.rows) {
    const label = `id=${row.id} key=${row.r2_key}`;
    try {
      const resp = await r2.send(new GetObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: row.r2_key
      }));
      const raw = await resp.Body.transformToString('utf-8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        console.log(`  FAIL ${label}: R2 object is not an array (type: ${typeof parsed})`);
        failed++;
        continue;
      }

      if (row.event_count != null && parsed.length !== row.event_count) {
        console.log(`  FAIL ${label}: event_count mismatch — DB=${row.event_count}, R2=${parsed.length}`);
        failed++;
        continue;
      }

      console.log(`  OK   ${label}: ${parsed.length} events`);
      passed++;
    } catch (err) {
      console.log(`  FAIL ${label}: ${err.message}`);
      failed++;
    }
  }

  console.log();
  console.log(`Spot-check Results: ${passed} passed, ${failed} failed out of ${sample.rows.length}`);

  if (failed > 0) {
    console.log('⚠️  Some verifications failed — investigate before dropping events column.');
    process.exitCode = 1;
  } else {
    console.log('✅ All spot-checks passed.');
  }

  await pool.end();
}

verify().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
