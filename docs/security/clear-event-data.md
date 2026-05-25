# Security: Clear Event Data Endpoint

**Feature:** Clear Data button on logs page  
**Endpoint:** `DELETE /api/event-data/:eventId/clear`  
**Reviewed:** 2026-05-25  

## Authentication Requirements

This endpoint has **no authentication check**, consistent with all other logs page endpoints (`/api/log-data/:eventId`, `/api/rpb-tracking/:eventId`, etc.). The logs page currently operates without session-based auth.

⚠️ **Known Risk:** Any caller who knows an `eventId` can delete all imported data for that event. This is a systemic architectural decision for the logs page, not specific to this endpoint. If auth is added to the logs page in the future, it must be applied uniformly to all `/api/log-data`, `/api/rpb-tracking`, and `/api/event-data` endpoints.

## Authorization Rules

- No user-level authorization (pre-existing pattern for logs page)
- eventId is scoped per-event — a caller cannot affect other events' data without knowing their IDs
- Event IDs come from the RaidHelper integration and are not easily guessable (snowflake-style IDs)

## Input Validation Rules

- `eventId` is checked for empty/whitespace (`if (!eventId || eventId.trim() === '')`) — returns 400
- `eventId` format is not validated beyond non-empty; this is acceptable since it is used exclusively in parameterized SQL queries
- No user-provided body parameters — endpoint only uses the URL path param

## SQL Safety

All 9 DELETE queries use parameterized placeholders (`$1`). No string interpolation. No SQL injection risk.

Tables deleted (in FK-safe order):
1. `sheet_player_abilities` — WHERE event_id = $1
2. `sheet_players_buffs` — WHERE event_id = $1  
3. `sheet_players_frostres` — WHERE event_id = $1  
4. `sheet_imports` — WHERE event_id = $1 (children deleted first for accurate row counts)
5. `log_data` — WHERE event_id = $1
6. `player_role_mapping` — WHERE event_id = $1
7. `player_confirmed_logs` — WHERE raid_id = $1 (note: uses `raid_id` column, not `event_id`)
8. `rpb_tracking` — WHERE event_id = $1
9. `event_endpoints_json` — WHERE event_id = $1

## Transaction Safety

All deletes are wrapped in a single `BEGIN`/`COMMIT` transaction. On any failure, `ROLLBACK` is called — no partial deletes are possible.

## Error Handling

- 400: Empty/missing eventId
- 500: DB error — `error.message` is included in response. This may expose table names on DB errors (e.g. FK violations). Acceptable for this codebase's internal tooling context.

## Audit Logging

Server logs `🗑️ [CLEAR DATA] Starting clear...` and `✅ [CLEAR DATA] Successfully cleared N total rows` with breakdown. Visible in Heroku logs.

## Frontend Security Notes

- `activeEventSession` is read from `localStorage` — not injectable
- Confirmation dialog (`confirm()`) prevents accidental deletion
- Error from API is shown via `alert()` — no DOM injection risk

## Known CVE Notes (Pre-existing, not introduced by this feature)

- `fast-xml-parser` critical CVEs: transitive dep of `@aws-sdk/core`, not in logs code path
- `axios` high CVEs (SSRF/prototype pollution): used for external API calls (RaidHelper, WarcraftLogs), not in logs page flow
- `lodash` high CVEs: prototype pollution in `_.template`/`_.unset` — mitigated by not using user-controlled input as template keys
- `path-to-regexp` high CVE (ReDoS): in Express routing, fixed available via `npm audit fix` — recommend updating in next sprint
