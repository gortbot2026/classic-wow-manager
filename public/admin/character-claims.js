/**
 * Character Claims Admin Page
 *
 * Fetches all character claims from the admin API, renders them in a table,
 * and provides approve/decline actions for pending claims.
 */

(function () {
  'use strict';

  const contentEl = document.getElementById('claims-content');

  /**
   * Escapes HTML special characters to prevent XSS.
   * @param {string} str - Raw string to escape
   * @returns {string} Escaped string safe for innerHTML
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Formats a timestamp into a human-readable date string.
   * @param {string|null} dateStr - ISO date string or null
   * @returns {string} Formatted date or empty string
   */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Returns the CSS class name for a claim status badge.
   * @param {string} status - Claim status (pending, approved, declined)
   * @returns {string} CSS class name
   */
  function statusClass(status) {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'approved': return 'status-approved';
      case 'declined': return 'status-declined';
      default: return '';
    }
  }

  /**
   * Fetches claims from the API and renders the table.
   */
  async function loadClaims() {
    contentEl.innerHTML = `
      <div class="loading-state">
        <i class="fas fa-spinner fa-spin"></i>
        Loading claims...
      </div>
    `;

    try {
      const response = await fetch('/api/admin/character-claims');

      if (response.status === 401) {
        contentEl.innerHTML = '<div class="error-state"><i class="fas fa-lock"></i> Authentication required. Please log in.</div>';
        return;
      }

      if (response.status === 403) {
        contentEl.innerHTML = '<div class="error-state"><i class="fas fa-ban"></i> Management role required to access this page.</div>';
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch claims');
      }

      const claims = await response.json();

      if (claims.length === 0) {
        contentEl.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><br>No character claims found.</div>';
        return;
      }

      renderTable(claims);
    } catch (err) {
      contentEl.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-triangle"></i><br>Error loading claims: ${escapeHtml(err.message)}</div>`;
    }
  }

  /**
   * Renders the claims table from an array of claim objects.
   * @param {Array<Object>} claims - Array of claim objects from the API
   */
  function renderTable(claims) {
    let html = `
      <table class="claims-table">
        <thead>
          <tr>
            <th>Claimant</th>
            <th>Character</th>
            <th>Current Owner</th>
            <th>Status</th>
            <th>Date Submitted</th>
            <th>Decided By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const claim of claims) {
      const ownerDisplay = claim.current_owner_username
        ? escapeHtml(claim.current_owner_username)
        : (claim.existing_discord_id ? `<span class="date-cell">${escapeHtml(claim.existing_discord_id)}</span>` : '-');

      const decidedDisplay = claim.decided_by
        ? `<div class="decided-info"><strong>${escapeHtml(claim.decided_by)}</strong><br>${formatDate(claim.decided_at)}</div>`
        : '-';

      const isPending = claim.status === 'pending';
      const actionsHtml = isPending
        ? `<button class="btn-action btn-approve" data-id="${claim.id}" data-action="approve">Approve</button>
           <button class="btn-action btn-decline" data-id="${claim.id}" data-action="decline">Decline</button>`
        : '';

      html += `
        <tr>
          <td>${escapeHtml(claim.claimant_discord_username)}</td>
          <td><strong>${escapeHtml(claim.character_name)}</strong>${claim.character_class ? ` <span class="date-cell">(${escapeHtml(claim.character_class)})</span>` : ''}</td>
          <td>${ownerDisplay}</td>
          <td><span class="status-badge ${statusClass(claim.status)}">${escapeHtml(claim.status)}</span></td>
          <td class="date-cell">${formatDate(claim.created_at)}</td>
          <td>${decidedDisplay}</td>
          <td>${actionsHtml}</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    contentEl.innerHTML = html;

    // Wire up action buttons
    contentEl.querySelectorAll('.btn-action').forEach(btn => {
      btn.addEventListener('click', handleAction);
    });
  }

  /**
   * Handles approve/decline button clicks.
   * Disables buttons during the request and refreshes the table on success.
   * @param {Event} e - Click event from an action button
   */
  async function handleAction(e) {
    const btn = e.currentTarget;
    const claimId = btn.dataset.id;
    const action = btn.dataset.action;
    const actionLabel = action === 'approve' ? 'Approve' : 'Decline';

    if (!confirm(`${actionLabel} this claim?`)) return;

    // Disable both buttons in this row
    const row = btn.closest('tr');
    const buttons = row.querySelectorAll('.btn-action');
    buttons.forEach(b => { b.disabled = true; });
    btn.textContent = action === 'approve' ? 'Approving...' : 'Declining...';

    try {
      const response = await fetch(`/api/admin/character-claims/${claimId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || `Failed to ${action} claim`);
        buttons.forEach(b => { b.disabled = false; });
        btn.textContent = actionLabel;
        return;
      }

      // Refresh the table to show updated state
      await loadClaims();
    } catch (err) {
      alert(`Error: ${err.message}`);
      buttons.forEach(b => { b.disabled = false; });
      btn.textContent = actionLabel;
    }
  }

  // Initial load
  loadClaims();
})();
