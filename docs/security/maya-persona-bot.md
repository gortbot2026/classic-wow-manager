# Security: Maya Discord AI Persona Bot

**Feature:** Maya — Discord AI Persona Agent (Phase 1 + 2)  
**Reviewed:** 2026-03-04  
**Verdict:** PASS  

---

## Authentication Requirements

All Maya admin API endpoints are protected by `requireManagement` middleware:

- `GET/POST/PATCH /api/admin/maya/conversations`
- `POST /api/admin/maya/conversations/:id/messages`
- `GET/PATCH /api/admin/maya/persona`
- `GET/POST/PATCH/DELETE /api/admin/maya/templates`
- `GET /api/admin/maya/stats`
- `GET /api/admin/maya/conversations/by-discord/:discordId`

The `/admin/maya-settings` static HTML page is served without server-side auth (consistent with all other admin pages in the codebase). Access to actual data requires management role via session/cookie on all API endpoints.

## Authorization Rules

- **Only management-role users** can view conversation content, send messages as Maya, or configure the persona.
- **Players can only interact via Discord DMs** — they have no direct API access to Maya endpoints.
- Socket.IO `/maya-admin` namespace enforces management role via `hasManagementRoleById(userId)` on connection.

## Bot Safety Controls

- **DM-only**: Bot checks `message.channel.type !== ChannelType.DM` — Maya never responds in guild channels.
- **No self-response**: `message.author.bot` check prevents bot loops and auto-responses to own messages.
- **Conversation gating**: Bot checks `status` and `admin_override` flags from DB before responding — DB-backed, survives restarts.
- **Generation lock**: In-memory `Map<conversationId, boolean>` prevents concurrent LLM calls per conversation (DoS protection). Note: lock resets on dyno restart, but DB status remains authoritative.

## Input Validation

| Field | Validation |
|-------|-----------|
| `discordId` (by-discord route) | Regex `^[0-9]{1,20}$` enforced |
| `status` (PATCH conversation) | Enum check: `['active', 'paused', 'closed']` |
| `trigger_type` (templates) | Enum check: `['post_raid', 'welcome', 'item_won', 'manual']` |
| `content` (admin message) | Non-empty string check |
| `discordId` (POST conversation) | Required check |
| Template required fields | `name`, `trigger_type`, `opening_message`, `agent_instructions` |

**Note:** `model` and `model_override` fields accept arbitrary strings (not validated against an allowlist). Since only management users can set these, risk is low — an invalid model name would cause an Anthropic API error, not a security issue. Consider adding an allowlist (`['claude-haiku-4-5', 'claude-sonnet-4-5']`) in a future sprint.

## SQL Injection

All database queries use parameterized syntax (`$1`, `$2`, etc.) via the `pg` library. Dynamic UPDATE queries in PATCH endpoints build parameterized clauses programmatically — field names are hardcoded constants, only values come from user input. No string concatenation of user data into query strings.

## XSS Prevention

Frontend pages (`player.js`, `maya-settings.js`) use `esc()`/`escHtml()`/`escapeHtml()` helper functions on all user-supplied data before insertion via `innerHTML`. The Maya chat `appendMessage()` function uses `escapeHtml()` for both message content and timestamps.

## Secret Management

All credentials from environment variables only — no hardcoded secrets:
- `PERSONA_BOT_TOKEN` — Discord bot token for Maya
- `ANTHROPIC_API_KEY` — Anthropic Claude API key
- `OPENAI_API_KEY` — OpenAI Whisper API key (Phase 2)
- `VOICE_CHANNEL_ID` — Discord voice channel (Phase 2)

## Auto-Trigger Idempotency

Triggers check for existing non-closed conversations before creating new ones:
- `findOrCreateConversation()` checks `status != 'closed'` — won't create a new conversation for players with existing active conversations.
- `triggerTemplate()` checks for `status = 'active'` OR `status = 'closed'` before firing — skips both.
- This prevents duplicate DMs and respects players who previously closed conversations.

## Audit Logging

Conversation messages stored in `bot_messages` with `role` field (`maya`, `user`, `admin`) providing a full audit trail of who sent what and when. Admin-injected messages clearly marked as `role: 'admin'`.

## Known Notes (Non-Blocking)

1. **`model` field**: No allowlist validation on `model`/`model_override`. LOW risk — management-only access.
2. **Socket.IO userId fallback**: `userId || 'admin'` in player.js — if `<meta name="user-id">` is missing, passes string `'admin'` which correctly fails auth (no DB row). Real-time features won't work if meta tag is absent, but no security bypass possible.
3. **Pre-existing npm vulnerabilities** (not introduced by this PR):
   - `fast-xml-parser`: critical (via @aws-sdk) — ReDoS in numeric entities
   - `axios`: high — prototype pollution in mergeConfig
   - `multer`: high — DoS via incomplete cleanup
   - `minimatch`: high — ReDoS
   - Run `npm audit fix` in a dedicated maintenance sprint

## Phase 2 Voice Worker

`voice-worker.cjs` is a scaffold — full implementation requires installing `@discordjs/voice` and related deps. Key security requirements for Phase 2 implementation:
- Audio data should not be logged or persisted beyond transcripts
- `OPENAI_API_KEY` must be set via env var (already documented)
- Whisper API calls should include timeout handling
- Transcript storage uses parameterized queries (already implemented in scaffold)
