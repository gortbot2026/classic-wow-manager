# Security: WCL Raid Intelligence - Event Summaries & Management Tools

**Feature:** Maya full raid intelligence upgrade (wcl_event_summaries, fight breakdown, deaths, event catalog)
**Reviewed:** 2026-03-06
**Verdict:** PASS

## Authentication Requirements

- `POST /api/admin/generate-event-summary/:eventId` - requires `requireManagement` middleware (management role)
- Management tool functions (fetchEventOverview, fetchFightBreakdown, fetchDeaths) are internal - invoked only through Maya's tool-use flow which requires Discord OAuth session
- Auto-backfill runs server-side at startup with no external input

## Authorization Rules

- Admin backfill endpoint: same requireManagement pattern as all other /api/admin/* endpoints
- Tool functions: guild members interacting with Maya via Discord have OAuth-authenticated sessions
- No anonymous/unauthenticated access to any new endpoint

## Input Validation

- `eventId` in admin endpoint: `String(req.params.eventId || '').trim()`, checked for empty, then used only as parameterized SQL param ($1)
- `player_name` in fetchDeaths: used only for in-memory array filtering via `.includes()`, never interpolated into SQL
- `BigInt(eventId)` in fetchEventOverview: wrapped in try/catch, safe against malformed non-numeric IDs
- All new SQL queries use parameterized placeholders exclusively

## SQL Injection Assessment

No SQL injection risks found. All new queries:
- `SELECT ... FROM wcl_event_pages WHERE event_id = $1`
- `SELECT ... FROM wcl_event_summaries WHERE event_id = $1`
- `SELECT ... FROM wcl_report_meta WHERE report_code = $1`
- `INSERT INTO wcl_event_summaries ... VALUES ($1, $2, $3, ...)`
- getEventList() uses fully static query with no user input interpolation

## Credential / Secret Handling

- No hardcoded secrets in any new files
- R2 bucket name read from `process.env.R2_BUCKET`
- R2 client passed as parameter (s3Client) - uses existing initialized client, no new credential handling
- No new environment variables required beyond what is already configured

## Data Flow Security

- Raw R2 event blobs are fetched server-side only; never returned to clients
- Only the compact summary JSONB is persisted in Postgres (wcl_event_summaries)
- Summary JSONB contains only game data (player names, ability names, amounts) - no credentials or PII
- Maya-facing output strings contain only game-relevant information

## Error Handling Notes

- Admin endpoint returns `err.message` on 500 errors to the calling admin client (LOW risk - admin-only)
- fetchEventOverview/fetchFightBreakdown/fetchDeaths return `Error fetching X: ${err.message}` to Maya, which may surface to Discord
  - LOW risk: err.message may expose internal table names in edge cases; guild members are OAuth-authenticated and trusted
  - Consistent with existing codebase pattern across all fetchX functions

## Dependency Notes (npm audit)

- `fast-xml-parser` (critical): Transitive dep via @aws-sdk/client-s3. Vulnerabilities are DoS in nature (RangeError, entity expansion). In this deployment, S3/R2 responses come from Cloudflare infrastructure (trusted), making exploitation extremely unlikely. Update aws-sdk in a future sprint.
- `multer` (high): Pre-existing, unrelated to this feature. DoS via resource exhaustion on file uploads. Consider updating.
- `qs`, `axios` (various): Pre-existing. Low to moderate DoS risks.

## Audit Logging

No new audit logging added for this feature. The admin backfill endpoint uses console.error for errors but no success audit trail. Consider adding audit logging for admin actions in a future sprint.
