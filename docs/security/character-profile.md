# Security: Character Profile Endpoint

**Endpoint:** `GET /api/my-characters/:characterName/profile`
**File:** `index.cjs` (~line 13184), `public/character-profile.js`
**Last reviewed:** 2026-05-29

---

## Authentication Requirements

- `isAuthenticated()` check at endpoint entry — returns 401 if not authenticated.
- Ownership check: `charRow.discord_id === req.user.id` — only the character's linked Discord user may access.
- Admin override: `hasManagementRoleById(req.user.id)` — management-role admins may also access.
- Returns 403 if neither owner nor admin.

## Authorization Rules

- Character lookup is by `characterName` URL param (case-insensitive LOWER()).
- The endpoint fetches `discord_id` from the `guildies` table and compares against `req.user.id` (from session).
- Admin check uses the existing `hasManagementRoleById` helper — consistent with other protected routes.

## Input Validation

- `characterName` length guard: max 50 characters (returns 400 if exceeded or empty).
- All SQL queries use parameterized values (`$1`, `$2`, etc.) — no user input is string-interpolated.
- Dynamic column name `roleMetric` is derived from server-side logic only:
  - `isDamage ? 'dps_value' : isHealing ? 'hps_value' : null`
  - These values come from a hardcoded class comparison, never from user-supplied input.
  - When `roleMetric` is null, the SQL block is skipped entirely.
- `classPlaceholders` for role class IN-clause are generated from hardcoded `roleClasses` arrays — not from any user-provided value.

## XSS Prevention

All user-facing string values in `character-profile.js` pass through `escapeHtml()`:
- Character name, class, race, rank, profile fields
- Item names, raid names, wowhead links, icon links
- Manual reward descriptions
- Top wins: event names, panel names
- Performance stats: role label, class name

Numeric values (`fmtNum()`, direct numbers) cannot cause XSS.
`typeIcon` in manual rewards table is hardcoded HTML — not user-influenced.
Class color hex (`classColorHex`) is sourced from the internal `class_spec_mappings` table — not user input — and is used in a `style` attribute. If this table were compromised, CSS injection would be possible; however, it is not directly user-writable.

## SQL Security Notes

- All new queries for this feature (lootGoldByEvent, topRankWins, avgDps/avgHps, rankVsRole, rankVsClass) use parameterized `$n` syntax.
- `panel_name IN ('God Gamer DPS', 'God Gamer Healer', 'Damage Dealers', 'Healers')` — hardcoded list, no user input.
- `ranking_number_original = 1` — hardcoded constant, no user input.
- `gold_amount::int` cast in loot aggregation prevents type confusion.

## Error Handling

- Gold calculation errors are caught and logged (`console.error`) with `goldEarned = 0` fallback — no error details exposed to the client.
- Main handler `catch` returns generic `"Error fetching character profile."` — no stack trace or SQL detail in response.
- JSON parse errors for `event_data` are silently swallowed — no leakage.

## Known Assumptions / Scope Notes

- **Paladin excluded from performance stats:** Paladin class has no DPS/HPS tracking in `log_data` (neither damage nor healing group). Returns null for avgDps/avgHps/rankVsRole/rankVsClass. Documented as intentional.
- **Hybrid classes (Paladin, etc.):** Excluded from both role groups; no performance cards shown.
- **`discordId` may be null:** If a character has no linked Discord ID, `manualRewards` query returns an empty result (guarded by `discordId ? client.query(...) : Promise.resolve({ rows: [] })`).

## Dependency Notes (as of 2026-05-29)

Pre-existing vulnerabilities in the project (not introduced by this feature):
- **Critical:** `fast-xml-parser` — transitive dependency via AWS SDK. Not used in the character profile endpoint. Track for resolution in a dedicated dependency-update sprint.
- **High:** `axios` (direct), `multer` (direct) — pre-existing. Not used in this feature's code paths. Requires a separate fix sprint.
- **High:** `lodash`, `minimatch`, `path-to-regexp`, `picomatch`, `socket.io-parser`, `undici` — transitive.

No new packages were added for this feature.
