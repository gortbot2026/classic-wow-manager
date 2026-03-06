/**
 * WCL Event Summary Generator
 *
 * Processes raw WCL combat log events stored in R2 and produces compact
 * per-event JSON summaries. Summaries include boss kill/wipe data, per-boss
 * top DPS/HPS rankings, player death details with cause resolution, and
 * aggregate totals.
 *
 * The generated summary is upserted into the wcl_event_summaries table.
 *
 * @module wcl-summary-generator
 */

const { GetObjectCommand } = require('@aws-sdk/client-s3');

/**
 * Fetches a single R2 blob and parses it as a JSON event array.
 *
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - Configured S3/R2 client
 * @param {string} bucket - R2 bucket name
 * @param {string} r2Key - Object key in R2
 * @returns {Promise<Array>} Parsed event array, or empty array on failure
 */
async function fetchR2Blob(s3Client, bucket, r2Key) {
  try {
    const resp = await s3Client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: r2Key
    }));
    const raw = await resp.Body.transformToString('utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error(`[wcl-summary] Failed to fetch R2 blob ${r2Key}: ${err.message}`);
    return [];
  }
}

/**
 * Checks whether an actor ID maps to a player-type actor.
 *
 * @param {Object} actorsById - Map of actor ID to actor info
 * @param {number|string} actorId - Actor ID to check
 * @returns {{ isPlayer: boolean, name: string, className: string }}
 */
function resolveActor(actorsById, actorId) {
  const key = String(actorId);
  const actor = actorsById[key];
  if (!actor) return { isPlayer: false, name: 'Unknown', className: 'Unknown' };
  const isPlayer = actor.type === 'Player' || actor.type === 'Character';
  return {
    isPlayer,
    name: actor.name || 'Unknown',
    className: actor.subType || 'Unknown'
  };
}

/**
 * Resolves an ability name from the abilities map.
 *
 * @param {Object} abilitiesById - Map of ability game ID to ability info
 * @param {number|string} abilityId - Ability game ID
 * @returns {string} Ability name or "Unknown"
 */
function resolveAbility(abilitiesById, abilityId) {
  const key = String(abilityId);
  const ability = abilitiesById[key];
  if (!ability) return 'Unknown';
  return ability.name || 'Unknown';
}

/**
 * Generates a compact raid summary from raw WCL event data stored in R2.
 *
 * Steps:
 * 1. Fetches actors_by_id and abilities_by_id from wcl_report_meta
 * 2. Fetches all R2 blobs for the event from wcl_event_pages
 * 3. Concatenates and sorts events by timestamp
 * 4. Walks events to extract encounters, deaths, and DPS/HPS data
 * 5. Upserts the summary into wcl_event_summaries
 *
 * @param {string} eventId - Event ID (Discord snowflake or report code)
 * @param {string} reportCode - WCL report code
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - Configured S3/R2 client
 * @returns {Promise<void>}
 */
async function generateEventSummary(eventId, reportCode, pool, s3Client) {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    console.error('[wcl-summary] R2_BUCKET not configured, skipping summary generation');
    return;
  }

  console.log(`[wcl-summary] Generating summary for event=${eventId}, report=${reportCode}`);

  // Step 1: Fetch actor and ability metadata
  let actorsById = {};
  let abilitiesById = {};
  try {
    const metaRes = await pool.query(
      `SELECT actors_by_id, abilities_by_id FROM wcl_report_meta WHERE report_code = $1`,
      [reportCode]
    );
    if (metaRes.rows.length > 0) {
      const row = metaRes.rows[0];
      actorsById = typeof row.actors_by_id === 'string'
        ? JSON.parse(row.actors_by_id)
        : (row.actors_by_id || {});
      abilitiesById = typeof row.abilities_by_id === 'string'
        ? JSON.parse(row.abilities_by_id)
        : (row.abilities_by_id || {});
    } else {
      console.warn(`[wcl-summary] No report meta found for ${reportCode}, proceeding without actor/ability data`);
    }
  } catch (err) {
    console.error(`[wcl-summary] Failed to fetch report meta: ${err.message}`);
  }

  // Step 2: Fetch R2 keys for this event
  let r2Keys = [];
  try {
    const pagesRes = await pool.query(
      `SELECT r2_key FROM wcl_event_pages WHERE event_id = $1 AND r2_key IS NOT NULL ORDER BY start_time ASC`,
      [eventId]
    );
    r2Keys = pagesRes.rows.map(r => r.r2_key).filter(Boolean);
  } catch (err) {
    console.error(`[wcl-summary] Failed to query event pages: ${err.message}`);
    return;
  }

  if (r2Keys.length === 0) {
    console.warn(`[wcl-summary] No R2-backed pages found for event ${eventId}`);
    return;
  }

  console.log(`[wcl-summary] Fetching ${r2Keys.length} R2 blobs for event ${eventId}`);

  // Step 3: Fetch all blobs in batches of 10 and concatenate
  const allEvents = [];
  const batchSize = 10;
  for (let i = 0; i < r2Keys.length; i += batchSize) {
    const batch = r2Keys.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(key => fetchR2Blob(s3Client, bucket, key))
    );
    for (const events of results) {
      for (const evt of events) {
        allEvents.push(evt);
      }
    }
  }

  if (allEvents.length === 0) {
    console.warn(`[wcl-summary] No events found in R2 blobs for event ${eventId}`);
    return;
  }

  // Sort by timestamp
  allEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  console.log(`[wcl-summary] Processing ${allEvents.length} events for event ${eventId}`);

  // Step 4: Walk events to extract data

  // --- Encounter tracking ---
  // Map of encounterID -> { name, pulls: [{ startTs, endTs, kill }], activePull: { startTs } | null }
  const encounterMap = new Map();
  // Per-encounter-pull DPS/HPS accumulators: key = `${encounterID}:${pullIndex}`
  // value = { damage: Map<sourceID, amount>, healing: Map<sourceID, amount> }
  const encounterStats = new Map();
  // Track active encounter windows for death context: [{ encounterID, name, startTs }]
  const activeEncounters = [];

  // --- Death tracking ---
  const deaths = [];
  // Rolling buffer of recent damage events for death cause resolution
  // Map<targetID, [{ timestamp, abilityGameID }]>
  const recentDamage = new Map();

  // First pass: find the raid start timestamp for relative times
  const raidStartTs = allEvents.length > 0 ? allEvents[0].timestamp : 0;

  for (const evt of allEvents) {
    const ts = evt.timestamp || 0;
    const evtType = evt.type;

    // Track damage events for death cause resolution and DPS
    if (evtType === 'damage' || evtType === 'damageold') {
      const targetId = String(evt.targetID || '');
      const sourceId = String(evt.sourceID || '');
      const amount = Number(evt.amount || 0);
      const abilityId = evt.abilityGameID;

      // Store recent damage for death cause lookups
      if (targetId) {
        if (!recentDamage.has(targetId)) recentDamage.set(targetId, []);
        const arr = recentDamage.get(targetId);
        arr.push({ timestamp: ts, abilityGameID: abilityId });
        // Keep only last 20 entries per target to limit memory
        if (arr.length > 20) arr.splice(0, arr.length - 20);
      }

      // Accumulate DPS within active encounters
      if (sourceId && amount > 0) {
        const sourceActor = resolveActor(actorsById, sourceId);
        if (sourceActor.isPlayer) {
          for (const ae of activeEncounters) {
            const statsKey = `${ae.encounterID}:${ae.pullIndex}`;
            let stats = encounterStats.get(statsKey);
            if (!stats) {
              stats = { damage: new Map(), healing: new Map() };
              encounterStats.set(statsKey, stats);
            }
            const prev = stats.damage.get(sourceId) || 0;
            stats.damage.set(sourceId, prev + amount);
          }
        }
      }
    }

    // Track healing events for HPS
    if (evtType === 'healing' || evtType === 'healingold') {
      const sourceId = String(evt.sourceID || '');
      const amount = Number(evt.amount || 0);

      if (sourceId && amount > 0) {
        const sourceActor = resolveActor(actorsById, sourceId);
        if (sourceActor.isPlayer) {
          for (const ae of activeEncounters) {
            const statsKey = `${ae.encounterID}:${ae.pullIndex}`;
            let stats = encounterStats.get(statsKey);
            if (!stats) {
              stats = { damage: new Map(), healing: new Map() };
              encounterStats.set(statsKey, stats);
            }
            const prev = stats.healing.get(sourceId) || 0;
            stats.healing.set(sourceId, prev + amount);
          }
        }
      }
    }

    // Encounter start
    if (evtType === 'encounterstart' || evtType === 'ENCOUNTER_START' || evt.type === 'encounter_start') {
      const encId = evt.encounterID || evt.encounterId;
      const encName = evt.name || evt.encounterName || `Encounter ${encId}`;
      if (encId) {
        if (!encounterMap.has(encId)) {
          encounterMap.set(encId, { name: encName, pulls: [] });
        }
        const enc = encounterMap.get(encId);
        const pullIndex = enc.pulls.length;
        enc.pulls.push({ startTs: ts, endTs: null, kill: false });

        // Track as active encounter
        activeEncounters.push({ encounterID: encId, name: encName, startTs: ts, pullIndex });
      }
    }

    // Encounter end
    if (evtType === 'encounterend' || evtType === 'ENCOUNTER_END' || evt.type === 'encounter_end') {
      const encId = evt.encounterID || evt.encounterId;
      const isKill = evt.kill === true || evt.kill === 1;
      if (encId && encounterMap.has(encId)) {
        const enc = encounterMap.get(encId);
        // Close the most recent open pull
        for (let i = enc.pulls.length - 1; i >= 0; i--) {
          if (enc.pulls[i].endTs === null) {
            enc.pulls[i].endTs = ts;
            enc.pulls[i].kill = isKill;
            break;
          }
        }

        // Remove from active encounters
        const aeIdx = activeEncounters.findIndex(ae => ae.encounterID === encId);
        if (aeIdx !== -1) activeEncounters.splice(aeIdx, 1);
      }
    }

    // Player death
    if (evtType === 'death' || evtType === 'UNIT_DIED' || evtType === 'unit_died') {
      const targetId = String(evt.targetID || '');
      if (targetId) {
        const actor = resolveActor(actorsById, targetId);
        if (actor.isPlayer) {
          // Determine death cause: last damage event within 5s
          let cause = 'Unknown';
          const dmgHistory = recentDamage.get(targetId) || [];
          for (let i = dmgHistory.length - 1; i >= 0; i--) {
            if (ts - dmgHistory[i].timestamp <= 5000) {
              cause = resolveAbility(abilitiesById, dmgHistory[i].abilityGameID);
              break;
            }
          }

          // Determine which boss was active when death occurred
          let bossName = 'Trash/Unknown';
          for (const ae of activeEncounters) {
            bossName = ae.name;
            break; // Use the first active encounter
          }

          deaths.push({
            player: actor.name,
            class: actor.className,
            boss: bossName,
            time_sec: Math.round((ts - raidStartTs) / 1000),
            cause
          });
        }
      }
    }
  }

  // Step 5: Build boss summaries with top DPS/HPS
  const bosses = [];
  let totalWipes = 0;
  let bossesKilled = 0;
  let firstEncounterStart = null;
  let lastEncounterEnd = null;

  for (const [encId, enc] of encounterMap) {
    const pullCount = enc.pulls.length;
    let wipes = 0;
    let killDurationSec = null;
    let killPullIndex = -1;

    for (let i = 0; i < enc.pulls.length; i++) {
      const pull = enc.pulls[i];
      if (pull.kill) {
        killPullIndex = i;
        if (pull.startTs != null && pull.endTs != null) {
          killDurationSec = Math.round((pull.endTs - pull.startTs) / 1000);
        }
      } else if (pull.endTs != null) {
        wipes++;
      }
      // Track raid time span
      if (pull.startTs != null) {
        if (firstEncounterStart === null || pull.startTs < firstEncounterStart) {
          firstEncounterStart = pull.startTs;
        }
      }
      if (pull.endTs != null) {
        if (lastEncounterEnd === null || pull.endTs > lastEncounterEnd) {
          lastEncounterEnd = pull.endTs;
        }
      }
    }

    totalWipes += wipes;
    if (killPullIndex >= 0) bossesKilled++;

    // Get top DPS/HPS for the kill pull (or last pull if no kill)
    const targetPullIndex = killPullIndex >= 0 ? killPullIndex : enc.pulls.length - 1;
    const statsKey = `${encId}:${targetPullIndex}`;
    const stats = encounterStats.get(statsKey);

    const topDps = getTopN(stats ? stats.damage : new Map(), actorsById, 3);
    const topHps = getTopN(stats ? stats.healing : new Map(), actorsById, 3);

    bosses.push({
      name: enc.name,
      pull_count: pullCount,
      kill_duration_sec: killDurationSec,
      wipes,
      top_dps: topDps,
      top_hps: topHps
    });
  }

  const totalDurationSec = (firstEncounterStart != null && lastEncounterEnd != null)
    ? Math.round((lastEncounterEnd - firstEncounterStart) / 1000)
    : 0;

  const summary = {
    total_duration_sec: totalDurationSec,
    bosses,
    deaths,
    total_deaths: deaths.length,
    total_wipes: totalWipes,
    bosses_killed: bossesKilled
  };

  // Step 6: Upsert into wcl_event_summaries
  try {
    await pool.query(`
      INSERT INTO wcl_event_summaries (event_id, report_code, summary, generated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (event_id) DO UPDATE
        SET report_code = EXCLUDED.report_code,
            summary = EXCLUDED.summary,
            generated_at = NOW()
    `, [eventId, reportCode, JSON.stringify(summary)]);

    console.log(`[wcl-summary] Summary generated for event=${eventId}: ${bosses.length} bosses, ${deaths.length} deaths, ${bossesKilled} killed`);
  } catch (err) {
    console.error(`[wcl-summary] Failed to upsert summary for event=${eventId}: ${err.message}`);
  }
}

/**
 * Extracts the top N performers from a source-to-amount map.
 *
 * @param {Map<string, number>} amountMap - Map of sourceID to total amount
 * @param {Object} actorsById - Actor resolution map
 * @param {number} n - Number of top entries to return
 * @returns {Array<{ name: string, class: string, amount: number }>}
 */
function getTopN(amountMap, actorsById, n) {
  if (!amountMap || amountMap.size === 0) return [];

  const entries = [];
  for (const [sourceId, amount] of amountMap) {
    const actor = resolveActor(actorsById, sourceId);
    entries.push({ name: actor.name, class: actor.className, amount });
  }

  entries.sort((a, b) => b.amount - a.amount);
  return entries.slice(0, n);
}

module.exports = { generateEventSummary };
