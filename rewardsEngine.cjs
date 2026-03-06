// rewardsEngine.cjs
// Registers canonical rewards endpoints. Initial focus: manual (snapshot) mode end-to-end.
// Auto mode will be added subsequently.

module.exports = function registerRewardsEngine(app, pool) {
  // Utility: lower-case name key (preserves special characters like â, ô, etc.)
  const nameKey = (s) => String(s || '').trim().toLowerCase();
  
  // Utility: ignore non-players consistently
  // This MUST match the auto mode version exactly for consistency
  const shouldIgnorePlayer = (name) => {
    const n = String(name || '').trim();
    // Filter out names with spaces (e.g., "Windfury Totem", "Battle Chicken")
    if (n.includes(' ')) return true;
    // Exact match filter (case-insensitive)
    const lower = n.toLowerCase();
    const exactMatches = ['zzold', 'totem', 'trap', 'dummy', 'battlechicken'];
    return exactMatches.includes(lower);
  };

  async function tableExists(client, tableName) {
    const res = await client.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [String(tableName)]
    );
    return !!(res.rows && res.rows[0] && res.rows[0].exists);
  }

  async function getSnapshotLocked(client, eventId) {
    // Prefer dedicated status table when present, but fall back to events if no row exists
    const haveStatus = await tableExists(client, 'rewards_snapshot_status');
    if (haveStatus) {
      const r = await client.query(
        `SELECT locked FROM rewards_snapshot_status WHERE event_id = $1`,
        [eventId]
      );
      if (r.rows && r.rows.length > 0) {
        return !!r.rows[0].locked;
      }
      // No status row: fall back to events table
    }
    const legacy = await tableExists(client, 'rewards_snapshot_events');
    if (legacy) {
      const r = await client.query(
        `SELECT locked_at FROM rewards_snapshot_events WHERE event_id = $1`,
        [eventId]
      );
      // Only consider legacy snapshot locked when locked_at is present (non-null)
      if (r.rows && r.rows.length > 0) {
        return !!r.rows[0].locked_at;
      }
      return false;
    }
    return false;
  }

  async function getSnapshotEntries(client, eventId) {
    // Prefer unified snapshot storage used by raidlogs: rewards_and_deductions_points
    const haveUnified = await tableExists(client, 'rewards_and_deductions_points');
    if (haveUnified) {
      const r = await client.query(
        `SELECT panel_key, character_name, character_class, point_value_original, point_value_edited
         FROM rewards_and_deductions_points WHERE event_id = $1`,
        [eventId]
      );
      return r.rows || [];
    }
    // Fallback to newer snapshot entries table, if present
    const haveEntries = await tableExists(client, 'rewards_snapshot_entries');
    if (haveEntries) {
      const r = await client.query(
        `SELECT panel_key, character_name, character_class, point_value_original, point_value_edited
         FROM rewards_snapshot_entries WHERE event_id = $1`,
        [eventId]
      );
      return r.rows || [];
    }
    return [];
  }

  async function getManualRewards(client, eventId) {
    const have = await tableExists(client, 'manual_rewards_deductions');
    if (!have) return [];
    const r = await client.query(
      `SELECT player_name, player_class, description, points
       FROM manual_rewards_deductions WHERE event_id = $1`,
      [eventId]
    );
    return r.rows || [];
  }

  async function getGoldPotTotal(client, eventId) {
    const have = await tableExists(client, 'loot_items');
    if (!have) return 0;
    const r = await client.query(
      `SELECT COALESCE(SUM(gold_amount),0) AS total_gold FROM loot_items WHERE event_id = $1`,
      [eventId]
    );
    return parseInt(r.rows[0] && r.rows[0].total_gold || 0) || 0;
  }

  async function buildManualModeFromSnapshot(req, eventId, { entries, manualRewards, totalGoldPot }) {
    // Canonical panel registry used here (subset for manual path)
    const panels = new Map(); // panel_key -> Map<nameKey, points>
    const ensurePanel = (k) => { if (!panels.has(k)) panels.set(k, new Map()); return panels.get(k); };

    // Seed players from snapshot
    const playersMap = new Map(); // nameKey -> { name, class }

    // Base panel container (may already be populated from snapshot when locking from engine)
    const basePanel = ensurePanel('base');

    (entries || []).forEach(e => {
      const nmRaw = String(e.character_name || '').trim();
      if (!nmRaw || shouldIgnorePlayer(nmRaw)) return;
      const panelKey = String(e.panel_key || '').trim() || 'unknown';
      // Canonicalize names for totals to avoid creating pseudo-players like "Funduk (Group 2)"
      let nmCanon = nmRaw;
      if (panelKey === 'windfury_totems') {
        // Strip any trailing "(…)" suffix including surrounding spaces
        nmCanon = nmCanon.replace(/\s*\([^)]*\)\s*$/, '').trim();
      }
      const key = nameKey(nmCanon);
      if (!playersMap.has(key)) playersMap.set(key, { name: nmCanon, class: e.character_class || 'Unknown' });
      // Track snapshot value under canonicalized player key
      const pts = (e.point_value_edited != null ? Number(e.point_value_edited) : Number(e.point_value_original)) || 0;
      const panel = ensurePanel(panelKey);
      panel.set(key, (panel.get(key) || 0) + pts);
    });

    // Enrich missing/unknown classes from raid logs dataset (ensures class-colored UI and correct class in engine output)
    try {
      const baseUrl = req.protocol + '://' + req.get('host');
      const r = await fetch(`${baseUrl}/api/log-data/${encodeURIComponent(eventId)}`, { headers: { 'Accept': 'application/json', 'Cookie': req.headers.cookie || '' } });
      if (r && r.ok) {
        const body = await r.json();
        const rows = Array.isArray(body?.data) ? body.data : [];
        const classByName = new Map();
        rows.forEach(p => {
          const nm = String(p?.character_name || '').trim();
          const cls = String(p?.character_class || '').trim();
          if (!nm || !cls) return;
          classByName.set(nameKey(nm), cls);
        });
        playersMap.forEach((val, k) => {
          if (!val.class || String(val.class).toLowerCase() === 'unknown') {
            const cls = classByName.get(k);
            if (cls) val.class = cls;
          }
        });
      }
    } catch (_) {}

    // Manual: split into points vs gold
    const manualPointsPanel = ensurePanel('manual_points');
    let manualGoldPayoutTotal = 0;
    // Build a confirmation set to mirror auto mode filtering: prefer base panel keys; fallback to any non-manual panel keys
    const confirmedKeys = new Set();
    if (basePanel && basePanel.size > 0) {
      basePanel.forEach((_, k) => confirmedKeys.add(k));
    } else {
      panels.forEach((map, pkey) => {
        if (pkey === 'manual_points') return;
        map.forEach((_, k) => confirmedKeys.add(k));
      });
    }
    // If snapshot already contains manual_points rows, do NOT re-add manual points from manualRewards
    const hasManualPointsFromSnapshot = (manualPointsPanel && manualPointsPanel.size > 0);
    (manualRewards || []).forEach(r => {
      const nmRaw = String(r.player_name || '').trim();
      if (!nmRaw || shouldIgnorePlayer(nmRaw)) return;
      const key = nameKey(nmRaw);
      if (!playersMap.has(key)) playersMap.set(key, { name: nmRaw, class: r.player_class || 'Unknown' });
      const isGold = /\[\s*gold\s*\]/i.test(String(r.description || ''));
      const val = Number(r.points) || 0;
      if (isGold) {
        if (val > 0) manualGoldPayoutTotal += val;
      } else {
        if (!hasManualPointsFromSnapshot && confirmedKeys.has(key)) {
          manualPointsPanel.set(key, (manualPointsPanel.get(key) || 0) + val);
        }
      }
    });

    // Add Base 100 only if snapshot did NOT include a base panel (avoid double-counting when locking from engine)
    const hasBaseFromSnapshot = (basePanel && basePanel.size > 0);
    if (!hasBaseFromSnapshot) {
      playersMap.forEach((_, key) => { basePanel.set(key, (basePanel.get(key) || 0) + 100); });
    }

    // Build output structures
    const players = Array.from(playersMap.values());

    // Per-player totals
    const totals = new Map(); // key -> { name, class, points, gold }
    const addPts = (k, pts) => {
      const p = totals.get(k) || { name: playersMap.get(k).name, class: playersMap.get(k).class, points: 0, gold: 0 };
      p.points += (Number(pts) || 0);
      totals.set(k, p);
    };

    panels.forEach((panelMap) => {
      panelMap.forEach((pts, k) => addPts(k, pts));
    });

    // Meta: shared pot adjusted by manual gold payouts
    const sharedGoldPot = Math.floor((Number(totalGoldPot) || 0) * 0.85);
    const adjusted = Math.max(0, sharedGoldPot - (Number(manualGoldPayoutTotal) || 0));

    let totalPointsAll = 0;
    totals.forEach(v => { totalPointsAll += Math.max(0, v.points); });
    const goldPerPoint = (adjusted > 0 && totalPointsAll > 0) ? (adjusted / totalPointsAll) : 0;

    totals.forEach(v => { v.gold = Math.floor(Math.max(0, v.points) * goldPerPoint); });

    // Panels array serialization
    const panelsOut = Array.from(panels.entries()).map(([panel_key, m]) => ({
      panel_key,
      rows: Array.from(m.entries()).map(([k, pts]) => ({ name: playersMap.get(k).name, points: Number(pts) || 0 }))
    }));

    // Manual gold list
    const manualGold = [];
    (manualRewards || []).forEach(r => {
      const isGold = /\[\s*gold\s*\]/i.test(String(r.description || ''));
      if (!isGold) return;
      const val = Number(r.points) || 0;
      if (val > 0) {
        const nmRaw = String(r.player_name || '').trim();
        if (!nmRaw) return;
        manualGold.push({ name: nmRaw, gold: val });
      }
    });

    // Digest (simple deterministic string hash replacement placeholder)
    const calc_digest = `manual:${players.length}:${panelsOut.length}:${adjusted}:${totalPointsAll}`;

    return {
      success: true,
      mode: 'manual',
      calc_digest,
      meta: {
        totalGoldPot: Number(totalGoldPot) || 0,
        sharedGoldPot,
        manualGoldPayoutTotal: Number(manualGoldPayoutTotal) || 0,
        sharedGoldPotAdjusted: adjusted,
        totalPointsAll,
        goldPerPoint
      },
      players,
      totals: Object.fromEntries(Array.from(totals.entries()).map(([k, v]) => [k, v])),
      panels: panelsOut,
      manual_gold: manualGold
    };
  }

  // --- Automatic mode (compute from datasets) ---
  async function buildAutoModeFromDatasets(req, eventId) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const jget = async (url) => {
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json', 'Cookie': req.headers.cookie || '' } });
        if (!r.ok) return null;
        return await r.json();
      } catch { return null; }
    };

    // Load datasets in parallel from existing endpoints
    const endpoints = [
      [`${baseUrl}/api/log-data/${eventId}`, 'logData'],
      [`${baseUrl}/api/reward-settings`, 'rewardSettings'],
      [`${baseUrl}/api/abilities-data/${eventId}`, 'abilitiesData'],
      [`${baseUrl}/api/mana-potions-data/${eventId}`, 'manaPotionsData'],
      [`${baseUrl}/api/runes-data/${eventId}`, 'runesData'],
      [`${baseUrl}/api/windfury-data/${eventId}`, 'windfuryData'],
      [`${baseUrl}/api/interrupts-data/${eventId}`, 'interruptsData'],
      [`${baseUrl}/api/disarms-data/${eventId}`, 'disarmsData'],
      [`${baseUrl}/api/sunder-data/${eventId}`, 'sunderData'],
      [`${baseUrl}/api/curse-data/${eventId}`, 'curseData'],
      [`${baseUrl}/api/curse-shadow-data/${eventId}`, 'curseShadowData'],
      [`${baseUrl}/api/curse-elements-data/${eventId}`, 'curseElementsData'],
      [`${baseUrl}/api/faerie-fire-data/${eventId}`, 'faerieFireData'],
      [`${baseUrl}/api/scorch-data/${eventId}`, 'scorchData'],
      [`${baseUrl}/api/demo-shout-data/${eventId}`, 'demoShoutData'],
      [`${baseUrl}/api/polymorph-data/${eventId}`, 'polymorphData'],
      [`${baseUrl}/api/power-infusion-data/${eventId}`, 'powerInfusionData'],
      [`${baseUrl}/api/decurses-data/${eventId}`, 'decursesData'],
      [`${baseUrl}/api/frost-resistance-data/${eventId}`, 'frostResistanceData'],
      [`${baseUrl}/api/world-buffs-data/${eventId}`, 'worldBuffsData'],
      [`${baseUrl}/api/void-damage/${eventId}`, 'voidDamageData'],
      [`${baseUrl}/api/manual-rewards/${eventId}`, 'manualRewardsData'],
      [`${baseUrl}/api/player-streaks/${eventId}`, 'playerStreaks'],
      [`${baseUrl}/api/guild-members/${eventId}`, 'guildMembers'],
      [`${baseUrl}/api/raid-stats/${eventId}`, 'raidStats'],
      [`${baseUrl}/api/assignments/${eventId}`, 'assignments'],
      [`${baseUrl}/api/player-role-mapping/${eventId}/primary-roles`, 'primaryRoles'],
    ];

    const results = await Promise.all(endpoints.map(([u]) => jget(u)));
    const byKey = {};
    for (let i = 0; i < endpoints.length; i++) {
      const key = endpoints[i][1];
      const body = results[i];
      if (key === 'logData') byKey.logData = body?.data || [];
      else if (key === 'rewardSettings') byKey.rewardSettings = body?.settings || {};
      else if (key === 'raidStats') byKey.raidStats = body?.data || body || {};
      else if (key === 'primaryRoles') byKey.primaryRoles = body?.primaryRoles || {};
      else if (key === 'assignments') byKey.assignments = body || {};
      else byKey[key] = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []);
    }

    const shouldIgnorePlayer = (name) => {
      const n = String(name || '').trim();
      // Filter out names with spaces (these are usually non-player entities like "Windfury Totem")
      if (n.includes(' ')) return true;
      // Exact match filter for specific non-player entities
      const lower = n.toLowerCase();
      const exactMatches = ['zzold', 'totem', 'trap', 'dummy', 'battlechicken'];
      return exactMatches.includes(lower);
    };
    const nameKey = (s) => String(s||'').trim().toLowerCase();

    // Assigned tanks from assignments panel (ONLY SKULL AND CROSS for sunder exclusion)
    const mainTanks = new Set();
    try {
      const panels = Array.isArray(byKey.assignments?.panels) ? byKey.assignments.panels : [];
      const tankingPanel = panels.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                        || panels.find(p => String(p.boss||'').toLowerCase()==='tanking');
      if (tankingPanel && Array.isArray(tankingPanel.entries)) {
        const pick = (marker)=>{
          const e = tankingPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(marker));
          const nm = e?.character_name ? String(e.character_name).trim().toLowerCase() : '';
          return nm;
        };
        // ONLY include Skull and Cross tanks for exclusion from Sunder Armor panel
        ['skull','cross'].forEach(m=>{ const k=pick(m); if (k) mainTanks.add(k); });
      }
    } catch {}

    // Players from logData
    const allPlayers = [];
    const seen = new Set();
    (byKey.logData||[]).filter(p=>!shouldIgnorePlayer(p.character_name)).forEach(p=>{
      const key = nameKey(p.character_name); if (seen.has(key)) return; seen.add(key);
      allPlayers.push({ name: p.character_name, class: p.character_class || 'Unknown' });
    });
    const confirmed = new Set(allPlayers.map(p => nameKey(p.name)));

    // Panel accumulator
    const panels = new Map(); const ensurePanel = (k)=>{ if(!panels.has(k)) panels.set(k,new Map()); return panels.get(k); };
    // Changed: Allow 0 points (only filter out null/undefined) so we can show underperformers
    const addRow = (panelKey, nm, pts)=>{ if(pts == null) return; const key=nameKey(nm); const m=ensurePanel(panelKey); m.set(key,(m.get(key)||0)+pts); };

    // Totals accumulator
    const totals = new Map(); const addPts=(nm,pts)=>{ const k=nameKey(nm); const cur=totals.get(k)||{name:nm,class:(allPlayers.find(p=>nameKey(p.name)===k)?.class||'Unknown'),points:0,gold:0}; cur.points+=Number(pts)||0; totals.set(k,cur); };

    // Base +100
    const basePanel = ensurePanel('base');
    allPlayers.forEach(p=>{ basePanel.set(nameKey(p.name), (basePanel.get(nameKey(p.name))||0) + 100); });

    // Helper to sum array datasets into panel (trust API data - no confirmed check)
    const sumDataset = (arr, panelKey) => {
      (arr||[]).forEach(row => {
        const nm = row.character_name || row.player_name; if (!nm) return;
        // Removed confirmed check - if API has data for a player, they were in the raid
        addRow(panelKey, nm, Number(row.points)||0);
      });
    };

    // Rankings: damage/healing
    try {
      const dmgPts = byKey.rewardSettings?.damage?.points_array || [];
      const damageSorted = (byKey.logData||[])
        .filter(p=>!shouldIgnorePlayer(p.character_name))
        .filter(p=>(['dps','tank'].includes(String(p.role_detected||'').toLowerCase())) && (parseInt(p.damage_amount)||0)>0)
        .sort((a,b)=>(parseInt(b.damage_amount)||0)-(parseInt(a.damage_amount)||0));
      damageSorted.forEach((p, idx)=>{ const pts = idx<dmgPts.length ? (dmgPts[idx]||0) : 0; if(pts) addRow('damage', p.character_name, pts); });

      const healPts = byKey.rewardSettings?.healing?.points_array || [];
      const healers = (byKey.logData||[])
        .filter(p=>!shouldIgnorePlayer(p.character_name))
        .filter(p=>{
          const key = nameKey(p.character_name);
          // Legacy: detected role for healer rankings
          const detected = String(p.role_detected||'').toLowerCase();
          const isHealer = (detected === 'healer');
          return isHealer && (parseInt(p.healing_amount)||0) > 0;
        })
        .sort((a,b)=>(parseInt(b.healing_amount)||0)-(parseInt(a.healing_amount)||0));
      healers.forEach((p, idx)=>{ const pts = idx<healPts.length ? (healPts[idx]||0) : 0; if(pts) addRow('healing', p.character_name, pts); });

      // God gamer awards
      if (damageSorted.length>=2){ const first=parseInt(damageSorted[0].damage_amount)||0; const second=parseInt(damageSorted[1].damage_amount)||0; const diff=first-second; let pts=0; if(diff>=250000) pts=30; else if(diff>=150000) pts=20; if(pts) addRow('god_gamer_dps', damageSorted[0].character_name, pts); }
      if (healers.length>=2){ const first=parseInt(healers[0].healing_amount)||0; const second=parseInt(healers[1].healing_amount)||0; const diff=first-second; let pts=0; if(diff>=250000) pts=20; else if(diff>=150000) pts=15; if(pts) addRow('god_gamer_healer', healers[0].character_name, pts); }

      // Class-specific healer awards
      const byClass=(arr,cls)=>arr.filter(p=>String(p.character_class||'').toLowerCase().includes(cls));
      const shamans=byClass(healers,'shaman').slice(0,3), priests=byClass(healers,'priest').slice(0,2), druids=byClass(healers,'druid').slice(0,1);
      [ [shamans,[25,20,15],'shaman_healers'], [priests,[20,15],'priest_healers'], [druids,[15],'druid_healers'] ].forEach(([arr,ptsArr,key])=>{
        arr.forEach((p,i)=>{ const pts=ptsArr[i]||0; if(pts) addRow(key, p.character_name, pts); });
      });
    } catch {}

    // Dataset panels
    sumDataset(byKey.abilitiesData, 'abilities');
    // Windfury totems (canonicalize to base player name by stripping group suffix)
    console.log(`[ENGINE] Processing windfury data - total entries:${(byKey.windfuryData||[]).length}, types:`, (byKey.windfuryData||[]).map(r=>r.totem_type).filter((v,i,a)=>a.indexOf(v)===i));
    try {
      (byKey.windfuryData||[]).forEach(row => {
        let nm = row.character_name || row.player_name; if (!nm) return;
        // Strip any trailing parenthetical like "(Group 2)"
        const nmCanon = nm.replace(/\s*\([^)]*\)\s*$/, '').trim();
        // Removed confirmed check - accept all windfury data from API
        addRow('windfury_totems', nmCanon, Number(row.points)||0);
      });
    } catch {}
    sumDataset(byKey.manaPotionsData, 'mana_potions');
    sumDataset(byKey.runesData, 'runes');
    sumDataset(byKey.interruptsData, 'interrupts');
    sumDataset(byKey.disarmsData, 'disarms');
    // Curses and Faerie Fire: include uptime percentage in character_details (trust API data)
    const sumDatasetWithDetails = (arr, panelKey, detailsField = 'uptime') => {
      (arr||[]).forEach(row => {
        const nm = row.character_name || row.player_name; if (!nm) return;
        const k = nameKey(nm);
        // Removed confirmed check - if API has data for a player, they were in the raid
        addRow(panelKey, nm, Number(row.points)||0);
        // Store details in a separate map for later use
        if (!panelDetails.has(panelKey)) panelDetails.set(panelKey, new Map());
        panelDetails.get(panelKey).set(k, row[detailsField] || `${Number(row.uptime_percentage||0)}%`);
      });
    };
    const panelDetails = new Map(); // Track character_details by panel
    console.log(`[ENGINE] Processing curse/faerie fire data - curse:${(byKey.curseData||[]).length}, shadow:${(byKey.curseShadowData||[]).length}, elements:${(byKey.curseElementsData||[]).length}, faerie:${(byKey.faerieFireData||[]).length}`);
    sumDatasetWithDetails(byKey.curseData, 'curse_recklessness', 'uptime');
    sumDatasetWithDetails(byKey.curseShadowData, 'curse_shadow', 'uptime');
    sumDatasetWithDetails(byKey.curseElementsData, 'curse_elements', 'uptime');
    sumDatasetWithDetails(byKey.faerieFireData, 'faerie_fire', 'uptime');
    // Scorch: include even if player not strictly in confirmed, to avoid misses from name mismatches
    try {
      (byKey.scorchData||[]).forEach(row => {
        const nm = row.character_name || row.player_name; if (!nm) return;
        addRow('scorch', nm, Number(row.points)||0);
      });
    } catch {}
    sumDataset(byKey.demoShoutData, 'demo_shout');
    sumDataset(byKey.polymorphData, 'polymorph');
    sumDataset(byKey.powerInfusionData, 'power_infusion');
    sumDataset(byKey.decursesData, 'decurses');
    sumDataset(byKey.worldBuffsData, 'world_buffs_copy');
    sumDataset(byKey.voidDamageData, 'void_damage');
    // Big Buyer: robust parse; accept all data from API
    try {
      let rows = Array.isArray(byKey.bigBuyerData) ? byKey.bigBuyerData : [];
      if (!rows.length) {
        const raw = await jget(`${baseUrl}/api/big-buyer/${eventId}`);
        if (raw) {
          if (Array.isArray(raw.data)) rows = raw.data;
          else if (Array.isArray(raw.top)) rows = raw.top;
          else if (Array.isArray(raw.entries)) rows = raw.entries;
        }
      }
      (rows||[]).forEach(row => {
        const nm = row.character_name || row.player_name || row.name || row.buyer_name; if (!nm) return;
        // Removed confirmed check - accept all big buyer data from API
        const val = Number(row.points != null ? row.points : (row.value != null ? row.value : row.score)) || 0;
        if (!val) return;
        addRow('big_buyer', nm, val);
      });
    } catch {}

    // Rocket Helmet (+5) — include all players found with the helmet equipped
    const includeRocketHelmet = true;
    if (includeRocketHelmet) {
      try {
        const meta = await jget(`${baseUrl}/api/event-endpoints-json/${eventId}`);
        const wcl = meta && meta.data && meta.data.wcl_summary_json;
        const users = new Set();
        const wanted = 'Goblin Rocket Helmet';
        function walk(node){
          if(!node||typeof node!=='object') return;
          if(node.combatantInfo && Array.isArray(node.combatantInfo.gear) && (node.name||node.playerName||node.characterName)){
            const gear = node.combatantInfo.gear;
            if(gear.some(it=>it&&it.name===wanted)){
              users.add(String(node.name||node.playerName||node.characterName));
            }
          }
          if(Array.isArray(node)) node.forEach(walk); else Object.values(node).forEach(walk);
        }
        if (wcl) walk(wcl);
        // Removed confirmed check - accept all players with rocket helmet from WCL data
        Array.from(users).forEach(nm => addRow('rocket_helmet', nm, 5));
      } catch {}
    }

    // Sunder: compute from sunder_count relative to avg; exclude ONLY main tanks (Skull + Cross)
    try {
      const rows = Array.isArray(byKey.sunderData) ? byKey.sunderData : [];
      if (rows.length) {
        const eligible = rows.filter(r => {
          const nm = nameKey(r.character_name || r.player_name || '');
          if (!nm) return false;
          if (!confirmed.has(nm)) return false;
          if (mainTanks.has(nm)) return false; // Only exclude Skull and Cross tanks
          return true;
        });
        if (eligible.length) {
          const counts = eligible.map(r => Number(r.sunder_count)||0);
          const avg = counts.reduce((a,b)=>a+b,0) / eligible.length;
          if (avg > 0) {
            const computePts = (count) => {
              const pct = (Number(count)||0) / avg * 100;
              const raw = (() => {
                if (pct < 25) return -20;
                if (pct < 50) return -15;
                if (pct < 75) return -10;
                if (pct < 90) return -5;
                if (pct <= 109) return 0;
                if (pct <= 124) return 5;
                return 10;
              })();
              // Minimum threshold: 50+ sunders can never be deducted
              return (Number(count) >= 50 && raw < 0) ? 0 : raw;
            };
            rows.forEach(r => {
              const nm = r.character_name || r.player_name || '';
              const key = nameKey(nm);
              if (!confirmed.has(key)) return;
              if (mainTanks.has(key)) return; // Only exclude Skull and Cross tanks (from assignments panel)
              const pts = computePts(r.sunder_count);
              // Award points even if pts is 0 (removed the "if (pts)" check)
              addRow('sunder', nm, pts);
            });
          }
        }
      }
    } catch {}

    // Frost Resistance: rely on API-calculated points; include confirmed players; negative points are allowed
    try {
      (byKey.frostResistanceData||[]).forEach(row => {
        const nm = row.character_name || row.player_name; if (!nm) return;
        const k = nameKey(nm); if (!confirmed.has(k)) return;
        addRow('frost_resistance', nm, Number(row.points)||0);
      });
    } catch {}

    // Attendance streaks and guild members
    try {
      const playersSet = new Set((allPlayers||[]).map(p=>nameKey(p.name)));
      (byKey.playerStreaks||[]).forEach(r=>{
        const nm = r.character_name; if (!nm) return;
        const k = nameKey(nm);
        // Prefer confirmed participants; fallback to engine players list if confirmed miss
        if (!confirmed.has(k) && !playersSet.has(k)) return;
        const s = Number(r.player_streak)||0; let pts=0; if(s>=8) pts=15; else if(s===7) pts=12; else if(s===6) pts=9; else if(s===5) pts=6; else if(s===4) pts=3; if(pts) addRow('attendance_streaks', nm, pts);
      });
      (byKey.guildMembers||[]).forEach(r=>{ const nm=r.character_name; if(!nm) return; const k=nameKey(nm); if(!confirmed.has(k) && !playersSet.has(k)) return; addRow('guild_members', nm, 10); });
    } catch {}

    // Too Low DPS/HPS
    try {
      const aftMin = byKey.raidStats?.stats?.activeFightTime; if (aftMin) {
        const sec = aftMin*60;
        (byKey.logData||[]).forEach(p=>{
          if (shouldIgnorePlayer(p.character_name)) return; const key=nameKey(p.character_name); const role=String(byKey.primaryRoles?.[key]||'').toLowerCase();
          if (role==='dps') { const dps=(parseFloat(p.damage_amount)||0)/sec; let pts=0; if(dps<150) pts=-100; else if(dps<200) pts=-50; else if(dps<250) pts=-25; if(pts) addRow('too_low_damage', p.character_name, pts); }
          else if (role==='healer') { const hps=(parseFloat(p.healing_amount)||0)/sec; let pts=0; if(hps<85) pts=-100; else if(hps<100) pts=-50; else if(hps<125) pts=-25; if(pts) addRow('too_low_healing', p.character_name, pts); }
        });
      }
    } catch {}

    // Manual rewards: points vs gold (accept all manual entries; gold always reduces shared pot)
    let manualGoldPayoutTotal = 0;
    try {
      (byKey.manualRewardsData||[]).forEach(e=>{
        const isGold = !!(e && (e.is_gold || /\[GOLD\]/i.test(String(e.description||''))));
        const val = Number(e.points)||0; const nm = e.player_name; if (!nm) return;
        if (isGold) { 
          if (val>0) manualGoldPayoutTotal += val; 
        }
        else { 
          // Removed confirmed check - accept all manual points entries
          addRow('manual_points', nm, val); 
        }
      });
    } catch {}

    // Build totals
    panels.forEach((m)=>{ m.forEach((pts,key)=>{ const nm = allPlayers.find(p=>nameKey(p.name)===key)?.name || key; addPts(nm, pts); }); });

    // Gold meta
    const totalGoldPot = await getGoldPotTotal(await pool.connect(), eventId).catch(()=>0) || 0; // fallback safe
    const sharedGoldPot = Math.floor((Number(totalGoldPot)||0) * 0.85);
    const adjusted = Math.max(0, sharedGoldPot - manualGoldPayoutTotal);
    let totalPointsAll = 0; totals.forEach(v=>{ totalPointsAll += Math.max(0, v.points); });
    const goldPerPoint = (adjusted>0 && totalPointsAll>0) ? (adjusted/totalPointsAll) : 0;
    totals.forEach(v=>{ v.gold = Math.floor(Math.max(0, v.points)*goldPerPoint); });

    // Serialize panels (include character_details for panels that have them)
    const panelsOut = Array.from(panels.entries()).map(([panel_key, m]) => ({ 
      panel_key, 
      rows: Array.from(m.entries()).map(([k, pts]) => {
        const row = { 
          name: allPlayers.find(p=>nameKey(p.name)===k)?.name || k, 
          points: Number(pts)||0 
        };
        // Add character_details if available for this panel
        if (panelDetails.has(panel_key)) {
          const details = panelDetails.get(panel_key).get(k);
          if (details) row.character_details = details;
        }
        return row;
      })
    }));
    console.log(`[ENGINE] Built panels output - total panels:${panelsOut.length}, faerie_fire rows:${(panelsOut.find(p=>p.panel_key==='faerie_fire')?.rows||[]).length}, windfury_totems rows:${(panelsOut.find(p=>p.panel_key==='windfury_totems')?.rows||[]).length}`);
    const players = allPlayers;

    // Digest
    const calc_digest = `auto:${players.length}:${panelsOut.length}:${adjusted}:${totalPointsAll}`;
    return {
      success: true,
      mode: 'auto',
      calc_digest,
      meta: {
        totalGoldPot: Number(totalGoldPot)||0,
        sharedGoldPot,
        manualGoldPayoutTotal: Number(manualGoldPayoutTotal)||0,
        sharedGoldPotAdjusted: adjusted,
        totalPointsAll,
        goldPerPoint
      },
      players: players.map(p=>({ name: p.name, class: p.class })),
      totals: Object.fromEntries(Array.from(totals.entries()).map(([k,v])=>[k,v])),
      panels: panelsOut,
      manual_gold: (byKey.manualRewardsData||[]).filter(e=>!!(e && (e.is_gold || /\[GOLD\]/i.test(String(e.description||'')))) && Number(e.points)>0).map(e=>({ name: e.player_name, gold: Number(e.points)||0 }))
    };
  }

  app.get('/api/rewards/:eventId/effective', async (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const { eventId } = req.params;
    
    // Set timeout to prevent hanging requests
    req.setTimeout(30000, () => {
      console.log('⏰ [REWARDS ENGINE] Request timeout for event:', eventId);
      if (!res.headersSent) {
        res.status(503).json({ success: false, message: 'Request timeout - server overloaded' });
      }
    });
    
    let client;
    try {
      // Add connection timeout
      client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database connection timeout')), 10000))
      ]);
      // Load snapshot entries first; treat presence of entries as locked materialization
      const [entries, manualRewards, totalGoldPot] = await Promise.all([
        getSnapshotEntries(client, eventId),
        getManualRewards(client, eventId),
        getGoldPotTotal(client, eventId)
      ]);
      const locked = (entries && entries.length > 0) ? true : await getSnapshotLocked(client, eventId);
      if (locked) {
        const out = await buildManualModeFromSnapshot(req, eventId, { entries, manualRewards, totalGoldPot });
        return res.json(out);
      }
      // Automatic mode (compute from datasets)
      const autoOut = await buildAutoModeFromDatasets(req, eventId);
      return res.json(autoOut);
    } catch (err) {
      console.error('❌ [REWARDS ENGINE] effective error:', err);
      
      // Handle specific error types with appropriate status codes
      if (err.message && err.message.includes('timeout')) {
        return res.status(503).json({ success: false, message: 'Database timeout - server overloaded' });
      }
      if (err.message && err.message.includes('pool')) {
        return res.status(503).json({ success: false, message: 'Database connection pool exhausted' });
      }
      
      return res.status(500).json({ success: false, message: 'Engine error', error: err && (err.message || String(err)) });
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseErr) {
          console.error('❌ [REWARDS ENGINE] Error releasing client:', releaseErr);
        }
      }
    }
  });

  app.get('/api/rewards/:eventId/debug', async (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const { eventId } = req.params;
    let client;
    try {
      client = await pool.connect();
      const locked = await getSnapshotLocked(client, eventId);
      const [entries, manualRewards, totalGoldPot] = await Promise.all([
        getSnapshotEntries(client, eventId),
        getManualRewards(client, eventId),
        getGoldPotTotal(client, eventId)
      ]);
      // Build both views to compute panel diffs
      const baseUrl = req.protocol + '://' + req.get('host');
      const autoOut = await buildAutoModeFromDatasets(req, eventId).catch(()=>null);
      const manualOut = await buildManualModeFromSnapshot(req, eventId, { entries, manualRewards, totalGoldPot });
      const src = locked ? manualOut : autoOut;
      const other = locked ? autoOut : manualOut;
      const byKey = (panels)=>{
        const m=new Map();
        (panels||[]).forEach(p=>{
          const sum=(p.rows||[]).reduce((a,r)=>a+((+r.points)||0),0);
          m.set(p.panel_key, sum);
        });
        return m;
      };
      const aMap = byKey(other?.panels||[]);
      const mMap = byKey(src?.panels||[]);
      const keys = Array.from(new Set([...(aMap.keys()), ...(mMap.keys())])).sort();
      const panel_diff = keys.map(k=>({ panel_key:k, current:(mMap.get(k)||0), other:(aMap.get(k)||0), delta:(mMap.get(k)||0)-(aMap.get(k)||0) }))
                            .filter(r=>r.delta!==0);

      // Detailed manual_points diff (who contributes to the delta)
      const lower = (s)=> String(s||'').trim().toLowerCase();
      const sumRowsByName = (out, key) => {
        const map = new Map();
        const p = (out?.panels||[]).find(pp => String(pp.panel_key) === key);
        const rows = Array.isArray(p?.rows) ? p.rows : [];
        rows.forEach(r => {
          const k = lower(r.name);
          const v = Number(r.points)||0;
          if (!k || !v) return;
          map.set(k, (map.get(k)||0) + v);
        });
        return map;
      };
      const manMap = sumRowsByName(manualOut, 'manual_points');
      const autMap = sumRowsByName(autoOut, 'manual_points');
      const extraInManual = [];
      const allNames = new Set([ ...Array.from(manMap.keys()), ...Array.from(autMap.keys()) ]);
      allNames.forEach(n => {
        const mv = manMap.get(n)||0;
        const av = autMap.get(n)||0;
        if (mv > av) {
          extraInManual.push({ name: n, manual_points: mv, auto_points: av, delta: mv - av });
        }
      });
      extraInManual.sort((a,b)=> (b.delta - a.delta) || a.name.localeCompare(b.name));

      return res.json({
        success: true,
        mode: locked ? 'manual' : 'auto',
        inputs: {
          snapshot_locked: locked,
          snapshot_entries_count: entries.length,
          manual_rewards_count: manualRewards.length,
          totalGoldPot
        },
        sample: {
          entries: entries.slice(0, 5),
          manualRewards: manualRewards.slice(0, 5)
        },
        panel_diff,
        manual_points_diff: {
          current_total: mMap.get('manual_points')||0,
          other_total: aMap.get('manual_points')||0,
          delta_total: (mMap.get('manual_points')||0) - (aMap.get('manual_points')||0),
          extra_in_manual: extraInManual
        }
      });
    } catch (err) {
      console.error('❌ [REWARDS ENGINE] debug error:', err);
      return res.status(500).json({ success: false, message: 'Engine debug error', error: err && (err.message || String(err)) });
    } finally {
      if (client) client.release();
    }
  });
};
