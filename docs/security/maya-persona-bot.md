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

## Initialization Resilience (Decoupling Fix — 2026-03-04)

Maya bot startup is decoupled from Socket.IO site-chat initialization in `index.cjs`. Both run as independent try/catch blocks inside the same async IIFE:

**Block 1 — Socket.IO + maya-admin namespace** (may fail due to SSL/network errors):
- If this block fails, `app.get('io')` returns `undefined`.
- `maya-admin` namespace auth middleware is correctly inside this block (requires a live `io` instance).

**Block 2 — Maya persona bot** (runs unconditionally after Block 1):
- Calls `createPersonaBot({ pool, io: app.get('io') })`.
- When `io` is `undefined`, `emitToAdmin()` in `persona-bot.cjs` returns early (`if (!io) return`) — no crash.
- All core Maya functionality (Discord DMs, LLM responses, DB persistence) is unaffected without Socket.IO.
- Real-time admin dashboard updates degrade gracefully to no-ops.

**Security properties preserved:**
- `PERSONA_BOT_TOKEN` still sourced from environment variable only.
- Auth middleware on `/maya-admin` namespace unchanged.
- Error messages in catch blocks log `err.message` only — no stack traces, no credential leakage.
- No new packages, no new user input surfaces, no query changes.

## Known Notes (Non-Blocking)

1. **`model` field**: No allowlist validation on `model`/`model_override`. LOW risk — management-only access.
2. **Socket.IO userId fallback**: `userId || 'admin'` in player.js — if `<meta name="user-id">` is missing, passes string `'admin'` which correctly fails auth (no DB row). Real-time features won't work if meta tag is absent, but no security bypass possible.
3. **Pre-existing npm vulnerabilities** (not introduced by this PR):
   - `fast-xml-parser`: critical (via @aws-sdk) — ReDoS in numeric entities
   - `axios`: high — prototype pollution in mergeConfig
   - `multer`: high — DoS via incomplete cleanup
   - `minimatch`: high — ReDoS
   - Run `npm audit fix` in a dedicated maintenance sprint

## Template Variable System (2026-03-04)

Feature: Maya — Expand template variables (gold, raids, guild status)  
Reviewed: 2026-03-04 | Verdict: PASS

### Architecture

`resolveTemplateVariables(pool, discordId, eventId, conversationId)` in `scripts/persona-context.cjs`:
- Runs all DB queries in parallel via `Promise.all()`
- Returns `Map<string, string>` — all values guaranteed to be strings, never null/undefined
- Used in: `triggerTemplate()` (persona-bot.cjs), `buildContext()` (persona-bot.cjs), admin create-conversation (index.cjs)

`applyTemplateVariables(text, variableMap)`:
- Single-pass `text.replace(/\{\{(\w+)\}\}/g, ...)` — regex-safe, only matches word characters
- Unresolved variables left as-is (no data exposure from missing vars)

### SQL Injection (VERIFIED CLEAN)

All 9+ queries in `resolveTemplateVariables` use positional parameters:
- `$1`, `$2` for scalar values
- `ANY($1)` for array values (charNamesArray) — parameterized, no concatenation
- `computeGoldFromEntries()` operates entirely on in-memory JS arrays after DB fetch — no additional queries

### Authentication & Authorization

- Admin create-conversation endpoint: `requireManagement` middleware (checks `isAuthenticated()` + management role)
- Template triggers in `triggerTemplate()`: internal bot function, called only from post-raid automation — no external entry point
- `buildContext()`: called from within the bot's Discord message handler — requires existing conversation in DB

### Input Validation

| Field | Source | Validation |
|-------|--------|-----------|
| `discordId` (admin create-conversation) | `req.body` | Presence check only (`if (!discordId)`) — LOW risk behind requireManagement |
| `discordId` (by-discord route) | `req.params` | Format validated: `/^[0-9]{1,20}$/` |
| `eventId` | DB (bot_conversations.event_id) or internal trigger parameter | Trusted source, no user-controlled input |
| `conversationId` | Internal UUID | Controlled by server, not user-supplied |

**Note (LOW risk):** `discordId` at `POST /api/admin/maya/conversations` uses presence-only check. All downstream queries are parameterized so no injection risk, but format validation (`isValidDiscordId`) would be cleaner. Recommend aligning with other endpoints in a future sprint.

### Null Safety (VERIFIED)

- All 18 variables have explicit string defaults in the `catch` block
- Numeric values default to `"0"`, text to `"unknown"`, guild join date to `"Not in 1Principles Guild"`
- `formatDate()` returns `"unknown"` for invalid/null dates
- `String(Number(x) || 0)` pattern used consistently for DB numeric aggregates

### Prompt Injection (LOW risk, noted)

Character names, raid names, and other string fields from DB are injected into the LLM system prompt. Requires DB write access to exploit — not accessible to regular players. No sanitization applied to DB-sourced values before prompt injection; this is consistent with the existing `buildPlayerContext()` pattern.

### Dependency Check (Pre-existing, not introduced by this PR)

No new packages added. Pre-existing vulnerabilities remain (see Known Notes below).

---

## Phase 2 Voice Worker

`voice-worker.cjs` is a scaffold — full implementation requires installing `@discordjs/voice` and related deps. Key security requirements for Phase 2 implementation:
- Audio data should not be logged or persisted beyond transcripts
- `OPENAI_API_KEY` must be set via env var (already documented)
- Whisper API calls should include timeout handling
- Transcript storage uses parameterized queries (already implemented in scaffold)
