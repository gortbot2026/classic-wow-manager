// candidates.js — Find Candidates page
// Handles class filtering, candidate search, checkbox selection, and Maya outreach.

const pathParts = window.location.pathname.split('/');
const evIdx = pathParts.indexOf('event');
const eventId = evIdx !== -1 && pathParts.length > evIdx + 1 ? pathParts[evIdx + 1] : null;

/** Set of selected discord_id strings for outreach */
const selectedIds = new Set();

/** Cached candidate metadata by discord_id for outreach enrichment */
const candidateMetaCache = new Map();

// On load: set back link + fetch and show event title
document.addEventListener('DOMContentLoaded', async () => {
    const backLink = document.getElementById('back-link');
    if (eventId && backLink) backLink.href = `/event/${eventId}/roster`;

    if (eventId) {
        try {
            const r = await fetch(`/api/roster/${eventId}/title`);
            const d = await r.json();
            const sub = document.getElementById('event-title-sub');
            if (d.title && sub) sub.textContent = d.title;
            document.title = d.title ? `${d.title} — Find Candidates` : 'Find Candidates';
        } catch (_) {}
    }
});

const CLASS_COLORS = {
    warrior: '#c79c6e', paladin: '#f58cba', hunter: '#abd473', rogue: '#fff569',
    priest: '#ffffff', shaman: '#0070de', mage: '#40c7eb', warlock: '#8787ed', druid: '#ff7d0a'
};

const REASON_CONFIG = {
    saved_this_reset: { label: label => `⚔️ Saved to ${label}`, cls: 'reason-saved' },
    already_in_raid:  { label: () => '✅ Already in raid',       cls: 'reason-in-raid' },
    raid_signup:      { label: () => '📋 Signed up / absent',    cls: 'reason-signup' },
    not_on_discord:   { label: () => '❌ Not on Discord',         cls: 'reason-no-discord' }
};

const DUNGEON_LABELS = { naxx: 'Naxx', aq_bwl_mc: 'AQ/BWL/MC', other: 'this instance' };

function escH(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtGold(g) {
    return g > 0 ? Number(g).toLocaleString() + 'g' : '—';
}
function classColor(cls) {
    return CLASS_COLORS[(cls || '').toLowerCase()] || '#d1d5db';
}
function groupByAccount(rows) {
    const out = []; const seen = {};
    rows.forEach(r => {
        const key = r.discord_id || r.candidate_char_name;
        if (!seen[key]) { seen[key] = { account: r, chars: [] }; out.push(seen[key]); }
        seen[key].chars.push(r);
    });
    return out;
}

async function runSearch() {
    if (!eventId) {
        document.getElementById('results').innerHTML = '<p style="color:#f87171;">No event ID in URL.</p>';
        return;
    }
    const checked = Array.from(document.querySelectorAll('#class-picker input:checked')).map(i => i.value);
    if (checked.length === 0) {
        document.getElementById('results').innerHTML = '<p style="color:#f87171;">Please select at least one class.</p>';
        return;
    }
    const weeks = document.getElementById('weeks-select').value;
    // Reset selection state on new search
    selectedIds.clear();
    updateSelectionUI();

    const btn = document.getElementById('search-btn');
    btn.disabled = true; btn.textContent = 'Searching…';
    document.getElementById('results').innerHTML = '<p style="color:#9ca3af;">Searching…</p>';

    const saveZone = document.getElementById('save-zone-select').value;
    const saveZoneParam = saveZone === 'auto' ? '' : `&save_zone=${encodeURIComponent(saveZone)}`;

    try {
        const resp = await fetch(`/api/roster/${eventId}/candidates?classes=${checked.join(',')}&weeks=${weeks}${saveZoneParam}`);
        const data = await resp.json();
        btn.disabled = false; btn.textContent = 'Search';

        if (!data.success) {
            document.getElementById('results').innerHTML = `<p style="color:#f87171;">Error: ${escH(data.message)}</p>`;
            return;
        }

        const dungeonLabel = data.wcl_zone || DUNGEON_LABELS[data.dungeon_type] || null;
        const classLabel = checked.map(c => c[0].toUpperCase() + c.slice(1)).join(' / ');
        const resetDate = fmtDate(data.reset_start);

        // Update event title subtitle if not already set (fallback from search response)
        const sub = document.getElementById('event-title-sub');
        if (data.event_title && sub && !sub.textContent) sub.textContent = data.event_title;

        // Update save-zone dropdown to reflect what was auto-detected
        if (saveZone === 'auto' && data.wcl_zone) {
            const sel = document.getElementById('save-zone-select');
            // Just update the auto label to show what was detected
            sel.options[0].text = `Auto (${data.wcl_zone})`;
        }

        let html = '';

        // ── Candidates ────────────────────────────────────────────────────────
        const cands = data.candidates || [];
        const byAccount = groupByAccount(cands);

        // Cache candidate metadata for outreach enrichment
        candidateMetaCache.clear();
        byAccount.forEach(({ account: a, chars }) => {
            if (a.discord_id) {
                // Use candidate_char_name/class (the searched class we need), NOT last_char (last raid)
                const firstChar = chars.length > 0 ? chars[0] : null;
                candidateMetaCache.set(a.discord_id, {
                    discordId: a.discord_id,
                    charName: (firstChar ? firstChar.candidate_char_name : null) || a.last_char_name || null,
                    className: (firstChar ? firstChar.candidate_class : null) || a.last_char_class || null,
                    lastRaidName: a.last_raid_name || null,
                    lastRaidDate: a.last_raid_date || null
                });
            }
        });

        if (byAccount.length === 0) {
            html += `<p style="color:#9ca3af;">No available candidates found.</p>`;
        } else {
            html += `<div class="results-meta">
                <span><strong>${byAccount.length}</strong> account${byAccount.length !== 1 ? 's' : ''} available</span>
                <span style="color:#6b7280;">Reset started ${resetDate}</span>
                ${dungeonLabel ? `<span style="color:#6b7280;">Save filter: ${dungeonLabel}</span>` : `<span style="color:#f59e0b;">⚠️ Save filter off (unknown instance)</span>`}
            </div>
            <table class="cand-table" id="cand-table">
                <thead><tr>
                    <th class="cb-col"><input type="checkbox" id="select-all-cb" title="Select all" onchange="toggleSelectAll(this)"></th>
                    <th>Discord</th>
                    <th>${classLabel} Character(s)</th>
                    <th>Last raided as</th>
                    <th>Last raid</th>
                    <th class="num">Gold Spent<br><span style="font-weight:400;font-size:10px;">12 months</span></th>
                    <th class="num">Gold Earned<br><span style="font-weight:400;font-size:10px;">12 months</span></th>
                </tr></thead>
                <tbody>`;

            byAccount.forEach(({ account: a, chars }) => {
                const lastColor = classColor(a.last_char_class);
                const charCells = chars.map(c =>
                    `<span style="color:${classColor(c.candidate_class)};font-weight:600;">${escH(c.candidate_char_name)}</span>`
                ).join(' <span style="color:#4b5563;">&middot;</span> ');

                // Only candidates with a discord_id get a checkbox
                const hasDiscord = a.discord_id && a.discord_id.length > 0;
                const cbCell = hasDiscord
                    ? `<td class="cb-col"><input type="checkbox" class="cand-cb" data-discord-id="${escH(a.discord_id)}" onchange="toggleCandidate(this)"></td>`
                    : `<td class="cb-col"></td>`;

                html += `<tr>
                    ${cbCell}
                    <td><strong>${a.discord_id ? `<a href="/admin/player/${escH(a.discord_id)}" target="_blank" style="color:inherit;text-decoration:none;border-bottom:1px dotted #4b5563;" onmouseover="this.style.borderColor='#818cf8'" onmouseout="this.style.borderColor='#4b5563'">${escH(a.discord_username || a.discord_id)}</a>` : escH(a.discord_username || '—')}</strong></td>
                    <td>${charCells}</td>
                    <td>
                        <span style="color:${lastColor}">${escH(a.last_char_name || '—')}</span>
                        ${a.last_char_class ? `<span style="color:#6b7280;font-size:11px;"> (${escH(a.last_char_class)})</span>` : ''}
                    </td>
                    <td>
                        ${escH(a.last_raid_name || '—')}
                        <span class="date-sub">${fmtDate(a.last_raid_date)}</span>
                    </td>
                    <td class="num gold-spent">${fmtGold(a.gold_spent_12mo)}</td>
                    <td class="num gold-earned">${fmtGold(a.gold_earned_12mo)}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }

        // ── Excluded ──────────────────────────────────────────────────────────
        const excl = data.excluded || [];
        if (excl.length > 0) {
            const byAccountExcl = groupByAccount(excl);
            html += `<div class="excl-section">
                <div class="excl-heading"><strong>${byAccountExcl.length} excluded</strong> — matched class &amp; lookback but not available</div>
                <table class="cand-table excl">
                    <thead><tr>
                        <th>Discord</th>
                        <th>${classLabel} Character(s)</th>
                        <th>Last raided as</th>
                        <th>Last raid</th>
                        <th>Reason</th>
                    </tr></thead>
                    <tbody>`;

            byAccountExcl.forEach(({ account: a, chars }) => {
                const lastColor = classColor(a.last_char_class);
                const charCells = chars.map(c =>
                    `<span style="color:${classColor(c.candidate_class)};">${escH(c.candidate_char_name)}</span>`
                ).join(' <span style="color:#374151;">&middot;</span> ');

                const rc = REASON_CONFIG[a.reason] || { label: () => a.reason, cls: '' };
                const reasonText = a.reason === 'saved_this_reset'
                    ? rc.label(dungeonLabel)
                    : rc.label();

                html += `<tr>
                    <td style="color:#9ca3af;">${a.discord_id ? `<a href="/admin/player/${escH(a.discord_id)}" target="_blank" style="color:#9ca3af;text-decoration:none;border-bottom:1px dotted #374151;">${escH(a.discord_username || a.discord_id)}</a>` : escH(a.discord_username || '—')}</td>
                    <td>${charCells}</td>
                    <td>
                        <span style="color:${lastColor}">${escH(a.last_char_name || '—')}</span>
                        ${a.last_char_class ? `<span style="color:#4b5563;font-size:11px;"> (${escH(a.last_char_class)})</span>` : ''}
                    </td>
                    <td>
                        ${escH(a.last_raid_name || '—')}
                        <span class="date-sub">${fmtDate(a.last_raid_date)}</span>
                    </td>
                    <td><span class="reason-badge ${rc.cls}">${escH(reasonText)}</span></td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        }

        document.getElementById('results').innerHTML = html;

    } catch (err) {
        btn.disabled = false; btn.textContent = 'Search';
        document.getElementById('results').innerHTML = `<p style="color:#f87171;">Request failed: ${escH(err.message)}</p>`;
    }
}

// ── Selection state management ────────────────────────────────────────────────

/**
 * Toggles an individual candidate checkbox and updates selection state.
 * @param {HTMLInputElement} cb - The checkbox element with data-discord-id attribute
 */
function toggleCandidate(cb) {
    const id = cb.dataset.discordId;
    if (!id) return;
    if (cb.checked) {
        selectedIds.add(id);
    } else {
        selectedIds.delete(id);
    }
    updateSelectionUI();
}

/**
 * Toggles all visible candidate checkboxes via the header select-all checkbox.
 * @param {HTMLInputElement} headerCb - The select-all checkbox element
 */
function toggleSelectAll(headerCb) {
    const checkboxes = document.querySelectorAll('.cand-cb');
    checkboxes.forEach(cb => {
        const id = cb.dataset.discordId;
        if (!id) return;
        cb.checked = headerCb.checked;
        if (headerCb.checked) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }
    });
    updateSelectionUI();
}

/**
 * Syncs the bottom action bar, count label, and header checkbox state
 * with the current selectedIds set.
 */
function updateSelectionUI() {
    const count = selectedIds.size;
    const bar = document.getElementById('outreach-bar');
    const countEl = document.getElementById('ob-count-num');

    // Update bottom bar visibility and count
    if (bar) {
        if (count > 0) {
            bar.classList.add('visible');
        } else {
            bar.classList.remove('visible');
        }
    }
    if (countEl) countEl.textContent = count;

    // Sync header checkbox state (checked / indeterminate / unchecked)
    const headerCb = document.getElementById('select-all-cb');
    if (headerCb) {
        const allCbs = document.querySelectorAll('.cand-cb');
        const totalCheckable = allCbs.length;
        if (totalCheckable === 0) {
            headerCb.checked = false;
            headerCb.indeterminate = false;
        } else if (count === 0) {
            headerCb.checked = false;
            headerCb.indeterminate = false;
        } else if (count >= totalCheckable) {
            headerCb.checked = true;
            headerCb.indeterminate = false;
        } else {
            headerCb.checked = false;
            headerCb.indeterminate = true;
        }
    }
}

// ── Outreach confirmation and execution ───────────────────────────────────────

/** Shows the confirmation overlay with the current selection count */
function showOutreachConfirm() {
    if (selectedIds.size === 0) return;
    const overlay = document.getElementById('confirm-overlay');
    const msg = document.getElementById('confirm-msg');
    if (msg) msg.innerHTML = `Send Maya outreach to <strong>${selectedIds.size}</strong> player${selectedIds.size !== 1 ? 's' : ''}?`;
    if (overlay) overlay.classList.add('visible');
}

/** Hides the confirmation overlay without changing selection */
function hideOutreachConfirm() {
    const overlay = document.getElementById('confirm-overlay');
    if (overlay) overlay.classList.remove('visible');
}

/**
 * Executes the outreach by POSTing selected discord IDs to the backend.
 * Handles loading state, success toast, and error display.
 */
async function executeOutreach() {
    hideOutreachConfirm();
    if (selectedIds.size === 0 || !eventId) return;

    const btn = document.getElementById('ob-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        // Build candidates metadata from cache for enriched outreach
        const candidatesPayload = Array.from(selectedIds)
            .map(id => candidateMetaCache.get(id))
            .filter(Boolean);

        const resp = await fetch(`/api/roster/${eventId}/outreach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                discordIds: Array.from(selectedIds),
                candidates: candidatesPayload.length > 0 ? candidatesPayload : undefined
            })
        });
        const data = await resp.json();

        btn.classList.remove('loading');
        btn.disabled = false;

        if (!resp.ok || !data.success) {
            showToast(data.message || 'Outreach failed', 'error');
            return; // Keep selection intact for retry
        }

        // Build result message
        const parts = [];
        if (data.sent > 0) parts.push(`Sent ${data.sent}`);
        if (data.skipped > 0) parts.push(`${data.skipped} already had active conversations`);
        if (data.failed > 0) parts.push(`${data.failed} failed`);
        showToast(parts.join(' · ') || 'Done', 'success');

        // Clear selection after successful send
        selectedIds.clear();
        document.querySelectorAll('.cand-cb').forEach(cb => { cb.checked = false; });
        updateSelectionUI();

    } catch (err) {
        btn.classList.remove('loading');
        btn.disabled = false;
        showToast('Request failed: ' + (err.message || 'Network error'), 'error');
    }
}

/**
 * Displays a toast notification that auto-dismisses after 5 seconds.
 * @param {string} message - Toast message text
 * @param {'success'|'error'} type - Visual style
 */
function showToast(message, type) {
    const toast = document.getElementById('outreach-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'outreach-toast visible ' + type;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove('visible');
    }, 5000);
}
