# Security: Razuvious MC Experience

**Feature:** Experience-based mind control priest auto-assignment for Razuvious  
**Reviewed:** 2026-05-29  
**Reviewer:** Security Gort  
**Verdict:** PASS

---

## Authentication Requirements

| Endpoint | Auth Required | Notes |
|---|---|---|
| `GET /api/razuvious-mc-experience` | None | Read-only, non-sensitive game data. Consistent with existing public endpoints (e.g. Four Horsemen). |
| `POST /api/manual-rewards/:eventId` | `requireManagement` | Hook triggers Razuvious recompute when whitelist matches. Auth pre-existing on this route. |
| `DELETE /api/manual-rewards/:eventId/:entryId` | `requireManagement` | Same as above. |
| `POST /api/assignments/:eventId/confirm` | Discord session (existing) | Razuvious recompute hook placed inside already-authenticated handler. |

## Authorization Rules

- The MC experience table contains only **character names and MC duty counts** — no PII, no financial data, no authentication credentials.
- All write paths (create/delete manual rewards, confirm assignments) require management-level Discord auth via existing `requireManagement` middleware.
- The public GET endpoint is intentionally unauthenticated, matching the established pattern for Four Horsemen experience data.

## Input Validation

### Server-side (`index.cjs`)

| Input | Validation | Location |
|---|---|---|
| `description` (manual reward) | `isRazuviousWhitelistedDescription()`: null check → `String().trim().toLowerCase()` → exact whitelist match | Line ~1734 |
| `characterName` (recompute) | Null check + `String().trim()` + empty string check before any query | Line ~1823 |
| Whitelist values in SQL | Server-side constant (`RAZUVIOUS_MC_REWARD_WHITELIST`). Dynamic SQL uses `$N` parameterized placeholders, never string-interpolates user data | Lines ~1771, ~1842 |

### Client-side (`public/assignments.js`)

- Experience map lookup uses `.toLowerCase()` on character names to normalize casing before comparison.
- `expMap[name] || 0` default safely handles missing entries.
- The entire experience fetch block is wrapped in `try/catch` with fallback to group/slot ordering — no user-visible error leakage.

## SQL Injection Assessment

**CLEAR.** All `pg` queries in the new code use parameterized inputs:

- `seedRazuviousMcExperience`: whitelist array values passed as `$1`, `$2`, `$3` parameters.
- `recomputeRazuviousMcExperience`: character name as `$1`, whitelist as `$2...$N` parameters.
- `GET /api/razuvious-mc-experience`: no user input, static query.

Dynamic SQL string construction is limited to generating `$N` placeholder indices from the whitelist array length — this is a safe pattern (no user-controlled content in the SQL string itself).

## Known Security Considerations

### Pre-existing npm vulnerabilities (not introduced by this feature)

`npm audit` reports 39 vulnerabilities (1 critical, 8 high) across existing dependencies. **Zero new packages** were added by this feature.

Notable pre-existing issues for future maintenance sprints:
- **Critical:** `fast-xml-parser` — multiple DoS/injection CVEs
- **High:** `axios` — SSRF, prototype pollution, header injection chain
- **High:** `lodash` — prototype pollution in `_.template`, `_.unset`, `_.omit`
- **High:** `path-to-regexp` — ReDoS via multiple route parameters
- **High:** `multer` — DoS via resource exhaustion

These are pre-existing and outside the scope of this feature review.

## Audit Logging

Razuvious MC experience recomputes are logged to the server console:
- On error: `❌ [RAZU EXP] Error recomputing for {name}: {message}`
- On hook error (confirmation): `❌ [RAZU EXP] Hook error on confirmation log: {message}`
- On hook error (reward create/delete): `❌ [RAZU EXP] Hook error on manual reward create/delete: {message}`

No sensitive data is included in logs. Character names are game-data only.

---

## Re-review: 2026-05-29 (Post-QA Bug Fixes)

**Dev changes reviewed:**
1. `public/assignments.js` line ~2714: `expMap[String(row.character_name).toLowerCase()]` — added `.toLowerCase()` on expMap key construction. Matches 4H pattern. No security impact.
2. `index.cjs` `recomputeRazuviousMcExperience()` line 1825: `const name = String(characterName).trim().toLowerCase()` — normalizes character name to lowercase before UPSERT, preventing duplicate DB rows. No security impact; still parameterized.

**Verdict:** PASS — no new security issues introduced.
