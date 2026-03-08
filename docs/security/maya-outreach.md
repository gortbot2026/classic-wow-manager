# Security Requirements: Maya Outreach Endpoint

**Feature:** Find Candidates — checkboxes + Maya outreach button (Phase 2 UI)
**Added:** 2026-03-08
**Reviewed by:** Security Gort

---

## Authentication & Authorization

- **Endpoint:** `POST /api/roster/:eventId/outreach`
- **Middleware:** `requireRosterManager` — checks `req.isAuthenticated()` + management or helper role via `hasManagementRoleById` / `hasHelperRoleById`
- **Frontend pages** (`/event/:eventId/candidates`) also gated by `requireRosterManager`
- Unauthenticated → 401; unauthorized → 403

## Input Validation

- `discordIds`: must be a non-empty array where every element is a non-empty string
  - Validated: `Array.isArray(discordIds) && discordIds.length > 0 && discordIds.every(id => typeof id === 'string' && id.length > 0)`
  - Returns 400 if invalid
- `eventId`: URL param, used as metadata context in bot_conversations; not validated against events table (acceptable — roster managers have event access)
- ⚠️ **NOTE:** No maximum batch size enforced. Consider adding `discordIds.length <= 100` cap in a future sprint to prevent accidental abuse.

## SQL Injection

All database queries use parameterized `$1`-style placeholders via `pg`:
- `SELECT id FROM bot_conversations WHERE discord_id = $1 AND status = 'active'`
- `SELECT character_name FROM players WHERE discord_id = $1`
- `INSERT INTO bot_conversations (...) VALUES ($1, $2, $3, ...)`
- `INSERT INTO bot_messages (...) VALUES ($1, 'maya', $2, $3)`

No raw string interpolation into SQL queries.

## XSS Prevention (Frontend)

- All user-supplied data rendered via `escH()` (custom HTML-escape function)
- Confirmation modal uses `innerHTML` with `selectedIds.size` (a JS number) — no XSS vector
- Toast notifications use `textContent` — no XSS vector
- Checkbox `data-discord-id` attribute written via `escH(a.discord_id)` — safe

## Rate Limiting

- DM sends are sequential with a 500ms delay between each to respect Discord rate limits
- No additional server-side rate limit on the endpoint itself (mitigated by `requireRosterManager` access control)

## Error Handling

- Top-level errors return generic `'Error processing outreach'` — no schema leakage
- Per-player errors: `playerErr.message` included in `details[]` response — only visible to roster managers (acceptable)
- Maya bot not connected → 503 with clear `'Maya bot is not connected'` message

## Sensitive Data in Logs

- `console.error` logs include `discordId` and error messages (appropriate for debugging)
- No tokens, passwords, or PII beyond Discord IDs logged

## Bot Template Seed

- Template ID `tpl-candidate-outreach-default` seeded via `ON CONFLICT (id) DO NOTHING` — safe for repeated startup
- `auto_trigger: false` — only triggered explicitly via outreach button, never auto-fires

## Known Notes (Low Risk)

1. No batch size cap on `discordIds` — trusted role mitigates, but consider adding `<= 100` limit
2. Per-player error details (DB error messages) exposed in response `details[]` — only to roster managers
3. Pre-existing npm vulnerabilities in repository (not introduced by this feature): 23 total (1 critical in `fast-xml-parser` via AWS SDK, 20 high). Tracked separately.

