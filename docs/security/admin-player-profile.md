# Security: Admin Player Profile Page (/admin/player/:discordId)

_Reviewed by Security Gort — 2026-03-03_

## Authentication Requirements

- All API endpoints (`GET /api/admin/player/:discordId`, `PATCH /api/admin/player/:discordId/notes`) are protected by `requireManagement` middleware.
- Frontend (`public/admin/player.html`) checks `fetch('/user')` → `hasManagementRole` and redirects non-admins to `/` on load.
- Unauthenticated requests to the API receive 401; non-management users receive 403.

## Authorization Rules

- Only users with the `management` role (verified server-side via `requireManagement`) may access any player profile data or modify notes.
- Guild-members API strips `discord_username` server-side (not just CSS) for non-management users to prevent data leakage.

## Input Validation

### Discord ID parameter
- Both `GET /api/admin/player/:discordId` and `PATCH /api/admin/player/:discordId/notes` validate: `/^[0-9]{1,20}$/`
- Rejects non-numeric or overly long Discord IDs with HTTP 400.

### Note editing (`PATCH /api/admin/player/:discordId/notes`)
- `field` parameter validated against allowlist: `['public_note', 'officer_note', 'custom_note']` before SQL interpolation.
- `characterName` and `className` are passed as parameterized query arguments ($2, $3) — no injection risk.
- Returns 400 for invalid field names, 404 if character not found.

### WCL log_id in URL construction
- Validated with `/^[a-zA-Z0-9]+$/` before use in URL construction. Null returned (no link rendered) if validation fails.

## XSS Prevention

### Backend (index.cjs)
- All API responses return JSON data; no HTML construction server-side for this feature.

### Frontend (public/admin/player.js)
- All user-supplied data rendered via `esc()` helper, which uses `div.textContent = str; return div.innerHTML` — textContent-based escaping, safe against XSS.
- Applied to: username, discordId, email, authProvider, character names, class, race, faction, buff names, poll questions, event IDs, role keys, assignment text, etc.
- No innerHTML assignments with raw unescaped user data anywhere in player.js.

### Frontend (public/guild-members.html)
- `escHtml()` helper (same textContent-based pattern) applied to all user data rendered via innerHTML: `character_name`, `discord_username`, `discord_id`.

## SQL Injection Prevention

- All database queries use parameterized placeholders (`$1`, `$2`, etc.) via the `pg` library.
- The only column name interpolated into SQL is `field` in the PATCH notes endpoint, which is validated against a 3-item allowlist before use.
- Poll votes query uses correct column `pv.voter_discord_id` (fixed from `pv.discord_id`).

## Error Handling

- Role grant/revoke/list endpoints return generic error messages, not `e.message`, preventing stack trace/DB schema leakage.
- PATCH notes endpoint returns generic "Error updating note" on 500.
- `console.error` logs full error stack server-side for debugging without exposing to clients.

## Known Security Considerations

- **Pre-existing dependency CVEs** (not introduced by this feature): `fast-xml-parser` (critical, AWS SDK), `multer` (high, file uploads), `axios` (high), `minimatch` (high), `qs` (high), `lodash` (moderate). None are directly exploitable via this feature. Track for future sprint updates.
- Player profile page is read-only (except note editing). No financial transactions, no auth state changes, low-blast-radius endpoint.
- Role grant/revoke buttons on the profile page use existing, separately-secured management API endpoints.

## Audit Logging

- Role grants and revocations performed via the profile page are recorded in `role_audit` table via `auditRoleChange()`.
- Note edits are not individually audited (low sensitivity), but `updated_at` timestamp is updated on each change.
