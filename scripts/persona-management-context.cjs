/**
 * Persona Management Context Module
 *
 * Provides on-demand raid intelligence for Maya's management channel.
 * Detects which context modules are needed based on message keywords,
 * resolves the relevant event ID, and fetches data from the DB and
 * Raid Helper API in parallel.
 *
 * Exports:
 *  - detectContextNeeds(messageContent)
 *  - resolveEventFromMessage(pool, messageContent)
 *  - fetchManagementContext(pool, needs, messageContent, eventId)
 *
 * @module persona-management-context
 */

const CACHE_TTL_MS = 300000; // 5 minutes

/** @type {Map<string, { data: string, fetchedAt: number }>} */
const contextCache = new Map();

/**
 * Retrieves a cached value if it exists and has not expired.
 *
 * @param {string} key - Cache key in the format "moduleName:eventId"
 * @returns {string|null} Cached data string or null if miss/expired
 */
function cacheGet(key) {
  const entry = contextCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    contextCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Stores a value in the TTL cache.
 *
 * @param {string} key - Cache key
 * @param {string} data - Data string to cache
 */
function cacheSet(key, data) {
  contextCache.set(key, { data, fetchedAt: Date.now() });
}

// ---------------------------------------------------------------------------
// Keyword Detection
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ContextNeeds
 * @property {boolean} raidList
 * @property {boolean} signups
 * @property {boolean} roster
 * @property {boolean} assignments
 * @property {boolean} logs
 * @property {boolean} gold
 * @property {boolean} playerProfile
 * @property {boolean} worldBuffs
 * @property {boolean} playerNotes
 */

/**
 * Word-boundary-aware keyword matcher. Checks whether any keyword from the
 * list appears as a whole word (or phrase) in the text.
 *
 * @param {string} text - Lowercased message text
 * @param {string[]} keywords - Array of lowercase keywords/phrases
 * @returns {boolean}
 */
function matchesKeyword(text, keywords) {
  for (const kw of keywords) {
    // Build a regex with word boundaries for single words,
    // or looser matching for multi-word phrases
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Scans a message for trigger keywords and returns flags indicating which
 * context modules are needed.
 *
 * @param {string} messageContent - Raw message text
 * @returns {ContextNeeds}
 */
function detectContextNeeds(messageContent) {
  const text = messageContent.toLowerCase();

  return {
    raidList: matchesKeyword(text, [
      'raid', 'naxx', 'nax', 'karazhan', 'kara', 'tonight', 'friday',
      'thursday', 'saturday', 'sunday', 'monday', 'tuesday', 'wednesday',
      'this week', 'schedule', 'next raid', 'upcoming'
    ]),
    signups: matchesKeyword(text, [
      'signed up', 'signup', 'signups', 'sign-up', 'sign-ups',
      'who signed', 'applicants', 'bench', 'attendance', 'applying',
      'tentative', 'confirmed', 'absent'
    ]),
    roster: matchesKeyword(text, [
      'roster', 'group', 'assigned', 'group 1', 'group 2', 'group 3',
      'group 4', 'group 5', 'group 6', 'group 7', 'group 8',
      'tank group', 'healer', 'melee', 'ranged', 'caster'
    ]),
    assignments: matchesKeyword(text, [
      'assignment', 'assignments', 'debuff', 'debuffs', 'decurse',
      'interrupt', 'interrupts', 'mark', 'marks', 'pi', 'innervate',
      'focus', 'power infusion', 'target', 'targets'
    ]),
    logs: matchesKeyword(text, [
      'dps', 'hps', 'parse', 'logs', 'performance', 'damage',
      'healing', 'warcraft logs', 'wcl'
    ]),
    gold: matchesKeyword(text, [
      'gold', 'cut', 'earned', 'loot', 'item', 'bought', 'spent',
      'gdkp', 'pot', 'payout'
    ]),
    playerProfile: matchesKeyword(text, [
      'alt', 'alts', 'alternative', 'replace', 'replacement',
      'character', 'characters', 'registered', 'who is', 'class',
      'spec', 'main'
    ]),
    worldBuffs: matchesKeyword(text, [
      'world buff', 'world buffs', 'wcb', 'dmf', 'ony head', 'zg',
      'songflower', 'darkmoon'
    ]),
    playerNotes: matchesKeyword(text, [
      'problem', 'problems', 'issue', 'issues', 'banned', 'blacklist',
      'blacklisted', 'warned', 'note', 'notes', 'flagged'
    ]),
    historicalAttendance: matchesKeyword(text, [
      'last month', 'last 3 months', 'last week', 'past month', 'past raids',
      'historically', 'attended before', 'have attended', 'has attended',
      'all priests', 'all warriors', 'all mages', 'all druids', 'all shamans',
      'all rogues', 'all warlocks', 'all hunters', 'all paladins',
      'priests that', 'warriors that', 'mages that', 'druids that',
      'joined us', 'raided with us', 'been in', 'months ago', 'weeks ago'
    ])
  };
}

// ---------------------------------------------------------------------------
// Event Resolution
// ---------------------------------------------------------------------------

/** Day-name to JS getDay() index */
const DAY_MAP = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6
};

/**
 * Parses upcoming events from the events_cache table.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{id: string, channelName: string|null, startTime: number}>>}
 */
async function getUpcomingEventsFromCache(pool) {
  const result = await pool.query(
    `SELECT events_data FROM events_cache WHERE cache_key = 'raid_helper_events' AND expires_at > NOW()`
  );
  if (result.rows.length === 0) return [];

  const events = result.rows[0].events_data;
  const parsed = typeof events === 'string' ? JSON.parse(events) : events;
  if (!Array.isArray(parsed)) return [];

  const now = Math.floor(Date.now() / 1000);
  return parsed
    .filter(e => e.startTime && parseInt(e.startTime, 10) > now)
    .sort((a, b) => parseInt(a.startTime, 10) - parseInt(b.startTime, 10));
}

/**
 * Resolves the most relevant event ID from the user's message.
 * Strategy: title match > "tonight"/"next raid" > day name > soonest upcoming.
 * Also supports "last raid" to find the most recent past event.
 *
 * @param {import('pg').Pool} pool
 * @param {string} messageContent
 * @returns {Promise<string|null>} Event ID or null
 */
async function resolveEventFromMessage(pool, messageContent) {
  const text = messageContent.toLowerCase();

  // Fetch all events (upcoming + past) from cache
  const cacheResult = await pool.query(
    `SELECT events_data FROM events_cache WHERE cache_key = 'raid_helper_events' AND expires_at > NOW()`
  );
  if (cacheResult.rows.length === 0) return null;

  const rawEvents = cacheResult.rows[0].events_data;
  const allEvents = typeof rawEvents === 'string' ? JSON.parse(rawEvents) : rawEvents;
  if (!Array.isArray(allEvents) || allEvents.length === 0) return null;

  const now = Math.floor(Date.now() / 1000);
  const upcoming = allEvents
    .filter(e => e.startTime && parseInt(e.startTime, 10) > now)
    .sort((a, b) => parseInt(a.startTime, 10) - parseInt(b.startTime, 10));

  // 1. Match by event title / channelName mentioned in the message
  for (const ev of upcoming) {
    const title = (ev.channelName || ev.title || '').toLowerCase();
    if (title && title.length > 2 && text.includes(title)) {
      return String(ev.id);
    }
  }

  // 2. "last raid" or "last [day]" — most recent past event from roster_overrides
  const lastDayMatch = text.match(/\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|raid)\b/i);
  if (lastDayMatch) {
    const dayName = lastDayMatch[1].toLowerCase();
    let pastQuery, pastParams;
    if (DAY_MAP[dayName] !== undefined) {
      // "last Thursday" → most recent past event on that day with a real roster (≥10 players)
      pastQuery = `
        SELECT event_id, COUNT(*) as player_count
        FROM roster_overrides
        WHERE EXTRACT(DOW FROM to_timestamp(((event_id::bigint >> 22) + 1420070400000) / 1000.0)) = $1
          AND to_timestamp(((event_id::bigint >> 22) + 1420070400000) / 1000.0) < NOW()
        GROUP BY event_id
        HAVING COUNT(*) >= 10
        ORDER BY event_id DESC LIMIT 1`;
      pastParams = [DAY_MAP[dayName]];
    } else {
      // "last week" or "last raid" → most recent event in roster_overrides with a real roster
      pastQuery = `
        SELECT event_id, COUNT(*) as player_count
        FROM roster_overrides
        GROUP BY event_id
        HAVING COUNT(*) >= 10
        ORDER BY event_id DESC LIMIT 1`;
      pastParams = [];
    }
    try {
      const pastRes = await pool.query(pastQuery, pastParams);
      if (pastRes.rows.length > 0) return String(pastRes.rows[0].event_id);
    } catch (_) {}
    // Also try events_cache past events
    const past = allEvents
      .filter(e => e.startTime && parseInt(e.startTime, 10) <= now)
      .sort((a, b) => parseInt(b.startTime, 10) - parseInt(a.startTime, 10));
    if (past.length > 0) return String(past[0].id);
  }

  // 3. "tonight" or "next raid" — soonest upcoming
  if (/\btonight\b/i.test(text) || /\bnext\s+raid\b/i.test(text)) {
    if (upcoming.length > 0) return String(upcoming[0].id);
  }

  // 4. Day name — next event on that day
  for (const [dayName, dayIndex] of Object.entries(DAY_MAP)) {
    if (matchesKeyword(text, [dayName])) {
      const match = upcoming.find(ev => {
        const d = new Date(parseInt(ev.startTime, 10) * 1000);
        return d.getDay() === dayIndex;
      });
      if (match) return String(match.id);
    }
  }

  // 5. Fallback — soonest upcoming event
  if (upcoming.length > 0) return String(upcoming[0].id);

  return null;
}

// ---------------------------------------------------------------------------
// Individual Context Fetchers
// ---------------------------------------------------------------------------

/**
 * Fetches upcoming raid list from events_cache.
 * Format: [id] Title - Day, Date at Time (Raidleader: Name)
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
async function fetchRaidList(pool) {
  const cacheKey = 'raidList:all';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const upcoming = await getUpcomingEventsFromCache(pool);
    if (upcoming.length === 0) return '';

    // Fetch raidleader names for these events
    const eventIds = upcoming.map(e => String(e.id));
    let leaderMap = {};
    try {
      const leaderRes = await pool.query(
        `SELECT event_id, raidleader_name FROM event_metadata WHERE event_id = ANY($1)`,
        [eventIds]
      );
      for (const row of leaderRes.rows) {
        leaderMap[row.event_id] = row.raidleader_name;
      }
    } catch (_) { /* event_metadata may not exist */ }

    const lines = upcoming.slice(0, 15).map(ev => {
      const d = new Date(parseInt(ev.startTime, 10) * 1000);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Europe/Copenhagen' });
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Copenhagen' });
      const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' });
      const title = ev.channelName || ev.title || `Event ${ev.id}`;
      const leader = leaderMap[String(ev.id)];
      const leaderStr = leader ? ` (RL: ${leader})` : '';
      return `[${ev.id}] ${title} - ${dayName} ${dateStr} ${timeStr}${leaderStr}`;
    });

    const result = `=== UPCOMING RAIDS ===\n${lines.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchRaidList error:', err.message);
    return '';
  }
}

/**
 * Fetches sign-up data from Raid Helper v2 API for a specific event.
 * Groups by class with status counts.
 *
 * @param {string} eventId
 * @returns {Promise<string>}
 */
async function fetchSignups(eventId) {
  if (!eventId) return '';
  const cacheKey = `signups:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const apiKey = process.env.RAID_HELPER_API_KEY;
    if (!apiKey) return '';

    const response = await fetch(`https://raid-helper.dev/api/v2/events/${eventId}`, {
      headers: {
        'Authorization': apiKey,
        'User-Agent': 'ClassicWoWManagerApp/1.0.0 (Node.js)'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) return '';
    const data = await response.json();
    const signUps = data.signUps || [];
    if (signUps.length === 0) return `=== SIGN-UPS (Event ${eventId}) ===\nNo sign-ups found.`;

    // Group by class
    const byClass = {};
    let confirmed = 0, tentative = 0, absent = 0;

    for (const s of signUps) {
      const cls = s.className || 'Unknown';
      if (!byClass[cls]) byClass[cls] = [];

      const status = (s.status || 'unknown').toLowerCase();
      if (status === 'confirmed' || status === 'primary') confirmed++;
      else if (status === 'tentative' || status === 'secondary') tentative++;
      else if (status === 'absent') absent++;

      byClass[cls].push(`${s.name || 'Unknown'}(${(s.specName || '?').slice(0, 4)}/${status})`);
    }

    const lines = Object.entries(byClass)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([cls, players]) => `${cls}(${players.length}): ${players.join(', ')}`);

    const title = data.channelName || data.title || `Event ${eventId}`;
    const result = `=== SIGN-UPS: ${title} ===\n${lines.join('\n')}\nTotal: ${confirmed} confirmed, ${tentative} tentative, ${absent} absent (${signUps.length} total)`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchSignups error:', err.message);
    return '';
  }
}

/**
 * Fetches roster data from roster_overrides for a specific event.
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @returns {Promise<string>}
 */
async function fetchRoster(pool, eventId) {
  if (!eventId) return '';
  const cacheKey = `roster:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await pool.query(
      `SELECT party_id, slot_id, assigned_char_name, assigned_char_class,
              assigned_char_spec, in_raid, is_placeholder
       FROM roster_overrides
       WHERE event_id = $1
       ORDER BY party_id, slot_id`,
      [eventId]
    );

    if (res.rows.length === 0) return '';

    // Group by party
    const groups = {};
    for (const row of res.rows) {
      const gid = row.party_id || 0;
      if (!groups[gid]) groups[gid] = [];
      const raidStatus = row.in_raid ? '' : ' [bench]';
      const placeholder = row.is_placeholder ? ' [placeholder]' : '';
      groups[gid].push(
        `${row.assigned_char_name}(${row.assigned_char_class || '?'}/${(row.assigned_char_spec || '?').slice(0, 4)})${raidStatus}${placeholder}`
      );
    }

    const lines = Object.entries(groups)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([gid, players]) => `Group ${gid}: ${players.join(', ')}`);

    const result = `=== ROSTER (Event ${eventId}) ===\n${lines.join('\n')}\nTotal rostered: ${res.rows.length}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchRoster error:', err.message);
    return '';
  }
}

/**
 * Fetches raid assignments grouped by boss.
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @returns {Promise<string>}
 */
async function fetchAssignments(pool, eventId) {
  if (!eventId) return '';
  const cacheKey = `assignments:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await pool.query(
      `SELECT boss, character_name, class_name, spec_name, assignment
       FROM raid_assignment_entries
       WHERE event_id = $1
       ORDER BY boss, sort_index`,
      [eventId]
    );

    if (res.rows.length === 0) return '';

    const byBoss = {};
    for (const row of res.rows) {
      const boss = row.boss || 'General';
      if (!byBoss[boss]) byBoss[boss] = [];
      byBoss[boss].push(
        `${row.character_name}(${row.class_name || '?'}) - ${row.assignment || 'unassigned'}`
      );
    }

    const lines = Object.entries(byBoss)
      .map(([boss, entries]) => `${boss}: ${entries.join('; ')}`);

    const result = `=== ASSIGNMENTS (Event ${eventId}) ===\n${lines.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchAssignments error:', err.message);
    return '';
  }
}

/**
 * Fetches top-10 DPS and top-10 HPS from log_data for a specific event.
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @returns {Promise<string>}
 */
async function fetchLogData(pool, eventId) {
  if (!eventId) return '';
  const cacheKey = `logs:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const [dpsRes, hpsRes] = await Promise.all([
      pool.query(
        `SELECT character_name, character_class,
           COALESCE(NULLIF(dps_value,0), damage_amount) as dps_val
         FROM log_data WHERE event_id = $1
           AND (dps_value > 0 OR damage_amount > 0)
         ORDER BY COALESCE(NULLIF(dps_value,0), damage_amount) DESC LIMIT 10`,
        [eventId]
      ),
      pool.query(
        `SELECT character_name, character_class, role_detected,
           COALESCE(NULLIF(hps_value,0), healing_amount) as hps_val
         FROM log_data WHERE event_id = $1
           AND (hps_value > 0 OR healing_amount > 0)
           AND (role_detected = 'healer' OR (hps_value > 0 OR healing_amount > 100000))
         ORDER BY COALESCE(NULLIF(hps_value,0), healing_amount) DESC LIMIT 10`,
        [eventId]
      )
    ]);

    if (dpsRes.rows.length === 0 && hpsRes.rows.length === 0) return '';

    const parts = [];
    if (dpsRes.rows.length > 0) {
      const dpsLines = dpsRes.rows.map((r, i) =>
        `${i + 1}. ${r.character_name}(${r.character_class || '?'}) ${Math.round(r.dps_val).toLocaleString()}`
      );
      parts.push(`Top DPS:\n${dpsLines.join('\n')}`);
    }
    if (hpsRes.rows.length > 0) {
      const hpsLines = hpsRes.rows.map((r, i) =>
        `${i + 1}. ${r.character_name}(${r.character_class || '?'}) ${Math.round(r.hps_val).toLocaleString()} HPS`
      );
      parts.push(`Top HPS:\n${hpsLines.join('\n')}`);
    }

    const result = `=== PERFORMANCE (Event ${eventId}) ===\n${parts.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchLogData error:', err.message);
    return '';
  }
}

/**
 * Fetches gold/loot data for a specific event (published snapshots only).
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @returns {Promise<string>}
 */
async function fetchGoldLoot(pool, eventId) {
  if (!eventId) return '';
  const cacheKey = `gold:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Check if event snapshot is published
    const pubRes = await pool.query(
      `SELECT published FROM rewards_snapshot_events WHERE event_id = $1`,
      [eventId]
    );
    if (pubRes.rows.length === 0 || !pubRes.rows[0].published) {
      return `=== GOLD/LOOT (Event ${eventId}) ===\nSnapshot not published yet.`;
    }

    const [goldRes, lootRes] = await Promise.all([
      pool.query(
        `SELECT character_name, character_class,
                COALESCE(point_value_edited, point_value_original) as gold
         FROM rewards_and_deductions_points
         WHERE event_id = $1
         ORDER BY COALESCE(point_value_edited, point_value_original) DESC
         LIMIT 20`,
        [eventId]
      ),
      pool.query(
        `SELECT item_name, player_name, gold_amount
         FROM loot_items
         WHERE event_id = $1
         ORDER BY gold_amount DESC
         LIMIT 15`,
        [eventId]
      )
    ]);

    const parts = [];
    if (goldRes.rows.length > 0) {
      const totalGold = goldRes.rows.reduce((sum, r) => sum + (Number(r.gold) || 0), 0);
      const goldLines = goldRes.rows
        .filter(r => Number(r.gold) !== 0)
        .slice(0, 15)
        .map(r => `${r.character_name}(${r.character_class || '?'}): ${r.gold}g`);
      parts.push(`Gold earned (top 15):\n${goldLines.join('\n')}\nTotal pot: ${totalGold}g`);
    }
    if (lootRes.rows.length > 0) {
      const lootLines = lootRes.rows.map(r =>
        `${r.item_name} -> ${r.player_name} (${r.gold_amount || 0}g)`
      );
      parts.push(`Items won:\n${lootLines.join('\n')}`);
    }

    // Fetch external links from rewards_snapshot_events
    try {
      const linksRes = await pool.query(
        `SELECT wow_logs_url, rpb_archive_url FROM rewards_snapshot_events WHERE event_id = $1`,
        [eventId]
      );
      if (linksRes.rows.length > 0) {
        const linkLines = [];
        if (linksRes.rows[0].wow_logs_url) linkLines.push(`WoW Logs: ${linksRes.rows[0].wow_logs_url}`);
        if (linksRes.rows[0].rpb_archive_url) linkLines.push(`RPB Archive: ${linksRes.rows[0].rpb_archive_url}`);
        if (linkLines.length > 0) parts.push(`Links:\n${linkLines.join('\n')}`);
      }
    } catch (_) {}

    const result = parts.length > 0
      ? `=== GOLD/LOOT (Event ${eventId}) ===\n${parts.join('\n')}`
      : '';
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchGoldLoot error:', err.message);
    return '';
  }
}

/**
 * Fetches all known characters for given Discord IDs.
 *
 * @param {import('pg').Pool} pool
 * @param {string[]} discordIds - Array of Discord snowflake IDs
 * @returns {Promise<string>}
 */
async function fetchPlayerAlts(pool, discordIds) {
  if (!discordIds || discordIds.length === 0) return '';
  const cacheKey = `alts:${discordIds.sort().join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const [registeredRes, rosteredRes] = await Promise.all([
      pool.query(
        `SELECT discord_id, character_name, class FROM players WHERE discord_id = ANY($1)`,
        [discordIds]
      ),
      pool.query(
        `SELECT DISTINCT discord_user_id, assigned_char_name, assigned_char_class
         FROM roster_overrides
         WHERE discord_user_id = ANY($1)`,
        [discordIds]
      )
    ]);

    // Merge per discord_id
    const byPlayer = {};
    for (const row of registeredRes.rows) {
      if (!byPlayer[row.discord_id]) byPlayer[row.discord_id] = new Map();
      byPlayer[row.discord_id].set(row.character_name.toLowerCase(), {
        name: row.character_name,
        cls: row.class || '?'
      });
    }
    for (const row of rosteredRes.rows) {
      const did = row.discord_user_id;
      if (!byPlayer[did]) byPlayer[did] = new Map();
      const key = (row.assigned_char_name || '').toLowerCase();
      if (key && !byPlayer[did].has(key)) {
        byPlayer[did].set(key, {
          name: row.assigned_char_name,
          cls: row.assigned_char_class || '?'
        });
      }
    }

    const lines = Object.entries(byPlayer).map(([, chars]) => {
      const charList = [...chars.values()].map(c => `${c.name}(${c.cls})`).join(', ');
      return charList;
    });

    if (lines.length === 0) return '';
    const result = `=== PLAYER CHARACTERS ===\n${lines.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchPlayerAlts error:', err.message);
    return '';
  }
}

/**
 * Fetches world buff data for a specific event.
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @returns {Promise<string>}
 */
async function fetchWorldBuffs(pool, eventId) {
  if (!eventId) return '';
  const cacheKey = `worldBuffs:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await pool.query(
      `SELECT character_name, buff_name, buff_value, color_status
       FROM sheet_players_buffs
       WHERE event_id = $1 AND analysis_type = 'world_buffs'
       ORDER BY character_name, buff_name`,
      [eventId]
    );

    if (res.rows.length === 0) return '';

    // Summarize: count per buff type, list missing
    const buffCounts = {};
    const playerBuffs = {};
    for (const row of res.rows) {
      const buff = row.buff_name;
      if (!buffCounts[buff]) buffCounts[buff] = { have: 0, missing: 0 };
      if (!playerBuffs[row.character_name]) playerBuffs[row.character_name] = [];

      const hasBuff = row.color_status !== 'red' && row.buff_value && row.buff_value !== '0';
      if (hasBuff) {
        buffCounts[buff].have++;
      } else {
        buffCounts[buff].missing++;
        playerBuffs[row.character_name].push(buff);
      }
    }

    const summaryLines = Object.entries(buffCounts)
      .map(([buff, counts]) => `${buff}: ${counts.have} have, ${counts.missing} missing`);

    const missingPlayers = Object.entries(playerBuffs)
      .filter(([, buffs]) => buffs.length > 0)
      .slice(0, 10)
      .map(([name, buffs]) => `${name}: missing ${buffs.join(', ')}`);

    let result = `=== WORLD BUFFS (Event ${eventId}) ===\n${summaryLines.join('\n')}`;
    if (missingPlayers.length > 0) {
      result += `\nMissing buffs (top 10):\n${missingPlayers.join('\n')}`;
    }

    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchWorldBuffs error:', err.message);
    return '';
  }
}

/**
 * Fetches player notes for given Discord IDs.
 *
 * @param {import('pg').Pool} pool
 * @param {string[]} discordIds
 * @returns {Promise<string>}
 */
async function fetchPlayerNotes(pool, discordIds) {
  if (!discordIds || discordIds.length === 0) return '';
  const cacheKey = `notes:${discordIds.sort().join(',')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await pool.query(
      `SELECT discord_id, note, created_at
       FROM bot_player_notes
       WHERE discord_id = ANY($1)
       ORDER BY created_at DESC
       LIMIT 20`,
      [discordIds]
    );

    if (res.rows.length === 0) return '';

    const byPlayer = {};
    for (const row of res.rows) {
      if (!byPlayer[row.discord_id]) byPlayer[row.discord_id] = [];
      const date = new Date(row.created_at).toISOString().split('T')[0];
      byPlayer[row.discord_id].push(`[${date}] ${row.note}`);
    }

    const lines = Object.entries(byPlayer)
      .map(([, notes]) => notes.slice(0, 5).join('\n'));

    const result = `=== PLAYER NOTES ===\n${lines.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchPlayerNotes error:', err.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

/**
 * Fetches all needed context modules in parallel and returns a combined
 * string for system prompt injection.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {ContextNeeds} needs - Flags from detectContextNeeds()
 * @param {string} messageContent - Original message text
 * @param {string|null} eventId - Resolved event ID (may be null)
 * @param {string[]} [discordIds] - Discord IDs of players mentioned in message
 * @returns {Promise<string>} Combined context string
 */
async function fetchManagementContext(pool, needs, messageContent, eventId, discordIds) {
  const fetchers = [];

  if (needs.raidList) {
    fetchers.push(fetchRaidList(pool));
  }
  if (needs.signups && eventId) {
    fetchers.push(fetchSignups(eventId));
  }
  if (needs.roster && eventId) {
    fetchers.push(fetchRoster(pool, eventId));
  }
  if (needs.assignments && eventId) {
    fetchers.push(fetchAssignments(pool, eventId));
  }
  if (needs.logs && eventId) {
    fetchers.push(fetchLogData(pool, eventId));
  }
  if (needs.gold && eventId) {
    fetchers.push(fetchGoldLoot(pool, eventId));
  }
  if (needs.playerProfile && discordIds && discordIds.length > 0) {
    fetchers.push(fetchPlayerAlts(pool, discordIds));
  }
  if (needs.worldBuffs && eventId) {
    fetchers.push(fetchWorldBuffs(pool, eventId));
  }
  if (needs.playerNotes && discordIds && discordIds.length > 0) {
    fetchers.push(fetchPlayerNotes(pool, discordIds));
  }
  if (needs.historicalAttendance) {
    fetchers.push(fetchHistoricalAttendance(pool, messageContent));
  }

  if (fetchers.length === 0) return '';

  const results = await Promise.all(fetchers);
  const combined = results.filter(r => r && r.length > 0).join('\n\n');
  return combined;
}

/**
 * Fetches historical raid attendance by class across recent raids.
 * Uses Discord snowflake timestamps to derive event dates without extra tables.
 *
 * @param {import('pg').Pool} pool
 * @param {string} messageContent - To extract class filter and time range
 * @returns {Promise<string>}
 */
async function fetchHistoricalAttendance(pool, messageContent) {
  const text = messageContent.toLowerCase();

  // Detect class filter
  const classMap = {
    priest: 'priest', priests: 'priest',
    warrior: 'warrior', warriors: 'warrior',
    mage: 'mage', mages: 'mage',
    druid: 'druid', druids: 'druid',
    shaman: 'shaman', shamans: 'shaman',
    rogue: 'rogue', rogues: 'rogue',
    warlock: 'warlock', warlocks: 'warlock',
    hunter: 'hunter', hunters: 'hunter',
    paladin: 'paladin', paladins: 'paladin',
  };
  let classFilter = null;
  for (const [word, cls] of Object.entries(classMap)) {
    if (text.includes(word)) { classFilter = cls; break; }
  }

  // Detect time range
  let months = 3;
  const m1 = text.match(/(\d+)\s*month/);
  const m2 = text.match(/(\d+)\s*week/);
  if (m1) months = Math.min(parseInt(m1[1], 10), 12);
  else if (m2) months = Math.max(1, Math.round(parseInt(m2[1], 10) / 4));

  const cacheKey = `historicalAttendance:${classFilter || 'all'}:${months}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Use Discord snowflake epoch to derive event date
    let query, params;
    if (classFilter) {
      query = `
        SELECT ro.assigned_char_name, ro.assigned_char_class,
          to_timestamp(((ro.event_id::bigint >> 22) + 1420070400000) / 1000.0)::date as raid_date
        FROM roster_overrides ro
        WHERE LOWER(ro.assigned_char_class) LIKE $1
          AND to_timestamp(((ro.event_id::bigint >> 22) + 1420070400000) / 1000.0) > NOW() - ($2 || ' months')::interval
        ORDER BY ro.assigned_char_name, raid_date DESC`;
      params = [`%${classFilter}%`, String(months)];
    } else {
      return '';
    }

    const res = await pool.query(query, params);
    if (res.rows.length === 0) return `**Historical Attendance (${classFilter}, last ${months} months):** No records found.`;

    // Group by character name, count raids
    const byPlayer = {};
    for (const row of res.rows) {
      const name = row.assigned_char_name;
      if (!byPlayer[name]) byPlayer[name] = { cls: row.assigned_char_class, dates: [] };
      byPlayer[name].dates.push(row.raid_date);
    }

    const lines = Object.entries(byPlayer)
      .sort((a, b) => b[1].dates.length - a[1].dates.length)
      .map(([name, d]) => `- ${name} (${d.cls}): ${d.dates.length} raid${d.dates.length !== 1 ? 's' : ''}, last: ${d.dates[0]}`);

    const result = `**Historical Attendance - ${classFilter.charAt(0).toUpperCase() + classFilter.slice(1)}s (last ${months} months, ${Object.keys(byPlayer).length} unique players, ${res.rows.length} appearances):**\n${lines.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-management-context] fetchHistoricalAttendance error:', err.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Tool-Use: Anthropic Tool Definitions
// ---------------------------------------------------------------------------

/**
 * Anthropic tool definitions for the management channel tool-use flow.
 * Each tool has a name, description, and input_schema conforming to the
 * Anthropic Messages API tools parameter format.
 *
 * @type {Array<{name: string, description: string, input_schema: object}>}
 */
const MANAGEMENT_TOOLS = [
  {
    name: 'get_roster',
    description: 'Get the raid roster for a specific event. Returns players grouped by party with class, spec, and bench status.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_logs',
    description: 'Get top DPS and HPS performance data from Warcraft Logs for a specific event.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_gold',
    description: 'Get gold earnings, GDKP pot, and loot items won from published snapshots for a specific event.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_signups',
    description: 'Get Raid Helper sign-up data for a specific event. Returns players grouped by class with status (confirmed/tentative/absent).',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_assignments',
    description: 'Get raid assignments grouped by boss for a specific event. Includes debuff assignments, interrupts, marks, etc.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_player_data',
    description: 'Get comprehensive player profile including alts, conversation stats, notes, and recent conversations. Accepts character name, Discord username, or Discord ID.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Character name, Discord username, or Discord snowflake ID' }
      },
      required: ['identifier']
    }
  },
  {
    name: 'get_historical_attendance',
    description: 'Get historical raid attendance stats for a specific WoW class over time. Shows unique players and their raid count.',
    input_schema: {
      type: 'object',
      properties: {
        class: { type: 'string', description: 'Lowercase WoW class name (priest, warrior, mage, druid, shaman, rogue, warlock, hunter, paladin)' },
        months: { type: 'number', description: 'Number of months to look back (default: 3, max: 12)' }
      },
      required: ['class']
    }
  },
  {
    name: 'get_player_notes',
    description: 'Get bot notes and management notes for a specific player. Accepts character name, Discord username, or Discord ID.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Character name, Discord username, or Discord snowflake ID' }
      },
      required: ['identifier']
    }
  },
  {
    name: 'get_world_buffs',
    description: 'Get world buff status for a specific event. Shows which players have or are missing buffs.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_cross_raid_stats',
    description: 'Find top performers across multiple raids in a time window. Use for questions like "who did the most healing in a single raid in Feb", "best DPS across all raids last month", etc. Returns top N players by damage or healing across a date range.',
    input_schema: {
      type: 'object',
      properties: {
        stat: { type: 'string', enum: ['damage', 'healing'], description: 'Whether to rank by damage or healing' },
        months: { type: 'number', description: 'How many months back to search (default 1)' },
        limit: { type: 'number', description: 'Number of top results to return (default 5)' }
      },
      required: ['stat']
    }
  },
  {
    name: 'get_event_overview',
    description: 'Get a comprehensive overview of a specific raid event including roster size, gold pot, boss kills, duration, links, loot summary, and briefing count.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_fight_breakdown',
    description: 'Get a boss-by-boss fight breakdown for a raid event. Shows kill times, wipe counts, and top 3 DPS/HPS per boss from WCL combat log analysis.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_deaths',
    description: 'Get death details for a raid event. Optionally filter by player name. Shows who died, to what ability, during which boss, and when.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The Discord event ID (snowflake) from the event list' },
        player_name: { type: 'string', description: 'Filter deaths to a specific player name (case-insensitive partial match)' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'get_item_history',
    description: 'Get cross-event price history for a loot item. Shows times sold, price range (high/low/avg), and recent buyers with dates. Use for questions about item pricing, how many times something has sold, or price trends.',
    input_schema: {
      type: 'object',
      properties: {
        item_name: { type: 'string', description: 'Full or partial item name (case-insensitive). E.g. "Gressil" or "Bindings of the Windseeker"' }
      },
      required: ['item_name']
    }
  },
  {
    name: 'get_player_loot_history',
    description: 'Get all items a player has bought across all raids, sorted by gold spent. Shows each item with price and event date, plus total gold spent. Use for questions about what someone has bought or how much they have spent.',
    input_schema: {
      type: 'object',
      properties: {
        player_name: { type: 'string', description: 'Full or partial player/character name (case-insensitive)' }
      },
      required: ['player_name']
    }
  }
];

/**
 * Public-tier tool definitions — a filtered copy of MANAGEMENT_TOOLS that
 * excludes tools which reveal private player notes or conversation history.
 *
 * NOTE: Any future tool that reads from bot_conversations or bot_messages
 * directly should also be excluded from this list.
 *
 * @type {Array<{name: string, description: string, input_schema: object}>}
 */
const PUBLIC_TOOLS = MANAGEMENT_TOOLS.filter(
  tool => tool.name !== 'get_player_notes'
);

/**
 * Additional system prompt instruction appended when Maya is responding
 * in a public (non-officer) Discord channel. Instructs the LLM to withhold
 * private player notes, screening info, and conversation history.
 *
 * @type {string}
 */
const PUBLIC_TIER_INSTRUCTION = `\n\nYou are in a public Discord channel. Do not reveal private player notes, screening information, or private conversation history. If asked for this type of information, politely explain that it is only available in the management channel. All other guild data (gold, loot, rosters, logs, attendance, item prices, fight breakdowns, deaths, world buffs) is fine to share.`;

// ---------------------------------------------------------------------------
// Tool-Use: Event Overview, Fight Breakdown, Deaths
// ---------------------------------------------------------------------------

/**
 * Fetches a comprehensive overview of a raid event.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} eventId - Event ID
 * @returns {Promise<string>} Formatted overview string
 */
async function fetchEventOverview(pool, eventId) {
  if (!eventId) return '';
  const cacheKey = `eventOverview:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Derive date from snowflake
    const tsMs = (BigInt(eventId) >> 22n) + 1420070400000n;
    const eventDate = new Date(Number(tsMs));
    const dateStr = eventDate.toISOString().split('T')[0];
    const dayName = eventDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

    // Fetch title from events_cache
    let title = 'Unknown Raid';
    try {
      const cacheResult = await pool.query(
        `SELECT events_data FROM events_cache WHERE cache_key = 'raid_helper_events'`
      );
      if (cacheResult.rows.length > 0) {
        const rawEvents = cacheResult.rows[0].events_data;
        const allEvents = typeof rawEvents === 'string' ? JSON.parse(rawEvents) : rawEvents;
        if (Array.isArray(allEvents)) {
          const match = allEvents.find(e => String(e.id) === String(eventId));
          if (match) title = match.channelName || match.title || title;
        }
      }
    } catch (_) {}

    // Parallel queries
    const [rosterRes, goldRes, wclRes, lootRes, briefingRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM roster_overrides WHERE event_id = $1`, [eventId]),
      pool.query(
        `SELECT published, total_gold_pot, shared_gold_pot, wow_logs_url, rpb_archive_url
         FROM rewards_snapshot_events WHERE event_id = $1`, [eventId]
      ),
      pool.query(`SELECT summary FROM wcl_event_summaries WHERE event_id = $1`, [eventId]),
      pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(gold_amount), 0)::bigint AS total_gold
         FROM loot_items WHERE event_id = $1`, [eventId]
      ),
      pool.query(`SELECT COUNT(*)::int AS count FROM bot_conversations WHERE event_id = $1`, [eventId])
    ]);

    const parts = [`=== EVENT OVERVIEW: ${title} ===`];
    parts.push(`Date: ${dayName} ${dateStr}`);
    parts.push(`Event ID: ${eventId}`);
    parts.push(`Roster: ${rosterRes.rows[0]?.count || 0} players`);

    // Gold info
    if (goldRes.rows.length > 0) {
      const g = goldRes.rows[0];
      parts.push(`Gold pot: ${g.total_gold_pot || 0}g total, ${g.shared_gold_pot || 0}g shared`);
      parts.push(`Published: ${g.published ? 'Yes' : 'No'}`);
      if (g.wow_logs_url) parts.push(`WoW Logs: ${g.wow_logs_url}`);
      if (g.rpb_archive_url) parts.push(`RPB Archive: ${g.rpb_archive_url}`);
    } else {
      parts.push('Gold: No snapshot available');
    }

    // WCL summary
    if (wclRes.rows.length > 0) {
      const summary = typeof wclRes.rows[0].summary === 'string'
        ? JSON.parse(wclRes.rows[0].summary) : wclRes.rows[0].summary;
      const durationMin = Math.floor((summary.total_duration_sec || 0) / 60);
      const durationSec = (summary.total_duration_sec || 0) % 60;
      parts.push(`Bosses killed: ${summary.bosses_killed || 0}`);
      parts.push(`Total wipes: ${summary.total_wipes || 0}`);
      parts.push(`Total deaths: ${summary.total_deaths || 0}`);
      parts.push(`Raid duration: ${durationMin}m ${durationSec}s`);
    }

    // Loot
    parts.push(`Loot items: ${lootRes.rows[0]?.count || 0} (${lootRes.rows[0]?.total_gold || 0}g total)`);

    // Briefings
    parts.push(`Briefings: ${briefingRes.rows[0]?.count || 0}`);

    const result = parts.join('\n');
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchEventOverview error:', err.message);
    return `Error fetching event overview: ${err.message}`;
  }
}

/**
 * Fetches a boss-by-boss fight breakdown for a raid event.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} eventId - Event ID
 * @returns {Promise<string>} Formatted fight breakdown string
 */
async function fetchFightBreakdown(pool, eventId) {
  if (!eventId) return '';
  const cacheKey = `fightBreakdown:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await pool.query(
      `SELECT summary FROM wcl_event_summaries WHERE event_id = $1`, [eventId]
    );
    if (res.rows.length === 0) {
      return 'Fight breakdown data is not yet available for this event. Summary generation may still be in progress.';
    }

    const summary = typeof res.rows[0].summary === 'string'
      ? JSON.parse(res.rows[0].summary) : res.rows[0].summary;
    const bosses = summary.bosses || [];

    if (bosses.length === 0) {
      return 'No boss encounters found in the combat log data for this event.';
    }

    const parts = ['=== FIGHT BREAKDOWN ==='];

    for (const boss of bosses) {
      const killTime = boss.kill_duration_sec != null
        ? `${Math.floor(boss.kill_duration_sec / 60)}m ${boss.kill_duration_sec % 60}s`
        : 'No kill';
      parts.push(`\n${boss.name} | Kill time: ${killTime} | Wipes: ${boss.wipes || 0} | Pulls: ${boss.pull_count || 0}`);

      // Top DPS
      if (boss.top_dps && boss.top_dps.length > 0) {
        const dpsLines = boss.top_dps.map((d, i) =>
          `${i + 1}. ${d.name}(${d.class}) ${Number(d.amount).toLocaleString()}`
        );
        parts.push(`  Top DPS: ${dpsLines.join(', ')}`);
      }

      // Top HPS
      if (boss.top_hps && boss.top_hps.length > 0) {
        const hpsLines = boss.top_hps.map((h, i) =>
          `${i + 1}. ${h.name}(${h.class}) ${Number(h.amount).toLocaleString()}`
        );
        parts.push(`  Top HPS: ${hpsLines.join(', ')}`);
      }
    }

    // Totals
    const durationMin = Math.floor((summary.total_duration_sec || 0) / 60);
    const durationSec = (summary.total_duration_sec || 0) % 60;
    parts.push(`\n--- Totals ---`);
    parts.push(`Clear time: ${durationMin}m ${durationSec}s`);
    parts.push(`Bosses killed: ${summary.bosses_killed || 0}`);
    parts.push(`Total wipes: ${summary.total_wipes || 0}`);
    parts.push(`Total deaths: ${summary.total_deaths || 0}`);

    const result = parts.join('\n');
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchFightBreakdown error:', err.message);
    return `Error fetching fight breakdown: ${err.message}`;
  }
}

/**
 * Fetches death details for a raid event, optionally filtered by player name.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} eventId - Event ID
 * @param {string} [playerName] - Optional player name filter (case-insensitive partial match)
 * @returns {Promise<string>} Formatted deaths string
 */
async function fetchDeaths(pool, eventId, playerName) {
  if (!eventId) return '';
  // Include playerName in cache key for filtered results
  const cacheKey = playerName
    ? `deaths:${eventId}:${playerName.toLowerCase()}`
    : `deaths:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await pool.query(
      `SELECT summary FROM wcl_event_summaries WHERE event_id = $1`, [eventId]
    );
    if (res.rows.length === 0) {
      return 'Death data is not yet available for this event. Summary generation may still be in progress.';
    }

    const summary = typeof res.rows[0].summary === 'string'
      ? JSON.parse(res.rows[0].summary) : res.rows[0].summary;
    let deaths = summary.deaths || [];

    // Apply player name filter if provided
    if (playerName) {
      const filter = playerName.toLowerCase();
      deaths = deaths.filter(d => d.player && d.player.toLowerCase().includes(filter));
    }

    if (deaths.length === 0) {
      const filterMsg = playerName ? ` matching "${playerName}"` : '';
      return `No deaths found${filterMsg} for this event.`;
    }

    const parts = [`=== DEATHS${playerName ? ` (filtered: ${playerName})` : ''} ===`];
    for (const d of deaths) {
      const min = Math.floor((d.time_sec || 0) / 60);
      const sec = (d.time_sec || 0) % 60;
      parts.push(`${d.player} died to ${d.cause} during ${d.boss} at T+${min}m ${sec}s`);
    }
    parts.push(`\nTotal: ${deaths.length} death${deaths.length !== 1 ? 's' : ''}`);

    const result = parts.join('\n');
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchDeaths error:', err.message);
    return `Error fetching deaths: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool-Use: Event List (injected into system prompt)
// ---------------------------------------------------------------------------

/**
 * Fetches the last 30 raid events from roster_overrides, enriched with titles
 * from events_cache. Used to inject an event reference list into the management
 * channel system prompt so Maya can identify event IDs.
 *
 * Event dates are derived from Discord snowflake epoch:
 * (event_id::bigint >> 22) + 1420070400000 = Unix timestamp in ms
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @returns {Promise<string>} Formatted event list string for system prompt injection
 */

/**
 * Cross-raid stats: find top performers by damage or healing across recent raids.
 * Uses damage_amount/healing_amount columns (not dps_value/hps_value which may be 0).
 */
/**
 * Fetches cross-event price history for a loot item.
 * Supports partial, case-insensitive matching via ILIKE.
 * Groups stats by exact item name when multiple items match.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} itemName - Full or partial item name to search
 * @returns {Promise<string>} Formatted item history or friendly no-results message
 */
async function fetchItemHistory(pool, itemName) {
  if (!itemName || !itemName.trim()) return 'Please provide an item name to search.';
  const trimmed = itemName.trim();
  const cacheKey = `itemHistory:${trimmed.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Aggregate stats per distinct item name, excluding 0g/NULL from price stats
    const aggRes = await pool.query(`
      SELECT item_name,
        COUNT(*) AS times_sold,
        MAX(gold_amount) AS highest,
        MIN(gold_amount) AS lowest,
        AVG(gold_amount)::int AS average
      FROM loot_items
      WHERE item_name ILIKE '%' || $1 || '%'
        AND gold_amount > 0
      GROUP BY item_name
      ORDER BY times_sold DESC
    `, [trimmed]);

    if (aggRes.rows.length === 0) {
      const noResult = `No sales found for '${trimmed}'.`;
      cacheSet(cacheKey, noResult);
      return noResult;
    }

    // Recent sales detail (all matching items, newest first, limit 20)
    const detailRes = await pool.query(`
      SELECT item_name, player_name, gold_amount,
        to_timestamp(((event_id::bigint >> 22) + 1420070400000) / 1000.0)::date AS event_date
      FROM loot_items
      WHERE item_name ILIKE '%' || $1 || '%'
      ORDER BY to_timestamp(((event_id::bigint >> 22) + 1420070400000) / 1000.0) DESC
      LIMIT 20
    `, [trimmed]);

    // Build response - stats per item, then recent sales list
    const sections = [];
    for (const row of aggRes.rows) {
      sections.push(
        `${row.item_name}: sold ${row.times_sold} time${row.times_sold !== '1' && row.times_sold !== 1 ? 's' : ''}. ` +
        `High: ${Number(row.highest).toLocaleString()}g, ` +
        `Low: ${Number(row.lowest).toLocaleString()}g, ` +
        `Avg: ${Number(row.average).toLocaleString()}g`
      );
    }

    if (detailRes.rows.length > 0) {
      sections.push('');
      sections.push('Recent sales:');
      for (const row of detailRes.rows) {
        const gold = row.gold_amount > 0
          ? `${Number(row.gold_amount).toLocaleString()}g`
          : '0g (free)';
        sections.push(`${row.player_name} - ${row.item_name} ${gold} (${row.event_date})`);
      }
    }

    const result = sections.join('\n');
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchItemHistory error:', err.message);
    return `Error fetching item history: ${err.message}`;
  }
}

/**
 * Fetches cross-event loot purchase history for a player.
 * Supports partial, case-insensitive matching via ILIKE.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} playerName - Full or partial player/character name
 * @returns {Promise<string>} Formatted player loot history or friendly no-results message
 */
async function fetchPlayerLootHistory(pool, playerName) {
  if (!playerName || !playerName.trim()) return 'Please provide a player name to search.';
  const trimmed = playerName.trim();
  const cacheKey = `playerLootHistory:${trimmed.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await pool.query(`
      SELECT item_name, player_name, gold_amount,
        to_timestamp(((event_id::bigint >> 22) + 1420070400000) / 1000.0)::date AS event_date
      FROM loot_items
      WHERE player_name ILIKE '%' || $1 || '%'
      ORDER BY gold_amount DESC
      LIMIT 30
    `, [trimmed]);

    if (res.rows.length === 0) {
      const noResult = `No loot history found for '${trimmed}'.`;
      cacheSet(cacheKey, noResult);
      return noResult;
    }

    // Group by actual player_name in case ILIKE matches variants
    const playerGroups = {};
    for (const row of res.rows) {
      if (!playerGroups[row.player_name]) {
        playerGroups[row.player_name] = [];
      }
      playerGroups[row.player_name].push(row);
    }

    const sections = [];
    for (const [name, items] of Object.entries(playerGroups)) {
      // Total gold excludes 0g items (free drops)
      const totalGold = items.reduce((sum, r) => sum + (r.gold_amount > 0 ? Number(r.gold_amount) : 0), 0);
      sections.push(`${name} has bought ${items.length} item${items.length !== 1 ? 's' : ''} totalling ${totalGold.toLocaleString()}g:`);
      for (const row of items) {
        const gold = row.gold_amount > 0
          ? `${Number(row.gold_amount).toLocaleString()}g`
          : '0g (free)';
        sections.push(`${row.item_name} ${gold} (${row.event_date})`);
      }
      sections.push('');
    }

    const result = sections.join('\n').trim();
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchPlayerLootHistory error:', err.message);
    return `Error fetching player loot history: ${err.message}`;
  }
}

async function fetchCrossRaidStats(pool, stat, months, limit) {
  const col = stat === 'healing' ? 'healing_amount' : 'damage_amount';
  const label = stat === 'healing' ? 'Healing' : 'Damage';
  const cacheKey = `crossRaidStats:${stat}:${months}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Best single-raid performance per player within the time window
    const res = await pool.query(`
      SELECT ld.character_name, ld.character_class, ld.event_id,
        ld.${col} as amount,
        to_timestamp(((ld.event_id::bigint >> 22) + 1420070400000) / 1000.0)::date as raid_date
      FROM log_data ld
      WHERE ld.${col} > 0
        AND to_timestamp(((ld.event_id::bigint >> 22) + 1420070400000) / 1000.0) > NOW() - ($1 || ' months')::interval
      ORDER BY ld.${col} DESC
      LIMIT $2
    `, [String(months), limit]);

    if (res.rows.length === 0) return `No ${label} data found in the last ${months} month(s).`;

    const lines = res.rows.map((r, i) =>
      `${i + 1}. ${r.character_name} (${r.character_class || '?'}) - ${Number(r.amount).toLocaleString()} ${label} on ${r.raid_date}`
    );
    const result = `**Top ${label} in a single raid (last ${months} month${months !== 1 ? 's' : ''}):**\n${lines.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchCrossRaidStats error:', err.message);
    return `Error fetching cross-raid ${label} stats: ${err.message}`;
  }
}

async function getEventList(pool) {
  const cacheKey = 'eventList:all';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Enriched query: roster count + gold/wcl/loot/briefing data via LEFT JOINs
    const res = await pool.query(`
      SELECT
        ro.event_id,
        to_timestamp(((ro.event_id::bigint >> 22) + 1420070400000) / 1000.0) AS event_date,
        ro.player_count,
        rse.published AS gold_published,
        rse.total_gold_pot,
        es.summary->>'bosses_killed' AS wcl_bosses_killed,
        ep_exists.has_pages AS has_wcl_pages,
        COALESCE(li.loot_count, 0) AS loot_count,
        COALESCE(bc.briefing_count, 0) AS briefing_count
      FROM (
        SELECT event_id, COUNT(*) AS player_count
        FROM roster_overrides
        GROUP BY event_id
        HAVING COUNT(*) >= 10
      ) ro
      LEFT JOIN rewards_snapshot_events rse ON rse.event_id = ro.event_id
      LEFT JOIN wcl_event_summaries es ON es.event_id = ro.event_id
      LEFT JOIN LATERAL (
        SELECT TRUE AS has_pages FROM wcl_event_pages WHERE event_id = ro.event_id LIMIT 1
      ) ep_exists ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS loot_count FROM loot_items WHERE event_id = ro.event_id
      ) li ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS briefing_count FROM bot_conversations WHERE event_id = ro.event_id
      ) bc ON TRUE
      ORDER BY ro.event_id DESC
      LIMIT 30
    `);

    if (res.rows.length === 0) {
      const result = 'Available raid events: None found.';
      cacheSet(cacheKey, result);
      return result;
    }

    // Fetch events_cache for title lookups
    let titleMap = {};
    try {
      const cacheResult = await pool.query(
        `SELECT events_data FROM events_cache WHERE cache_key = 'raid_helper_events'`
      );
      if (cacheResult.rows.length > 0) {
        const rawEvents = cacheResult.rows[0].events_data;
        const allEvents = typeof rawEvents === 'string' ? JSON.parse(rawEvents) : rawEvents;
        if (Array.isArray(allEvents)) {
          for (const ev of allEvents) {
            titleMap[String(ev.id)] = ev.channelName || ev.title || null;
          }
        }
      }
    } catch (titleErr) {
      console.error('[persona-mgmt-ctx] getEventList title lookup error:', titleErr.message);
    }

    // Also fetch upcoming events from events_cache
    let upcomingLines = [];
    try {
      const now = Math.floor(Date.now() / 1000);
      const cacheResult2 = await pool.query(
        `SELECT events_data FROM events_cache WHERE cache_key = 'raid_helper_events'`
      );
      if (cacheResult2.rows.length > 0) {
        const rawEvents = cacheResult2.rows[0].events_data;
        const allEvents = typeof rawEvents === 'string' ? JSON.parse(rawEvents) : rawEvents;
        if (Array.isArray(allEvents)) {
          const upcoming = allEvents
            .filter(e => e.startTime && parseInt(e.startTime, 10) > now)
            .sort((a, b) => parseInt(a.startTime, 10) - parseInt(b.startTime, 10));
          for (const ev of upcoming) {
            const title = ev.channelName || ev.title || 'Unknown Raid';
            const d = new Date(parseInt(ev.startTime, 10) * 1000);
            const dateStr = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
            upcomingLines.push(`- event_id: ${ev.id} | ${title} | ${dayName} ${dateStr} | UPCOMING`);
          }
        }
      }
    } catch (_) {}

    const lines = res.rows.map(row => {
      const eventId = String(row.event_id);
      const title = titleMap[eventId] || 'Unknown Raid';
      const date = new Date(row.event_date);
      const dateStr = date.toISOString().split('T')[0];
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      const parts = [`- event_id: ${eventId}`, title, `${dayName} ${dateStr}`, `${row.player_count} players`];

      // Gold info
      if (row.gold_published === true) {
        parts.push(`gold:${row.total_gold_pot || 0}g published`);
      } else if (row.gold_published === false) {
        parts.push('gold:unpublished');
      }

      // WCL info
      if (row.wcl_bosses_killed != null) {
        parts.push(`wcl:${row.wcl_bosses_killed} bosses`);
      } else if (row.has_wcl_pages) {
        parts.push('wcl:processing');
      }

      // Loot info
      parts.push(`loot:${row.loot_count > 0 ? row.loot_count : 'no'} items`);

      // Briefing count
      parts.push(`briefings:${row.briefing_count}`);

      return parts.join(' | ');
    });

    const upcomingSection = upcomingLines.length > 0
      ? `Upcoming events:\n${upcomingLines.join('\n')}\n\n`
      : '';
    const result = `${upcomingSection}Past raid events (most recent first):\n${lines.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] getEventList error:', err.message);
    return 'Available raid events: Error fetching event list.';
  }
}

// ---------------------------------------------------------------------------
// Tool-Use: Player Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a flexible player identifier (character name, roster name,
 * Discord username, or Discord snowflake ID) to a discord_id.
 *
 * Resolution order:
 * 1. Exact match on players.character_name (case-insensitive)
 * 2. Match on roster_overrides.assigned_char_name (case-insensitive, DISTINCT)
 * 3. Match on discord_users.username (case-insensitive)
 * 4. Match as Discord snowflake ID on players.discord_id
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} identifier - Character name, Discord username, or Discord snowflake ID
 * @returns {Promise<{discordId: string, characterName: string}|null>} Resolved player or null
 */
async function resolvePlayerIdentifier(pool, identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  const trimmed = identifier.trim();
  if (trimmed.length === 0) return null;

  // 1. Exact match on players.character_name
  try {
    const res = await pool.query(
      `SELECT discord_id, character_name FROM players WHERE LOWER(character_name) = LOWER($1) LIMIT 1`,
      [trimmed]
    );
    if (res.rows.length > 0) {
      return { discordId: res.rows[0].discord_id, characterName: res.rows[0].character_name };
    }
  } catch (_) { /* continue */ }

  // 2. Match on roster_overrides.assigned_char_name
  try {
    const res = await pool.query(
      `SELECT DISTINCT discord_user_id, assigned_char_name FROM roster_overrides
       WHERE LOWER(assigned_char_name) = LOWER($1) AND discord_user_id IS NOT NULL LIMIT 1`,
      [trimmed]
    );
    if (res.rows.length > 0) {
      return { discordId: res.rows[0].discord_user_id, characterName: res.rows[0].assigned_char_name };
    }
  } catch (_) { /* continue */ }

  // 3. Match on discord_users.username
  try {
    const res = await pool.query(
      `SELECT discord_id, username FROM discord_users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [trimmed]
    );
    if (res.rows.length > 0) {
      // Try to get a character name from players table
      const playerRes = await pool.query(
        `SELECT character_name FROM players WHERE discord_id = $1 LIMIT 1`,
        [res.rows[0].discord_id]
      );
      const charName = playerRes.rows.length > 0 ? playerRes.rows[0].character_name : res.rows[0].username;
      return { discordId: res.rows[0].discord_id, characterName: charName };
    }
  } catch (_) { /* continue */ }

  // 4. Match as Discord snowflake ID
  if (/^\d{17,20}$/.test(trimmed)) {
    try {
      const res = await pool.query(
        `SELECT discord_id, character_name FROM players WHERE discord_id = $1 LIMIT 1`,
        [trimmed]
      );
      if (res.rows.length > 0) {
        return { discordId: res.rows[0].discord_id, characterName: res.rows[0].character_name || trimmed };
      }
    } catch (_) { /* continue */ }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tool-Use: Player Data (enriched section builder)
// ---------------------------------------------------------------------------

const { buildPlayerContext } = require('./persona-context.cjs');

/**
 * Fetches comprehensive player data by resolving a flexible identifier.
 * Builds the same enriched section as the old lookupPlayersInMessage:
 * player context, notes, recent conversations, and conversation stats.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} identifier - Character name, Discord username, or Discord snowflake ID
 * @returns {Promise<string>} Formatted player data string or error message
 */
/**
 * Fetches comprehensive player data. When tier is 'public', private fields
 * (bot_player_notes text, bot_conversations details) are suppressed to prevent
 * leaking sensitive management data in public Discord channels.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} identifier - Character name, Discord username, or Discord ID
 * @param {object} [options] - Optional parameters
 * @param {string} [options.tier='officer'] - Channel tier: 'officer' (full data) or 'public' (private fields suppressed)
 * @returns {Promise<string>} Formatted player data string
 */
async function fetchPlayerData(pool, identifier, options = {}) {
  const tier = options.tier || 'officer';
  const resolved = await resolvePlayerIdentifier(pool, identifier);
  if (!resolved) {
    return `No player found matching "${identifier}". Try using their exact character name, Discord username, or Discord ID.`;
  }

  const { discordId, characterName } = resolved;
  const cacheKey = `playerData:${discordId}:${tier}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const playerContext = await buildPlayerContext(pool, discordId);

    // Private data sections — only fetched for officer tier
    let notesBlock = '';
    let convsBlock = '';
    let convStatsLine = '';

    if (tier === 'officer') {
      // Fetch Maya's notes about this player
      const notesRes = await pool.query(
        `SELECT note, created_at FROM bot_player_notes WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [discordId]
      );
      notesBlock = notesRes.rows.length > 0
        ? notesRes.rows.map(n => {
            const date = new Date(n.created_at).toISOString().split('T')[0];
            return `- [${date}] ${n.note}`;
          }).join('\n')
        : 'No notes recorded.';

      // Fetch recent conversations with message counts
      const convsRes = await pool.query(
        `SELECT bc.id, bc.status, bc.created_at, bc.summary,
                (SELECT COUNT(*) FROM bot_messages bm WHERE bm.conversation_id = bc.id) as msg_count
         FROM bot_conversations bc
         WHERE bc.discord_id = $1
         ORDER BY bc.created_at DESC LIMIT 5`,
        [discordId]
      );
      convsBlock = convsRes.rows.length > 0
        ? convsRes.rows.map(c => {
            const date = new Date(c.created_at).toISOString().split('T')[0];
            const summary = c.summary ? ` - ${c.summary}` : '';
            return `- [${c.status}] ${date}, ${c.msg_count} messages${summary}`;
          }).join('\n')
        : 'No conversations recorded.';

      // Fetch conversation count and last chat date
      const convCountRes = await pool.query(
        `SELECT COUNT(*) as count, MAX(created_at) as last_chat FROM bot_conversations WHERE discord_id = $1`,
        [discordId]
      );
      const convCount = parseInt(convCountRes.rows[0].count, 10) || 0;
      const lastChat = convCountRes.rows[0].last_chat
        ? new Date(convCountRes.rows[0].last_chat).toISOString().split('T')[0]
        : 'Never';
      convStatsLine = `Total conversations: ${convCount}, Last chat: ${lastChat}`;
    }

    // Fetch alts (public data — safe for all tiers)
    const altsResult = await fetchPlayerAlts(pool, [discordId]);

    // Build result based on tier
    let result;
    if (tier === 'officer') {
      result = `## ${characterName}\n${playerContext || 'No player data available.'}\n\n**Conversation Stats:** ${convStatsLine}\n\n**Maya's Notes:**\n${notesBlock}\n\n**Recent Conversations:**\n${convsBlock}${altsResult ? `\n\n${altsResult}` : ''}`;
    } else {
      // Public tier: only general player profile, no notes or conversations
      result = `## ${characterName}\n${playerContext || 'No player data available.'}${altsResult ? `\n\n${altsResult}` : ''}`;
    }

    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchPlayerData error:', err.message);
    return `Error fetching player data for "${identifier}": ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool-Use: Historical Attendance (tool wrapper)
// ---------------------------------------------------------------------------

/**
 * Tool-friendly wrapper for historical attendance that accepts structured
 * parameters instead of parsing message text.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} className - Lowercase WoW class name (priest, warrior, etc.)
 * @param {number} [months=3] - Number of months to look back (max 12)
 * @returns {Promise<string>} Formatted historical attendance data
 */
async function fetchHistoricalAttendanceTool(pool, className, months) {
  const classFilter = (className || '').toLowerCase().trim();
  const validClasses = ['priest', 'warrior', 'mage', 'druid', 'shaman', 'rogue', 'warlock', 'hunter', 'paladin'];
  if (!validClasses.includes(classFilter)) {
    return `Invalid class "${className}". Valid classes: ${validClasses.join(', ')}`;
  }

  const monthsVal = Math.min(Math.max(1, months || 3), 12);
  const cacheKey = `historicalAttendance:${classFilter}:${monthsVal}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await pool.query(
      `SELECT ro.assigned_char_name, ro.assigned_char_class,
        to_timestamp(((ro.event_id::bigint >> 22) + 1420070400000) / 1000.0)::date as raid_date
      FROM roster_overrides ro
      WHERE LOWER(ro.assigned_char_class) LIKE $1
        AND to_timestamp(((ro.event_id::bigint >> 22) + 1420070400000) / 1000.0) > NOW() - ($2 || ' months')::interval
      ORDER BY ro.assigned_char_name, raid_date DESC`,
      [`%${classFilter}%`, String(monthsVal)]
    );

    if (res.rows.length === 0) {
      return `No historical attendance records found for ${classFilter}s in the last ${monthsVal} months.`;
    }

    const byPlayer = {};
    for (const row of res.rows) {
      const name = row.assigned_char_name;
      if (!byPlayer[name]) byPlayer[name] = { cls: row.assigned_char_class, dates: [] };
      byPlayer[name].dates.push(row.raid_date);
    }

    const lines = Object.entries(byPlayer)
      .sort((a, b) => b[1].dates.length - a[1].dates.length)
      .map(([name, d]) => `- ${name} (${d.cls}): ${d.dates.length} raid${d.dates.length !== 1 ? 's' : ''}, last: ${d.dates[0]}`);

    const result = `Historical Attendance - ${classFilter.charAt(0).toUpperCase() + classFilter.slice(1)}s (last ${monthsVal} months, ${Object.keys(byPlayer).length} unique players, ${res.rows.length} appearances):\n${lines.join('\n')}`;
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[persona-mgmt-ctx] fetchHistoricalAttendanceTool error:', err.message);
    return `Error fetching historical attendance: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Tool-Use: Player Notes (by identifier)
// ---------------------------------------------------------------------------

/**
 * Fetches bot notes and management notes for a player identified by
 * character name, Discord username, or Discord snowflake ID.
 *
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {string} identifier - Character name, Discord username, or Discord snowflake ID
 * @returns {Promise<string>} Formatted player notes or error message
 */
async function fetchPlayerNotesTool(pool, identifier) {
  const resolved = await resolvePlayerIdentifier(pool, identifier);
  if (!resolved) {
    return `No player found matching "${identifier}". Try using their exact character name, Discord username, or Discord ID.`;
  }

  const { discordId, characterName } = resolved;
  const notesResult = await fetchPlayerNotes(pool, [discordId]);

  if (!notesResult) {
    return `No notes found for ${characterName}.`;
  }

  return `Notes for ${characterName}:\n${notesResult}`;
}

// ---------------------------------------------------------------------------
// Tool-Use: Dispatcher
// ---------------------------------------------------------------------------

/**
 * Executes a management tool by name with the given input parameters.
 * Catches all errors and returns a friendly error string instead of throwing.
 * Results are cached via the individual fetcher's caching mechanism.
 *
 * @param {string} name - Tool name (must match a MANAGEMENT_TOOLS entry)
 * @param {object} input - Tool input parameters from the LLM
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @param {object} [options] - Optional parameters
 * @param {string} [options.tier='officer'] - Channel tier passed to tier-aware tools
 * @returns {Promise<string>} Tool result string (data or friendly error)
 */
async function executeManagementTool(name, input, pool, options = {}) {
  try {
    switch (name) {
      case 'get_roster':
        return (await fetchRoster(pool, input.event_id)) || 'No roster data found for this event.';

      case 'get_logs':
        return (await fetchLogData(pool, input.event_id)) || 'No log data found for this event.';

      case 'get_gold':
        return (await fetchGoldLoot(pool, input.event_id)) || 'No gold/loot data found for this event.';

      case 'get_signups':
        return (await fetchSignups(input.event_id)) || 'No sign-up data found for this event.';

      case 'get_assignments':
        return (await fetchAssignments(pool, input.event_id)) || 'No assignments found for this event.';

      case 'get_player_data':
        return await fetchPlayerData(pool, input.identifier, { tier: options.tier || 'officer' });

      case 'get_historical_attendance':
        return await fetchHistoricalAttendanceTool(pool, input.class, input.months);

      case 'get_player_notes':
        return await fetchPlayerNotesTool(pool, input.identifier);

      case 'get_world_buffs':
        return (await fetchWorldBuffs(pool, input.event_id)) || 'No world buff data found for this event.';

      case 'get_cross_raid_stats':
        return await fetchCrossRaidStats(pool, input.stat, input.months || 1, input.limit || 5);

      case 'get_event_overview':
        return (await fetchEventOverview(pool, input.event_id)) || 'No overview data found for this event.';

      case 'get_fight_breakdown':
        return (await fetchFightBreakdown(pool, input.event_id)) || 'No fight breakdown data found for this event.';

      case 'get_deaths':
        return (await fetchDeaths(pool, input.event_id, input.player_name)) || 'No death data found for this event.';

      case 'get_item_history':
        return (await fetchItemHistory(pool, input.item_name)) || 'No item history data available.';

      case 'get_player_loot_history':
        return (await fetchPlayerLootHistory(pool, input.player_name)) || 'No player loot history data available.';

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    console.error(`[persona-mgmt-ctx] executeManagementTool(${name}) error:`, err.message);
    return `Error executing ${name}: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // New tool-use exports
  getEventList,
  executeManagementTool,
  MANAGEMENT_TOOLS,
  PUBLIC_TOOLS,
  PUBLIC_TIER_INSTRUCTION,

  // Legacy exports (kept for backward compatibility)
  /** @deprecated Use MANAGEMENT_TOOLS + executeManagementTool instead */
  detectContextNeeds,
  /** @deprecated Use getEventList + tool-use flow instead */
  resolveEventFromMessage,
  /** @deprecated Use executeManagementTool instead */
  fetchManagementContext
};
