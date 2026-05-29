# Security: Four Horsemen Experience & Auto-Assignment

_Reviewed: 2026-05-29 | Reviewer: Security Gort_

## Feature Overview

- **`four_horsemen_experience` cache table** — tracks historical 4H tanking counts per character
- **Auto-fill rows 5-8** — Classic horsemen grid auto-assigns top-experienced Warriors
- **Alternative tank options panel** — admin-only, shows non-Warrior raid members with Warrior alts that have 4H experience

---

## Authentication Requirements

| Endpoint | Auth Required | Notes |
|---|---|---|
| `POST /api/four-horsemen-experience/seed` | ✅ `requireManagement` | Admin-only, one-off seed |
| `GET /api/four-horsemen-experience` | ❌ Public | Consistent with roster endpoint pattern; no sensitive data |
| `POST /api/guildies/alts-batch` | ✅ `requireManagement` | Admin-only |

**Rationale for public GET:** Character names and tank counts are not sensitive. This matches the existing pattern for public-facing roster endpoints used by the assignment UI.

---

## Authorization Rules

- Admin endpoints use `requireManagement` middleware (server-side enforcement)
- Alternative tank options panel gated client-side by `canManage` — this is display-only; the underlying data is still protected server-side
- `POST /api/guildies/alts-batch` accepts `{ discordIds, characterNames }` — only guildies data returned, no PII beyond character names and classes

---

## Input Validation Rules

### `POST /api/guildies/alts-batch`
- `discordIds` and `characterNames` are filtered to non-empty strings before use in queries
- Both use `ANY($1)` parameterized array binding — no SQL injection risk
- **Note:** No upper-bound array length limit. Acceptable given admin-only access, but worth adding a limit (e.g., max 50) in a future sprint to harden against insider abuse or token theft.

### `recomputeHorsemenExperience(client, characterName)`
- Guards against empty/null input at entry point
- Whitelist comparison: `HORSEMEN_REWARD_WHITELIST` is pre-lowercased; comparison uses `String().trim().toLowerCase()` — no bypass via case or whitespace
- Dynamic IN clause uses proper positional params (`$1, $2, ...`) — no interpolation

### `POST /api/four-horsemen-experience/seed`
- No user-supplied input to the query body; only the pre-defined `HORSEMEN_REWARD_WHITELIST` is parameterized into the CTE

---

## SQL Injection Mitigation

All new queries use parameterized `$N` placeholders:
- `recomputeHorsemenExperience`: `$1` for character name, `$2..$N` for whitelist values
- Seed query: `$1..$N` for whitelist values only (character names come from DB, not user input)
- `alts-batch`: `ANY($1)` array binding for both discord IDs and character names

**No raw string interpolation anywhere in new SQL.**

---

## XSS Mitigation

- `renderAlternativeTankOptions()` uses `row.textContent` exclusively for user-derived data (character names, class names, tank counts)
- `body.innerHTML` is only used with hardcoded static strings (e.g., "No alternative tank options available") — no user data embedded
- This follows the same pattern as the rest of `assignments.js`

---

## JSONB Safety

- `COALESCE(l.server_assignments, '[]'::jsonb)` prevents null array crash in both `recomputeHorsemenExperience` and the confirmation logging hook
- The confirmation hook also guards with `Array.isArray(serverAccepts)` before iterating

---

## Known Considerations

1. **Array size limit missing on `alts-batch`** (LOW risk) — Admin-only endpoint, but no max length guard on input arrays. Could theoretically be abused with a stolen management token to issue expensive bulk queries. Consider adding `if (discordIds.length > 100 || characterNames.length > 100) return 400` in a future sprint.

2. **Pre-existing dependency CVEs** (pre-existing, not introduced by this PR):
   - `fast-xml-parser` CRITICAL — DoS via entity expansion, via `@aws-sdk/client-s3`. Not related to this feature. Recommend `npm audit fix` in a maintenance sprint.
   - `path-to-regexp`, `socket.io-parser`, `undici` HIGH — pre-existing. No fix impact on this feature.

---

## Audit Logging

- Recompute operations log to console: `❌ [4H EXP] Error recomputing for <name>` on failure
- Hooks wrapped in try/catch — failures are swallowed to prevent breaking the parent operation (create/delete reward, confirm assignment). This is correct behavior but means failed recomputes are silent to the user.
