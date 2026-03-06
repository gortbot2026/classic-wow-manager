# Security: Maya @mention Two-Tier Channel Permissions

**Feature:** @Maya mentions in all Discord channels with officer/public tier access control
**Files:** `scripts/persona-bot.cjs`, `scripts/persona-management-context.cjs`
**Reviewed:** 2026-03-06 by Security Gort

---

## Overview

This feature extends Maya to respond to @mentions in any Discord channel the bot can see, with a
two-tier permission system that restricts private player data in public channels.

---

## Authentication Requirements

- `message.author.bot` check is the **first line** of the `messageCreate` handler — all bot
  messages are ignored before any routing logic. Prevents self-reply loops and webhook echo.
- No additional per-user authentication is applied. Channel membership (Discord permissions)
  is the access gate for both officer and public tiers.

---

## Authorization Rules

### Channel Tier Resolution

| Tier | Channels | Tools Available | Private Data |
|------|----------|-----------------|--------------|
| **Officer** | `MAYA_MANAGEMENT_CHANNEL_ID` + `MAYA_OFFICER_CHANNEL_IDS` | `MANAGEMENT_TOOLS` (full) | Full access |
| **Public** | All other channels | `PUBLIC_TOOLS` (excludes `get_player_notes`) | Suppressed |

- Officer channel set is built at startup from env vars into a `Set<string>` — O(1) lookup.
- `getChannelTier(channelId)` is the authoritative source for tier classification.
- **Tier cannot be overridden by user input** — it is set server-side from the channel ID.
- Management channel @mentions are handled by the existing management handler (which fires
  before the @mention route), maintaining zero regression on officer access.

### Private Data Suppression (Public Tier)

`get_player_data` (`fetchPlayerData`) is tier-aware:
- **Public tier:** Queries to `bot_player_notes` and `bot_conversations` / `bot_messages`
  are **entirely skipped** — not just hidden from output. Only `playerContext` and alts data
  are returned.
- **Officer tier:** Full data including notes and conversation summaries.

Cache keys include the tier suffix (`playerData:${discordId}:${tier}`) to prevent cross-tier
cache contamination if an officer-tier response is cached and then served to a public-tier
request.

---

## Input Validation Rules

- **Mention strip regex:** `/<@!?${botId}>/g` — uses the bot's own user ID (from
  `client.user.id` at runtime), not user-supplied input. Safe from regex injection.
- **Rate limiter key:** `${channelId}:${userId}` — both are Discord snowflakes (numeric
  strings assigned by Discord), not user-controlled text. No injection risk.
- **Tool input parameters:** Passed to `executeManagementTool` which dispatches to existing
  validated tool functions. No new SQL constructed from message content.
- **Empty message guard:** After stripping @mention, empty content returns a greeting without
  invoking the LLM tool loop.

---

## Rate Limiting (Public Channels)

- **Per-user cooldown:** 10 seconds per `(channelId, userId)` pair.
- **Enforcement:** Hourglass emoji reaction (⌛) on rate-limited messages — no response text.
- **Stale cleanup:** Entries older than 60 seconds are pruned on each rate-limit check.
- **Officer channels exempt:** Rate limiting only applies to public tier.
- **Per-channel generation lock:** A `Set<channelId>` prevents concurrent LLM calls from the
  same channel. Lock is checked before rate-limit to short-circuit quickly on locked channels.

---

## SQL Injection Analysis

- **No new SQL queries** were introduced in `persona-bot.cjs`.
- In `persona-management-context.cjs`, the refactored `fetchPlayerData` moved existing
  parameterized queries (`$1` placeholders) inside a tier guard block — no query structure
  changed. All queries remain parameterized.
- `executeManagementTool` and all downstream tool functions use the existing pg parameterized
  query pattern throughout.

---

## Sensitive Data in Logs

- Tool calls are logged: `[persona-bot] Mention tool call (tier): toolName({input})` — this
  logs player character names or Discord IDs. These are guild-internal identifiers, not
  secrets. Acceptable for operational debugging.
- Errors use `err.message || err` — does not expose DB schema, SQL, or credentials.
- No API keys, tokens, or passwords are logged anywhere in the new code.

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `MAYA_MANAGEMENT_CHANNEL_ID` | Management (officer) channel | Yes |
| `MAYA_OFFICER_CHANNEL_IDS` | Comma-separated additional officer channel IDs | No |

Both variables are read exclusively from `process.env`. If missing, the system degrades
gracefully (management channel disabled, no extra officer channels).

---

## Known Security Considerations

1. **Prompt injection:** User messages are included in LLM conversation history. A malicious
   user could craft messages to attempt to override Maya's instructions. The tier is set
   server-side and cannot be changed by message content. Risk is LOW — LLM jailbreaks may
   cause Maya to answer oddly but cannot bypass the server-side tier gate on data queries.

2. **TEST MODE (`MAYA_TEST_MODE_DISCORD_ID`):** A Discord user ID for Kim's account is
   hardcoded for DM test mode redirection. This is not a secret credential — it is a
   Discord snowflake used only to redirect DMs during testing. The @mention handler does
   not use TEST MODE redirection (channel responses are not redirected to DMs by design).

3. **Pre-existing CVEs (not introduced by this PR):** `fast-xml-parser` (via @aws-sdk)
   critical DoS CVE, `multer` high DoS CVE, `axios` high DoS CVE, `qs` moderate CVE.
   None relate to this feature. Should be addressed in a future sprint with `npm audit fix`.

---

## Audit Logging

No dedicated audit logging for @mention queries. Officer-tier tool calls are logged to
console (stdout → Heroku logs) with tier label: `[persona-bot] Mention tool call (officer): ...`

Consider adding structured audit logging for officer-tier data access in a future sprint.
