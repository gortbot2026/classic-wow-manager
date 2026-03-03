# Security Documentation: Admin Player Profile Page

**Feature:** `/admin/player/:discordId` — Aggregated player profile for management  
**Reviewed:** 2026-03-03  
**Status:** PASS

---

## Authentication & Authorization

- **Frontend:** `fetch('/user')` → checks `hasManagementRole` → redirects to `/` for non-admins
- **Backend API (`GET /api/admin/player/:discordId`):** Protected by `requireManagement` middleware
- **Backend API (`PATCH /api/admin/player/:discordId/notes`):** Protected by `requireManagement` middleware
- **Backend API (`POST /api/admin/sync-discord-members`):** Protected by `requireManagement` middleware
- All endpoints return `401 Unauthorized` for unauthenticated requests, `403 Forbidden` for insufficient role

---

## Input Validation

### Discord ID Parameter
- Both API endpoints validate: `/^[0-9]{1,20}$/`
- Rejects non-numeric input and IDs exceeding 20 characters
- Applied **before** any DB query

### Note PATCH Field Allowlist
- The `field` parameter is validated against `ALLOWED_FIELDS = ['public_note', 'officer_note', 'custom_note']`
- Field name is checked **server-side before SQL interpolation**
- Validated before any string interpolation into the SQL query: `UPDATE guildies SET ${field} = $1 ...`

---

## SQL Injection Prevention

- All DB queries use parameterized `$1`, `$2`, ... placeholders (raw `pg` driver)
- The only interpolated value (`field` in PATCH notes) is validated against a 3-item allowlist
- Character-name lookups in subqueries (`LOWER(character_name) IN (...)`) are fully parameterized

---

## XSS Prevention

### Backend (API response)
- Raw DB values returned as JSON — no HTML construction server-side

### Frontend (player.js)
- `esc()` function uses `div.textContent = String(str); return div.innerHTML;` — DOM-based escaping
- All user-supplied data uses `esc()` before `innerHTML` insertion
- WCL log links validated server-side: `/^[a-zA-Z0-9]+$/` before URL construction
- Avatar URLs placed in `src` attributes (not `href`) — no JS execution risk

### Frontend (guild-members.html)
- `escHtml()` function (same textContent pattern) used for all `discord_username`, `discord_id`, and `character_name` in `innerHTML`

### Known Limitation (LOW)
- The `revokeRole()` inline onclick handler passes `role_key` via string concatenation without single-quote escaping. Since role_keys are admin-inserted system values (management/raidleader/officer), practical risk is negligible. Recommend switching to `addEventListener` pattern in a future refactor.

---

## Sensitive Data Handling

- `discord_username` is stripped from `/api/guild-members` response for non-management users **server-side** (object destructuring, not CSS-only)
- `email` only included in player profile (management-only endpoint)
- `officer_note` and `custom_note` only returned through management-gated endpoint
- 500 errors return generic message (`'Error fetching player data'`), no stack traces to client

---

## Discord Sync Function (`syncDiscordGuildMembers`)

- Called on startup (15s delay) and every 6h
- Manual trigger: `POST /api/admin/sync-discord-members` (requireManagement)
- Handles Discord API rate limiting (429 → retry-after)
- Upserts `COALESCE(EXCLUDED.username, discord_users.username)` — never overwrites with null
- Skips bot accounts (`if (user.bot) continue`)
- No rate limiting on manual trigger endpoint — LOW risk (management-only)

---

## Session Security

- `sameSite: 'lax'` — mitigates CSRF for state-changing POST/PATCH endpoints
- `secure: true` in production
- `httpOnly: true` (express-session default)
- Session secret from `process.env.SESSION_SECRET`

---

## Pre-existing Dependency Vulnerabilities (Not introduced by this feature)

| Package | Severity | Direct | Notes |
|---------|----------|--------|-------|
| fast-xml-parser | Critical | No (via @aws-sdk) | Pre-existing, unrelated to this feature |
| multer | High | Yes | Pre-existing file upload dep |
| @aws-sdk/client-s3 | High | Yes | Pre-existing S3 dep |
| minimatch | High | No | Pre-existing transitive dep |
| lodash | Moderate | No | Pre-existing transitive dep |

No new packages were added by this feature (`git diff HEAD~1 package.json` — no changes).

---

## Checklist

- [x] Auth/authz on all endpoints
- [x] Input validation (Discord ID, field allowlist)
- [x] No SQL injection (parameterized queries, allowlist for dynamic field name)
- [x] No XSS (esc()/escHtml() on all user data in innerHTML)
- [x] No hardcoded secrets
- [x] Admin-only data stripped server-side
- [x] Error messages don't leak internals
- [x] WCL URLs sanitized before construction
- [x] poll_votes uses correct column (voter_discord_id)
