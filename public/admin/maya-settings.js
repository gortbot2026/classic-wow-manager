/**
 * Maya Settings Page — Admin JavaScript
 * 
 * Handles persona config editing, template CRUD, and conversation dashboard.
 * Communicates with /api/admin/maya/* endpoints.
 */

/** Shows a toast notification */
function showToast(msg, duration) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration || 3000);
}

/** Fetches with management auth cookie (same-origin) */
async function apiFetch(url, opts) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (res.status === 401 || res.status === 403) {
    showToast('Unauthorized — management access required');
    return null;
  }
  return res.json();
}

// ─── Persona ────────────────────────────────────────────────────────────

async function loadPersona() {
  const data = await apiFetch('/api/admin/maya/persona');
  if (!data || !data.persona) return;
  const p = data.persona;
  document.getElementById('system-prompt').value = p.system_prompt || '';
  document.getElementById('model-select').value = p.model || 'claude-haiku-4-5';
  document.getElementById('max-context').value = p.max_context_messages || 20;
}

async function savePersona() {
  const body = {
    system_prompt: document.getElementById('system-prompt').value,
    model: document.getElementById('model-select').value,
    max_context_messages: parseInt(document.getElementById('max-context').value) || 20
  };
  const data = await apiFetch('/api/admin/maya/persona', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (data && data.success) showToast('Persona saved ✓');
  else showToast('Failed to save persona');
}

// ─── Templates ──────────────────────────────────────────────────────────

let templates = [];

async function loadTemplates() {
  const data = await apiFetch('/api/admin/maya/templates');
  if (!data) return;
  templates = data.templates || [];
  renderTemplates();
}

function renderTemplates() {
  const grid = document.getElementById('templates-grid');
  if (templates.length === 0) {
    grid.innerHTML = '<p style="color: var(--muted);">No templates yet. Create one to get started.</p>';
    return;
  }
  grid.innerHTML = templates.map(t => `
    <div class="template-card">
      <h3>${escHtml(t.name)}</h3>
      <div class="meta">
        <span class="badge badge-trigger">${escHtml(t.trigger_type)}</span>
        ${t.auto_trigger ? '<span class="badge badge-active" style="margin-left:4px;">Auto</span>' : ''}
        ${t.model_override ? `<span style="margin-left:4px;font-size:11px;color:var(--muted);">${escHtml(t.model_override)}</span>` : ''}
      </div>
      <div class="preview">${escHtml(t.opening_message)}</div>
      <div style="margin-top:8px;display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="editTemplate('${t.id}')"><i class="fas fa-edit"></i> Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTemplate('${t.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  `).join('');
}

function openTemplateModal(templateId) {
  document.getElementById('template-modal-title').textContent = templateId ? 'Edit Template' : 'New Template';
  document.getElementById('template-id').value = templateId || '';
  if (!templateId) {
    document.getElementById('tpl-name').value = '';
    document.getElementById('tpl-trigger-type').value = 'post_raid';
    document.getElementById('tpl-opening-message').value = '';
    document.getElementById('tpl-agent-instructions').value = '';
    document.getElementById('tpl-model-override').value = '';
    document.getElementById('tpl-auto-trigger').checked = false;
  }
  document.getElementById('template-modal').classList.add('show');
}

function closeTemplateModal() {
  document.getElementById('template-modal').classList.remove('show');
}

function editTemplate(id) {
  const t = templates.find(tpl => tpl.id === id);
  if (!t) return;
  document.getElementById('template-id').value = t.id;
  document.getElementById('tpl-name').value = t.name;
  document.getElementById('tpl-trigger-type').value = t.trigger_type;
  document.getElementById('tpl-opening-message').value = t.opening_message;
  document.getElementById('tpl-agent-instructions').value = t.agent_instructions;
  document.getElementById('tpl-model-override').value = t.model_override || '';
  document.getElementById('tpl-auto-trigger').checked = t.auto_trigger;
  openTemplateModal(t.id);
}

async function saveTemplate() {
  const id = document.getElementById('template-id').value;
  const body = {
    name: document.getElementById('tpl-name').value,
    trigger_type: document.getElementById('tpl-trigger-type').value,
    opening_message: document.getElementById('tpl-opening-message').value,
    agent_instructions: document.getElementById('tpl-agent-instructions').value,
    model_override: document.getElementById('tpl-model-override').value || null,
    auto_trigger: document.getElementById('tpl-auto-trigger').checked
  };

  if (!body.name || !body.opening_message || !body.agent_instructions) {
    showToast('Name, opening message, and agent instructions are required');
    return;
  }

  const url = id ? `/api/admin/maya/templates/${id}` : '/api/admin/maya/templates';
  const method = id ? 'PATCH' : 'POST';
  const data = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (data && data.success) {
    showToast(id ? 'Template updated ✓' : 'Template created ✓');
    closeTemplateModal();
    loadTemplates();
  } else {
    showToast('Failed to save template');
  }
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  const data = await apiFetch(`/api/admin/maya/templates/${id}`, { method: 'DELETE' });
  if (data && data.success) {
    showToast('Template deleted');
    loadTemplates();
  }
}

// ─── Conversations / Stats ──────────────────────────────────────────────

async function loadStats() {
  const data = await apiFetch('/api/admin/maya/stats');
  if (!data || !data.stats) return;
  const s = data.stats;
  document.getElementById('stat-active').textContent = s.active || 0;
  document.getElementById('stat-paused').textContent = s.paused || 0;
  document.getElementById('stat-closed').textContent = s.closed || 0;
  document.getElementById('stat-messages-today').textContent = s.messagesToday || 0;

  // Render active conversations table
  const tbody = document.getElementById('conversations-body');
  const convos = s.activeConversations || [];
  if (convos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color: var(--muted);">No active conversations</td></tr>';
    return;
  }
  tbody.innerHTML = convos.map(c => `
    <tr class="clickable-row" onclick="window.location='/admin/player/${escHtml(c.discord_id)}'">
      <td>${escHtml(c.player_name || c.discord_id)}</td>
      <td><span class="status-dot ${c.status}"></span>${c.status}</td>
      <td>${c.message_count || 0}</td>
      <td>${c.updated_at ? new Date(c.updated_at).toLocaleString() : '-'}</td>
      <td>${c.admin_override ? '<span class="badge badge-paused">Manual</span>' : '<span class="badge badge-active">AI</span>'}</td>
    </tr>
  `).join('');
}

// ─── Voice Transcripts (Phase 2) ────────────────────────────────────────

/**
 * Loads recent voice transcripts from the API with optional filters.
 * Renders them into the #voice-transcripts container.
 */
async function loadTranscripts() {
  const speaker = (document.getElementById('transcript-speaker-filter') || {}).value || '';
  const eventId = (document.getElementById('transcript-event-filter') || {}).value || '';

  const params = new URLSearchParams();
  if (speaker.trim()) params.set('speaker', speaker.trim());
  if (eventId.trim()) params.set('event_id', eventId.trim());
  params.set('limit', '50');

  const data = await apiFetch(`/api/admin/maya/transcripts?${params.toString()}`);
  const container = document.getElementById('voice-transcripts');
  if (!container) return;

  if (!data || !data.transcripts || data.transcripts.length === 0) {
    container.innerHTML = '<p style="color: var(--muted); font-size: 13px;">No transcripts found. Transcripts appear here when the voice worker captures and transcribes speech from Discord voice channels.</p>';
    return;
  }

  container.innerHTML = data.transcripts.map(t => {
    const time = t.spoken_at ? new Date(t.spoken_at).toLocaleString() : 'unknown';
    const eventTag = t.event_id ? `<span class="badge badge-trigger" style="margin-left:4px;font-size:10px;">${escHtml(t.event_id)}</span>` : '';
    return `<div style="margin-bottom: 8px; padding: 6px 8px; border-bottom: 1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
        <strong style="font-size:13px;">${escHtml(t.speaker_name || t.speaker_discord_id)}</strong>
        ${eventTag}
        <span style="font-size:11px;color:var(--muted);margin-left:auto;">${escHtml(time)}</span>
      </div>
      <div style="font-size:13px;color:var(--text);">${escHtml(t.transcript_text)}</div>
    </div>`;
  }).join('');
}

// ─── Utilities ──────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Template Variable Insert (Fix 5) ───────────────────────────────────

/**
 * Tracks the last-focused textarea so variable clicks insert at the right place.
 * @type {HTMLTextAreaElement|null}
 */
let lastFocusedTextarea = null;

/**
 * Inserts a template variable string at the cursor position of the
 * last-focused textarea (opening message or agent instructions).
 *
 * @param {string} varName - The variable string to insert, e.g. '{{player_name}}'
 */
function insertVariable(varName) {
  var textarea = lastFocusedTextarea;
  if (!textarea) {
    // Default to opening message textarea
    textarea = document.getElementById('tpl-opening-message');
  }
  if (!textarea) return;

  textarea.focus();
  var start = textarea.selectionStart;
  var end = textarea.selectionEnd;
  var value = textarea.value;
  textarea.value = value.substring(0, start) + varName + value.substring(end);
  // Place cursor after inserted variable
  var newPos = start + varName.length;
  textarea.selectionStart = newPos;
  textarea.selectionEnd = newPos;
}

// ─── Init ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadPersona();
  loadTemplates();
  loadStats();
  loadTranscripts();

  // Track last-focused textarea for variable insertion (Fix 5)
  var openingMsg = document.getElementById('tpl-opening-message');
  var agentInstr = document.getElementById('tpl-agent-instructions');
  if (openingMsg) openingMsg.addEventListener('focus', function() { lastFocusedTextarea = openingMsg; });
  if (agentInstr) agentInstr.addEventListener('focus', function() { lastFocusedTextarea = agentInstr; });
});
