# Security Requirements: Outreach Monitor Panel

**Feature:** Live conversation status panel on /candidates page (Outreach Monitor)
**Added:** 2026-03-08
**Reviewed by:** Security Gort

---

## Authentication & Authorization

- **Endpoint:** `GET /api/roster/:eventId/outreach-monitor`
- **Middleware:** `requireRosterManager` — checks `req.isAuthenticated()` + management or helper role
- Unauthenticated → 401; unauthorized → 403
- Frontend page (`/event/:eventId/candidates`) also gated by `requireRosterManager`
- Monitor polling uses `credentials: 'same-origin'` — session cookie forwarded correctly

## Input Validation

- `eventId`: URL param extracted from `req.params`, cast to `String(eventId)` before use as `$1` SQL parameter — safe
- No user-supplied body or query parameters on this endpoint
- Frontend `eventId` sourced from URL path (`window.location.pathname`) — used only in the fetch URL, then server validates as SQL param

## SQL Injection

All queries use parameterized placeholders:
- `SELECT ... FROM bot_conversations WHERE event_id = $1 ...` — parameterized
- Classifier: `SELECT trigger_type FROM bot_conversations WHERE id = $1` — parameterized
- Classifier: `SELECT role, content FROM bot_messages WHERE conversation_id = $1 ORDER BY sent_at ASC` — parameterized
- Classifier: `UPDATE bot_conversations SET status_flag = $1 WHERE id = $2` — parameterized
- LATERAL JOIN subqueries reference `bc.id` bound internally — no injection path

No raw string interpolation into any SQL query.

## XSS Prevention (Frontend)

All user-generated content rendered with `escapeHtml()` helper (creates a `<div>`, sets `textContent`, returns `innerHTML`):
- `candidate_char_name` — escaped
- `candidate_class` — escaped
- `last_message_text` (first 40 chars of player message) — escaped

**LOW RISK NOTES (non-blocking):**
- `data-status="${status}"` attribute is not HTML-escaped. However, `status` is derived from `c.status_flag || 'none'`, and `status_flag` is only ever written by the classifier which validates output against `['ACCEPTED','DECLINED','PENDING']` and lowercases. No user-controlled path to this value.
- `href="/admin/player/${c.discord_id}"` is not HTML-escaped. Discord IDs are numeric Snowflakes (18-19 digit integers), making XSS injection practically impossible.

## Async Classifier Security

- Fires as fire-and-forget with `.catch()` — never blocks the Maya reply pipeline
- Verifies `trigger_type === 'candidate_outreach'` before classifying — exits early for all other conversation types
- Validates classifier output against `['ACCEPTED','DECLINED','PENDING']` allowlist before writing to DB
- Unknown/unexpected LLM output defaults to `'pending'` with a warning log
- Uses existing `generateResponse()` — no new API keys or credentials

## Error Handling

- API error: logs `err.message` to server console, returns `{ conversations: [] }` — no schema or stack trace leakage
- Frontend: poll errors silently ignored (non-critical monitor) — no error exposed to user
- Classifier errors: logged with `console.error` but swallowed — never crash bot or affect conversations

## Sensitive Data

- Response includes: `discord_id`, `candidate_char_name`, `candidate_class`, `status_flag`, `msg_count`, first 40 chars of `last_message_text`, `last_message_sender`
- All fields appropriate for roster manager access — same data visible elsewhere on the candidates/roster pages
- No tokens, passwords, or sensitive system info in logs or responses

## Database Migration

- `ALTER TABLE bot_conversations ADD COLUMN IF NOT EXISTS status_flag TEXT DEFAULT NULL` — safe idempotent migration in `ensureBotTables()`
- Consistent with existing migration pattern in the codebase

## Dependency Check

- No new npm packages introduced by this feature
- Pre-existing audit findings (23 total: 1 critical `fast-xml-parser` via AWS SDK dep, 20 high) — not related to this feature; tracked separately for future sprint

## Known Notes (Low Risk)

1. `data-status` attribute not HTML-escaped — acceptable, value is classifier-enum only
2. `discord_id` in card href not HTML-escaped — acceptable, Discord IDs are numeric only
3. Pre-existing npm vulnerabilities — not introduced by this feature
