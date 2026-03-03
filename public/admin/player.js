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

      renderIdentity();
      renderStats();
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
      { label: 'Gold Spent', value: fmtNum(s.totalGoldSpent) + 'g', icon: 'fa-coins' },
      { label: 'Reward Points', value: fmtNum(s.totalRewardPoints), icon: 'fa-star' },
      { label: 'Avg DPS', value: s.avgDPS != null ? fmtNum(s.avgDPS) : 'N/A', icon: 'fa-sword' },
      { label: 'Avg HPS', value: s.avgHPS != null ? fmtNum(s.avgHPS) : 'N/A', icon: 'fa-heart' },
      { label: 'Buff Compliance', value: s.worldBuffComplianceRate != null ? s.worldBuffComplianceRate + '%' : 'N/A', icon: 'fa-magic' },
      { label: 'Frost Res Compliance', value: s.frostResComplianceRate != null ? s.frostResComplianceRate + '%' : 'N/A', icon: 'fa-snowflake' }
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
  function renderCharacters() {
    const chars = playerData.characters;
    if (!chars || chars.length === 0) {
      document.getElementById('characters-body').innerHTML = '<div class="no-data">No characters found</div>';
      return;
    }

    document.getElementById('characters-body').innerHTML =
      '<div class="characters-grid">' +
      chars.map(function (c) {
        var slug = classSlug(c.class);
        return '<div class="char-card ' + slug + '">' +
          '<h3>' + esc(c.characterName) + ' <span class="class-badge">' + esc(c.class) + '</span></h3>' +
          '<div class="detail-row"><span>Race</span><strong>' + esc(c.race || 'Unknown') + '</strong></div>' +
          '<div class="detail-row"><span>Level</span><strong>' + (c.level || '?') + '</strong></div>' +
          '<div class="detail-row"><span>Faction</span><strong>' + esc(c.faction || 'Unknown') + '</strong></div>' +
          (c.specName ? '<div class="detail-row"><span>Spec</span><strong>' + esc(c.specName) + '</strong></div>' : '') +
          (c.primaryRole ? '<div class="detail-row"><span>Role</span><strong>' + esc(c.primaryRole) + '</strong></div>' : '') +
          (c.mainAlt ? '<div class="detail-row"><span>Main/Alt</span><strong>' + esc(c.mainAlt) + '</strong></div>' : '') +
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

    // Sort
    var sorted = raids.slice().sort(function (a, b) {
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
      '<th>In Raid</th>' +
      '<th onclick="sortRaidHistory(\'damageDealt\')">Damage' + sortIcon('damageDealt') + '</th>' +
      '<th onclick="sortRaidHistory(\'healingDone\')">Healing' + sortIcon('healingDone') + '</th>' +
      '<th>Spec</th>' +
      '<th>WCL</th>' +
    '</tr></thead><tbody>';

    sorted.forEach(function (r) {
      html += '<tr>' +
        '<td>' + fmtDate(r.eventDate) + '</td>' +
        '<td>' + esc(r.eventName || r.eventId) + '</td>' +
        '<td>' + esc(r.characterUsed || '-') + '</td>' +
        '<td>' + (r.inRaid ? '<i class="fas fa-check" style="color:var(--success)"></i>' : '<i class="fas fa-minus" style="color:var(--muted)"></i>') + '</td>' +
        '<td>' + (r.damageDealt != null ? fmtNum(r.damageDealt) : '-') + '</td>' +
        '<td>' + (r.healingDone != null ? fmtNum(r.healingDone) : '-') + '</td>' +
        '<td>' + esc(r.specName || '-') + '</td>' +
        '<td>' + (r.wclLogLink ? '<a href="' + esc(r.wclLogLink) + '" target="_blank" class="wcl-link"><i class="fas fa-external-link-alt"></i></a>' : '-') + '</td>' +
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

  // ── Render: World Buffs ───────────────────────────────────────────────
  function renderWorldBuffs() {
    var buffs = playerData.worldBuffs;
    if (!buffs || buffs.length === 0) {
      document.getElementById('world-buffs-body').innerHTML = '<div class="no-data">No world buff data</div>';
      return;
    }

    // Compliance progress bar
    var rate = playerData.stats.worldBuffComplianceRate;
    var html = '';
    if (rate != null) {
      html += '<div style="margin-bottom:12px">Compliance: <strong>' + rate + '%</strong>' +
        '<div class="progress-bar"><div class="fill" style="width:' + rate + '%;background:' + (rate >= 80 ? 'var(--success)' : rate >= 50 ? 'var(--warning)' : 'var(--danger)') + '"></div></div></div>';
    }

    html += '<table class="data-table"><thead><tr>' +
      '<th>Event</th><th>Character</th><th>Buff</th><th>Value</th><th>Status</th>' +
    '</tr></thead><tbody>';

    buffs.forEach(function (b) {
      var statusClass = '';
      if (b.colorStatus) {
        var cs = b.colorStatus.toLowerCase();
        if (cs.includes('green')) statusClass = 'buff-green';
        else if (cs.includes('yellow') || cs.includes('orange')) statusClass = 'buff-yellow';
        else if (cs.includes('red')) statusClass = 'buff-red';
      }
      html += '<tr>' +
        '<td>' + esc(b.eventId) + '</td>' +
        '<td>' + esc(b.characterName) + '</td>' +
        '<td>' + esc(b.buffName) + '</td>' +
        '<td>' + esc(b.buffValue || '-') + '</td>' +
        '<td><span class="buff-cell ' + statusClass + '">' + esc(b.colorStatus || 'Unknown') + '</span></td>' +
      '</tr>';
    });

    html += '</tbody></table>';
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
        '<td>' + esc(f.characterName) + '</td>' +
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
        '<td>' + esc(a.characterName) + '</td>' +
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

  // ── Init ──────────────────────────────────────────────────────────────
  init();
})();
