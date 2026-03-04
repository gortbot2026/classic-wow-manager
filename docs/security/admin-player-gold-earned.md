# Security: Admin Player Page — Gold Earned Calculation

**Feature:** `/api/admin/player/:discordId` — `totalGoldEarned` calculation  
**Card:** Fix: Admin player page gold earned calculation (`cmmb55cbv013413fn445y9epg`)  
**Review Date:** 2026-03-03  
**Reviewed By:** Security Gort  
**Status:** ✅ PASS

---

## Authentication & Authorization

- **Middleware:** `requireManagement` applied to `GET /api/admin/player/:discordId`
- **Check:** `req.isAuthenticated()` → 401 if unauthenticated
- **Check:** `hasManagementRoleById(req.user.id)` → 403 if not a manager
- **Result:** Endpoint is properly gated; no bypass possible

## Input Validation

- **`discordId` path parameter:** Validated with `/^[0-9]{1,20}$/` regex before any DB use
  - Rejects non-numeric, empty, or oversized values with `400 Bad Request`
  - No raw interpolation into SQL — always passed as `$1` parameterized placeholder

## SQL Injection

All new queries in the gold calculation use parameterized placeholders:

```sql
-- Query 1: attended raids
WHERE LOWER(pcl.character_name) = ANY($1)   -- $1 = charNamesArray

-- Query 2: snapshot entries
WHERE event_id = ANY($1)                     -- $1 = eventIds

-- Query 3: confirmed players
WHERE raid_id = ANY($1)                      -- $1 = eventIds
```

Character names are collected from `guildies` and `players` tables (DB-controlled, not user-supplied input at query time). No string interpolation into SQL anywhere in the new code.

## XSS

- Gold calculation produces a numeric integer (`totalGoldEarned`), not HTML
- Rendered as a number in JSON response — no XSS vector

## Data Access

- Reads `rewards_snapshot_events`, `player_confirmed_logs`, `rewards_and_deductions_points`
- All read-only SELECT queries — no mutations in gold calculation path
- `aux_json` field is PostgreSQL JSONB (server-controlled), not user input — no injection risk when parsed

## Error Handling

- Top-level `catch` returns `{ success: false, message: 'Error fetching player data' }` (500)
- Error detail (stack trace) only goes to `console.error` (server logs), never to HTTP response
- No sensitive data leaked in error responses

## Known Pre-Existing Dependency Vulnerabilities

These CVEs exist in the project but are **NOT introduced by this card**:

| Package | Severity | CVE | Notes |
|---|---|---|---|
| `fast-xml-parser` | CRITICAL | GHSA-37qj-frw5-hhjh (+ 3 more) | DoS/entity bypass — not used in gold calculation path |
| `multer` | HIGH | GHSA-xf7r-hgr6-v32p | File upload DoS — not related to this feature |
| `axios` | HIGH | GHSA-43fc-jf86-j433 | DoS via `__proto__` — not related to this feature |
| `minimatch` | HIGH | GHSA-3ppc-4f35-3m26 | ReDoS — likely a transitive dep |

**Recommendation:** Schedule `npm audit fix` in a future sprint to resolve pre-existing CVEs. The fast-xml-parser CRITICAL should be prioritized.

## Security Requirements (for this feature)

1. Admin-only endpoint — always protected by `requireManagement`
2. `discordId` must pass numeric regex before SQL use
3. No user-supplied character names go directly into SQL — always fetched from DB first, then passed as array parameter
4. Gold calculation is read-only — no writes occur
