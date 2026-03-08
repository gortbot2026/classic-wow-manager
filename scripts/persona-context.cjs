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
      // Recent raids attended (last 10) — use roster_overrides as source of truth
      client.query(
        `SELECT ro.event_id AS raid_id, ro.assigned_char_name AS character_name, ro.assigned_char_class AS character_class,
                rse.event_id, rse.locked_at
         FROM roster_overrides ro
         LEFT JOIN rewards_snapshot_events rse ON rse.event_id = ro.event_id
         WHERE ro.discord_user_id = $1 AND ro.in_raid = true AND ro.is_placeholder = false
         ORDER BY ro.event_id DESC
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
        `SELECT AVG(ld.dps_value) AS avg_dps
         FROM log_data ld
         JOIN players p ON p.character_name = ld.character_name AND p.discord_id = $1
         WHERE ld.dps_value > 0`,
        [discordId]
      ).catch(() => ({ rows: [] })),
      // Average HPS (if available from log_data)
      client.query(
        `SELECT AVG(ld.hps_value) AS avg_hps
         FROM log_data ld
         JOIN players p ON p.character_name = ld.character_name AND p.discord_id = $1
         WHERE ld.hps_value > 0`,
        [discordId]
      ).catch(() => ({ rows: [] })),
      // Guild membership status from guildies table (joined via players for discord_id)
      client.query(
        `SELECT g.character_name, g.class, g.rank_name, g.main_alt, g.join_date
         FROM guildies g
         JOIN players p ON LOWER(p.character_name) = LOWER(g.character_name)
         WHERE p.discord_id = $1
         ORDER BY g.level DESC
         LIMIT 5`,
        [discordId]
      ).catch(() => ({ rows: [] }))
    ]);

    // Build the context string
    const parts = [];

    // Discord identity (best-effort)
    try {
      const duRes = await client.query(
        `SELECT username FROM discord_users WHERE discord_id = $1 LIMIT 1`,
        [discordId]
      ).catch(() => ({ rows: [] }));
      if (duRes.rows.length > 0 && duRes.rows[0].username) {
        const raw = duRes.rows[0].username;
        const sanitized = raw.replace(/[^a-zA-Z]/g, '');
        const displayName = sanitized.length >= 2
          ? sanitized.charAt(0).toUpperCase() + sanitized.slice(1).toLowerCase()
          : null;
        if (displayName) parts.push(`Discord username: ${displayName}`);
      }
    } catch (_) { /* non-critical */ }

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

    // Recent raids — enrich with channel names from attendance_cache where available
    const raids = raidsRes.rows;
    if (raids.length > 0) {
      // Batch-fetch channel names for raid IDs
      const raidEventIds = [...new Set(raids.map(r => r.raid_id || r.event_id).filter(Boolean))];
      let channelNameMap = new Map();
      if (raidEventIds.length > 0) {
        try {
          const cnRes = await client.query(
            `SELECT DISTINCT event_id, channel_name FROM attendance_cache WHERE event_id = ANY($1)`,
            [raidEventIds]
          );
          for (const row of cnRes.rows) {
            if (row.channel_name) channelNameMap.set(row.event_id, row.channel_name);
          }
        } catch (_) { /* attendance_cache may be empty */ }
      }

      parts.push(`\n=== Recent Raids (last ${raids.length}) ===`);
      for (const r of raids) {
        const date = r.locked_at ? new Date(r.locked_at).toISOString().split('T')[0] : 'unknown date';
        const eventId = r.raid_id || r.event_id;
        const channelName = channelNameMap.get(eventId);
        const raidLabel = channelName
          ? humanizeRaidName(stripDateSuffix(channelName))
          : (eventId || 'unknown');
        parts.push(`- ${raidLabel} on ${date} as ${r.character_name} (${r.character_class || '?'})`);
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

    // Gold & Economy section (uses resolveTemplateVariables data)
    try {
      const templateVars = await resolveTemplateVariables(pool, discordId, null, null);
      const totalGold = templateVars.get('total_gold_earned') || '0';
      const lastRaidName = templateVars.get('last_raid_name') || 'unknown';
      const goldEarnedLast = templateVars.get('gold_earned_last_raid') || '0';
      const goldSpentLast = templateVars.get('gold_spent_last_raid') || '0';
      const manualRewards = templateVars.get('manual_rewards_last_raid') || '0';
      const manualDeductions = templateVars.get('manual_deductions_last_raid') || '0';
      const itemsWon = templateVars.get('items_won_last_raid') || '0';
      const guildJoinDate = templateVars.get('guild_join_date') || 'Not in 1Principles Guild';
      const totalRaids = templateVars.get('total_raids_attended') || '0';

      parts.push('\n=== Gold & Economy ===');
      parts.push(`Guild: ${templateVars.get('guild_name') || '1Principles'}`);
      parts.push(`Total gold earned: ${totalGold}g`);
      if (lastRaidName !== 'unknown') {
        parts.push(`Last raid (${lastRaidName}): earned ${goldEarnedLast}g, spent ${goldSpentLast}g, manual reward points ${manualRewards} pts, manual deduction points ${manualDeductions} pts, items won: ${itemsWon}`);
      }

      parts.push('\n=== Guild Membership ===');
      parts.push(`Joined: ${guildJoinDate}`);
      parts.push(`Total raids attended: ${totalRaids}`);
    } catch (err) {
      console.error('[persona-context] Error building gold/guild context:', err.message || err);
    }

    // Player notes — facts Maya has learned from conversations
    try {
      const notesRes = await pool.query(
        `SELECT note, created_at FROM bot_player_notes WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [discordId]
      );
      if (notesRes.rows.length > 0) {
        parts.push('\n=== What I know about this player ===');
        for (const row of notesRes.rows) {
          const d = new Date(row.created_at);
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const shortDate = months[d.getMonth()] + ' ' + d.getDate();
          parts.push(`- [${shortDate}] ${row.note}`);
        }
      }
    } catch (err) {
      console.error('[persona-context] Error fetching player notes:', err.message || err);
    }

    // Previous conversation summaries (for conversation continuity)
    try {
      const summaryRes = await pool.query(
        `SELECT summary, created_at FROM bot_conversations
         WHERE discord_id = $1 AND status = 'closed' AND summary IS NOT NULL
         ORDER BY updated_at DESC LIMIT 3`,
        [discordId]
      );
      if (summaryRes.rows.length > 0) {
        parts.push('\n=== Previous conversations with this player ===');
        for (const row of summaryRes.rows) {
          const d = new Date(row.created_at);
          const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          parts.push(`- [${dateStr}] ${row.summary}`);
        }
      }
    } catch (err) {
      console.error('[persona-context] Error fetching conversation summaries:', err.message || err);
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

/**
 * Resolves the best name to address a player in conversation.
 * Uses a 4-step resolution chain:
 *   1. Conversation's preferred_name (admin override)
 *   2. Previous conversation's preferred_name
 *   3. Character name from most recent raid
 *   4. Sanitized Discord name (strip non-letters, title-case)
 * Falls back to null if no suitable name is found.
 *
 * After resolution, stores the result back on the conversation for consistency.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} discordId - Player's Discord snowflake ID
 * @param {string} conversationId - Current conversation ID
 * @returns {Promise<string|null>} Resolved player name or null
 */
async function resolvePlayerName(pool, discordId, conversationId) {
  try {
    // Step 1: Check this conversation's preferred_name
    const convRes = await pool.query(
      `SELECT preferred_name FROM bot_conversations WHERE id = $1`,
      [conversationId]
    );
    if (convRes.rows.length > 0 && convRes.rows[0].preferred_name) {
      return convRes.rows[0].preferred_name;
    }

    let resolvedName = null;

    // Step 2: Check previous conversations for a preferred_name
    const prevRes = await pool.query(
      `SELECT preferred_name FROM bot_conversations
       WHERE discord_id = $1 AND preferred_name IS NOT NULL AND id != $2
       ORDER BY created_at DESC LIMIT 1`,
      [discordId, conversationId]
    );
    if (prevRes.rows.length > 0 && prevRes.rows[0].preferred_name) {
      resolvedName = prevRes.rows[0].preferred_name;
    }

    // Step 3: Character name from most recent raid
    if (!resolvedName) {
      const charRes = await pool.query(
        `SELECT assigned_char_name AS character_name FROM roster_overrides
         WHERE discord_user_id = $1 AND in_raid = true AND is_placeholder = false
         ORDER BY event_id DESC LIMIT 1`,
        [discordId]
      );
      if (charRes.rows.length > 0 && charRes.rows[0].character_name) {
        resolvedName = charRes.rows[0].character_name;
      }
    }

    // Step 4: Sanitized Discord name
    if (!resolvedName) {
      const playerRes = await pool.query(
        `SELECT player_name FROM bot_conversations WHERE id = $1`,
        [conversationId]
      );
      let rawName = playerRes.rows.length > 0 ? playerRes.rows[0].player_name : null;

      // Fallback to players table
      if (!rawName) {
        const pRes = await pool.query(
          `SELECT character_name FROM players WHERE discord_id = $1 LIMIT 1`,
          [discordId]
        );
        rawName = pRes.rows.length > 0 ? pRes.rows[0].character_name : null;
      }

      if (rawName) {
        // Strip all non-letter characters
        const lettersOnly = rawName.replace(/[^a-zA-Z]/g, '');
        if (lettersOnly.length >= 3) {
          // Title-case: first letter uppercase, rest lowercase
          resolvedName = lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
        }
      }
    }

    // Store resolved name on the conversation for future reference
    if (resolvedName) {
      await pool.query(
        `UPDATE bot_conversations SET preferred_name = $1 WHERE id = $2`,
        [resolvedName, conversationId]
      ).catch(() => {
        // Non-critical — don't fail if update errors
      });
    }

    return resolvedName;
  } catch (err) {
    console.error('[persona-context] Error resolving player name:', err.message || err);
    return null;
  }
}

/**
 * Abbreviation lookup for common WoW raid short names.
 * Keys are lowercased slugs; values are the display-friendly form.
 * @type {Object<string, string>}
 */
const RAID_ABBREVIATIONS = {
  nax: 'Naxx', naxx: 'Naxx',
  aq: 'AQ40', aq40: 'AQ40', aq20: 'AQ20',
  mc: 'Molten Core',
  bwl: 'BWL',
  zg: 'Zul Gurub',
  ony: 'Onyxia', onyxia: 'Onyxia'
};

/**
 * Converts a raw Discord channel slug into a human-readable raid name.
 * Replaces hyphens with spaces, title-cases each word, and expands
 * known abbreviations (e.g. "thursday-nax" → "Thursday Naxx").
 *
 * @param {string} slug - Raw channel/raid slug (e.g. "thursday-nax")
 * @returns {string} Human-readable raid name
 */
function humanizeRaidName(slug) {
  if (!slug) return slug;
  return slug
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      if (RAID_ABBREVIATIONS[lower]) return RAID_ABBREVIATIONS[lower];
      // Title-case: first letter upper, rest lower
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Strips trailing date suffixes from raid/channel names.
 * Handles patterns like " - 2025-03-01", " 03/01", " 03/01/25".
 *
 * @param {string} name - Raw channel/raid name
 * @returns {string} Cleaned name without date suffix
 */
function stripDateSuffix(name) {
  if (!name) return name;
  return name
    .replace(/\s*[-–—]\s*\d{4}-\d{2}-\d{2}$/, '')
    .replace(/\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?$/, '')
    .trim();
}

/**
 * Formats a date as "March 2, 2025" (US English long format).
 *
 * @param {Date|string|null} date - Date to format
 * @returns {string} Formatted date string or "unknown"
 */
function formatDate(date) {
  if (!date) return 'unknown';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'unknown';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Normalizes a snapshot character name (mirrors gold.js normalizeSnapshotName).
 * Strips leading bullet characters and trailing group parentheses.
 *
 * @param {string} name - Raw character name from snapshot
 * @returns {string} Normalized name
 */
function normalizeSnapshotName(name) {
  try {
    let s = String(name || '').trim();
    s = s.replace(/^[\s•\u2022\u00B7\-\u2013\u2014]+/, '');
    s = s.replace(/\s*\((?:tank\s*)?gr(?:ou)?p\s*\d*\)\s*$/i, '');
    return s.trim();
  } catch { return String(name || '').trim(); }
}

/**
 * Validates a WoW character name (no digits, no spaces).
 *
 * @param {string} name - Character name to validate
 * @returns {boolean} True if valid WoW name
 */
function isValidWoWName(name) {
  const s = String(name || '');
  if (/\d/.test(s)) return false;
  if (/\s/.test(s)) return false;
  return true;
}

/**
 * Computes gold earned for a player across one or more events using the
 * same 6-step formula as computeTotalsFromSnapshot() in gold.js.
 *
 * Steps: (A) sum panel points excl. manual, (B) add 100 base if no base panel,
 * (C) process manual_points (gold vs points), (D) adjusted pot,
 * (E) total points, (F) gold per point → per-player gold.
 *
 * @param {Array<Object>} entries - Snapshot entries for the events
 * @param {Array<Object>} confirmed - Confirmed player logs for the events
 * @param {Map<string, number>} sharedPotByEvent - event_id → shared_gold_pot
 * @param {Set<string>} playerCharNames - Lowercased character names belonging to the target player
 * @returns {{ totalGold: number, goldByEvent: Object<string, number> }}
 */
function computeGoldFromEntries(entries, confirmed, sharedPotByEvent, playerCharNames) {
  const lower = s => String(s || '').toLowerCase();

  // Group entries and confirmed by event
  const snapshotByEvent = new Map();
  for (const r of entries) {
    if (!snapshotByEvent.has(r.event_id)) snapshotByEvent.set(r.event_id, []);
    snapshotByEvent.get(r.event_id).push(r);
  }
  const confirmedByEvent = new Map();
  for (const r of confirmed) {
    if (!confirmedByEvent.has(r.event_id)) confirmedByEvent.set(r.event_id, []);
    confirmedByEvent.get(r.event_id).push(r);
  }

  let totalGold = 0;
  const goldByEvent = {};

  for (const [eventId, sharedPot] of sharedPotByEvent.entries()) {
    const evEntries = snapshotByEvent.get(eventId) || [];
    const evConfirmed = confirmedByEvent.get(eventId) || [];

    // Seed player map from confirmed players
    const nameToPlayer = new Map();
    for (const p of evConfirmed) {
      const normalized = normalizeSnapshotName(p.character_name);
      if (!isValidWoWName(normalized)) continue;
      const key = lower(normalized);
      if (!nameToPlayer.has(key)) nameToPlayer.set(key, { points: 0, gold: 0 });
    }

    // Step A: Sum panel points (excluding manual_points)
    for (const r of evEntries) {
      const normalized = normalizeSnapshotName(r.character_name || '');
      if (!isValidWoWName(normalized)) continue;
      const key = lower(normalized);
      const v = nameToPlayer.get(key);
      if (!v) continue;
      if (String(r.panel_key || '') === 'manual_points') continue;
      v.points += (Number(r.point_value) || 0);
    }

    // Step B: If no base panel exists, add 100 base points to everyone
    const hasBasePoints = evEntries.some(r => String(r.panel_key || '') === 'base');
    if (!hasBasePoints) {
      nameToPlayer.forEach(v => { v.points += 100; });
    }

    // Step C: Process manual_points entries
    let manualGoldPayoutTotal = 0;
    for (const r of evEntries) {
      if (String(r.panel_key || '') !== 'manual_points') continue;
      const normalized = normalizeSnapshotName(r.character_name || '');
      if (!isValidWoWName(normalized)) continue;
      const key = lower(normalized);
      const v = nameToPlayer.get(key);
      if (!v) continue;

      const aux = r.aux_json || {};
      const isGold = !!(aux.is_gold === true || aux.is_gold === 'true');
      const amt = Number(r.point_value) || 0;

      if (isGold) {
        if (amt > 0) {
          manualGoldPayoutTotal += amt;
          v.gold = Math.max(0, (Number(v.gold) || 0) + amt);
        }
      } else {
        v.points += amt;
      }
    }

    // Step D: Adjusted pot
    const adjustedPot = Math.max(0, sharedPot - manualGoldPayoutTotal);

    // Step E: Total points across all confirmed players
    let totalPointsAll = 0;
    nameToPlayer.forEach(v => { totalPointsAll += Math.max(0, Number(v.points) || 0); });

    // Step F: Gold per point and per-player gold
    const goldPerPoint = (adjustedPot > 0 && totalPointsAll > 0) ? adjustedPot / totalPointsAll : 0;
    nameToPlayer.forEach(v => {
      const effPts = Math.max(0, Number(v.points) || 0);
      v.gold = Math.max(0, Math.floor(effPts * goldPerPoint) + (Number(v.gold) || 0));
    });

    // Sum gold for the target player
    let eventGold = 0;
    for (const charName of playerCharNames) {
      const v = nameToPlayer.get(charName);
      if (v) {
        totalGold += v.gold;
        eventGold += v.gold;
      }
    }
    if (eventGold > 0) goldByEvent[eventId] = eventGold;
  }

  return { totalGold, goldByEvent };
}

/**
 * Resolves all template variables for a player by querying DB in parallel.
 * Returns a Map of variable_name → string value (never null/undefined).
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} discordId - Player's Discord snowflake ID
 * @param {string|null} [eventId=null] - Optional event ID for raid-specific context
 * @param {string|null} [conversationId=null] - Optional conversation ID for discord_name lookup
 * @returns {Promise<Map<string, string>>} Map of variable names to resolved string values
 */
async function resolveTemplateVariables(pool, discordId, eventId, conversationId) {
  const vars = new Map();
  const lower = s => String(s || '').toLowerCase();

  try {
    // Parallel queries for base data
    const [
      characterRes,
      discordNameRes,
      raidsAttendedRes,
      guildJoinRes,
      playerCharsRes
    ] = await Promise.all([
      // Character name from players table
      pool.query(
        `SELECT character_name FROM players WHERE discord_id = $1 LIMIT 1`,
        [discordId]
      ),
      // Discord display name + candidate outreach columns from bot_conversations
      conversationId
        ? pool.query(
            `SELECT player_name, trigger_type, candidate_char_name, candidate_class,
                    candidate_last_raid_name, candidate_last_raid_date, tonight_raid_title,
                    candidate_chars, event_id
             FROM bot_conversations WHERE id = $1`,
            [conversationId]
          )
        : Promise.resolve({ rows: [] }),
      // Total raids attended — use roster_overrides (truth of who was in raid, not just who confirmed)
      pool.query(
        `SELECT COUNT(DISTINCT event_id) AS count FROM roster_overrides WHERE discord_user_id = $1 AND in_raid = true AND is_placeholder = false`,
        [discordId]
      ),
      // Guild join date — earliest raid appearance in roster_overrides
      pool.query(
        `SELECT MIN(TO_TIMESTAMP(((event_id::bigint >> 22) + 1420070400000) / 1000.0)) AS earliest FROM roster_overrides WHERE discord_user_id = $1 AND in_raid = true AND is_placeholder = false`,
        [discordId]
      ),
      // All character names for this player (for loot matching)
      pool.query(
        `SELECT character_name FROM players WHERE discord_id = $1`,
        [discordId]
      )
    ]);

    // Basic variables
    const characterName = characterRes.rows.length > 0 && characterRes.rows[0].character_name
      ? characterRes.rows[0].character_name : 'unknown';
    vars.set('character_name', characterName);

    let discordName = discordNameRes.rows.length > 0 && discordNameRes.rows[0].player_name
      ? discordNameRes.rows[0].player_name : null;

    // Fallback: query discord_users.username if bot_conversations.player_name is null
    if (!discordName) {
      try {
        const duRes = await pool.query(
          `SELECT username FROM discord_users WHERE discord_id = $1 LIMIT 1`,
          [discordId]
        );
        if (duRes.rows.length > 0 && duRes.rows[0].username) {
          // Title-case the Discord username for consistent display
          const raw = duRes.rows[0].username;
          discordName = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        }
      } catch (_) {
        // discord_users table may not exist — non-critical
      }
    }

    vars.set('discord_name', discordName || 'unknown');
    // player_name alias — resolves to same value as discord_name (player's display name)
    vars.set('player_name', discordName || 'unknown');

    vars.set('guild_name', '1Principles');

    // Track outreach conversation data for later override
    const convRowForOutreach = discordNameRes.rows.length > 0 ? discordNameRes.rows[0] : null;
    const isOutreach = convRowForOutreach && convRowForOutreach.trigger_type === 'candidate_outreach';

    const totalRaids = String(raidsAttendedRes.rows[0]?.count || '0');
    vars.set('total_raids_attended', totalRaids);
    vars.set('raids_attended', totalRaids); // backward compat alias

    // Guild join date
    const earliestConfirmed = guildJoinRes.rows[0]?.earliest;
    if (earliestConfirmed) {
      vars.set('guild_join_date', formatDate(earliestConfirmed));
    } else {
      vars.set('guild_join_date', 'Not in 1Principles Guild');
    }

    // Collect player character names for gold/loot queries
    const playerCharNames = new Set();
    for (const row of playerCharsRes.rows) {
      if (row.character_name) playerCharNames.add(row.character_name.toLowerCase());
    }

    // Determine "last raid" event_id
    let lastRaidEventId = eventId || null;
    if (!lastRaidEventId) {
      const lastRaidRes = await pool.query(
        `SELECT ro.event_id
         FROM roster_overrides ro
         JOIN rewards_snapshot_events rse ON rse.event_id = ro.event_id AND rse.published = TRUE
         WHERE ro.discord_user_id = $1 AND ro.in_raid = true AND ro.is_placeholder = false
         ORDER BY ro.event_id DESC LIMIT 1`,
        [discordId]
      );
      if (lastRaidRes.rows.length > 0) {
        lastRaidEventId = lastRaidRes.rows[0].event_id;
      }
    }

    // --- Last raid info queries (run in parallel) ---
    const lastRaidQueries = [];

    // Last raid name: try attendance_cache first, fall back to last_boss + day-of-week from rewards_snapshot_events
    lastRaidQueries.push(
      lastRaidEventId
        ? pool.query(
            `SELECT
               ac.channel_name,
               rse.last_boss,
               rse.locked_at
             FROM rewards_snapshot_events rse
             LEFT JOIN attendance_cache ac ON ac.event_id = rse.event_id
             WHERE rse.event_id = $1
             LIMIT 1`,
            [lastRaidEventId]
          )
        : Promise.resolve({ rows: [] })
    );

    // Last raid date from rewards_snapshot_events
    lastRaidQueries.push(
      lastRaidEventId
        ? pool.query(
            `SELECT locked_at FROM rewards_snapshot_events WHERE event_id = $1`,
            [lastRaidEventId]
          )
        : Promise.resolve({ rows: [] })
    );

    // Gold spent last raid (SUM of loot_items.gold_amount)
    // Defensive: ensure all character names are lowercased for LOWER() SQL comparisons
    const charNamesArray = Array.from(playerCharNames).map(n => n.toLowerCase());
    lastRaidQueries.push(
      lastRaidEventId && charNamesArray.length > 0
        ? pool.query(
            `SELECT COALESCE(SUM(gold_amount), 0) AS total_spent
             FROM loot_items
             WHERE event_id = $1 AND LOWER(player_name) = ANY($2)`,
            [lastRaidEventId, charNamesArray]
          )
        : Promise.resolve({ rows: [{ total_spent: 0 }] })
    );

    // Items won last raid
    lastRaidQueries.push(
      lastRaidEventId && charNamesArray.length > 0
        ? pool.query(
            `SELECT COUNT(*) AS count
             FROM loot_items
             WHERE event_id = $1 AND LOWER(player_name) = ANY($2)`,
            [lastRaidEventId, charNamesArray]
          )
        : Promise.resolve({ rows: [{ count: 0 }] })
    );

    // Manual rewards/deductions last raid
    lastRaidQueries.push(
      lastRaidEventId
        ? pool.query(
            `SELECT
               COALESCE(SUM(CASE WHEN COALESCE(point_value_edited, point_value_original, 0) > 0
                 THEN COALESCE(point_value_edited, point_value_original, 0) ELSE 0 END), 0) AS rewards,
               COALESCE(SUM(CASE WHEN COALESCE(point_value_edited, point_value_original, 0) < 0
                 THEN ABS(COALESCE(point_value_edited, point_value_original, 0)) ELSE 0 END), 0) AS deductions
             FROM rewards_and_deductions_points
             WHERE event_id = $1 AND panel_key = 'manual_points' AND discord_user_id = $2`,
            [lastRaidEventId, discordId]
          )
        : Promise.resolve({ rows: [{ rewards: 0, deductions: 0 }] })
    );

    const [raidNameRes, raidDateRes, goldSpentRes, itemsWonRes, manualRes] =
      await Promise.all(lastRaidQueries);

    // Last raid name
    // Resolve raid name: prefer attendance_cache channel_name, fall back to last_boss + day-of-week
    let lastRaidName = 'unknown';
    if (raidNameRes.rows.length > 0) {
      const row = raidNameRes.rows[0];
      if (row.channel_name) {
        lastRaidName = humanizeRaidName(stripDateSuffix(row.channel_name));
      } else if (row.last_boss) {
        // Map last boss to raid instance name
        const BOSS_TO_RAID = {
          "kel'thuzad": 'Naxx', "kelthuzad": 'Naxx',
          "c'thun": 'AQ40', "cthun": 'AQ40',
          "viscidus": 'AQ20', "ossirian": 'AQ20',
          "nefarian": 'BWL',
          "ragnaros": 'Molten Core',
          "hakkar": 'Zul Gurub',
          "onyxia": 'Onyxia'
        };
        const bossKey = (row.last_boss || '').toLowerCase().replace(/[^a-z']/g, '');
        const raidInstance = BOSS_TO_RAID[bossKey] || row.last_boss;
        if (row.locked_at) {
          const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          const day = dayNames[new Date(row.locked_at).getDay()];
          lastRaidName = `${day} ${raidInstance}`;
        } else {
          lastRaidName = raidInstance;
        }
      }
    }
    vars.set('last_raid_name', lastRaidName);
    vars.set('raid_name', lastRaidName); // backward compat alias

    // Last raid date
    const lastRaidDate = raidDateRes.rows.length > 0 && raidDateRes.rows[0].locked_at
      ? formatDate(raidDateRes.rows[0].locked_at) : 'unknown';
    vars.set('last_raid_date', lastRaidDate);

    // Gold spent last raid
    vars.set('gold_spent_last_raid', String(Number(goldSpentRes.rows[0]?.total_spent) || 0));

    // Items won last raid
    const itemsWon = String(Number(itemsWonRes.rows[0]?.count) || 0);
    vars.set('items_won_last_raid', itemsWon);
    vars.set('items_won', itemsWon); // backward compat alias

    // Manual rewards/deductions last raid
    vars.set('manual_rewards_last_raid', String(Number(manualRes.rows[0]?.rewards) || 0));
    vars.set('manual_deductions_last_raid', String(Number(manualRes.rows[0]?.deductions) || 0));

    // --- Gold calculations (total + last raid) ---
    // Get all published events this player attended — use roster_overrides (in_raid=true) as source of truth
    const attendedRaidsRes = discordId
      ? await pool.query(
          `SELECT DISTINCT ro.event_id, rse.shared_gold_pot
           FROM roster_overrides ro
           JOIN rewards_snapshot_events rse ON rse.event_id = ro.event_id
             AND rse.published = TRUE
             AND rse.shared_gold_pot IS NOT NULL AND rse.shared_gold_pot > 0
           WHERE ro.discord_user_id = $1 AND ro.in_raid = true AND ro.is_placeholder = false`,
          [discordId]
        )
      : { rows: [] };

    if (attendedRaidsRes.rows.length > 0) {
      const allEventIds = attendedRaidsRes.rows.map(r => r.event_id);
      const sharedPotByEvent = new Map();
      for (const r of attendedRaidsRes.rows) {
        sharedPotByEvent.set(r.event_id, Number(r.shared_gold_pot) || 0);
      }

      // Batch-fetch snapshot entries and confirmed players
      const [snapshotRes, confirmedRes] = await Promise.all([
        pool.query(
          `SELECT event_id, character_name, panel_key,
                  COALESCE(point_value_edited, point_value_original) AS point_value,
                  aux_json
           FROM rewards_and_deductions_points
           WHERE event_id = ANY($1)`,
          [allEventIds]
        ),
        pool.query(
          `SELECT DISTINCT raid_id AS event_id, character_name
           FROM player_confirmed_logs
           WHERE raid_id = ANY($1)`,
          [allEventIds]
        )
      ]);

      // Total gold earned across all events
      const totalResult = computeGoldFromEntries(
        snapshotRes.rows, confirmedRes.rows, sharedPotByEvent, playerCharNames
      );
      vars.set('total_gold_earned', String(totalResult.totalGold));

      // Gold earned last raid only — use goldByEvent from the full calculation
      // (re-running computeGoldFromEntries on filtered data breaks the per-event totals)
      if (lastRaidEventId && totalResult.goldByEvent[lastRaidEventId] !== undefined) {
        vars.set('gold_earned_last_raid', String(totalResult.goldByEvent[lastRaidEventId]));
      } else {
        vars.set('gold_earned_last_raid', '0');
      }
    } else {
      vars.set('total_gold_earned', '0');
      vars.set('gold_earned_last_raid', '0');
    }

    // Backward compat alias
    vars.set('gold_earned', vars.get('gold_earned_last_raid'));

    // --- Raidleader name and next upcoming raid ---

    // Resolve {{raidleader_name}} — from event_metadata for this event, or next upcoming event
    let raidleaderName = 'TBD';
    let resolvedEventId = eventId || null;

    // If no event_id, try to find the next upcoming event from events_cache
    if (!resolvedEventId) {
      try {
        const cacheRes = await pool.query(
          `SELECT events_data FROM events_cache WHERE cache_key = 'raid_helper_events'`
        );
        if (cacheRes.rows.length > 0 && cacheRes.rows[0].events_data) {
          const eventsData = cacheRes.rows[0].events_data;
          const postedEvents = Array.isArray(eventsData) ? eventsData : (eventsData.postedEvents || []);
          const nowUnix = Math.floor(Date.now() / 1000);
          const upcoming = postedEvents
            .filter(e => e.startTime && e.startTime > nowUnix)
            .sort((a, b) => a.startTime - b.startTime);
          if (upcoming.length > 0) {
            resolvedEventId = String(upcoming[0].id);
          }
        }
      } catch (_) {
        // events_cache may not exist or be empty — non-critical
      }
    }

    if (resolvedEventId) {
      try {
        const rlRes = await pool.query(
          `SELECT raidleader_name FROM event_metadata WHERE event_id = $1`,
          [resolvedEventId]
        );
        if (rlRes.rows.length > 0 && rlRes.rows[0].raidleader_name) {
          raidleaderName = rlRes.rows[0].raidleader_name;
        }
      } catch (_) {
        // event_metadata may not exist for this event — non-critical
      }
    }
    vars.set('raidleader_name', raidleaderName);

    // Resolve {{next_upcoming_raid}} — next future event from Raid-Helper cache
    let nextRaid = 'No upcoming raids scheduled';
    try {
      const cacheRes = await pool.query(
        `SELECT events_data FROM events_cache WHERE cache_key = 'raid_helper_events'`
      );
      if (cacheRes.rows.length > 0 && cacheRes.rows[0].events_data) {
        const eventsData = cacheRes.rows[0].events_data;
        const postedEvents = Array.isArray(eventsData) ? eventsData : (eventsData.postedEvents || []);
        const nowUnix = Math.floor(Date.now() / 1000);
        const upcoming = postedEvents
          .filter(e => e.startTime && e.startTime > nowUnix)
          .sort((a, b) => a.startTime - b.startTime);
        if (upcoming.length > 0) {
          const evt = upcoming[0];
          // Use title as-is (e.g. "Nax | Thursday | 20:30") — already contains day + time
          // Replace " | " separators with spaces for cleaner LLM output
          const rawTitle = evt.title || evt.channelName || 'Raid';
          nextRaid = rawTitle.replace(/\s*\|\s*/g, ' ').trim();
        }
      }
    } catch (_) {
      // events_cache may not exist — non-critical
    }
    vars.set('next_upcoming_raid', nextRaid);

    // --- New variables: class_name and tonight_raid ---
    // class_name: for non-outreach, try players.class; for outreach, overridden below
    if (!vars.has('class_name')) {
      try {
        const classRes = await pool.query(
          `SELECT class FROM players WHERE discord_id = $1 LIMIT 1`, [discordId]
        );
        vars.set('class_name', classRes.rows.length > 0 && classRes.rows[0].class
          ? classRes.rows[0].class : 'unknown');
      } catch (_) {
        vars.set('class_name', 'unknown');
      }
    }
    // tonight_raid: default to next_upcoming_raid; outreach overrides below
    if (!vars.has('tonight_raid')) {
      vars.set('tonight_raid', nextRaid);
    }

    // --- Outreach-specific overrides ---
    // When the conversation is a candidate_outreach, prefer the stored candidate context columns
    // over the generic resolved values. This ensures outreach DMs reference the specific character
    // being recruited rather than a generic "last raid" lookup.
    if (isOutreach && convRowForOutreach) {
      if (convRowForOutreach.candidate_char_name) {
        vars.set('character_name', convRowForOutreach.candidate_char_name);
      }
      if (convRowForOutreach.candidate_class) {
        vars.set('class_name', convRowForOutreach.candidate_class);
      }
      if (convRowForOutreach.candidate_last_raid_name) {
        vars.set('last_raid_name', convRowForOutreach.candidate_last_raid_name);
        vars.set('raid_name', convRowForOutreach.candidate_last_raid_name);
      }
      if (convRowForOutreach.candidate_last_raid_date) {
        // Raw ISO date
        vars.set('last_raid_date', convRowForOutreach.candidate_last_raid_date);
        // Human-readable: "7 Mar 2026"
        try {
          const d = new Date(convRowForOutreach.candidate_last_raid_date);
          const formatted = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          vars.set('last_raid_date_formatted', formatted);
        } catch (_) {
          vars.set('last_raid_date_formatted', convRowForOutreach.candidate_last_raid_date);
        }
        // is_regular: raided within last 14 days
        const daysSince = (Date.now() - new Date(convRowForOutreach.candidate_last_raid_date).getTime()) / (1000 * 60 * 60 * 24);
        vars.set('is_regular', daysSince <= 14 ? 'yes' : 'no');
      } else {
        vars.set('is_regular', 'no');
      }
      if (convRowForOutreach.tonight_raid_title) {
        vars.set('tonight_raid', convRowForOutreach.tonight_raid_title);
      }

      // candidate_chars_list: "Dreaktwo and Naldi (both Druids)" or "Dreaktwo (Druid)"
      try {
        let chars = convRowForOutreach.candidate_chars;
        if (typeof chars === 'string') chars = JSON.parse(chars);
        if (Array.isArray(chars) && chars.length > 0) {
          // Group by class
          const byClass = {};
          for (const c of chars) {
            const cls = c.class ? (c.class.charAt(0).toUpperCase() + c.class.slice(1)) : 'Unknown';
            if (!byClass[cls]) byClass[cls] = [];
            byClass[cls].push(c.name);
          }
          const parts = Object.entries(byClass).map(([cls, names]) => {
            if (names.length === 1) return `${names[0]} (${cls})`;
            return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} (both ${cls}s)`;
          });
          vars.set('candidate_chars_list', parts.join(', or '));
          // Also keep single-char vars for simpler templates
          vars.set('character_name', chars[0].name || vars.get('character_name'));
          vars.set('class_name', chars[0].class ? (chars[0].class.charAt(0).toUpperCase() + chars[0].class.slice(1)) : vars.get('class_name'));
        }
      } catch (_) {}

      // last_raid_relative: "3 weeks ago" / "last week" / "2 weeks ago" (only if >21 days)
      if (convRowForOutreach.candidate_last_raid_date) {
        const daysSince = (Date.now() - new Date(convRowForOutreach.candidate_last_raid_date).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince > 21) {
          const weeksAgo = Math.floor(daysSince / 7);
          const d = new Date(convRowForOutreach.candidate_last_raid_date);
          const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
          const relStr = weeksAgo === 1 ? 'last week' : `${weeksAgo} weeks ago`;
          vars.set('last_raid_relative', `${dayName}, ${relStr}`);
          vars.set('mention_last_raid', 'yes');
        } else {
          vars.set('last_raid_relative', '');
          vars.set('mention_last_raid', 'no');
        }
      }

      // raid_start_time: fetch from raid_helper_events_cache for this event
      if (convRowForOutreach.event_id || (conversationId && convRowForOutreach)) {
        try {
          const evId = convRowForOutreach.event_id;
          if (evId) {
            const rhRow = await pool.query(
              `SELECT event_data FROM raid_helper_events_cache WHERE event_id = $1 LIMIT 1`,
              [String(evId)]
            );
            if (rhRow.rows.length > 0 && rhRow.rows[0].event_data && rhRow.rows[0].event_data.startTime) {
              const st = new Date(parseInt(rhRow.rows[0].event_data.startTime));
              const formatted = st.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' });
              vars.set('raid_start_time', formatted + ' CET');
            }
          }
        } catch (_) {}
      }

      // Discord username from discord_users table (not players — players has no discord_username col)
      try {
        const duRow = await pool.query(
          `SELECT username FROM discord_users WHERE discord_id = $1 LIMIT 1`,
          [discordId]
        );
        if (duRow.rows.length > 0 && duRow.rows[0].username) {
          vars.set('discord_username', duRow.rows[0].username);
        }
      } catch (_) {}
    }

    // Pre-raid briefing character data from bot_conversations
    if (conversationId) {
      try {
        const convDataRes = await pool.query(
          `SELECT player_name, character_class, event_id FROM bot_conversations WHERE id = $1`,
          [conversationId]
        );
        if (convDataRes.rows.length > 0) {
          const convRow = convDataRes.rows[0];
          vars.set('pre_raid_character_name', convRow.player_name || characterName || 'unknown');
          vars.set('pre_raid_character_class', convRow.character_class || 'unknown');
        } else {
          vars.set('pre_raid_character_name', characterName || 'unknown');
          vars.set('pre_raid_character_class', 'unknown');
        }
      } catch (convErr) {
        console.error('[persona-context] Error reading conversation character data:', convErr.message);
        vars.set('pre_raid_character_name', characterName || 'unknown');
        vars.set('pre_raid_character_class', 'unknown');
      }
    } else {
      vars.set('pre_raid_character_name', 'unknown');
      vars.set('pre_raid_character_class', 'unknown');
    }

  } catch (err) {
    console.error('[persona-context] Error resolving template variables:', err.message || err);
    // Set safe defaults for any missing variables
    const defaults = {
      character_name: 'unknown', discord_name: 'unknown', player_name: 'unknown',
      guild_name: '1Principles',
      total_gold_earned: '0', gold_earned_last_raid: '0', gold_spent_last_raid: '0',
      manual_rewards_last_raid: '0', manual_deductions_last_raid: '0',
      last_raid_name: 'unknown', total_raids_attended: '0', items_won_last_raid: '0',
      guild_join_date: 'Not in 1Principles Guild', last_raid_date: 'unknown',
      raid_name: 'unknown', gold_earned: '0', items_won: '0', raids_attended: '0',
      raidleader_name: 'TBD', next_upcoming_raid: 'No upcoming raids scheduled',
      pre_raid_character_name: 'unknown', pre_raid_character_class: 'unknown',
      class_name: 'unknown', tonight_raid: 'No upcoming raids scheduled'
    };
    for (const [key, val] of Object.entries(defaults)) {
      if (!vars.has(key)) vars.set(key, val);
    }
  }

  return vars;
}

/**
 * Applies template variable substitution to a text string.
 * Performs a single-pass regex replacement of all {{variable_name}} patterns.
 * Variables not found in the map are left as-is.
 *
 * @param {string} text - Template text with {{variable}} placeholders
 * @param {Map<string, string>} variableMap - Variable name → resolved value
 * @returns {string} Text with variables replaced
 */
function applyTemplateVariables(text, variableMap) {
  if (!text || !variableMap || variableMap.size === 0) return text || '';
  return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return variableMap.has(varName) ? variableMap.get(varName) : match;
  });
}

module.exports = {
  buildPlayerContext,
  buildVoiceContext,
  resolvePlayerName,
  resolveTemplateVariables,
  applyTemplateVariables
};
