# Security: Maya Persona-Context & Conversation Continuity

**Feature:** Maya persona-context data fields + conversation continuity  
**Card:** cmmcimvpn002u13ah3081r0bp  
**Reviewed:** 2026-03-04  
**Verdict:** PASS

---

## Authentication Requirements

All Maya admin endpoints (`/api/admin/maya/*`) are protected by `requireManagement` middleware:
- Calls `req.isAuthenticated()` — returns 401 if not authenticated
- Calls `hasManagementRoleById(req.user.id)` — returns 403 if not management role
- No Maya admin functionality is accessible without a valid session + management role

## Authorization Rules

- Admins can only operate on conversations via the API (management role required)
- `discord_id` used in queries is validated as user-supplied input only for DB lookups — no ownership escalation risk since admins manage all players
- `conversationId` in PATCH/GET is a UUID; mismatched IDs return 404 (not a data leak)

## Input Validation

| Field | Validation |
|-------|-----------|
| `status` in PATCH | Enum check: must be `'active'`, `'paused'`, or `'closed'`. Returns 400 otherwise |
| `conversationId` | UUID string, used only as parameterized query param |
| `discordId` | String, used only as parameterized query param |
| Summary text stored | Truncated to 2000 chars via `.slice(0, 2000)` before DB write |

## SQL Injection Prevention

All queries in modified files (`persona-context.cjs`, `persona-bot.cjs`, `index.cjs`) use parameterized queries (`$1`, `$2`, etc.) exclusively.

The PATCH handler builds an `updates[]` array of **hardcoded strings** (e.g., `status = $1`) and joins them — no user input appears in the SQL template string itself. Parameters are passed separately.

## Known Security Considerations

### Summary Generation (Fire-and-Forget)
- `generateConversationSummary()` is called with `Promise.resolve().then(...).catch(err => console.error(...))`
- The function itself has an internal try/catch
- A failure in summary generation **cannot** affect the conversation close response or crash the server
- Summary is generated with Claude Haiku (claude-haiku-4-5) — no user-controlled prompt injection possible (system prompt is hardcoded)

### Discord Username Fallback
- Fallback query to `discord_users.username` is wrapped in try/catch
- Failure is silently swallowed — non-critical path
- Title-casing is applied to the raw username value (cosmetic only, no security impact)

### charNamesArray Case Sensitivity
- `Array.from(playerCharNames).map(n => n.toLowerCase())` ensures consistent lowercasing
- SQL uses `LOWER(player_name) = ANY($2)` — parameterized array, no injection risk

### XSS
- Persona context output goes to Claude (LLM context text), not rendered HTML — XSS is not applicable
- `player.js` UI button uses `createElement` + `.onclick` — no `innerHTML` with user data

## Audit Logging

No explicit audit logging added in this feature. Management actions (close conversation, start conversation) are implicitly logged via `bot_conversations` table `updated_at` and `status` columns.

## Pre-existing Dependency Vulnerabilities (Not Introduced by This Card)

The following vulnerabilities exist in the dependency tree but were **not introduced** by this feature:

| Package | Severity | CVE | Notes |
|---------|----------|-----|-------|
| `fast-xml-parser` | **Critical** | GHSA-37qj-frw5-hhjh, GHSA-m7jm-9gc2-mpf2, GHSA-jmr7-xgp7-cmfj, GHSA-fj3w-jwp8-x2g3 | Via `@aws-sdk/client-s3` — DoS/injection in XML parsing. Fix available via `npm audit fix`. Track in a separate card. |
| `multer` | High | GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc | DoS via incomplete cleanup. Fix available. Pre-existing. |
| `qs` | High | GHSA-w7fw-mjwx-w883 | DoS via arrayLimit bypass. Pre-existing. |

**Recommendation:** Raise a separate maintenance card to run `npm audit fix` on the dependency tree. Not a blocker for this feature.
