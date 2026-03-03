# Security: Admin Player Profile Page

**Feature:** `/admin/player/:discordId` — comprehensive admin view of a player  
**Status:** In Review (2026-03-03)

---

## Authentication & Authorization

- All API endpoints (`GET /api/admin/player/:discordId`, `PATCH /api/admin/player/:discordId/notes`) are protected by `requireManagement` middleware
- Frontend checks `hasManagementRole` via `/user` endpoint and redirects non-admins to `/`
- Discord ID URL parameter is validated as numeric-only, max 20 chars: `/^[0-9]{1,20}$/`

## Input Validation

### Discord ID parameter
- Validated with regex `/^[0-9]{1,20}$/` before any DB queries
- Applied to both GET and PATCH endpoints

### PATCH note editing (field allowlist)
```js
const ALLOWED_FIELDS = ['public_note', 'officer_note', 'custom_note'];
if (!ALLOWED_FIELDS.includes(field)) return 400;
```
The field name is validated against the allowlist **before** being interpolated into the SQL statement as a column name. This is safe from SQL injection.

### Note value (PATCH body)
- Passed to PostgreSQL as parameterized `$1` — safe from SQL injection
- No length limit enforced — consider adding max length validation in future

## SQL Injection

All backend queries use parameterized `$1`/`$2` placeholders. No raw string interpolation of user input.

Exception: `field` column name in PATCH query is interpolated (`SET ${field} = $1`) but is validated against a 3-item allowlist first — **not user-controlled**.

## XSS

### ✅ `public/admin/player.js` (player profile page)
- Uses a DOM-safe `esc()` function (sets `textContent`, reads `.innerHTML`) throughout all user data rendering
- All data from API is passed through `esc()` before insertion into `innerHTML`

### ⚠️ `public/guild-members.html` (known issue — filed for fix)
- `member.discord_username` is inserted into `innerHTML` via string concatenation **without escaping**
- Fix: Create and use a shared `esc()` helper consistent with `player.js` pattern
- `member.character_name` also unescaped in new admin-link code, though WoW character names are letters-only (low practical risk)

## Guild-Members API Information Exposure

- `GET /api/guild-members` returns `discord_username` for all callers regardless of auth level
- Display is hidden client-side via CSS/JS (`admin-col` columns)
- Server-side filtering of `discord_username` field for non-management users should be considered

## Known Functional Bug (Not Security)

The poll votes query in `GET /api/admin/player/:discordId` uses `pv.discord_id` instead of `pv.voter_discord_id`:
```sql
WHERE pv.discord_id = $1   -- WRONG: column is voter_discord_id
```
This causes a PostgreSQL error, making the entire admin player profile API return 500 for all requests.

## Audit Logging

Role grant/revoke actions are logged in `role_audit` table with actor and timestamp. Note edits are NOT logged — consider adding an audit trail for officer/public note changes.

## Dependency Notes

`fast-xml-parser` (transitive via `@aws-sdk/*`) has known critical CVEs (DoS via entity expansion). Not directly exploitable through this feature, but should be tracked for resolution.
