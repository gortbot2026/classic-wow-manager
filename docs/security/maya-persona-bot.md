# Security: Maya Persona Bot (`scripts/persona-bot.cjs`)

_Last reviewed: 2026-03-04 by Security Gort_

---

## Overview

Maya is an AI persona Discord bot that DMs guild players. She connects via `PERSONA_BOT_TOKEN`, listens for DMs, and generates responses via the Anthropic API. This document covers security requirements for the persona bot module.

---

## Authentication & Secrets

- **Discord token** — loaded exclusively from `process.env.PERSONA_BOT_TOKEN`. If missing, the bot disables itself gracefully (no crash, no partial auth).
- **No hardcoded credentials** — all secrets in environment variables only.
- **⚠️ Note:** `MAYA_TEST_MODE_DISCORD_ID` is currently hardcoded as a Discord user ID (not a secret/credential, but a static test routing override). For production hardening, consider moving to `process.env.MAYA_TEST_MODE_DISCORD_ID` so it can be cleared without a code deploy.

---

## Input Validation

### LLM Response Parsing (JSON)
- `handleDM()` attempts `JSON.parse()` on the LLM response to extract `{reply, reaction}`.
- Wrapped in `try/catch` — parse failures fall back to treating the raw string as the reply with no reaction. No crash possible.
- `parsed.reply` must be `typeof === 'string'` before use.

### Emoji Reaction Allowlist
- `parsed.reaction` (a sentiment string from Claude) is **always** resolved through `REACTION_EMOJI_MAP` before being passed to `message.react()`.
- Map has 5 known-good emoji: `funny→😂`, `compliment→❤️`, `agree→👍`, `sad→😢`, `excited→🎉`.
- Any sentiment string not in the map produces `undefined` (falsy) → no reaction. Arbitrary strings from Claude cannot inject arbitrary emoji.
- Only standard Unicode emoji in the map — no custom guild emoji that could fail across servers.

### sanitizeResponse()
- Strips em-dashes (U+2014) and en-dashes (U+2013) from LLM output, replacing with comma.
- Null/undefined/empty string safe: `if (!text) return text` guard at top.
- Applied to both DM replies (`handleDM`) and template opening messages (`triggerTemplate`).

---

## Authorization

### Incoming DMs
- `if (message.author.bot) return` — Maya ignores all bot messages including her own.
- `if (message.channel.type !== ChannelType.DM) return` — only processes DMs, not guild messages.
- Admin-injected messages go through `sendDM()`, not `handleDM()` — reactions and JSON parsing are not applied to admin traffic by architecture.

### Concurrency Lock
- `generationLocks` map prevents concurrent LLM calls per conversation — protects against message flooding and race conditions in DB writes.

---

## Database Security

- All PostgreSQL queries use parameterized placeholders (`$1, $2, ...`) — no raw string interpolation of user data.
- No new queries introduced in the emoji reaction / em-dash feature update.
- `storeMessage()` stores `content` parameterized — player message text cannot inject SQL.

---

## Error Handling

- Errors logged to console with `err.message || err` — no internal stack traces or DB details returned to Discord users.
- `message.react()` failures are caught and warned, never surfaced to the player.
- LLM API failures (`generateResponse`) propagate to the outer try/catch in `handleDM` — logged, not re-thrown to Discord.

---

## Dependency Security (as of 2026-03-04)

| Package | Severity | Type | Notes |
|---------|----------|------|-------|
| `multer` | HIGH | Direct | DoS via incomplete cleanup (GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc). File upload — not in persona bot path. Fix in future sprint. |
| `fast-xml-parser` | CRITICAL | Indirect | Entity encoding bypass / DoS via DOCTYPE (GHSA-m7jm-9gc2-mpf2). Not used by persona bot. Fix in future sprint. |
| `qs` | HIGH | Indirect | arrayLimit bypass DoS (GHSA-w7fw-mjwx-w883). Not used by persona bot. Fix in future sprint. |
| `minimatch` | LOW | Indirect | ReDoS in nested extglobs. Dev tooling only. |

All pre-existing vulnerabilities — none introduced by the em-dash/emoji-reaction update.

---

## Test Mode Consideration

`MAYA_TEST_MODE_DISCORD_ID` is currently hardcoded ON. In this mode:
- All outgoing `sendDM()` calls redirect to the test Discord ID.
- Incoming DMs from the test ID route to the most recently active conversation.
- This means the test user can read all Maya conversation responses during testing.

**Recommendation:** Before production launch, either clear `MAYA_TEST_MODE_DISCORD_ID` to `null` or move it to an env var so it can be disabled without a redeploy.

---

## Security Checklist (Feature: em-dash removal + emoji reactions)

- ✅ No hardcoded secrets in new code
- ✅ JSON parse input validation with graceful degradation
- ✅ No SQL injection — no new DB queries
- ✅ Auth/authz correct — bot check + DM check + admin path excluded by architecture
- ✅ Emoji allowlist — REACTION_EMOJI_MAP gates all `message.react()` calls
- ✅ sanitizeResponse handles null/empty safely
- ✅ No new npm dependencies
