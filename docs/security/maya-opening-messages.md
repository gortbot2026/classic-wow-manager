# Security: Maya AI-Generated Opening Messages

**Feature:** Maya — AI-generated dynamic opening messages  
**Files:** `scripts/persona-bot.cjs`, `index.cjs`, `public/admin/maya-settings.html`, `public/admin/maya-settings.js`  
**Last reviewed:** 2026-03-04 by Security Gort  
**Card:** cmmcm4i4y00n7nq82ul42fg5z

---

## Overview

The "Opening Message" field in Maya templates is now an instruction set passed to Claude Haiku to generate a unique, personalized opening DM for each player. A variable-substituted fallback is used if the LLM call fails.

## Authentication Requirements

- `generateOpeningMessage()` is only callable from:
  1. **Admin conversation creation** — `POST /api/admin/maya/conversations` (protected by `requireManagement` middleware: must be authenticated + have management Discord role)
  2. **Internal bot trigger** — `triggerTemplate()` in `persona-bot.cjs` (called only from the bot's internal scheduled/event logic, not from any user-accessible endpoint)
- No unauthenticated path to LLM generation exists

## Authorization Rules

- Template creation/update (`POST/PATCH /api/admin/maya/templates`) requires `requireManagement` middleware
- `trigger_type` is validated against an allowlist: `['post_raid', 'welcome', 'item_won', 'manual']`
- `opening_message` (now instruction text) stored and served from `bot_templates` table — only management-role admins can write it

## Input Validation Rules

- `discordId`, `name`, `trigger_type`, `opening_message`, `agent_instructions` validated as required on template creation
- `model_override` is NOT validated against a model allowlist — accepts any string. Bad values cause a graceful Anthropic API error caught by the fallback try/catch. LOW risk (admin-only input).
- `opening_message` has no maximum length enforcement at the API level. Templates with extremely long instruction text could increase token cost. LOW risk (admin-only).

## LLM Security Considerations

### API Key
- `ANTHROPIC_API_KEY` loaded exclusively from `process.env` in `persona-llm.cjs`
- Missing key throws an error immediately; `generateResponse()` is never called without a valid key

### Output Sanitization
All LLM-generated opening messages pass through two layers before Discord delivery:
1. `sanitizeResponse()` — strips em-dashes, en-dashes, collapses extra spaces
2. `sanitizeForDiscord()` — extracts JSON wrappers, strips code fences, detects raw JSON output, enforces 2000-char Discord limit

### Fallback Safety
- `generateOpeningMessage()` wraps all LLM calls in `try/catch`
- On failure: logs `console.error` with discord ID context, returns variable-substituted fallback
- Fallback is computed before attempting LLM generation — always available regardless of API state

### Prompt Injection Consideration
- `opening_message` instructions are admin-authored (trusted input) — not user-controlled
- `playerContext` (from `buildPlayerContext()`) is read-only DB data — character names, gold amounts, raid counts
- Player character names from the DB could theoretically contain instruction-like text if corrupted, but this would require DB-level compromise first. LOW risk.

## Admin Direct Message Path
- When an admin provides `openingMessage` directly (not via template), the raw string is stored and sent to Discord without `sanitizeForDiscord()` being applied
- This is trusted input from a management-role admin
- Discord DM failures (e.g., >2000 chars) would surface as Discord API errors in server logs
- LOW risk — no security boundary crossed

## Known Pre-Existing Issues (Not Introduced by This Card)

| Issue | Risk | Status |
|-------|------|--------|
| `MAYA_TEST_MODE_DISCORD_ID` hardcoded to `'492023474437619732'` in `persona-bot.cjs` | HIGH (production blocker) | Pre-existing, documented in `maya-discord-output.md`. Must be fixed before `develop→main` merge. |
| `fast-xml-parser` critical CVE (via `@aws-sdk`) | Medium-Critical (DoS, no RCE in DM path) | Pre-existing, tracked in `maya-discord-output.md`. Not exploitable via Maya DM flow. |
| `multer@2.0.2` high CVE (DoS) | High | Pre-existing. Upgrade scheduled. |

## Audit Logging

- All opening messages (LLM-generated and fallback) stored in `bot_messages` with `role='maya'`
- `model_used` field populated with actual model name for LLM-generated openings; `null` for variable-substituted fallback
- Admin conversation creation logged in `bot_conversations` with `started_by='admin'`
- LLM failures logged at `console.error` level with discord ID
