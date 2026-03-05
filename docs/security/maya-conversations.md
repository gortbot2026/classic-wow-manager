# Security: Maya Conversation System

_Last updated: 2026-03-04 by Security Gort_

## Overview

Maya is an AI persona bot that sends Discord DMs to guild players. Conversations are managed entirely through the admin panel and can only be initiated by authenticated management users.

---

## Authentication & Authorization

- **All Maya API endpoints** are protected by `requireManagement` middleware.
- `requireManagement` checks:
  1. `req.isAuthenticated()` — valid session via Passport/Discord OAuth.
  2. `hasManagementRoleById(req.user.id)` — DB lookup confirms management role.
- Unauthenticated requests → 401. Authenticated but non-management → 403.
- **No Maya endpoint is publicly accessible.** All are under `/api/admin/maya/`.

---

## Auto-Trigger Controls

Four auto-trigger call sites are **disabled** (commented out, not deleted) in `index.cjs`:

| Trigger | Location | Status |
|---|---|---|
| Welcome (placeholder conversion) | ~line 13562 | ✅ DISABLED |
| Welcome (roster override insert) | ~line 13708 | ✅ DISABLED |
| Post-raid (snapshot publish) | ~line 20005 | ✅ DISABLED |
| Item-won (loot import) | ~line 24176 | ✅ DISABLED |

Re-enabling: remove the `/* MAYA AUTO-TRIGGER DISABLED */` comment wrappers.

---

## TEST MODE

**File:** `scripts/persona-bot.cjs`, line ~24

```js
const MAYA_TEST_MODE_DISCORD_ID = '492023474437619732';
```

- When set (truthy), ALL outbound Discord DMs are redirected to this user ID.
- This is Kim's Discord ID — a **public, non-sensitive value**. Not a secret.
- **Critical invariant:** Only the Discord API send target is redirected. The `bot_conversations` table always stores the **real player's** `discord_id`. LLM context building uses the real player's data.
- To disable: set the constant to `null` or an empty string before going live.
- **Requires a code change** to disable — no env var toggle. Intentional for dev clarity.

---

## Input Validation

### `POST /api/admin/maya/conversations`

| Field | Validation | Risk |
|---|---|---|
| `discordId` | Required check only (`if (!discordId)`) | LOW — management-only endpoint |
| `templateId` | Optional; used as parameterized `$1` in template lookup | ✅ Safe |
| `openingMessage` | Optional string; stored via parameterized query | LOW — no max-length cap |

**Recommendation:** Add max-length check on `openingMessage` (e.g., 2000 chars) in a future sprint to prevent abnormally large DB inserts.

### Template Status Updates

`PATCH /api/admin/maya/conversations/:conversationId`
- `status` is validated against a whitelist: `['active', 'paused', 'closed']`. Unknown values → 400.
- All SQL uses parameterized placeholders. No string interpolation of user input.

---

## XSS Prevention

- **Template dropdown:** `option.textContent = tpl.name + ...` — uses `textContent`, not `innerHTML`. Safe.
- **409 error banner:** `errorDiv.innerHTML = '⚠️ ...'` — static hardcoded string, no user-controlled data inserted. Safe.
- **General errors:** `errorDiv.textContent = data.message` — uses `textContent`. Safe.
- **Existing player.js code:** Uses `esc()` helper (`textContent` → `innerHTML` pattern) for all server-data rendering.

---

## SQL Injection

All queries in the Maya endpoints use parameterized placeholders (`$1`, `$2`, etc.) via the `pg` pool. No raw string concatenation of user input into SQL.

Examples verified:
- `WHERE discord_id = $1 AND status = 'active'`
- `INSERT INTO bot_conversations ... VALUES ($1, $2, $3, 'active', 'admin', $4)`
- `SELECT opening_message FROM bot_templates WHERE id = $1`
- `INSERT INTO bot_messages (conversation_id, role, content) VALUES ($1, 'maya', $2)`

---

## Dependency Vulnerabilities (Pre-Existing)

**Not introduced by the Maya feature.** Tracked here for visibility.

| Package | Severity | Issue | Notes |
|---|---|---|---|
| `fast-xml-parser` 5.2.5 | CRITICAL | CVE via `@aws-sdk/client-s3` (transitive) | Not directly used by Maya |
| `multer` ≤2.0.2 | HIGH | DoS via incomplete cleanup | File upload feature, not Maya |
| `qs` 6.7.0-6.14.1 | HIGH | DoS via arrayLimit bypass | Express transitive dep |
| `minimatch` | HIGH | ReDoS via nested extglobs | Build/tooling transitive dep |

**Action:** Run `npm audit fix` in a dedicated maintenance sprint. Prioritize `multer` (direct dep, HIGH, DoS). The `fast-xml-parser` critical is transitive via AWS SDK — update `@aws-sdk` packages.

---

## Delete Conversation Endpoint (2026-03-05)

### Feature Summary
- `DELETE /api/admin/maya/conversations/:conversationId` — hard-deletes a conversation and all related records
- FK-safe deletion order: `bot_messages` → nullify `bot_player_notes.source_conversation_id` → `pending_raidleader_summaries` → `bot_conversations`
- Transaction-wrapped: full ROLLBACK on any error prevents partial deletions
- Active conversation guard: returns 400 if `status = 'active'` (must be closed first)
- Socket.io event `maya:conversation-deleted` emitted on `/maya-admin` namespace for cross-tab UI sync

### Authentication & Authorization
- Protected by `requireManagement` middleware — same gate as all other Maya endpoints
- Unauthenticated → 401; authenticated non-management → 403

### Input Validation
- `conversationId` from URL params is used only as `$1` in parameterized queries — no string interpolation
- UUID format is not explicitly validated server-side (LOW risk: parameterization prevents injection; non-existent IDs return 404 cleanly)
- Frontend wraps `conversationId` in `encodeURIComponent()` before inserting into fetch URL — path traversal not possible

### XSS Prevention
- `conversationId` inline in HTML onclick handlers is wrapped with `escapeHtml()` before insertion
- `escapeHtml()` uses the DOM `textContent` assignment trick — safe against all HTML/script injection
- Socket.io event payload (`conversationId` + `discord_id`) contains no secrets or user-controlled HTML

### SQL Injection
- All 5 queries in the DELETE handler use parameterized `$1` placeholders — no raw interpolation

### Error Handling
- 500 response returns generic `"Error deleting conversation"` message — no stack trace or DB error detail exposed to client
- ROLLBACK on error is wrapped in `.catch(() => {})` to prevent secondary throws from crashing the handler

### Known Notes
- `discord_user_id` bug fixed (2026-03-05): SELECT and Socket.io emit originally referenced wrong column name; corrected to `discord_id` matching the actual schema
- Pre-existing npm vulnerabilities unchanged by this feature (23 total, 1 critical: `fast-xml-parser`)

---

## Audit Logging

Maya conversation events are logged to:
- `console.log` via `[maya-api]` and `[persona-bot]` prefixes
- Real-time Socket.io events on `/maya-admin` namespace for admin UI
- All messages stored in `bot_messages` table (conversation_id, role, content)

No sensitive player data (passwords, payment info) is stored in Maya conversations.

---

## Maya Admin UI — Conversation Controls & History Panel (2026-03-04)

### Feature Summary
- Persistent Start/Stop button replacing dynamic addNewConversationButton()
- Removed Pause/Resume/TakeOver buttons — manual AI toggle is now the sole control
- Conversation History panel: collapsible, lazy-loaded, shows all past conversations with transcripts
- New backend: `/generate` endpoint (placeholder), subqueries in `by-discord` endpoint

### Authentication
- All 3 changed endpoints (`/generate`, `/by-discord/:discordId`) use `requireManagement` middleware
- Frontend transcript fetches use `credentials: 'include'` for session auth

### Input Validation
- `discordId` parameter validated via regex `/^[0-9]{1,20}$/` before DB query
- `conversationId` in `/generate` validated via DB existence check (parameterized query) — no explicit UUID format check (LOW risk: DB parameterization prevents injection, errors caught gracefully)

### XSS Prevention
- All user/DB content rendered via `escapeHtml()` (textContent/innerHTML DOM trick)
- Labels for message roles are hardcoded strings (no user-controlled values)
- `conv.status` used directly in CSS class name — LOW risk since values are DB-controlled (active/paused/closed)

### SQL Injection
- All queries use parameterized `$1`, `$2` placeholders via `pg` pool — no interpolation

### Sensitive Data
- Conversation transcripts contain player messages — access gated behind `requireManagement`
- Error messages return generic text, do not expose SQL errors or stack traces to client

### Known Notes
- Pre-existing npm vulnerabilities (23 total, 1 critical: `fast-xml-parser` DoS) — not introduced by this PR, tracked for future sprint

