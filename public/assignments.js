(function() {

  /**
   * Classifies Gothik healers into Human and Undead sides using a role-aware algorithm.
   *
   * Instead of hardcoding group numbers, this inspects each group's composition
   * (looking for Warriors and Rogues) to determine melee groups, then assigns
   * healers accordingly with Priest/Group1 overrides, Shaman minimum enforcement,
   * and Druid-based balancing.
   *
   * @param {Array} roster - Full raid roster (all members, not just healers)
   * @param {Function} [filterFn] - Optional filter function (e.g. filterAssignable).
   *                                 If omitted, all healers are considered assignable.
   * @returns {{ humanSide: Array, undeadSide: Array }} Two arrays of healer roster members
   */
  function classifyGothikHealers(roster, filterFn) {
    const cls = (r) => String(r.class_name || '').toLowerCase();
    const gid = (r) => Number(r.party_id);

    // Step 1 — Identify melee groups (contain a Warrior or Rogue). Group 1 excluded (tank group).
    const meleeGroups = new Set();
    roster.forEach(r => {
      const group = gid(r);
      if (group === 1) return; // group 1 is always tank group, never melee
      if (cls(r) === 'warrior' || cls(r) === 'rogue') {
        meleeGroups.add(group);
      }
    });

    // Step 2 — Collect all assignable healers
    const isHealer = (r) => ['shaman', 'priest', 'druid'].includes(cls(r));
    const allHealers = typeof filterFn === 'function'
      ? filterFn(roster.filter(isHealer))
      : roster.filter(isHealer);

    // Step 3 — Initial side assignment
    const humanSide = [];
    const undeadSide = [];
    allHealers.forEach(r => {
      const className = cls(r);
      const group = gid(r);
      if (className === 'priest') {
        // Priests always go Human side
        humanSide.push(r);
      } else if (group === 1) {
        // Group 1 healers always go Human side (tank group)
        humanSide.push(r);
      } else if (meleeGroups.has(group)) {
        // Healers in melee groups go Undead side
        undeadSide.push(r);
      } else {
        // All other healers go Human side
        humanSide.push(r);
      }
    });

    // Step 4 — Enforce minimum 2 Shamans on Human side
    const humanShamans = humanSide.filter(r => cls(r) === 'shaman');
    let shamansNeeded = 2 - humanShamans.length;
    if (shamansNeeded > 0) {
      // First try non-melee-group Shamans from Undead side
      const undeadShamansNonMelee = undeadSide
        .filter(r => cls(r) === 'shaman' && !meleeGroups.has(gid(r)))
        .sort((a, b) => gid(b) - gid(a)); // highest group first
      for (const s of undeadShamansNonMelee) {
        if (shamansNeeded <= 0) break;
        undeadSide.splice(undeadSide.indexOf(s), 1);
        humanSide.push(s);
        shamansNeeded--;
      }
      // Then pull from melee-group Shamans, highest group number first
      if (shamansNeeded > 0) {
        const undeadShamansMelee = undeadSide
          .filter(r => cls(r) === 'shaman')
          .sort((a, b) => gid(b) - gid(a));
        for (const s of undeadShamansMelee) {
          if (shamansNeeded <= 0) break;
          undeadSide.splice(undeadSide.indexOf(s), 1);
          humanSide.push(s);
          shamansNeeded--;
        }
      }
    }

    // Step 5 — Balance with Druids
    const total = humanSide.length + undeadSide.length;
    const undeadTarget = Math.ceil(total / 2);
    const humanTarget = Math.floor(total / 2);

    // Move Druids to achieve balance
    while (humanSide.length > humanTarget) {
      // Human has too many — move Druids from Human to Undead (highest group first)
      const movable = humanSide
        .filter(r => cls(r) === 'druid')
        .sort((a, b) => gid(b) - gid(a));
      if (movable.length === 0) break;
      const d = movable[0];
      humanSide.splice(humanSide.indexOf(d), 1);
      undeadSide.push(d);
    }

    while (undeadSide.length > undeadTarget) {
      // Undead has too many — move Druids from Undead to Human (lowest group first)
      const movable = undeadSide
        .filter(r => cls(r) === 'druid')
        .sort((a, b) => gid(a) - gid(b));
      if (movable.length === 0) break;
      const d = movable[0];
      undeadSide.splice(undeadSide.indexOf(d), 1);
      humanSide.push(d);
    }

    return { humanSide, undeadSide };
  }

  // Utility: Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Determine current wing from location pathname
  function getCurrentWing() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('event');
    // Supported patterns:
    // /event/:eventId/assignments
    // /event/:eventId/assignments/:wing
    if (idx >= 0) {
      const afterEvent = parts.slice(idx);
      // afterEvent: ['event', ':eventId', 'assignments', ':wing?']
      if (afterEvent[2] === 'assignments') {
        return afterEvent[3] || 'main';
      }
    }
    // Non-event routes: /assignments or /assignments/:wing
    const aIdx = parts.indexOf('assignments');
    if (aIdx >= 0) {
      return parts[aIdx + 1] || 'main';
    }
    return 'main';
  }

  // Floating sub-navigation: set hrefs to real subpages and active state
  async function initializeFloatingNavigation() {
    const nav = document.getElementById('assignments-floating-nav');
    if (!nav) return;
    const buttonsContainer = document.getElementById('assignments-nav-buttons') || nav.querySelector('.nav-buttons');
    const eventId = getActiveEventId();
    let isNax = false; // default to non-NAX unless explicitly told otherwise
    try {
      if (eventId) {
        const res = await fetch(`/api/events/${eventId}/channel-flags`);
        const data = await res.json();
        // Use backend-provided flag whenever available
        if (data && data.success && typeof data.isNax === 'boolean') {
          isNax = data.isNax;
        }
      }
    } catch {}

    // If not NAX, replace nav with simplified set
    if (!isNax && buttonsContainer) {
      buttonsContainer.innerHTML = `
        <a class="nav-btn" data-wing="main" href="#"><i class="fas fa-home"></i> <span>Main</span></a>
        <a class="nav-btn" data-wing="myassignments" href="#"><i class="fas fa-user-check"></i> <span>My Assignments</span></a>
        <a class="nav-btn" data-wing="allassignments" href="#"><i class="fas fa-th-list"></i> <span>Compact</span></a>
        <a class="nav-btn" data-wing="aq40" href="#"><i class="fas fa-mountain"></i> <span>AQ40</span></a>
        <a class="nav-btn" data-wing="bwl" href="#"><i class="fas fa-fire"></i> <span>BWL</span></a>
        <a class="nav-btn" data-wing="mc" href="#"><i class="fas fa-fire-alt"></i> <span>MC</span></a>
      `;
    }

    const buttons = Array.from(nav.querySelectorAll('.nav-btn'));
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('event');
    const base = (idx >= 0 && parts[idx+1]) ? `/event/${parts[idx+1]}/assignments` : '/assignments';
    const currentWing = getCurrentWing();

    buttons.forEach(btn => {
      const wing = btn.dataset.wing || 'main';
      btn.setAttribute('href', wing === 'main' ? `${base}` : `${base}/${wing}`);
      btn.classList.toggle('active', wing === currentWing);
    });
  }

  function getActiveEventId() {
    // Prefer URL param /event/:eventId/assignments
    const parts = window.location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('event');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    // Fallback to localStorage
    return localStorage.getItem('activeEventSession');
  }

  function classToCssName(cls) {
    return String(cls || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
  }

  function getSpecIconHtml(specName, characterClass, specEmote, specIconUrl, isPlaceholder = false) {
    // Placeholder players get white skull icon
    if (isPlaceholder) {
      return `<i class="fas fa-skull spec-icon placeholder-icon" style="color: #ffffff; font-size: 36px; filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.8));" title="Placeholder - No Discord ID"></i>`;
    }
    if (specEmote) {
      return `<img src="https://cdn.discordapp.com/emojis/${specEmote}.png" class="spec-icon" alt="${specName || ''}" width="50" loading="lazy" decoding="async">`;
    }
    const url = specIconUrl || '';
    if (url) return `<img src="${url}" class="spec-icon" alt="${specName || ''}" width="50" loading="lazy" decoding="async">`;
    const canonicalClass = (characterClass || 'Unknown').trim();
    return `<i class="fas fa-user-circle spec-icon unknown-spec" style="color: #aaa;" title="${canonicalClass}"></i>`;
  }

  const VALID_CLASS_SET = new Set(['warrior','paladin','hunter','rogue','priest','shaman','mage','warlock','druid']);

  function getRosterClassByName(roster, name) {
    const lower = String(name || '').toLowerCase();
    const r = Array.isArray(roster) ? roster.find(x => String(x.character_name || '').toLowerCase() === lower) : null;
    return r?.class_name || '';
  }

  function getRosterClassColorByName(roster, name) {
    const lower = String(name || '').toLowerCase();
    const r = Array.isArray(roster) ? roster.find(x => String(x.character_name || '').toLowerCase() === lower) : null;
    const color = r?.class_color || '';
    if (color) return color;
    const canonical = canonicalizeClass(r?.class_name || '', '');
    const CLASS_COLORS = { warrior:'#C79C6E', paladin:'#F58CBA', hunter:'#ABD473', rogue:'#FFF569', priest:'#FFFFFF', shaman:'#0070DE', mage:'#69CCF0', warlock:'#9482C9', druid:'#FF7D0A', unknown:'#e0e0e0' };
    return CLASS_COLORS[String(canonical).toLowerCase()] || CLASS_COLORS.unknown;
  }

  function canonicalizeClass(rawClass, rosterFallback) {
    const a = String(rawClass || '').trim().toLowerCase();
    const b = String(rosterFallback || '').trim().toLowerCase();
    let candidate = a || b;
    if (candidate === 'tank') candidate = 'warrior';
    if (VALID_CLASS_SET.has(candidate)) return candidate;
    if (VALID_CLASS_SET.has(b)) return b;
    return 'unknown';
  }

  async function fetchUser() {
    try {
      const res = await fetch('/user');
      return await res.json();
    } catch {
      return { loggedIn: false };
    }
  }

  async function fetchRoster(eventId) {
    try {
      const res = await fetch(`/api/assignments/${eventId}/roster`);
      const data = await res.json();
      if (!data.success) return [];
      return Array.isArray(data.roster) ? data.roster : [];
    } catch { return []; }
  }

  // No-assignments helpers (shared with roster page via localStorage)
  function getNoAssignmentsMap() {
    try { return JSON.parse(localStorage.getItem('noAssignmentsMap') || '{}') || {}; } catch { return {}; }
  }
  function isNoAssignmentsByUserId(userId) {
    if (!userId) return false;
    const map = getNoAssignmentsMap();
    return !!map[String(userId)];
  }
  function isNoAssignmentsRosterRow(row) {
    let id = row?.discord_user_id || row?.discordId || row?.discord_userid || row?.discord_id || row?.discord;
    if (!id) {
      try {
        const name = String(row?.character_name || '').toLowerCase();
        if (name && Array.isArray(window.__lastFetchedRosterForAssignments)) {
          const m = window.__lastFetchedRosterForAssignments.find(r => String(r.character_name||'').toLowerCase() === name);
          if (m) id = m.discord_user_id || m.discordId || m.discord_userid || m.discord_id || m.discord;
        }
      } catch {}
    }
    return isNoAssignmentsByUserId(id);
  }
  function filterAssignable(list) {
    return (Array.isArray(list) ? list : []).filter(r => !isNoAssignmentsRosterRow(r));
  }

  function sortByGroupSlotAsc(a, b) {
    return ((Number(a.party_id)||99) - (Number(b.party_id)||99)) || ((Number(a.slot_id)||99) - (Number(b.slot_id)||99));
  }

  // Ensure toAdd entries replace flagged players with next suitable candidate
  function ensureToAddReplacements(toAdd, roster, opts={}) {
    const preserveClass = opts.preserveClass !== false; // default true
    const rosterAsc = (Array.isArray(roster)?roster:[]).slice().sort(sortByGroupSlotAsc);
    function findReplacement(entry) {
      const wantClass = preserveClass ? String(entry?.r?.class_name||'').toLowerCase() : '';
      // If entry.r has character_name, try to start after that player's index to approximate "next in line"
      const baseName = String(entry?.r?.character_name||'').toLowerCase();
      let startIdx = 0;
      if (baseName) {
        const idx = rosterAsc.findIndex(r => String(r.character_name||'').toLowerCase() === baseName);
        if (idx >= 0) startIdx = idx + 1;
      }
      // First pass: same class
      if (wantClass) {
        for (let i = startIdx; i < rosterAsc.length; i++) {
          const r = rosterAsc[i];
          if (String(r.class_name||'').toLowerCase() !== wantClass) continue;
          if (!isNoAssignmentsRosterRow(r)) return r;
        }
        for (let i = 0; i < startIdx; i++) {
          const r = rosterAsc[i];
          if (String(r.class_name||'').toLowerCase() !== wantClass) continue;
          if (!isNoAssignmentsRosterRow(r)) return r;
        }
      }
      // Fallback: any class
      for (let i = startIdx; i < rosterAsc.length; i++) {
        const r = rosterAsc[i];
        if (!isNoAssignmentsRosterRow(r)) return r;
      }
      for (let i = 0; i < startIdx; i++) {
        const r = rosterAsc[i];
        if (!isNoAssignmentsRosterRow(r)) return r;
      }
      return null;
    }
    return (Array.isArray(toAdd)?toAdd:[]).map(entry => {
      if (!entry || !entry.r) return entry;
      if (!isNoAssignmentsRosterRow(entry.r)) return entry;
      const rep = findReplacement(entry);
      if (rep) return { ...entry, r: rep };
      // If no replacement found, drop this entry by returning null; caller will filter
      return null;
    }).filter(Boolean);
  }

  /**
   * Renders a collapsible "Alternative tank options" panel below the horsemen grid.
   * Shows non-Warrior raid members whose Warrior alts have 4H tanking experience.
   *
   * @param {HTMLElement} horseGridWrap - The horsemen grid wrapper element to append to
   * @param {Array} roster - Current raid roster
   */
  async function renderAlternativeTankOptions(horseGridWrap, roster) {
    const altPanel = document.createElement('div');
    altPanel.style.marginTop = '12px';
    altPanel.style.borderTop = '1px solid rgba(255,255,255,0.1)';

    // Header with toggle
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.style.padding = '10px 8px';
    header.style.cursor = 'pointer';
    header.style.userSelect = 'none';

    const arrow = document.createElement('span');
    arrow.textContent = '▶';
    arrow.style.color = '#9ca3af';
    arrow.style.fontSize = '12px';
    arrow.style.transition = 'transform 0.2s';

    const title = document.createElement('span');
    title.textContent = 'Alternative tank options';
    title.style.color = '#e5e7eb';
    title.style.fontWeight = '600';
    title.style.fontSize = '14px';

    header.appendChild(arrow);
    header.appendChild(title);

    const body = document.createElement('div');
    body.style.display = 'none';
    body.style.padding = '4px 8px 10px';

    let collapsed = true;
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : 'block';
      arrow.style.transform = collapsed ? '' : 'rotate(90deg)';
      arrow.textContent = collapsed ? '▶' : '▼';
    });

    altPanel.appendChild(header);
    altPanel.appendChild(body);
    horseGridWrap.appendChild(altPanel);

    // Fetch data in parallel
    try {
      const expRes = await fetch('/api/four-horsemen-experience');
      const expData = await expRes.json();
      const expMap = {};
      if (expData.success && Array.isArray(expData.data)) {
        expData.data.forEach(e => { expMap[String(e.character_name).toLowerCase()] = e.tank_count || 0; });
      }

      // Find non-Warrior roster members
      const nonWarriors = (Array.isArray(roster) ? roster : []).filter(r => {
        const cls = canonicalizeClass(String(r.class_name || ''));
        return cls !== 'warrior' && cls !== 'unknown';
      });

      if (nonWarriors.length === 0) {
        body.innerHTML = '<div style="color:#6b7280;font-style:italic;padding:4px 0;">No alternative tank options available</div>';
        return;
      }

      // Collect discord IDs and character names for batch alt lookup
      const discordIds = [];
      const characterNames = [];
      const rosterByKey = {};

      nonWarriors.forEach(r => {
        const did = r.discord_user_id || r.discordId || r.discord_userid || r.discord_id || '';
        const name = String(r.character_name || '').trim();
        if (did) {
          discordIds.push(String(did));
          rosterByKey[`discord:${did}`] = r;
        }
        if (name) {
          characterNames.push(name);
          rosterByKey[`name:${name}`] = r;
        }
      });

      const batchRes = await fetch('/api/guildies/alts-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordIds, characterNames })
      });
      const batchData = await batchRes.json();

      if (!batchData.success) {
        body.innerHTML = '<div style="color:#6b7280;font-style:italic;padding:4px 0;">No alternative tank options available</div>';
        return;
      }

      // Build alternatives list
      const alternatives = [];
      const seen = new Set(); // avoid duplicates

      for (const [key, entry] of Object.entries(batchData.data || {})) {
        const rosterRow = rosterByKey[key];
        if (!rosterRow) continue;
        const rosterName = String(rosterRow.character_name || '');
        const rosterClass = canonicalizeClass(String(rosterRow.class_name || ''));

        const alts = Array.isArray(entry.alts) ? entry.alts : [];
        for (const alt of alts) {
          const altClass = String(alt.class || '').toLowerCase();
          if (altClass !== 'warrior') continue;
          // Skip if alt is the same as the current character
          if (String(alt.character_name || '').toLowerCase() === rosterName.toLowerCase()) continue;

          const altName = String(alt.character_name || '');
          const tankCount = expMap[altName.toLowerCase()] || 0;

          const dedupKey = `${rosterName.toLowerCase()}|${altName.toLowerCase()}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);

          alternatives.push({ rosterName, rosterClass, altName, tankCount });
        }
      }

      if (alternatives.length === 0) {
        body.innerHTML = '<div style="color:#6b7280;font-style:italic;padding:4px 0;">No alternative tank options available</div>';
        return;
      }

      // Sort by tank count descending
      alternatives.sort((a, b) => b.tankCount - a.tankCount);

      // Render rows — zero-experience alts are visually dimmed
      alternatives.forEach(alt => {
        const row = document.createElement('div');
        row.style.padding = '5px 4px';
        row.style.fontSize = '13px';
        row.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        const isZeroExp = alt.tankCount === 0;
        row.style.color = isZeroExp ? '#6b7280' : '#e5e7eb';
        row.style.fontStyle = isZeroExp ? 'italic' : 'normal';
        const classDisplay = alt.rosterClass.charAt(0).toUpperCase() + alt.rosterClass.slice(1);
        row.textContent = `Currently raiding: ${alt.rosterName} (${classDisplay}) | Alt warrior: ${alt.altName} | 4H experience: ${alt.tankCount} time${alt.tankCount !== 1 ? 's' : ''}`;
        body.appendChild(row);
      });
    } catch (err) {
      body.innerHTML = '<div style="color:#6b7280;font-style:italic;padding:4px 0;">No alternative tank options available</div>';
    }
  }

  function buildPanel(panel, user, roster) {
    const { dungeon, wing, boss, strategy_text, image_url, default_strategy_text } = panel;
    const canManage = !!(user && user.loggedIn && user.hasManagementRole);
    const headerTitle = boss || 'Encounter';
    const entries = Array.isArray(panel.entries) ? panel.entries : [];
    // Hide special-grid placeholder entries from the normal list
    const visibleEntries = entries.filter(en => {
      const a = String(en.assignment || '');
      return !(a.startsWith('__HGRID__:') || a.startsWith('__SPORE__:') || a.startsWith('__KEL__:') || a.startsWith('__CTHUN__:'));
    });
    const nameToDiscordId = new Map((Array.isArray(roster)?roster:[]).map(r => [String(r.character_name||'').toLowerCase(), r.discord_user_id]));

    const panelDiv = document.createElement('div');
    panelDiv.className = 'manual-rewards-section main-panel';
    panelDiv.dataset.panelBoss = String(boss || '').toLowerCase();
    
    // Hide Cleave tactics panel by default (toggle will show it)
    if (String(boss || '').includes('(Cleave)')) {
      panelDiv.style.display = 'none';
    }

    const header = document.createElement('div');
    header.className = 'section-header assignment-header';
    let bossIconUrl = panel.boss_icon_url || '';
    const bossKeyForIcon = String(headerTitle || boss || '').toLowerCase();
    if (!bossIconUrl) {
      if (bossKeyForIcon.includes('faerlina')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754815959/3kvUdFR_kx7gif.png';
      } else if (bossKeyForIcon.includes('maex')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754984024/Maexx15928_o8jkro.png';
      } else if (bossKeyForIcon.includes('razu')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754989023/182497_v3yeko.webp';
      } else if (bossKeyForIcon.includes('goth')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1768217339/25200_gkfm0m.webp';
      } else if (bossKeyForIcon.includes('horse')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754993478/-16062_absih8.png';
      } else if (bossKeyForIcon.includes('heig')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755075234/16309_kpg0jp.png';
      } else if (bossKeyForIcon.includes('noth')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755074097/16590_ezmekl.png';
      } else if (bossKeyForIcon.includes('skeram')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756629772/prohpet_skarem_mjxxzt.png';
      } else if (bossKeyForIcon.includes('sartura')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756630715/sartura_soipg5.png';
      } else if (bossKeyForIcon.includes('fank')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756630878/fankriss_ju6b9b.png';
      } else if (bossKeyForIcon.includes('visc')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631416/viscidus_whpcsx.png';
      } else if (bossKeyForIcon.includes('huhu') || bossKeyForIcon.includes('huhuran')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631406/huhuran_uhgd1p.png';
      } else if (bossKeyForIcon.includes('twins trash')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631415/twinstrash_xwopji.png';
      } else if (bossKeyForIcon.includes('twin emperors')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631414/twins_ufymht.png';
      } else if (bossKeyForIcon.includes('ouro')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631413/ouro_vvmd0k.png';
      } else if (bossKeyForIcon.includes("c'thun") || bossKeyForIcon.includes('cthun')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631406/cthun_ke0e7s.png';
      } else if (bossKeyForIcon.includes('bug')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756630087/bug_trio_ofvrvg.png';
      } else if (bossKeyForIcon.includes('loatheb')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755080534/Fungal_monster_s0zutr.webp';
      } else if (bossKeyForIcon.includes('patch')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755085582/patchwerk_wfd5z4.gif';
      } else if (bossKeyForIcon.includes('grobb')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755086620/24792_gahise.png';
      } else if (bossKeyForIcon.includes('thadd')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755087787/dfka9xt-cbdf45c1-45b9-460b-a997-5a46c4de0a65_txsidf.png';
      } else if (bossKeyForIcon.includes('gluth')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755087393/27103_rdbmzc.png';
      } else if (bossKeyForIcon.includes('sapph')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755093137/oUwfSmi_mp74xg.gif';
      } else if (bossKeyForIcon.includes('kel')) {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755110522/15945_eop7se.png';
      } else if (bossKeyForIcon.includes('demo shout') || bossKeyForIcon.includes('demoshout')) {
        bossIconUrl = 'https://wow.zamimg.com/images/wow/icons/large/ability_warrior_warcry.jpg';
      } else {
        bossIconUrl = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754809667/30800_etmqmc.png';
      }
    }
    // For Four Horsemen, add tactics toggle (Management only)
    const isHorsePanel = String(boss || '').toLowerCase().includes('horse');
    const isCleave = String(boss || '').includes('(Cleave)');
    const tacticsToggleHtml = (isHorsePanel && canManage) ? `
      <div class="tactics-toggle-wrap" style="display: flex; align-items: center; gap: 8px; margin-right: 12px;">
        <span style="color: #e5e7eb; font-size: 14px; font-weight: 600;">Tactics:</span>
        <button class="tactics-toggle-btn" data-current-tactics="${isCleave ? 'cleave' : 'classic'}" style="padding: 6px 12px; border-radius: 6px; background: ${isCleave ? '#8b5cf6' : '#3b82f6'}; color: white; border: none; cursor: pointer; font-weight: 600; font-size: 13px;">
          ${isCleave ? 'Cleave' : 'Classic'}
        </button>
      </div>
    ` : '';
    
    header.innerHTML = `
      <h2><img src="${bossIconUrl}" alt="Boss" class="boss-icon"> ${headerTitle}</h2>
      <div class="assignments-actions" ${canManage ? '' : 'style="display:none;"'}>
        ${tacticsToggleHtml}
        <button class="btn-add-defaults" title="Auto assign" data-panel-key="${dungeon}|${wing || ''}|${boss}"><i class="fas fa-magic"></i> Auto assign</button>
        <button class="btn-edit" title="Edit Panel" data-panel-key="${dungeon}|${wing || ''}|${boss}"><i class="fas fa-edit"></i> Edit</button>
        <button class="btn-save" style="display:none;" title="Save" data-panel-key="${dungeon}|${wing || ''}|${boss}"><i class="fas fa-save"></i> Save</button>
      </div>
    `;
    // All boss icons use uniform CSS sizing; no per-boss overrides

    const content = document.createElement('div');
    content.className = 'manual-rewards-content';

    const topLayout = document.createElement('div');
    topLayout.style.display = 'grid';
    topLayout.style.gridTemplateColumns = '2fr 1fr';
    topLayout.style.gap = '16px';
    topLayout.style.marginBottom = '16px';

    // Image / image URL
    const imgWrapper = document.createElement('div');
    let defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754768041/Anubian_mid_eeb1zj.jpg';
    let defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754768042/Anubian_full_s1fmvs.png';
    const panelKeyLower = String(headerTitle || boss || '').toLowerCase();
    if (panelKeyLower.includes('faerlina')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755113421/Faerlina_mid_dpcain.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755113422/Faerlina_full_osemdc.png';
    } else if (panelKeyLower.includes('maex')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755118454/Maexxna_mid_no9hfo.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755118572/Maexxna_full_uje68o.png';
    } else if (panelKeyLower.includes('razu')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755119195/Raz_mid_kffysm.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755119197/Raz_full_ixeyyh.png';
    } else if (panelKeyLower.includes('goth')) {
      // Default to Human side for Gothik; we'll provide a toggle to switch sides
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755120092/Gothik_human_mid_mwb7ok.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755120092/Gothik_human_mid_mwb7ok.jpg';
    } else if (panelKeyLower.includes('patch')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755121524/Patchwerk_mid_zgey7f.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755121524/Patchwerk_full_s90vtk.png';
    } else if (panelKeyLower.includes('grobb')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755122356/Grobbulus_mid_aw4tig.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755122356/Grobbulus_full_ftbwtq.png';
    } else if (panelKeyLower.includes('gluth')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755150437/Gluth_mid_ju7cbx.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755150438/Gluth_full_bkqgdj.png';
    } else if (panelKeyLower.includes('noth')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756245157/Noth_mid_rvctaf.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756245157/Noth_full_o4oywn.png';
    } else if (panelKeyLower.includes('heig')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756331779/Heigan_mid_lk1jwv.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756331779/Heigan_full_glmqtw.png';
    } else if (panelKeyLower.includes('loatheb')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756332738/Loatheb_mid_csdb1j.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756332739/Loatheb_full_wtnowa.png';
    } else if (panelKeyLower.includes('thadd')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756597753/Thaddius-mid2_rz7754.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756597753/Thaddius-full_ndtgba.png';
    } else if (panelKeyLower.includes('horse')) {
      // Use placeholder for Cleave tactics, specific image for Classic
      if (panelKeyLower.includes('cleave')) {
        defaultMid = 'https://placehold.co/1200x675?text=The+Four+Horsemen+Cleave';
        defaultFull = panel.image_url_full || 'https://placehold.co/1200x675?text=The+Four+Horsemen+Cleave';
      } else {
        defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848571/4h_mid_gorjji.jpg';
        defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848571/4h_full_o1bgfc.png';
      }
    } else if (panelKeyLower.includes('sapph')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755847769/Saph_mid_ix6tiz.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755847779/Saph_full_kwkgel.png';
    } else if (panelKeyLower.includes('kel')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755847769/KT_mid_yuhor1.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755847769/KT_full_pmo4fd.png';
    } else if (panelKeyLower.includes("c'thun") || panelKeyLower.includes('cthun')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756133303/aq40positions_hbtfb6.png';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756133303/aq40positions_hbtfb6.png';
    } else if (panelKeyLower.includes('twins trash')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758751886/twins_trash_mid_dtkzg9.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758751886/twins_trash_full_cwaijs.png';
    } else if (panelKeyLower.includes('twin emperors') || (panelKeyLower.includes('twin') && !panelKeyLower.includes('trash'))) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
    } else if (panelKeyLower.includes('skeram') || panelKeyLower.includes('prophet')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748092/Skeram_mid_xk7ad9.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748093/Skeram_full_qpryfl.png';
    } else if (panelKeyLower.includes('bug')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748177/bugtrie_mid_vszif2.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748177/bigtrio_full_t5yevm.png';
    } else if (panelKeyLower.includes('sartura')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748212/Sartura_mid_npr3zh.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748212/Sartura_full_jzoyqe.png';
    } else if (panelKeyLower.includes('fankriss') || panelKeyLower.includes('fank')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
    } else if (panelKeyLower.includes('viscidus') || panelKeyLower.includes('visc')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
    } else if (panelKeyLower.includes('huhuran') || panelKeyLower.includes('huhu')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
    } else if (panelKeyLower.includes('ouro')) {
      defaultMid = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
      defaultFull = panel.image_url_full || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg';
    }
    let displayImageUrl = (image_url && !String(image_url).includes('placehold.co')) ? image_url : defaultMid;
    if (panelKeyLower.includes('faerlina') || panelKeyLower.includes('maex') || panelKeyLower.includes('razu') || panelKeyLower.includes('goth') || panelKeyLower.includes('patch') || panelKeyLower.includes('grobb') || panelKeyLower.includes('gluth') || panelKeyLower.includes('noth') || panelKeyLower.includes('heig') || panelKeyLower.includes('loatheb') || panelKeyLower.includes('thadd') || panelKeyLower.includes('horse') || panelKeyLower.includes('sapph') || panelKeyLower.includes('kel') || panelKeyLower.includes("c'thun") || panelKeyLower.includes('cthun')) {
      displayImageUrl = defaultMid;
    }

    const imgLink = document.createElement('a');
    imgLink.href = (panel.image_url_full && panel.image_url_full.trim().length > 0)
      ? panel.image_url_full
      : ((panelKeyLower.includes('faerlina') || panelKeyLower.includes('maex') || panelKeyLower.includes('razu') || panelKeyLower.includes('goth') || panelKeyLower.includes('patch') || panelKeyLower.includes('grobb') || panelKeyLower.includes('gluth') || panelKeyLower.includes('noth') || panelKeyLower.includes('heig') || panelKeyLower.includes('loatheb') || panelKeyLower.includes('thadd') || panelKeyLower.includes('horse') || panelKeyLower.includes('sapph') || panelKeyLower.includes('kel') || panelKeyLower.includes('skeram') || panelKeyLower.includes('prophet') || panelKeyLower.includes('bug') || panelKeyLower.includes('sartura') || panelKeyLower.includes('fank') || panelKeyLower.includes('fankriss') || panelKeyLower.includes('visc') || panelKeyLower.includes('viscidus') || panelKeyLower.includes('huhu') || panelKeyLower.includes('huhuran') || panelKeyLower.includes('twin emperors') || panelKeyLower.includes('twins trash') || panelKeyLower.includes('ouro')) ? defaultFull : displayImageUrl);
    imgLink.target = '_blank';
    imgLink.rel = 'noopener noreferrer';
    const img = document.createElement('img');
    img.className = 'assignment-img';
    img.src = displayImageUrl;
    img.alt = `${headerTitle} positions`;
    imgLink.appendChild(img);
    imgWrapper.appendChild(imgLink);

    // Sapphiron, Kel'Thuzad, Gothik, Anub'Rekhan, Maexxna, Four Horsemen, Noth, AQ40 (Skeram, Fankriss, Viscidus, Twins, Ouro): autoplay a short preview video overlay on first scroll into view
    try {
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const saveData = navigator.connection && navigator.connection.saveData;
      const isSapphiron = panelKeyLower.includes('sapph');
      const isKelthuzad = panelKeyLower.includes('kel');
      const isGothik = panelKeyLower.includes('goth');
      const isAnub = panelKeyLower.includes('anub');
      const isMaex = panelKeyLower.includes('maex');
      const isFaerlina = panelKeyLower.includes('faerlina');
      const isPatch = panelKeyLower.includes('patch');
      const isThadd = panelKeyLower.includes('thadd');
      const isHeigan = panelKeyLower.includes('heig');
      const isGrobb = panelKeyLower.includes('grobb');
      const isGluth = panelKeyLower.includes('gluth');
      const isHorse = panelKeyLower.includes('horse');
      const isNoth = panelKeyLower.includes('noth');
      const isLoatheb = panelKeyLower.includes('loatheb');
      const isRazu = panelKeyLower.includes('razu');
      const isSkeram = panelKeyLower.includes('skeram') || panelKeyLower.includes('prophet');
      const isFankriss = panelKeyLower.includes('fankriss');
      const isViscidus = panelKeyLower.includes('viscidus');
      const isTwins = (panelKeyLower.includes('twin') && (panelKeyLower.includes('emperor') || panelKeyLower.includes('emperors'))) && !panelKeyLower.includes('trash');
      const isOuro = panelKeyLower.includes('ouro');
      const isBugTrio = panelKeyLower.includes('bug');
      const isSartura = panelKeyLower.includes('sartura');
      const isHuhuran = panelKeyLower.includes('huhuran') || panelKeyLower.includes('huhu');
      const isCthun = panelKeyLower.includes("c'thun") || panelKeyLower.includes('cthun');
      if (isSapphiron || isKelthuzad || isGothik || isAnub || isMaex || isFaerlina || isPatch || isThadd || isHeigan || isGrobb || isGluth || isHorse || isNoth || isLoatheb || isRazu || isSkeram || isFankriss || isViscidus || isTwins || isOuro || isBugTrio || isSartura || isHuhuran || isCthun) {
        const previewUrl =
          isSapphiron ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757148684/Sapphiron01_suteut.mp4' :
          isKelthuzad ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757148683/KT01_qywxls.mp4' :
          isGothik ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756022062/Gothik-human-side_znqy6h.mp4' :
          isAnub ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756024672/anub_xgkjtx.mp4' :
          isFaerlina ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757148685/Faerlina_g88kol.mp4' :
          isPatch ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757148685/patchwerk_ui_q0yzyt.mp4' :
          isThadd ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757148683/Thaddius1_ubs5h0.mp4' :
          isHeigan ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757148687/Heigan01_t8ysme.mp4' :
          isGrobb ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757196897/Grobbulus01_ebzmny.mp4' :
          isGluth ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757196897/Gluth_01_itfuow.mp4' :
          isHorse ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756148431/ForuHorseman_dipmqk.mp4' :
          isNoth ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756149354/NothThePlaguebringer_qree64.mp4' :
          isLoatheb ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756333046/Loatheb_r8mbox.mp4' :
          isRazu ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1757769485/Raz2_ihmjr6.mp4' :
          isSkeram ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756152423/prophet_skarem_nuv5hs.mp4' :
          isFankriss ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756152422/Fankriss_t6rtpo.mp4' :
          isViscidus ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756152421/Viscidus_qpezj6.mp4' :
          isTwins ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756152422/Twins_fwwulp.mp4' :
          isOuro ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1756152422/Ouro_bo7bxp.mp4' :
          isBugTrio ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1758574474/bug_trio_ladyiz.mp4' :
          isSartura ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1758574474/Satura_sgkciv.mp4' :
          isHuhuran ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1758574476/Huhuran01_vqndh2.mp4' :
          isCthun ? 'https://res.cloudinary.com/duthjs0c3/video/upload/v1758574474/cthun_cpqbsx.mp4' :
          'https://res.cloudinary.com/duthjs0c3/video/upload/v1756025139/Spider_l0hqmr.mp4';
        imgWrapper.style.position = 'relative';
        // Keep the tighter preview width for Sapphiron/Kel; let Gothik/Anub/Maex/Horsemen/Noth/Loatheb/Razuvious/AQ40 use full image width to match sizes exactly
        if (!(isGothik || isAnub || isMaex || isFaerlina || isPatch || isThadd || isHeigan || isGrobb || isGluth || isHorse || isNoth || isLoatheb || isRazu || isSkeram || isFankriss || isViscidus || isTwins || isOuro || isBugTrio || isSartura || isHuhuran || isCthun)) { try { imgWrapper.style.maxWidth = '720px'; } catch {} }
        try { imgWrapper.style.overflow = 'hidden'; } catch {}
        let played = false;

        function startPreview(io) {
          if (played) return;
          played = true;
          // Create an overlay exactly sized to the rendered image
          const overlay = document.createElement('div');
          overlay.style.position = 'absolute';
          overlay.style.left = '0';
          overlay.style.top = '0';
          overlay.style.width = '100%';
          overlay.style.pointerEvents = 'none';
          overlay.style.display = 'flex';
          overlay.style.alignItems = 'center';
          overlay.style.justifyContent = 'center';
          overlay.style.borderRadius = '8px';
          overlay.style.zIndex = '1';
          overlay.style.background = 'transparent';
          function syncOverlaySize() {
            try {
              overlay.style.height = (img?.clientHeight ? (img.clientHeight + 'px') : 'auto');
            } catch {}
          }
          syncOverlaySize();
          imgWrapper.appendChild(overlay);
          try { window.addEventListener('resize', syncOverlaySize); } catch {}

          const video = document.createElement('video');
          video.muted = true;
          try { video.setAttribute('playsinline', ''); } catch {}
          video.playsInline = true;
          video.autoplay = true;
          video.preload = 'none';
          video.poster = displayImageUrl;
          video.src = previewUrl;
          video.style.maxWidth = '100%';
          video.style.maxHeight = '100%';
          video.style.width = '100%';
          // For Gothik, Maexxna, Four Horsemen, Noth, Loatheb, Razuvious & AQ40 panels, ensure the video perfectly overlays the image by filling the overlay box
          if (isGothik || isMaex || isHorse || isNoth || isLoatheb || isRazu || isSkeram || isFankriss || isViscidus || isTwins || isOuro || isBugTrio || isSartura || isHuhuran || isCthun) {
            video.style.height = '100%';
            video.style.objectFit = 'cover';
          } else {
            video.style.height = 'auto';
            video.style.objectFit = 'contain';
          }
          video.style.borderRadius = '8px';
          video.style.opacity = '0';
          video.style.transition = 'opacity 2000ms ease';
          overlay.appendChild(video);
          // Crossfade: image fades out while video fades in (image sits above video)
          try {
            img.style.transition = 'opacity 2000ms ease';
            img.style.position = 'relative';
            img.style.zIndex = '2';
          } catch {}
          requestAnimationFrame(() => {
            try { img.style.opacity = '0'; } catch {}
            video.style.opacity = '1';
          });
          try { const p = video.play(); if (p && typeof p.then === 'function') p.catch(()=>{}); } catch {}

          let fadeStarted = false;
          function startFadeOut() {
            if (fadeStarted) return;
            fadeStarted = true;
            try { img.style.opacity = '1'; } catch {}
            video.style.opacity = '0';
            setTimeout(() => {
              try {
                video.pause();
                video.removeAttribute('src');
                video.load();
                video.remove();
                overlay.remove();
              } catch {}
              if (io) try { io.disconnect(); } catch {}
              try { window.removeEventListener('resize', syncOverlaySize); } catch {}
            }, 1000);
          }
          // Begin fade-out 2s before video ends
          try {
            video.addEventListener('loadedmetadata', () => {
              try {
                const durMs = Number.isFinite(video.duration) ? (video.duration * 1000) : 0;
                const startMs = Math.max(durMs - 2000, 0);
                setTimeout(startFadeOut, startMs);
              } catch {}
            }, { once: true });
          } catch {}
          // Fallback: if ended fires before metadata or timers, ensure fade
          video.addEventListener('ended', startFadeOut, { once: true });
          // Safety: if metadata never loads, fade out after 8s
          setTimeout(() => { if (document.body.contains(video)) startFadeOut(); }, 10000);
        }

        // Observer trigger: wait until (almost) fully visible
        const io = new IntersectionObserver((entries) => {
          const entry = entries[0];
          if (entry && entry.isIntersecting && (entry.intersectionRatio >= 0.98)) {
            startPreview(io);
          }
        }, { threshold: 0.98 });
        io.observe(imgWrapper);
        // If already fully visible on load, trigger immediately
        requestAnimationFrame(() => {
          try {
            const r = imgWrapper.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;
            const vw = window.innerWidth || document.documentElement.clientWidth;
            const fullyInView = r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw;
            if (fullyInView) startPreview(io);
          } catch {}
        });
      }
    } catch {}

    // Gothik: add a right-side slider arrow to toggle between Human and Undead side images
    if (panelKeyLower.includes('goth')) {
      try {
        imgWrapper.style.position = 'relative';
        const human = {
          mid: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755120092/Gothik_human_mid_mwb7ok.jpg',
          full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755120092/Gothik_human_mid_mwb7ok.jpg'
        };
        const undead = {
          mid: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755120767/Gothik_undead_mid_rwfabt.jpg',
          full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755120765/Gothik_undead_full_s03qbn.png'
        };
        let currentSide = 'human';
        function applySide(side) {
          const src = side === 'undead' ? undead : human;
          img.src = src.mid;
          img.alt = `${headerTitle} positions (${side})`;
          imgLink.href = src.full;
        }
        applySide(currentSide);
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.setAttribute('aria-label', 'Next image');
        nextBtn.style.position = 'absolute';
        nextBtn.style.right = '8px';
        nextBtn.style.top = '50%';
        nextBtn.style.transform = 'translateY(-50%)';
        nextBtn.style.width = '36px';
        nextBtn.style.height = '36px';
        nextBtn.style.borderRadius = '50%';
        nextBtn.style.border = '1px solid rgba(255,255,255,0.6)';
        nextBtn.style.background = 'rgba(0,0,0,0.45)';
        nextBtn.style.color = '#fff';
        nextBtn.style.cursor = 'pointer';
        nextBtn.style.display = 'flex';
        nextBtn.style.alignItems = 'center';
        nextBtn.style.justifyContent = 'center';
        nextBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
        nextBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        nextBtn.addEventListener('click', (e) => {
          e.preventDefault();
          currentSide = currentSide === 'human' ? 'undead' : 'human';
          applySide(currentSide);
        });
        imgWrapper.appendChild(nextBtn);

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.setAttribute('aria-label', 'Previous image');
        prevBtn.style.position = 'absolute';
        prevBtn.style.left = '8px';
        prevBtn.style.top = '50%';
        prevBtn.style.transform = 'translateY(-50%)';
        prevBtn.style.width = '36px';
        prevBtn.style.height = '36px';
        prevBtn.style.borderRadius = '50%';
        prevBtn.style.border = '1px solid rgba(255,255,255,0.6)';
        prevBtn.style.background = 'rgba(0,0,0,0.45)';
        prevBtn.style.color = '#fff';
        prevBtn.style.cursor = 'pointer';
        prevBtn.style.display = 'flex';
        prevBtn.style.alignItems = 'center';
        prevBtn.style.justifyContent = 'center';
        prevBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
        prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        prevBtn.addEventListener('click', (e) => {
          e.preventDefault();
          currentSide = currentSide === 'human' ? 'undead' : 'human';
          applySide(currentSide);
        });
        imgWrapper.appendChild(prevBtn);
      } catch {}
    }
    // Removed URL input under the image

    // Description (managed by panel Edit/Save)
    const fallbackDefault = default_strategy_text || '';
    let currentStrategy = strategy_text || fallbackDefault || '';
    let currentVideoUrl = panel.video_url || '';
    const desc = document.createElement('div');
    function renderDesc(readOnly) {
      if (readOnly) {
        desc.innerHTML = `<p class="strategy-text" style="color:#ddd; line-height:1.4;">${escapeHtml(currentStrategy || '—')}</p>`;
      } else {
        desc.innerHTML = `<textarea class="assignment-editable assignment-textarea" data-field="strategy_text" placeholder="Fight description...">${escapeHtml(currentStrategy || '')}</textarea>`;
      }
    }
    renderDesc(true);

    // Right column wrapper to bottom-align the video with the image bottom
    const rightCol = document.createElement('div');
    rightCol.style.display = 'flex';
    rightCol.style.flexDirection = 'column';
    rightCol.style.height = '100%';
    rightCol.appendChild(desc);
    // Video URL input (only in edit mode)
    const videoInputWrap = document.createElement('div');
    videoInputWrap.style.marginTop = '8px';
    function renderVideoInput(readOnly) {
      if (readOnly) {
        videoInputWrap.innerHTML = '';
      } else {
        videoInputWrap.innerHTML = `
          <input class="assignment-editable" data-field="video_url" placeholder="YouTube embed URL (https://www.youtube.com/embed/...)" value="${currentVideoUrl || ''}" style="width:100%;" />
        `;
      }
    }
    renderVideoInput(true);
    rightCol.appendChild(videoInputWrap);
    const ytWrap = document.createElement('div');
    ytWrap.style.marginTop = 'auto';
    function renderVideo() {
      const fourHorsemenDefault = 'https://www.youtube.com/embed/nlKO8p3SMVw?controls=0&modestbranding=1&rel=0&iv_load_policy=3';
      const nothDefault = 'https://www.youtube.com/embed/qSFGc-x-luM?controls=0&modestbranding=1&rel=0&iv_load_policy=3';
      const heiganDefault = 'https://www.youtube.com/embed/dfSBp3Efjbk?controls=0&modestbranding=1&rel=0&iv_load_policy=3';
      const loathebDefault = 'https://www.youtube.com/embed/_zwIx3uzoFI?controls=0&modestbranding=1&rel=0&iv_load_policy=3';
      const genericDefault = 'https://www.youtube.com/embed/yEh16DOAs-k?si=sbFC_3eSplmFyuav&start=13&controls=0&modestbranding=1&rel=0&iv_load_policy=3';
      const key = String(headerTitle || boss || '').toLowerCase();
      const isFourHorsemen = key.includes('horse');
      const isNoth = key.includes('noth');
      const isHeigan = key.includes('heig');
      const isLoatheb = key.includes('loatheb');
      // Hide video for Twins trash
      if (key.includes('twins trash')) {
        ytWrap.innerHTML = '';
        return;
      }
      const fallback = isFourHorsemen ? fourHorsemenDefault : (isNoth ? nothDefault : (isHeigan ? heiganDefault : (isLoatheb ? loathebDefault : genericDefault)));
      const url = currentVideoUrl && currentVideoUrl.trim().length > 0 ? currentVideoUrl : fallback;
      let embedUrl = url;
      try {
        const u = new URL(url);
        if (u.hostname.includes('youtube.com')) {
          u.hostname = 'www.youtube-nocookie.com';
          embedUrl = u.toString();
        }
      } catch {}
      ytWrap.innerHTML = `<iframe width="100%" height="215" src="${embedUrl}" title="Strategy video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" loading="lazy" allowfullscreen></iframe>`;
    }
    renderVideo();
    rightCol.appendChild(ytWrap);

    topLayout.appendChild(imgWrapper);
    topLayout.appendChild(rightCol);

    const list = document.createElement('div');
    list.className = 'assignment-entries';

    let isEditing = false;

    function renderEntryRow(e, i) {
      const row = document.createElement('div');
      row.className = 'assignment-entry-row ranking-item';
      row.dataset.entry = '1';
      if (e.accept_status) row.dataset.acceptStatus = e.accept_status;

      const charInfo = document.createElement('div');
      const current = {
        character_name: e.character_name || '',
        class_name: e.class_name || '',
        spec_name: e.spec_name || '',
        spec_emote: e.spec_emote || '',
        spec_icon_url: e.spec_icon_url || '',
        is_placeholder: e.is_placeholder || false
      };
      function renderCharInfo(readOnly) {
        const rosterClsInit = getRosterClassByName(roster, current.character_name);
        const canonicalInit = canonicalizeClass(current.class_name, rosterClsInit);
        charInfo.className = `character-info class-${classToCssName(canonicalInit)}`;
        if (readOnly) {
          charInfo.innerHTML = `
            ${getSpecIconHtml(current.spec_name, current.class_name, current.spec_emote, current.spec_icon_url, current.is_placeholder)}
            <span class="character-name" style="display:inline-flex; align-items:center;">${current.character_name}</span>
          `;
        } else {
          charInfo.innerHTML = `
            ${getSpecIconHtml(current.spec_name, current.class_name, current.spec_emote, current.spec_icon_url, current.is_placeholder)}
            <select class="assignment-editable" data-field="character_name" style="max-width:260px;">
              <option value="">Select player...</option>
              ${roster.map(r => `<option value="${r.character_name}" data-class="${r.class_name || ''}" data-spec="${r.spec_name || ''}" data-emote="${r.spec_emote || ''}" data-specicon="${r.spec_icon_url || ''}" data-color="${r.class_color || ''}" data-placeholder="${r.is_placeholder || false}" ${r.character_name===current.character_name?'selected':''}>${r.character_name}</option>`).join('')}
            </select>
          `;
          const select = charInfo.querySelector('[data-field="character_name"]');
          const vSelect = String(panel.variant || '').toLowerCase();
          if (vSelect === 'buffs' && select) {
            Array.from(select.options).forEach(opt => {
              const cls = (opt.getAttribute('data-class') || '').toLowerCase();
              if (opt.value && !['mage','priest','druid'].includes(cls)) opt.remove();
            });
          } else if (vSelect === 'curses' && select) {
            Array.from(select.options).forEach(opt => {
              const cls = (opt.getAttribute('data-class') || '').toLowerCase();
              if (opt.value && !['mage','priest'].includes(cls)) opt.remove();
            });
          }
          select.addEventListener('change', async () => {
            const opt = select.selectedOptions[0];
            current.character_name = opt?.value || '';
            current.class_name = opt?.dataset.class || '';
            current.spec_name = opt?.dataset.spec || '';
            current.spec_emote = opt?.dataset.emote || '';
            current.spec_icon_url = opt?.dataset.specicon || '';
            current.is_placeholder = opt?.dataset.placeholder === 'true';
            const rosterCls = getRosterClassByName(roster, current.character_name);
            const canonical = canonicalizeClass(current.class_name, rosterCls);
            charInfo.className = `character-info class-${classToCssName(canonical)}`;
            // Update icon in-place
            charInfo.querySelector('.spec-icon')?.remove();
            const before = document.createElement('span');
            before.innerHTML = getSpecIconHtml(current.spec_name, current.class_name, current.spec_emote, current.spec_icon_url, current.is_placeholder);
            charInfo.insertBefore(before.firstChild, charInfo.firstChild);
            const nameEl = charInfo.querySelector('.character-name');
            if (nameEl) nameEl.textContent = opt.value || '';
            if (String(panel.variant || '').toLowerCase() === 'buffs') {
              const cls = (current.class_name || '').toLowerCase();
              const iconMap = {
                mage: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_magicalsentry.jpg',
                priest: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_wordfortitude.jpg',
                druid: 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_regeneration.jpg'
              };
              const iconUrl = iconMap[cls] || '';
              e.marker_icon_url = iconUrl;
              row.dataset.markerUrl = iconUrl;
              // re-render marker to apply icon immediately
              renderMarker(!isEditing);
            }
            // Reset acceptance on assigned player change (server + UI)
            row.dataset.acceptStatus = '';
            e.accept_status = '';
            try {
              const eventId = getActiveEventId();
              await fetch(`/api/assignments/${eventId}/entry/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: current.character_name, accept_status: null })
              });
            } catch {}
            renderAcceptArea();
          });
        }
      }
      // Always initialize in view mode for everyone
      renderCharInfo(true);

      // Marker icon (view/edit)
      const markerUrls = [
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/1_skull_faqei8.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/2_cross_kj9wuf.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/3_square_yqucv9.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/4_moon_vwhoen.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/5_triangle_rbpjyi.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/6_diamond_hre1uj.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/7_circle_zayctt.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/8_star_kbuiaq.png'
      ];
      const markerWrapper = document.createElement('div');
      function renderMarker(readOnly) {
        markerWrapper.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'marker-box';
        // helper to update box image
        function updateBox(url) {
          box.innerHTML = '';
          if (url) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = 'Marker';
            box.appendChild(img);
          }
        }
        const currentUrl = e.marker_icon_url || row.dataset.markerUrl || '';
        updateBox(currentUrl);
        row.dataset.markerUrl = currentUrl;
        if (!readOnly) {
          // cycle through: none -> icons -> back to none
          box.style.cursor = 'pointer';
          box.title = 'Click to cycle marker';
          box.addEventListener('click', async () => {
            const cur = row.dataset.markerUrl || '';
            const idx = markerUrls.indexOf(cur);
            let nextUrl = '';
            if (idx === -1) {
              nextUrl = markerUrls[0];
            } else if (idx < markerUrls.length - 1) {
              nextUrl = markerUrls[idx + 1];
            } else {
              nextUrl = '';
            }
            e.marker_icon_url = nextUrl || null;
            row.dataset.markerUrl = nextUrl;
            updateBox(nextUrl);
            // Reset acceptance on marker change (server + UI)
            row.dataset.acceptStatus = '';
            e.accept_status = '';
            try {
              const eventId = getActiveEventId();
              await fetch(`/api/assignments/${eventId}/entry/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (current.character_name||'').trim(), accept_status: null })
              });
            } catch {}
            renderAcceptArea();
          });
        }
        markerWrapper.appendChild(box);
      }
      if (canManage) {
        // Respect previously selected marker; if exists, keep it selected even in edit mode
        renderMarker(false);
      } else {
      renderMarker(true);
      }

      const assignText = document.createElement('div');
      // Always initialize in view mode
      assignText.className = 'entry-assignment-text';
      assignText.textContent = e.assignment || '';
      // Persist assignment text on the row for reliable toggles
      row.dataset.assignment = e.assignment || '';

      row.appendChild(charInfo);
      row.appendChild(markerWrapper);
      row.appendChild(assignText);

      // Accept/Decline controls or status icon
      const acceptCol = document.createElement('div');
      acceptCol.className = 'accept-col';
      row.appendChild(acceptCol);

      function getStatusIconHtml(status, interactive) {
        if (status === 'accept') return `<i class="fas fa-check-circle" style="color:#10b981; font-size:40px; line-height:40px;"></i>`;
        if (status === 'decline') return `<i class="fas fa-ban" style="color:#ef4444; font-size:40px; line-height:40px;"></i>`;
        const color = interactive ? '#fbbf24' : '#9ca3af';
        return `<i class="fas fa-check-circle" style="color:${color}; font-size:40px; line-height:40px;"></i>`;
      }

      function renderAcceptArea() {
        acceptCol.innerHTML = '';
        const charName = (current.character_name || '').trim();
        const ownerId = nameToDiscordId.get(charName.toLowerCase()) || null;
        const isOwner = !!(user && user.loggedIn && user.id && ownerId && String(user.id) === String(ownerId));
        const showControls = !!(user && user.loggedIn && (isOwner || (canManage && isEditing)));
        const curStatus = (row.dataset.acceptStatus !== undefined) ? row.dataset.acceptStatus : (e.accept_status || '');
        if (showControls) {
          const btn = document.createElement('button');
          btn.className = 'status-toggle-btn';
          btn.type = 'button';
          btn.innerHTML = getStatusIconHtml(curStatus, true);
          acceptCol.appendChild(btn);
          btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            const prev = (row.dataset.acceptStatus !== undefined) ? row.dataset.acceptStatus : (e.accept_status || '');
            let next = '';
            if (!prev) next = 'accept';
            else if (prev === 'accept') next = 'decline';
            else next = '';
            row.dataset.acceptStatus = next;
            e.accept_status = next;
              const eventId = getActiveEventId();
              try {
                await fetch(`/api/assignments/${eventId}/entry/accept`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: charName, accept_status: next || null })
                });
              } catch {}
            btn.innerHTML = getStatusIconHtml(next, true);
          });
        } else {
          const status = document.createElement('div');
          status.className = 'status-icon';
          status.innerHTML = getStatusIconHtml(curStatus || '', false);
          acceptCol.appendChild(status);
        }
      }
      renderAcceptArea();

      if (canManage) {
        // Row mode toggler (controlled by panel-level edit/save)
        function setMode(readOnly) {
          const ta = row.querySelector('[data-field="assignment"]');
          if (readOnly) {
            assignText.className = 'entry-assignment-text';
            const finalText = (ta && typeof ta.value === 'string') ? ta.value : (row.dataset.assignment || '');
            assignText.textContent = finalText;
            row.dataset.assignment = finalText;
            renderCharInfo(true);
            renderMarker(true);
            // Ensure delete button is not visible in view mode
            const existingDel = row.querySelector('.delete-x');
            if (existingDel) existingDel.remove();
            isEditing = false;
            renderAcceptArea();
          } else {
            assignText.className = '';
            assignText.innerHTML = `<textarea class="assignment-editable assignment-assignment-textarea" data-field="assignment" placeholder="Assignment">${escapeHtml(row.dataset.assignment || '')}</textarea>`;
            renderCharInfo(false);
            renderMarker(false);
            // Reset acceptance when manager edits the assignment text
            const taLive = row.querySelector('[data-field="assignment"]');
            if (taLive) {
              taLive.addEventListener('input', () => { row.dataset.acceptStatus = ''; e.accept_status = ''; row.dataset.assignment = taLive.value || ''; renderAcceptArea(); });
            }
            // Add delete X in edit mode
            let del = row.querySelector('.delete-x');
            if (!del) {
              del = document.createElement('button');
              del.className = 'delete-x';
              del.innerHTML = '&times;';
              del.title = 'Delete assignment';
              del.addEventListener('click', () => { row.remove(); renumberRows(); });
              row.appendChild(del);
            }
            isEditing = true;
            renderAcceptArea();
          }
        }
        // Expose a helper on the row to allow parent Save button to set read-only mode after server save
        row._setReadOnly = () => setMode(true);
        row._setEdit = () => setMode(false);
      }

      list.appendChild(row);
    }

    function renumberRows() {
      Array.from(list.querySelectorAll('.ranking-position')).forEach((el, idx) => el.textContent = String(idx + 1));
    }

    visibleEntries.forEach((e, i) => renderEntryRow(e, i));

    content.appendChild(topLayout);
    content.appendChild(list);

    // Special section for The Four Horsemen: tanking rotation grid
    const isHorsemenPanel = String((boss || '')).toLowerCase().includes('horse');
    const isCleavePanel = String(boss || '').includes('(Cleave)');
    let horseGridWrap = null;
    let horseGridState = null; // { tanksByRow: {1:[name],...}, acceptByRow: {1:'accept'|'decline'|''} }
    if (isHorsemenPanel) {
      horseGridWrap = document.createElement('div');
      horseGridWrap.className = 'horsemen-grid-wrap';
      horseGridWrap.style.marginTop = '16px';
      horseGridWrap.style.padding = '12px 16px';
      horseGridWrap.style.borderTop = '1px solid var(--border-color, #3a3a3a)';

      // initialize state from saved payload or derive from hidden entries
      function deriveHorseFromEntries(allEntries) {
        const map = {};
        (Array.isArray(allEntries)?allEntries:[]).forEach(en => {
          const m = String(en.assignment||'').match(/^__HGRID__:(\d+):(\d+)$/);
          if (m) {
            const row = Number(m[1]);
            const slot = Number(m[2]);
            if (!map[row]) map[row] = [];
            map[row][slot-1] = en.character_name || null;
          }
        });
        return map;
      }
      function deriveHorseAcceptFromEntries(allEntries) {
        const map = {};
        (Array.isArray(allEntries)?allEntries:[]).forEach(en => {
          const m = String(en.assignment||'').match(/^__HGRID__:(\d+):(\d+)$/);
          if (m) {
            const row = Number(m[1]);
            if (map[row] === undefined) map[row] = en.accept_status || '';
          }
        });
        return map;
      }
      const initial = panel.horsemen_tanks || deriveHorseFromEntries(panel.entries);
      horseGridState = { tanksByRow: {}, acceptByRow: {} };
      // Cleave tactics uses only 4 tanks; Classic uses 8
      const maxRows = isCleavePanel ? 4 : 8;
      for (let r = 1; r <= maxRows; r++) {
        const arr = Array.isArray(initial[r]) ? initial[r] : [];
        horseGridState.tanksByRow[r] = [arr[0] || null];
      }
      // pull accept states from hidden entries
      try { horseGridState.acceptByRow = deriveHorseAcceptFromEntries(panel.entries) || {}; } catch {}

      function getWarriorOptionsHtml(selectedName) {
        const warriors = Array.isArray(roster)
          ? roster.filter(r => {
              const normalized = canonicalizeClass(String(r.class_name||''));
              // Include any roster row that normalizes to warrior (covers Tank/Tanking etc.)
              return String(normalized) === 'warrior';
            })
          : [];
        const opts = ['<option value="">Select warrior...</option>'].concat(
          warriors.map(r => `<option value="${r.character_name}" ${String(r.character_name)===String(selectedName)?'selected':''}>${r.character_name}</option>`)
        );
        return opts.join('');
      }

      function renderBossCell(iconUrl, label) {
        const cell = document.createElement('div');
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.gap = '8px';
        const img = document.createElement('img');
        img.src = iconUrl; img.alt = label; img.width = 24; img.height = 24; img.loading = 'lazy';
        const span = document.createElement('span'); span.textContent = label; span.style.color = '#e5e7eb';
        cell.appendChild(img); cell.appendChild(span);
        return cell;
      }

      // Styled pill for boss assignments (Mograine/Thane/Zeliek/Blaumeux)
      function renderBossTag(iconUrl, label) {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.justifyContent = 'center';
        wrap.style.width = '100%';
        wrap.style.textAlign = 'center';
        const cell = document.createElement('div');
        cell.style.display = 'inline-flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.gap = '6px';
        cell.style.padding = '6px 10px';
        cell.style.borderRadius = '8px';
        cell.style.background = 'rgb(199, 156, 110)';
        cell.style.width = '100px';
        const img = document.createElement('img');
        img.src = iconUrl; img.alt = label; img.width = 18; img.height = 18; img.loading = 'lazy';
        const span = document.createElement('span'); span.textContent = label; span.style.color = '#111827'; span.style.fontWeight = '700'; span.style.textAlign = 'center';
        cell.appendChild(img); cell.appendChild(span);
        wrap.appendChild(cell);
        return wrap;
      }

      function renderHorseGrid(readOnly) {
        horseGridWrap.innerHTML = '';
        const makeRow = (cells, idx, isHeader=false) => {
          const row = document.createElement('div');
          row.style.display = 'grid';
          // Cleave: 3 columns + status; Classic: 4 columns + status
          row.style.gridTemplateColumns = isCleavePanel 
            ? '220px repeat(3, 1fr) 70px'
            : '220px repeat(4, 1fr) 70px';
          row.style.gap = '10px';
          if (isHeader) {
            row.style.background = 'rgba(0,0,0,0.25)';
          } else {
            row.style.background = (idx % 2 === 0) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
          }
          row.style.padding = '6px 8px';
          cells.forEach(c => row.appendChild(c));
          // Center align all columns except first (Warriors/title column)
          try {
            Array.from(row.children).forEach((child, idx) => {
              if (idx === 0) return;
              child.style.display = 'flex';
              child.style.alignItems = 'center';
              child.style.justifyContent = 'center';
            });
          } catch {}
          return row;
        };

        // icons
        const iconSkull  = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/1_skull_faqei8.png';
        const iconCross  = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/2_cross_kj9wuf.png';
        const iconSquare = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/3_square_yqucv9.png';
        const iconMoon   = 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/4_moon_vwhoen.png';
        const iconSword  = 'https://wow.zamimg.com/images/wow/icons/large/inv_sword_04.jpg';
        const iconSafe   = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_bandage_12.jpg';
        const headerCell = (text) => { const d=document.createElement('div'); d.style.fontWeight='700'; d.style.color='#e5e7eb'; d.textContent=text; return d; };

        // header row - different for Classic vs Cleave
        const head = isCleavePanel 
          ? makeRow([
              headerCell('Tanks'),
              headerCell('Start on'),
              headerCell('Then go'),
              headerCell('Then go'),
              headerCell('')
            ], 0, true)
          : makeRow([
              headerCell('Warriors / Marks'),
              headerCell('1, 2 and 3'),
              headerCell('4, 5 and 6'),
              headerCell('7, 8 and 9'),
              headerCell('10, 11 and 12'),
              headerCell('')
            ], 0, true);
        horseGridWrap.appendChild(head);

        function renderWarriorCell(rowIdx, onChangeCb) {
          const cell = document.createElement('div');
          cell.style.display = 'flex';
          cell.style.flexDirection = 'column';
          cell.style.gap = '6px';
          const currentName = (horseGridState.tanksByRow[rowIdx] && horseGridState.tanksByRow[rowIdx][0]) || '';
          if (readOnly) {
            const wrap = document.createElement('div');
            wrap.style.minHeight = '28px';
            wrap.style.display = 'inline-flex';
            wrap.style.alignItems = 'center';
            wrap.style.gap = '8px';
            wrap.style.borderRadius = '6px';
            wrap.style.padding = '4px 8px';
            const cls = getRosterClassByName(roster, currentName);
            const color = getRosterClassColorByName(roster, currentName);
            wrap.style.background = color ? color : 'rgba(255,255,255,0.08)';
            const span = document.createElement('span'); span.textContent = currentName || '—'; span.style.color = '#000'; span.style.fontWeight='700';
            wrap.appendChild(span);
            cell.appendChild(wrap);
          } else {
            const sel = document.createElement('select');
            sel.className = 'assignment-editable';
            sel.innerHTML = getWarriorOptionsHtml(currentName);
            sel.addEventListener('change', () => {
              const val = sel.value || null;
              horseGridState.tanksByRow[rowIdx] = [val];
              // Reset acceptance when warrior changes
              horseGridState.acceptByRow[rowIdx] = '';
              try {
                const eventId = getActiveEventId();
                fetch(`/api/assignments/${eventId}/entry/accept`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (val||'').trim(), accept_status: null })
                });
              } catch {}
              if (typeof onChangeCb === 'function') onChangeCb();
            });
            cell.appendChild(sel);
          }
          return cell;
        }

        function renderStatusCell(rowIdx, readOnly) {
          const cell = document.createElement('div');
          cell.className = 'accept-col';
          function getStatusIconHtml(status, interactive) {
            if (status === 'accept') return `<i class="fas fa-check-circle" style="color:#10b981; font-size:40px; line-height:40px;"></i>`;
            if (status === 'decline') return `<i class="fas fa-ban" style="color:#ef4444; font-size:40px; line-height:40px;"></i>`;
            const color = interactive ? '#fbbf24' : '#9ca3af';
            return `<i class="fas fa-check-circle" style="color:${color}; font-size:40px; line-height:40px;"></i>`;
          }
          function draw() {
            cell.innerHTML = '';
            const charName = (horseGridState.tanksByRow[rowIdx] && horseGridState.tanksByRow[rowIdx][0]) || '';
            const ownerId = nameToDiscordId.get(String(charName||'').toLowerCase()) || null;
            const isOwner = !!(user && user.loggedIn && user.id && ownerId && String(user.id) === String(ownerId));
            const showControls = !!(user && user.loggedIn && (isOwner || (!readOnly && canManage)));
            const curStatus = horseGridState.acceptByRow[rowIdx] || '';
            if (showControls) {
              const btn = document.createElement('button');
              btn.className = 'status-toggle-btn';
              btn.type = 'button';
              btn.innerHTML = getStatusIconHtml(curStatus, true);
              btn.addEventListener('click', async (ev) => {
                ev.preventDefault();
                const prev = horseGridState.acceptByRow[rowIdx] || '';
                let next = '';
                if (!prev) next = 'accept';
                else if (prev === 'accept') next = 'decline';
                else next = '';
                horseGridState.acceptByRow[rowIdx] = next;
                // Also update underlying entry for progress tracker
                try {
                  const matchEntry = (Array.isArray(panel.entries)?panel.entries:[]).find(e => 
                    String(e.assignment||'').startsWith('__HGRID__:') && 
                    String(e.character_name||'').toLowerCase() === String(charName||'').toLowerCase()
                  );
                  if (matchEntry) matchEntry.accept_status = next || '';
                } catch {}
                const eventId = getActiveEventId();
                try {
                  await fetch(`/api/assignments/${eventId}/entry/accept`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (charName||'').trim(), accept_status: next || null })
                  });
                } catch {}
                btn.innerHTML = getStatusIconHtml(next, true);
                // Update progress tracker
                if (window._myAssignmentsProgressUpdate) window._myAssignmentsProgressUpdate();
              });
              cell.appendChild(btn);
            } else {
              const status = document.createElement('div');
              status.className = 'status-icon';
              status.innerHTML = getStatusIconHtml(curStatus || '', false);
              cell.appendChild(status);
            }
          }
          cell._rerender = draw;
          draw();
          return cell;
        }

        // helper cell builders
        const bossMograine = () => renderBossTag(iconCross, 'Mograine');
        const bossThane    = () => renderBossTag(iconSkull, 'Thane');
        const bossZeliek   = () => renderBossTag(iconSquare, 'Zeliek');
        const bossBlaumeux = () => renderBossTag(iconMoon, 'Blaumeux');
        const cellDps      = () => renderBossCell(iconSword, 'DPS');
        const cellSafe     = () => renderBossCell(iconSafe, 'Safe Zone');

        const rows = [];
        // Helper to create a full row with status cell
        function makeFullRow(rowIdx, cellsForMarks) {
          const statusCell = renderStatusCell(rowIdx, readOnly);
          const warriorCell = renderWarriorCell(rowIdx, () => { try { statusCell._rerender && statusCell._rerender(); } catch {} });
          return makeRow([ warriorCell, ...cellsForMarks, statusCell ], rowIdx);
        }
        
        // Helper for empty cells
        const cellEmpty = () => { const d=document.createElement('div'); d.textContent='—'; d.style.color='#6b7280'; return d; };
        
        // Cleave tactics: only 4 tanks with specific assignments (3 columns: Start on, Then go, Then go)
        if (isCleavePanel) {
          // Tank 1: Skull - Start on Thane, Then go Blameaux
          rows.push(makeFullRow(1, [ bossThane(), bossBlaumeux(), cellEmpty() ]));
          // Tank 2: Cross - Start on Mograine, Then go Zeliek
          rows.push(makeFullRow(2, [ bossMograine(), bossZeliek(), cellEmpty() ]));
          // Tank 3: Moon - Start on Blameaux, Then go Safe Zone, Then go Zeliek
          rows.push(makeFullRow(3, [ bossBlaumeux(), cellSafe(), bossZeliek() ]));
          // Tank 4: Square - Start on Zeliek, Then go Safe Zone, Then go Blameaux
          rows.push(makeFullRow(4, [ bossZeliek(), cellSafe(), bossBlaumeux() ]));
        } else {
          // Classic tactics: 8 tanks
          // Row 1: Mograine in col1; DPS in cols 2-4
          rows.push(makeFullRow(1, [ bossMograine(), cellDps(), cellDps(), cellDps() ]));
          // Row 2: DPS, Mograine, DPS, DPS
          rows.push(makeFullRow(2, [ cellDps(), bossMograine(), cellDps(), cellDps() ]));
          // Row 3: Thane, Thane, Mograine, DPS
          rows.push(makeFullRow(3, [ bossThane(), bossThane(), bossMograine(), cellDps() ]));
          // Row 4: DPS, DPS, DPS, Mograine
          rows.push(makeFullRow(4, [ cellDps(), cellDps(), cellDps(), bossMograine() ]));
          // Row 5: Blaumeux, Safe, Zeliek, Safe
          rows.push(makeFullRow(5, [ bossBlaumeux(), cellSafe(), bossZeliek(), cellSafe() ]));
          // Row 6: DPS, Blaumeux, Safe, Zeliek
          rows.push(makeFullRow(6, [ cellDps(), bossBlaumeux(), cellSafe(), bossZeliek() ]));
          // Row 7: Zeliek, Safe, Blaumeux, Safe
          rows.push(makeFullRow(7, [ bossZeliek(), cellSafe(), bossBlaumeux(), cellSafe() ]));
          // Row 8: DPS, Zeliek, Safe, Blaumeux
          rows.push(makeFullRow(8, [ cellDps(), bossZeliek(), cellSafe(), bossBlaumeux() ]));
        }

        rows.forEach(r => horseGridWrap.appendChild(r));
      }

      // initial render in view mode (no tanks yet visible)
      renderHorseGrid(true);
      content.appendChild(horseGridWrap);
      // expose helpers to toggle and fetch state
      panelDiv._renderHorseGrid = (readOnly) => renderHorseGrid(readOnly);
      panelDiv._getHorseGridState = () => horseGridState;

      // ── Alternative Tank Options Panel (admin-only, Classic only) ──
      if (canManage && !isCleavePanel) {
        renderAlternativeTankOptions(horseGridWrap, roster);
      }
    }

    // Helper: Check if a player has a main (non-grid) assignment in this panel
    // If yes, they should change status from the main table, not the grid (to avoid conflicts)
    function hasMainAssignmentForBoss(playerName) {
      return (Array.isArray(panel.entries) ? panel.entries : []).some(en => {
        const name = String(en.character_name || '').toLowerCase();
        const assignment = String(en.assignment || '');
        const isGrid = assignment.startsWith('__SPORE__:') || assignment.startsWith('__KEL__:') || 
                       assignment.startsWith('__CTHUN__:') || assignment.startsWith('__HGRID__:');
        return name === playerName.toLowerCase() && !isGrid && assignment;
      });
    }

    // Special section for Loatheb: Spore Groups grid (6 groups x 5 slots)
    const isLoathebPanel = String((boss || '')).toLowerCase().includes('loatheb');
    let sporeGridWrap = null;
    let sporeGridState = null; // { groups: {1:[n1..n5],...,6:[..]}, acceptByPosition: {'g:s': 'accept'|'decline'|''} }
    if (isLoathebPanel) {
      sporeGridWrap = document.createElement('div');
      sporeGridWrap.className = 'spore-grid-wrap';
      sporeGridWrap.style.marginTop = '16px';
      sporeGridWrap.style.padding = '12px 16px';
      sporeGridWrap.style.borderTop = '1px solid var(--border-color, #3a3a3a)';
      sporeGridWrap.style.width = '100%';
      // Title above the grid
      const sporeTitle = document.createElement('div');
      sporeTitle.textContent = 'Spore Groups';
      sporeTitle.style.fontWeight = '700';
      sporeTitle.style.color = '#e5e7eb';
      sporeTitle.style.margin = '8px 0 6px 0';

      function deriveSporeFromEntries(allEntries) {
        const map = {};
        (Array.isArray(allEntries)?allEntries:[]).forEach(en => {
          const m = String(en.assignment||'').match(/^__SPORE__:(\d+):(\d+)$/);
          if (m) {
            const g = Number(m[1]);
            const s = Number(m[2]);
            if (!map[g]) map[g] = [];
            map[g][s-1] = en.character_name || null;
          }
        });
        return map;
      }
      function deriveSporeAcceptFromEntries(allEntries) {
        const map = {};
        (Array.isArray(allEntries)?allEntries:[]).forEach(en => {
          const m = String(en.assignment||'').match(/^__SPORE__:(\d+):(\d+)$/);
          if (m) {
            const g = Number(m[1]);
            const s = Number(m[2]);
            map[`${g}:${s}`] = en.accept_status || '';
          }
        });
        return map;
      }
      const initialSpore = panel.spore_groups || deriveSporeFromEntries(panel.entries);
      sporeGridState = { groups: {}, acceptByPosition: {} };
      for (let g=1; g<=6; g++) {
        const arr = Array.isArray(initialSpore[g]) ? initialSpore[g] : [];
        sporeGridState.groups[g] = [arr[0]||null, arr[1]||null, arr[2]||null, arr[3]||null, arr[4]||null];
      }
      // Pull accept states from hidden entries
      try { sporeGridState.acceptByPosition = deriveSporeAcceptFromEntries(panel.entries) || {}; } catch {}

      function getAllPlayerOptionsHtml(selectedName) {
        const opts = ['<option value="">Select player...</option>'].concat(
          (Array.isArray(roster)?roster:[]).map(r => `<option value="${r.character_name}" ${String(r.character_name)===String(selectedName)?'selected':''}>${r.character_name}</option>`)
        );
        return opts.join('');
      }

      function getSporeStatusIconHtml(status, interactive) {
        if (status === 'accept') return `<i class="fas fa-check-circle" style="color:#10b981; font-size:16px; line-height:16px;"></i>`;
        if (status === 'decline') return `<i class="fas fa-ban" style="color:#ef4444; font-size:16px; line-height:16px;"></i>`;
        const color = interactive ? '#fbbf24' : '#9ca3af';
        return `<i class="fas fa-check-circle" style="color:${color}; font-size:16px; line-height:16px;"></i>`;
      }

      function renderSporeGrid(readOnly) {
        sporeGridWrap.innerHTML = '';
        // header
        const head = document.createElement('div');
        head.style.display = 'grid';
        head.style.gridTemplateColumns = 'repeat(6, 1fr)';
        head.style.gap = '10px';
        head.style.background = 'rgba(0,0,0,0.25)';
        head.style.padding = '6px 8px';
        for (let g=1; g<=6; g++) {
          const d = document.createElement('div');
          d.style.fontWeight = '700'; d.style.color = '#e5e7eb'; d.style.textAlign = 'center';
          d.textContent = `Group ${g}`;
          head.appendChild(d);
        }
        sporeGridWrap.appendChild(head);

        function makeRowForSlot(slotIdx) {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = 'repeat(6, 1fr)';
          row.style.gap = '10px';
          row.style.background = (slotIdx % 2 === 1) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
          row.style.padding = '6px 8px';
          for (let g=1; g<=6; g++) {
            const cell = document.createElement('div');
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            const currentName = sporeGridState.groups[g][slotIdx-1] || '';
            const posKey = `${g}:${slotIdx}`;
            if (readOnly) {
              const wrap = document.createElement('div');
              wrap.style.minHeight = '28px';
              wrap.style.display = 'inline-flex';
              wrap.style.alignItems = 'center';
              wrap.style.justifyContent = 'center';
              wrap.style.gap = '6px';
              wrap.style.borderRadius = '8px';
              wrap.style.padding = '6px 10px';
              wrap.style.minWidth = '100px';
              const color = getRosterClassColorByName(roster, (currentName||'').trim());
              wrap.style.background = color ? color : 'rgba(255,255,255,0.08)';
              const span = document.createElement('span'); span.textContent = currentName || '—'; span.style.color = '#000'; span.style.fontWeight='700';
              wrap.appendChild(span);
              // Add accept status icon next to name if player assigned
              if (currentName) {
                const ownerId = nameToDiscordId.get(String(currentName||'').toLowerCase()) || null;
                const isOwner = !!(user && user.loggedIn && user.id && ownerId && String(user.id) === String(ownerId));
                const showControls = !!(user && user.loggedIn && (isOwner || canManage));
                const curStatus = sporeGridState.acceptByPosition[posKey] || '';
                // If player has a main assignment for this boss, make grid entry read-only
                // They should change status from the main table to avoid confusion
                const hasMainAssign = hasMainAssignmentForBoss(currentName);
                if (showControls && !hasMainAssign) {
                  const btn = document.createElement('button');
                  btn.className = 'status-toggle-btn';
                  btn.type = 'button';
                  btn.style.background = 'transparent';
                  btn.style.border = 'none';
                  btn.style.cursor = 'pointer';
                  btn.style.padding = '2px';
                  btn.style.marginLeft = '4px';
                  btn.innerHTML = getSporeStatusIconHtml(curStatus, true);
                  btn.addEventListener('click', async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const prev = sporeGridState.acceptByPosition[posKey] || '';
                    let next = '';
                    if (!prev) next = 'accept';
                    else if (prev === 'accept') next = 'decline';
                    else next = '';
                    sporeGridState.acceptByPosition[posKey] = next;
                    // Also update underlying entry for progress tracker
                    try {
                      const matchEntry = (Array.isArray(panel.entries)?panel.entries:[]).find(e => 
                        String(e.assignment||'').startsWith('__SPORE__:') && 
                        String(e.character_name||'').toLowerCase() === String(currentName||'').toLowerCase()
                      );
                      if (matchEntry) matchEntry.accept_status = next || '';
                    } catch {}
                    const eventId = getActiveEventId();
                    try {
                      await fetch(`/api/assignments/${eventId}/entry/accept`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (currentName||'').trim(), accept_status: next || null })
                      });
                    } catch {}
                    btn.innerHTML = getSporeStatusIconHtml(next, true);
                    // If in myassignments context, use larger icon
                    if (btn.closest('[data-myassignments-context]')) {
                      const icon = btn.querySelector('i.fas, i.fa');
                      if (icon) { icon.style.fontSize = '30px'; icon.style.lineHeight = '30px'; }
                    }
                    // Update progress tracker
                    if (window._myAssignmentsProgressUpdate) window._myAssignmentsProgressUpdate();
                  });
                  wrap.appendChild(btn);
                } else if (curStatus && !hasMainAssign) {
                  // Show read-only status only if no main assignment (avoid duplicate/conflicting icons)
                  const statusIcon = document.createElement('span');
                  statusIcon.innerHTML = getSporeStatusIconHtml(curStatus, false);
                  statusIcon.style.marginLeft = '4px';
                  wrap.appendChild(statusIcon);
                }
                // If hasMainAssign, don't show any icon - user sees/controls status from main table
              }
              cell.appendChild(wrap);
            } else {
              const wrap = document.createElement('div');
              wrap.style.display = 'flex';
              wrap.style.alignItems = 'center';
              wrap.style.gap = '8px';
              const sel = document.createElement('select');
              sel.className = 'assignment-editable';
              sel.style.maxWidth = '220px';
              sel.innerHTML = getAllPlayerOptionsHtml(currentName);
              sel.addEventListener('change', () => {
                const val = sel.value || null;
                const oldName = sporeGridState.groups[g][slotIdx-1];
                sporeGridState.groups[g][slotIdx-1] = val;
                // Reset acceptance when player changes
                if (oldName !== val) {
                  sporeGridState.acceptByPosition[posKey] = '';
                  const eventId = getActiveEventId();
                  try {
                    fetch(`/api/assignments/${eventId}/entry/accept`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (val||'').trim(), accept_status: null })
                    });
                  } catch {}
                }
              });
              wrap.appendChild(sel);
              // Delete button
              const del = document.createElement('button');
              del.className = 'delete-x';
              del.innerHTML = '&times;';
              del.title = 'Remove player';
              del.addEventListener('click', () => { sporeGridState.groups[g][slotIdx-1] = null; sporeGridState.acceptByPosition[posKey] = ''; renderSporeGrid(false); });
              wrap.appendChild(del);
              cell.appendChild(wrap);
            }
            row.appendChild(cell);
          }
          return row;
        }

        for (let s=1; s<=5; s++) {
          sporeGridWrap.appendChild(makeRowForSlot(s));
        }
      }

      // initial render view mode
      renderSporeGrid(true);
      content.appendChild(sporeTitle);
      content.appendChild(sporeGridWrap);
      panelDiv._renderSporeGrid = (readOnly) => renderSporeGrid(readOnly);
      panelDiv._getSporeGridState = () => sporeGridState;
    }

    // Special section for Kel'Thuzad: Group grid (A, B, C, D)
    const isKelPanel = String((boss || '')).toLowerCase().includes('kel');
    let kelGridWrap = null;
    let kelGridState = null; // { groups: {1:[...],2:[...],3:[...],4:[...]}, acceptByPosition: {'g:s': 'accept'|'decline'|''} }
    if (isKelPanel) {
      kelGridWrap = document.createElement('div');
      kelGridWrap.className = 'kel-grid-wrap';
      kelGridWrap.style.marginTop = '16px';
      kelGridWrap.style.padding = '12px 16px';
      kelGridWrap.style.borderTop = '1px solid var(--border-color, #3a3a3a)';
      kelGridWrap.style.width = '100%';

      const kelTitle = document.createElement('div');
      kelTitle.textContent = "Kel'Thuzad Groups";
      kelTitle.style.fontWeight = '700';
      kelTitle.style.color = '#e5e7eb';
      kelTitle.style.margin = '8px 0 6px 0';

      function deriveKelFromEntries(allEntries) {
        const map = {};
        (Array.isArray(allEntries)?allEntries:[]).forEach(en => {
          const m = String(en.assignment||'').match(/^__KEL__:(\d+):(\d+)$/);
          if (m) {
            const g = Number(m[1]);
            const s = Number(m[2]);
            if (!map[g]) map[g] = [];
            map[g][s-1] = en.character_name || null;
          }
        });
        return map;
      }
      function deriveKelAcceptFromEntries(allEntries) {
        const map = {};
        (Array.isArray(allEntries)?allEntries:[]).forEach(en => {
          const m = String(en.assignment||'').match(/^__KEL__:(\d+):(\d+)$/);
          if (m) {
            const g = Number(m[1]);
            const s = Number(m[2]);
            map[`${g}:${s}`] = en.accept_status || '';
          }
        });
        return map;
      }
      const initialKel = panel.kel_groups || deriveKelFromEntries(panel.entries);
      kelGridState = { groups: { 1: [], 2: [], 3: [], 4: [] }, acceptByPosition: {} };
      for (let g=1; g<=4; g++) {
        const arr = Array.isArray(initialKel[g]) ? initialKel[g] : [];
        // default to up to 8 slots; will expand dynamically when rendering
        kelGridState.groups[g] = arr.slice();
      }
      // Pull accept states from hidden entries
      try { kelGridState.acceptByPosition = deriveKelAcceptFromEntries(panel.entries) || {}; } catch {}

      function getKelStatusIconHtml(status, interactive) {
        if (status === 'accept') return `<i class="fas fa-check-circle" style="color:#10b981; font-size:16px; line-height:16px;"></i>`;
        if (status === 'decline') return `<i class="fas fa-ban" style="color:#ef4444; font-size:16px; line-height:16px;"></i>`;
        const color = interactive ? '#fbbf24' : '#9ca3af';
        return `<i class="fas fa-check-circle" style="color:${color}; font-size:16px; line-height:16px;"></i>`;
      }

      function renderKelGrid(readOnly) {
        kelGridWrap.innerHTML = '';
        // header
        const head = document.createElement('div');
        head.style.display = 'grid';
        head.style.gridTemplateColumns = 'repeat(4, 1fr)';
        head.style.gap = '10px';
        head.style.background = 'rgba(0,0,0,0.25)';
        head.style.padding = '6px 8px';
        const labelMeta = [
          { text: 'Group A', icon: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/5_triangle_rbpjyi.png' },
          { text: 'Group B', icon: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/6_diamond_hre1uj.png' },
          { text: 'Group C', icon: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/3_square_yqucv9.png' },
          { text: 'Tanks',   icon: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/7_circle_zayctt.png' }
        ];
        labelMeta.forEach(({text, icon}) => {
          const d = document.createElement('div');
          d.style.fontWeight='700'; d.style.color='#e5e7eb'; d.style.textAlign='center';
          d.style.display='flex'; d.style.alignItems='center'; d.style.justifyContent='center'; d.style.gap='6px';
          const img = document.createElement('img'); img.src = icon; img.alt = 'mark'; img.width = 18; img.height = 18; img.loading = 'lazy';
          const span = document.createElement('span'); span.textContent = text;
          d.appendChild(img); d.appendChild(span);
          head.appendChild(d);
        });
        kelGridWrap.appendChild(head);

        const groups = kelGridState.groups;
        const maxLen = Math.max(
          (groups[1]||[]).length,
          (groups[2]||[]).length,
          (groups[3]||[]).length,
          (groups[4]||[]).length,
          8
        );

        function makeRowForSlot(slotIdx) {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = 'repeat(4, 1fr)';
          row.style.gap = '10px';
          row.style.background = (slotIdx % 2 === 1) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
          row.style.padding = '6px 8px';
          for (let g=1; g<=4; g++) {
            const cell = document.createElement('div');
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            const currentName = (groups[g] && groups[g][slotIdx-1]) || '';
            const posKey = `${g}:${slotIdx}`;
            if (readOnly) {
              const wrap = document.createElement('div');
              wrap.style.minHeight = '28px';
              wrap.style.display = 'inline-flex';
              wrap.style.alignItems = 'center';
              wrap.style.justifyContent = 'center';
              wrap.style.gap = '6px';
              wrap.style.borderRadius = '8px';
              wrap.style.padding = '6px 10px';
              wrap.style.minWidth = '100px';
              const color = getRosterClassColorByName(roster, currentName);
              wrap.style.background = color ? color : 'rgba(255,255,255,0.08)';
              const span = document.createElement('span'); span.textContent = currentName || '—'; span.style.color = '#000'; span.style.fontWeight='700';
              wrap.appendChild(span);
              // Add accept status icon next to name if player assigned
              if (currentName) {
                const ownerId = nameToDiscordId.get(String(currentName||'').toLowerCase()) || null;
                const isOwner = !!(user && user.loggedIn && user.id && ownerId && String(user.id) === String(ownerId));
                const showControls = !!(user && user.loggedIn && (isOwner || canManage));
                const curStatus = kelGridState.acceptByPosition[posKey] || '';
                // If player has a main assignment for this boss, make grid entry read-only
                const hasMainAssign = hasMainAssignmentForBoss(currentName);
                if (showControls && !hasMainAssign) {
                  const btn = document.createElement('button');
                  btn.className = 'status-toggle-btn';
                  btn.type = 'button';
                  btn.style.background = 'transparent';
                  btn.style.border = 'none';
                  btn.style.cursor = 'pointer';
                  btn.style.padding = '2px';
                  btn.style.marginLeft = '4px';
                  btn.innerHTML = getKelStatusIconHtml(curStatus, true);
                  btn.addEventListener('click', async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const prev = kelGridState.acceptByPosition[posKey] || '';
                    let next = '';
                    if (!prev) next = 'accept';
                    else if (prev === 'accept') next = 'decline';
                    else next = '';
                    kelGridState.acceptByPosition[posKey] = next;
                    // Also update underlying entry for progress tracker
                    try {
                      const matchEntry = (Array.isArray(panel.entries)?panel.entries:[]).find(e => 
                        String(e.assignment||'').startsWith('__KEL__:') && 
                        String(e.character_name||'').toLowerCase() === String(currentName||'').toLowerCase()
                      );
                      if (matchEntry) matchEntry.accept_status = next || '';
                    } catch {}
                    const eventId = getActiveEventId();
                    try {
                      await fetch(`/api/assignments/${eventId}/entry/accept`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (currentName||'').trim(), accept_status: next || null })
                      });
                    } catch {}
                    btn.innerHTML = getKelStatusIconHtml(next, true);
                    // If in myassignments context, use larger icon
                    if (btn.closest('[data-myassignments-context]')) {
                      const icon = btn.querySelector('i.fas, i.fa');
                      if (icon) { icon.style.fontSize = '30px'; icon.style.lineHeight = '30px'; }
                    }
                    // Update progress tracker
                    if (window._myAssignmentsProgressUpdate) window._myAssignmentsProgressUpdate();
                  });
                  wrap.appendChild(btn);
                } else if (curStatus && !hasMainAssign) {
                  // Show read-only status only if no main assignment (avoid duplicate/conflicting icons)
                  const statusIcon = document.createElement('span');
                  statusIcon.innerHTML = getKelStatusIconHtml(curStatus, false);
                  statusIcon.style.marginLeft = '4px';
                  wrap.appendChild(statusIcon);
                }
                // If hasMainAssign, don't show any icon - user sees/controls status from main table
              }
              cell.appendChild(wrap);
            } else {
              const wrap = document.createElement('div');
              wrap.style.display = 'flex';
              wrap.style.alignItems = 'center';
              wrap.style.gap = '8px';
              const sel = document.createElement('select');
              sel.className = 'assignment-editable';
              sel.style.maxWidth = '220px';
              sel.innerHTML = ['<option value="">Select player...</option>']
                .concat((Array.isArray(roster)?roster:[]).map(r => `<option value="${r.character_name}" ${String(r.character_name)===String(currentName)?'selected':''}>${r.character_name}</option>`))
                .join('');
              sel.addEventListener('change', () => {
                const val = sel.value || null;
                const oldName = (groups[g] && groups[g][slotIdx-1]) || '';
                if (!groups[g]) groups[g] = [];
                groups[g][slotIdx-1] = val;
                // Reset acceptance when player changes
                if (oldName !== val) {
                  kelGridState.acceptByPosition[posKey] = '';
                  const eventId = getActiveEventId();
                  try {
                    fetch(`/api/assignments/${eventId}/entry/accept`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (val||'').trim(), accept_status: null })
                    });
                  } catch {}
                }
              });
              wrap.appendChild(sel);
              const del = document.createElement('button');
              del.className = 'delete-x';
              del.innerHTML = '&times;';
              del.title = 'Remove player';
              del.addEventListener('click', () => { if (!groups[g]) groups[g]=[]; groups[g][slotIdx-1] = null; kelGridState.acceptByPosition[posKey] = ''; renderKelGrid(false); });
              wrap.appendChild(del);
              cell.appendChild(wrap);
            }
            row.appendChild(cell);
          }
          return row;
        }

        for (let s=1; s<=maxLen; s++) {
          kelGridWrap.appendChild(makeRowForSlot(s));
        }
      }

      // initial render view mode
      renderKelGrid(true);
      content.appendChild(kelTitle);
      content.appendChild(kelGridWrap);
      panelDiv._renderKelGrid = (readOnly) => renderKelGrid(readOnly);
      panelDiv._getKelGridState = () => kelGridState;
    }

    // Special section for C'Thun: Positions grid (8 groups x 5 slots)
    const isCthunPanel = String((boss || '')).toLowerCase().includes("c'thun") || String((boss || '')).toLowerCase().includes('cthun');
    let cthunGridWrap = null;
    let cthunGridState = null; // { groups: {1:[n1..n5],...,8:[..]}, acceptByPosition: {'g:s': 'accept'|'decline'|''} }
    if (isCthunPanel) {
      cthunGridWrap = document.createElement('div');
      cthunGridWrap.className = 'cthun-grid-wrap';
      cthunGridWrap.style.marginTop = '16px';
      cthunGridWrap.style.padding = '12px 16px';
      cthunGridWrap.style.borderTop = '1px solid var(--border-color, #3a3a3a)';
      cthunGridWrap.style.width = '100%';
      try { cthunGridWrap.style.maxWidth = '1160px'; cthunGridWrap.style.margin = '0 auto'; cthunGridWrap.style.boxSizing = 'border-box'; } catch {}

      const cthunTitle = document.createElement('div');
      cthunTitle.textContent = "C'Thun positions";
      cthunTitle.style.fontWeight = '700';
      cthunTitle.style.color = '#e5e7eb';
      cthunTitle.style.margin = '8px 0 6px 0';

      function deriveCthunFromEntries(allEntries) {
        const map = {};
        (Array.isArray(allEntries)?allEntries:[]).forEach(en => {
          const m = String(en.assignment||'').match(/^__CTHUN__:(\d+):(\d+)$/);
          if (m) {
            const g = Number(m[1]);
            const s = Number(m[2]);
            if (!map[g]) map[g] = [];
            map[g][s-1] = (typeof en.character_name === 'string' ? en.character_name.trim() : en.character_name) || null;
          }
        });
        return map;
      }
      function deriveCthunAcceptFromEntries(allEntries) {
        const map = {};
        (Array.isArray(allEntries)?allEntries:[]).forEach(en => {
          const m = String(en.assignment||'').match(/^__CTHUN__:(\d+):(\d+)$/);
          if (m) {
            const g = Number(m[1]);
            const s = Number(m[2]);
            map[`${g}:${s}`] = en.accept_status || '';
          }
        });
        return map;
      }
      const initialCthun = panel.cthun_positions || deriveCthunFromEntries(panel.entries);
      cthunGridState = { groups: {}, acceptByPosition: {} };
      for (let g=1; g<=8; g++) {
        const arr = Array.isArray(initialCthun[g]) ? initialCthun[g] : [];
        cthunGridState.groups[g] = [arr[0]||null, arr[1]||null, arr[2]||null, arr[3]||null, arr[4]||null];
      }
      // Pull accept states from hidden entries
      try { cthunGridState.acceptByPosition = deriveCthunAcceptFromEntries(panel.entries) || {}; } catch {}

      function getAllPlayerOptionsHtml(selectedName) {
        const opts = ['<option value="">Select player...</option>'].concat(
          (Array.isArray(roster)?roster:[]).map(r => `<option value="${r.character_name}" ${String(r.character_name)===String(selectedName)?'selected':''}>${r.character_name}</option>`)
        );
        return opts.join('');
      }

      function getCthunStatusIconHtml(status, interactive) {
        if (status === 'accept') return `<i class="fas fa-check-circle" style="color:#10b981; font-size:16px; line-height:16px;"></i>`;
        if (status === 'decline') return `<i class="fas fa-ban" style="color:#ef4444; font-size:16px; line-height:16px;"></i>`;
        const color = interactive ? '#fbbf24' : '#9ca3af';
        return `<i class="fas fa-check-circle" style="color:${color}; font-size:16px; line-height:16px;"></i>`;
      }

      function renderCthunGrid(readOnly) {
        cthunGridWrap.innerHTML = '';
        // header
        const head = document.createElement('div');
        head.style.display = 'grid';
        head.style.gridTemplateColumns = 'repeat(8, 1fr)';
        head.style.gap = '10px';
        head.style.background = 'rgba(0,0,0,0.25)';
        head.style.padding = '6px 8px';
        const headIcons = [
          'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/1_skull_faqei8.png',
          'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/2_cross_kj9wuf.png',
          'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/3_square_yqucv9.png',
          'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/4_moon_vwhoen.png',
          'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/5_triangle_rbpjyi.png',
          'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/6_diamond_hre1uj.png',
          'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/7_circle_zayctt.png',
          'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/8_star_kbuiaq.png'
        ];
        for (let g=1; g<=8; g++) {
          const d = document.createElement('div');
          d.style.fontWeight = '700'; d.style.color = '#e5e7eb'; d.style.textAlign = 'center';
          d.style.display = 'flex'; d.style.alignItems = 'center'; d.style.justifyContent = 'center'; d.style.gap = '6px';
          const img = document.createElement('img');
          img.src = headIcons[g-1] || '';
          img.alt = 'mark';
          img.width = 18; img.height = 18; img.loading = 'lazy';
          const span = document.createElement('span');
          span.textContent = `Group ${g}`;
          d.appendChild(img);
          d.appendChild(span);
          head.appendChild(d);
        }
        cthunGridWrap.appendChild(head);

        function makeRowForSlot(slotIdx) {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = 'repeat(8, 1fr)';
          row.style.gap = '10px';
          row.style.background = (slotIdx % 2 === 1) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)';
          row.style.padding = '6px 8px';
          for (let g=1; g<=8; g++) {
            const cell = document.createElement('div');
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            const currentName = cthunGridState.groups[g][slotIdx-1] || '';
            const posKey = `${g}:${slotIdx}`;
            if (readOnly) {
              const wrap = document.createElement('div');
              wrap.style.minHeight = '28px';
              wrap.style.display = 'inline-flex';
              wrap.style.alignItems = 'center';
              wrap.style.justifyContent = 'center';
              wrap.style.gap = '4px';
              wrap.style.borderRadius = '8px';
              wrap.style.padding = '6px 8px';
              wrap.style.minWidth = '100px';
              const color = getRosterClassColorByName(roster, currentName);
              wrap.style.background = color ? color : 'rgba(255,255,255,0.08)';
              const span = document.createElement('span');
              span.textContent = (currentName||'').trim() || '—';
              // Bright red font for warriors/tanks/rogues placed in slot 3
              try {
                const nameTrim = (currentName||'').trim();
                const rawCls = getRosterClassByName(roster, nameTrim);
                const rawLower = String(rawCls||'').toLowerCase();
                const canonLower = String(canonicalizeClass(rawCls || '', '')||'').toLowerCase();
                const isRed = (slotIdx === 3) && (canonLower === 'warrior' || canonLower === 'rogue' || rawLower === 'tank' || rawLower === 'tanking');
                if (isRed) {
                  span.style.color = '#ff4545';
                  span.style.fontWeight = '900';
                } else {
                  span.style.color = '#000';
                  span.style.fontWeight = '700';
                }
              } catch {
                span.style.color = '#000';
                span.style.fontWeight = '700';
              }
              wrap.appendChild(span);
              // Add accept status icon next to name if player assigned
              if (currentName) {
                const ownerId = nameToDiscordId.get(String(currentName||'').toLowerCase()) || null;
                const isOwner = !!(user && user.loggedIn && user.id && ownerId && String(user.id) === String(ownerId));
                const showControls = !!(user && user.loggedIn && (isOwner || canManage));
                const curStatus = cthunGridState.acceptByPosition[posKey] || '';
                // If player has a main assignment for this boss, make grid entry read-only
                const hasMainAssign = hasMainAssignmentForBoss(currentName);
                if (showControls && !hasMainAssign) {
                  const btn = document.createElement('button');
                  btn.className = 'status-toggle-btn';
                  btn.type = 'button';
                  btn.style.background = 'transparent';
                  btn.style.border = 'none';
                  btn.style.cursor = 'pointer';
                  btn.style.padding = '2px';
                  btn.style.marginLeft = '2px';
                  btn.innerHTML = getCthunStatusIconHtml(curStatus, true);
                  btn.addEventListener('click', async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const prev = cthunGridState.acceptByPosition[posKey] || '';
                    let next = '';
                    if (!prev) next = 'accept';
                    else if (prev === 'accept') next = 'decline';
                    else next = '';
                    cthunGridState.acceptByPosition[posKey] = next;
                    // Also update underlying entry for progress tracker
                    try {
                      const matchEntry = (Array.isArray(panel.entries)?panel.entries:[]).find(e => 
                        String(e.assignment||'').startsWith('__CTHUN__:') && 
                        String(e.character_name||'').toLowerCase() === String(currentName||'').toLowerCase()
                      );
                      if (matchEntry) matchEntry.accept_status = next || '';
                    } catch {}
                    const eventId = getActiveEventId();
                    try {
                      await fetch(`/api/assignments/${eventId}/entry/accept`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (currentName||'').trim(), accept_status: next || null })
                      });
                    } catch {}
                    btn.innerHTML = getCthunStatusIconHtml(next, true);
                    // If in myassignments context, use larger icon
                    if (btn.closest('[data-myassignments-context]')) {
                      const icon = btn.querySelector('i.fas, i.fa');
                      if (icon) { icon.style.fontSize = '30px'; icon.style.lineHeight = '30px'; }
                    }
                    // Update progress tracker
                    if (window._myAssignmentsProgressUpdate) window._myAssignmentsProgressUpdate();
                  });
                  wrap.appendChild(btn);
                } else if (curStatus && !hasMainAssign) {
                  // Show read-only status only if no main assignment (avoid duplicate/conflicting icons)
                  const statusIcon = document.createElement('span');
                  statusIcon.innerHTML = getCthunStatusIconHtml(curStatus, false);
                  statusIcon.style.marginLeft = '2px';
                  wrap.appendChild(statusIcon);
                }
                // If hasMainAssign, don't show any icon - user sees/controls status from main table
              }
              cell.appendChild(wrap);
            } else {
              const wrap = document.createElement('div');
              wrap.style.display = 'flex';
              wrap.style.alignItems = 'center';
              wrap.style.gap = '8px';
              const sel = document.createElement('select');
              sel.className = 'assignment-editable';
              sel.style.maxWidth = '100px';
              sel.innerHTML = getAllPlayerOptionsHtml(currentName);
              sel.addEventListener('change', () => {
                const val = sel.value || null;
                const oldName = cthunGridState.groups[g][slotIdx-1];
                cthunGridState.groups[g][slotIdx-1] = val;
                // Reset acceptance when player changes
                if (oldName !== val) {
                  cthunGridState.acceptByPosition[posKey] = '';
                  const eventId = getActiveEventId();
                  try {
                    fetch(`/api/assignments/${eventId}/entry/accept`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (val||'').trim(), accept_status: null })
                    });
                  } catch {}
                }
              });
              wrap.appendChild(sel);
              const del = document.createElement('button');
              del.className = 'delete-x';
              del.innerHTML = '&times;';
              del.title = 'Remove player';
              del.addEventListener('click', () => { cthunGridState.groups[g][slotIdx-1] = null; cthunGridState.acceptByPosition[posKey] = ''; renderCthunGrid(false); });
              wrap.appendChild(del);
              cell.appendChild(wrap);
            }
            row.appendChild(cell);
          }
          return row;
        }

        for (let s=1; s<=5; s++) {
          cthunGridWrap.appendChild(makeRowForSlot(s));
        }
      }

      // initial render view mode
      renderCthunGrid(true);
      content.appendChild(cthunTitle);
      content.appendChild(cthunGridWrap);
      // Add Clear All button (edit mode only)
      const clearWrap = document.createElement('div');
      clearWrap.style.display = 'none';
      clearWrap.style.margin = '8px 0 0 0';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = 'Clear all assignments';
      clearBtn.className = 'btn-clear-all';
      clearBtn.style.fontSize = '12px';
      clearBtn.style.padding = '6px 10px';
      clearBtn.style.borderRadius = '6px';
      clearBtn.style.border = '1px solid #ef4444';
      clearBtn.style.background = 'transparent';
      clearBtn.style.color = '#ef4444';
      clearBtn.addEventListener('click', () => {
        try {
          for (let g=1; g<=8; g++) { for (let s=1; s<=5; s++) { cthunGridState.groups[g][s-1] = null; cthunGridState.acceptByPosition[`${g}:${s}`] = ''; } }
          if (typeof panelDiv._renderCthunGrid === 'function') panelDiv._renderCthunGrid(false);
        } catch {}
      });
      clearWrap.appendChild(clearBtn);
      content.appendChild(clearWrap);
      panelDiv._toggleCthunClear = (show) => { try { clearWrap.style.display = show ? 'block' : 'none'; } catch {} };
      panelDiv._renderCthunGrid = (readOnly) => renderCthunGrid(readOnly);
      panelDiv._getCthunGridState = () => cthunGridState;
    }

    panelDiv.appendChild(header);
    panelDiv.appendChild(content);

    // Add copy macro button (visible to everyone)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-macro-btn';
    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
    copyBtn.title = 'Copy macro';
    copyBtn.style.cssText = 'position: absolute; bottom: 10px; right: 10px; padding: 8px 12px; background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; border-radius: 6px; color: #3b82f6; cursor: pointer; font-size: 14px; transition: all 0.2s; z-index: 10;';
    copyBtn.addEventListener('mouseenter', () => {
      copyBtn.style.background = 'rgba(59, 130, 246, 0.3)';
      copyBtn.style.transform = 'scale(1.05)';
    });
    copyBtn.addEventListener('mouseleave', () => {
      copyBtn.style.background = 'rgba(59, 130, 246, 0.2)';
      copyBtn.style.transform = 'scale(1)';
    });
    copyBtn.addEventListener('click', () => {
      const panelName = boss || 'Assignment';
      
      // Collect assignments
      const assignments = [];
      visibleEntries.forEach(e => {
        const charName = (e.character_name || '').trim();
        const assignment = (e.assignment || '').trim();
        
        if (charName && assignment) {
          assignments.push({ charName, assignment });
        }
      });
      
      // Try full format first
      let lines = [`/rw ${panelName}`];
      assignments.forEach(a => {
        lines.push(`/ra ${a.charName} ${panelName} ${a.assignment}`);
      });
      let macroText = lines.join('\n');
      
      // If too long, use shortened format
      if (macroText.length > 255) {
        lines = [`/rw ${panelName}`];
        assignments.forEach(a => {
          // Abbreviate "Group X and Y" to "GX + GY"
          let shortAssignment = a.assignment
            .replace(/Group\s+(\d+)\s+and\s+(\d+)/gi, 'G$1 + G$2')
            .replace(/Group\s+(\d+)/gi, 'G$1');
          lines.push(`/ra ${a.charName} - ${shortAssignment}`);
        });
        macroText = lines.join('\n');
      }
      
      navigator.clipboard.writeText(macroText).then(() => {
        const originalHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        copyBtn.style.color = '#10b981';
        copyBtn.style.borderColor = '#10b981';
        setTimeout(() => {
          copyBtn.innerHTML = originalHtml;
          copyBtn.style.color = '#3b82f6';
          copyBtn.style.borderColor = '#3b82f6';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy macro:', err);
        alert('Failed to copy macro. Please try again.');
      });
    });
    
    // Make panel position relative so absolute button works
    panelDiv.style.position = 'relative';
    panelDiv.style.paddingBottom = '50px';
    panelDiv.appendChild(copyBtn);

      if (canManage) {
        // Panel-level Edit/Save
        const editBtn = header.querySelector('.btn-edit');
        const saveBtn = header.querySelector('.btn-save');
        const addDefaultsBtn = header.querySelector('.btn-add-defaults');
        
        // Tactics toggle for Four Horsemen (switches between Classic and Cleave)
        const tacticsToggleBtn = header.querySelector('.tactics-toggle-btn');
        if (tacticsToggleBtn) {
          tacticsToggleBtn.addEventListener('click', async () => {
            const currentTactics = tacticsToggleBtn.dataset.currentTactics;
            const newTactics = currentTactics === 'classic' ? 'cleave' : 'classic';
            const baseBossName = 'The Four Horsemen';
            
            // Find both panels in the container
            const container = document.getElementById('assignments-container');
            const classicPanel = Array.from(container.querySelectorAll('.manual-rewards-section')).find(
              p => p.dataset.panelBoss === 'the four horsemen'
            );
            const cleavePanel = Array.from(container.querySelectorAll('.manual-rewards-section')).find(
              p => p.dataset.panelBoss === 'the four horsemen (cleave)'
            );
            
            // Check if both panels exist
            if (!classicPanel || !cleavePanel) {
              alert('Both Classic and Cleave tactics panels must exist. Please ensure both have been created.');
              return;
            }
            
            // Save the preference to the database
            try {
              const eventId = getActiveEventId();
              const saveRes = await fetch(`/api/assignments/${eventId}/horsemen-tactics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activeTactics: newTactics })
              });
              
              if (!saveRes.ok) {
                throw new Error('Failed to save tactics preference');
              }
            } catch (err) {
              console.error('Error saving tactics preference:', err);
              alert('Failed to save tactics preference. Please try again.');
              return;
            }
            
            // Toggle visibility
            if (newTactics === 'cleave') {
              classicPanel.style.display = 'none';
              cleavePanel.style.display = 'block';
            } else {
              classicPanel.style.display = 'block';
              cleavePanel.style.display = 'none';
            }
            
            // Update ALL toggle buttons (in both panels) to stay in sync
            const allToggleBtns = container.querySelectorAll('.tactics-toggle-btn');
            allToggleBtns.forEach(btn => {
              btn.dataset.currentTactics = newTactics;
              btn.textContent = newTactics === 'cleave' ? 'Cleave' : 'Classic';
              btn.style.background = newTactics === 'cleave' ? '#8b5cf6' : '#3b82f6';
            });
          });
        }

        // Add controls
        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '10px';
        controls.style.padding = '0 20px 20px 20px';

        const addBtn = document.createElement('button');
        addBtn.className = 'btn-add';
        addBtn.innerHTML = '<i class="fas fa-plus"></i> Add Entry';
        addBtn.addEventListener('click', () => {
          const newEntry = { character_name: '', class_name: 'Warrior', spec_name: '', spec_emote: '', assignment: '', marker_icon_url: null };
          renderEntryRow(newEntry, list.children.length);
          renumberRows();
          // force edit mode for the new row
          const last = list.lastElementChild; if (last && typeof last._setEdit === 'function') last._setEdit();
        });

        controls.appendChild(addBtn);
        // hidden by default; only shown in edit mode
        controls.style.display = 'none';
        content.appendChild(controls);
        // Default templates per boss
        addDefaultsBtn?.addEventListener('click', async () => {
          try {
            // Confirm and clear existing assignments if present
            const hasExisting = !!(list && list.children && list.children.length > 0);
            if (hasExisting) {
              const sure = window.confirm('This panel already have assignments, are you sure you want to clear then and auto assign new characters?');
              if (!sure) return;
              try { list.innerHTML = ''; } catch {}
            }
            // fetch roster to know party/slot mapping
            const eventId = getActiveEventId();
            const roster = await fetchRoster(eventId);
            try { window.__lastFetchedRosterForAssignments = Array.isArray(roster) ? roster.slice() : []; } catch {}
            const findBy = (party, slot) => roster.find(r => Number(r.party_id) === Number(party) && Number(r.slot_id) === Number(slot));
            const icons = {
              skull: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/1_skull_faqei8.png',
              cross: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/2_cross_kj9wuf.png',
              square: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/3_square_yqucv9.png',
              moon: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/4_moon_vwhoen.png',
              triangle: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/5_triangle_rbpjyi.png',
              diamond: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/6_diamond_hre1uj.png',
              circle: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/7_circle_zayctt.png',
              star: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/8_star_kbuiaq.png'
            };

            const toAdd = [];
            const bossKey = String(boss || '').toLowerCase();
            if (bossKey.includes("anub")) {
              const mt = findBy(1,1);
              const ot1 = findBy(1,2);
              const ot2 = findBy(1,3);
              if (mt) toAdd.push({ r: mt, icon: icons.skull, text: 'Main Tank. Pick up the boss and face it away from the raid.' });
              if (ot1) toAdd.push({ r: ot1, icon: icons.cross, text: 'Off Tank 1. Pick up the right add. Stack it on the boss and stand with the main tank. Use a FAP if needed.' });
              if (ot2) toAdd.push({ r: ot2, icon: icons.square, text: 'Off Tank 2. Pick up the left add. Stack it on the boss and stand with the main tank. Use a FAP if needed.' });
            } else if (bossKey.includes("faerlina")) {
              const pSorted = filterAssignable(roster.filter(r => String(r.class_name).toLowerCase() === 'priest'))
                .sort((a,b) => (Number(a.party_id)||99) - (Number(b.party_id)||99) || (Number(a.slot_id)||99) - (Number(b.slot_id)||99));
              const p1 = pSorted[0];
              const p2 = pSorted[1];
              // #1
              const g11 = findBy(1,1); if (g11) toAdd.push({ r: g11, icon: icons.square, text: 'Tank the boss' });
              // #2
              const g12 = findBy(1,2); if (g12) toAdd.push({ r: g12, icon: icons.triangle, text: 'Tank the left 2 adds' });
              // #3
              if (g12) toAdd.push({ r: g12, icon: icons.moon, text: 'Tank the left 2 adds' });
              // #4
              const g13 = findBy(1,3); if (g13) toAdd.push({ r: g13, icon: icons.diamond, text: 'Tank the right 2 adds' });
              // #5
              if (g13) toAdd.push({ r: g13, icon: icons.circle, text: 'Tank the right 2 adds' });
              // #6
              const g21 = findBy(2,1); if (g21) toAdd.push({ r: g21, icon: icons.skull, text: 'Tank Skull' });
              // #7
              const g22 = findBy(2,2); if (g22) toAdd.push({ r: g22, icon: icons.cross, text: 'Tank Cross (pull it to boss)' });
              // #8
              if (p1) toAdd.push({ r: p1, icon: icons.diamond, text: "Use mind control and Widow's Embrace to dispel Enrage from the boss. Start with Diamond and Circle targets." });
              // #9
              if (p1) toAdd.push({ r: p1, icon: icons.circle, text: "Use mind control and Widow's Embrace to dispel Enrage from the boss. Start with Diamond and Circle targets." });
              // #10
              if (p2) toAdd.push({ r: p2, icon: icons.circle, text: 'Backup mindcontrol in case the assigned priest dies or fails.' });
            } else if (bossKey.includes("maex")) {
              // Build Maexxna defaults
              // 1) Tank with skull from Main->Tanking panel
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                if (dataAll && dataAll.success) {
                  const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                  const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                  const skullUrl = icons.skull;
                  const skullEntry = tankPanel?.entries?.find(en => String(en.marker_icon_url||'').includes('skull')) || tankPanel?.entries?.[0];
                  if (skullEntry && skullEntry.character_name) {
                    const rMatch = roster.find(r => String(r.character_name).toLowerCase() === String(skullEntry.character_name).toLowerCase());
                    const rUse = rMatch || { character_name: skullEntry.character_name, class_name: skullEntry.class_name };
                    toAdd.push({ r: rUse, icon: skullUrl, text: 'Tank the boss (face it away from the raid)' });
                  }
                }
              } catch {}
              // 2) All hunters -> Kill the webs
              filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='hunter'))
                .forEach(r=>toAdd.push({ r, icon: null, text: 'Kill the webs' }));
              // 3) All warlocks -> Kill the webs
              filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='warlock'))
                .forEach(r=>toAdd.push({ r, icon: null, text: 'Kill the webs' }));
              // 4) Two mages with highest group/slot
              const magesDesc = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='mage'))
                .sort((a,b)=> ((Number(b.party_id)||0)-(Number(a.party_id)||0)) || ((Number(b.slot_id)||0)-(Number(a.slot_id)||0)));
              if (magesDesc[0]) toAdd.push({ r: magesDesc[0], icon: null, text: 'Kill the webs' });
              if (magesDesc[1]) toAdd.push({ r: magesDesc[1], icon: null, text: 'Kill the webs' });
              // NEW: 2 Shamans with highest group/slot -> Heal the webs
              const shamansDesc = filterAssignable(roster
                .filter(r => String(r.class_name||'').toLowerCase() === 'shaman'))
                .sort((a,b)=> ((Number(b.party_id)||0)-(Number(a.party_id)||0)) || ((Number(b.slot_id)||0)-(Number(a.slot_id)||0)));
              if (shamansDesc[0]) toAdd.push({ r: shamansDesc[0], icon: null, text: 'Heal the webs' });
              if (shamansDesc[1]) toAdd.push({ r: shamansDesc[1], icon: null, text: 'Heal the webs' });
              // 5) All druids -> cleanse poison on tank
              filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='druid'))
                .forEach(r=>toAdd.push({ r, icon: null, text: 'Cleanse poison on Tank before webspray' }));
              // 6) Lowest shaman -> poison cleansing totem
              const shamansAsc = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='shaman'))
                .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
              if (shamansAsc[0]) toAdd.push({ r: shamansAsc[0], icon: null, text: 'Keep poison cleansing totem up for the tank before webspray.' });
            } else if (bossKey.includes("razu")) {
              // Instructor Razuvious defaults
              let panelsAll = [];
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const pickTankByIndex = (idx) => {
                  const en = tankPanel?.entries?.[idx-1];
                  if (!en || !en.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const t2 = pickTankByIndex(2);
                const t3 = pickTankByIndex(3);
                const t4 = pickTankByIndex(4);
                if (t2) toAdd.push({ r: t2, icon: icons.cross, text: 'Tank the left 2 adds (near but not on top of the priests)' });
                if (t2) toAdd.push({ r: t2, icon: icons.square, text: 'Tank the left 2 adds (near but not on top of the priests)' });
                if (t3) toAdd.push({ r: t3, icon: icons.moon, text: 'Tank the right 2 adds (near but not on top of the priests)' });
                if (t4) toAdd.push({ r: t4, icon: icons.diamond, text: 'Tank the right 2 adds (near but not on top of the priests)' });
              } catch {}
              // Priests: sourced from Healing panel, ranked by MC experience
              {
                // Find the Healing panel (Main page) — same pattern as Four Horsemen healer sourcing
                const healingPanel = panelsAll.find(p => String(p.boss||'').toLowerCase() === 'healing' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
                const healerNames = (healingPanel && Array.isArray(healingPanel.entries) ? healingPanel.entries : [])
                  .map(e => (e.character_name || '').trim())
                  .filter(n => n.length > 0);
                // Match healing panel names against roster for full character data, filter to priests only
                const healPanelPriests = filterAssignable(
                  healerNames
                    .map(name => roster.find(r => String(r.character_name || '').toLowerCase() === name.toLowerCase()))
                    .filter(r => r && String(r.class_name || '').toLowerCase() === 'priest')
                );

                // Fetch experience data and sort by mc_count DESC, with group/slot as tiebreaker
                let sortedPriests;
                try {
                  const expRes = await fetch('/api/razuvious-mc-experience');
                  const expData = await expRes.json();
                  const expMap = {};
                  if (expData.success && Array.isArray(expData.data)) {
                    expData.data.forEach(row => { expMap[String(row.character_name).toLowerCase()] = row.mc_count || 0; });
                  }
                  sortedPriests = healPanelPriests.sort((a, b) => {
                    const expA = expMap[String(a.character_name || '').toLowerCase()] || 0;
                    const expB = expMap[String(b.character_name || '').toLowerCase()] || 0;
                    if (expB !== expA) return expB - expA; // DESC by experience
                    return ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99));
                  });
                } catch {
                  // Fallback to group/slot order on API failure
                  sortedPriests = healPanelPriests.sort((a, b) =>
                    ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99))
                  );
                }

                if (sortedPriests[0]) toAdd.push({ r: sortedPriests[0], icon: icons.cross, text: 'Mind control duty (You pull)' });
                if (sortedPriests[0]) toAdd.push({ r: sortedPriests[0], icon: icons.square, text: 'Mind control duty' });
                if (sortedPriests[1]) toAdd.push({ r: sortedPriests[1], icon: icons.moon, text: 'Mind control duty' });
                if (sortedPriests[1]) toAdd.push({ r: sortedPriests[1], icon: icons.diamond, text: 'Mind control duty' });
              }
              // Warriors target dummies
              const crate = 'https://wow.zamimg.com/images/wow/icons/large/inv_crate_06.jpg';
              const warriorsG2 = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='warrior' && Number(r.party_id)===2))
                .sort((a,b)=> (Number(a.slot_id)||99)-(Number(b.slot_id)||99));
              const warriorsG3 = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='warrior' && Number(r.party_id)===3))
                .sort((a,b)=> (Number(a.slot_id)||99)-(Number(b.slot_id)||99));
              if (warriorsG2[0]) toAdd.push({ r: warriorsG2[0], icon: crate, text: 'Target Dummy #1' });
              if (warriorsG2[1]) toAdd.push({ r: warriorsG2[1], icon: crate, text: 'Target Dummy #2' });
              if (warriorsG2[2]) toAdd.push({ r: warriorsG2[2], icon: crate, text: 'Target Dummy #3' });
              if (warriorsG3[0]) toAdd.push({ r: warriorsG3[0], icon: crate, text: 'Target Dummy #4' });
              if (warriorsG3[1]) toAdd.push({ r: warriorsG3[1], icon: crate, text: 'Target Dummy #5' });
              if (warriorsG3[2]) toAdd.push({ r: warriorsG3[2], icon: crate, text: 'Target Dummy #6' });
            } else if (bossKey.includes("goth")) {
              // Gothik defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const skull = findByMarker('skull');
                const cross = findByMarker('cross');
                const square = findByMarker('square');
                const moon  = findByMarker('moon');
                const triangle = findByMarker('triangle');
                const diamond = findByMarker('diamond');
                if (skull)    toAdd.push({ r: skull,    icon: icons.skull,    text: 'Tank the middle platform' });
                if (cross)    toAdd.push({ r: cross,    icon: icons.cross,    text: 'Tank the left platform' });
                if (square)   toAdd.push({ r: square,   icon: icons.square,   text: 'Tank the right platform' });
                if (moon)     toAdd.push({ r: moon,     icon: icons.moon,     text: 'Tank the front pile' });
                if (triangle) toAdd.push({ r: triangle, icon: icons.triangle, text: 'Tank the left pile' });
                if (diamond)  toAdd.push({ r: diamond,  icon: icons.diamond,  text: 'Tank the back right pile' });
              } catch {}
              // Warlocks and Hunters pet/VW assignment
              filterAssignable(roster.filter(r=>['warlock','hunter'].includes(String(r.class_name||'').toLowerCase())))
                .forEach(r=> toAdd.push({ r, icon: null, text: 'Place your Pet / Void Walker between the platforms to absorbe charge.' }));
              // Healers by side — role-aware algorithm
              const { humanSide, undeadSide } = classifyGothikHealers(roster, filterAssignable);
              undeadSide.forEach(r => toAdd.push({ r, icon: icons.star, text: 'Go heal Undead side.' }));
              humanSide.forEach(r => toAdd.push({ r, icon: icons.circle, text: 'Go heal Human side.' }));
            } else if (bossKey.includes("skeram")) {
              // AQ40: The Prophet Skeram defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                const t4 = findByMarker('moon');
                const t5 = findByMarker('triangle');
                const t6 = findByMarker('diamond');
                const t7 = findByMarker('circle');
                const t8 = findByMarker('star');

                // Tanks: positions
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank middle.' });
                if (t2) toAdd.push({ r: t2, icon: icons.cross,  text: 'Tank left' });
                if (t3) toAdd.push({ r: t3, icon: icons.square, text: 'Tank right' });

                // Kicks: 6 slots -> Rogues first (lowest group/slot), then Tanks starting from Tank4
                const KICK_ICON = 'https://wow.zamimg.com/images/wow/icons/large/ability_kick.jpg';
                const FIST_ICON = 'https://wow.zamimg.com/images/wow/icons/large/inv_gauntlets_04.jpg';
                const sides = ['middle','left','right','middle','left','right'];
                const rogues = filterAssignable((Array.isArray(roster)?roster:[])
                  .filter(r => String(r.class_name||'').toLowerCase()==='rogue'))
                  .sort(sortByGroupSlotAsc);
                const fallbackTanks = [t4,t5,t6,t7,t8].filter(Boolean);
                let fb = 0;
                for (let i=0;i<6;i++) {
                  const side = sides[i];
                  if (rogues[i]) {
                    toAdd.push({ r: rogues[i], icon: KICK_ICON, text: `Kick ${side}` });
                  } else if (fallbackTanks[fb]) {
                    toAdd.push({ r: fallbackTanks[fb], icon: FIST_ICON, text: `Kick ${side}` });
                    fb += 1;
                  }
                }

                // Warlocks: Curse of Tongues Middle/Left/Right with repetition rules
                const TONGUES_ICON = 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_curseoftounges.jpg';
                const wls = filterAssignable((Array.isArray(roster)?roster:[])
                  .filter(r => String(r.class_name||'').toLowerCase()==='warlock'))
                  .sort(sortByGroupSlotAsc);
                const pickWl = (idx) => {
                  if (wls.length >= 3) return wls[idx];
                  if (wls.length === 2) return wls[idx === 2 ? 1 : idx];
                  if (wls.length === 1) return wls[0];
                  return null;
                };
                const wlSides = ['Middle','Left','Right'];
                for (let i=0;i<3;i++) {
                  const r = pickWl(i);
                  if (r) toAdd.push({ r, icon: TONGUES_ICON, text: `Curse of Tongues ${wlSides[i]}`});
                }
              } catch {}
            } else if (bossKey.includes("bug")) {
              // AQ40: Bug Trio defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank Yauj' });
                if (t2) toAdd.push({ r: t2, icon: icons.cross,  text: 'Tank Kri' });
                if (t3) toAdd.push({ r: t3, icon: icons.square, text: 'Tank Vem' });
              } catch {}
            } else if (bossKey.includes("sartura")) {
              // AQ40: Battleguard Sartura defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                const t4 = findByMarker('moon');
                const t5 = findByMarker('triangle');
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank boss' });
                if (t2) toAdd.push({ r: t2, icon: icons.skull,  text: 'Tank boss' });
                if (t3) toAdd.push({ r: t3, icon: icons.square, text: 'Tank add' });
                if (t4) toAdd.push({ r: t4, icon: icons.moon,   text: 'Tank add' });
                if (t5) toAdd.push({ r: t5, icon: icons.triangle, text: 'Tank add' });
                // Rogues for kidney shot rotation
                const KS_ICON = 'https://wow.zamimg.com/images/wow/icons/large/ability_rogue_kidneyshot.jpg';
                const rogues = filterAssignable((Array.isArray(roster)?roster:[])
                  .filter(r => String(r.class_name||'').toLowerCase()==='rogue'))
                  .sort(sortByGroupSlotAsc);
                if (rogues[0]) toAdd.push({ r: rogues[0], icon: KS_ICON, text: '1st stun on boss' });
                if (rogues[1]) toAdd.push({ r: rogues[1], icon: KS_ICON, text: '2nd stun on boss' });
                if (rogues[2]) toAdd.push({ r: rogues[2], icon: KS_ICON, text: '3rd stun on boss' });
              } catch {}
            } else if (bossKey.includes("fank")) {
              // AQ40: Fankriss the Unyielding defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                const t4 = findByMarker('moon');
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank boss' });
                if (t2) toAdd.push({ r: t2, icon: null,        text: 'Tank snakes' });
                if (t3) toAdd.push({ r: t3, icon: null,        text: 'Tank bugs' });
                if (t4) toAdd.push({ r: t4, icon: null,        text: 'Tank bugs' });
              } catch {}
            } else if (bossKey.includes("visc")) {
              // AQ40: Viscidus defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank boss' });
              } catch {}
            } else if (bossKey.includes("huhu") || bossKey.includes("huhuran")) {
              // AQ40: Princess Huhuran defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank boss' });
              } catch {}
            } else if (bossKey.includes("twin emperors")) {
              // AQ40: The Twin Emperors defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                const t4 = findByMarker('moon');
                // Warlocks by lowest group/slot
                const warlocksAsc = filterAssignable((Array.isArray(roster)?roster:[])
                  .filter(r => String(r.class_name||'').toLowerCase()==='warlock'))
                  .sort(sortByGroupSlotAsc);
                const wl1 = warlocksAsc[0] || null;
                const wl2 = warlocksAsc[1] || null;
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank right side' });
                if (wl1) toAdd.push({ r: wl1, icon: icons.skull, text: 'Tank right side' });
                if (t2) toAdd.push({ r: t2, icon: icons.cross,  text: 'Tank left side'  });
                if (wl2) toAdd.push({ r: wl2, icon: icons.cross, text: 'Tank left side'  });
                if (t3) toAdd.push({ r: t3, icon: null,         text: 'Tank adds left side'  });
                if (t4) toAdd.push({ r: t4, icon: null,         text: 'Tank adds right side' });
              } catch {}
            } else if (bossKey.includes("twins") && bossKey.includes("trash")) {
              // AQ40: Twins trash defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                const t4 = findByMarker('moon');
                const t5 = findByMarker('triangle');
                const t6 = findByMarker('diamond');
                const t7 = findByMarker('circle');
                const t8 = findByMarker('star');

                // Slayers left/right
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank Slayer Left'  });
                if (t2) toAdd.push({ r: t2, icon: icons.cross,  text: 'Tank Slayer Left'  });
                if (t3) toAdd.push({ r: t3, icon: icons.square, text: 'Tank Slayer Right' });
                if (t4) toAdd.push({ r: t4, icon: icons.moon,   text: 'Tank Slayer Right' });
                // Big boys away from raid (no specific icon)
                if (t5) toAdd.push({ r: t5, icon: null,         text: 'Tank Big Boy away from raid' });
                if (t6) toAdd.push({ r: t6, icon: null,         text: 'Tank Big Boy away from raid' });
                // Mindslayers stack
                if (t7) toAdd.push({ r: t7, icon: icons.triangle, text: 'Tank Mindslayer (stack them in corner)' });
                if (t4) toAdd.push({ r: t4, icon: icons.triangle, text: 'Tank Mindslayer (stack them in corner)' });
                if (t8) toAdd.push({ r: t8, icon: icons.diamond,  text: 'Tank Mindslayer (stack them in corner)' });
                if (t3) toAdd.push({ r: t3, icon: icons.diamond,  text: 'Tank Mindslayer (stack them in corner)' });
                if (t2) toAdd.push({ r: t2, icon: icons.circle,   text: 'Tank Mindslayer (stack them in corner)' });
                // Any warrior not yet assigned
                const assignedNames = new Set(toAdd.map(e => (e.r && e.r.character_name) ? String(e.r.character_name).toLowerCase() : ''));
                const warriorsExtra = filterAssignable((Array.isArray(roster)?roster:[])
                  .filter(r => String(r.class_name||'').toLowerCase()==='warrior'))
                  .sort(sortByGroupSlotAsc)
                  .filter(r => !assignedNames.has(String(r.character_name||'').toLowerCase()));
                if (warriorsExtra[0]) toAdd.push({ r: warriorsExtra[0], icon: icons.circle, text: 'Tank Mindslayer (stack them in corner)' });
                if (t1) toAdd.push({ r: t1, icon: icons.star, text: 'Tank Mindslayer (stack them in corner)' });
                if (warriorsExtra[1]) toAdd.push({ r: warriorsExtra[1], icon: icons.star, text: 'Tank Mindslayer (stack them in corner)' });
              } catch {}
            } else if (bossKey.includes("ouro")) {
              // AQ40: Ouro defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                const t4 = findByMarker('moon');
                if (t1) toAdd.push({ r: t1, icon: icons.skull, text: 'Tank boss' });
                if (t2) toAdd.push({ r: t2, icon: icons.skull, text: 'Tank boss' });
                if (t3) toAdd.push({ r: t3, icon: icons.skull, text: 'Tank boss' });
                if (t4) toAdd.push({ r: t4, icon: icons.skull, text: 'Tank boss' });
              } catch {}
            } else if (bossKey.includes("c'thun") || bossKey.includes('cthun')) {
              // AQ40: C'Thun defaults + positions grid
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const tank1 = findByMarker('skull');
                const tank2 = findByMarker('cross');
                const tank3 = findByMarker('square');
                const tank4 = findByMarker('moon');
                if (tank1) toAdd.push({ r: tank1, icon: icons.skull, text: 'Pull boss' });

                // Auto-fill C'Thun positions grid
                if (isCthunPanel && typeof panelDiv._getCthunGridState === 'function') {
                  const state = panelDiv._getCthunGridState();
                  for (let g=1; g<=8; g++) { if (!state.groups[g]) state.groups[g] = [null,null,null,null,null]; }
                  const nameKey = v => String(v||'').toLowerCase();
                  // Start with any pre-filled names as already assigned
                  const assigned = new Set();
                  for (let g=1; g<=8; g++) {
                    for (let s=1; s<=5; s++) {
                      const n = state.groups[g][s-1]; if (n) assigned.add(nameKey(n));
                    }
                  }
                  // Tank1 at Group1 Slot1 (only if empty and not already used)
                  const t1Name = tank1?.character_name || null;
                  if (t1Name && !state.groups[1][0] && !assigned.has(nameKey(t1Name))) { state.groups[1][0] = t1Name; assigned.add(nameKey(t1Name)); }
                  // Melee candidates excluding already assigned
                  const meleeAll = filterAssignable((Array.isArray(roster)?roster:[])
                    .filter(r => ['warrior','rogue'].includes(String(r.class_name||'').toLowerCase())))
                    .sort(sortByGroupSlotAsc)
                    .filter(r => !assigned.has(nameKey(r.character_name)));
                  const t2n = tank2?.character_name || null;
                  const t3n = tank3?.character_name || null;
                  const t4n = tank4?.character_name || null;
                  const tNames = new Set([nameKey(t1Name), nameKey(t2n), nameKey(t3n), nameKey(t4n)].filter(Boolean));
                  const meleeNoTanks = meleeAll.filter(r => !tNames.has(nameKey(r.character_name)));
                  // Primary slots that are currently empty
                  const primarySlots = [];
                  if (!state.groups[1][1]) primarySlots.push({g:1,s:2});
                  for (let g=2; g<=8; g++) {
                    if (!state.groups[g][0]) primarySlots.push({g,s:1});
                    if (!state.groups[g][1]) primarySlots.push({g,s:2});
                  }
                  const needed = primarySlots.length; // up to 15
                  const takeOthers = meleeNoTanks.slice(0, needed);
                  const stillNeeded = Math.max(needed - takeOthers.length, 0);
                  const maybeTanks = [t2n, t3n, t4n]
                    .filter(Boolean)
                    .filter(n => !assigned.has(nameKey(n)))
                    .map(n => ({ character_name: n }));
                  const fillFromTanks = stillNeeded > 0 ? maybeTanks.slice(0, stillNeeded) : [];
                  const primaryFill = takeOthers.concat(fillFromTanks);
                  for (let i=0; i<primaryFill.length; i++) {
                    const pos = primarySlots[i]; const r = primaryFill[i];
                    if (!pos || !r || !r.character_name) continue;
                    if (!state.groups[pos.g][pos.s-1] && !assigned.has(nameKey(r.character_name))) {
                      state.groups[pos.g][pos.s-1] = r.character_name;
                      assigned.add(nameKey(r.character_name));
                    }
                  }
                  // Slot 3 fillers: Tanks 2-4 first (if unassigned), then any warrior/rogue flagged "No assignments", then any other leftover melee
                  const leftoverTankNames = [t2n, t3n, t4n]
                    .filter(n => n && !assigned.has(nameKey(n)))
                    .map(n => ({ character_name: n }));
                  const leftoverMelee = filterAssignable((Array.isArray(roster)?roster:[])
                    .filter(r => ['warrior','rogue'].includes(String(r.class_name||'').toLowerCase())))
                    .sort(sortByGroupSlotAsc)
                    .filter(r => !assigned.has(nameKey(r.character_name)) && nameKey(r.character_name) !== nameKey(t1Name));
                  const noAssignMelee = (Array.isArray(roster)?roster:[])
                    .filter(r => ['warrior','rogue'].includes(String(r.class_name||'').toLowerCase()) && isNoAssignmentsRosterRow(r))
                    .sort(sortByGroupSlotAsc)
                    .filter(r => !assigned.has(nameKey(r.character_name)) && nameKey(r.character_name) !== nameKey(t1Name));
                  const slot3Fill = leftoverTankNames.concat(noAssignMelee, leftoverMelee);
                  const slot3Order = [8,7,6,5,4,3,2,1];
                  let lmIdx = 0;
                  for (const g of slot3Order) {
                    if (lmIdx >= slot3Fill.length) break;
                    if (state.groups[g][2]) continue; // already filled, respect existing
                    const r = slot3Fill[lmIdx];
                    if (!r || !r.character_name) break;
                    if (!assigned.has(nameKey(r.character_name))) {
                      state.groups[g][2] = r.character_name;
                      assigned.add(nameKey(r.character_name));
                      lmIdx += 1;
                    }
                  }
                  // Shamans in slot5 (only if empty)
                  const shamans = filterAssignable((Array.isArray(roster)?roster:[])
                    .filter(r => String(r.class_name||'').toLowerCase()==='shaman'))
                    .sort(sortByGroupSlotAsc)
                    .filter(r => !assigned.has(nameKey(r.character_name)));
                  let shIdx = 0; for (let g=1; g<=8; g++) { if (!state.groups[g][4] && shamans[shIdx]) { state.groups[g][4] = shamans[shIdx].character_name; assigned.add(nameKey(shamans[shIdx].character_name)); shIdx += 1; } }
                  // Fill remaining (only empties, skipping already assigned)
                  const everyone = (Array.isArray(roster)?roster:[]).slice().sort(sortByGroupSlotAsc);
                  for (const r of everyone) {
                    const nk = nameKey(r.character_name); if (!nk || assigned.has(nk)) continue;
                    let placed = false; for (let g=1; g<=8 && !placed; g++) { for (let s=1; s<=5 && !placed; s++) { if (!state.groups[g][s-1]) { state.groups[g][s-1] = r.character_name; assigned.add(nk); placed = true; } } }
                  }
                  if (typeof panelDiv._renderCthunGrid === 'function') panelDiv._renderCthunGrid(false);
                }
              } catch {}
            } else if (bossKey.includes("noth")) {
              // Noth the Plaguebringer defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'));
                const getTankByIndex = (idx) => {
                  const en = tankPanel?.entries?.[idx-1];
                  if (!en || !en.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const t1 = getTankByIndex(1);
                const t2 = getTankByIndex(2);
                const t3 = getTankByIndex(3);
                const t4 = getTankByIndex(4);
                if (t1) toAdd.push({ r: t1, icon: icons.skull,  text: 'Tank the boss' });
                if (t2) toAdd.push({ r: t2, icon: null,        text: 'Save Deathwish for the blink and pick up boss after blink and agro reset.' });
                if (t3) toAdd.push({ r: t3, icon: null,        text: 'Pick up adds' });
                if (t4) toAdd.push({ r: t4, icon: null,        text: 'Pick up adds' });
              } catch {}
            } else if (bossKey.includes("heig")) {
              // Heigan the Unclean defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'));
                const getTankByIndex = (idx) => {
                  const en = tankPanel?.entries?.[idx-1];
                  if (!en || !en.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const t1 = getTankByIndex(1);
                if (t1) toAdd.push({ r: t1, icon: icons.skull, text: 'Tank the boss' });
                const priests = filterAssignable(roster.filter(r => String(r.class_name||'').toLowerCase()==='priest'))
                  .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                if (priests[0]) toAdd.push({ r: priests[0], icon: null, text: 'Instantly remove disease from the tank.' });
              } catch {}
            } else if (bossKey.includes("loatheb")) {
              // Loatheb defaults (list entries) + Spore Groups auto-assignment
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const getTankByIndex = (idx) => {
                  const en = tankPanel?.entries?.[idx-1];
                  if (!en || !en.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                const t1 = getTankByIndex(1);
                const t2 = getTankByIndex(2);
                if (t1) toAdd.push({ r: t1, icon: icons.skull, text: 'Tank the boss. (turn it 90 degree to it\'s left and move it a few steps back)' });
                if (t2) toAdd.push({ r: t2, icon: icons.skull, text: 'Backup tank. Get to 2nd on threat and put on a shield.' });
                // Healers by name (alphabetically), only shaman/druid/priest
                const healers = filterAssignable(roster.filter(r=>['shaman','druid','priest'].includes(String(r.class_name||'').toLowerCase())))
                  .sort((a,b)=> String(a.character_name||'').localeCompare(String(b.character_name||'')));
                healers.forEach(r => toAdd.push({ r, icon: null, text: 'Heal the tank when it\'s your turn to heal.' }));

                // Spore Groups auto-fill
                if (isLoathebPanel && typeof panelDiv._getSporeGridState === 'function') {
                  const gridState = panelDiv._getSporeGridState();
                  // Collect tank IDs for exclusion
                  const pick = (idx) => {
                    const en = tankPanel?.entries?.[idx-1];
                    return en?.character_name ? String(en.character_name) : null;
                  };
                  const tankIds = [pick(1), pick(2), pick(3), pick(4)].filter(Boolean);
                  const mages = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='mage'));
                  const warriorsAll = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='warrior'));
                  const warriorNotTanks = warriorsAll.filter(r=>!tankIds.some(n=>String(n).toLowerCase()===String(r.character_name||'').toLowerCase()))
                    .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                  const rogues = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='rogue'));
                  const warlocks = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='warlock'));
                  const hunters = filterAssignable(roster.filter(r=>String(r.class_name||'').toLowerCase()==='hunter'));
                  const tanksFinal = tankIds.map(name => roster.find(r=>String(r.character_name).toLowerCase()===String(name).toLowerCase()) || { character_name: name });
                  const ordered = [...mages, ...warriorNotTanks, ...rogues, ...warlocks, ...hunters, ...tanksFinal];
                  let ptr = 0;
                  for (let g=1; g<=6; g++) {
                    for (let s=1; s<=5; s++) {
                      const r = ordered[ptr++];
                      gridState.groups[g][s-1] = r ? r.character_name : null;
                    }
                  }
                  if (typeof panelDiv._renderSporeGrid === 'function') panelDiv._renderSporeGrid(false);
                }
              } catch {}
            } else if (bossKey.includes("horse")) {
              // The Four Horsemen – healer rotation
              // Fetch all panels first (needed for both healer sourcing and tank grid)
              let panelsAll = [];
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
              } catch {}

              const isCleaveAssign = bossKey.includes("cleave");
              const sortByGS = (a,b) => ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99));

              // Source healers from the Healing panel (Main page) instead of full roster
              const healingPanel = panelsAll.find(p => String(p.boss||'').toLowerCase() === 'healing' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
              const healerNames = (healingPanel && Array.isArray(healingPanel.entries) ? healingPanel.entries : [])
                .map(e => (e.character_name || '').trim())
                .filter(n => n.length > 0);
              const healerClasses = ['shaman', 'priest', 'druid'];
              // Match healing panel names against roster for full character data, filter for healer classes
              const healPanelHealers = filterAssignable(
                healerNames
                  .map(name => roster.find(r => String(r.character_name || '').toLowerCase() === name.toLowerCase()))
                  .filter(r => r && healerClasses.includes(String(r.class_name || '').toLowerCase()))
              );

              // Two-step distribution: anchors (Priests/Druids) first, then Shamans fill
              const anchors = healPanelHealers.filter(r => ['priest', 'druid'].includes(String(r.class_name || '').toLowerCase())).sort(sortByGS);
              const shamans = healPanelHealers.filter(r => String(r.class_name || '').toLowerCase() === 'shaman').sort(sortByGS);

              const raidOrder = [
                { name: 'skull', icon: icons.skull },
                { name: 'cross', icon: icons.cross },
                { name: 'square', icon: icons.square },
                { name: 'moon',  icon: icons.moon }
              ];

              // Step 1: Assign one anchor per mark (up to 4)
              const markHealers = raidOrder.map(() => ({ anchor: null, fillers: [] }));
              const assignedAnchors = anchors.slice(0, 4);
              const excessAnchors = anchors.slice(4);
              assignedAnchors.forEach((r, i) => { markHealers[i].anchor = r; });

              // Step 2: Fill remaining slots (target 3 per mark) from shamans + excess anchors
              const fillPool = [...shamans, ...excessAnchors];
              let fillIdx = 0;
              for (let m = 0; m < 4 && fillIdx < fillPool.length; m++) {
                const slotsUsed = markHealers[m].anchor ? 1 : 0;
                const slotsNeeded = 3 - slotsUsed;
                for (let s = 0; s < slotsNeeded && fillIdx < fillPool.length; s++) {
                  markHealers[m].fillers.push(fillPool[fillIdx++]);
                }
              }

              // Build toAdd entries: fillers get positions 1,2; anchor gets position 3 (last)
              for (let m = 0; m < 4; m++) {
                const raid = raidOrder[m];
                const { anchor, fillers } = markHealers[m];
                const hasAnchor = !!anchor;
                let pos = 1;

                // Add fillers first (positions 1, 2, ...)
                for (const r of fillers) {
                  let text;
                  if (isCleaveAssign) {
                    if (raid.name === 'square' || raid.name === 'moon') {
                      text = `Start on ${raid.name} and stay until you get replaced by other healers, shadow pot if you need to`;
                    } else {
                      text = `Start on ${raid.name} and follow the tank`;
                    }
                  } else {
                    text = `Start on ${raid.name} rotate on ${pos}`;
                  }
                  toAdd.push({ r, icon: raid.icon, text });
                  pos++;
                }

                // Add anchor last (highest position)
                if (hasAnchor) {
                  let text;
                  if (isCleaveAssign) {
                    if (raid.name === 'square' || raid.name === 'moon') {
                      text = `Start on ${raid.name} and stay until you get replaced by other healers, shadow pot if you need to`;
                    } else {
                      text = `Start on ${raid.name} and follow the tank`;
                    }
                  } else {
                    text = `Start on ${raid.name} rotate on ${pos}`;
                  }
                  toAdd.push({ r: anchor, icon: raid.icon, text });
                }
              }

              // Also populate tank grid from Main->Tanking panel (rows 1..8 map to tank indices 1..8)
              try {
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const getTankByIndex = (idx) => {
                  const en = tankPanel?.entries?.[idx-1];
                  if (!en || !en.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(en.character_name).toLowerCase()) || { character_name: en.character_name, class_name: en.class_name };
                };
                if (isHorsemenPanel && typeof panelDiv._getHorseGridState === 'function') {
                  const state = panelDiv._getHorseGridState();
                  // Cleave tactics: only 4 tanks from main tanking panel
                  // Classic tactics: 8 tanks with swap mapping
                  if (isCleaveAssign) {
                    // For Cleave, just use the first 4 main tanks directly
                    for (let row=1; row<=4; row++) {
                      const t = getTankByIndex(row);
                      state.tanksByRow[row] = [t ? t.character_name : null];
                    }
                  } else {
                    // Classic: Map rows 1-4 to tank indices with swap: row1<-tank3, row3<-tank1; row2<-tank2, row4<-tank4
                    const indexMap = [null, 3, 2, 1, 4];
                    for (let row = 1; row <= 4; row++) {
                      const srcIdx = indexMap[row] ?? row;
                      const t = getTankByIndex(srcIdx);
                      state.tanksByRow[row] = [t ? t.character_name : null];
                    }

                    // Rows 5-8: fill with experience-sorted Warriors from the raid roster
                    try {
                      const expRes = await fetch('/api/four-horsemen-experience');
                      const expData = await expRes.json();
                      const expMap = {};
                      if (expData.success && Array.isArray(expData.data)) {
                        expData.data.forEach(e => { expMap[String(e.character_name).toLowerCase()] = e.tank_count || 0; });
                      }

                      // Collect names already assigned to rows 1-4
                      const assignedNames = new Set();
                      for (let r = 1; r <= 4; r++) {
                        const n = (state.tanksByRow[r] || [])[0];
                        if (n) assignedNames.add(String(n).toLowerCase());
                      }

                      // Filter roster to Warriors not already in rows 1-4, sort by experience DESC
                      const eligibleWarriors = filterAssignable(
                        roster.filter(r => {
                          const cls = canonicalizeClass(String(r.class_name || ''));
                          return cls === 'warrior' && !assignedNames.has(String(r.character_name || '').toLowerCase());
                        })
                      ).sort((a, b) => {
                        const countA = expMap[String(a.character_name || '').toLowerCase()] || 0;
                        const countB = expMap[String(b.character_name || '').toLowerCase()] || 0;
                        if (countB !== countA) return countB - countA;
                        return ((Number(a.party_id) || 99) - (Number(b.party_id) || 99)) || ((Number(a.slot_id) || 99) - (Number(b.slot_id) || 99));
                      });

                      // Assign top 4 eligible Warriors to rows 5-8
                      for (let row = 5; row <= 8; row++) {
                        const w = eligibleWarriors[row - 5];
                        state.tanksByRow[row] = [w ? w.character_name : null];
                      }
                    } catch (expErr) {
                      // Fallback: leave rows 5-8 from tanking panel as before
                      for (let row = 5; row <= 8; row++) {
                        const t = getTankByIndex(row);
                        state.tanksByRow[row] = [t ? t.character_name : null];
                      }
                    }
                  }
                  if (typeof panelDiv._renderHorseGrid === 'function') panelDiv._renderHorseGrid(true);
                }
              } catch {}
            } else if (bossKey.includes("loatheb")) {
              // Loatheb Spore Groups auto-assignment
              if (isLoathebPanel && typeof panelDiv._getSporeGridState === 'function') {
                // Build assignment list per rules
                const gridState = panelDiv._getSporeGridState();
                // 1) All Mages
                const mages = roster.filter(r=>String(r.class_name||'').toLowerCase()==='mage');
                // 2) All Warriors except 4 tanks from Main->Tanking (ID1..ID4)
                let tankIds = [];
                try {
                  const resAll = await fetch(`/api/assignments/${eventId}`);
                  const dataAll = await resAll.json();
                  const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                  // Prefer Main page Tanking; fallback to any panel named Tanking
                  const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                  const pick = (idx) => {
                    const en = tankPanel?.entries?.[idx-1];
                    return en?.character_name ? String(en.character_name) : null;
                  };
                  tankIds = [pick(1), pick(2), pick(3), pick(4)].filter(Boolean);
                } catch {}
                const warriorsAll = roster.filter(r=>String(r.class_name||'').toLowerCase()==='warrior');
                const warriorNotTanks = warriorsAll.filter(r=>!tankIds.some(n=>String(n).toLowerCase()===String(r.character_name||'').toLowerCase()))
                  .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                // 3) All Rogues
                const rogues = roster.filter(r=>String(r.class_name||'').toLowerCase()==='rogue');
                // 4) All Warlocks
                const warlocks = roster.filter(r=>String(r.class_name||'').toLowerCase()==='warlock');
                // 5) All Hunters
                const hunters = roster.filter(r=>String(r.class_name||'').toLowerCase()==='hunter');
                // 6) Finally the 4 tanks ID1..ID4 in that order
                const tanksFinal = tankIds.map(name => roster.find(r=>String(r.character_name).toLowerCase()===String(name).toLowerCase()) || { character_name: name });

                const ordered = [
                  ...mages,
                  ...warriorNotTanks,
                  ...rogues,
                  ...warlocks,
                  ...hunters,
                  ...tanksFinal
                ];
                // Fill vertically by group: G1 S1..S5, then G2 S1..S5, ...
                let ptr = 0;
                for (let g=1; g<=6; g++) {
                  for (let s=1; s<=5; s++) {
                    const r = ordered[ptr++];
                    gridState.groups[g][s-1] = r ? r.character_name : null;
                  }
                }
                // re-render grid in edit mode for visibility
                if (typeof panelDiv._renderSporeGrid === 'function') panelDiv._renderSporeGrid(false);
              }
            } else if (bossKey.includes("patch")) {
              // Patchwerk defaults: 3 tanks + healer assignments
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');   // ID1 on main -> Skull
                const t2 = findByMarker('cross');   // ID2 on main -> Cross
                const t3 = findByMarker('square');  // ID3 on main -> Square
                if (t1) toAdd.push({ r: t1, icon: icons.circle,  text: 'Tank Boss' });
                if (t2) toAdd.push({ r: t2, icon: icons.star,    text: 'Absorb hateful strike' });
                if (t3) toAdd.push({ r: t3, icon: icons.diamond, text: 'Absorb hateful strike' });
                // Healers: all shamans, priests, druids alphabetically by character name
                const isHealer = (r) => ['shaman','priest','druid'].includes(String(r.class_name||'').toLowerCase());
                const healers = (Array.isArray(roster)?roster:[]).filter(isHealer)
                  .sort((a,b) => String(a.character_name||'').localeCompare(String(b.character_name||'')));
                const tankTargets = [ t1?.character_name || '', t2?.character_name || '', t3?.character_name || '' ];
                const tankIcons = [ icons.circle, icons.star, icons.diamond ];
                for (let i=0; i<healers.length; i++) {
                  // First 12 healers: 4 per tank (t1,t2,t3). Clip to available tanks if fewer than 3.
                  if (i < 12 && (t1 || t2 || t3)) {
                    const block = Math.floor(i / 4); // 0..2
                    const tankIdx = Math.min(block, (tankTargets.filter(Boolean).length || 1) - 1);
                    const targetName = tankTargets[tankIdx] || '';
                    if (targetName) {
                      toAdd.push({ r: healers[i], icon: tankIcons[tankIdx] || null, text: `Heal ${targetName}` });
                    } else {
                      toAdd.push({ r: healers[i], icon: null, text: 'FFA Heal tanks only' });
                    }
                  } else {
                    toAdd.push({ r: healers[i], icon: null, text: 'FFA Heal tanks only' });
                  }
                }
              } catch {}
            } else if (bossKey.includes("grobb")) {
              // Grobbulus defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                if (t1) toAdd.push({ r: t1, icon: icons.skull, text: 'Tank Boss' });
                if (t2) toAdd.push({ r: t2, icon: null, text: 'Tank slimes' });
                if (t3) toAdd.push({ r: t3, icon: null, text: 'Tank slimes (backup)' });
                // Lowest priest by group/slot
                const priests = (Array.isArray(roster)?roster:[])
                  .filter(r => String(r.class_name||'').toLowerCase()==='priest')
                  .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                if (priests[0]) toAdd.push({ r: priests[0], icon: null, text: 'Dispel when players is at the edge.' });
              } catch {}
            } else if (bossKey.includes("gluth")) {
              // Gluth defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                const t3 = findByMarker('square');
                if (t1) toAdd.push({ r: t1, icon: icons.skull, text: 'Tank Boss' });
                if (t2) toAdd.push({ r: t2, icon: icons.skull, text: 'Backup Tank Boss (in casee main tank fails fear dodge)' });
                if (t3) toAdd.push({ r: t3, icon: 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_deathscream.jpg', text: 'Piercing Howl Tank adds' });
                // Druid for kiting zombies - lowest by group/slot
                const druids = filterAssignable((Array.isArray(roster)?roster:[]).filter(r => String(r.class_name||'').toLowerCase()==='druid'))
                  .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)));
                if (druids[0]) toAdd.push({ r: druids[0], icon: icons.star, text: 'Kite Zombie Chow (stay max range from boss)' });
              } catch {}
            } else if (bossKey.includes("sapph")) {
              // Sapphiron defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const t1 = findByMarker('skull');
                const t2 = findByMarker('cross');
                if (t1) toAdd.push({ r: t1, icon: icons.skull, text: 'Tank Boss' });
                if (t2) toAdd.push({ r: t2, icon: icons.skull, text: 'Backup Tank Boss (Stay 2nd on threat)' });

                // Mages left/right split: use only mages for count and split (ignore druids)
                const mages = filterAssignable((Array.isArray(roster)?roster:[]).filter(r => String(r.class_name||'').toLowerCase()==='mage'));
                const leftCap = Math.floor(mages.length / 2);
                const rightCap = mages.length - leftCap;
                const mageLeft = mages.slice(0, leftCap);
                const mageRight = mages.slice(leftCap, leftCap + rightCap);
                mageLeft.forEach(m => toAdd.push({ r: m, icon: null, text: 'Decurse Tank + left' }));
                mageRight.forEach(m => toAdd.push({ r: m, icon: null, text: 'Decurse Tank + right' }));

                // Healers: Shamans, Priests, Druids (in that order)
                const shamans = filterAssignable((Array.isArray(roster)?roster:[]).filter(r => String(r.class_name||'').toLowerCase()==='shaman'));
                const priests = filterAssignable((Array.isArray(roster)?roster:[]).filter(r => String(r.class_name||'').toLowerCase()==='priest'));
                const druidsH = filterAssignable((Array.isArray(roster)?roster:[]).filter(r => String(r.class_name||'').toLowerCase()==='druid'));
                const healers = [...shamans, ...priests, ...druidsH];
                healers.forEach((r, i) => {
                  let text = '';
                  if (i === 0) text = 'Heal Tank + Group';
                  else if (i <= 4) text = 'Heal Group';
                  else if (i <= 7) text = 'Heal Group + Tank';
                  else if (i <= 11) text = 'Heal Tank';
                  else text = 'Heal Raid';
                  toAdd.push({ r, icon: null, text });
                });
              } catch {}
            } else if (bossKey.includes("kel")) {
              // Kel'Thuzad defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const id1 = findByMarker('skull');
                const id2 = findByMarker('cross');
                const id3 = findByMarker('square');
                const id4 = findByMarker('moon');
                if (id1) toAdd.push({ r: id1, icon: icons.skull, text: 'Tank Boss' });
                if (id2) toAdd.push({ r: id2, icon: icons.skull, text: 'Tank Boss' });
                if (id3) toAdd.push({ r: id3, icon: icons.skull, text: 'Tank Boss' });
                if (id4) toAdd.push({ r: id4, icon: icons.skull, text: 'Tank Boss' });
                // Build Kel grid: D gets the 4 tanks (ID1..ID4), B gets all rogues, remaining warriors spread across A,B,C
                if (isKelPanel && typeof panelDiv._getKelGridState === 'function') {
                  const state = panelDiv._getKelGridState();
                  const rogues = (Array.isArray(roster)?roster:[]).filter(r => String(r.class_name||'').toLowerCase()==='rogue');
                  const allWarriors = (Array.isArray(roster)?roster:[]).filter(r => String(r.class_name||'').toLowerCase()==='warrior');
                  const tankNames = [id1?.character_name, id2?.character_name, id3?.character_name, id4?.character_name].filter(Boolean).map(n => String(n).toLowerCase());
                  const remainingWarriors = allWarriors.filter(r => !tankNames.includes(String(r.character_name||'').toLowerCase()));
                  // D column (4): the tanks in order
                  state.groups[4] = [id1?.character_name||null, id2?.character_name||null, id3?.character_name||null, id4?.character_name||null].filter(Boolean);
                  // B column (2): all rogues
                  state.groups[2] = rogues.map(r => r.character_name);
                  // A(1), B(2) and C(3): spread remaining warriors evenly, extra goes to A then C
                  const targets = [1,2,3];
                  const counts = {1: (state.groups[1]||[]).length, 2: state.groups[2].length, 3: (state.groups[3]||[]).length};
                  for (const w of remainingWarriors) {
                    // choose group with minimum count among A,B,C, tie-breaker A then C then B
                    const order = [1,3,2];
                    let best = 1;
                    for (const g of order) { if (counts[g] < counts[best]) best = g; }
                    if (!state.groups[best]) state.groups[best] = [];
                    state.groups[best].push(w.character_name);
                    counts[best] += 1;
                  }
                  if (typeof panelDiv._renderKelGrid === 'function') panelDiv._renderKelGrid(false);
                }
                // Priests: 3 lowest by group/slot
                const priests = (Array.isArray(roster)?roster:[])
                  .filter(r => String(r.class_name||'').toLowerCase()==='priest')
                  .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)))
                  .slice(0,3);
                const priestIcons = [icons.star, icons.moon, icons.cross];
                const priestTexts = ['Shackle Left, middle, right.', 'Shackle Left, middle, right.', 'Shackle Left, middle, right.'];
                priests.forEach((p, i) => { toAdd.push({ r: p, icon: priestIcons[i] || null, text: priestTexts[i] }); });
                // Shamans: 4 lowest by group/slot with mark-specific text
                const shamans = (Array.isArray(roster)?roster:[])
                  .filter(r => String(r.class_name||'').toLowerCase()==='shaman')
                  .sort((a,b)=> ((Number(a.party_id)||99)-(Number(b.party_id)||99)) || ((Number(a.slot_id)||99)-(Number(b.slot_id)||99)))
                  .slice(0,4);
                const shamanIcons = [icons.triangle, icons.diamond, icons.square, icons.circle];
                const shamanMarks = ['Triangle','Diamond','Square','Circle'];
                shamans.forEach((s, i) => {
                  const mark = shamanMarks[i] || 'Triangle';
                  toAdd.push({ r: s, icon: shamanIcons[i] || null, text: `NF+Chain Heal on ${mark}` });
                });
              } catch {}
            } else if (bossKey.includes("thadd")) {
              // Thaddius defaults
              try {
                const resAll = await fetch(`/api/assignments/${eventId}`);
                const dataAll = await resAll.json();
                const panelsAll = Array.isArray(dataAll.panels) ? dataAll.panels : [];
                const tankPanel = panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking' && (!p.wing || String(p.wing).trim()==='' || String(p.wing).toLowerCase()==='main'))
                                   || panelsAll.find(p => String(p.boss||'').toLowerCase()==='tanking');
                const findByMarker = (markerSubstr) => {
                  if (!tankPanel || !Array.isArray(tankPanel.entries)) return null;
                  const entry = tankPanel.entries.find(en => String(en.marker_icon_url||'').toLowerCase().includes(markerSubstr));
                  if (!entry || !entry.character_name) return null;
                  return roster.find(r => String(r.character_name).toLowerCase() === String(entry.character_name).toLowerCase()) || { character_name: entry.character_name, class_name: entry.class_name };
                };
                const id1 = findByMarker('skull');
                const id2 = findByMarker('cross');
                const id3 = findByMarker('square');
                const id4 = findByMarker('moon');
                if (id1) toAdd.push({ r: id1, icon: icons.skull, text: 'Tank Stalagg (Left Side)' });
                if (id3) toAdd.push({ r: id3, icon: icons.skull, text: 'Tank Stalagg (Left Side)' });
                if (id2) toAdd.push({ r: id2, icon: icons.cross, text: 'Tank Feugen (Right Side)' });
                if (id4) toAdd.push({ r: id4, icon: icons.cross, text: 'Tank Feugen (Right Side)' });
                if (id1) toAdd.push({ r: id1, icon: icons.skull, text: 'Tank Boss' });

                // Group 8 healers → split between sides (up to 5), extra goes right; if >=2 of same class, split across sides
                const healerClasses = new Set(['shaman','priest','druid']);
                const g8HealersAll = (Array.isArray(roster)?roster:[])
                  .filter(r => Number(r.party_id) === 8 && healerClasses.has(String(r.class_name||'').toLowerCase()))
                  .sort((a,b)=> (Number(a.slot_id)||99) - (Number(b.slot_id)||99));
                const g8Healers = g8HealersAll.slice(0, 5);
                if (g8Healers.length > 0) {
                  const classToPlayers = new Map();
                  for (const r of g8Healers) {
                    const cls = String(r.class_name||'').toLowerCase();
                    if (!classToPlayers.has(cls)) classToPlayers.set(cls, []);
                    classToPlayers.get(cls).push(r);
                  }
                  const left = [];
                  const right = [];
                  const placed = new Set();
                  // Ensure both sides get a player for classes with >= 2
                  for (const [cls, arr] of classToPlayers.entries()) {
                    if (arr.length >= 2) {
                      const a = arr[0]; const b = arr[1];
                      left.push(a); placed.add(a.character_name);
                      right.push(b); placed.add(b.character_name);
                    }
                  }
                  // Remaining players preserve original order
                  const leftovers = g8Healers.filter(r => !placed.has(r.character_name));
                  for (const r of leftovers) {
                    // bias right on tie so odd extra goes right
                    if (left.length < right.length) left.push(r); else right.push(r);
                  }
                  // Create entries
                  for (const r of left)  toAdd.push({ r, icon: null, text: 'Go left side' });
                  for (const r of right) toAdd.push({ r, icon: null, text: 'Go right side' });
                }
              } catch {}
            }

            // Insert at top in order; ensure edit mode for visibility
            // stay in view mode; do not force edit
            // Replace flagged players with next suitable candidates where applicable
            const replaced = ensureToAddReplacements(
              toAdd,
              roster,
              { preserveClass: true }
            );
            for (let i = replaced.length - 1; i >= 0; i--) {
              const { r, icon, text } = replaced[i];
              const entry = {
                character_name: r.character_name,
                class_name: r.class_name,
                spec_name: r.spec_name,
                spec_emote: r.spec_emote,
                marker_icon_url: icon,
                assignment: text
              };
              renderEntryRow(entry, 0);
              // move to top (prepend) by inserting before first child
              const newRow = list.lastElementChild;
              if (newRow) list.insertBefore(newRow, list.firstElementChild);
            }
            renumberRows();
            // Auto-save after auto-assign on detailed boss panels
            try {
              const payloadPanel = {
                dungeon,
                wing: wing || '',
                boss,
                strategy_text: currentStrategy || strategy_text || '',
                image_url: image_url || '',
                video_url: currentVideoUrl || '',
                entries: []
              };
              if (isHorsemenPanel && horseGridState) {
                payloadPanel.horsemen_tanks = horseGridState.tanksByRow;
                Object.entries(horseGridState.tanksByRow).forEach(([row, arr]) => {
                  const name = (arr||[])[0];
                  if (!name) return;
                  payloadPanel.entries.push({ character_name: name, marker_icon_url: null, assignment: `__HGRID__:${row}:1`, accept_status: (horseGridState.acceptByRow && horseGridState.acceptByRow[row]) ? horseGridState.acceptByRow[row] : null });
                });
              }
              if (isLoathebPanel && sporeGridState) {
                payloadPanel.spore_groups = sporeGridState.groups;
                Object.entries(sporeGridState.groups).forEach(([group, arr]) => { 
                  (arr||[]).forEach((name, idx) => { 
                    if (!name) return; 
                    const posKey = `${group}:${idx+1}`;
                    const acceptStatus = (sporeGridState.acceptByPosition && sporeGridState.acceptByPosition[posKey]) || null;
                    payloadPanel.entries.push({ character_name: name, marker_icon_url: null, assignment: `__SPORE__:${group}:${idx+1}`, accept_status: acceptStatus }); 
                  }); 
                });
              }
              if (isKelPanel && kelGridState) {
                payloadPanel.kel_groups = kelGridState.groups;
                Object.entries(kelGridState.groups).forEach(([group, arr]) => { 
                  (arr||[]).forEach((name, idx) => { 
                    if (!name) return; 
                    const posKey = `${group}:${idx+1}`;
                    const acceptStatus = (kelGridState.acceptByPosition && kelGridState.acceptByPosition[posKey]) || null;
                    payloadPanel.entries.push({ character_name: name, marker_icon_url: null, assignment: `__KEL__:${group}:${idx+1}`, accept_status: acceptStatus }); 
                  }); 
                });
              }
              if (isCthunPanel && cthunGridState) {
                payloadPanel.cthun_positions = cthunGridState.groups;
                Object.entries(cthunGridState.groups).forEach(([group, arr]) => { 
                  (arr||[]).forEach((name, idx) => { 
                    if (!name) return; 
                    const posKey = `${group}:${idx+1}`;
                    const acceptStatus = (cthunGridState.acceptByPosition && cthunGridState.acceptByPosition[posKey]) || null;
                    payloadPanel.entries.push({ character_name: name, marker_icon_url: null, assignment: `__CTHUN__:${group}:${idx+1}`, accept_status: acceptStatus }); 
                  }); 
                });
              }
              for (const row of Array.from(list.children)) {
                if (!row.querySelector) continue;
                const getVal = sel => row.querySelector(sel)?.value || '';
                const entry = {
                  character_name: getVal('[data-field="character_name"]') || row.querySelector('.character-name')?.textContent || '',
                  marker_icon_url: row.dataset.markerUrl || null,
                  assignment: getVal('[data-field="assignment"]') || row.querySelector('.entry-assignment-text')?.textContent || '',
                  accept_status: row.dataset.acceptStatus || null
                };
                if (entry.character_name) payloadPanel.entries.push(entry);
              }
              const eventId = getActiveEventId();
              await fetch(`/api/assignments/${eventId}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panels: [payloadPanel] }) });
            } catch {}
          } catch {}
        });

        editBtn?.addEventListener('click', () => {
          // Switch rows to edit mode so delete X appears
          Array.from(list.children).forEach(r => { if (typeof r._setEdit === 'function') r._setEdit(); });
          controls.style.display = 'flex';
          renderDesc(false);
          renderVideoInput(false);
          // show save, hide edit while in edit mode
          if (saveBtn) saveBtn.style.display = 'inline-block';
          if (editBtn) editBtn.style.display = 'none';
          if (addDefaultsBtn) addDefaultsBtn.style.display = 'inline-block';
          if (isHorsemenPanel && typeof panelDiv._renderHorseGrid === 'function') panelDiv._renderHorseGrid(false);
          if (isLoathebPanel && typeof panelDiv._renderSporeGrid === 'function') panelDiv._renderSporeGrid(false);
          if (isKelPanel && typeof panelDiv._renderKelGrid === 'function') panelDiv._renderKelGrid(false);
          if (isCthunPanel) {
            if (typeof panelDiv._toggleCthunClear === 'function') panelDiv._toggleCthunClear(true);
            if (typeof panelDiv._renderCthunGrid === 'function') panelDiv._renderCthunGrid(false);
          }
        });

        saveBtn?.addEventListener('click', async () => {
        const editedText = (content.querySelector('[data-field="strategy_text"]')?.value) || strategy_text || '';
        const payloadPanel = {
            dungeon,
            wing: wing || '',
            boss,
            strategy_text: editedText,
            image_url: (content.querySelector('[data-field="image_url"]')?.value) || image_url || '',
            video_url: (content.querySelector('[data-field="video_url"]')?.value) || '',
            entries: []
          };
          // Prompt to save per-event vs as new default when changing from default
          try {
            const wasDefault = String(strategy_text||'').trim().length === 0 && String(fallbackDefault||'').trim().length > 0;
            const changed = String(editedText).trim() !== String(strategy_text||'').trim();
            if (changed && (wasDefault || String(editedText).trim() !== String(fallbackDefault||'').trim())) {
              const choice = await new Promise((resolve, reject) => {
                const buttons = [
                  { text: 'For this event', action: 'confirm', style: 'primary' },
                  { text: 'Save as new default', action: 'save_default', style: 'success' },
                  { text: 'Cancel', action: 'cancel', style: 'secondary' }
                ];
                window.showCustomModal({
                  title: 'Save strategy text',
                  message: 'Do you want to save the updated strategy text for this event, or save as the new default text?',
                  buttons,
                  onConfirm: () => resolve('event'),
                  onCancel: () => reject(new Error('cancelled'))
                });
                setTimeout(() => {
                  try {
                    const modal = document.querySelector('.confirmation-overlay');
                    const btns = modal ? Array.from(modal.querySelectorAll('.btn')) : [];
                    const saveDefaultBtn = btns.find(b => (b.textContent||'').toLowerCase().includes('save as new default'));
                    if (saveDefaultBtn) saveDefaultBtn.addEventListener('click', () => resolve('default'));
                  } catch {}
                }, 0);
              });
              if (choice === 'default') {
                try {
                  await fetch('/api/assignments/defaults/save', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dungeon, wing: wing || '', boss, default_strategy_text: editedText })
                  });
                } catch {}
              }
            }
          } catch { return; }
          // Persist Four Horsemen grid state if present
          if (isHorsemenPanel && horseGridState) {
            payloadPanel.horsemen_tanks = horseGridState.tanksByRow;
            // also persist as hidden entries so the state restores even if horsemen_tanks is missing
            Object.entries(horseGridState.tanksByRow).forEach(([row, arr]) => {
              const name = (arr||[])[0];
              if (!name) return;
              payloadPanel.entries.push({
                character_name: name,
                marker_icon_url: null,
                assignment: `__HGRID__:${row}:1`,
                accept_status: (horseGridState.acceptByRow && horseGridState.acceptByRow[row]) ? horseGridState.acceptByRow[row] : null
              });
            });
          }
          // Persist Loatheb Spore Groups if present
          if (isLoathebPanel && sporeGridState) {
            payloadPanel.spore_groups = sporeGridState.groups;
            Object.entries(sporeGridState.groups).forEach(([group, arr]) => {
              (arr||[]).forEach((name, idx) => {
                if (!name) return;
                payloadPanel.entries.push({
                  character_name: name,
                  marker_icon_url: null,
                  assignment: `__SPORE__:${group}:${idx+1}`,
                  accept_status: null
                });
              });
            });
          }
          // Persist Kel'Thuzad Groups if present
          if (isKelPanel && kelGridState) {
            payloadPanel.kel_groups = kelGridState.groups;
            Object.entries(kelGridState.groups).forEach(([group, arr]) => {
              (arr||[]).forEach((name, idx) => {
                if (!name) return;
                payloadPanel.entries.push({
                  character_name: name,
                  marker_icon_url: null,
                  assignment: `__KEL__:${group}:${idx+1}`,
                  accept_status: null
                });
              });
            });
          }
          // Persist C'Thun positions if present
          if (isCthunPanel && cthunGridState) {
            payloadPanel.cthun_positions = cthunGridState.groups;
            Object.entries(cthunGridState.groups).forEach(([group, arr]) => {
              (arr||[]).forEach((name, idx) => {
                if (!name) return;
                payloadPanel.entries.push({
                  character_name: name,
                  marker_icon_url: null,
                  assignment: `__CTHUN__:${group}:${idx+1}`,
                  accept_status: null
                });
              });
            });
          }
          for (const row of Array.from(list.children)) {
            if (!row.querySelector) continue;
            const getVal = sel => row.querySelector(sel)?.value || '';
            const entry = {
              character_name: getVal('[data-field="character_name"]') || row.querySelector('.character-name')?.textContent || '',
              marker_icon_url: row.dataset.markerUrl || null,
              assignment: getVal('[data-field="assignment"]') || row.querySelector('.entry-assignment-text')?.textContent || '',
              accept_status: row.dataset.acceptStatus || null
            };
            if (entry.character_name) payloadPanel.entries.push(entry);
          }

            const eventId = getActiveEventId();
            const res = await fetch(`/api/assignments/${eventId}/save`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ panels: [payloadPanel] })
            });
            // Switch to view mode
            Array.from(list.children).forEach(r => { if (typeof r._setReadOnly === 'function') r._setReadOnly(); });
            controls.style.display = 'none';
            currentStrategy = payloadPanel.strategy_text;
            currentVideoUrl = payloadPanel.video_url || '';
            renderDesc(true);
            renderVideoInput(true);
            renderVideo();
            // hide save, show edit; keep Auto assign visible
            if (saveBtn) saveBtn.style.display = 'none';
            if (editBtn) editBtn.style.display = 'inline-block';
            if (addDefaultsBtn) addDefaultsBtn.style.display = 'inline-block';
          if (isHorsemenPanel && typeof panelDiv._renderHorseGrid === 'function') panelDiv._renderHorseGrid(true);
          if (isLoathebPanel && typeof panelDiv._renderSporeGrid === 'function') panelDiv._renderSporeGrid(true);
          if (isKelPanel && typeof panelDiv._renderKelGrid === 'function') panelDiv._renderKelGrid(true);
          if (isCthunPanel) {
            if (typeof panelDiv._toggleCthunClear === 'function') panelDiv._toggleCthunClear(false);
            if (typeof panelDiv._renderCthunGrid === 'function') panelDiv._renderCthunGrid(true);
          }
        });
    }

    return panelDiv;
  }

  // Lightweight panel builder for Main Assignments (no big image/video)
  function buildMainPanel(panel, user, roster) {
    const { dungeon, wing, boss, strategy_text } = panel;
    const canManage = !!(user && user.loggedIn && user.hasManagementRole);
    const headerTitle = boss || 'Panel';
    const entries = Array.isArray(panel.entries) ? panel.entries : [];
    const nameToDiscordId = new Map((Array.isArray(roster)?roster:[]).map(r => [String(r.character_name||'').toLowerCase(), r.discord_user_id]));

    const panelDiv = document.createElement('div');
    panelDiv.className = 'manual-rewards-section main-panel';
    panelDiv.dataset.panelBoss = String(boss || '').toLowerCase();
    if (panel.header_color) { try { panelDiv.style.setProperty('--panel-accent', panel.header_color); } catch {} }

    const header = document.createElement('div');
    header.className = 'section-header assignment-header';
    if (panel.header_color) header.style.background = panel.header_color;
    const headerImg = panel.header_icon_url || '';
    header.innerHTML = `
      <h2>${headerImg ? `<img src="${headerImg}" alt="Header" class="boss-icon">` : ''} ${headerTitle}</h2>
      <div class="assignments-actions" ${canManage ? '' : 'style="display:none;"'}>
        <button class="btn-add-defaults" title="Auto assign" data-panel-key="${dungeon}|${wing || ''}|${boss}"><i class="fas fa-magic"></i> Auto assign</button>
        <button class="btn-edit" title="Edit Panel" data-panel-key="${dungeon}|${wing || ''}|${boss}"><i class="fas fa-edit"></i> Edit</button>
        <button class="btn-save" style="display:none;" title="Save" data-panel-key="${dungeon}|${wing || ''}|${boss}"><i class="fas fa-save"></i> Save</button>
      </div>
    `;

    const content = document.createElement('div');
    content.className = 'manual-rewards-content';

    // Optional short description
    let currentStrategy = strategy_text || '';
    const desc = document.createElement('div');
    function renderDesc(readOnly) {
      if (readOnly) {
        desc.innerHTML = currentStrategy ? `<p class="strategy-text" style="color:#ddd; line-height:1.4;">${escapeHtml(currentStrategy)}</p>` : '';
      } else {
        desc.innerHTML = `<textarea class="assignment-editable assignment-textarea" data-field="strategy_text" placeholder="Optional notes...">${escapeHtml(currentStrategy || '')}</textarea>`;
      }
    }
    renderDesc(true);

    const list = document.createElement('div');
    list.className = 'assignment-entries';

    let isEditing = false;

    function renderEntryRow(e, i) {
      const row = document.createElement('div');
      row.className = 'assignment-entry-row ranking-item';
      row.dataset.entry = '1';
      if (e.accept_status) row.dataset.acceptStatus = e.accept_status;

      const charInfo = document.createElement('div');
      const current = {
        character_name: e.character_name || '',
        class_name: e.class_name || '',
        spec_name: e.spec_name || '',
        spec_emote: e.spec_emote || '',
        spec_icon_url: e.spec_icon_url || '',
        target_character_name: e.target_character_name || e.assignment || '',
        is_placeholder: e.is_placeholder || false
      };
      function renderCharInfo(readOnly) {
        const rosterClsInit = getRosterClassByName(roster, current.character_name);
        const canonicalInit = canonicalizeClass(current.class_name, rosterClsInit);
        charInfo.className = `character-info class-${classToCssName(canonicalInit)}`;
        if (readOnly) {
          charInfo.innerHTML = `
            ${getSpecIconHtml(current.spec_name, current.class_name, current.spec_emote, current.spec_icon_url, current.is_placeholder)}
            <span class="character-name" style="display:inline-flex; align-items:center;">${current.character_name}</span>
          `;
        } else {
          charInfo.innerHTML = `
            ${getSpecIconHtml(current.spec_name, current.class_name, current.spec_emote, current.spec_icon_url, current.is_placeholder)}
            <select class="assignment-editable" data-field="character_name" style="max-width:260px;">
              <option value="">Select player...</option>
              ${roster.map(r => `<option value="${r.character_name}" data-class="${r.class_name || ''}" data-spec="${r.spec_name || ''}" data-emote="${r.spec_emote || ''}" data-specicon="${r.spec_icon_url || ''}" data-color="${r.class_color || ''}" data-placeholder="${r.is_placeholder || false}" ${r.character_name===current.character_name?'selected':''}>${r.character_name}</option>`).join('')}
            </select>
          `;
          const select = charInfo.querySelector('[data-field="character_name"]');
          select.addEventListener('change', async () => {
            const opt = select.selectedOptions[0];
            current.character_name = opt?.value || '';
            current.class_name = opt?.dataset.class || '';
            current.spec_name = opt?.dataset.spec || '';
            current.spec_emote = opt?.dataset.emote || '';
            current.spec_icon_url = opt?.dataset.specicon || '';
            current.is_placeholder = opt?.dataset.placeholder === 'true';
            const rosterCls = getRosterClassByName(roster, current.character_name);
            const canonical = canonicalizeClass(current.class_name, rosterCls);
            charInfo.className = `character-info class-${classToCssName(canonical)}`;
            charInfo.querySelector('.spec-icon')?.remove();
            const before = document.createElement('span');
            before.innerHTML = getSpecIconHtml(current.spec_name, current.class_name, current.spec_emote, current.spec_icon_url, current.is_placeholder);
            charInfo.insertBefore(before.firstChild, charInfo.firstChild);
            const nameEl = charInfo.querySelector('.character-name');
            if (nameEl) nameEl.textContent = opt.value || '';
            // Auto-assign icon for buffs/curses based on class
            if (vSelect === 'buffs' || vSelect === 'curses') {
              const cls = (current.class_name || '').toLowerCase();
              const iconMap = vSelect === 'buffs' ? {
                mage: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_magicalsentry.jpg',
                priest: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_wordfortitude.jpg',
                druid: 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_regeneration.jpg'
              } : {
                mage: 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_removecurse.jpg',
                priest: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_dispelmagic.jpg'
              };
              const iconUrl = iconMap[cls] || '';
              e.marker_icon_url = iconUrl;
              row.dataset.markerUrl = iconUrl;
              renderMarker(!isEditing);
            }
            // Reset acceptance on assigned player change
            row.dataset.acceptStatus = '';
            e.accept_status = '';
            try {
              const eventId = getActiveEventId();
              await fetch(`/api/assignments/${eventId}/entry/accept`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: current.character_name, accept_status: null })
              });
            } catch {}
            renderAcceptArea();
          });
        }
        // Sapphiron defaults are handled in Add Defaults branch within this handler
      }
      renderCharInfo(true);

      // Marker icon (or fixed icon for healing variant)
      const markerUrls = [
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/1_skull_faqei8.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/2_cross_kj9wuf.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/3_square_yqucv9.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/4_moon_vwhoen.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/5_triangle_rbpjyi.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/6_diamond_hre1uj.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/7_circle_zayctt.png',
        'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/8_star_kbuiaq.png'
      ];
      const markerWrapper = document.createElement('div');
      function renderMarker(readOnly) {
        markerWrapper.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'marker-box';
        function updateBox(url) {
          box.innerHTML = '';
          if (url) { const img = document.createElement('img'); img.src = url; img.alt = 'Marker'; box.appendChild(img); }
        }
        const vType = String(panel.variant || '').toLowerCase();
        let currentUrl = '';
        if (vType === 'healing') {
          currentUrl = panel.fixed_icon_url || '';
        } else if (vType === 'buffs' || vType === 'curses') {
          const cls = (current.class_name || '').toLowerCase();
          const iconMap = vType === 'buffs' ? {
            mage: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_magicalsentry.jpg',
            priest: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_wordfortitude.jpg',
            druid: 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_regeneration.jpg'
          } : {
            mage: 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_removecurse.jpg',
            priest: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_dispelmagic.jpg'
          };
          currentUrl = e.marker_icon_url || row.dataset.markerUrl || iconMap[cls] || '';
        } else {
          currentUrl = e.marker_icon_url || row.dataset.markerUrl || '';
        }
        updateBox(currentUrl);
        row.dataset.markerUrl = currentUrl;
        if (!readOnly && !(vType === 'healing' || vType === 'buffs' || vType === 'curses')) {
          box.style.cursor = 'pointer';
          box.title = 'Click to cycle marker';
          box.addEventListener('click', async () => {
            const cur = row.dataset.markerUrl || '';
            const idx = markerUrls.indexOf(cur);
            let nextUrl = '';
            if (idx === -1) nextUrl = markerUrls[0];
            else if (idx < markerUrls.length - 1) nextUrl = markerUrls[idx + 1];
            else nextUrl = '';
            e.marker_icon_url = nextUrl || null;
            row.dataset.markerUrl = nextUrl;
            updateBox(nextUrl);
            // Reset acceptance on marker change
            row.dataset.acceptStatus = '';
            e.accept_status = '';
            try {
              const eventId = getActiveEventId();
              await fetch(`/api/assignments/${eventId}/entry/accept`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: (current.character_name||'').trim(), accept_status: null })
              });
            } catch {}
            renderAcceptArea();
          });
        }
        markerWrapper.appendChild(box);
      }
      if (canManage) renderMarker(false); else renderMarker(true);

      const assignText = document.createElement('div');
      assignText.className = 'entry-assignment-text';
      const variantLower = String(panel.variant || '').toLowerCase();
      if (variantLower === 'healing') {
        const targetName = current.target_character_name || '';
        const tClass = getRosterClassByName(roster, targetName);
        const canonical = canonicalizeClass('', tClass);
        const color = getRosterClassColorByName(roster, targetName);
        assignText.innerHTML = `<span class="character-name class-${escapeHtml(classToCssName(canonical))}" style="display:inline-flex; align-items:center; color:${escapeHtml(color)} !important;">${escapeHtml(targetName)}</span>`;
        row.dataset.assignment = targetName;
      } else if (variantLower === 'buffs') {
        assignText.textContent = e.assignment || '';
        row.dataset.assignment = e.assignment || '';
      } else {
        assignText.textContent = e.assignment || '';
        row.dataset.assignment = e.assignment || '';
      }

      row.appendChild(charInfo);
      row.appendChild(markerWrapper);
      row.appendChild(assignText);

      const acceptCol = document.createElement('div');
      acceptCol.className = 'accept-col';
      row.appendChild(acceptCol);

      function getStatusIconHtml(status, interactive) {
        if (status === 'accept') return `<i class=\"fas fa-check-circle\" style=\"color:#10b981; font-size:40px; line-height:40px;\"></i>`;
        if (status === 'decline') return `<i class=\"fas fa-ban\" style=\"color:#ef4444; font-size:40px; line-height:40px;\"></i>`;
        const color = interactive ? '#fbbf24' : '#9ca3af';
        return `<i class=\"fas fa-check-circle\" style=\"color:${color}; font-size:40px; line-height:40px;\"></i>`;
      }

      function renderAcceptArea() {
        acceptCol.innerHTML = '';
        const charName = (current.character_name || '').trim();
        const ownerId = nameToDiscordId.get(charName.toLowerCase()) || null;
        const isOwner = !!(user && user.loggedIn && user.id && ownerId && String(user.id) === String(ownerId));
        const showControls = !!(user && user.loggedIn && (isOwner || (canManage && isEditing)));
        const curStatus = (row.dataset.acceptStatus !== undefined) ? row.dataset.acceptStatus : (e.accept_status || '');
        if (showControls) {
          const btn = document.createElement('button');
          btn.className = 'status-toggle-btn';
          btn.type = 'button';
          btn.innerHTML = getStatusIconHtml(curStatus, true);
          acceptCol.appendChild(btn);
          btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            const prev = (row.dataset.acceptStatus !== undefined) ? row.dataset.acceptStatus : (e.accept_status || '');
            let next = '';
            if (!prev) next = 'accept';
            else if (prev === 'accept') next = 'decline';
            else next = '';
            row.dataset.acceptStatus = next;
            e.accept_status = next;
            const eventId = getActiveEventId();
            try {
              await fetch(`/api/assignments/${eventId}/entry/accept`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dungeon, wing: wing || '', boss, character_name: charName, accept_status: next || null })
              });
            } catch {}
            btn.innerHTML = getStatusIconHtml(next, true);
          });
        } else {
          const status = document.createElement('div');
          status.className = 'status-icon';
          status.innerHTML = getStatusIconHtml(curStatus || '', false);
          acceptCol.appendChild(status);
        }
      }
      renderAcceptArea();

      if (canManage) {
        function setMode(readOnly) {
          const isHealing = String(panel.variant || '').toLowerCase() === 'healing';
          const ta = row.querySelector('[data-field="assignment"]');
          if (readOnly) {
            assignText.className = 'entry-assignment-text';
            if (isHealing) {
              const finalTarget = row.querySelector('[data-field="target_character_name"]')?.value || (row.dataset.assignment || '');
              row.dataset.assignment = finalTarget;
              const tClass = getRosterClassByName(roster, finalTarget);
              const canonical = canonicalizeClass('', tClass);
              const color = getRosterClassColorByName(roster, finalTarget);
              assignText.innerHTML = `<span class=\"character-name class-${escapeHtml(classToCssName(canonical))}\" style=\"display:inline-flex; align-items:center; color:${escapeHtml(color)} !important;\">${escapeHtml(finalTarget)}</span>`;
            } else {
              const finalText = (ta && typeof ta.value === 'string') ? ta.value : (row.dataset.assignment || '');
              assignText.textContent = finalText;
              row.dataset.assignment = finalText;
            }
            renderCharInfo(true);
            renderMarker(true);
            const existingDel = row.querySelector('.delete-x');
            if (existingDel) existingDel.remove();
            isEditing = false;
            renderAcceptArea();
          } else {
            assignText.className = '';
            if (isHealing) {
              assignText.innerHTML = `
                <select class=\"assignment-editable\" data-field=\"target_character_name\" style=\"max-width:260px;\">
                  <option value=\"\">Select target...</option>
                  ${roster.map(r => `<option value="${escapeHtml(r.character_name)}" ${r.character_name===(row.dataset.assignment||'')?'selected':''}>${escapeHtml(r.character_name)}</option>`).join('')}
                </select>
              `;
            } else {
              assignText.innerHTML = `<textarea class=\"assignment-editable assignment-assignment-textarea\" data-field=\"assignment\" placeholder=\"Assignment\">${escapeHtml(row.dataset.assignment || '')}</textarea>`;
            }
            renderCharInfo(false);
            renderMarker(false);
            const taLive = row.querySelector('[data-field="assignment"]');
            if (taLive) { taLive.addEventListener('input', () => { row.dataset.acceptStatus = ''; e.accept_status = ''; row.dataset.assignment = taLive.value || ''; renderAcceptArea(); }); }
            const targetSel = row.querySelector('[data-field="target_character_name"]');
            if (targetSel) { targetSel.addEventListener('change', () => { row.dataset.acceptStatus = ''; e.accept_status = ''; row.dataset.assignment = targetSel.value || ''; renderAcceptArea(); }); }
            let del = row.querySelector('.delete-x');
            if (!del) { del = document.createElement('button'); del.className = 'delete-x'; del.innerHTML = '&times;'; del.title = 'Delete assignment'; del.addEventListener('click', () => { row.remove(); renumberRows(); }); row.appendChild(del); }
            isEditing = true;
            renderAcceptArea();
          }
        }
        row._setReadOnly = () => setMode(true);
        row._setEdit = () => setMode(false);
      }

      list.appendChild(row);
    }

    function renumberRows() {
      Array.from(list.querySelectorAll('.ranking-position')).forEach((el, idx) => el.textContent = String(idx + 1));
    }

    entries.forEach((e, i) => renderEntryRow(e, i));

    content.appendChild(desc);
    content.appendChild(list);
    panelDiv.appendChild(header);
    panelDiv.appendChild(content);

    // Add copy macro button (visible to everyone)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-macro-btn';
    copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
    copyBtn.title = 'Copy macro';
    copyBtn.style.cssText = 'position: absolute; bottom: 10px; right: 10px; padding: 8px 12px; background: rgba(59, 130, 246, 0.2); border: 1px solid #3b82f6; border-radius: 6px; color: #3b82f6; cursor: pointer; font-size: 14px; transition: all 0.2s;';
    copyBtn.addEventListener('mouseenter', () => {
      copyBtn.style.background = 'rgba(59, 130, 246, 0.3)';
      copyBtn.style.transform = 'scale(1.05)';
    });
    copyBtn.addEventListener('mouseleave', () => {
      copyBtn.style.background = 'rgba(59, 130, 246, 0.2)';
      copyBtn.style.transform = 'scale(1)';
    });
    copyBtn.addEventListener('click', () => {
      const panelName = boss || 'Assignment';
      const variantLower = String(panel.variant || '').toLowerCase();
      
      // Determine action based on panel type
      let action = panelName;
      if (variantLower === 'healing') action = 'Heal';
      else if (variantLower === 'buffs') action = 'Buff';
      else if (variantLower === 'curses') action = 'Decurse';
      else if (variantLower === 'soul') action = 'Soulstone';
      else if (variantLower === 'pi') action = 'Power Infusion';
      else if (String(boss).toLowerCase() === 'tanking') action = 'Tank';
      
      // Build macro lines (try full format first)
      const rows = list.querySelectorAll('.assignment-entry-row[data-entry="1"]');
      const assignments = [];
      rows.forEach(row => {
        const charName = row.querySelector('.character-name')?.textContent?.trim();
        const assignment = row.dataset.assignment || '';
        if (charName && assignment) {
          assignments.push({ charName, assignment });
        }
      });
      
      // Try full format
      let lines = [`/rw ${panelName}`];
      assignments.forEach(a => {
        lines.push(`/ra ${a.charName} ${action} ${a.assignment}`);
      });
      let macroText = lines.join('\n');
      
      // If too long, use shortened format
      if (macroText.length > 255) {
        lines = [`/rw ${panelName}`];
        assignments.forEach(a => {
          // Abbreviate "Group X and Y" to "GX + GY"
          let shortAssignment = a.assignment
            .replace(/Group\s+(\d+)\s+and\s+(\d+)/gi, 'G$1 + G$2')
            .replace(/Group\s+(\d+)/gi, 'G$1');
          lines.push(`/ra ${a.charName} - ${shortAssignment}`);
        });
        macroText = lines.join('\n');
      }
      
      navigator.clipboard.writeText(macroText).then(() => {
        const originalHtml = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        copyBtn.style.color = '#10b981';
        copyBtn.style.borderColor = '#10b981';
        setTimeout(() => {
          copyBtn.innerHTML = originalHtml;
          copyBtn.style.color = '#3b82f6';
          copyBtn.style.borderColor = '#3b82f6';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy macro:', err);
        alert('Failed to copy macro. Please try again.');
      });
    });
    
    // Make panel position relative so absolute button works
    panelDiv.style.position = 'relative';
    panelDiv.style.paddingBottom = '50px';
    panelDiv.appendChild(copyBtn);

    if (canManage) {
      const editBtn = header.querySelector('.btn-edit');
      const saveBtn = header.querySelector('.btn-save');
      const addDefaultsBtn = header.querySelector('.btn-add-defaults');

      const controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.gap = '10px';
      controls.style.padding = '0 20px 20px 20px';

      const addBtn = document.createElement('button');
      addBtn.className = 'btn-add';
      addBtn.innerHTML = '<i class="fas fa-plus"></i> Add Entry';
      addBtn.addEventListener('click', () => {
        const newEntry = { character_name: '', class_name: 'Mage', spec_name: '', spec_emote: '', assignment: '', marker_icon_url: null };
        if (String(boss).toLowerCase() === 'buffs') newEntry.marker_icon_url = 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_magicalsentry.jpg';
        renderEntryRow(newEntry, list.children.length);
        // Restrict dropdown to Mage/Priest/Druid by removing other options
        if (String(boss).toLowerCase() === 'buffs') {
          const last = list.lastElementChild;
          const sel = last?.querySelector('[data-field="character_name"]');
          if (sel) {
            Array.from(sel.options).forEach(opt => {
              const cls = (opt.getAttribute('data-class') || '').toLowerCase();
              if (opt.value && !['mage','priest','druid'].includes(cls)) opt.remove();
            });
          }
        }
        renumberRows();
        const last = list.lastElementChild; if (last && typeof last._setEdit === 'function') last._setEdit();
      });
      controls.appendChild(addBtn);
      controls.style.display = 'none';
      content.appendChild(controls);

      // Defaults per panel (Tanking / Healing / Buffs / Curses)
      addDefaultsBtn?.addEventListener('click', async () => {
        try {
          // Confirm and clear existing assignments if present
          const hasExisting = !!(list && list.children && list.children.length > 0);
          if (hasExisting) {
            const sure = window.confirm('This panel already have assignments, are you sure you want to clear then and auto assign new characters?');
            if (!sure) return;
            try { list.innerHTML = ''; } catch {}
          }
          const eventId = getActiveEventId();
          const rosterData = await fetchRoster(eventId);
          const sortByGS = (a,b) => ((Number(a.party_id)||99) - (Number(b.party_id)||99)) || ((Number(a.slot_id)||99) - (Number(b.slot_id)||99));
          const toAdd = [];
          const bossLower = String(boss).toLowerCase();
          if (bossLower === 'tanking') {
            const warriors = filterAssignable(
              rosterData.filter(r => String(canonicalizeClass(String(r.class_name||''))).toLowerCase() === 'warrior')
            ).sort(sortByGS);
            const icons = [
              'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/1_skull_faqei8.png',
              'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/2_cross_kj9wuf.png',
              'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/3_square_yqucv9.png',
              'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/4_moon_vwhoen.png',
              'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/5_triangle_rbpjyi.png',
              'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/6_diamond_hre1uj.png',
              'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/7_circle_zayctt.png',
              'https://res.cloudinary.com/duthjs0c3/image/upload/v1754765896/8_star_kbuiaq.png'
            ];
            const labels = ['Main Tank','Off Tank 1','Off Tank 2','Off Tank 3','DPS Tank 1','DPS Tank 2','DPS Tank 3','DPS Tank 4'];
            for (let i=0; i<8 && i<warriors.length; i++) { const r=warriors[i]; toAdd.push({ r, icon: icons[i], text: labels[i] }); }
          } else if (bossLower === 'healing') {
            // Gather tank names from Tanking panel rendered above
            const containerEl = document.getElementById('assignments-container');
            const tankPanel = containerEl?.querySelector('.manual-rewards-section[data-panel-boss="tanking"]');
            const tankTargets = [];
            if (tankPanel) {
              const rows = Array.from(tankPanel.querySelectorAll('.assignment-entry-row'));
              for (const row of rows) {
                const sel = row.querySelector('[data-field="character_name"]');
                const nameEl = row.querySelector('.character-name');
                const val = (sel && sel.value) ? sel.value : (nameEl?.textContent?.trim() || '');
                if (val) tankTargets.push(val);
              }
            }
            const shamans = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='shaman')).sort(sortByGS);
            const priests = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='priest')).sort(sortByGS);
            const druids  = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='druid')).sort(sortByGS);
            const pushPair = (r, idx) => { if (r && tankTargets[idx]) toAdd.push({ r, icon: (panel.fixed_icon_url||''), text: tankTargets[idx] }); };
            for (let i=0;i<8;i++) pushPair(shamans[i], i);
            for (let i=0;i<4;i++) pushPair(priests[i], i);
            for (let i=0;i<2;i++) pushPair(druids[i],  i);
          } else if (bossLower === 'buffs') {
            const mages = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='mage')).sort(sortByGS);
            const priests = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='priest')).sort(sortByGS);
            const druids = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='druid')).sort(sortByGS);
            const groups = [1,2,3,4,5,6,7,8];
            const contiguousChunks = (count) => {
              if (count <= 0) return [];
              const base = Math.floor(groups.length / count);
              const rem = groups.length % count;
              const chunks = [];
              let idx = 0;
              for (let i=0;i<count;i++) {
                const take = base + (i < rem ? 1 : 0);
                chunks.push(groups.slice(idx, idx+take));
                idx += take;
              }
              return chunks;
            };
            const assign = (players, iconUrl) => {
              if (!players.length) return;
              const chunks = contiguousChunks(players.length);
              // give extra to higher group/slot players
              const sorted = players.slice().sort(sortByGS).reverse();
              for (let i=0;i<sorted.length;i++) {
                const r = sorted[i];
                const chunk = chunks[i] || [];
                if (!chunk.length) continue;
                let text = '';
                if (chunk.length === 8) text = 'All groups';
                else if (chunk.length === 1) text = `Group ${chunk[0]}`;
                else if (chunk.length === 2) text = `Group ${chunk[0]} and ${chunk[1]}`;
                else {
                  const head = chunk.slice(0, -1).join(', ');
                  text = `Group ${head} and ${chunk[chunk.length - 1]}`;
                }
                toAdd.push({ r, icon: iconUrl, text });
              }
            };
            assign(mages, 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_magicalsentry.jpg');
            assign(priests, 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_wordfortitude.jpg');
            assign(druids, 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_regeneration.jpg');
          } else if (bossLower === 'decurse and dispel') {
            const mages = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='mage')).sort(sortByGS);
            const priests = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='priest')).sort(sortByGS);
            const groups = [1,2,3,4,5,6,7,8];
            const contiguousChunks = (count) => {
              if (count <= 0) return [];
              const base = Math.floor(groups.length / count);
              const rem = groups.length % count;
              const chunks = [];
              let idx = 0;
              for (let i=0;i<count;i++) {
                const take = base + (i < rem ? 1 : 0);
                chunks.push(groups.slice(idx, idx+take));
                idx += take;
              }
              return chunks;
            };
            const assign = (players, iconUrl) => {
              if (!players.length) return;
              const chunks = contiguousChunks(players.length);
              const sorted = players.slice().sort(sortByGS).reverse();
              for (let i=0;i<sorted.length;i++) {
                const r = sorted[i];
                const chunk = chunks[i] || [];
                if (!chunk.length) continue;
                let text = '';
                if (chunk.length === 8) text = 'All groups';
                else if (chunk.length === 1) text = `Group ${chunk[0]}`;
                else if (chunk.length === 2) text = `Group ${chunk[0]} and ${chunk[1]}`;
                else { const head = chunk.slice(0, -1).join(', '); text = `Group ${head} and ${chunk[chunk.length - 1]}`; }
                toAdd.push({ r, icon: iconUrl, text });
              }
            };
            assign(mages, 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_removecurse.jpg');
            assign(priests, 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_dispelmagic.jpg');
          } else if (bossLower === 'curses and soul stones') {
            // Curses and Soul Stones
            const warlocks = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='warlock')).sort(sortByGS);
            const priests = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='priest')).sort(sortByGS);
            // Curses
            if (warlocks[0]) toAdd.push({ r: warlocks[0], icon: 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_unholystrength.jpg', text: 'Curse of Recklessness' });
            if (warlocks[1]) toAdd.push({ r: warlocks[1], icon: 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_chilltouch.jpg', text: 'Curse of the Elements' });
            if (warlocks[2]) toAdd.push({ r: warlocks[2], icon: 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_curseofachimonde.jpg', text: 'Curse of Shadow' });
            // Soulstones on lowest priests
            const soulIcon = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_orb_04.jpg';
            for (let i=0;i<3;i++) {
              if (warlocks[i] && priests[i]) {
                const pName = priests[i].character_name;
                toAdd.push({ r: warlocks[i], icon: soulIcon, text: `Soulstone on ${pName}` });
              }
            }
          } else if (bossLower === 'power infusion') {
            // Pair priests to mages in order (min length)
            const priests = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='priest')).sort(sortByGS);
            const mages = filterAssignable(rosterData.filter(r => String(r.class_name||'').toLowerCase()==='mage')).sort(sortByGS);
            const pairs = Math.min(priests.length, mages.length);
            const piIcon = 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_powerinfusion.jpg';
            for (let i=0;i<pairs;i++) {
              const pr = priests[i];
              const mg = mages[i];
              toAdd.push({ r: pr, icon: piIcon, text: mg.character_name, targetName: mg.character_name });
            }
          } else if (bossLower === 'demo shout') {
            // Demo Shout: assigned to Off Tank 1 (Cross/X marker from Tanking panel)
            const containerEl = document.getElementById('assignments-container');
            const tankPanel = containerEl?.querySelector('.manual-rewards-section[data-panel-boss="tanking"]');
            const demoIcon = 'https://wow.zamimg.com/images/wow/icons/large/ability_warrior_warcry.jpg';
            let offTank1 = null;
            if (tankPanel) {
              const rows = Array.from(tankPanel.querySelectorAll('.assignment-entry-row'));
              // Find the entry with Cross marker (Off Tank 1)
              for (const row of rows) {
                const markerUrl = row.dataset.markerUrl || '';
                if (markerUrl.toLowerCase().includes('cross')) {
                  const sel = row.querySelector('[data-field="character_name"]');
                  const nameEl = row.querySelector('.character-name');
                  const charName = (sel && sel.value) ? sel.value : (nameEl?.textContent?.trim() || '');
                  if (charName) {
                    offTank1 = rosterData.find(r => String(r.character_name||'').toLowerCase() === charName.toLowerCase());
                  }
                  break;
                }
              }
            }
            if (offTank1) {
              toAdd.push({ r: offTank1, icon: demoIcon, text: 'Keep Demoralizing Shout up on the boss at all times' });
            }
          }
          Array.from(list.children).forEach(r => { if (typeof r._setEdit === 'function') r._setEdit(); });
          controls.style.display = 'flex';
          // Replace flagged players with next suitable candidates while preserving counts
          const replaced = ensureToAddReplacements(toAdd, rosterData, { preserveClass: true });
          for (let i = 0; i < replaced.length; i++) {
            const { r, icon, text, targetName } = replaced[i];
            const entry = {
              character_name: r.character_name,
              class_name: r.class_name,
              spec_name: r.spec_name,
              spec_emote: r.spec_emote,
              marker_icon_url: icon,
              assignment: text,
              target_character_name: (String(panel.variant||'').toLowerCase()==='healing') ? (targetName || text) : ''
            };
            renderEntryRow(entry, list.children.length);
          }
          renumberRows();
          // Auto-save after auto-assign on main panels
          try {
            const payloadPanel = {
              dungeon,
              wing: wing || '',
              boss,
              strategy_text: (currentStrategy || strategy_text || ''),
              image_url: '',
              video_url: '',
              entries: []
            };
            for (const row of Array.from(list.children)) {
              if (!row.querySelector) continue;
              const getVal = sel => row.querySelector(sel)?.value || '';
              const isHealing = String(panel.variant || '').toLowerCase() === 'healing';
              const targetText = isHealing ? (row.querySelector('[data-field="target_character_name"]')?.value || row.dataset.assignment || row.querySelector('.entry-assignment-text')?.textContent || '') : (getVal('[data-field="assignment"]') || row.querySelector('.entry-assignment-text')?.textContent || '');
              const entry = {
                character_name: getVal('[data-field="character_name"]') || row.querySelector('.character-name')?.textContent || '',
                marker_icon_url: row.dataset.markerUrl || null,
                assignment: targetText,
                accept_status: row.dataset.acceptStatus || null
              };
              if (entry.character_name) payloadPanel.entries.push(entry);
            }
            const eventId = getActiveEventId();
            await fetch(`/api/assignments/${eventId}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panels: [payloadPanel] }) });
          } catch {}
        } catch {}
      });

      editBtn?.addEventListener('click', () => {
        Array.from(list.children).forEach(r => { if (typeof r._setEdit === 'function') r._setEdit(); });
        controls.style.display = 'flex';
        renderDesc(false);
        if (saveBtn) saveBtn.style.display = 'inline-block';
        if (editBtn) editBtn.style.display = 'none';
        if (addDefaultsBtn) addDefaultsBtn.style.display = 'inline-block';
      });

      saveBtn?.addEventListener('click', async () => {
        const payloadPanel = {
          dungeon,
          wing: wing || '',
          boss,
          strategy_text: (content.querySelector('[data-field="strategy_text"]')?.value) || strategy_text || '',
          image_url: '',
          video_url: '',
          entries: []
        };
        for (const row of Array.from(list.children)) {
          if (!row.querySelector) continue;
          const getVal = sel => row.querySelector(sel)?.value || '';
          const isHealing = String(panel.variant || '').toLowerCase() === 'healing';
          const targetText = isHealing ? (
            row.querySelector('[data-field="target_character_name"]')?.value ||
            row.dataset.assignment ||
            row.querySelector('.entry-assignment-text')?.textContent ||
            ''
          ) : (
            getVal('[data-field="assignment"]') || row.querySelector('.entry-assignment-text')?.textContent || ''
          );
          const entry = {
            character_name: getVal('[data-field="character_name"]') || row.querySelector('.character-name')?.textContent || '',
            marker_icon_url: row.dataset.markerUrl || null,
            assignment: targetText,
            accept_status: row.dataset.acceptStatus || null
          };
          if (entry.character_name) payloadPanel.entries.push(entry);
        }
        const eventId = getActiveEventId();
        await fetch(`/api/assignments/${eventId}/save`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ panels: [payloadPanel] })
        });
        Array.from(list.children).forEach(r => { if (typeof r._setReadOnly === 'function') r._setReadOnly(); });
        controls.style.display = 'none';
        currentStrategy = payloadPanel.strategy_text;
        renderDesc(true);
            if (saveBtn) saveBtn.style.display = 'none';
            if (editBtn) editBtn.style.display = 'inline-block';
            if (addDefaultsBtn) addDefaultsBtn.style.display = 'inline-block';
        });
    }

    return panelDiv;
  }

  async function loadAssignments() {
    const container = document.getElementById('assignments-container');
    if (!container) return;

    const eventId = getActiveEventId();
    if (!eventId) {
      container.innerHTML = '<div class="no-data-message"><div class="no-data-content"><i class="fas fa-info-circle"></i><h3>No Event Selected</h3><p>Select an event from the top bar to view assignments.</p></div></div>';
      return;
    }

    try {
      const user = await fetchUser();
      const canManage = !!(user && user.loggedIn && user.hasManagementRole);
      const roster = await fetchRoster(eventId);
      const res = await fetch(`/api/assignments/${eventId}`);
      const data = await res.json();
      if (!data.success) throw new Error('Failed');

      container.innerHTML = '';
      const panels = Array.isArray(data.panels) && data.panels.length > 0 ? data.panels : [];
      if (panels.length === 0) {
        container.innerHTML = '<div class="no-data-message"><div class="no-data-content"><i class="fas fa-info-circle"></i><h3>No Assignments</h3><p>No assignments found for this event.</p></div></div>';
        return;
      }

      const wing = getCurrentWing();
      // Update Skeram text in-memory if it's the old default or missing
      try {
        const OLD_SKERAM = "Odd groups left. Even groups right. Interupt Arcane Explotions. Don't kill your friends. If the real one spawns on your side, run to the middle and kill the clone first.";
        const NEW_SKERAM = "Odd groups left. Even groups right. Interupt Arcane Explotions.\n\nIf the real one spawns on your side, run to the middle and kill the clone first.\n\nHelp CC mind controlled players (Sheep, Coil, Blind, Stomp etc.)";
        panels.forEach(p => {
          const bk = String(p.boss||'').toLowerCase();
          if (bk.includes('skeram')) {
            const cur = String(p.strategy_text||'').trim();
            if (!cur || cur === OLD_SKERAM) {
              p.strategy_text = NEW_SKERAM;
            }
          }
        });
      } catch {}

      // Normalize Twins trash wording (Slays -> Slayers)
      try {
        panels.forEach(p => {
          const bk = String(p.boss||'').toLowerCase();
          if (bk.includes('twins') && bk.includes('trash')) {
            const cur = String(p.strategy_text||'');
            if (cur.includes(' 4 Slays')) {
              p.strategy_text = cur.replace(' 4 Slays', ' 4 Slayers');
            }
          }
        });
      } catch {}
      // Non-NAX placeholder pages (AQ40 now supported)
      if (['bwl','mc'].includes(wing)) {
        container.innerHTML = '<div class="no-data-message"><div class="no-data-content"><i class="fas fa-tools"></i><h3>Coming Soon</h3><p>This assignments page is coming soon.</p></div></div>';
        return;
      }
      // My Assignments personal subpage
      if (wing === 'myassignments') {
        container.innerHTML = '';
        // Build a panel wrapper to match style
        const myPanel = document.createElement('div');
        myPanel.className = 'manual-rewards-section main-panel';
        const header = document.createElement('div');
        header.className = 'section-header assignment-header';
        const content = document.createElement('div');
        content.className = 'manual-rewards-content';

        // Collect all of the user's character names for this event
        const myId = user?.id ? String(user.id) : '';
        const myRosterRows = (Array.isArray(roster)?roster:[]).filter(r => String(r.discord_user_id||'') === myId);
        const myNames = new Set(myRosterRows.map(r => String(r.character_name||'')));
        // Header: primary character with class icon and class color name
        (function renderMyHeader(){
          try {
            const primary = myRosterRows.slice().sort(sortByGroupSlotAsc)[0];
            if (primary) {
              const cls = canonicalizeClass(primary.class_name||'');
              const color = getRosterClassColorByName(roster, primary.character_name);
              const CLASS_ICON_URLS = {
                warrior: 'https://wow.zamimg.com/images/wow/icons/large/classicon_warrior.jpg',
                paladin: 'https://wow.zamimg.com/images/wow/icons/large/classicon_paladin.jpg',
                hunter: 'https://wow.zamimg.com/images/wow/icons/large/classicon_hunter.jpg',
                rogue: 'https://wow.zamimg.com/images/wow/icons/large/classicon_rogue.jpg',
                priest: 'https://wow.zamimg.com/images/wow/icons/large/classicon_priest.jpg',
                shaman: 'https://wow.zamimg.com/images/wow/icons/large/classicon_shaman.jpg',
                mage: 'https://wow.zamimg.com/images/wow/icons/large/classicon_mage.jpg',
                warlock: 'https://wow.zamimg.com/images/wow/icons/large/classicon_warlock.jpg',
                druid: 'https://wow.zamimg.com/images/wow/icons/large/classicon_druid.jpg'
              };
              const iconUrl = CLASS_ICON_URLS[cls] || '';
              header.innerHTML = `
                <h2 style="display:flex;align-items:center;gap:15px;padding-left:0;margin-left:20px;">
                  ${iconUrl ? `<img src="${iconUrl}" alt="Class" style="width:40px;height:40px;border-radius:50%;border:2px solid #fff;object-fit:cover;">` : ''}
                  <span class="character-name" style="color:${color} !important;">${primary.character_name}</span>
                </h2>
              `;
            } else {
              header.innerHTML = '<h2>My Assignments</h2>';
            }
          } catch { header.innerHTML = '<h2>My Assignments</h2>'; }
        })();

        // Decide event type: NAX vs Non-NAX (AQ40/BWL/MC)
        const isNonNaxEvent = (() => {
          try { return (Array.isArray(panels)?panels:[]).some(p => ['aq40','bwl','mc'].includes(String(p.wing||'').toLowerCase())); } catch { return false; }
        })();

        // Build flat list of visible entries assigned to me
        const myEntries = [];
        for (const p of panels) {
          const wingLowerRaw = String(p.wing||'').toLowerCase().trim();
          const wingLower = wingLowerRaw || 'main';
          // For Non-NAX events, only include Main + AQ40/BWL/MC panels (treat empty wing as main)
          const allowedNonNax = ['main','aq40','bwl','mc'];
          if (isNonNaxEvent && !allowedNonNax.includes(wingLower)) continue;
          const visible = (Array.isArray(p.entries)?p.entries:[]).filter(en => {
            const a = String(en.assignment||'');
            if (a.startsWith('__HGRID__:') || a.startsWith('__SPORE__:') || a.startsWith('__KEL__:') || a.startsWith('__CTHUN__:')) return false;
            const name = String(en.character_name||'');
            return myNames.has(name);
          });
          for (const en of visible) {
            myEntries.push({
              wing: String(p.wing||'').trim() || 'Main',
              boss: String(p.boss||''),
              dungeon: String(p.dungeon||''),
              character_name: String(en.character_name||''),
              marker_icon_url: en.marker_icon_url || '',
              assignment: String(en.assignment||''),
              accept_status: en.accept_status || '',
            });
          }
        }

        // Sort: wing order then boss order per wing
        const WING_ORDER = isNonNaxEvent
          ? ['Main','AQ40','BWL','MC']
          : ['Main','Military','Spider','Abomination','Plague','Frostwyrm_Lair'];
        const WING_ORDER_CANON = isNonNaxEvent
          ? ['main','aq40','bwl','mc']
          : ['main','military','spider','abomination','plague','frostwyrm_lair'];
        const WING_SYNONYMS = {
          'military wing': 'military',
          'spider wing': 'spider',
          'abomination wing': 'abomination',
          'plague wing': 'plague',
          'frostwyrm lair': 'frostwyrm_lair'
        };
        const BOSS_ORDER = isNonNaxEvent ? {
          main: ['tanking','healing','buffs','decurse and dispel','curses and soul stones','power infusion','demo shout'],
          aq40: ['skeram','bug','sartura','fank','visc','huhu','twin','twins trash','ouro',"c'thun",'cthun'],
          bwl: [],
          mc: []
        } : {
          main: ['tanking','healing','buffs','decurse and dispel','curses and soul stones','power infusion','demo shout'],
          military: ['razu','goth','horse'],
          spider: ['anub','faerlina','maex'],
          abomination: ['patch','grobb','gluth','thadd'],
          plague: ['noth','heig','loatheb'],
          frostwyrm_lair: ['sapph','kel']
        };
        function wingIndex(w) {
          const raw = String(w||'').trim().toLowerCase();
          const norm = raw || 'main';
          const mapped = WING_SYNONYMS[norm] || norm.replace(/\s+/g, '_');
          const canon = mapped;
          const idxLower = WING_ORDER_CANON.indexOf(canon);
          return idxLower === -1 ? 999 : idxLower;
        }
        function bossIndex(wing, boss) {
          const raw = String(wing||'').trim().toLowerCase();
          const mapped = WING_SYNONYMS[raw] || raw.replace(/\s+/g, '_');
          const arr = BOSS_ORDER[mapped] || [];
          const bk = String(boss||'').toLowerCase();
          const i = arr.findIndex(k => bk.includes(k));
          return i === -1 ? 999 : i;
        }
        myEntries.sort((a,b) => {
          const wi = wingIndex(a.wing) - wingIndex(b.wing);
          if (wi !== 0) return wi;
          const bi = bossIndex(a.wing, a.boss) - bossIndex(b.wing, b.boss);
          if (bi !== 0) return bi;
          return String(a.character_name||'').localeCompare(String(b.character_name||''));
        });

        // ═══════════════════════════════════════════════════════════════════════
        // COLLECT ALL ASSIGNMENTS (Main table + Special Grids)
        // ═══════════════════════════════════════════════════════════════════════
        // Collect grid assignments for Horsemen, Spore, Kel, Cthun
        const myGridEntries = [];
        
        // Helper to check if player has a main (non-grid) assignment for a boss
        // and get the main entry's accept_status (grid entries share status with main)
        function getMainAssignForBoss(bossName, charName) {
          const bossLower = String(bossName||'').toLowerCase();
          return myEntries.find(e => 
            String(e.boss||'').toLowerCase().includes(bossLower) && 
            String(e.character_name||'').toLowerCase() === String(charName||'').toLowerCase()
          );
        }

        // Horsemen grid entries
        try {
          const horsePanel = panels.find(p => String(p.boss||'').toLowerCase().includes('horse'));
          if (horsePanel) {
            const entries = Array.isArray(horsePanel.entries) ? horsePanel.entries : [];
            for (const en of entries) {
              const a = String(en.assignment||'');
              if (!a.startsWith('__HGRID__:')) continue;
              const name = String(en.character_name||'');
              if (!myNames.has(name)) continue;
              // Check if player has main assignment - if so, grid shares that status
              const mainAssign = getMainAssignForBoss('horse', name);
              myGridEntries.push({
                type: 'horsemen',
                boss: String(horsePanel.boss||''),
                dungeon: String(horsePanel.dungeon||''),
                wing: String(horsePanel.wing||''),
                character_name: name,
                assignment: a,
                accept_status: en.accept_status || '',
                _entry: en, // Keep reference for live updates
                _linkedMain: mainAssign || null // If set, status is controlled by main assignment
              });
            }
          }
        } catch {}

        // Spore grid entries (Loatheb)
        try {
          const loathebPanel = panels.find(p => String(p.boss||'').toLowerCase().includes('loatheb'));
          if (loathebPanel) {
            const entries = Array.isArray(loathebPanel.entries) ? loathebPanel.entries : [];
            for (const en of entries) {
              const a = String(en.assignment||'');
              if (!a.startsWith('__SPORE__:')) continue;
              const name = String(en.character_name||'');
              if (!myNames.has(name)) continue;
              const mainAssign = getMainAssignForBoss('loatheb', name);
              myGridEntries.push({
                type: 'spore',
                boss: String(loathebPanel.boss||''),
                dungeon: String(loathebPanel.dungeon||''),
                wing: String(loathebPanel.wing||''),
                character_name: name,
                assignment: a,
                accept_status: en.accept_status || '',
                _entry: en,
                _linkedMain: mainAssign || null
              });
            }
          }
        } catch {}

        // Kel'Thuzad grid entries
        try {
          const kelPanel = panels.find(p => String(p.boss||'').toLowerCase().includes('kel'));
          if (kelPanel) {
            const entries = Array.isArray(kelPanel.entries) ? kelPanel.entries : [];
            for (const en of entries) {
              const a = String(en.assignment||'');
              if (!a.startsWith('__KEL__:')) continue;
              const name = String(en.character_name||'');
              if (!myNames.has(name)) continue;
              const mainAssign = getMainAssignForBoss('kel', name);
              myGridEntries.push({
                type: 'kel',
                boss: String(kelPanel.boss||''),
                dungeon: String(kelPanel.dungeon||''),
                wing: String(kelPanel.wing||''),
                character_name: name,
                assignment: a,
                accept_status: en.accept_status || '',
                _entry: en,
                _linkedMain: mainAssign || null
              });
            }
          }
        } catch {}

        // C'Thun grid entries (Non-NAX)
        try {
          const cthPanel = panels.find(p => String(p.boss||'').toLowerCase().includes("c'thun") || String(p.boss||'').toLowerCase().includes('cthun'));
          if (cthPanel) {
            const entries = Array.isArray(cthPanel.entries) ? cthPanel.entries : [];
            for (const en of entries) {
              const a = String(en.assignment||'');
              if (!a.startsWith('__CTHUN__:')) continue;
              const name = String(en.character_name||'');
              if (!myNames.has(name)) continue;
              const mainAssign = getMainAssignForBoss('thun', name);
              myGridEntries.push({
                type: 'cthun',
                boss: String(cthPanel.boss||''),
                dungeon: String(cthPanel.dungeon||''),
                wing: String(cthPanel.wing||''),
                character_name: name,
                assignment: a,
                accept_status: en.accept_status || '',
                _entry: en,
                _linkedMain: mainAssign || null
              });
            }
          }
        } catch {}

        // Combined all assignments for tracking
        const allMyAssignments = [...myEntries, ...myGridEntries];

        // ═══════════════════════════════════════════════════════════════════════
        // GAMIFIED PROGRESS TRACKER (placed at top of container, outside panels)
        // ═══════════════════════════════════════════════════════════════════════
        const progressTracker = document.createElement('div');
        progressTracker.className = 'assignment-progress-tracker';
        progressTracker.innerHTML = `
          <style>
            .assignment-progress-tracker {
              position: sticky;
              top: 100px;
              z-index: 500;
              width: 600px;
              max-width: calc(100% - 40px);
              margin: 0 auto 24px auto;
              background: linear-gradient(145deg, #1a1f2e 0%, #0f1318 100%);
              border-radius: 16px;
              padding: 20px 24px;
              box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.1);
              backdrop-filter: blur(10px);
              overflow: hidden;
            }
            /* When top bar is hidden (scrolling down), move tracker up */
            body:has(.top-bar.hidden) .assignment-progress-tracker {
              top: 54px;
            }
            /* Fallback for browsers without :has() - use default positioning */
            @supports not selector(:has(*)) {
              .assignment-progress-tracker {
                top: 100px;
              }
            }
            .progress-tracker-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 16px;
            }
            .progress-tracker-title {
              font-size: 14px;
              font-weight: 600;
              color: #9ca3af;
              text-transform: uppercase;
              letter-spacing: 1px;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .progress-tracker-count {
              font-size: 20px;
              font-weight: 700;
              color: #e5e7eb;
              display: flex;
              align-items: baseline;
              gap: 4px;
            }
            .progress-tracker-count .current {
              color: #10b981;
              font-size: 28px;
              font-weight: 800;
              transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
              display: inline-block;
            }
            .progress-tracker-count .current.bump {
              transform: scale(1.3);
            }
            .progress-tracker-count .total {
              color: #6b7280;
            }
            .progress-bar-container {
              position: relative;
              height: 28px;
              max-height: 28px;
              background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
              border-radius: 14px;
              overflow: hidden;
              box-shadow: inset 0 2px 8px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.05);
              transition: max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease;
            }
            .progress-bar-fill {
              position: absolute;
              top: 2px;
              left: 2px;
              height: calc(100% - 4px);
              border-radius: 12px;
              background: linear-gradient(90deg, #059669 0%, #10b981 50%, #34d399 100%);
              box-shadow: 0 0 20px rgba(16, 185, 129, 0.4), inset 0 1px 0 rgba(255,255,255,0.3);
              transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
              overflow: hidden;
            }
            .progress-bar-fill::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: linear-gradient(90deg, 
                transparent 0%, 
                rgba(255,255,255,0.2) 50%, 
                transparent 100%);
              animation: liquid-shine 2s ease-in-out infinite;
            }
            .progress-bar-fill::after {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              height: 50%;
              background: linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%);
              border-radius: 12px 12px 0 0;
            }
            @keyframes liquid-shine {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(200%); }
            }
            .progress-bar-fill.declined {
              background: linear-gradient(90deg, #dc2626 0%, #ef4444 50%, #f87171 100%);
              box-shadow: 0 0 20px rgba(239, 68, 68, 0.4), inset 0 1px 0 rgba(255,255,255,0.3);
            }
            .progress-tracker-status {
              margin-top: 12px;
              text-align: center;
              font-size: 13px;
              color: #6b7280;
              min-height: 24px;
              max-height: 50px;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              transition: max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease;
            }
            .progress-tracker-status.complete {
              color: #10b981;
              font-weight: 600;
            }
            .success-icon {
              font-size: 24px;
              display: inline-block;
              animation: success-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            @keyframes success-bounce {
              0% { transform: scale(0); opacity: 0; }
              50% { transform: scale(1.4); }
              100% { transform: scale(1); opacity: 1; }
            }
            .confetti-container {
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              pointer-events: none;
              overflow: hidden;
              border-radius: 16px;
            }
            .confetti {
              position: absolute;
              width: 8px;
              height: 8px;
              border-radius: 2px;
              animation: confetti-fall 1s ease-out forwards;
            }
            @keyframes confetti-fall {
              0% { transform: translateY(0) rotate(0deg); opacity: 1; }
              100% { transform: translateY(100px) rotate(720deg); opacity: 0; }
            }
          </style>
          <div class="confetti-container"></div>
          <div class="progress-tracker-header">
            <span class="progress-tracker-title">Assignment Progress</span>
            <div class="progress-tracker-count">
              <span class="current">0</span>
              <span class="separator">/</span>
              <span class="total">0</span>
            </div>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: 0%;"></div>
          </div>
          <div class="progress-tracker-status">Accept all assignments to earn <strong style="color:#fbbf24;">+10 bonus points</strong></div>
        `;
        
        // Insert at top of container (before any panels)
        container.appendChild(progressTracker);

        // Progress tracker state and update function
        const trackerState = {
          total: allMyAssignments.length,
          accepted: 0,
          hasDeclined: false
        };

        function updateProgressTracker() {
          const fill = progressTracker.querySelector('.progress-bar-fill');
          const currentEl = progressTracker.querySelector('.current');
          const totalEl = progressTracker.querySelector('.total');
          const statusEl = progressTracker.querySelector('.progress-tracker-status');
          const confettiContainer = progressTracker.querySelector('.confetti-container');

          // Count accepted and check for declined from ALL assignments
          let accepted = 0;
          let hasDeclined = false;
          
          // Count from main entries
          for (const entry of myEntries) {
            if (entry.accept_status === 'accept') accepted++;
            if (entry.accept_status === 'decline') hasDeclined = true;
          }
          
          // Count from grid entries
          for (const gridEntry of myGridEntries) {
            let status = '';
            // If linked to a main assignment, use that status (they share acceptance in DB)
            if (gridEntry._linkedMain) {
              status = gridEntry._linkedMain.accept_status || '';
            } else {
              // Sync status from the original entry reference
              if (gridEntry._entry) {
                gridEntry.accept_status = gridEntry._entry.accept_status || '';
              }
              status = gridEntry.accept_status || '';
            }
            if (status === 'accept') accepted++;
            if (status === 'decline') hasDeclined = true;
          }

          const total = allMyAssignments.length;
          const prevAccepted = trackerState.accepted;
          trackerState.accepted = accepted;
          trackerState.hasDeclined = hasDeclined;

          // Update count with bump animation
          totalEl.textContent = total;
          if (accepted !== prevAccepted) {
            currentEl.textContent = accepted;
            currentEl.classList.add('bump');
            setTimeout(() => currentEl.classList.remove('bump'), 300);
          }

          // Update progress bar
          const percent = total > 0 ? (accepted / total) * 100 : 0;
          
          if (hasDeclined) {
            fill.style.width = '0%';
            fill.classList.add('declined');
            statusEl.className = 'progress-tracker-status';
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#ef4444;"></i> You have declined assignments - change to accept for bonus points';
          } else {
            fill.classList.remove('declined');
            fill.style.width = percent + '%';

            if (accepted === total && total > 0) {
              // Success state
              statusEl.className = 'progress-tracker-status complete';
              statusEl.innerHTML = '<span class="success-icon">🎉</span> All assignments accepted! <strong style="color:#10b981;">+10 bonus points earned!</strong> <span class="success-icon">👍</span>';
              
              // Confetti burst
              confettiContainer.innerHTML = '';
              const colors = ['#10b981', '#34d399', '#fbbf24', '#f59e0b', '#3b82f6', '#8b5cf6'];
              for (let i = 0; i < 20; i++) {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * 100 + '%';
                confetti.style.top = Math.random() * 50 + '%';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animationDelay = Math.random() * 0.3 + 's';
                confettiContainer.appendChild(confetti);
              }
              setTimeout(() => confettiContainer.innerHTML = '', 1500);
              
              // ═══════════════════════════════════════════════════════════════════════
              // VERIFICATION: Log completion and verify server state matches client
              // ═══════════════════════════════════════════════════════════════════════
              (async () => {
                try {
                  const eventId = getActiveEventId();
                  if (!eventId) return;
                  
                  // Build client-side assignments data for verification
                  const clientAssignments = allMyAssignments.map(a => ({
                    dungeon: a.dungeon || '',
                    wing: a.wing || '',
                    boss: a.boss || '',
                    character_name: a.character_name || '',
                    accept_status: a._linkedMain ? (a._linkedMain.accept_status || '') : (a.accept_status || '')
                  }));
                  
                  const verifyRes = await fetch(`/api/assignments/${eventId}/verify-completion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      discordUserId: myId || '',
                      discordUsername: user?.username || user?.global_name || '',
                      characterNames: Array.from(myNames),
                      clientTotal: total,
                      clientAccepted: accepted,
                      clientAssignments
                    })
                  });
                  
                  const verifyData = await verifyRes.json();
                  
                  if (verifyData.success && !verifyData.verified) {
                    // MISMATCH DETECTED - show warning to user
                    console.warn('[ASSIGNMENT VERIFICATION MISMATCH]', verifyData);
                    
                    // Add a warning indicator below the success message
                    const warningEl = document.createElement('div');
                    warningEl.className = 'verification-warning';
                    warningEl.style.cssText = 'margin-top:10px;padding:8px 12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:8px;font-size:12px;color:#fca5a5;';
                    warningEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>` +
                      `Verification notice: Server shows ${verifyData.serverAccepted}/${verifyData.serverTotal} accepted. ` +
                      `If you see this message, please refresh the page. If boxes are unchecked after refresh, screenshot and report to officers.`;
                    
                    // Only show warning once per session
                    if (!progressTracker.querySelector('.verification-warning')) {
                      statusEl.parentNode.insertBefore(warningEl, statusEl.nextSibling);
                    }
                  }
                } catch (err) {
                  console.error('[ASSIGNMENT VERIFICATION ERROR]', err);
                  // Don't interrupt user experience on verification errors
                }
              })();
            } else {
              statusEl.className = 'progress-tracker-status';
              const remaining = total - accepted;
              statusEl.innerHTML = remaining > 0 
                ? `Accept <strong style="color:#fbbf24;">${remaining}</strong> more assignment${remaining !== 1 ? 's' : ''} to earn <strong style="color:#fbbf24;">+10 bonus points</strong>`
                : 'Accept all assignments to earn <strong style="color:#fbbf24;">+10 bonus points</strong>';
            }
          }
        }

        // Initial update
        updateProgressTracker();

        // Make updateProgressTracker accessible for status toggles
        window._myAssignmentsProgressUpdate = updateProgressTracker;

        // ═══════════════════════════════════════════════════════════════════════
        // END PROGRESS TRACKER
        // ═══════════════════════════════════════════════════════════════════════

        // Table
        const tableWrap = document.createElement('div');
        tableWrap.style.padding = '0 20px 20px 20px';
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.color = '#e5e7eb';
        table.innerHTML = '<thead><tr>'+
          '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-color,#3a3a3a);min-width:200px;width:200px;max-width:200px;">Wing</th>'+
          '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-color,#3a3a3a);white-space:nowrap;">What/Where</th>'+
          '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-color,#3a3a3a); display:none;">Character</th>'+
          '<th style="text-align:center;padding:8px;border-bottom:1px solid var(--border-color,#3a3a3a);">Raid Icon</th>'+
          '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-color,#3a3a3a);">Assignment</th>'+
          '<th style="text-align:center;padding:8px;border-bottom:1px solid var(--border-color,#3a3a3a);">Status</th>'+
        '</tr></thead>';
        const tbody = document.createElement('tbody');

        function getStatusIconHtml(status, interactive) {
          if (status === 'accept') return '<i class="fas fa-check-circle" style="color:#10b981; font-size:24px; line-height:24px;"></i>';
          if (status === 'decline') return '<i class="fas fa-ban" style="color:#ef4444; font-size:24px; line-height:24px;"></i>';
          const color = interactive ? '#fbbf24' : '#9ca3af';
          return `<i class="fas fa-check-circle" style="color:${color}; font-size:24px; line-height:24px;"></i>`;
        }

        const parts = window.location.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('event');
        const eventId = (idx >= 0 && parts[idx+1]) ? parts[idx+1] : localStorage.getItem('activeEventSession');

        // Wing display helpers (icon + label matching floating-nav)
        const WING_META = isNonNaxEvent ? {
          main: { icon: 'fas fa-home', label: 'Main' },
          aq40: { icon: 'fas fa-mountain', label: 'AQ40' },
          bwl: { icon: 'fas fa-fire', label: 'BWL' },
          mc: { icon: 'fas fa-fire-alt', label: 'MC' }
        } : {
          main: { icon: 'fas fa-home', label: 'Main' },
          military: { icon: 'fas fa-chess-knight', label: 'Military Wing' },
          spider: { icon: 'fas fa-spider', label: 'Spider Wing' },
          abomination: { icon: 'fas fa-skull-crossbones', label: 'Abomination Wing' },
          plague: { icon: 'fas fa-biohazard', label: 'Plague Wing' },
          frostwyrm_lair: { icon: 'fas fa-dragon', label: 'Frostwyrm Lair' }
        };
        function getWingDisplay(rawWing) {
          const s = String(rawWing || '').trim();
          const key = (s ? s.toLowerCase().replace(/\s+/g, '_') : 'main');
          const meta = WING_META[key];
          return {
            label: meta ? meta.label : (s ? s.replace(/_/g, ' ') : 'Main'),
            icon: meta ? meta.icon : 'fas fa-home'
          };
        }

        for (const row of myEntries) {
          const tr = document.createElement('tr');
          tr.style.borderBottom = '1px solid var(--border-color,#3a3a3a)';
          const tdWing = document.createElement('td'); tdWing.style.padding='10px 8px'; tdWing.style.minWidth='200px'; tdWing.style.width='200px'; tdWing.style.maxWidth='200px';
          const wingDisp = getWingDisplay(row.wing);
          tdWing.innerHTML = `<i class="${wingDisp.icon}" style="margin-right:6px;"></i><span>${wingDisp.label}</span>`;
          const tdBoss = document.createElement('td'); tdBoss.style.padding='10px 8px'; tdBoss.style.whiteSpace='nowrap'; tdBoss.textContent = row.boss;
          const tdChar = document.createElement('td'); tdChar.style.padding='10px 8px'; tdChar.style.display = 'none';
          try {
            const color = getRosterClassColorByName(roster, row.character_name);
            tdChar.innerHTML = `<span class="character-name" style="color:${escapeHtml(color)} !important; font-weight: normal;">${escapeHtml(row.character_name)}</span>`;
          } catch {
            tdChar.textContent = row.character_name;
          }
          const tdIcon = document.createElement('td'); tdIcon.style.padding='10px 8px'; tdIcon.style.textAlign = 'center';
          if (row.marker_icon_url) {
            const img = document.createElement('img'); img.src = row.marker_icon_url; img.alt = 'icon'; img.width = 24; img.height = 24; img.loading='lazy';
            tdIcon.appendChild(img);
          } else {
            tdIcon.textContent = '';
          }
          const tdAssign = document.createElement('td'); tdAssign.style.padding='10px 8px'; tdAssign.style.wordBreak='break-word'; tdAssign.textContent = row.assignment || '';
          const tdStatus = document.createElement('td'); tdStatus.style.padding='10px 8px'; tdStatus.style.textAlign = 'center';
          const btn = document.createElement('button'); btn.className = 'status-toggle-btn'; btn.type='button'; btn.innerHTML = getStatusIconHtml(row.accept_status||'', true);
          btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            const prev = row.accept_status || '';
            let next = '';
            if (!prev) next = 'accept';
            else if (prev === 'accept') next = 'decline';
            else next = '';
            row.accept_status = next;
            try {
              await fetch(`/api/assignments/${eventId}/entry/accept`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dungeon: row.dungeon, wing: row.wing === 'Main' ? '' : row.wing, boss: row.boss, character_name: row.character_name, accept_status: next || null })
              });
            } catch {}
            btn.innerHTML = getStatusIconHtml(next, true);
            // Update progress tracker
            if (typeof updateProgressTracker === 'function') updateProgressTracker();
          });
          tdStatus.appendChild(btn);

          tr.appendChild(tdWing); tr.appendChild(tdBoss); tr.appendChild(tdChar); tr.appendChild(tdIcon); tr.appendChild(tdAssign); tr.appendChild(tdStatus);
          tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        tableWrap.appendChild(table);
        content.appendChild(tableWrap);

        myPanel.appendChild(header);
        myPanel.appendChild(content);
        container.appendChild(myPanel);

        // Below: conditional special panels (Four Horsemen grid, Spore Groups, Kel'Thuzad Groups)
        // Use copies of user with no management role so edit controls stay hidden
        const viewUser = { ...(user||{}), hasManagementRole: false };

        // Helpers: does any of my names appear in these grid states?
        function hasNameInHorse(panel) {
          try {
            const tanks = panel?.horsemen_tanks || {};
            for (const k of Object.keys(tanks)) {
              const name = (Array.isArray(tanks[k]) ? tanks[k][0] : null) || null;
              if (name && myNames.has(String(name))) return true;
            }
          } catch {}
          // Fallback: look at hidden entries
          try {
            return (Array.isArray(panel.entries)?panel.entries:[]).some(en => String(en.assignment||'').startsWith('__HGRID__:') && myNames.has(String(en.character_name||'')));
          } catch {}
          return false;
        }
        function hasNameInSpore(panel) {
          try {
            const groups = panel?.spore_groups || {};
            for (const g of Object.values(groups)) { for (const n of (g||[])) { if (n && myNames.has(String(n))) return true; } }
          } catch {}
          try {
            return (Array.isArray(panel.entries)?panel.entries:[]).some(en => String(en.assignment||'').startsWith('__SPORE__:') && myNames.has(String(en.character_name||'')));
          } catch {}
          return false;
        }
        function hasNameInKel(panel) {
          try {
            const groups = panel?.kel_groups || {};
            for (const g of Object.values(groups)) { for (const n of (g||[])) { if (n && myNames.has(String(n))) return true; } }
          } catch {}
          try {
            return (Array.isArray(panel.entries)?panel.entries:[]).some(en => String(en.assignment||'').startsWith('__KEL__:') && myNames.has(String(en.character_name||'')));
          } catch {}
          return false;
        }

        // Helper: append only a specific grid from a full panel (hide image/list/video)
        function appendGridOnly(panel, gridClassName) {
          const div = buildPanel(panel, viewUser, roster);
          try {
            const actions = div.querySelector('.assignments-actions'); if (actions) actions.style.display = 'none';
            const content = div.querySelector('.manual-rewards-content');
            if (content) {
              Array.from(content.children).forEach(child => {
                if (!(child.classList && child.classList.contains(gridClassName))) {
                  child.remove();
                }
              });
            }
          } catch {}
          // Make status icons bigger on myassignments page for better visibility
          // AND hide status icons for other players (only show your own)
          try {
            // Create lowercase set for case-insensitive matching
            const myNamesLower = new Set([...myNames].map(n => n.toLowerCase()));
            
            // Helper to find player name from a status button/icon element
            function getPlayerNameFromElement(el) {
              // For Horsemen grid: status is in .accept-col, name is in first cell of same row
              const acceptCol = el.closest('.accept-col');
              if (acceptCol) {
                const row = acceptCol.parentElement;
                if (row) {
                  // First cell contains the warrior name
                  const firstCell = row.children[0];
                  if (firstCell) {
                    const nameSpan = firstCell.querySelector('span');
                    return nameSpan ? nameSpan.textContent.trim() : '';
                  }
                }
                return '';
              }
              // For Spore/Kel/Cthun grids: name span is sibling in same wrapper (parent div)
              let parentWrap = el.parentElement;
              // If el is a span containing an icon, go up one more level
              if (parentWrap && parentWrap.tagName === 'SPAN') {
                parentWrap = parentWrap.parentElement;
              }
              if (parentWrap) {
                // Find the first span that contains text (the name), not an icon
                for (const child of parentWrap.children) {
                  if (child.tagName === 'SPAN' && !child.querySelector('i') && child.textContent.trim()) {
                    return child.textContent.trim();
                  }
                }
              }
              return '';
            }
            
            // Process all status toggle buttons (interactive icons)
            div.querySelectorAll('.status-toggle-btn').forEach(btn => {
              const playerName = getPlayerNameFromElement(btn);
              const isMyChar = playerName && myNamesLower.has(playerName.toLowerCase());
              if (isMyChar) {
                // Make icon bigger for my characters (Spore/Kel/Cthun only - Horsemen already 40px)
                const isHorsemen = btn.closest('.horsemen-grid-wrap');
                if (!isHorsemen) {
                  const icon = btn.querySelector('i.fas, i.fa');
                  if (icon) {
                    icon.style.fontSize = '30px';
                    icon.style.lineHeight = '30px';
                  }
                }
              } else {
                // Hide status icons for other players
                btn.remove();
              }
            });
            
            // Handle non-interactive status icons (.status-icon divs in Horsemen)
            div.querySelectorAll('.accept-col .status-icon').forEach(statusDiv => {
              const playerName = getPlayerNameFromElement(statusDiv);
              const isMyChar = playerName && myNamesLower.has(playerName.toLowerCase());
              if (!isMyChar) {
                statusDiv.innerHTML = ''; // Clear the icon
              }
            });
            
            // Handle non-interactive status icons in Spore/Kel/Cthun grids (span > i.fas)
            // These are spans containing icons that are NOT inside buttons
            div.querySelectorAll('.spore-grid-wrap i.fas, .kel-grid-wrap i.fas, .cthun-grid-wrap i.fas').forEach(icon => {
              // Skip if already in a button (handled above)
              if (icon.closest('.status-toggle-btn')) return;
              const playerName = getPlayerNameFromElement(icon);
              const isMyChar = playerName && myNamesLower.has(playerName.toLowerCase());
              if (!isMyChar) {
                // Remove the span containing the icon
                const parentSpan = icon.parentElement;
                if (parentSpan) parentSpan.remove();
              } else {
                // Make icon bigger for my character
                icon.style.fontSize = '30px';
                icon.style.lineHeight = '30px';
              }
            });
          } catch {}
          // Mark this panel as myassignments context so click handlers can use larger icons
          div.dataset.myassignmentsContext = 'true';
          container.appendChild(div);
        }

        if (!isNonNaxEvent) {
          // NAX special grids only on NAX events
          try {
            const horsePanel = panels.find(p => String(p.boss||'').toLowerCase().includes('horse'));
            if (horsePanel && hasNameInHorse(horsePanel)) {
              appendGridOnly(horsePanel, 'horsemen-grid-wrap');
            }
          } catch {}
          try {
            const loathebPanel = panels.find(p => String(p.boss||'').toLowerCase().includes('loatheb'));
            if (loathebPanel && hasNameInSpore(loathebPanel)) {
              appendGridOnly(loathebPanel, 'spore-grid-wrap');
            }
          } catch {}
          try {
            const kelPanel = panels.find(p => String(p.boss||'').toLowerCase().includes('kel'));
            if (kelPanel && hasNameInKel(kelPanel)) {
              appendGridOnly(kelPanel, 'kel-grid-wrap');
            }
          } catch {}
        } else {
          // Non-NAX: show only C'Thun grid
          try {
            const cthPanel = panels.find(p => String(p.boss||'').toLowerCase().includes("c'thun") || String(p.boss||'').toLowerCase().includes('cthun'));
            if (cthPanel) {
              const hasMe = (function() {
                try {
                  const groups = cthPanel?.cthun_positions || {};
                  for (const g of Object.values(groups)) { for (const n of (g||[])) { if (n && myNames.has(String(n))) return true; } }
                } catch {}
                try {
                  return (Array.isArray(cthPanel.entries)?cthPanel.entries:[]).some(en => String(en.assignment||'').startsWith('__CTHUN__:') && myNames.has(String(en.character_name||'')));
                } catch {}
                return false;
              })();
              if (hasMe) appendGridOnly(cthPanel, 'cthun-grid-wrap');
            }
          } catch {}
        }

        return;
      }
      if (wing === 'main') {
        // Build Main Assignments panels (lightweight)
        const existingTanking = panels.find(p => String(p.boss || '').toLowerCase() === 'tanking' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
        const tankingPanel = buildMainPanel({
          dungeon: existingTanking?.dungeon || 'Naxxramas',
          wing: '',
          boss: 'Tanking',
          strategy_text: existingTanking?.strategy_text || '',
          entries: Array.isArray(existingTanking?.entries) ? existingTanking.entries : [],
          header_color: '#c79c6e',
          header_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754862751/spec-protection-icon_dalb4j.webp'
        }, user, roster);

        const existingHealing = panels.find(p => String(p.boss || '').toLowerCase() === 'healing' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
        const healingPanel = buildMainPanel({
          dungeon: existingHealing?.dungeon || 'Naxxramas',
          wing: '',
          boss: 'Healing',
          strategy_text: 'Shamans, bounce chain heals of your tank assignment. Keep them alive.',
          entries: Array.isArray(existingHealing?.entries) ? existingHealing.entries : [],
          header_color: '#10b981',
          header_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754862895/healer-rankings.C-zTQI8l_jadafc.avif',
          variant: 'healing',
          fixed_icon_url: 'https://wow.zamimg.com/images/wow/icons/large/spell_nature_healingwavegreater.jpg'
        }, user, roster);

        const existingBuffs = panels.find(p => String(p.boss || '').toLowerCase() === 'buffs' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
        const buffsPanel = buildMainPanel({
          dungeon: existingBuffs?.dungeon || 'Naxxramas',
          wing: '',
          boss: 'Buffs',
          strategy_text: existingBuffs?.strategy_text || '',
          entries: Array.isArray(existingBuffs?.entries) ? existingBuffs.entries : [],
          header_color: '#3b82f6',
          header_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754928905/F5MOdkB-_400x400_cbcyvn.jpg',
          variant: 'buffs',
          fixed_icon_url: ''
        }, user, roster);

        const existingCurses = panels.find(p => String(p.boss || '').toLowerCase() === 'decurse and dispel' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
        const cursesPanel = buildMainPanel({
          dungeon: existingCurses?.dungeon || 'Naxxramas',
          wing: '',
          boss: 'Decurse and Dispel',
          strategy_text: existingCurses?.strategy_text || '',
          entries: Array.isArray(existingCurses?.entries) ? existingCurses.entries : [],
          header_color: '#8b5cf6',
          header_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754931090/gK6G8u8_KkcqMmsuGLztWpCgl6C96mfwdFQyj-lBPH0AirTtVAXtJa0FfboixUyScp0UoFHxwzwo9C1DDLJmuA_g781hm.webp',
          variant: 'curses',
          fixed_icon_url: ''
        }, user, roster);

        const existingSoul = panels.find(p => String(p.boss || '').toLowerCase() === 'curses and soul stones' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
        const soulPanel = buildMainPanel({
          dungeon: existingSoul?.dungeon || 'Naxxramas',
          wing: '',
          boss: 'Curses and Soul Stones',
          strategy_text: existingSoul?.strategy_text || '',
          entries: Array.isArray(existingSoul?.entries) ? existingSoul.entries : [],
          header_color: '#7c3aed',
          header_icon_url: 'https://wow.zamimg.com/images/wow/icons/large/spell_shadow_unholystrength.jpg',
          variant: 'soul',
          fixed_icon_url: ''
        }, user, roster);

        const existingPI = panels.find(p => String(p.boss || '').toLowerCase() === 'power infusion' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
        const piPanel = buildMainPanel({
          dungeon: existingPI?.dungeon || 'Naxxramas',
          wing: '',
          boss: 'Power Infusion',
          strategy_text: existingPI?.strategy_text || '',
          entries: Array.isArray(existingPI?.entries) ? existingPI.entries : [],
          header_color: '#f59e0b',
          header_icon_url: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_powerinfusion.jpg',
          variant: 'pi',
          fixed_icon_url: 'https://wow.zamimg.com/images/wow/icons/large/spell_holy_powerinfusion.jpg'
        }, user, roster);

        const existingDemoShout = panels.find(p => String(p.boss || '').toLowerCase() === 'demo shout' && (!p.wing || String(p.wing).trim() === '' || String(p.wing).toLowerCase() === 'main'));
        const demoShoutPanel = buildMainPanel({
          dungeon: existingDemoShout?.dungeon || 'Naxxramas',
          wing: '',
          boss: 'Demo Shout',
          strategy_text: existingDemoShout?.strategy_text || 'Keep Demoralizing Shout up on the boss at all times to reduce incoming damage.',
          entries: Array.isArray(existingDemoShout?.entries) ? existingDemoShout.entries : [],
          header_color: '#c79c6e',
          header_icon_url: 'https://wow.zamimg.com/images/wow/icons/large/ability_warrior_warcry.jpg',
          variant: 'demoshout',
          fixed_icon_url: 'https://wow.zamimg.com/images/wow/icons/large/ability_warrior_warcry.jpg'
        }, user, roster);

        // Place side by side using a simple grid wrapper
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = '1fr 1fr';
        grid.style.gap = '16px';
        grid.appendChild(tankingPanel);
        grid.appendChild(healingPanel);
        // Put Buffs and Curses side-by-side below
        const below = document.createElement('div');
        below.style.display = 'grid';
        below.style.gridTemplateColumns = '1fr 1fr';
        below.style.gap = '16px';
        below.style.marginTop = '16px';
        below.appendChild(buffsPanel);
        below.appendChild(cursesPanel);
        const below2 = document.createElement('div');
        below2.style.display = 'grid';
        below2.style.gridTemplateColumns = '1fr 1fr';
        below2.style.gap = '16px';
        below2.style.marginTop = '16px';
        below2.appendChild(soulPanel);
        below2.appendChild(piPanel);
        // Demo Shout panel below (full width or in a row)
        const below3 = document.createElement('div');
        below3.style.display = 'grid';
        below3.style.gridTemplateColumns = '1fr 1fr';
        below3.style.gap = '16px';
        below3.style.marginTop = '16px';
        below3.appendChild(demoShoutPanel);
        // Empty spacer for the right side
        const spacer = document.createElement('div');
        below3.appendChild(spacer);
        container.appendChild(grid);
        container.appendChild(below);
        container.appendChild(below2);
        container.appendChild(below3);
        return;
      }

      // Wing specific pages
      const match = panels.filter(p => String(p.wing || '').toLowerCase().includes(wing));
      let toRender = match.length > 0 ? match : [];
        if (toRender.length === 0) {
        // Provide sensible defaults for certain wings when nothing is saved yet
        if (wing === 'aq40') {
          const skeramPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'The Prophet Skeram',
            strategy_text: "Odd groups left. Even groups right. Interupt Arcane Explotions. \n\nIf the real one spawns on your side, run to the middle and kill the clone first.\n\nHelp CC mind controlled players (Sheep, Coil, Blind, Stomp etc.)",
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748092/Skeram_mid_xk7ad9.jpg',
            image_url_full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748093/Skeram_full_qpryfl.png',
            video_url: 'https://www.youtube.com/embed/ZVb2geSq-Fc',
            boss_icon_url: '',
            entries: []
          };
          const bugTrioPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Bug Trio',
            strategy_text: 'First kill Yauj and aoe the adds when she dies.\nThen kill Kri and move away from poision.\nTaunt rotate on Vem and move on with your life.\nTremor + Poison cleansing totems',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748177/bugtrie_mid_vszif2.jpg',
            image_url_full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748177/bigtrio_full_t5yevm.png',
            video_url: 'https://www.youtube.com/embed/YQp60n1VnPk',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756630087/bug_trio_ofvrvg.png',
            entries: []
          };
          const sarturaPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Battleguard Sartura',
            strategy_text: 'Stack & AOE adds. Pull boss out. Keep boss far away with taunt rotation when pinning. Be ready to LIP and commit.',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748212/Sartura_mid_npr3zh.jpg',
            image_url_full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748212/Sartura_full_jzoyqe.png',
            video_url: '',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756630715/sartura_soipg5.png',
            entries: []
          };
          const fankrissPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Fankriss the Unyielding',
            strategy_text: "Tank & Spank. Stand behind boss. \nOhhhh it's a snaaaaake!.",
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/Qc1kmG2s0Y8',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756630878/fankriss_ju6b9b.png',
            entries: []
          };
          const viscidusPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Viscidus',
            strategy_text: 'Melee = Frost weapons with Frost oil\nMages = Rank 1 frost bolts\nWarlocks = Frost wands\nShamans = Rank 1 frost shocks + Poison Cleansing Totems\nEveryone = Sapper the adds',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/2molET26BxM',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631416/viscidus_whpcsx.png',
            entries: []
          };
          const huhuranPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Princess Huhuran',
            strategy_text: 'Casters on max range and spread out. Save cooldowns to 50%. Dispell sleeping people with full helath. Lots of tank and melee chain healing! Keep healing tank when boss dies.',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/MGtX66nxFhg?t=2s',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631406/huhuran_uhgd1p.png',
            entries: []
          };
          const twinPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'The Twin Emperors',
            strategy_text: 'Casters kill Caster, Melee kill melee. Melee run 1-2 seconds before teleport. Tank must be the only one in melee range  when he teleports in. Don\'t drag bugs.',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/0oIVus5SYbA',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631414/twins_ufymht.png',
            entries: []
          };
          const twinsTrashPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Twins trash',
            strategy_text: 'Your main goal is to not die. If 4 Slayers, split them before you go in. Alawys kill Mindslayers last. CoR on mind controlled players.',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758751886/twins_trash_mid_dtkzg9.jpg',
            image_url_full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758751886/twins_trash_full_cwaijs.png',
            video_url: '',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631415/twinstrash_xwopji.png',
            entries: []
          };
          const ouroPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Ouro',
            strategy_text: 'Warriors who are high on threat, be ready to shield and stoneshield potion and go behind the boss when u agro. Casters spread on caster position. (don\'t over agro when tank gets knocked back, right before the sand blast)',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/YtqsFMmnRW8',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631413/ouro_vvmd0k.png',
            entries: []
          };
          const cthunPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: "C'Thun",
            strategy_text: "Phase 1: Tank run in first. Rest runs in when tank says go. Mellee stack in 2 on raid markers (see drawing).\nDo not chain. Casters/Healers spread out.\nKill small eyes when they spawn.\n\nPhase 2: Casters, Rogues and hunters kill/stun big eyes. Warriors kill small eyes. Kill tentacles when big eye is dead.",
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/2WMzsnJdTjQ',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631406/cthun_ke0e7s.png',
            entries: []
          };
          container.innerHTML = '';
          container.appendChild(buildPanel(skeramPanel, user, roster));
          container.appendChild(buildPanel(bugTrioPanel, user, roster));
          container.appendChild(buildPanel(sarturaPanel, user, roster));
          container.appendChild(buildPanel(fankrissPanel, user, roster));
          container.appendChild(buildPanel(viscidusPanel, user, roster));
          container.appendChild(buildPanel(huhuranPanel, user, roster));
          container.appendChild(buildPanel(twinPanel, user, roster));
          container.appendChild(buildPanel(twinsTrashPanel, user, roster));
          container.appendChild(buildPanel(ouroPanel, user, roster));
          container.appendChild(buildPanel(cthunPanel, user, roster));
          return;
        }
        if (wing === 'military') {
          const razPanel = {
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'Razuvious',
            strategy_text: 'Priests pull with mind control. Off-tanks tank adds. Mana users run out before Disruption Shout. Melee throw target dummies when needed.',
            image_url: 'https://placehold.co/1200x675?text=Razuvious',
            video_url: 'https://www.youtube.com/embed/XdWewsnOrhU',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754989023/182497_v3yeko.webp',
            entries: []
          };
          const gothikPanel = {
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'Gothik',
            strategy_text: 'Warriors on Undead side. Ranged and Rogues on Human side. Pop Greater Stoneshield on wave 9. We don\'t shackle. Healers',
            image_url: 'https://placehold.co/1200x675?text=Gothik',
            video_url: 'https://www.youtube.com/embed/MrBGF1P3eMM',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754993060/336px-Gothik_the_Harvester_full_gzj2ho.jpg',
            entries: []
          };
          const fourHorsemenPanel = {
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'The Four Horsemen',
            strategy_text: 'We nuke down and commit on Thane.\n\nHealer rotation starts on first mark and then healers all roather on every 3rd mark.',
            image_url: 'https://placehold.co/1200x675?text=The+Four+Horsemen',
            video_url: 'https://www.youtube.com/embed/nlKO8p3SMVw?controls=0&modestbranding=1&rel=0&iv_load_policy=3',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754993478/-16062_absih8.png',
            entries: []
          };
          const fourHorsemenCleavePanel = {
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'The Four Horsemen (Cleave)',
            strategy_text: 'Cleave strategy: Tanks rotate between bosses while DPS cleaves them down together.',
            image_url: 'https://placehold.co/1200x675?text=The+Four+Horsemen+Cleave',
            video_url: 'https://www.youtube.com/embed/on_hgoa3k0k',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754993478/-16062_absih8.png',
            entries: []
          };
          container.innerHTML = '';
          container.appendChild(buildPanel(razPanel, user, roster));
          container.appendChild(buildPanel(gothikPanel, user, roster));
          container.appendChild(buildPanel(fourHorsemenPanel, user, roster));
          container.appendChild(buildPanel(fourHorsemenCleavePanel, user, roster));
          
          // Load and apply the saved tactics preference for this event
          (async () => {
            try {
              const eventId = getActiveEventId();
              const res = await fetch(`/api/assignments/${eventId}/horsemen-tactics`);
              const data = await res.json();
              if (data.success && data.activeTactics) {
                const activeTactics = data.activeTactics;
                const classicPanel = container.querySelector('[data-panel-boss="the four horsemen"]');
                const cleavePanel = container.querySelector('[data-panel-boss="the four horsemen (cleave)"]');
                
                // Apply visibility based on saved preference
                if (activeTactics === 'cleave') {
                  if (classicPanel) classicPanel.style.display = 'none';
                  if (cleavePanel) cleavePanel.style.display = 'block';
                } else {
                  if (classicPanel) classicPanel.style.display = 'block';
                  if (cleavePanel) cleavePanel.style.display = 'none';
                }
                
                // Update all toggle buttons to reflect the saved state
                const allToggleBtns = container.querySelectorAll('.tactics-toggle-btn');
                allToggleBtns.forEach(btn => {
                  btn.dataset.currentTactics = activeTactics;
                  btn.textContent = activeTactics === 'cleave' ? 'Cleave' : 'Classic';
                  btn.style.background = activeTactics === 'cleave' ? '#8b5cf6' : '#3b82f6';
                });
              }
            } catch (err) {
              console.error('Error loading horsemen tactics:', err);
            }
          })();
          
          return;
        }
        if (wing === 'spider') {
          const maexPanel = {
            dungeon: 'Naxxramas',
            wing: 'Spider',
            boss: 'Maexxna',
            strategy_text: '',
            image_url: 'https://placehold.co/1200x675?text=Maexxna',
            video_url: 'https://www.youtube.com/embed/m5j7EHv7Dfw',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754984024/Maexx15928_o8jkro.png',
            entries: []
          };
          container.innerHTML = '';
          container.appendChild(buildPanel(maexPanel, user, roster));
          return;
        }
        if (wing === 'plague') {
          const nothPanel = {
            dungeon: 'Naxxramas',
            wing: 'Plague',
            boss: 'Noth The Plaguebringer',
            strategy_text: 'Mages and Druids MUST decurse instantly and exclusively when boss casts curse.\n\nOff-tanks pick up adds and stack them on boss.\n\nWhen boss teleports, let tank pick it up and then kill it.',
            image_url: 'https://placehold.co/1200x675?text=Noth+The+Plaguebringer',
            video_url: '',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755074097/16590_ezmekl.png',
            entries: []
          };
          const heiganPanel = {
            dungeon: 'Naxxramas',
            wing: 'Plague',
            boss: 'Heigan The Unclean',
            strategy_text: 'We can dance if we want to, we can leave your friends behind, cause your friends don\'t dance, and if they don\'t dance, well, they\'re no friends of mine.\n\nMelle stack behind tank and move perfectly. In dance phase, casters dance with melee.',
            image_url: 'https://placehold.co/1200x675?text=Heigan+The+Unclean',
            video_url: 'https://www.youtube.com/embed/dfSBp3Efjbk?controls=0&modestbranding=1&rel=0&iv_load_policy=3',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755075234/16309_kpg0jp.png',
            entries: []
          };
          const loathebPanel = {
            dungeon: 'Naxxramas',
            wing: 'Plague',
            boss: 'Loatheb',
            strategy_text: 'Pre-pop and use GSPP. Get a health stone. Use bandage if needed.\n\nHealers follow healing rotation and only heal main-tank. Stand in front of the boss and behind the tank. Don\'t use any holy spells (it will put your heal on cooldown)',
            image_url: 'https://placehold.co/1200x675?text=Loatheb',
            video_url: 'https://www.youtube.com/embed/_zwIx3uzoFI?controls=0&modestbranding=1&rel=0&iv_load_policy=3',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755080534/Fungal_monster_s0zutr.webp',
            entries: []
          };
          container.innerHTML = '';
          container.appendChild(buildPanel(nothPanel, user, roster));
          container.appendChild(buildPanel(heiganPanel, user, roster));
          container.appendChild(buildPanel(loathebPanel, user, roster));
          return;
        }
        if (wing === 'abomination') {
          const patchPanel = {
            dungeon: 'Naxxramas',
            wing: 'Abomination',
            boss: 'Patchwerk',
            strategy_text: 'Tanks MUST stack perfectly. Top 3 on threat must be tanks. Melee DPS dip in slime to juke hateful strike. Healers spam consumes and keep tanks up. Heal only tanks.',
            image_url: 'https://placehold.co/1200x675?text=Patchwerk',
            video_url: 'https://www.youtube.com/embed/bmpVXEQYIcg',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755085582/patchwerk_wfd5z4.gif',
            entries: []
          };
          const grobbPanel = {
            dungeon: 'Naxxramas',
            wing: 'Abomination',
            boss: 'Grobbulus',
            strategy_text: "Boss must face away from raid. Don't dispel unless assigned. Melee stay at max range and cleve when slime is up. Drop slime pools at the edge of the room.",
            image_url: 'https://placehold.co/1200x675?text=Grobbulus',
            video_url: 'https://www.youtube.com/embed/WhqA3O6HIJk',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755086620/24792_gahise.png',
            entries: []
          };
          const gluthPanel = {
            dungeon: 'Naxxramas',
            wing: 'Abomination',
            boss: 'Gluth',
            strategy_text: 'Rotate tanks on healing debuff if needed. Kite adds far from Boss. No one raid heal. Only heal tanks. Mages help on adds with frost nova. Casters stay on max range to dodge fear. Hunters place slow trap for kiting. Shamans use Tremor if in melee and earth binding if in ranged group.',
            image_url: 'https://placehold.co/1200x675?text=Gluth',
            video_url: 'https://www.youtube.com/embed/JWf9-N609PA',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755087393/27103_rdbmzc.png',
            entries: []
          };
          const thaddPanel = {
            dungeon: 'Naxxramas',
            wing: 'Abomination',
            boss: 'Thaddius',
            strategy_text: 'Phase 1:\nOdd groups left - Even groups right. Kill adds at the same time. Casters max range. Off-tank taunt on tank swap.\n\nPhase 2:\nStack in front of boss. On Polarity Shift, Minus go left. Plus go right. Run trough the boss.\n\nNotes:\nPlus goes right\nMinus goes left\nMages, watch the ignite.',
            image_url: 'https://placehold.co/1200x675?text=Thaddius',
            video_url: 'https://www.youtube.com/embed/lgDJq4-i4kk',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755087787/dfka9xt-cbdf45c1-45b9-460b-a997-5a46c4de0a65_txsidf.png',
            entries: []
          };
          container.innerHTML = '';
          container.appendChild(buildPanel(patchPanel, user, roster));
          container.appendChild(buildPanel(grobbPanel, user, roster));
          container.appendChild(buildPanel(gluthPanel, user, roster));
          container.appendChild(buildPanel(thaddPanel, user, roster));
          return;
        }
        if (wing === 'frostwyrm_lair') {
          // Prefer saved panels if present; otherwise fall back to defaults
          const existingSapph = panels.find(p => String(p.boss || '').toLowerCase().includes('sapph'));
          const sapphPanel = {
            dungeon: existingSapph?.dungeon || 'Naxxramas',
            wing: 'Frostwyrm_Lair',
            boss: 'Sapphiron',
            strategy_text: existingSapph?.strategy_text || 'Positions & Pre-pop\nOdd groups left. Even groups right. Everyone pre-pop GFPP and GSPP when we unboon.\n\nLand phase\nMellee stand on max range. Avoid Blizzard and don\'t parry-haste the boss.\nCasters stack loosely for aoe healing and avoid Blizzard.\nShaman melee healers stand with your group so you can chain-heal yourself.\n\nAir phase\nSpread out in the half of the room towards the entrace of the room. When you get targeted for ice-block, pop a Greater Frost Protection Potion to stay alive.',
            image_url: existingSapph?.image_url || 'https://placehold.co/1200x675?text=Sapphiron',
            video_url: existingSapph?.video_url || 'https://www.youtube.com/embed/NwDFC6kFi7c',
            boss_icon_url: existingSapph?.boss_icon_url || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755093137/oUwfSmi_mp74xg.gif',
            entries: Array.isArray(existingSapph?.entries) ? existingSapph.entries : []
          };
          const existingKel = panels.find(p => String(p.boss || '').toLowerCase().includes('kel'));
          const kelPanel = {
            dungeon: existingKel?.dungeon || 'Naxxramas',
            wing: 'Frostwyrm_Lair',
            boss: "Kel'Thuzad",
            strategy_text: existingKel?.strategy_text || "Phase 1\nDont't die. Don't multi shot. Stay in the circle. Kill adds fast. Prioritze shooting skellingtons over killing abos.\n\nPhase 2\nMelee stack perfectly on your marks and backpeddle out when ground gets black. Casters and healers spread out in the room.\n\nHealers, heal Frost Blast targets fast.\n\nPhase 3\nPriests, shackle adds BEFORE they get to the middle. Keep them shackled.",
            image_url: existingKel?.image_url || 'https://placehold.co/1200x675?text=Kel%5C%27Thuzad',
            video_url: existingKel?.video_url || 'https://www.youtube.com/embed/GUIftNHHKNs',
            boss_icon_url: existingKel?.boss_icon_url || 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755109693/imgbin-heroes-of-the-storm-kel-thuzad-arthas-menethil-storm-za4EdhZSa9A2GBvAUf1Gi8t4q_qxel5s.jpg',
            // Preserve special grid state if present
            kel_groups: existingKel?.kel_groups || undefined,
            entries: Array.isArray(existingKel?.entries) ? existingKel.entries : []
          };
          container.innerHTML = '';
          container.appendChild(buildPanel(sapphPanel, user, roster));
          container.appendChild(buildPanel(kelPanel, user, roster));
          return;
        }
        container.innerHTML = '<div class="no-data-message"><div class="no-data-content"><i class="fas fa-info-circle"></i><h3>No Assignments</h3><p>No assignments found for this wing.</p></div></div>';
        return;
      }
      // Ordering for AQ40 per requested sequence (supports routes like "aq40" or "aq40bwl")
      if (String(wing||'').toLowerCase().includes('aq40')) {
        const order = [
          'the prophet skeram','skeram',
          'bug trio','bug',
          'battleguard sartura','sartura',
          'fankriss the unyielding','fank',
          'viscidus','visc',
          'princess huhuran','huhu','huhuran',
          'twin emperors',
          'twins trash',
          'ouro',
          "c'thun", 'cthun'
        ];
        toRender = toRender.slice().sort((a, b) => {
          const ak = String(a.boss || '').toLowerCase();
          const bk = String(b.boss || '').toLowerCase();
          const ai = order.findIndex(k => ak.includes(k));
          const bi = order.findIndex(k => bk.includes(k));
          const av = ai === -1 ? 999 : ai;
          const bv = bi === -1 ? 999 : bi;
          return av - bv;
        });
      } else if (wing === 'spider') {
        const order = ['anub', 'faerlina', 'maex'];
        toRender = toRender.slice().sort((a, b) => {
          const ak = String(a.boss || '').toLowerCase();
          const bk = String(b.boss || '').toLowerCase();
          const ai = order.findIndex(k => ak.includes(k));
          const bi = order.findIndex(k => bk.includes(k));
          const av = ai === -1 ? 999 : ai;
          const bv = bi === -1 ? 999 : bi;
          return av - bv;
        });
      } else if (wing === 'military') {
        // Ensure Military Wing shows panels in order: Razuvious, Gothik, The Four Horsemen (both Classic and Cleave)
        const hasRaz = toRender.some(p => String(p.boss || '').toLowerCase().includes('razu'));
        const hasGoth = toRender.some(p => String(p.boss || '').toLowerCase().includes('goth'));
        const hasHorseClassic = toRender.some(p => String(p.boss || '').toLowerCase() === 'the four horsemen');
        const hasHorseCleave = toRender.some(p => String(p.boss || '').toLowerCase().includes('cleave') && String(p.boss || '').toLowerCase().includes('horse'));
        if (!hasRaz) {
          toRender.push({
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'Razuvious',
            strategy_text: 'Priests pull with mind control. Off-tanks tank adds. Mana users run out before Disruption Shout. Melee throw target dummies when needed.',
            image_url: 'https://placehold.co/1200x675?text=Razuvious',
            video_url: 'https://www.youtube.com/embed/XdWewsnOrhU',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754989023/182497_v3yeko.webp',
            entries: []
          });
        }
        if (!hasGoth) {
          toRender.push({
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'Gothik',
            strategy_text: 'Warriors on Undead side. Ranged and Rogues on Human side. Pop Greater Stoneshield on wave 9. We don\'t shackle. Healers',
            image_url: 'https://placehold.co/1200x675?text=Gothik',
            video_url: 'https://www.youtube.com/embed/MrBGF1P3eMM',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754993060/336px-Gothik_the_Harvester_full_gzj2ho.jpg',
            entries: []
          });
        }
        // Always ensure both Classic and Cleave tactics panels exist
        if (!hasHorseClassic) {
          toRender.push({
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'The Four Horsemen',
            strategy_text: 'We nuke down and commit on Thane.\n\nHealer rotation starts on first mark and then healers all roather on every 3rd mark.',
            image_url: 'https://placehold.co/1200x675?text=The+Four+Horsemen',
            video_url: 'https://www.youtube.com/embed/nlKO8p3SMVw?controls=0&modestbranding=1&rel=0&iv_load_policy=3',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754993478/-16062_absih8.png',
            entries: []
          });
        }
        if (!hasHorseCleave) {
          toRender.push({
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'The Four Horsemen (Cleave)',
            strategy_text: 'Cleave strategy: Tanks rotate between bosses while DPS cleaves them down together.',
            image_url: 'https://placehold.co/1200x675?text=The+Four+Horsemen+Cleave',
            video_url: 'https://www.youtube.com/embed/on_hgoa3k0k',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754993478/-16062_absih8.png',
            entries: []
          });
        }
        const order = ['razu', 'goth', 'four', 'horse'];
        toRender = toRender.slice().sort((a, b) => {
          const ak = String(a.boss || '').toLowerCase();
          const bk = String(b.boss || '').toLowerCase();
          const ai = order.findIndex(k => ak.includes(k));
          const bi = order.findIndex(k => bk.includes(k));
          const av = ai === -1 ? 999 : ai;
          const bv = bi === -1 ? 999 : bi;
          return av - bv;
        });
      } else if (wing === 'plague') {
        // Ensure Plague Wing shows panels in order: Noth, Heigan, Loatheb
        const order = ['noth', 'heig', 'loatheb'];
        toRender = toRender.slice().sort((a, b) => {
          const ak = String(a.boss || '').toLowerCase();
          const bk = String(b.boss || '').toLowerCase();
          const ai = order.findIndex(k => ak.includes(k));
          const bi = order.findIndex(k => bk.includes(k));
          const av = ai === -1 ? 999 : ai;
          const bv = bi === -1 ? 999 : bi;
          return av - bv;
        });
      } else if (wing === 'abomination') {
        // Ensure Abomination Wing ordering with Patchwerk, Grobbulus, Gluth, Thaddius
        const order = ['patch', 'grobb', 'gluth', 'thadd'];
        toRender = toRender.slice().sort((a, b) => {
          const ak = String(a.boss || '').toLowerCase();
          const bk = String(b.boss || '').toLowerCase();
          const ai = order.findIndex(k => ak.includes(k));
          const bi = order.findIndex(k => bk.includes(k));
          const av = ai === -1 ? 999 : ai;
          const bv = bi === -1 ? 999 : bi;
          return av - bv;
        });
      } else if (wing === 'frostwyrm_lair') {
        // Ensure Frostwyrm Lair ordering: Sapphiron, then Kel'Thuzad
        const order = ['sapph', 'kel'];
        toRender = toRender.slice().sort((a, b) => {
          const ak = String(a.boss || '').toLowerCase();
          const bk = String(b.boss || '').toLowerCase();
          const ai = order.findIndex(k => ak.includes(k));
          const bi = order.findIndex(k => bk.includes(k));
          const av = ai === -1 ? 999 : ai;
          const bv = bi === -1 ? 999 : bi;
          return av - bv;
        });
      }
      // Hardcode AQ40 order with 100% certainty by composing the container in sequence
      if (wing === 'aq40') {
        const normalize = (s) => String(s || '').toLowerCase();
        const keyOf = (name) => {
          const n = normalize(name);
          if (n.includes('prophet') || n.includes('skeram')) return 'skeram';
          if (n.includes('bug trio') || n === 'bug') return 'bug';
          if (n.includes('sartura')) return 'sartura';
          if (n.includes('fankriss')) return 'fank';
          if (n.includes('viscidus') || n.includes('visc')) return 'visc';
          if (n.includes('huhuran') || n.includes('huhu')) return 'huhu';
          if (n.includes('twin emperors')) return 'twin';
          if (n.includes('twins trash')) return 'twins trash';
          if (n === 'ouro' || n.includes('ouro')) return 'ouro';
          if (n.includes("c'thun") || n.includes('cthun')) return 'cthun';
          return '';
        };
        const existingByKey = new Map();
        (toRender || []).forEach(p => {
          const k = keyOf(p.boss);
          if (k && !existingByKey.has(k)) existingByKey.set(k, p);
        });
        function defPanel(key) {
          const base = { dungeon: 'AQ40', wing: 'AQ40', entries: [] };
          if (key === 'skeram') return { ...base, boss: 'The Prophet Skeram', strategy_text: "Odd groups left. Even groups right. Interupt Arcane Explotions.\n\nIf the real one spawns on your side, run to the middle and kill the clone first.\n\nHelp CC mind controlled players (Sheep, Coil, Blind, Stomp etc.)", image_url: '' };
          if (key === 'bug') return { ...base, boss: 'Bug Trio', strategy_text: 'First kill Yauj and aoe the adds when she dies.\nThen kill Kri and move away from poision.\nTaunt rotate on Vem and move on with your life.\nTremor + Poison cleansing totems', image_url: '' };
          if (key === 'sartura') return { ...base, boss: 'Battleguard Sartura', strategy_text: 'Stack & AOE adds. Pull boss out. Keep boss far away with taunt rotation when pinning. Be ready to LIP and commit.', image_url: '' };
          if (key === 'fank') return { ...base, boss: 'Fankriss the Unyielding', strategy_text: "Tank & Spank. Stand behind boss.\nOhhhh it's a snaaaaake!.", image_url: '' };
          if (key === 'visc') return { ...base, boss: 'Viscidus', strategy_text: 'Melee = Frost weapons with Frost oil\nMages = Rank 1 frost bolts\nWarlocks = Frost wands\nShamans = Rank 1 frost shocks + Poison Cleansing Totems\nEveryone = Sapper the adds', image_url: '' };
          if (key === 'huhu') return { ...base, boss: 'Princess Huhuran', strategy_text: 'Casters on max range and spread out. Save cooldowns to 50%. Dispell sleeping people with full helath. Lots of tank and melee chain healing! Keep healing tank when boss dies.', image_url: '' };
          if (key === 'twin') return { ...base, boss: 'The Twin Emperors', strategy_text: "Casters kill Caster, Melee kill melee. Melee run 1-2 seconds before teleport. Tank must be the only one in melee range  when he teleports in. Don't drag bugs.", image_url: '' };
          if (key === 'twins trash') return { ...base, boss: 'Twins trash', strategy_text: 'Your main goal is to not die. If 4 Slayers, split them before you go in. Alawys kill Mindslayers last. CoR on mind controlled players.', image_url: '' };
          if (key === 'ouro') return { ...base, boss: 'Ouro', strategy_text: "Warriors who are high on threat, be ready to shield and stoneshield potion and go behind the boss when u agro. Casters spread on caster position. (don't over agro when tank gets knocked back, right before the sand blast)", image_url: '' };
          if (key === 'cthun') return { ...base, boss: "C'Thun", strategy_text: "Phase 1: Tank run in first. Rest runs in when tank says go. Mellee stack in 2 on raid markers (see drawing).\nDo not chain. Casters/Healers spread out.\nKill small eyes when they spawn.\n\nPhase 2: Casters, Rogues and hunters kill/stun big eyes. Warriors kill small eyes. Kill tentacles when big eye is dead.", image_url: '' };
          return base;
        }
        const orderKeys = ['skeram','bug','sartura','fank','visc','huhu','twin','twins trash','ouro','cthun'];
        try { container.innerHTML = ''; } catch {}
        orderKeys.forEach(k => {
          const panelObj = existingByKey.get(k) || defPanel(k);
          container.appendChild(buildPanel(panelObj, user, roster));
        });
        return;
      }

      toRender.forEach(p => container.appendChild(buildPanel(p, user, roster)));
      
      // Load and apply the saved tactics preference for Four Horsemen if we're on military wing
      if (wing === 'military') {
        (async () => {
          try {
            const eventId = getActiveEventId();
            const res = await fetch(`/api/assignments/${eventId}/horsemen-tactics`);
            const data = await res.json();
            if (data.success && data.activeTactics) {
              const activeTactics = data.activeTactics;
              const classicPanel = container.querySelector('[data-panel-boss="the four horsemen"]');
              const cleavePanel = container.querySelector('[data-panel-boss="the four horsemen (cleave)"]');
              
              // Apply visibility based on saved preference
              if (activeTactics === 'cleave') {
                if (classicPanel) classicPanel.style.display = 'none';
                if (cleavePanel) cleavePanel.style.display = 'block';
              } else {
                if (classicPanel) classicPanel.style.display = 'block';
                if (cleavePanel) cleavePanel.style.display = 'none';
              }
              
              // Update all toggle buttons to reflect the saved state
              const allToggleBtns = container.querySelectorAll('.tactics-toggle-btn');
              allToggleBtns.forEach(btn => {
                btn.dataset.currentTactics = activeTactics;
                btn.textContent = activeTactics === 'cleave' ? 'Cleave' : 'Classic';
                btn.style.background = activeTactics === 'cleave' ? '#8b5cf6' : '#3b82f6';
              });
            }
          } catch (err) {
            console.error('Error loading horsemen tactics:', err);
          }
        })();
      }

      // AQ40: ensure Skeram and Bug Trio panels are present even if not saved yet
      if (wing === 'aq40') {
        const hasSkeram = toRender.some(p => String(p.boss || '').toLowerCase().includes('skeram'));
        const hasBug = toRender.some(p => String(p.boss || '').toLowerCase().includes('bug'));
        const hasSart = toRender.some(p => String(p.boss || '').toLowerCase().includes('sartura'));
        const hasFank = toRender.some(p => String(p.boss || '').toLowerCase().includes('fank'));
        const hasVisc = toRender.some(p => String(p.boss || '').toLowerCase().includes('visc'));
        const hasHuhu = toRender.some(p => String(p.boss || '').toLowerCase().includes('huhu') || String(p.boss || '').toLowerCase().includes('huhuran'));
        const hasTwin = toRender.some(p => String(p.boss || '').toLowerCase().includes('twin'));
        const hasTwinsTrash = toRender.some(p => String(p.boss || '').toLowerCase().includes('twins trash'));
        const hasOuro = toRender.some(p => String(p.boss || '').toLowerCase().includes('ouro'));
        const hasCthun = toRender.some(p => String(p.boss || '').toLowerCase().includes("c'thun") || String(p.boss || '').toLowerCase().includes('cthun'));
        if (!hasSkeram) {
          const skeramPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'The Prophet Skeram',
            strategy_text: "Odd groups left. Even groups right. Interupt Arcane Explotions. \n\nIf the real one spawns on your side, run to the middle and kill the clone first.\n\nHelp CC mind controlled players (Sheep, Coil, Blind, Stomp etc.)",
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748092/Skeram_mid_xk7ad9.jpg',
            image_url_full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748093/Skeram_full_qpryfl.png',
            video_url: 'https://www.youtube.com/embed/ZVb2geSq-Fc',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756127451/15345_gqfi2d.png',
            entries: []
          };
          container.appendChild(buildPanel(skeramPanel, user, roster));
        }
        if (!hasVisc) {
          const viscidusPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Viscidus',
            strategy_text: 'Melee = Frost weapons with Frost oil\nMages = Rank 1 frost bolts\nWarlocks = Frost wands\nShamans = Rank 1 frost shocks + Poison Cleansing Totems\nEveryone = Sapper the adds',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/2molET26BxM',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631416/viscidus_whpcsx.png',
            entries: []
          };
          container.appendChild(buildPanel(viscidusPanel, user, roster));
        }
        if (!hasHuhu) {
          const huhuranPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Princess Huhuran',
            strategy_text: 'Casters on max range and spread out. Save cooldowns to 50%. Dispell sleeping people with full helath. Lots of tank and melee chain healing! Keep healing tank when boss dies.',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/MGtX66nxFhg?t=2s',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631406/huhuran_uhgd1p.png',
            entries: []
          };
          container.appendChild(buildPanel(huhuranPanel, user, roster));
        }
        if (!hasTwin) {
          const twinPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'The Twin Emperors',
            strategy_text: 'Casters kill Caster, Melee kill melee. Melee run 1-2 seconds before teleport. Tank must be the only one in melee range  when he teleports in. Don\'t drag bugs.',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/0oIVus5SYbA',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631414/twins_ufymht.png',
            entries: []
          };
          container.appendChild(buildPanel(twinPanel, user, roster));
        }
        if (!hasTwinsTrash) {
          const twinsTrashPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Twins trash',
            strategy_text: 'Your main goal is to not die. If 4 Slayers, split them before you go in. Alawys kill Mindslayers last. CoR on mind controlled players.',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758751886/twins_trash_mid_dtkzg9.jpg',
            image_url_full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758751886/twins_trash_full_cwaijs.png',
            video_url: '',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631415/twinstrash_xwopji.png',
            entries: []
          };
          container.appendChild(buildPanel(twinsTrashPanel, user, roster));
        }
        if (!hasOuro) {
          const ouroPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Ouro',
            strategy_text: 'Warriors who are high on threat, be ready to shield and stoneshield potion and go behind the boss when u agro. Casters spread on caster position. (don\'t over agro when tank gets knocked back, right before the sand blast)',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/YtqsFMmnRW8',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631413/ouro_vvmd0k.png',
            entries: []
          };
          container.appendChild(buildPanel(ouroPanel, user, roster));
        }
        if (!hasCthun) {
          const cthunPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: "C'Thun",
            strategy_text: "Phase 1: Tank run in first. Rest runs in when tank says go. Mellee stack in 2 on raid markers (see drawing).\nDo not chain. Casters/Healers spread out.\nKill small eyes when they spawn.\n\nPhase 2: Casters, Rogues and hunters kill/stun big eyes. Warriors kill small eyes. Kill tentacles when big eye is dead.",
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/2WMzsnJdTjQ',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756631406/cthun_ke0e7s.png',
            entries: []
          };
          container.appendChild(buildPanel(cthunPanel, user, roster));
        }
        if (!hasFank) {
          const fankrissPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Fankriss the Unyielding',
            strategy_text: "Tank & Spank. Stand behind boss. \nOhhhh it's a snaaaaake!.",
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755848193/Coming_soon_spejyt.jpg',
            video_url: 'https://www.youtube.com/embed/Qc1kmG2s0Y8',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756630878/fankriss_ju6b9b.png',
            entries: []
          };
          container.appendChild(buildPanel(fankrissPanel, user, roster));
        }
        if (!hasBug) {
          const bugTrioPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Bug Trio',
            strategy_text: 'First kill Yauj and aoe the adds when she dies.\nThen kill Kri and move away from poision.\nTaunt rotate on Vem and move on with your life.\nTremor + Poison cleansing totems',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748177/bugtrie_mid_vszif2.jpg',
            image_url_full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748177/bigtrio_full_t5yevm.png',
            video_url: 'https://www.youtube.com/embed/YQp60n1VnPk',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756127717/-15511_ebf20d.png',
            entries: []
          };
          container.appendChild(buildPanel(bugTrioPanel, user, roster));
        }
        if (!hasSart) {
          const sarturaPanel = {
            dungeon: 'AQ40',
            wing: 'AQ40',
            boss: 'Battleguard Sartura',
            strategy_text: 'Stack & AOE adds. Pull boss out. Keep boss far away with taunt rotation when pinning. Be ready to LIP and commit.',
            image_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748212/Sartura_mid_npr3zh.jpg',
            image_url_full: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1758748212/Sartura_full_jzoyqe.png',
            video_url: '',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1756630715/sartura_soipg5.png',
            entries: []
          };
          container.appendChild(buildPanel(sarturaPanel, user, roster));
        }
      } else if (wing === 'spider') {
        const hasMaex = toRender.some(p => String(p.boss || '').toLowerCase().includes('maex'));
        if (!hasMaex) {
          const maexPanel = {
            dungeon: 'Naxxramas',
            wing: 'Spider',
            boss: 'Maexxna',
            strategy_text: '',
            image_url: 'https://placehold.co/1200x675?text=Maexxna',
            video_url: 'https://www.youtube.com/embed/m5j7EHv7Dfw',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754984024/Maexx15928_o8jkro.png',
            entries: []
          };
          // append after existing spider panels to ensure it's last
          container.appendChild(buildPanel(maexPanel, user, roster));
        }
      } else if (wing === 'military') {
        // Military Wing: ensure Razuvious and Gothik panels are present even if not saved yet
        const hasRaz = toRender.some(p => String(p.boss || '').toLowerCase().includes('razu'));
        const hasGoth = toRender.some(p => String(p.boss || '').toLowerCase().includes('goth'));
        if (!hasRaz) {
          const razPanel = {
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'Razuvious',
            strategy_text: 'Priests pull with mind control. Off-tanks tank adds. Mana users run out before Disruption Shout. Melee throw target dummies when needed.',
            image_url: 'https://placehold.co/1200x675?text=Razuvious',
            video_url: 'https://www.youtube.com/embed/XdWewsnOrhU',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754989023/182497_v3yeko.webp',
            entries: []
          };
          container.appendChild(buildPanel(razPanel, user, roster));
        }
        if (!hasGoth) {
          const gothikPanel = {
            dungeon: 'Naxxramas',
            wing: 'Military',
            boss: 'Gothik',
            strategy_text: 'Warriors on Undead side. Ranged and Rogues on Human side. Pop Greater Stoneshield on wave 9. We don\'t shackle. Healers',
            image_url: 'https://placehold.co/1200x675?text=Gothik',
            video_url: 'https://www.youtube.com/embed/MrBGF1P3eMM',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1754991352/336px-Gothik_the_Harvester_full_pxt0rf.jpg',
            entries: []
          };
          container.appendChild(buildPanel(gothikPanel, user, roster));
        }
      } else if (wing === 'plague') {
        // Ensure Noth, Heigan and Loatheb are present by default
        const hasNoth = toRender.some(p => String(p.boss || '').toLowerCase().includes('noth'));
        const hasHeigan = toRender.some(p => String(p.boss || '').toLowerCase().includes('heig'));
        const hasLoatheb = toRender.some(p => String(p.boss || '').toLowerCase().includes('loatheb'));
        if (!hasNoth) {
          const nothPanel = {
            dungeon: 'Naxxramas',
            wing: 'Plague',
            boss: 'Noth The Plaguebringer',
            strategy_text: 'Mages and Druids MUST decurse instantly and exclusively when boss casts curse.\n\nOff-tanks pick up adds and stack them on boss.\n\nWhen boss teleports, let tank pick it up and then kill it.',
            image_url: 'https://placehold.co/1200x675?text=Noth+The+Plaguebringer',
            video_url: '',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755074097/16590_ezmekl.png',
            entries: []
          };
          container.appendChild(buildPanel(nothPanel, user, roster));
        }
        if (!hasHeigan) {
          const heiganPanel = {
            dungeon: 'Naxxramas',
            wing: 'Plague',
            boss: 'Heigan The Unclean',
            strategy_text: 'We can dance if we want to, we can leave your friends behind, cause your friends don\'t dance, and if they don\'t dance, well, they\'re no friends of mine.\n\nMelle stack behind tank and move perfectly. In dance phase, casters dance with melee.',
            image_url: 'https://placehold.co/1200x675?text=Heigan+The+Unclean',
            video_url: 'https://www.youtube.com/embed/dfSBp3Efjbk?controls=0&modestbranding=1&rel=0&iv_load_policy=3',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755075234/16309_kpg0jp.png',
            entries: []
          };
          container.appendChild(buildPanel(heiganPanel, user, roster));
        }
        if (!hasLoatheb) {
          const loathebPanel = {
            dungeon: 'Naxxramas',
            wing: 'Plague',
            boss: 'Loatheb',
            strategy_text: 'Pre-pop and use GSPP. Get a health stone. Use bandage if needed.\n\nHealers follow healing rotation and only heal main-tank. Stand in front of the boss and behind the tank. Don\'t use any holy spells (it will put your heal on cooldown)',
            image_url: 'https://placehold.co/1200x675?text=Loatheb',
            video_url: 'https://www.youtube.com/embed/_zwIx3uzoFI?controls=0&modestbranding=1&rel=0&iv_load_policy=3',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755080534/Fungal_monster_s0zutr.webp',
            entries: []
          };
          container.appendChild(buildPanel(loathebPanel, user, roster));
        }
      } else if (wing === 'abomination') {
        // Ensure Patchwerk, Grobbulus, Gluth and Thaddius panels are present even if not saved yet
        const hasPatch = toRender.some(p => String(p.boss || '').toLowerCase().includes('patch'));
        const hasGrobb = toRender.some(p => String(p.boss || '').toLowerCase().includes('grobb'));
        const hasGluth = toRender.some(p => String(p.boss || '').toLowerCase().includes('gluth'));
        const hasThadd = toRender.some(p => String(p.boss || '').toLowerCase().includes('thadd'));
        if (!hasPatch) {
          const patchPanel = {
            dungeon: 'Naxxramas',
            wing: 'Abomination',
            boss: 'Patchwerk',
            strategy_text: 'Tanks MUST stack perfectly. Top 3 on threat must be tanks. Melee DPS dip in slime to juke hateful strike. Healers spam consumes and keep tanks up. Heal only tanks.',
            image_url: 'https://placehold.co/1200x675?text=Patchwerk',
            video_url: 'https://www.youtube.com/embed/bmpVXEQYIcg',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755085582/patchwerk_wfd5z4.gif',
            entries: []
          };
          container.appendChild(buildPanel(patchPanel, user, roster));
        }
        if (!hasGrobb) {
          const grobbPanel = {
            dungeon: 'Naxxramas',
            wing: 'Abomination',
            boss: 'Grobbulus',
            strategy_text: "Boss must face away from raid. Don't dispel unless assigned. Melee stay at max range and cleve when slime is up. Drop slime pools at the edge of the room.",
            image_url: 'https://placehold.co/1200x675?text=Grobbulus',
            video_url: 'https://www.youtube.com/embed/WhqA3O6HIJk',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755086620/24792_gahise.png',
            entries: []
          };
          container.appendChild(buildPanel(grobbPanel, user, roster));
        }
        if (!hasGluth) {
          const gluthPanel = {
            dungeon: 'Naxxramas',
            wing: 'Abomination',
            boss: 'Gluth',
            strategy_text: 'Rotate tanks on healing debuff if needed. Kite adds far from Boss. No one raid heal. Only heal tanks. Mages help on adds with frost nova. Casters stay on max range to dodge fear. Hunters place slow trap for kiting. Shamans use Tremor if in melee and earth binding if in ranged group.',
            image_url: 'https://placehold.co/1200x675?text=Gluth',
            video_url: 'https://www.youtube.com/embed/JWf9-N609PA',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755087393/27103_rdbmzc.png',
            entries: []
          };
          container.appendChild(buildPanel(gluthPanel, user, roster));
        }
        if (!hasThadd) {
          const thaddPanel = {
            dungeon: 'Naxxramas',
            wing: 'Abomination',
            boss: 'Thaddius',
            strategy_text: 'Phase 1:\nOdd groups left - Even groups right. Kill adds at the same time. Casters max range. Off-tank taunt on tank swap.\n\nPhase 2:\nStack in front of boss. On Polarity Shift, Minus go left. Plus go right. Run trough the boss.\n\nNotes:\nPlus goes right\nMinus goes left\nMages, watch the ignite.',
            image_url: 'https://placehold.co/1200x675?text=Thaddius',
            video_url: 'https://www.youtube.com/embed/lgDJq4-i4kk',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755087787/dfka9xt-cbdf45c1-45b9-460b-a997-5a46c4de0a65_txsidf.png',
            entries: []
          };
          container.appendChild(buildPanel(thaddPanel, user, roster));
        }
      } else if (wing === 'frostwyrm_lair') {
        // Ensure Sapphiron and Kel'Thuzad panels are present even if not saved yet
        const hasSapph = toRender.some(p => String(p.boss || '').toLowerCase().includes('sapph'));
        const hasKel = toRender.some(p => String(p.boss || '').toLowerCase().includes('kel'));
        if (!hasSapph) {
          const sapphPanel = {
            dungeon: 'Naxxramas',
            wing: 'Frostwyrm_Lair',
            boss: 'Sapphiron',
            strategy_text: 'Positions & Pre-pop\nOdd groups left. Even groups right. Everyone pre-pop GFPP and GSPP when we unboon.\n\nLand phase\nMellee stand on max range. Avoid Blizzard and don\'t parry-haste the boss.\nCasters stack loosely for aoe healing and avoid Blizzard.\nShaman melee healers stand with your group so you can chain-heal yourself.\n\nAir phase\nSpread out in the half of the room towards the entrace of the room. When you get targeted for ice-block, pop a Greater Frost Protection Potion to stay alive.',
            image_url: 'https://placehold.co/1200x675?text=Sapphiron',
            video_url: 'https://www.youtube.com/embed/NwDFC6kFi7c',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755093137/oUwfSmi_mp74xg.gif',
            entries: []
          };
          container.appendChild(buildPanel(sapphPanel, user, roster));
        }
        if (!hasKel) {
          const kelPanel = {
            dungeon: 'Naxxramas',
            wing: 'Frostwyrm_Lair',
            boss: "Kel'Thuzad",
            strategy_text: "Phase 1\nDont't die. Don't multi shot. Stay in the circle. Kill adds fast. Prioritze shooting skellingtons over killing abos.\n\nPhase 2\nMelee stack perfectly on your marks and backpeddle out when ground gets black. Casters and healers spread out in the room.\n\nHealers, heal Frost Blast targets fast.\n\nPhase 3\nPriests, shackle adds BEFORE they get to the middle. Keep them shackled.",
            image_url: 'https://placehold.co/1200x675?text=Kel%5C%27Thuzad',
            video_url: 'https://www.youtube.com/embed/GUIftNHHKNs',
            boss_icon_url: 'https://res.cloudinary.com/duthjs0c3/image/upload/v1755109693/imgbin-heroes-of-the-storm-kel-thuzad-arthas-menethil-storm-za4EdhZSa9A2GBvAUf1Gi8t4q_qxel5s.jpg',
            entries: []
          };
          container.appendChild(buildPanel(kelPanel, user, roster));
        }
      }

    } catch (e) {
      container.innerHTML = '<div class="error-display"><div class="error-content"><h3>Error</h3><p>Failed to load assignments.</p></div></div>';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Ensure raid bar/nav wired
    if (typeof updateRaidBar === 'function') updateRaidBar();
    // Normalize URL: if we have an active event but current URL is not event-scoped, redirect
    try {
      const parts = window.location.pathname.split('/').filter(Boolean);
      const isEventScoped = parts.includes('event') && parts[parts.indexOf('event') + 1];
      const isAssignmentsPage = parts.includes('assignments');
      const activeId = getActiveEventId();
      if (!isEventScoped && isAssignmentsPage && activeId) {
        const wing = getCurrentWing();
        const wingPath = wing && wing !== 'main' ? `/${wing}` : '';
        window.location.replace(`/event/${activeId}/assignments${wingPath}`);
        return;
      }
    } catch {}
    initializeFloatingNavigation();
    // Tag body for main page only
    try { if (getCurrentWing() === 'main') document.body.classList.add('assignments-main'); } catch {}
    loadAssignments();
  });
})();


