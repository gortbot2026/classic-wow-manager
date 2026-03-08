// candidates.js — Find Candidates page

const pathParts = window.location.pathname.split('/');
const evIdx = pathParts.indexOf('event');
const eventId = evIdx !== -1 && pathParts.length > evIdx + 1 ? pathParts[evIdx + 1] : null;

// Set back link
document.addEventListener('DOMContentLoaded', () => {
    const backLink = document.getElementById('back-link');
    if (eventId && backLink) backLink.href = `/event/${eventId}/roster`;
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
    const btn = document.getElementById('search-btn');
    btn.disabled = true; btn.textContent = 'Searching…';
    document.getElementById('results').innerHTML = '<p style="color:#9ca3af;">Searching…</p>';

    try {
        const resp = await fetch(`/api/roster/${eventId}/candidates?classes=${checked.join(',')}&weeks=${weeks}`);
        const data = await resp.json();
        btn.disabled = false; btn.textContent = 'Search';

        if (!data.success) {
            document.getElementById('results').innerHTML = `<p style="color:#f87171;">Error: ${escH(data.message)}</p>`;
            return;
        }

        const dungeonLabel = data.wcl_zone || DUNGEON_LABELS[data.dungeon_type] || 'this instance';
        const classLabel = checked.map(c => c[0].toUpperCase() + c.slice(1)).join(' / ');
        const resetDate = fmtDate(data.reset_start);

        let html = '';

        // ── Candidates ────────────────────────────────────────────────────────
        const cands = data.candidates || [];
        const byAccount = groupByAccount(cands);

        if (byAccount.length === 0) {
            html += `<p style="color:#9ca3af;">No available candidates found.</p>`;
        } else {
            html += `<div class="results-meta">
                <span><strong>${byAccount.length}</strong> account${byAccount.length !== 1 ? 's' : ''} available</span>
                <span style="color:#6b7280;">Reset started ${resetDate}</span>
                ${data.dungeon_type !== 'other' ? `<span style="color:#6b7280;">Instance: ${dungeonLabel}</span>` : ''}
            </div>
            <table class="cand-table">
                <thead><tr>
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

                html += `<tr>
                    <td><strong>${escH(a.discord_username || a.discord_id)}</strong></td>
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
                    <td style="color:#9ca3af;">${escH(a.discord_username || a.discord_id || '—')}</td>
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
