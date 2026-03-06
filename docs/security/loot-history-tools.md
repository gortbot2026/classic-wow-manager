# Security: Loot History Query Tools

**Feature:** `get_item_history` and `get_player_loot_history` (Maya management channel tools)
**File:** `scripts/persona-management-context.cjs`
**Reviewed:** 2026-03-06 by Security Gort

---

## Authentication Requirements

- Both tools are exposed exclusively through Maya's management channel handler.
- Access is gated by `MAYA_MANAGEMENT_CHANNEL_ID` environment variable in `persona-bot.cjs`.
- Only messages arriving on the designated management channel ID invoke `executeManagementTool`.
- No additional per-user authorization is required beyond Discord channel membership.
- No auth changes were made as part of this feature.

## Authorization Rules

- Channel-level authorization: only Discord users who can post in the management channel can trigger these tools.
- No row-level access control needed — loot data is not user-specific sensitive data; it is guild-internal aggregate information.

## Input Validation Rules

- Both tools validate that the input string is non-empty and non-whitespace before executing SQL.
- Input is `.trim()`-ed before use in SQL parameters and cache keys.
- Case-insensitive partial matching via `ILIKE '%' || $1 || '%'` is safe because `$1` is a parameterized argument — the pg driver handles escaping, so wildcards in user input cannot escape the SQL context.

## SQL Injection Analysis

- **All queries use parameterized inputs ($1).** No string interpolation into SQL.
- The ILIKE `'%' || $1 || '%'` pattern passes user input as a bound parameter — the `%` wildcards are fixed literals in the query template, not user-controlled.
- Result: **No SQL injection risk** in either function.

## Known Security Considerations

### Error Messages (LOW)
- On database error, `err.message` is returned to the Discord channel: `Error fetching item history: <err.message>`.
- PostgreSQL error messages may occasionally reference table/column names.
- **Risk:** LOW — management channel is restricted to guild leadership (trusted users). Not exposed to the public web.
- **Recommendation:** Consider mapping DB errors to generic messages in a future hardening pass.

### Cache Key Safety
- Cache keys use `toLowerCase().trim()` on user input, preventing cache poisoning via case/whitespace variants.
- Cache TTL is 5 minutes (`CACHE_TTL_MS = 300000`), consistent with other management tools.

## Pre-existing Vulnerabilities (Unrelated to this Feature)

The following vulnerabilities exist in the dependency tree and were present before this card:

| Package | Severity | CVE | Via |
|---|---|---|---|
| fast-xml-parser | Critical (9.3) | GHSA-m7jm-9gc2-mpf2 | @aws-sdk/core |
| multer | High | GHSA-xf7r-hgr6-v32p | multer (direct) |
| qs | High | GHSA-w7fw-mjwx-w883 | transitive |

**Action:** These should be addressed in a dedicated dependency-update sprint. Run `npm audit fix` in `/home/ubuntu/wow-workspace` to resolve auto-fixable issues. Note: `fast-xml-parser` and `multer` fixes are available via `npm audit fix`.

## Audit Logging

- These tools are not currently audit-logged at the application level (consistent with other management tools).
- Discord channel history serves as the de-facto audit trail.

---

_Security Gort — reviewed 2026-03-06_
