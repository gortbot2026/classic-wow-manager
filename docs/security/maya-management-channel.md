# Security: Maya Management Channel (`scripts/persona-bot.cjs`)

_Last reviewed: 2026-03-05 by Security Gort_

---

## Overview

This document covers the security requirements for the Maya management channel feature:
1. **Webhook summary posting** — Maya posts pre-raid briefing summaries to a private Discord management channel via webhook.
2. **Management channel watch/respond** — Maya reads and responds to messages in the management channel when addressed by name or @mention.

---

## Authentication & Secrets

- **`MAYA_MANAGEMENT_WEBHOOK_URL`** — loaded exclusively from `process.env`. If missing, webhook posting is silently skipped (no error, no crash).
- **`MAYA_MANAGEMENT_CHANNEL_ID`** — loaded exclusively from `process.env`. If missing, channel watching is silently disabled.
- **No hardcoded secrets** — all credentials in environment variables only.

---

## Authorization

### Management Channel Access
- Access to the management channel is **gated entirely by Discord channel membership** (guild leadership controls who is in that channel).
- No application-level auth layer is required — the management channel is private by Discord channel permissions.
- Maya will respond to **anyone** who can post in that Discord channel. Ensure Discord channel permissions are set correctly.

### Bot Self-Reply Prevention
- `if (message.author.bot) return` is the **first check** in the `messageCreate` handler — prevents all bot-to-bot loops including Maya's own webhook messages.

---

## Input Validation

### Player Name Matching (ReDoS Prevention)
- `lookupPlayersInMessage()` scans for player character names from the database.
- Names are escaped before being inserted into regex: `/[.*+?^${}()|[\]\\]/g` → `\\$&`
- This escaping pattern is **correct and complete** — covers all regex special characters.
- Combined with `\b` word boundaries, the regex is safe from ReDoS attacks.
- Note: If character names ever contain Unicode word-boundary-breaking characters, word boundary behavior may differ. WoW character names are ASCII-only by game rules — this is not a current risk.

### LLM Response Handling
- LLM responses pass through `sanitizeResponse()` (strips em-dashes, null-safe) and `sanitizeForDiscord()` before being sent to Discord.
- Responses are hard-truncated to 2000 characters before `message.channel.send()`.

---

## Webhook Security

- The webhook URL comes from `process.env` — only users with server access can set it.
- A 10-second `AbortController` timeout prevents hanging requests.
- Webhook errors are caught and logged — never propagated to the main flow.
- **No SSRF mitigation beyond env-var trust** — if an attacker can set `MAYA_MANAGEMENT_WEBHOOK_URL`, they already have server compromise. Not a meaningful risk.

---

## Concurrency & Rate Limiting

- `managementChannelLock` (boolean) prevents concurrent LLM calls for the management channel.
- The lock **always releases** in a `finally` block — no permanent lock-up on error.
- If a second message arrives while locked, it is **silently dropped** (no retry, no notification to the user). This is a UX limitation, not a security issue.
- There is **no rate limit beyond the generation lock**. A user can flood the channel with rapid sequential messages (each triggers a response once the previous one completes). LOW risk given this is a private leadership channel.

---

## Data Privacy

- The management system prompt explicitly allows revealing **all player data** including notes, conversations, and raid data. This is by design for the leadership channel.
- Player data (notes, conversation summaries, character info) is injected into the LLM system prompt, **not** stored in `bot_conversations` records. Management interactions are ephemeral.
- Audit logging: management channel interactions are logged to console (`[persona-bot] Management channel: replied to <username>`).

---

## Duplicate Post Prevention

- When a summary is **immediately sent** to a raidleader → webhook posts once.
- When a summary is **queued as pending** (no raidleader) → webhook posts once with `[PENDING]` tag.
- When a pending summary is **later delivered** via `processPendingSummaries()` → webhook does **NOT** post again (no duplicate). This is intentional per spec AC.

---

## Dependency Security (as of 2026-03-05)

No new npm dependencies were introduced by this feature. Pre-existing vulnerabilities (documented in `maya-persona-bot.md`):

| Package | Severity | Notes |
|---------|----------|-------|
| `fast-xml-parser` | CRITICAL | Via @aws-sdk. Not used by persona bot. Fix in future sprint. |
| `multer` | HIGH | File upload DoS. Not in persona bot path. |
| `qs` | HIGH | arrayLimit bypass DoS. Indirect dep. |
| `axios` | HIGH | __proto__ DoS. Indirect dep. |
| `minimatch` | LOW | Dev tooling. |

---

## Security Checklist (Feature: Management Channel Webhook + Watch/Respond)

- ✅ No hardcoded secrets — both new env vars from `process.env` only
- ✅ Input validation — player name regex properly escaped, prevents ReDoS
- ✅ No SQL injection — all queries use parameterized `$1` placeholders
- ✅ Bot message filtering — `message.author.bot` guard prevents self-reply loops
- ✅ AbortController timeout on webhook fetch — prevents hanging requests
- ✅ Management channel generation lock — prevents concurrent LLM abuse
- ✅ Response truncated to 2000 chars — Discord limit enforced
- ✅ Lock releases in finally block — no permanent deadlock on error
- ✅ No duplicate webhook posts — pending summaries post once at queue time, not at delivery
- ✅ No new npm dependencies introduced
