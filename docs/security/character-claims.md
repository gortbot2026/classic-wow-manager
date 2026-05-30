# Security: Character Claims

_Last updated: 2026-05-30 by Security Gort_

## Overview

The character claim system allows guild members to claim ownership of a character, and officers to approve or decline via Discord or the admin web panel.

---

## Authentication & Authorization

| Endpoint | Middleware | Required Role |
|---|---|---|
| `GET /api/admin/character-claims` | `requireManagement` | Management role |
| `POST /api/admin/character-claims/:id/approve` | `requireManagement` | Management role |
| `POST /api/admin/character-claims/:id/decline` | `requireManagement` | Management role |
| `GET /api/my-characters/pending-claim` | Session auth | Any authenticated user |

`requireManagement` checks:
1. `req.isAuthenticated()` — 401 if not logged in
2. `hasManagementRoleById(req.user.id)` — 403 if not management

The admin HTML page (`/admin/character-claims.html`) is served as a static file with no server-side auth gate, consistent with the rest of the admin pages. Data is protected at the API layer. Client-side code handles 401/403 responses gracefully.

---

## Input Validation

- **Claim ID** (`req.params.id`): parsed with `parseInt(req.params.id, 10)`, validated `isNaN || < 1` → 400 response
- **decided_by**: sourced from `req.user.username` (server-side session, not user-supplied)
- All user-supplied data inserted via parameterized queries (`$1`, `$2`, ...)

---

## SQL Injection Prevention

All database queries use the `pg` parameterized query format. No raw string concatenation is used in the new routes.

Example:
```js
client.query('SELECT ... FROM character_claims WHERE id = $1 FOR UPDATE', [claimId])
```

---

## Race Condition Protection

Approve/decline routes use:
- `BEGIN` / `COMMIT` / `ROLLBACK` DB transaction
- `SELECT ... FOR UPDATE` row lock on the claim
- `status !== 'pending'` check inside the lock → 409 if already resolved

This prevents two concurrent officers from double-approving the same claim.

---

## XSS Prevention

Client-side rendering in `character-claims.js` uses a local `escapeHtml()` function:
```js
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```
All user-supplied fields (username, character_name, class, decided_by, status) are escaped before being inserted into `innerHTML`.

---

## Polling Security

The 15-second pending claim polling in `user-settings.js`:
- Uses a relative URL (`/api/my-characters/pending-claim`) — no token in URL
- Relies on session cookie for auth
- Only starts when a pending claim banner is visible
- Clears the interval on resolution (no orphaned polling)

---

## Sensitive Data in Responses

The `GET /api/admin/character-claims` response includes:
- Discord IDs (`claimant_discord_id`, `existing_discord_id`) — acceptable for management context
- Usernames, character names, claim status — operational data for management
- **Does NOT include**: passwords, session tokens, OAuth credentials, or internal secrets

---

## Maya Claim Approval (Discord prompt injection)

The CLAIM APPROVAL prompt section instructs Maya to extract `claim_id` from the claim notification format and call `resolve_character_claim`. Risk notes:
- The LLM extracts the ID; the tool validates it exists as a real pending claim before acting
- `decided_by` comes from Discord's message author display name — cannot be injected by a non-author
- Ambiguous or off-topic messages fall through to normal conversation handling

---

## Known Issues / Future Work

- **Pre-existing dependency CVEs** (not introduced by this feature): `fast-xml-parser` (DoS, CVSS 7.5), `socket.io-parser`, `undici`, `path-to-regexp`. Schedule a dependency update sprint.
- **Admin HTML pages lack server-side auth gate**: consistent with existing codebase pattern. Recommended future improvement: add middleware to redirect unauthenticated users to login for all `/admin/*` routes.
