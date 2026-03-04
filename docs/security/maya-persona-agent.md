# Security Documentation: Maya — Discord AI Persona Agent (Phase 1 + 2)

**Last Updated:** 2026-03-04  
**Reviewed By:** Security Gort  
**Status:** PASS

---

## Authentication Requirements

- All Maya admin API endpoints (`/api/admin/maya/*`) require `requireManagement` middleware.
- `requireManagement` checks Discord OAuth session + `hasManagementRoleById` DB lookup.
- Unauthenticated → 401, authenticated but not management → 403.

## Authorization Rules

- Conversation content (messages, player data) is only accessible to users with the management role.
- Players can never fetch their own conversation metadata via any API endpoint.
- The `/admin/maya-settings` page is served as a static HTML file protected by existing session middleware on admin routes.

## Socket.IO Security

- Namespace `/maya-admin` uses a middleware guard that verifies `hasManagementRoleById(userId)` on connection.
- `userId` is sourced from `socket.handshake.auth.userId` (sent from client meta tag).
- If the meta tag is missing, the client sends `'admin'` as userId — this is a non-existent Discord snowflake, so `hasManagementRoleById` returns false and the connection is rejected. Safe.

## Input Validation

- `discordId` format validated on conversation creation.
- `status` enum validated (active/paused/closed).
- Required fields checked on all write endpoints.
- `model` field accepts arbitrary strings but is management-only (low risk — no code execution path).
- Transcript query: `speaker` param passed as ILIKE `%param%` via parameterized query (safe, no injection).
- Limit clamped between 1–200 on transcript endpoint.

## SQL Injection Prevention

- All DB queries use parameterized `$1/$2` syntax throughout `index.cjs`, `persona-bot.cjs`, `persona-context.cjs`.
- No dynamic string concatenation in SQL. `whereClause` uses only `$N` placeholders built from conditions array.

## XSS Prevention

- All user-derived data rendered in `maya-settings.js` and `player.js` is escaped via `escHtml()` — uses `div.textContent = str; return div.innerHTML` pattern (DOM-safe).
- `onclick` attributes in templates use `t.id` (nanoid — alphanumeric), safe to embed without escaping.

## Discord Bot Security

- Persona bot only responds to `ChannelType.DM` messages (enforced in `handleDM()`).
- `message.author.bot` check prevents self-response loops and bot-to-bot interactions.
- `admin_override` and conversation status are DB-backed (survive dyno restarts).
- In-memory `generationLocks` Map prevents concurrent LLM calls per conversation (DoS protection). Acceptable because DB `status` is the authoritative gate.

## LLM / Prompt Injection

- `system_prompt` is stored in DB, only writable by management users via `PATCH /api/admin/maya/persona`.
- Players have no path to modify or inject into the system prompt.
- `{{player_name}}` template substitution uses `String.replace(/regex/g, value)` — no `eval()`.

## Voice Worker (Phase 2)

- Runs as isolated Heroku worker dyno, no HTTP surface exposed.
- Uses `PERSONA_BOT_TOKEN`, `OPENAI_API_KEY`, `DATABASE_URL` — all from environment.
- Audio data is never stored to disk — buffered in memory, transcribed, discarded.
- OpenAI Whisper API key is only in the worker process environment.
- Speaker display names from Discord guild cache (not user-supplied input).
- `transcript_text` from Whisper is stored as plain text, parameterized into DB.

## Auto-Trigger Idempotency

- All triggers check for existing non-closed conversations before creating new ones.
- Closed conversations are never re-opened by auto-triggers.
- Triggers use `setImmediate()` / async, non-blocking — don't delay primary request.

## Known Pre-Existing Vulnerabilities (Not Introduced by This PR)

| Package | Severity | Notes |
|---------|----------|-------|
| `fast-xml-parser` (via `@aws-sdk`) | Critical | Pre-existing. Not on Maya code path. Schedule update. |
| `axios`, `multer`, `minimatch` | High | Pre-existing. Not on Maya code path. Schedule update. |
| `lodash` | Moderate | Pre-existing. Not on Maya code path. |

**None of these CVEs are introduced by the Maya feature.**

## Recommendations (Future Sprints)

1. Replace `userId || 'admin'` fallback in `player.js` with an explicit error or redirect to login (cosmetic hardening).
2. Add a model field allowlist (`['claude-haiku-4-5', 'claude-sonnet-4-5']`) on the persona/template endpoints even though management-only (defense in depth).
3. Schedule `npm audit fix` to address pre-existing CVEs in `multer`, `minimatch`, `lodash`.
4. Consider rate limiting the transcript viewer to prevent bulk data scraping (even by management users).
