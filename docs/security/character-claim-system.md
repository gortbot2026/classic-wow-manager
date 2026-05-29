# Security: Character Claim System

**Feature:** Player profile page — character claim system + Maya approval flow  
**Reviewed:** 2026-05-29  
**Status:** PASS  

---

## Authentication Requirements

All **write** endpoints require an active Discord OAuth session (`req.isAuthenticated()`):

| Endpoint | Auth Required | Returns on failure |
|---|---|---|
| `GET /api/my-characters` | ✅ Yes | 401 |
| `GET /api/my-characters/pending-claim` | ✅ Yes | 401 |
| `POST /api/claim-character` | ✅ Yes | 401 |
| `PATCH /api/my-characters/:name/profile` | ✅ Yes | 401 |
| `DELETE /api/my-characters/:name` | ✅ Yes | 401 |
| `GET /api/guildies/search` | ❌ Public (names/classes only) | N/A |
| `GET /api/class-specs` | ❌ Public (class/spec metadata) | N/A |

---

## Authorization Rules

### Character Ownership Verification

Profile edit (`PATCH`) and unlink (`DELETE`) both verify ownership **before** any mutation:

```sql
SELECT character_name FROM guildies
WHERE LOWER(character_name) = LOWER($1) AND discord_id = $2 LIMIT 1
```

Returns `403` if the character is not owned by the session user.

### Claim Conflict Prevention

The claim endpoint enforces a **1-pending-claim-per-user** rule:

```sql
SELECT id, character_name FROM character_claims
WHERE claimant_discord_id = $1 AND status = 'pending' LIMIT 1
```

Returns `409` if a pending claim already exists.

---

## Input Validation Rules

| Field | Validation |
|---|---|
| `character_name` | Required, string, trimmed. `CharName-Realm` format parsed to extract name only. |
| `character_class` | Validated against `class_spec_mappings` (case-insensitive). Returns 400 if unknown. |
| `level` | Must be exactly `60` for unknown character claims. Returns 400 otherwise. |
| `profile_spec` | Truncated server-side to 50 chars via `.substring(0, 50)` |
| `profile_contact` | No server-side length limit (TEXT column). Low risk — authenticated owner only. |
| `profile_notes` | No server-side length limit (TEXT column). Low risk — authenticated owner only. |
| `claim_id` | Parsed via `parseInt(claim_id, 10)` before DB query in `resolveCharacterClaim`. |

---

## SQL Injection Prevention

All database queries use the `pg` parameterized query pattern with `$1`, `$2`, etc.  
No raw string concatenation for user-supplied data exists in any of the claim/profile routes.

---

## XSS Prevention

The frontend (`user-settings.js`) uses a DOM-based `escapeHtml()` utility for all user-provided content rendered into HTML:

```js
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
```

Applied to: `character_name`, `class`, `race`, `rank_name`, `profile_spec`, `profile_contact`, `profile_notes`, Discord `username`, Discord `id`.

---

## Session Security

- Cookie: `sameSite: 'lax'` (CSRF protection for cross-origin navigation)
- Cookie: `secure: true` in production (HTTPS only)
- Secret: loaded from `process.env.SESSION_SECRET` (never hardcoded)
- Store: `connect-pg-simple` (persistent, 90-day TTL)

---

## Secrets & Sensitive Data

- **Discord channel ID `1479091461982126181`** — public snowflake (not a secret). Used for officer notifications only.
- **No API keys or tokens** are hardcoded in any of the changed files.
- Discord `discord_id` returned in `guildies/search` response — acceptable per spec (needed for conflict detection). Does not expose usernames, emails, or tokens.

---

## Maya Management Tool (`resolve_character_claim`)

- Receives `claim_id`, `action`, `decided_by` from officer via management channel
- Verifies claim is `status = 'pending'` before acting — prevents double-processing
- `sendDM` passed via `options.sendDM` from `persona-bot.cjs` call site
- Gracefully handles `options.sendDM` undefined — DM skipped, core action still completes
- Error messages returned to management channel (Maya relays them to officers only — not public)

---

## Schema Initialization (Updated 2026-05-29)

`initializeCharacterClaimsTable()` runs at startup in the `pool.connect().then()` block, matching the pattern of all other `initialize*` functions. Uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — fully idempotent; safe to run on repeat deploys.

**Note:** The function is called twice in the startup block (once without `await`, once with `await`). Harmless due to idempotent queries, but the first call is redundant.

---

## Known Notes (LOW Risk)

1. **No rate limiting on `/api/claim-character`** — the 1-pending-claim-per-user check provides practical protection. Consider express-rate-limit in a future sprint.
2. **`profile_contact` / `profile_notes` unbounded server-side** — only the authenticated owner can write these. DB columns are TEXT. Consider adding maxlength validation in a future sprint.
3. **Pre-existing dependency vulnerabilities** (NOT introduced by this task):
   - `fast-xml-parser`: CRITICAL CVE (entity encoding bypass) — upgrade to ≥5.3.5
   - `axios`: HIGH CVEs (prototype pollution, SSRF) — upgrade to ≥1.16.0
   - `lodash`, `undici`, `socket.io-parser`: HIGH CVEs — upgrade in upcoming sprint

---

## Audit Trail

Character claim actions are recorded in the `character_claims` table:

| Field | Purpose |
|---|---|
| `claimant_discord_id` / `claimant_discord_username` | Who made the claim |
| `status` | Current state: pending / approved / declined |
| `decided_by` | Officer username who resolved it |
| `decided_at` | Timestamp of resolution |
| `existing_discord_id` | Previous owner (for conflict claims) |
