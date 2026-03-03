# Security: Admin Player Profile Page (`/admin/player/:discordId`)

_Last updated: 2026-03-03 by Security Gort_

## Endpoints

| Endpoint | Method | Middleware |
|---|---|---|
| `/admin/player/:discordId` | GET (HTML) | None (frontend auth redirect only) |
| `/api/admin/player/:discordId` | GET | `requireManagement` |
| `/api/admin/player/:discordId/notes` | PATCH | `requireManagement` |

## Authentication & Authorization

- All API endpoints are protected by `requireManagement` middleware
- `requireManagement` checks: `req.isAuthenticated()` (Passport session) + DB lookup for management role
- The static HTML route has **no server-side auth guard** — protection is frontend-only via `fetch('/user')` → redirect to `/` if not management
  - This is consistent with all other admin pages in the codebase (e.g. `/admin`, `/admin/channels`)
  - Risk accepted: the page HTML is not sensitive; all data requires the API which IS guarded
- Frontend double-checks `hasManagementRole` in player.js before rendering any content

## Input Validation

### `discordId` URL parameter
- Regex: `/^[0-9]{1,20}$/` — numeric only, max 20 chars (Discord snowflake max length)
- Applied in **both** GET and PATCH handlers before any DB query
- Returns HTTP 400 with generic error message on failure

### Notes PATCH body
- `field` validated against strict allowlist: `['public_note', 'officer_note', 'custom_note']`
- Returns HTTP 400 listing allowed fields on failure
- `characterName` and `className` required (HTTP 400 if missing)
- `value` sanitized via `|| ''` (null/undefined → empty string)

## SQL Injection Prevention

All queries use parameterized placeholders (`$1`, `$2`, etc.) via `pg` pool.

**Notable case — PATCH notes SQL interpolation:**
```sql
UPDATE guildies SET ${field} = $1, updated_at = NOW() WHERE character_name = $2 AND class = $3
```
- `field` is string-interpolated into the SQL column name
- Safe because `field` is validated against a hardcoded allowlist before use
- All other values use parameterized placeholders

**Subquery patterns used (safe):**
```sql
WHERE LOWER(character_name) IN (
  SELECT LOWER(character_name) FROM guildies WHERE discord_id = $1
  UNION
  SELECT LOWER(character_name) FROM players WHERE discord_id = $1
)
```
All values passed as parameters.

## XSS Prevention (Frontend)

- `esc()` helper uses `div.textContent = str; return div.innerHTML` — browser-native escaping
- Applied to ALL dynamic data inserted via `innerHTML` across every render function
- Exception review: numeric values (level, damage numbers) are used without `esc()` — acceptable as they come from DB columns with numeric types
- WCL log URLs: validated with `/^[a-zA-Z0-9]+$/` before URL construction; then `esc()` on the final URL in the `href` attribute

## Data Exposure

- Email addresses are returned to management users only (behind `requireManagement`)
- Discord IDs are returned — these are non-sensitive identifiers
- `officer_note` (guild officer notes) are exposed to management role users — appropriate for admin page
- Error messages are generic (`'Error fetching player data'`) — no stack traces or query details leaked

## Gold Earned Calculation

_Updated 2026-03-03: Replaced naive equal-split SQL with points-weighted per-raid JS calculation._

The `totalGoldEarned` field is computed post-Promise.all using a JavaScript implementation mirroring `computeTotalsFromSnapshot()` from `public/gold.js`. Security properties:

**Input sources — all from DB, not user-controlled:**
- `charNamesArray`: built from `charactersRes` + `playersRes` rows (already-trusted DB data)
- `eventIds`: built from the attended raids query result

**Query parameterization:**
```js
// All three batch queries use $1 parameterized placeholders
client.query(`... WHERE LOWER(pcl.character_name) = ANY($1)`, [charNamesArray])
client.query(`... WHERE event_id = ANY($1)`, [eventIds])
client.query(`... WHERE raid_id = ANY($1)`, [eventIds])
```
No string interpolation of any user-controlled or external value into SQL.

**aux_json handling:**
- `aux_json` is a JSONB column returned by pg as a parsed JS object
- Read-only: `const aux = r.aux_json || {};`
- Only `aux.is_gold` is accessed; handles boolean `true` and string `'true'`

**Edge cases handled securely:**
- `goldPerPoint === 0` when `adjustedPot === 0` or `totalPointsAll === 0` — no division-by-zero, no NaN
- Negative points clamped via `Math.max(0, points)` before calculation
- `adjustedPot = Math.max(0, sharedPot - manualGoldPayoutTotal)` — no negative pot

**Read-only code path:** The entire gold calculation performs only SELECT queries. No DB writes occur.

## Reward Points Deduplication

```sql
SELECT DISTINCT id, ... FROM rewards_and_deductions_points
WHERE discord_user_id = $1 OR LOWER(character_name) IN (...)
```
- `DISTINCT id` deduplicates on the primary key — safe against double-counting when both conditions match the same row

## Dependency Audit Notes

As of 2026-03-03, `npm audit` reports 23 pre-existing vulnerabilities:
- **1 critical**: `fast-xml-parser` (via `@aws-sdk/client-s3`) — DoS/entity expansion
- **20 high**: axios (proto pollution DoS), multer (DoS), qs (DoS), aws-sdk chain
- **1 low/moderate**: minimatch ReDoS

These vulnerabilities are **pre-existing** and **not introduced by the admin player profile feature**. Recommend scheduling an `npm audit fix` pass in a future sprint. The critical `fast-xml-parser` issue only affects S3/AWS SDK usage (image uploads), not the player profile endpoints.

## CSRF Consideration

No CSRF token is used on the PATCH notes endpoint or role grant/revoke calls. This is consistent with the existing codebase pattern for admin-only actions (same as `/api/management/app-roles/grant`, etc.). The session cookie uses `sameSite: 'lax'` (verify in session config) which mitigates most CSRF vectors. Recommend adding explicit CSRF protection if this app ever expands beyond admin-only writes.
