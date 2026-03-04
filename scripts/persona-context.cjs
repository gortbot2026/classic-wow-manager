/**
 * Persona Context Builder
 * 
 * Queries existing database tables to build rich player context
 * for Maya's LLM conversations. Formats player data (characters,
 * raids, loot, gold earned, performance) into a structured text
 * block injected into the system prompt.
 * 
 * @module persona-context
 */

/**
 * Builds a player context block for the LLM system prompt.
 * Queries multiple tables in parallel for performance.
 * 
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} discordId - Player's Discord snowflake ID
 * @returns {Promise<string>} Formatted player context string for LLM injection
 */
async function buildPlayerContext(pool, discordId) {
  let client;
  try {
    client = await pool.connect();

    const [
      charactersRes,
      raidsRes,
      lootRes,
      goldEarnedRes,
      dpsRes,
      hpsRes,
      guildieRes
    ] = await Promise.all([
      // Character names and classes from players table
      client.query(
        `SELECT character_name, class FROM players WHERE discord_id = $1`,
        [discordId]
      ),
      // Recent raids attended (last 10)
      client.query(
        `SELECT pcl.raid_id, pcl.character_name, pcl.class,
                rse.event_id, rse.locked_at
         FROM player_confirmed_logs pcl
         LEFT JOIN rewards_snapshot_events rse ON rse.event_id = pcl.raid_id
         WHERE pcl.discord_id = $1
         ORDER BY pcl.id DESC
         LIMIT 10`,
        [discordId]
      ),
      // Items won (last 10, with gold amounts)
      client.query(
        `SELECT li.item_name, li.gold_amount, li.event_id
         FROM loot_items li
         JOIN players p ON p.character_name = li.player_name AND p.discord_id = $1
         ORDER BY li.id DESC
         LIMIT 10`,
        [discordId]
      ),
      // Gold earned per event (last 5 events, aggregated)
      client.query(
        `SELECT rdp.event_id, 
                SUM(COALESCE(rdp.point_value_edited, rdp.point_value_original, 0)) AS total_points
         FROM rewards_and_deductions_points rdp
         WHERE rdp.discord_user_id = $1
         GROUP BY rdp.event_id
         ORDER BY rdp.event_id DESC
         LIMIT 5`,
        [discordId]
      ),
      // Average DPS (if available from log_data)
      client.query(
        `SELECT AVG(CAST(ld.amount AS NUMERIC)) AS avg_dps
         FROM log_data ld
         JOIN players p ON p.character_name = ld.name AND p.discord_id = $1
         WHERE ld.spec = 'dps'
         LIMIT 1`,
        [discordId]
      ).catch(() => ({ rows: [] })),
      // Average HPS (if available from log_data)
      client.query(
        `SELECT AVG(CAST(ld.amount AS NUMERIC)) AS avg_hps
         FROM log_data ld
         JOIN players p ON p.character_name = ld.name AND p.discord_id = $1
         WHERE ld.spec = 'hps'
         LIMIT 1`,
        [discordId]
      ).catch(() => ({ rows: [] })),
      // Guild membership status from guildies table
      client.query(
        `SELECT character_name, class, rank_name, main_alt, join_date
         FROM guildies WHERE discord_id = $1
         ORDER BY level DESC
         LIMIT 5`,
        [discordId]
      ).catch(() => ({ rows: [] }))
    ]);

    // Build the context string
    const parts = [];

    // Characters
    const characters = charactersRes.rows;
    if (characters.length > 0) {
      parts.push('=== Player Characters ===');
      for (const c of characters) {
        parts.push(`- ${c.character_name} (${c.class || 'Unknown class'})`);
      }
    }

    // Guild status
    const guildies = guildieRes.rows;
    if (guildies.length > 0) {
      parts.push('\n=== Guild Status ===');
      parts.push(`In guild: Yes`);
      for (const g of guildies) {
        parts.push(`- ${g.character_name}: Rank "${g.rank_name || 'Unknown'}", ${g.main_alt || 'main'}, joined ${g.join_date || 'unknown'}`);
      }
    } else {
      parts.push('\n=== Guild Status ===');
      parts.push('In guild: No (PUG player or not yet a member)');
    }

    // Recent raids
    const raids = raidsRes.rows;
    if (raids.length > 0) {
      parts.push(`\n=== Recent Raids (last ${raids.length}) ===`);
      for (const r of raids) {
        const date = r.locked_at ? new Date(r.locked_at).toISOString().split('T')[0] : 'unknown date';
        parts.push(`- Raid ${r.raid_id || r.event_id} on ${date} as ${r.character_name} (${r.class || '?'})`);
      }
    } else {
      parts.push('\n=== Recent Raids ===');
      parts.push('No raids on record.');
    }

    // Loot won
    const loot = lootRes.rows;
    if (loot.length > 0) {
      parts.push(`\n=== Recent Loot Won (last ${loot.length}) ===`);
      for (const l of loot) {
        const gold = l.gold_amount ? `${l.gold_amount}g` : 'free';
        parts.push(`- ${l.item_name} for ${gold} (raid ${l.event_id})`);
      }
    }

    // Gold earned
    const goldEvents = goldEarnedRes.rows;
    if (goldEvents.length > 0) {
      parts.push('\n=== Gold Earned (last 5 events) ===');
      for (const g of goldEvents) {
        parts.push(`- Event ${g.event_id}: ${g.total_points || 0} points/gold`);
      }
    }

    // Performance averages
    const avgDps = dpsRes.rows.length > 0 ? dpsRes.rows[0].avg_dps : null;
    const avgHps = hpsRes.rows.length > 0 ? hpsRes.rows[0].avg_hps : null;
    if (avgDps || avgHps) {
      parts.push('\n=== Performance ===');
      if (avgDps) parts.push(`Average DPS: ${Math.round(Number(avgDps))}`);
      if (avgHps) parts.push(`Average HPS: ${Math.round(Number(avgHps))}`);
    }

    return parts.join('\n');
  } catch (err) {
    console.error('[persona-context] Error building player context:', err.message || err);
    return '(Player context unavailable due to database error)';
  } finally {
    if (client) client.release();
  }
}

/**
 * Fetches voice transcripts mentioning a player (Phase 2).
 * Returns empty array until Phase 2 voice worker is implemented.
 * 
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} discordId - Player's Discord snowflake ID
 * @param {string[]} characterNames - Player's character names for text matching
 * @returns {Promise<string>} Formatted voice transcript context
 */
async function buildVoiceContext(pool, discordId, characterNames) {
  try {
    // Query transcripts where speaker is this player or text mentions their character
    const nameConditions = characterNames.map((_, i) => `transcript_text ILIKE $${i + 2}`);
    const params = [discordId, ...characterNames.map(n => `%${n}%`)];

    const whereClause = nameConditions.length > 0
      ? `(speaker_discord_id = $1 OR ${nameConditions.join(' OR ')})`
      : `speaker_discord_id = $1`;

    const result = await pool.query(
      `SELECT speaker_name, transcript_text, spoken_at, event_id
       FROM raid_voice_transcripts
       WHERE ${whereClause}
       ORDER BY spoken_at DESC
       LIMIT 20`,
      params
    );

    if (result.rows.length === 0) return '';

    const lines = ['=== Voice Comms from Recent Raids ==='];
    for (const t of result.rows) {
      const time = t.spoken_at ? new Date(t.spoken_at).toISOString() : 'unknown';
      lines.push(`[${time}] ${t.speaker_name || 'Unknown'}: "${t.transcript_text}"`);
    }
    return lines.join('\n');
  } catch (err) {
    // Table may not exist yet or be empty — that's fine
    return '';
  }
}

module.exports = { buildPlayerContext, buildVoiceContext };
