/**
 * User Settings Page — Character Profile & Claim System
 *
 * Features:
 * - Expandable character cards with WoW class color theming
 * - Inline profile editing (spec, contact, notes) with auto-save
 * - Character claim flow with autocomplete search
 * - Manual entry for unknown characters
 * - Unlink flow with confirmation
 * - Pending claim status display
 */

/** WoW class colors — canonical hex values */
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

/** Debounce utility */
function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
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

/** Get class color from hex or fallback to map */
function getClassColor(charClass, hexFromApi) {
  if (hexFromApi) return hexFromApi;
  const key = (charClass || '').toLowerCase().replace(/\s+/g, '-');
  return CLASS_COLORS[key] || '#3498db';
}

/** Convert hex to rgba */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Initialization ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadAccountInfo();
  await loadUserCharacters();
  await loadClaimSection();
  setupClaimModal();
  setupUnlinkModal();
});

// ── Character Cards ─────────────────────────────────────────────────────────

async function loadUserCharacters() {
  const container = document.getElementById('user-characters-list');

  try {
    const response = await fetch('/api/my-characters');
    if (!response.ok) {
      if (response.status === 401) {
        container.innerHTML = '<p class="error-message">Please sign in to view your characters.</p>';
        return;
      }
      throw new Error('Failed to fetch characters');
    }

    const characters = await response.json();

    if (characters && characters.length > 0) {
      container.innerHTML = '';
      const grid = document.createElement('div');
      grid.classList.add('characters-grid');

      characters.forEach(char => {
        const color = getClassColor(char.class, char.class_color_hex);
        const card = createCharacterCard(char, color);
        grid.appendChild(card);
      });

      container.appendChild(grid);
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-user-slash"></i>
          <h3>No Characters Found</h3>
          <p>You haven't claimed any characters yet. Use the button below to claim your first character!</p>
        </div>
      `;
    }
  } catch (error) {
    container.innerHTML = '<p class="error-message">Failed to load characters. Please try again later.</p>';
  }
}

/** Build a clickable character card that links to the character sub-page */
function createCharacterCard(char, color) {
  const link = document.createElement('a');
  link.classList.add('character-card-link');
  link.href = `/user-settings/character/${encodeURIComponent(char.character_name)}`;

  const card = document.createElement('div');
  card.classList.add('character-card');
  card.style.borderLeftColor = color;
  card.style.background = `linear-gradient(135deg, ${hexToRgba(color, 0.08)} 0%, ${hexToRgba(color, 0.03)} 100%)`;

  card.innerHTML = `
    <div class="card-header">
      <div class="card-header-left">
        <span class="char-name" style="color: ${color}">${escapeHtml(char.character_name)}</span>
        <span class="char-info">${escapeHtml(char.class)} · Level ${char.level || '?'}</span>
      </div>
      <div class="card-header-right">
        ${char.rank_name ? `<span class="char-rank">${escapeHtml(char.rank_name)}</span>` : ''}
        <i class="fas fa-chevron-right expand-icon"></i>
      </div>
    </div>
  `;

  link.appendChild(card);
  return link;
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

// ── Claim Section ───────────────────────────────────────────────────────────

async function loadClaimSection() {
  const section = document.getElementById('claim-section');
  if (!section) return;

  try {
    const response = await fetch('/api/my-characters/pending-claim');
    if (!response.ok) {
      if (response.status === 401) {
        section.style.display = 'none';
        return;
      }
      throw new Error('Failed to check pending claims');
    }

    const pendingClaim = await response.json();
    section.style.display = 'block';

    if (pendingClaim) {
      section.innerHTML = `
        <div class="pending-claim-notice">
          <i class="fas fa-clock"></i>
          <span>Pending claim for <strong>${escapeHtml(pendingClaim.character_name)}</strong> — waiting for officer review.</span>
        </div>
      `;
    } else {
      section.innerHTML = `
        <button id="open-claim-modal" class="btn btn-primary btn-claim">
          <i class="fas fa-plus-circle"></i> Claim a Character
        </button>
      `;
      document.getElementById('open-claim-modal').addEventListener('click', openClaimModal);
    }
  } catch (err) {
    section.style.display = 'block';
    section.innerHTML = `
      <button id="open-claim-modal" class="btn btn-primary btn-claim">
        <i class="fas fa-plus-circle"></i> Claim a Character
      </button>
    `;
    document.getElementById('open-claim-modal').addEventListener('click', openClaimModal);
  }
}

// ── Claim Modal ─────────────────────────────────────────────────────────────

let selectedCharacter = null;

function setupClaimModal() {
  const modal = document.getElementById('claim-modal');
  const closeBtn = document.getElementById('claim-modal-close');
  const searchInput = document.getElementById('claim-search-input');
  const dropdown = document.getElementById('autocomplete-dropdown');
  const submitBtn = document.getElementById('claim-submit-btn');
  const manualSubmit = document.getElementById('claim-manual-submit');

  closeBtn.addEventListener('click', closeClaimModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeClaimModal();
  });

  // Autocomplete search with debounce
  const debouncedSearch = debounce(async (query) => {
    if (query.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    try {
      const resp = await fetch(`/api/guildies/search?q=${encodeURIComponent(query)}`);
      const results = await resp.json();

      if (results.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-item autocomplete-empty">No characters found</div>';
        dropdown.style.display = 'block';
        return;
      }

      dropdown.innerHTML = results.map(r => {
        const color = getClassColor(r.class);
        const owned = r.discord_id ? ' <span class="owned-tag">linked</span>' : '';
        return `<div class="autocomplete-item" data-name="${escapeHtml(r.character_name)}" data-class="${escapeHtml(r.class)}">
          <span class="ac-name" style="color: ${color}">${escapeHtml(r.character_name)}</span>
          <span class="ac-class" style="color: ${color}">${escapeHtml(r.class)} ${r.level || ''}</span>${owned}
        </div>`;
      }).join('');

      dropdown.style.display = 'block';

      // Click on autocomplete item
      dropdown.querySelectorAll('.autocomplete-item:not(.autocomplete-empty)').forEach(item => {
        item.addEventListener('click', () => {
          selectedCharacter = { character_name: item.dataset.name, class: item.dataset.class };
          searchInput.value = item.dataset.name;
          dropdown.style.display = 'none';
        });
      });
    } catch (err) {
      dropdown.style.display = 'none';
    }
  }, 300);

  searchInput.addEventListener('input', () => {
    selectedCharacter = null;
    debouncedSearch(searchInput.value.trim());
  });

  // Hide dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
      dropdown.style.display = 'none';
    }
  });

  // Submit claim
  submitBtn.addEventListener('click', () => submitClaim());

  // Submit manual claim
  manualSubmit.addEventListener('click', () => submitManualClaim());

  // Load class options for manual entry
  loadClassOptions();
}

async function loadClassOptions() {
  try {
    const resp = await fetch('/api/class-specs');
    const data = await resp.json();
    if (!data.success) return;

    const select = document.getElementById('manual-class');
    const classNames = [...new Set(data.mappings.map(m => m.class_name))];
    classNames.forEach(cls => {
      const opt = document.createElement('option');
      opt.value = cls;
      opt.textContent = cls;
      select.appendChild(opt);
    });
  } catch (err) {
    // Fallback — will show empty select
  }
}

function openClaimModal() {
  const modal = document.getElementById('claim-modal');
  const searchInput = document.getElementById('claim-search-input');
  const manualSection = document.getElementById('claim-manual-section');
  const feedback = document.getElementById('claim-feedback');

  selectedCharacter = null;
  searchInput.value = '';
  manualSection.style.display = 'none';
  feedback.style.display = 'none';
  modal.style.display = 'flex';
  searchInput.focus();
}

function closeClaimModal() {
  document.getElementById('claim-modal').style.display = 'none';
}

async function submitClaim() {
  const searchInput = document.getElementById('claim-search-input');
  const characterName = selectedCharacter ? selectedCharacter.character_name : searchInput.value.trim();

  if (!characterName) {
    showClaimFeedback('Please enter a character name.', 'error');
    return;
  }

  try {
    const resp = await fetch('/api/claim-character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_name: characterName }),
    });

    const data = await resp.json();

    if (resp.status === 404 && data.found === false) {
      // Show manual entry form
      const manualSection = document.getElementById('claim-manual-section');
      document.getElementById('manual-char-name').value = characterName;
      manualSection.style.display = 'block';
      showClaimFeedback('Character not found in guild roster. Fill in details below to add it.', 'info');
      return;
    }

    if (resp.ok) {
      showClaimFeedback(data.message || 'Character claimed!', 'success');
      setTimeout(() => {
        closeClaimModal();
        loadUserCharacters();
        loadClaimSection();
      }, 1500);
      return;
    }

    if (resp.status === 202) {
      showClaimFeedback(data.message || 'Claim submitted — awaiting officer review.', 'pending');
      setTimeout(() => {
        closeClaimModal();
        loadClaimSection();
      }, 2000);
      return;
    }

    showClaimFeedback(data.message || 'Failed to claim character.', 'error');
  } catch (err) {
    showClaimFeedback('Network error. Please try again.', 'error');
  }
}

async function submitManualClaim() {
  const characterName = document.getElementById('manual-char-name').value.trim();
  const charClass = document.getElementById('manual-class').value;
  const realm = document.getElementById('manual-realm').value.trim();
  const level = parseInt(document.getElementById('manual-level').value, 10);

  if (!characterName || !charClass) {
    showClaimFeedback('Please select a class.', 'error');
    return;
  }

  if (level !== 60) {
    showClaimFeedback('Only level 60 characters can be claimed.', 'error');
    return;
  }

  try {
    const resp = await fetch('/api/claim-character', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_name: characterName,
        character_class: charClass,
        realm: realm || null,
        level: 60,
      }),
    });

    const data = await resp.json();

    if (resp.ok) {
      showClaimFeedback(data.message || 'Character added!', 'success');
      setTimeout(() => {
        closeClaimModal();
        loadUserCharacters();
        loadClaimSection();
      }, 1500);
    } else {
      showClaimFeedback(data.message || 'Failed to add character.', 'error');
    }
  } catch (err) {
    showClaimFeedback('Network error. Please try again.', 'error');
  }
}

function showClaimFeedback(message, type) {
  const feedback = document.getElementById('claim-feedback');
  feedback.textContent = message;
  feedback.className = 'claim-feedback claim-feedback-' + (type || 'info');
  feedback.style.display = 'block';
}

// ── Unlink Modal ────────────────────────────────────────────────────────────

let unlinkTarget = null;

function setupUnlinkModal() {
  const modal = document.getElementById('unlink-modal');
  const closeBtn = document.getElementById('unlink-modal-close');
  const cancelBtn = document.getElementById('unlink-cancel');
  const confirmBtn = document.getElementById('unlink-confirm');

  closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  cancelBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  confirmBtn.addEventListener('click', async () => {
    if (!unlinkTarget) return;

    try {
      const resp = await fetch(`/api/my-characters/${encodeURIComponent(unlinkTarget.name)}`, {
        method: 'DELETE',
      });

      if (resp.ok) {
        showToast(`${unlinkTarget.name} unlinked from your profile.`, 'success');
        modal.style.display = 'none';
        await loadUserCharacters();
        await loadClaimSection();
      } else {
        const data = await resp.json().catch(() => ({}));
        showToast(data.message || 'Failed to unlink character.', 'error');
      }
    } catch (err) {
      showToast('Network error. Please try again.', 'error');
    }
  });
}

function openUnlinkModal(name, charClass) {
  unlinkTarget = { name, class: charClass };
  const text = document.getElementById('unlink-confirm-text');
  text.textContent = `Are you sure you want to unlink ${name}?`;
  document.getElementById('unlink-modal').style.display = 'flex';
}

// ── Account Info ────────────────────────────────────────────────────────────

async function loadAccountInfo() {
  const container = document.getElementById('account-info');

  try {
    const response = await fetch('/user');
    if (!response.ok) throw new Error('Failed to fetch account info');

    const user = await response.json();

    if (user.loggedIn) {
      const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;

      container.innerHTML = `
        <div class="account-details">
          <div class="account-avatar">
            <img src="${avatarUrl}" alt="${escapeHtml(user.username)}'s avatar">
          </div>
          <div class="account-info-text">
            <div class="info-row"><strong>Username:</strong> ${escapeHtml(user.username)}</div>
            <div class="info-row"><strong>Discord ID:</strong> ${escapeHtml(user.id)}</div>
            ${user.email ? `<div class="info-row"><strong>Email:</strong> ${escapeHtml(user.email)}</div>` : ''}
            <div class="info-row">
              <strong>Role:</strong> ${user.hasManagementRole ? 'Management' : 'Member'}
              ${user.hasManagementRole ? '<i class="fas fa-crown" style="color: #ffd700; margin-left: 5px;"></i>' : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = '<p class="error-message">Not logged in</p>';
    }
  } catch (error) {
    container.innerHTML = '<p class="error-message">Failed to load account information.</p>';
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────

/** Escape HTML to prevent XSS */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
