/**
 * Character Profile Sub-Page
 *
 * Renders a single character's profile with loot history, gold summary,
 * raid history, editable profile fields, and unlink functionality.
 *
 * Fetches data from GET /api/my-characters/:characterName/profile
 * and uses PATCH /api/my-characters/:name/profile for auto-save.
 */

/** WoW class colors — canonical hex values (mirrors user-settings.js) */
const CLASS_COLORS = {
  warrior: '#C79C6E',
  paladin: '#F58CBA',
  hunter: '#ABD473',
  rogue: '#FFF569',
  priest: '#FFFFFF',
  shaman: '#0070DE',
  mage: '#69CCF0',
  warlock: '#9482C9',
  druid: '#FF7D0A'
};

/** Escape HTML to prevent XSS */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/** Show a toast notification */
function showToast(message, type) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast toast-' + (type || 'info');
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

/** Format a date string for display */
function fmtDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) {
    return '-';
  }
}

/** Format a number with locale separator */
function fmtNum(n) {
  return (n || 0).toLocaleString();
}

/** Get class color from hex or fallback to map */
function getClassColor(charClass, hexFromApi) {
  if (hexFromApi) return hexFromApi;
  const key = (charClass || '').toLowerCase().replace(/\s+/g, '-');
  return CLASS_COLORS[key] || '#3498db';
}

// ── Initialization ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const characterName = extractCharacterName();
  if (!characterName) {
    document.getElementById('char-header').innerHTML =
      '<p class="error-message">No character specified.</p>';
    return;
  }

  try {
    const response = await fetch(`/api/my-characters/${encodeURIComponent(characterName)}/profile`);

    if (response.status === 401) {
      document.getElementById('char-header').innerHTML =
        '<p class="error-message">Please sign in to view this character.</p>';
      return;
    }
    if (response.status === 403) {
      document.getElementById('char-header').innerHTML =
        '<p class="error-message">You do not have access to this character.</p>';
      return;
    }
    if (response.status === 404) {
      document.getElementById('char-header').innerHTML =
        '<p class="error-message">Character not found.</p>';
      return;
    }
    if (!response.ok) {
      throw new Error('Failed to fetch character profile');
    }

    const data = await response.json();

    renderCharacterHeader(data.character);
    renderLootHistory(data.loot);
    renderGoldSummary(data.gold);
    renderRaidHistory(data.raidHistory);
    setupUnlinkModal(data.character.name);
  } catch (error) {
    document.getElementById('char-header').innerHTML =
      '<p class="error-message">Failed to load character profile. Please try again later.</p>';
  }
});

/** Extract character name from URL path: /user-settings/character/:name */
function extractCharacterName() {
  const parts = window.location.pathname.split('/');
  // Expected: ['', 'user-settings', 'character', 'CharacterName']
  const charIdx = parts.indexOf('character');
  if (charIdx >= 0 && parts[charIdx + 1]) {
    return decodeURIComponent(parts[charIdx + 1]);
  }
  return null;
}

// ── Section A: Character Header ─────────────────────────────────────────────

/** Render the character header with class color, info, profile fields, and unlink */
function renderCharacterHeader(char) {
  const color = getClassColor(char.class, char.classColorHex);
  const container = document.getElementById('char-header');

  container.innerHTML = `
    <div class="char-profile-header">
      <div class="char-profile-name-row">
        <h1 class="char-profile-name" style="color: ${color}">${escapeHtml(char.name)}</h1>
        ${char.rankName ? `<span class="char-rank">${escapeHtml(char.rankName)}</span>` : ''}
      </div>
      <div class="char-profile-info">
        <span>${escapeHtml(char.class)}</span>
        ${char.race ? `<span class="info-sep">·</span><span>${escapeHtml(char.race)}</span>` : ''}
        ${char.level ? `<span class="info-sep">·</span><span>Level ${char.level}</span>` : ''}
      </div>
    </div>

    <div class="profile-fields">
      <div class="form-group">
        <label>Spec / Role</label>
        <input type="text" class="profile-input" data-field="profile_spec"
               value="${escapeHtml(char.profileSpec || '')}" placeholder="e.g. Fury, Tank, Holy"
               maxlength="50">
      </div>
      <div class="form-group">
        <label>Contact Info</label>
        <input type="text" class="profile-input" data-field="profile_contact"
               value="${escapeHtml(char.profileContact || '')}" placeholder="Phone or other contact">
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea class="profile-input" data-field="profile_notes"
                  placeholder="e.g. Can tank 4H, MC priest for Razuvious">${escapeHtml(char.profileNotes || '')}</textarea>
      </div>
    </div>

    <div class="char-profile-actions">
      <button id="unlink-btn" class="btn btn-danger btn-sm">
        <i class="fas fa-unlink"></i> Unlink Character
      </button>
    </div>
  `;

  // Profile field auto-save on blur
  const inputs = container.querySelectorAll('.profile-input');
  inputs.forEach(input => {
    input.addEventListener('blur', () => {
      saveProfileField(char.name, input.dataset.field, input.value);
    });
  });
}

/** Save a single profile field via PATCH */
async function saveProfileField(characterName, field, value) {
  try {
    const payload = {};
    payload[field] = value;

    const response = await fetch(`/api/my-characters/${encodeURIComponent(characterName)}/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      showToast('Profile saved', 'success');
    } else {
      const data = await response.json().catch(() => ({}));
      showToast(data.message || 'Failed to save', 'error');
    }
  } catch (err) {
    showToast('Failed to save profile', 'error');
  }
}

// ── Section B: Loot History ─────────────────────────────────────────────────

/** Render the loot history table (same pattern as admin/player.js renderLoot) */
function renderLootHistory(loot) {
  const container = document.getElementById('loot-body');

  if (!loot || !loot.items || loot.items.length === 0) {
    container.innerHTML =
      '<div class="cp-total">Total Gold Spent: <strong>0g</strong></div>' +
      '<div class="no-data">No loot history</div>';
    return;
  }

  let html = '<div class="cp-total">Total Gold Spent: <strong class="gold-text">' +
    fmtNum(loot.totalGoldSpent) + 'g</strong></div>';

  html += '<div class="table-scroll"><table class="cp-table"><thead><tr>' +
    '<th>Item</th><th>Gold</th><th>Raid</th><th>Date</th>' +
    '</tr></thead><tbody>';

  loot.items.forEach(function (item) {
    // Wowhead link + icon pattern from admin/player.js renderLoot()
    const icon = item.iconLink
      ? '<img class="item-icon" src="' + escapeHtml(item.iconLink) + '" onerror="this.style.display=\'none\'">'
      : '';
    const nameHtml = item.wowheadLink
      ? '<a href="' + escapeHtml(item.wowheadLink) + '" target="_blank" class="item-link">' + icon + escapeHtml(item.itemName) + '</a>'
      : icon + escapeHtml(item.itemName);

    html += '<tr>' +
      '<td>' + nameHtml + '</td>' +
      '<td class="gold-text">' + fmtNum(item.goldAmount) + 'g</td>' +
      '<td>' + escapeHtml(item.raidName || item.eventId || '-') + '</td>' +
      '<td>' + fmtDate(item.createdAt) + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ── Section C: Gold Summary ─────────────────────────────────────────────────

/** Render gold summary stat cards and manual rewards table */
function renderGoldSummary(gold) {
  const container = document.getElementById('gold-body');

  const netClass = gold.net >= 0 ? 'positive' : 'negative';
  const netSign = gold.net >= 0 ? '+' : '';

  let html = '<div class="gold-cards">';
  html += '<div class="gold-card gold-earned"><div class="gold-card-label">Gold Earned</div>' +
    '<div class="gold-card-value">' + fmtNum(gold.earned) + 'g</div></div>';
  html += '<div class="gold-card gold-spent"><div class="gold-card-label">Gold Spent</div>' +
    '<div class="gold-card-value">' + fmtNum(gold.spent) + 'g</div></div>';
  html += '<div class="gold-card gold-net ' + netClass + '"><div class="gold-card-label">Net Gold</div>' +
    '<div class="gold-card-value">' + netSign + fmtNum(gold.net) + 'g</div></div>';
  html += '</div>';

  // Manual rewards/deductions table
  if (gold.manualRewards && gold.manualRewards.length > 0) {
    html += '<h3 class="cp-sub-heading">Manual Rewards & Deductions</h3>';
    html += '<div class="table-scroll"><table class="cp-table"><thead><tr>' +
      '<th>Description</th><th>Amount</th><th>Type</th><th>Date</th>' +
      '</tr></thead><tbody>';

    gold.manualRewards.forEach(function (r) {
      const amtClass = r.points >= 0 ? 'positive' : 'negative';
      const typeIcon = r.isGold
        ? '<i class="fas fa-coins" style="color:#f6ad55"></i> Gold'
        : 'Points';

      html += '<tr>' +
        '<td>' + escapeHtml(r.description) + '</td>' +
        '<td class="' + amtClass + '">' + r.points + '</td>' +
        '<td>' + typeIcon + '</td>' +
        '<td>' + fmtDate(r.createdAt) + '</td>' +
        '</tr>';
    });

    html += '</tbody></table></div>';
  } else {
    html += '<div class="no-data">No manual rewards or deductions</div>';
  }

  container.innerHTML = html;
}

// ── Section D: Raid History ─────────────────────────────────────────────────

/** Render raid history table */
function renderRaidHistory(raidHistory) {
  const container = document.getElementById('raid-body');

  if (!raidHistory || !raidHistory.raids || raidHistory.raids.length === 0) {
    container.innerHTML =
      '<div class="cp-total">Total Raids: <strong>0</strong></div>' +
      '<div class="no-data">No raid history</div>';
    return;
  }

  let html = '<div class="cp-total">Total Raids: <strong>' +
    raidHistory.totalCount + '</strong></div>';

  html += '<div class="table-scroll"><table class="cp-table"><thead><tr>' +
    '<th>Raid Name</th><th>Date</th><th>Spec</th><th>Character</th>' +
    '</tr></thead><tbody>';

  raidHistory.raids.forEach(function (raid) {
    html += '<tr>' +
      '<td>' + escapeHtml(raid.eventName || raid.eventId || '-') + '</td>' +
      '<td>' + fmtDate(raid.eventDate) + '</td>' +
      '<td>' + escapeHtml(raid.specName || '-') + '</td>' +
      '<td>' + escapeHtml(raid.characterUsed || '-') + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ── Unlink Modal ────────────────────────────────────────────────────────────

/** Set up the unlink button and modal (reuses pattern from user-settings.js) */
function setupUnlinkModal(characterName) {
  const modal = document.getElementById('unlink-modal');
  const closeBtn = document.getElementById('unlink-modal-close');
  const cancelBtn = document.getElementById('unlink-cancel');
  const confirmBtn = document.getElementById('unlink-confirm');
  const unlinkBtn = document.getElementById('unlink-btn');
  const confirmText = document.getElementById('unlink-confirm-text');

  if (!unlinkBtn) return;

  unlinkBtn.addEventListener('click', () => {
    confirmText.textContent = `Are you sure you want to unlink ${characterName}?`;
    modal.style.display = 'flex';
  });

  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  cancelBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  confirmBtn.addEventListener('click', async () => {
    try {
      const resp = await fetch(`/api/my-characters/${encodeURIComponent(characterName)}`, {
        method: 'DELETE',
      });

      if (resp.ok) {
        showToast(`${characterName} unlinked from your profile.`, 'success');
        modal.style.display = 'none';
        // Redirect back to user settings after unlink
        setTimeout(() => { window.location.href = '/user-settings'; }, 1500);
      } else {
        const data = await resp.json().catch(() => ({}));
        showToast(data.message || 'Failed to unlink character.', 'error');
      }
    } catch (err) {
      showToast('Network error. Please try again.', 'error');
    }
  });
}
