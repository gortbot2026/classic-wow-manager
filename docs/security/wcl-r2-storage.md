# Security: WCL Event Pages — Cloudflare R2 Storage

**Feature:** Migrate `wcl_event_pages.events` JSONB column to Cloudflare R2  
**Reviewed:** 2026-03-03  
**Reviewer:** Security Gort  
**Status:** ✅ PASS

---

## Authentication & Authorization

The WCL event ingestion and analysis endpoints (`/api/wcl/events/ingest`, `/api/wcl/stream-import`, `/api/wcl/summary/*`, `/api/wcl/raw/*`) are **unauthenticated by design** — they are internal/administrative endpoints accessed by guild officers and internal tooling. This is a pre-existing design decision, not introduced by the R2 migration.

If these endpoints are ever exposed publicly, authentication middleware should be added.

---

## Credential Handling

All Cloudflare R2 credentials are loaded from environment variables:

| Variable | Purpose |
|---|---|
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 API token key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | Bucket name (staging vs prod differentiated by env) |

**No credentials are hardcoded.** All new helper functions (`uploadEventsToR2`, `fetchEventsFromR2`, `loadEventPagesFromR2`, etc.) use `process.env.R2_BUCKET` exclusively.

Migration and verification scripts also validate env vars at startup and fail fast if any are missing.

---

## Input Validation

### R2 Key Derivation

R2 object keys follow the format: `wcl-events/{reportCode}/{startTime}_{endTime}.json`

- `reportCode` is validated via `extractWclReportCode()` which enforces `/^[A-Za-z0-9]+$/` — no slashes, dots, or path traversal characters possible.
- `startTime` and `endTime` are numeric timestamps from internal data, not user input.
- **Path traversal to R2 is not possible.**

### SQL Injection Prevention

`loadEventPagesFromR2()` and `loadEventPagesWithMetaFromR2()` accept a `filterColumn` parameter that is used in a SQL query via string interpolation. This is protected by a strict allowlist check:

```js
if (filterColumn !== 'event_id' && filterColumn !== 'report_code') {
  throw new Error(`Invalid filterColumn: ${filterColumn}`);
}
```

The `filterValue` is always passed as a parameterized query argument (`$1`). **SQL injection is not possible** via this path.

---

## Error Handling

R2 fetch errors are propagated as `Error` objects with messages like:
```
Failed to fetch events from R2 key "wcl-events/ABC123/12345_67890.json": <AWS SDK error>
```

These error messages are returned to API clients via `res.status(500).json({ error: ... })`. AWS SDK error messages may include the endpoint hostname but not credentials. **This is LOW risk** — the R2 key path itself contains no sensitive data.

---

## Data Integrity

- **Write path:** R2 upload must succeed before the Postgres metadata row is inserted. Upload failures cause the request to fail (no silent data loss).
- **Live import fallback:** If R2 upload fails during live import SSE, the code falls back to storing events in Postgres. This prioritizes availability but the fallback is logged with `console.error`.
- **Backward compatibility:** Read helpers check `r2_key` first; if null, they use the Postgres `events` column. This allows zero-downtime migration.

---

## Migration Script Security

`scripts/migrate-events-to-r2.cjs`:
- Validates all required env vars at startup
- Uses `FOR UPDATE SKIP LOCKED` for safe concurrent execution
- Uses `ROLLBACK` on transaction errors to prevent partial batch commits
- Supports `DRY_RUN=true` for safe dry runs that skip writes
- Logs progress per batch (no sensitive data in log output)
- Resumable: only processes rows where `r2_key IS NULL AND events IS NOT NULL`

---

## Dependency Notes

The following pre-existing CVEs (not introduced by this PR) should be tracked for future upgrades:

| Package | Severity | Notes |
|---|---|---|
| `fast-xml-parser` | Critical | DoS/ReDoS/entity expansion — not in R2 code path |
| `@aws-sdk/client-s3` | High (via fast-xml-parser) | Inherited — update when AWS SDK releases patch |
| `axios` | High | DoS via `__proto__` key in mergeConfig |
| `minimatch` | High | ReDoS via wildcards |
| `multer` | High | DoS via incomplete cleanup |
| `qs` | High | DoS via arrayLimit bypass in comma parsing (Express query string parsing) |

None of these CVEs are in the new R2 migration code path. Schedule updates in a future sprint.

---

## Existing R2 Export System

The archival R2 export system (`/api/wcl/events/export-r2`, `exportFullEventsToR2`) uses the `events/` key prefix and is completely separate from the primary storage migration (`wcl-events/` prefix). Both systems coexist safely.
