# Security: DPS/HPS Calculation Feature

**Feature:** Admin player page Avg DPS / Avg HPS calculation  
**Reviewed:** 2026-03-04 (updated v2 post-QA bug fix)  
**Reviewer:** Security Gort  
**Status:** PASS

---

## Authentication Requirements

- All DPS/HPS data is accessed via `/api/admin/player/:discordId`
- Endpoint is protected by `requireManagement` middleware (Discord role-based)
- No unauthenticated access path exists for this data

## Authorization Rules

- Only users with the `management` Discord role can access admin player data
- Discord ID parameter is validated with regex `^[0-9]{1,20}$` before use in queries
- No authorization changes were introduced by this feature

## Input Validation

- `discordId` route parameter: validated as numeric string, max 20 chars
- `dpsValue` / `hpsValue`: default to `0` via `|| 0` in all code paths (client storage, server insert)
- `totalTime` from WCL API: guarded against zero-division with `> 0` check before computing DPS/HPS
- Class names: compared via `LOWER(character_class) IN (...)` — no user-controlled class name used in SQL

## SQL Security

- All admin player queries use parameterized values (`$1`, `$2`, etc.)
- New AVG queries: `AVG(dps_value) WHERE discord_id = $1 AND LOWER(character_class) IN (...)`
- Per-character query: `GROUP BY character_name, character_class WHERE discord_id = $1`
- INSERT: `dps_value` and `hps_value` bound as `$10`, `$11` with `|| 0` fallback
- No string interpolation in any changed SQL

## XSS Prevention

- `public/admin/player.js` uses `esc()` helper for all user-controlled values rendered into HTML
- Numeric DPS/HPS values formatted via `fmtNum()` — no raw HTML injection risk from these fields
- `stats.avgDps` and `stats.avgHps` are parsed as `Math.round(parseFloat(...))` server-side before being sent to client

## Known Security Considerations

- `totalTime` is sourced from the WCL external API — if the API returns an unexpected value (e.g. 0, negative), DPS/HPS defaults to 0 and is excluded from averages by the `> 0` filter. Safe.
- Existing `log_data` rows with `dps_value=0` / `hps_value=0` are excluded from all averages by `> 0` filter. No stale data leaks into metrics.
- `damage_amount` / `healing_amount` columns (raw raid totals) are unchanged and not used for DPS/HPS display.

## Startup Migration Safety

- `ALTER TABLE log_data ADD COLUMN IF NOT EXISTS dps_value/hps_value` runs at `pool.connect()` startup
- Error handling catches `42P01` (table does not exist yet) — safe to run before `ensureLogDataTable()` creates the table
- `IF NOT EXISTS` makes the migration idempotent — safe to re-run on every restart
- No destructive migration operations performed (ADD COLUMN only)

## Dependency Notes

- No new packages were introduced by this feature
- Pre-existing vulnerabilities exist in `fast-xml-parser` (critical, via @aws-sdk), `axios` (high), `multer` (high), `qs` (high), `minimatch` (high)
- These vulnerabilities are unrelated to the DPS/HPS feature and should be addressed in a dedicated dependency-update sprint
