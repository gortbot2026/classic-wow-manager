# Security: Character Profile Feature

**Feature:** `/user-settings/character/:characterName` — character sub-page with loot/gold/raid history  
**Files:** `index.cjs`, `public/character-profile.js`, `public/character-profile.html`, `public/user-settings.css`, `public/user-settings.js`  
**Review date:** 2026-05-29 (Round 1 + Round 2 QA fix)

---

## Authentication Requirements

- All API calls require `req.isAuthenticated()` (session-based, passport-discord)
- Unauthenticated requests → 401

## Authorization Rules

- Endpoint: `GET /api/my-characters/:characterName/profile`
- Authorization check: `charRow.discord_id === req.user.id` (ownership) OR `hasManagementRoleById(req.user.id)` (admin)
- Unauthorized requests → 403
- Character not found → 404

## Input Validation

- `characterName` URL param: max 50 chars, otherwise 400
- All DB lookups use `LOWER()` for case-insensitive matching
- All queries use parameterized `$1` placeholders — no raw concatenation

## SQL Injection Prevention

- `loot_items` query: `WHERE LOWER(li.player_name) = LOWER($1)` — parameterized
- `manual_rewards_deductions` query: `WHERE discord_id = $1` — parameterized
- `roster_overrides` query: `WHERE LOWER(ro.assigned_char_name) = LOWER($1)` — parameterized
- `LEFT JOIN raid_helper_events_cache` (Round 2 fix): joins on `event_id` column — no user input involved

## XSS Prevention

- All user-facing output in `character-profile.js` uses `escapeHtml()` before inserting into DOM
- `raidName` (extracted from `event_data` JSON, Round 2 fix) rendered via `escapeHtml(item.raidName || item.eventId || '-')`
- `wowheadLink`/`iconLink` are admin-set DB values, still wrapped in `escapeHtml()`

## Data Exposure

- `manual_rewards_deductions` returns ALL rewards for the player's `discord_id` (not scoped to one character) — this is intentional per spec; players may have multiple characters
- `classColorHex` sourced from `class_spec_mappings` (admin-controlled, not user input)

## JSON Parsing Safety (Round 2 Fix)

- `event_data` JSON from `raid_helper_events_cache` parsed with `try-catch` + fallback to `null`
- Applied to both loot section and raid history section — no crash risk on malformed data

## Route Order Safety

- `PATCH /api/my-characters/:name/profile` registered BEFORE `GET /api/my-characters/:characterName/profile` — no route conflict

## Known Limitations

- No rate limiting on the profile endpoint — acceptable given auth requirement and internal use
- `characterName` max length is 50 (WoW limit is 12) — slightly permissive but harmless

## Dependency Status (2026-05-29)

- 39 pre-existing vulnerabilities (30 moderate, 8 high, 1 critical) — not introduced by this feature
- No new packages added
