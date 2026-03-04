# Security: Maya Discord Output Sanitization

**Feature:** Maya persona bot — Discord message output  
**File:** `scripts/persona-bot.cjs`  
**Last reviewed:** 2026-03-04 (v2 — "Teach Maya Discord formatting") by Security Gort

---

## Overview

Maya is a Discord DM bot powered by Anthropic Claude. She uses a PostgreSQL-backed conversation store and sends AI-generated replies to guild members via Discord DMs.

## Authentication Requirements

- Bot authenticates to Discord via `PERSONA_BOT_TOKEN` environment variable
- No token = bot disabled gracefully (no crash)
- Admin Socket.IO namespace (`/maya-admin`) is handled by the main Express app's auth layer (not in this file)

## Authorization Rules

- Maya only responds to DMs (ignores guild messages)
- Maya ignores bot accounts (`message.author.bot` check)
- `admin_override` flag: if an admin has taken manual control of a conversation, Maya does not auto-respond
- `status !== 'active'` conversations are silently ignored
- Generation lock (`generationLocks` Map) prevents concurrent LLM calls per conversation

## Output Sanitization (`sanitizeForDiscord`)

All outgoing Discord messages pass through two sanitization layers in order:

1. **`sanitizeResponse()`** — Strips em-dashes (—) and en-dashes (–), collapses double spaces
2. **`sanitizeForDiscord()`** — Defense-in-depth guard with 4 stages:
   - **Guard 1:** JSON wrapper extraction — `try/catch` around `JSON.parse`; extracts `reply` field if present (backward-compatible with any in-flight JSON-format responses)
   - **Guard 2:** Code fence stripping — regex strips opening/closing triple-backtick fences (`json`, `js`, `javascript` variants); other language identifiers are LOW risk since the system prompt forbids code output
   - **Guard 3:** Raw JSON detection — if trimmed text starts with `{` or `[` and parses as valid JSON, replaces with friendly fallback message; non-JSON content starting with these chars passes through normally
   - **Guard 4:** Length enforcement — truncates to Discord's 2000-char limit at last word boundary with `...` suffix

Both `handleDM()` and `sendDM()` apply this chain before sending. `extractPlayerNotes()` is exempt (its JSON output never reaches Discord).

### System Prompt Hardening (added in this feature)

The `buildContext()` function appends a RESPONSE FORMAT directive to every system prompt:
> "Always respond in natural conversational language. Use Discord markdown: **bold** for emphasis, bullet points with - for lists, *italics* for tone. NEVER output JSON, code blocks, raw data structures, or structured formats."

The previous JSON reaction format (`{"reply": "...", "reaction": "..."}`) and `REACTION_EMOJI_MAP` have been removed entirely. The sanitization guards serve as defense-in-depth if the LLM ignores the prompt instruction.

## Input Validation

- User message content is stored as-is (no injection risk — it's stored to PostgreSQL via parameterized query and passed to LLM as message history)
- No user-controlled values are interpolated into SQL strings
- All SQL queries use `$1, $2, ...` parameterized form via `pg`

## Known Security Considerations

### ⚠️ MAYA_TEST_MODE_DISCORD_ID must be an env var before production

**Current state (staging):** `MAYA_TEST_MODE_DISCORD_ID` is hardcoded to `'492023474437619732'`  
**Risk:** `sendDM()` uses `MAYA_TEST_MODE_DISCORD_ID || discordId` — meaning ALL outgoing DMs are redirected to the hardcoded user in any environment where this code runs.  
**Required fix:** `const MAYA_TEST_MODE_DISCORD_ID = process.env.MAYA_TEST_MODE_DISCORD_ID || null;`  
**Must be resolved** before merging `develop` → `main`.

### Note extraction (`extractPlayerNotes`)

- Uses a separate JSON-format LLM call (intentional — output never goes to Discord)
- JSON parsing wrapped in `try/catch` with regex fallback
- Stored data is parameterized insert with 500-char truncation

## Dependency Notes

| Package | Severity | CVE/Advisory | Notes |
|---------|----------|--------------|-------|
| `fast-xml-parser` (via `@aws-sdk/client-s3`) | **Critical** | GHSA-fj3w-jwp8-x2g3 | Stack overflow in XMLBuilder with `preserveOrder`. Transitive dep via AWS SDK. Not exploitable via Maya DM flow (no XML parsing in this path). Track as separate security task — upgrade `@aws-sdk` to resolve. |
| `@aws-sdk/client-s3` and full SDK chain | HIGH (20) | via fast-xml-parser | All HIGH vulns are downstream of the critical fast-xml-parser CVE above. |
| `multer@2.0.2` | HIGH | DoS via incomplete cleanup | Pre-existing, not from this change. Schedule upgrade. |
| `minimatch` via `nodemon` | Critical | — | Dev-only dependency, no production exposure. |
| `lodash` | Moderate | Prototype pollution | In `_.unset`/`_.omit`. Not used in this feature. |

## Audit Logging

- All inbound and outbound messages stored in `bot_messages` table
- Admin notified via Socket.IO `/maya-admin` namespace in real-time
- Errors logged to `console.error` only (not leaked to Discord users)
