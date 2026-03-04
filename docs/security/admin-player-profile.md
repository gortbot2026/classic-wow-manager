# Security: Admin Player Profile Page (`/admin/player/:discordId`)

_Last updated: 2026-03-04 by Security Gort_

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

## Gold Earned / Gold Spent Per-Event Maps

_Updated 2026-03-04: Extended totalGoldEarned calculation to also produce `goldEarnedByEvent` and `goldSpentByEvent` maps for per-raid gold breakdown on the admin player page._

### goldEarnedByEvent

Built inside the existing async IIFE (previously computing `totalGoldEarned`):
- Keys: `event_id` values from `player_confirmed_logs` query results (DB-sourced, not user input)
- Values: floating-point sums of `v.gold` per event, computed from the points-weighted GDKP formula
- Only events where `eventGold > 0` are included (zero-gold raids omitted)
- Returned as part of the API response JSON

### goldSpentByEvent

Built from `lootRes.rows` (the existing loot query result, no new SQL):
- Keys: `item.event_id` from loot rows (DB-sourced)
- Values: `parseInt(item.gold_amount, 10) || 0` — integer-only, no float risk
- Only positive amounts included (`amt > 0` guard)

### Frontend Rendering

- `playerData.goldEarnedByEvent[r.eventId]` — object lookup, no user input involved
- `playerData.goldSpentByEvent[r.eventId]` — same
- Values formatted with `fmtNum()` + hardcoded `'g'` suffix — no XSS risk
- Both columns sortable via the existing sortRaidHistory() mechanism

### Security Properties

- No new SQL queries — both maps built in-memory from already-fetched result rows
- No user-controlled input flows into key or value construction
- Integer/float arithmetic only — no string concatenation with external data
- Prototype pollution: event IDs are application-generated strings (not `__proto__`/`constructor`) — negligible risk

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

## Class-Colored Character Names (2026-03-04)

### Feature Summary
Character names across the player profile page (Raid History, World Buffs, Frost Resistance, Raid Assignments) are now wrapped in `<span>` elements with inline `color:` styles matching the character's WoW class color.

### Security Properties

**No XSS vectors:**
- All character name text content passes through `esc()` (DOM `div.textContent + div.innerHTML`)
- Inline `color:` values come exclusively from the hardcoded `CLASS_COLORS` / `CLASS_COLORS_LIGHT` maps — never from user input
- Even if `playerData.characters[].class` contains unexpected values, the map lookup returns `undefined`, which causes `classColorSpan()` to fall back to plain `esc(name)` — no injection path

**No CSS injection:**
- `color` attribute value is always a hex string from a hardcoded constant (e.g. `#C79C6E`) — never interpolated from external data
- Character name goes only into `textContent` via `esc()`, not into the `style` attribute

**No SQL changes:**
- This is a pure client-side rendering change; no API endpoints or SQL queries were modified

**charNameToClass lookup:**
- Built from `playerData.characters` (server-controlled, already-fetched data)
- Map key is `c.characterName.toLowerCase()` — no user-controlled injection vector into the Map structure
- Prototype pollution negligible: character names are guild member names, not `__proto__`/`constructor`

**Light-theme fallback:**
- `isDarkMode()` reads `localStorage.getItem('admin-theme')` and `window.matchMedia(...)` — read-only, no injection vector
- Fallback colors (`#AAAAAA` for Priest, `#D4B200` for Rogue) are hardcoded

### Input Validation Rules
- `classColorSpan(name)`: returns `esc(name)` (plain text) if name is falsy, class not in lookup, or class has no color — safe fallback in all edge cases

---

## Raidlogs Link & Character Card Header (2026-03-04)

### Raidlogs Link
- URL pattern: `/event/${encodeURIComponent(r.eventId)}/raidlogs`
- `encodeURIComponent()` applied to eventId — prevents path traversal or XSS via event ID value
- Link opens in `target="_blank"` — no `rel="noopener"` needed for same-origin links; WCL external links already use `_blank`

### Character Card Header Bar
- `classColor` sourced from hardcoded `CLASS_COLORS` map (keyed by WoW class names, values are hex strings)
- Even if `c.class` is a DB value with unusual characters, it can only resolve to a predefined hex color or the default `#888` — no user-controlled CSS injection
- `textColor` is computed locally as `'#1a1a2e'` or `'#fff'` based on luminance — hardcoded strings only
- `classSlug(c.class)` injects class name into HTML `class` attribute (e.g. `class-warrior`). Function only lowercases and replaces spaces — does NOT escape `"` or `>`. Pre-existing pattern; WoW class names are constrained DB values. LOW risk, theoretical only.

### In Raid Column Removal
- Removed misleading column — no security implications; data access unchanged

## CSRF Consideration

No CSRF token is used on the PATCH notes endpoint or role grant/revoke calls. This is consistent with the existing codebase pattern for admin-only actions (same as `/api/management/app-roles/grant`, etc.). The session cookie uses `sameSite: 'lax'` (verify in session config) which mitigates most CSRF vectors. Recommend adding explicit CSRF protection if this app ever expands beyond admin-only writes.
