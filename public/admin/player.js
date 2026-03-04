/**
 * Admin Player Profile — Data loading, rendering, and interaction logic.
 *
 * Fetches aggregated player data from GET /api/admin/player/:discordId
 * and renders each section of the profile page. Requires management role.
 *
 * @see /admin/player.html for the HTML structure
 */

(function () {
  'use strict';

  // ── Globals ───────────────────────────────────────────────────────────
  let playerData = null;
  let currentUser = null;
  let raidHistorySortCol = 'eventDate';
  let raidHistorySortDir = 'desc';

  // Extract Discord ID from the URL path: /admin/player/:discordId
  const pathParts = window.location.pathname.split('/');
  const discordId = pathParts[pathParts.length - 1];

  // ── WoW class color map ───────────────────────────────────────────────
  const CLASS_COLORS = {
    warrior: '#C79C6E', paladin: '#F58CBA', hunter: '#ABD473',
    rogue: '#FFF569', priest: '#FFFFFF', shaman: '#0070DE',
    mage: '#69CCF0', warlock: '#9482C9', druid: '#FF7D0A',
    'death knight': '#C41F3B'
  };

  /**
   * Light-theme fallback colors for classes whose default color is too
   * bright to read on a white/light background (Priest, Rogue).
   * Used only when the page is NOT in dark mode.
   */
  const CLASS_COLORS_LIGHT = {
    priest: '#AAAAAA',
    rogue: '#D4B200'
  };

  /**
   * Lookup map: lowercase character name → WoW class string.
   * Built once from playerData.characters in buildCharNameLookup().
   * @type {Map<string, string>}
   */
  var charNameToClass = new Map();

  /**
   * Populate the charNameToClass lookup from playerData.characters.
   * Must be called after playerData is loaded.
   */
  function buildCharNameLookup() {
    charNameToClass = new Map();
    if (!playerData || !playerData.characters) return;
    playerData.characters.forEach(function (c) {
      if (c.characterName && c.class) {
        charNameToClass.set(c.characterName.toLowerCase(), c.class.toLowerCase());
      }
    });
  }

  /**
   * Detect whether dark mode is currently active.
   * Checks for the .dark class on <html> or the prefers-color-scheme media query.
   * @returns {boolean}
   */
  function isDarkMode() {
    return document.documentElement.classList.contains('dark') ||
      (!localStorage.getItem('admin-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /**
   * Wrap a character name in a <span> with the appropriate WoW class color.
   * Falls back to uncolored escaped text if the character is not in the lookup.
   * Uses esc() for XSS safety on the name text content.
   *
   * @param {string} name - The character name to colorize
   * @returns {string} HTML string with colored span (or plain escaped text)
   */
  function classColorSpan(name) {
    if (!name) return esc(name);
    var cls = charNameToClass.get(name.toLowerCase());
    if (!cls) return esc(name);

    var color = CLASS_COLORS[cls];
    if (!color) return esc(name);

    // In light mode, swap to readable fallback for very bright class colors
    if (!isDarkMode() && CLASS_COLORS_LIGHT[cls]) {
      color = CLASS_COLORS_LIGHT[cls];
    }

    return '<span class="class-color-text" style="color:' + color + ';font-weight:600">' + esc(name) + '</span>';
  }

  /** Return a CSS class string for a WoW class name */
  function classSlug(className) {
    if (!className) return '';
    return 'class-' + className.toLowerCase().replace(/\s+/g, '-');
  }

  /** Format a date string for display */
  function fmtDate(d) {
    if (!d) return 'N/A';
    try {
      const date = new Date(d);
      return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) { return String(d); }
  }

  /** Format a date string with time */
  function fmtDateTime(d) {
    if (!d) return 'N/A';
    try {
      const date = new Date(d);
      return date.toLocaleDateString('en-GB', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) { return String(d); }
  }

  /** Format a number with thousands separator */
  function fmtNum(n) {
    if (n == null) return 'N/A';
    return Number(n).toLocaleString('en-US');
  }

  /** Escape HTML to prevent XSS */
  function esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ── Collapse toggle ───────────────────────────────────────────────────
  window.toggleSection = function (headerEl) {
    headerEl.closest('.section').classList.toggle('collapsed');
  };

  // ── Auth check & data fetch ───────────────────────────────────────────
  async function init() {
    try {
      const userResp = await fetch('/user');
      if (!userResp.ok) {
        window.location.href = '/';
        return;
      }
      currentUser = await userResp.json();
      if (!currentUser.hasManagementRole) {
        window.location.href = '/';
        return;
      }

    } catch (_) {
      window.location.href = '/';
      return;
    }

    // Signal to Maya chat panel (second IIFE) that auth is ready.
    // Placed outside the auth try-catch so any socket init errors
    // in the event listener won't trigger a redirect to home.
    window.dispatchEvent(new CustomEvent('maya-admin-ready', {
      detail: { userId: currentUser.id }
    }));

    try {
      const resp = await fetch('/api/admin/player/' + encodeURIComponent(discordId));
      if (!resp.ok) {
        throw new Error('API returned ' + resp.status);
      }
      playerData = await resp.json();
      if (!playerData.success) {
        throw new Error(playerData.message || 'Unknown error');
      }

      document.getElementById('loading').style.display = 'none';
      document.getElementById('content').style.display = 'block';

      // Build character-name-to-class lookup for class-colored text
      buildCharNameLookup();

      renderIdentity();
      renderStats();
      animateStatValues();
      renderRoles();
      renderCharacters();
      renderMemberEvents();
      renderRaidHistory();
      renderLoot();
      renderManualRewards();
      renderRewardPoints();
      renderWorldBuffs();
      renderFrostRes();
      renderAssignments();
      renderPollVotes();

      document.title = (playerData.identity.username || discordId) + ' — Player Profile';

      // Update Maya notes panel header with player name
      var notesNameEl = document.getElementById('maya-notes-player-name');
      if (notesNameEl) notesNameEl.textContent = playerData.identity.username || discordId;
    } catch (err) {
      document.getElementById('loading').innerHTML =
        '<div style="color:var(--danger)"><i class="fas fa-exclamation-triangle"></i></div>' +
        '<div>Error loading player data: ' + esc(err.message) + '</div>';
    }
  }

  // ── Render: Identity Header ───────────────────────────────────────────
  function renderIdentity() {
    const id = playerData.identity;
    const avatarUrl = id.avatar
      ? 'https://cdn.discordapp.com/avatars/' + id.discordId + '/' + id.avatar + '.png?size=128'
      : 'https://cdn.discordapp.com/embed/avatars/0.png';

    document.getElementById('identity-header').innerHTML =
      '<img class="avatar" src="' + esc(avatarUrl) + '" alt="Avatar" onerror="this.src=\'https://cdn.discordapp.com/embed/avatars/0.png\'">' +
      '<div class="info">' +
        '<h1>' + esc(id.username || 'Unknown User') + '</h1>' +
        '<div class="meta">' +
          '<span><i class="fab fa-discord"></i> ' + esc(id.discordId) + '</span>' +
          (id.email ? '<span><i class="fas fa-envelope"></i> ' + esc(id.email) + '</span>' : '') +
          (id.authProvider ? '<span><i class="fas fa-key"></i> ' + esc(id.authProvider) + '</span>' : '') +
        '</div>' +
        '<div class="meta" style="margin-top:4px">' +
          '<span>First login: ' + fmtDate(id.firstLogin) + '</span>' +
          '<span>Last login: ' + fmtDate(id.lastLogin) + '</span>' +
        '</div>' +
      '</div>';
  }

  // ── Render: Stats ─────────────────────────────────────────────────────
  function renderStats() {
    const s = playerData.stats;
    const cards = [
      { label: 'Raids Attended', value: fmtNum(s.totalRaids), icon: 'fa-dungeon' },
      { label: 'Attendance Rate', value: s.attendanceRate != null ? s.attendanceRate + '%' : 'N/A', icon: 'fa-chart-line' },
      { label: 'Gold Earned', value: fmtNum(s.totalGoldEarned) + 'g', icon: 'fa-hand-holding-usd' },
      { label: 'Gold Spent', value: fmtNum(s.totalGoldSpent) + 'g', icon: 'fa-coins' },
      { label: 'Reward Points', value: fmtNum(s.totalRewardPoints), icon: 'fa-star' },
      { label: 'Avg DPS', value: s.avgDPS != null ? fmtNum(s.avgDPS) : 'N/A', icon: 'fa-sword' },
      { label: 'Avg HPS', value: s.avgHPS != null ? fmtNum(s.avgHPS) : 'N/A', icon: 'fa-heart' },
    ];

    document.getElementById('stats-grid').innerHTML = cards.map(function (c) {
      return '<div class="stat-card">' +
        '<div class="stat-value">' + c.value + '</div>' +
        '<div class="stat-label"><i class="fas ' + c.icon + '"></i> ' + esc(c.label) + '</div>' +
      '</div>';
    }).join('');
  }

  // ── Render: Roles ─────────────────────────────────────────────────────
  function renderRoles() {
    const r = playerData.roles;
    let html = '';

    // Guild rank
    if (r.guildRankName) {
      html += '<div style="margin-bottom:12px"><strong>Guild Rank:</strong> ' + esc(r.guildRankName);
      if (r.promoDate) html += ' <span style="color:var(--muted);font-size:0.85em">(promo: ' + esc(r.promoDate) + ')</span>';
      html += '</div>';
    }

    // Current roles
    html += '<div style="margin-bottom:8px"><strong>App Roles:</strong></div>';
    if (r.current.length === 0) {
      html += '<div class="no-data">No app roles assigned</div>';
    } else {
      html += '<div id="role-badges">';
      r.current.forEach(function (role) {
        html += '<span class="role-badge">' + esc(role.role_key) +
          ' <i class="fas fa-times revoke-btn" title="Revoke" onclick="revokeRole(\'' + esc(role.role_key) + '\')"></i>' +
        '</span>';
      });
      html += '</div>';
    }

    // Grant form
    html += '<div class="grant-form">' +
      '<select id="grant-role-select">' +
        '<option value="management">management</option>' +
        '<option value="raidleader">raidleader</option>' +
        '<option value="officer">officer</option>' +
      '</select>' +
      '<button onclick="grantRole()"><i class="fas fa-plus"></i> Grant Role</button>' +
    '</div>';

    // Role audit log
    if (r.audit && r.audit.length > 0) {
      html += '<div style="margin-top:16px"><strong>Role History:</strong></div>';
      html += '<table class="data-table" style="margin-top:8px"><thead><tr>' +
        '<th>Action</th><th>Role</th><th>By</th><th>Date</th>' +
      '</tr></thead><tbody>';
      r.audit.forEach(function (a) {
        html += '<tr><td>' + esc(a.action) + '</td><td>' + esc(a.role_key) + '</td>' +
          '<td>' + esc(a.actor_discord_id || 'system') + '</td>' +
          '<td>' + fmtDateTime(a.created_at) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    document.getElementById('roles-body').innerHTML = html;
  }

  // Role grant/revoke
  window.grantRole = async function () {
    const roleKey = document.getElementById('grant-role-select').value;
    try {
      const resp = await fetch('/api/management/app-roles/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: discordId, roleKey: roleKey })
      });
      if (resp.ok) {
        window.location.reload();
      } else {
        alert('Failed to grant role');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  window.revokeRole = async function (roleKey) {
    if (!confirm('Revoke role "' + roleKey + '"?')) return;
    try {
      const resp = await fetch('/api/management/app-roles/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: discordId, roleKey: roleKey })
      });
      if (resp.ok) {
        window.location.reload();
      } else {
        alert('Failed to revoke role');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // ── Render: Characters ────────────────────────────────────────────────
  /**
   * Determine whether a hex color needs dark text for readability.
   * Uses relative luminance formula; returns true for light backgrounds.
   */
  function needsDarkText(hex) {
    if (!hex) return false;
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16) / 255;
    var g = parseInt(h.substring(2, 4), 16) / 255;
    var b = parseInt(h.substring(4, 6), 16) / 255;
    // sRGB linearization
    r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    var luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.4;
  }

  // Class role definitions for DPS/HPS display
  var DAMAGE_CLASSES = ['rogue', 'warrior', 'hunter', 'mage', 'warlock'];
  var HEALING_CLASSES = ['priest', 'druid', 'shaman'];

  function renderCharacters() {
    var chars = playerData.characters;
    if (!chars || chars.length === 0) {
      document.getElementById('characters-body').innerHTML = '<div class="no-data">No characters found</div>';
      return;
    }

    var charStats = playerData.characterStats || {};

    document.getElementById('characters-body').innerHTML =
      '<div class="characters-grid">' +
      chars.map(function (c) {
        var slug = classSlug(c.class);
        var guildBadge = c.inGuild === false ? ' <span class="not-in-guild">Not in Guild</span>' : '';
        var classColor = CLASS_COLORS[(c.class || '').toLowerCase()] || '#888';
        var textColor = needsDarkText(classColor) ? '#1a1a2e' : '#fff';
        var classLower = (c.class || '').toLowerCase();
        var stats = charStats[c.characterName.toLowerCase()] || {};

        // Build DPS/HPS row based on class role
        var dpsHpsRow = '';
        if (DAMAGE_CLASSES.indexOf(classLower) !== -1 && stats.avgDps > 0) {
          dpsHpsRow = '<div class="detail-row"><span>Avg DPS</span><strong>' + fmtNum(stats.avgDps) + '</strong></div>';
        } else if (HEALING_CLASSES.indexOf(classLower) !== -1 && stats.avgHps > 0) {
          dpsHpsRow = '<div class="detail-row"><span>Avg HPS</span><strong>' + fmtNum(stats.avgHps) + '</strong></div>';
        }

        return '<div class="char-card ' + slug + '">' +
          '<div class="char-card-header" style="background-color:' + classColor + ';color:' + textColor + '">' +
            esc(c.characterName) + guildBadge +
          '</div>' +
          '<div class="detail-row"><span>Race</span><strong>' + esc(c.race || 'Unknown') + '</strong></div>' +
          '<div class="detail-row"><span>Level</span><strong>' + (c.level || '?') + '</strong></div>' +
          '<div class="detail-row"><span>Faction</span><strong>' + esc(c.faction || 'Unknown') + '</strong></div>' +
          (c.specName ? '<div class="detail-row"><span>Spec</span><strong>' + esc(c.specName) + '</strong></div>' : '') +
          (c.primaryRole ? '<div class="detail-row"><span>Role</span><strong>' + esc(c.primaryRole) + '</strong></div>' : '') +
          (c.mainAlt ? '<div class="detail-row"><span>Main/Alt</span><strong>' + esc(c.mainAlt) + '</strong></div>' : '') +
          dpsHpsRow +
          '<div class="detail-row"><span>Joined</span><strong>' + esc(c.joinDate || 'N/A') + '</strong></div>' +
          (c.lastOnlineDays != null ? '<div class="detail-row"><span>Last Online</span><strong>' +
            (c.lastOnlineDays < 1 ? 'Online' : Math.floor(c.lastOnlineDays) + 'd ago') + '</strong></div>' : '') +
          // Editable notes
          noteField('Public Note', 'public_note', c.publicNote, c.characterName, c.class) +
          noteField('Officer Note', 'officer_note', c.officerNote, c.characterName, c.class) +
          noteField('Custom Note', 'custom_note', c.customNote, c.characterName, c.class) +
        '</div>';
      }).join('') +
      '</div>';
  }

  /** Build an editable note textarea */
  function noteField(label, fieldName, value, charName, charClass) {
    var id = 'note-' + fieldName + '-' + charName.replace(/\W/g, '_');
    return '<div class="note-label">' + esc(label) +
      '<span class="note-saved" id="saved-' + id + '">✓ saved</span></div>' +
      '<textarea class="note-field" id="' + id + '" ' +
      'data-field="' + fieldName + '" ' +
      'data-char="' + esc(charName) + '" ' +
      'data-class="' + esc(charClass) + '" ' +
      'onblur="saveNote(this)">' + esc(value || '') + '</textarea>';
  }

  /** Save note on blur */
  window.saveNote = async function (el) {
    var field = el.getAttribute('data-field');
    var charName = el.getAttribute('data-char');
    var charClass = el.getAttribute('data-class');
    var value = el.value;

    try {
      var resp = await fetch('/api/admin/player/' + encodeURIComponent(discordId) + '/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterName: charName,
          className: charClass,
          field: field,
          value: value
        })
      });
      if (resp.ok) {
        var savedEl = document.getElementById('saved-' + el.id);
        if (savedEl) {
          savedEl.classList.add('visible');
          setTimeout(function () { savedEl.classList.remove('visible'); }, 2000);
        }
      }
    } catch (_) {
      /* Silent fail — note will save on next blur */
    }
  };

  // ── Render: Member Events ─────────────────────────────────────────────
  function renderMemberEvents() {
    var events = playerData.memberEvents;
    if (!events || events.length === 0) {
      document.getElementById('member-events-body').innerHTML = '<div class="no-data">No member events recorded</div>';
      return;
    }

    document.getElementById('member-events-body').innerHTML =
      '<div class="timeline">' +
      events.map(function (e) {
        return '<div class="timeline-item">' +
          '<span class="event-type">' + esc(e.event_type) + '</span> ' +
          (e.username ? '(' + esc(e.username) + ')' : '') +
          '<div class="event-date">' + fmtDateTime(e.created_at) + '</div>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  // ── Render: Raid History (sortable) ───────────────────────────────────
  function renderRaidHistory() {
    var raids = playerData.raidHistory;
    if (!raids || raids.length === 0) {
      document.getElementById('raid-history-body').innerHTML = '<div class="no-data">No raid history</div>';
      return;
    }

    // Enrich raid rows with per-event gold for sorting
    var enriched = raids.map(function (r) {
      var copy = Object.assign({}, r);
      copy.goldEarned = (playerData.goldEarnedByEvent && playerData.goldEarnedByEvent[r.eventId]) || 0;
      copy.goldSpent = (playerData.goldSpentByEvent && playerData.goldSpentByEvent[r.eventId]) || 0;
      return copy;
    });

    // Sort
    var sorted = enriched.slice().sort(function (a, b) {
      var aVal = a[raidHistorySortCol];
      var bVal = b[raidHistorySortCol];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return raidHistorySortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      var aStr = String(aVal).toLowerCase();
      var bStr = String(bVal).toLowerCase();
      if (raidHistorySortDir === 'asc') return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
      return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
    });

    function sortIcon(col) {
      if (raidHistorySortCol !== col) return '';
      return raidHistorySortDir === 'asc' ? ' <i class="fas fa-sort-up"></i>' : ' <i class="fas fa-sort-down"></i>';
    }

    var html = '<div style="overflow-x:auto"><table class="data-table"><thead><tr>' +
      '<th onclick="sortRaidHistory(\'eventDate\')">Date' + sortIcon('eventDate') + '</th>' +
      '<th onclick="sortRaidHistory(\'eventName\')">Event' + sortIcon('eventName') + '</th>' +
      '<th onclick="sortRaidHistory(\'characterUsed\')">Character' + sortIcon('characterUsed') + '</th>' +
      '<th onclick="sortRaidHistory(\'damageDealt\')">Damage' + sortIcon('damageDealt') + '</th>' +
      '<th onclick="sortRaidHistory(\'healingDone\')">Healing' + sortIcon('healingDone') + '</th>' +
      '<th>Spec</th>' +
      '<th onclick="sortRaidHistory(\'goldEarned\')">Gold Earned' + sortIcon('goldEarned') + '</th>' +
      '<th onclick="sortRaidHistory(\'goldSpent\')">Gold Spent' + sortIcon('goldSpent') + '</th>' +
      '<th>Links</th>' +
    '</tr></thead><tbody>';

    sorted.forEach(function (r) {
      var earnedVal = playerData.goldEarnedByEvent ? playerData.goldEarnedByEvent[r.eventId] : null;
      var spentVal = playerData.goldSpentByEvent ? playerData.goldSpentByEvent[r.eventId] : null;

      // Build links cell: raidlogs (always) + WCL (conditional)
      var linksHtml = '<a href="/event/' + encodeURIComponent(r.eventId) + '/raidlogs" target="_blank" class="wcl-link" title="Raid Logs"><i class="fas fa-scroll"></i></a>';
      if (r.wclLogLink) {
        linksHtml += ' <a href="' + esc(r.wclLogLink) + '" target="_blank" class="wcl-link" title="Warcraft Logs" style="margin-left:8px"><i class="fas fa-external-link-alt"></i></a>';
      }

      html += '<tr>' +
        '<td>' + fmtDate(r.eventDate) + '</td>' +
        '<td>' + esc(r.eventName || r.eventId) + '</td>' +
        '<td>' + (r.characterUsed ? classColorSpan(r.characterUsed) : '-') + '</td>' +
        '<td>' + (r.damageDealt != null ? fmtNum(r.damageDealt) : '-') + '</td>' +
        '<td>' + (r.healingDone != null ? fmtNum(r.healingDone) : '-') + '</td>' +
        '<td>' + esc(r.specName || '-') + '</td>' +
        '<td style="color:var(--success);font-weight:600">' + (earnedVal ? fmtNum(earnedVal) + 'g' : '-') + '</td>' +
        '<td style="color:var(--warning);font-weight:600">' + (spentVal ? fmtNum(spentVal) + 'g' : '-') + '</td>' +
        '<td>' + linksHtml + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    document.getElementById('raid-history-body').innerHTML = html;
  }

  window.sortRaidHistory = function (col) {
    if (raidHistorySortCol === col) {
      raidHistorySortDir = raidHistorySortDir === 'asc' ? 'desc' : 'asc';
    } else {
      raidHistorySortCol = col;
      raidHistorySortDir = 'desc';
    }
    renderRaidHistory();
  };

  // ── Render: Loot ──────────────────────────────────────────────────────
  function renderLoot() {
    var loot = playerData.loot;
    if (!loot || !loot.items || loot.items.length === 0) {
      document.getElementById('loot-body').innerHTML =
        '<div>Total Gold Spent: <strong>0g</strong></div>' +
        '<div class="no-data">No loot history</div>';
      return;
    }

    var html = '<div style="margin-bottom:12px;font-size:1.1em">Total Gold Spent: <strong style="color:var(--warning)">' + fmtNum(loot.totalGoldSpent) + 'g</strong></div>';
    html += '<div style="overflow-x:auto"><table class="data-table"><thead><tr>' +
      '<th>Item</th><th>Gold</th><th>Event</th><th>Date</th>' +
    '</tr></thead><tbody>';

    loot.items.forEach(function (item) {
      var icon = item.iconLink ? '<img class="item-icon" src="' + esc(item.iconLink) + '" onerror="this.style.display=\'none\'">' : '';
      var nameHtml = item.wowheadLink
        ? '<a href="' + esc(item.wowheadLink) + '" target="_blank" class="item-link">' + icon + esc(item.itemName) + '</a>'
        : icon + esc(item.itemName);

      html += '<tr>' +
        '<td>' + nameHtml + '</td>' +
        '<td style="color:var(--warning);font-weight:600">' + fmtNum(item.goldAmount) + 'g</td>' +
        '<td>' + esc(item.eventId || '-') + '</td>' +
        '<td>' + fmtDate(item.createdAt) + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    document.getElementById('loot-body').innerHTML = html;
  }

  // ── Render: Manual Rewards ────────────────────────────────────────────
  function renderManualRewards() {
    var rewards = playerData.manualRewards;
    if (!rewards || rewards.length === 0) {
      document.getElementById('manual-rewards-body').innerHTML = '<div class="no-data">No manual rewards or deductions</div>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Description</th><th>Points</th><th>Type</th><th>Created By</th><th>Event</th><th>Date</th>' +
    '</tr></thead><tbody>';

    rewards.forEach(function (r) {
      html += '<tr>' +
        '<td>' + (r.iconUrl ? '<img class="item-icon" src="' + esc(r.iconUrl) + '" onerror="this.style.display=\'none\'">' : '') + esc(r.description) + '</td>' +
        '<td style="font-weight:600;color:' + (r.points >= 0 ? 'var(--success)' : 'var(--danger)') + '">' + r.points + '</td>' +
        '<td>' + (r.isGold ? '<i class="fas fa-coins" style="color:var(--warning)"></i> Gold' : 'Points') + '</td>' +
        '<td>' + esc(r.createdBy || '-') + '</td>' +
        '<td>' + esc(r.eventId || '-') + '</td>' +
        '<td>' + fmtDate(r.createdAt) + '</td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('manual-rewards-body').innerHTML = html;
  }

  // ── Render: Reward Points History ─────────────────────────────────────
  function renderRewardPoints() {
    var rp = playerData.rewardPoints;
    if (!rp || !rp.byEvent || rp.byEvent.length === 0) {
      document.getElementById('reward-points-body').innerHTML =
        '<div>Total Points: <strong>' + fmtNum(rp ? rp.totalPoints : 0) + '</strong></div>' +
        '<div class="no-data">No reward points history</div>';
      return;
    }

    var html = '<div style="margin-bottom:12px;font-size:1.1em">Total Points: <strong style="color:var(--accent)">' + fmtNum(rp.totalPoints) + '</strong></div>';
    html += '<table class="data-table"><thead><tr>' +
      '<th>Event</th><th>Panel</th><th>Rank</th><th>Original Pts</th><th>Edited Pts</th><th>Edited By</th>' +
    '</tr></thead><tbody>';

    rp.byEvent.forEach(function (r) {
      html += '<tr>' +
        '<td>' + esc(r.eventId) + '</td>' +
        '<td>' + esc(r.panelName || '-') + '</td>' +
        '<td>' + (r.rankingOriginal != null ? '#' + r.rankingOriginal : '-') + '</td>' +
        '<td>' + (r.pointsOriginal != null ? r.pointsOriginal : '-') + '</td>' +
        '<td>' + (r.pointsEdited != null ? '<strong>' + r.pointsEdited + '</strong>' : '-') + '</td>' +
        '<td>' + esc(r.editedBy || '-') + '</td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('reward-points-body').innerHTML = html;
  }

  // ── Render: World Buffs (grouped by event, buff columns) ─────────────
  function renderWorldBuffs() {
    var buffs = playerData.worldBuffs;
    if (!buffs || buffs.length === 0) {
      document.getElementById('world-buffs-body').innerHTML = '<div class="no-data">No world buff data</div>';
      return;
    }

    // Group by eventId -> characterName -> { buffName: { value, colorStatus } }
    var eventMap = {};   // eventId -> { chars: { charName -> { buffName -> { value, colorStatus } } } }
    var allBuffNames = [];
    var buffNameSet = {};
    // Track percentage info per buff name (from amount_summary/score_summary)
    var buffPctMap = {};

    buffs.forEach(function (b) {
      if (!eventMap[b.eventId]) eventMap[b.eventId] = {};
      if (!eventMap[b.eventId][b.characterName]) eventMap[b.eventId][b.characterName] = {};
      eventMap[b.eventId][b.characterName][b.buffName] = {
        value: b.buffValue,
        colorStatus: b.colorStatus
      };
      if (!buffNameSet[b.buffName]) {
        buffNameSet[b.buffName] = true;
        allBuffNames.push(b.buffName);
      }
      // Capture percentage from amount_summary or score_summary (first non-null wins)
      if (b.buffName && !buffPctMap[b.buffName]) {
        var pct = b.scoreSummary || b.amountSummary;
        if (pct) buffPctMap[b.buffName] = pct;
      }
    });

    // Build column headers: Event | Character | [Buff1] | [Buff2] | ...
    var html = '<div style="overflow-x:auto"><table class="data-table"><thead><tr>' +
      '<th>Event</th><th>Character</th>';
    allBuffNames.forEach(function (bn) {
      var pct = buffPctMap[bn] ? ' (' + esc(buffPctMap[bn]) + ')' : '';
      html += '<th>' + esc(bn) + pct + '</th>';
    });
    html += '</tr></thead><tbody>';

    // Render rows grouped by event
    var eventIds = Object.keys(eventMap);
    eventIds.forEach(function (eventId) {
      var chars = eventMap[eventId];
      var charNames = Object.keys(chars);
      charNames.forEach(function (charName, idx) {
        html += '<tr>';
        // Merge event cell for first character row
        if (idx === 0) {
          html += '<td' + (charNames.length > 1 ? ' rowspan="' + charNames.length + '"' : '') +
            ' style="vertical-align:middle;font-weight:600">' + esc(eventId) + '</td>';
        }
        html += '<td>' + classColorSpan(charName) + '</td>';
        allBuffNames.forEach(function (bn) {
          var buffData = chars[charName][bn];
          if (buffData) {
            var cls = '';
            if (buffData.colorStatus) {
              var cs = buffData.colorStatus.toLowerCase();
              if (cs.includes('green')) cls = 'buff-green';
              else if (cs.includes('yellow') || cs.includes('orange')) cls = 'buff-yellow';
              else if (cs.includes('red')) cls = 'buff-red';
            }
            html += '<td><span class="buff-cell ' + cls + '">' + esc(buffData.value || '-') + '</span></td>';
          } else {
            html += '<td>-</td>';
          }
        });
        html += '</tr>';
      });
    });

    html += '</tbody></table></div>';
    document.getElementById('world-buffs-body').innerHTML = html;
  }

  // ── Render: Frost Resistance ──────────────────────────────────────────
  function renderFrostRes() {
    var frost = playerData.frostRes;
    if (!frost || frost.length === 0) {
      document.getElementById('frost-res-body').innerHTML = '<div class="no-data">No frost resistance data</div>';
      return;
    }

    var rate = playerData.stats.frostResComplianceRate;
    var html = '';
    if (rate != null) {
      html += '<div style="margin-bottom:12px">Compliance (≥100 FR): <strong>' + rate + '%</strong>' +
        '<div class="progress-bar"><div class="fill" style="width:' + rate + '%;background:' + (rate >= 80 ? 'var(--success)' : rate >= 50 ? 'var(--warning)' : 'var(--danger)') + '"></div></div></div>';
    }

    html += '<table class="data-table"><thead><tr>' +
      '<th>Event</th><th>Character</th><th>Frost Resistance</th><th>Status</th>' +
    '</tr></thead><tbody>';

    frost.forEach(function (f) {
      var frVal = parseInt(f.frostResistance, 10);
      var ok = frVal >= 100;
      html += '<tr>' +
        '<td>' + esc(f.eventId) + '</td>' +
        '<td>' + classColorSpan(f.characterName) + '</td>' +
        '<td style="font-weight:600">' + esc(f.frostResistance) + '</td>' +
        '<td>' + (ok
          ? '<i class="fas fa-check-circle status-accepted"></i> OK'
          : '<i class="fas fa-times-circle status-declined"></i> Below threshold') + '</td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('frost-res-body').innerHTML = html;
  }

  // ── Render: Raid Assignments ──────────────────────────────────────────
  function renderAssignments() {
    var assigns = playerData.assignments;
    if (!assigns || assigns.length === 0) {
      document.getElementById('assignments-body').innerHTML = '<div class="no-data">No raid assignments</div>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Event</th><th>Boss</th><th>Assignment</th><th>Character</th><th>Status</th>' +
    '</tr></thead><tbody>';

    assigns.forEach(function (a) {
      var statusHtml = '-';
      if (a.acceptStatus) {
        var s = a.acceptStatus.toLowerCase();
        if (s === 'accepted' || s === 'accept') statusHtml = '<span class="status-accepted"><i class="fas fa-check"></i> Accepted</span>';
        else if (s === 'declined' || s === 'decline') statusHtml = '<span class="status-declined"><i class="fas fa-times"></i> Declined</span>';
        else statusHtml = '<span class="status-pending"><i class="fas fa-clock"></i> ' + esc(a.acceptStatus) + '</span>';
      }

      html += '<tr>' +
        '<td>' + esc(a.eventId) + '</td>' +
        '<td>' + esc(a.boss) + '</td>' +
        '<td>' + esc(a.assignment || '-') + '</td>' +
        '<td>' + classColorSpan(a.characterName) + '</td>' +
        '<td>' + statusHtml + '</td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('assignments-body').innerHTML = html;
  }

  // ── Render: Poll Votes ────────────────────────────────────────────────
  function renderPollVotes() {
    var votes = playerData.pollVotes;
    if (!votes || votes.length === 0) {
      document.getElementById('poll-votes-body').innerHTML = '<div class="no-data">No poll votes</div>';
      return;
    }

    var html = '<table class="data-table"><thead><tr>' +
      '<th>Poll</th><th>Question</th><th>Choice</th><th>Voted At</th>' +
    '</tr></thead><tbody>';

    votes.forEach(function (v) {
      html += '<tr>' +
        '<td>' + esc(v.pollId) + '</td>' +
        '<td>' + esc(v.question || '-') + '</td>' +
        '<td><strong>' + esc(v.optionText || v.optionKey) + '</strong></td>' +
        '<td>' + fmtDateTime(v.votedAt) + '</td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    document.getElementById('poll-votes-body').innerHTML = html;
  }

  // ── Count-up animation for stat values ─────────────────────────────────
  /**
   * Animate stat-value elements from ~90% to their final numeric value.
   * Handles suffixes (g, %), thousand separators, and skips non-numeric values.
   * Uses requestAnimationFrame with cubic ease-out over 800ms.
   */
  function animateStatValues() {
    var DURATION = 800;
    var elements = document.querySelectorAll('.stat-value');

    elements.forEach(function (el) {
      var raw = el.textContent.trim();

      // Extract numeric portion and suffix (e.g. "1,234g" → 1234, "g")
      var match = raw.match(/^([\d,]+(?:\.\d+)?)\s*(%|g)?$/);
      if (!match) return; // Skip non-numeric values like "N/A"

      var numStr = match[1].replace(/,/g, '');
      var finalValue = parseFloat(numStr);
      if (isNaN(finalValue) || finalValue === 0) return;

      var suffix = match[2] || '';
      var isInteger = numStr.indexOf('.') === -1;
      var startValue = Math.floor(finalValue * 0.9);

      var startTime = null;
      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        var elapsed = timestamp - startTime;
        var t = Math.min(elapsed / DURATION, 1);

        // Cubic ease-out: 1 - (1 - t)^3
        var eased = 1 - Math.pow(1 - t, 3);
        var current = startValue + (finalValue - startValue) * eased;

        if (isInteger) {
          current = Math.round(current);
        } else {
          current = Math.round(current * 10) / 10;
        }

        el.textContent = current.toLocaleString('en-US') + suffix;

        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          // Ensure final value is exact
          el.textContent = (isInteger ? finalValue : finalValue).toLocaleString('en-US') + suffix;
        }
      }

      requestAnimationFrame(step);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────
  init();
})();

// ════════════════════════════════════════════════════════════════════════
// Maya Chat Panel — Player Profile Integration
// ════════════════════════════════════════════════════════════════════════

(function() {
  // Extract discord ID from URL
  var pathParts = window.location.pathname.split('/');
  var discordId = pathParts[pathParts.length - 1];
  if (!discordId || !/^[0-9]{1,20}$/.test(discordId)) return;

  var currentConversation = null;
  var mayaSocket = null;

  /**
   * Initialize Socket.IO for real-time Maya updates.
   * Must be called after currentUser is populated (from init()).
   * @param {string} userId - Discord ID of the authenticated admin user
   */
  function initMayaSocket(userId) {
    if (typeof io === 'undefined') return;
    if (!userId) return;
    try {
      mayaSocket = io('/maya-admin', {
        auth: { userId: userId },
        transports: ['websocket', 'polling']
      });

      mayaSocket.on('maya:message', function(data) {
        if (currentConversation && data.conversationId === currentConversation.id) {
          appendMessage(data.role, data.content, data.sentAt);
          scrollMessages();
        }
      });

      mayaSocket.on('maya:typing', function(data) {
        if (currentConversation && data.conversationId === currentConversation.id) {
          var indicator = document.getElementById('maya-typing-indicator');
          if (indicator) indicator.style.display = data.typing ? 'block' : 'none';
        }
      });

      mayaSocket.on('maya:status', function(data) {
        if (currentConversation && data.conversationId === currentConversation.id) {
          loadMayaChat();
        }
      });

      mayaSocket.on('connect_error', function(err) {
        console.warn('[maya-admin] Socket connection failed:', err.message);
      });
    } catch (e) {
      // Socket.IO not available
    }
  }

  /**
   * Sets the toggle switch visual state and updates input/button visibility.
   * @param {boolean} isManual - true for Manual mode, false for AI mode
   */
  function setToggleState(isManual) {
    var track = document.getElementById('maya-toggle-track');
    var label = document.getElementById('maya-toggle-label');
    var input = document.getElementById('maya-message-input');
    var takeoverBtn = document.getElementById('maya-takeover-btn');

    if (isManual) {
      track.classList.add('manual');
      label.textContent = 'Manual Mode';
      input.disabled = false;
      input.style.opacity = '1';
      takeoverBtn.style.display = '';
    } else {
      track.classList.remove('manual');
      label.textContent = 'AI Mode';
      input.disabled = true;
      input.style.opacity = '0.5';
      takeoverBtn.style.display = 'none';
    }
  }

  /** Load Maya conversation for this player (Fix 1: only show active/paused) */
  function loadMayaChat() {
    fetch('/api/admin/maya/conversations/by-discord/' + discordId, { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success) return;
        if (data.activeConversation) {
          currentConversation = data.activeConversation;
          showConversation(data.activeConversation, data.messages);
        } else {
          // No active/paused conversation — always show start panel
          currentConversation = null;
          document.getElementById('maya-no-conversation').style.display = 'block';
          document.getElementById('maya-conversation').style.display = 'none';
        }
      })
      .catch(function() {
        // API error — hide maya section silently
      });
  }
  // Expose for inline onclick references
  window.loadMayaChat = loadMayaChat;

  /** Render conversation UI (Fixes 2, 3: toggle + takeover + input state) */
  function showConversation(conv, messages) {
    document.getElementById('maya-no-conversation').style.display = 'none';
    document.getElementById('maya-conversation').style.display = 'block';

    // Status badge
    var statusEl = document.getElementById('maya-conv-status');
    statusEl.textContent = conv.status;
    statusEl.className = 'badge badge-' + conv.status;

    // Toggle state: paused/closed → force manual; otherwise use admin_override
    var isManual = conv.admin_override;
    if (conv.status === 'paused' || conv.status === 'closed') {
      isManual = true;
    }
    setToggleState(isManual);

    // Pause/Resume buttons
    document.getElementById('maya-pause-btn').style.display = conv.status === 'active' ? '' : 'none';
    document.getElementById('maya-resume-btn').style.display = conv.status === 'paused' ? '' : 'none';

    // Messages
    var container = document.getElementById('maya-messages');
    container.innerHTML = '';
    if (messages && messages.length > 0) {
      messages.forEach(function(m) {
        appendMessage(m.role, m.content, m.sent_at);
      });
    } else {
      container.innerHTML = '<p style="color:var(--muted);font-size:13px;">No messages yet.</p>';
    }
    scrollMessages();
  }

  /** Append a message to the chat display */
  function appendMessage(role, content, sentAt) {
    var container = document.getElementById('maya-messages');
    var div = document.createElement('div');
    div.style.marginBottom = '8px';
    div.style.padding = '8px 12px';
    div.style.borderRadius = '8px';
    div.style.fontSize = '13px';
    div.style.lineHeight = '1.4';

    if (role === 'maya') {
      div.style.background = '#2563eb22';
      div.style.borderLeft = '3px solid #2563eb';
    } else if (role === 'admin') {
      div.style.background = '#f59e0b22';
      div.style.borderLeft = '3px solid #f59e0b';
    } else {
      div.style.background = 'var(--border)';
      div.style.borderLeft = '3px solid var(--muted)';
    }

    var label = role === 'maya' ? '🤖 Maya' : role === 'admin' ? '👑 Admin (as Maya)' : '💬 Player';
    var time = sentAt ? new Date(sentAt).toLocaleString() : '';
    div.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:2px;">' +
      label + ' · ' + escapeHtml(time) + '</div>' +
      '<div>' + escapeHtml(content) + '</div>';

    container.appendChild(div);
  }

  function scrollMessages() {
    var container = document.getElementById('maya-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Send admin message as Maya */
  window.mayaSendMessage = function() {
    if (!currentConversation) return;
    var input = document.getElementById('maya-message-input');
    if (input.disabled) return;
    var content = input.value.trim();
    if (!content) return;

    input.value = '';
    appendMessage('admin', content, new Date().toISOString());
    scrollMessages();

    fetch('/api/admin/maya/conversations/' + currentConversation.id + '/messages', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.success) {
        alert('Failed to send message');
      }
    });
  };

  /**
   * Toggle AI/Manual mode via the toggle switch (Fix 3).
   * Clicking the toggle flips the current state.
   */
  window.mayaToggleOverride = function() {
    if (!currentConversation) return;
    var track = document.getElementById('maya-toggle-track');
    var isCurrentlyManual = track.classList.contains('manual');
    var newOverride = !isCurrentlyManual;

    setToggleState(newOverride);

    fetch('/api/admin/maya/conversations/' + currentConversation.id, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_override: newOverride })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        currentConversation.admin_override = newOverride;
      } else {
        // Revert on failure
        setToggleState(isCurrentlyManual);
      }
    })
    .catch(function() {
      setToggleState(isCurrentlyManual);
    });
  };

  /**
   * Maya Take Over button handler (Fix 2).
   * Switches from Manual back to AI mode.
   */
  window.mayaTakeOver = function() {
    if (!currentConversation) return;

    setToggleState(false);

    fetch('/api/admin/maya/conversations/' + currentConversation.id, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_override: false })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        currentConversation.admin_override = false;
      } else {
        setToggleState(true);
      }
    })
    .catch(function() {
      setToggleState(true);
    });
  };

  /** Pause conversation */
  window.mayaPauseConversation = function() {
    if (!currentConversation) return;
    fetch('/api/admin/maya/conversations/' + currentConversation.id, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' })
    }).then(function() { loadMayaChat(); });
  };

  /** Resume conversation */
  window.mayaResumeConversation = function() {
    if (!currentConversation) return;
    fetch('/api/admin/maya/conversations/' + currentConversation.id, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' })
    }).then(function() { loadMayaChat(); });
  };

  /** Close conversation */
  window.mayaCloseConversation = function() {
    if (!currentConversation) return;
    if (!confirm('Close this conversation? Maya will stop responding to this player.')) return;
    fetch('/api/admin/maya/conversations/' + currentConversation.id, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' })
    }).then(function() { loadMayaChat(); });
  };

  /**
   * Fetches available Maya templates and populates the template dropdown.
   * Called once on page load when the Maya Chat section initializes.
   */
  function fetchTemplates() {
    fetch('/api/admin/maya/templates', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.success || !data.templates) return;
        var select = document.getElementById('maya-template-select');
        if (!select) return;
        data.templates.forEach(function(tpl) {
          var option = document.createElement('option');
          option.value = tpl.id;
          option.textContent = tpl.name + ' (' + tpl.trigger_type + ')';
          select.appendChild(option);
        });
      })
      .catch(function() {
        // Templates API unavailable — dropdown stays with default option only
      });
  }

  /**
   * Starts a Maya conversation using the selected template and/or custom message.
   * Sends preferred_name from the address input (Fix 4 UI).
   */
  window.mayaStartConversation = function() {
    var select = document.getElementById('maya-template-select');
    var textarea = document.getElementById('maya-custom-message');
    var nameInput = document.getElementById('maya-preferred-name');
    var errorDiv = document.getElementById('maya-start-error');
    errorDiv.style.display = 'none';

    var templateId = select ? select.value : '';
    var customMessage = textarea ? textarea.value.trim() : '';
    var preferredName = nameInput ? nameInput.value.trim() : '';

    var payload = { discordId: discordId };
    if (templateId) payload.templateId = templateId;
    if (customMessage) payload.openingMessage = customMessage;
    if (preferredName) payload.preferredName = preferredName;

    fetch('/api/admin/maya/conversations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r) {
      if (r.status === 409) {
        return r.json().then(function() {
          errorDiv.innerHTML = '⚠️ An active conversation already exists for this player. <a href="#" onclick="loadMayaChat(); return false;" style="color: var(--accent); text-decoration: underline;">View conversation</a>';
          errorDiv.style.display = 'block';
          return null;
        });
      }
      return r.json();
    })
    .then(function(data) {
      if (!data) return;
      if (data.success) {
        if (textarea) textarea.value = '';
        if (nameInput) nameInput.value = '';
        loadMayaChat();
      } else {
        errorDiv.textContent = data.message || 'Failed to start conversation';
        errorDiv.style.display = 'block';
      }
    })
    .catch(function() {
      errorDiv.textContent = 'Network error — please try again';
      errorDiv.style.display = 'block';
    });
  };

  // ── Maya Notes ──

  /**
   * Formats a date as short month + day (e.g. "Mar 4").
   * @param {string} dateStr - ISO date string
   * @returns {string} Formatted short date
   */
  function formatNoteDate(dateStr) {
    var d = new Date(dateStr);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }

  /**
   * Escapes HTML entities in a string for safe DOM insertion.
   * @param {string} str - Raw string
   * @returns {string} HTML-escaped string
   */
  function escNote(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Renders a single note element.
   * @param {{ id: number, note: string, created_at: string, source_conversation_id: string|null }} n - Note object
   * @returns {HTMLElement} Note DOM element
   */
  function renderNoteEl(n) {
    var el = document.createElement('div');
    el.setAttribute('data-note-id', n.id);
    el.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start; padding:6px 0; border-bottom:1px solid var(--border);';
    var source = n.source_conversation_id ? ' 🤖' : ' ✍️';
    el.innerHTML = '<span style="flex:1; font-size:14px; color:var(--text);"><span style="color:var(--muted); font-size:12px;">[' + escNote(formatNoteDate(n.created_at)) + ']' + source + '</span> ' + escNote(n.note) + '</span>' +
      '<button onclick="deleteMayaNote(' + n.id + ')" style="background:none; border:none; color:var(--muted); cursor:pointer; padding:2px 6px; font-size:14px; flex-shrink:0;" title="Delete note">&times;</button>';
    return el;
  }

  /** Fetches and renders all Maya notes for the current player */
  function loadMayaNotes(targetDiscordId) {
    var id = targetDiscordId || discordId;
    fetch('/api/admin/maya/notes/' + encodeURIComponent(id), { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var list = document.getElementById('maya-notes-list');
        var empty = document.getElementById('maya-notes-empty');
        if (!list) return;
        // Clear existing notes (keep empty message element)
        list.innerHTML = '';
        if (!data.success || !data.notes || data.notes.length === 0) {
          var emptyP = document.createElement('p');
          emptyP.id = 'maya-notes-empty';
          emptyP.style.cssText = 'color: var(--muted); margin:0;';
          emptyP.textContent = 'No notes yet. Maya will automatically extract insights from conversations, or you can add notes manually.';
          list.appendChild(emptyP);
          return;
        }
        data.notes.forEach(function(n) {
          list.appendChild(renderNoteEl(n));
        });
      })
      .catch(function(err) {
        console.error('[maya-notes] Failed to load notes:', err);
      });
  }
  window.loadMayaNotes = loadMayaNotes;

  /** Adds a manual note for the current player */
  function addMayaNote() {
    var input = document.getElementById('maya-note-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    if (text.length > 500) {
      alert('Note must be 500 characters or fewer.');
      return;
    }
    input.disabled = true;
    fetch('/api/admin/maya/notes/' + encodeURIComponent(discordId), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: text })
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        input.disabled = false;
        if (data.success && data.note) {
          input.value = '';
          // Remove empty state message if present
          var empty = document.getElementById('maya-notes-empty');
          if (empty) empty.remove();
          // Prepend the new note (newest first)
          var list = document.getElementById('maya-notes-list');
          if (list) list.prepend(renderNoteEl(data.note));
        }
      })
      .catch(function() {
        input.disabled = false;
      });
  }
  window.addMayaNote = addMayaNote;

  /** Deletes a note by ID */
  function deleteMayaNote(noteId) {
    fetch('/api/admin/maya/notes/' + noteId, {
      method: 'DELETE',
      credentials: 'include'
    })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          var el = document.querySelector('[data-note-id="' + noteId + '"]');
          if (el) el.remove();
          // Show empty state if no notes left
          var list = document.getElementById('maya-notes-list');
          if (list && list.children.length === 0) {
            var emptyP = document.createElement('p');
            emptyP.id = 'maya-notes-empty';
            emptyP.style.cssText = 'color: var(--muted); margin:0;';
            emptyP.textContent = 'No notes yet. Maya will automatically extract insights from conversations, or you can add notes manually.';
            list.appendChild(emptyP);
          }
        }
      })
      .catch(function(err) {
        console.error('[maya-notes] Failed to delete note:', err);
      });
  }
  window.deleteMayaNote = deleteMayaNote;

  /** Wire up Socket.io listeners for real-time note updates */
  function initMayaNotesSocket() {
    if (!mayaSocket) return;
    mayaSocket.on('maya:note-added', function(data) {
      if (data.discordId !== discordId) return;
      var list = document.getElementById('maya-notes-list');
      if (!list) return;
      // Remove empty state
      var empty = document.getElementById('maya-notes-empty');
      if (empty) empty.remove();
      // Avoid duplicates — check if note ID already rendered
      if (data.note && data.note.id && document.querySelector('[data-note-id="' + data.note.id + '"]')) return;
      if (data.note) list.prepend(renderNoteEl(data.note));
    });
    mayaSocket.on('maya:note-deleted', function(data) {
      if (data.discordId !== discordId) return;
      var el = document.querySelector('[data-note-id="' + data.noteId + '"]');
      if (el) el.remove();
      // Show empty state if no notes left
      var list = document.getElementById('maya-notes-list');
      if (list && list.children.length === 0) {
        var emptyP = document.createElement('p');
        emptyP.id = 'maya-notes-empty';
        emptyP.style.cssText = 'color: var(--muted); margin:0;';
        emptyP.textContent = 'No notes yet. Maya will automatically extract insights from conversations, or you can add notes manually.';
        list.appendChild(emptyP);
      }
    });
  }

  // Initialize REST-based loaders on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      loadMayaChat();
      loadMayaNotes();
      fetchTemplates();
    });
  } else {
    loadMayaChat();
    loadMayaNotes();
    fetchTemplates();
  }

  // Initialize socket after auth completes in the first IIFE.
  // The 'maya-admin-ready' event carries the authenticated userId,
  // avoiding cross-IIFE function calls that would cause ReferenceErrors.
  window.addEventListener('maya-admin-ready', function(e) {
    var userId = e.detail && e.detail.userId;
    initMayaSocket(userId);
    initMayaNotesSocket();
  });
})();
