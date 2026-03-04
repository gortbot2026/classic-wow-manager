const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const discordId = '492023474437619732';

  // Get all Kim's characters
  const charsRes = await pool.query(
    `SELECT LOWER(character_name) as name FROM players WHERE discord_id = $1`, [discordId]
  );
  const kimChars = new Set(charsRes.rows.map(r => r.name));

  // Get unique raids Kim attended that have a published snapshot
  const raidsRes = await pool.query(`
    SELECT DISTINCT pcl.raid_id,
      STRING_AGG(DISTINCT pcl.character_name, ', ') as chars_attended,
      rse.shared_gold_pot, rse.total_gold_pot
    FROM player_confirmed_logs pcl
    JOIN rewards_snapshot_events rse ON rse.event_id = pcl.raid_id AND rse.published = TRUE
    WHERE pcl.discord_id = $1
    GROUP BY pcl.raid_id, rse.shared_gold_pot, rse.total_gold_pot
    ORDER BY pcl.raid_id DESC
  `, [discordId]);

  const results = [];
  let grandTotal = 0;

  for (const raid of raidsRes.rows) {
    const eventId = raid.raid_id;
    const sharedPot = Number(raid.shared_gold_pot) || 0;

    // Get all snapshot entries for this event
    const entriesRes = await pool.query(`
      SELECT panel_key, character_name,
        COALESCE(point_value_edited, point_value_original) as pts,
        aux_json
      FROM rewards_and_deductions_points
      WHERE event_id = $1
    `, [eventId]);

    // Get all confirmed players for this event
    const confirmedRes = await pool.query(`
      SELECT DISTINCT LOWER(character_name) as name FROM player_confirmed_logs WHERE raid_id = $1
    `, [eventId]);
    const confirmedPlayers = new Set(confirmedRes.rows.map(r => r.name));

    // Check if base panel exists
    const hasBase = entriesRes.rows.some(r => r.panel_key === 'base');

    // Build player points map seeded from confirmed players
    const playerPoints = new Map();
    const playerDirectGold = new Map();
    confirmedPlayers.forEach(name => {
      playerPoints.set(name, hasBase ? 0 : 100);
      playerDirectGold.set(name, 0);
    });

    // Process entries
    let manualGoldTotal = 0;
    for (const row of entriesRes.rows) {
      const name = (row.character_name || '').toLowerCase();
      const pts = Number(row.pts) || 0;
      if (row.panel_key === 'manual_points') {
        const isGold = row.aux_json && (row.aux_json.is_gold === true || row.aux_json.is_gold === 'true');
        if (isGold && pts > 0) {
          manualGoldTotal += pts;
          playerDirectGold.set(name, (playerDirectGold.get(name) || 0) + pts);
        } else {
          if (playerPoints.has(name)) playerPoints.set(name, (playerPoints.get(name) || 0) + pts);
        }
      } else {
        if (playerPoints.has(name)) playerPoints.set(name, (playerPoints.get(name) || 0) + pts);
      }
    }

    // Calculate GPP
    let totalPts = 0;
    playerPoints.forEach(pts => { totalPts += Math.max(0, pts); });
    const adjustedPot = Math.max(0, sharedPot - manualGoldTotal);
    const gpp = totalPts > 0 ? adjustedPot / totalPts : 0;

    // Sum gold for ALL of Kim's characters in this raid (once per raid)
    let kimGold = 0;
    let kimTotalPts = 0;
    const kimCharsThisRaid = [];

    for (const [name, pts] of playerPoints.entries()) {
      if (kimChars.has(name)) {
        const effPts = Math.max(0, pts);
        const gold = Math.floor(effPts * gpp) + (playerDirectGold.get(name) || 0);
        kimGold += gold;
        kimTotalPts += effPts;
        kimCharsThisRaid.push(name);
      }
    }

    grandTotal += kimGold;
    results.push({
      eventId,
      chars: raid.chars_attended,
      pts: kimTotalPts,
      gpp: gpp.toFixed(2),
      gold: kimGold
    });
  }

  console.log('\nEvent ID             | Characters          | Points | GPP    | Gold Earned');
  console.log('---------------------|---------------------|--------|--------|------------');
  for (const r of results) {
    const chars = r.chars.padEnd(19);
    console.log(`${r.eventId} | ${chars} | ${String(r.pts).padStart(6)} | ${r.gpp.padStart(6)} | ${r.gold.toLocaleString()}g`);
  }
  console.log('---------------------|---------------------|--------|--------|------------');
  console.log(`TOTAL: ${grandTotal.toLocaleString()}g across ${results.length} raids`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
