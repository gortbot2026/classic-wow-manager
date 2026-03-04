# Security Notes: Maya Persona Bot

_Last updated: 2026-03-04 by Security Gort_

## Authentication Requirements

- `PERSONA_BOT_TOKEN` must be set as an environment variable (Heroku config var).
  Never hardcode this value. The bot will refuse to start if the env var is missing.
- Discord OAuth is handled upstream via passport-discord; the persona bot does not manage OAuth itself.

## Authorization Rules

- The bot only responds to DMs (ChannelType.DM) — guild messages are ignored.
- `admin_override` flag on `bot_conversations`: when set, the bot skips auto-response to let
  admins manually control the conversation.
- `generationLocks` map prevents concurrent LLM calls per conversation (one response at a time).

## Input Validation

- Incoming Discord messages are passed to the LLM without sanitization — this is intentional
  since Maya should respond naturally. The LLM API call is the only consumer.
- Timing helper functions (`readingDelay`, `typingDelay`) extract word count via split/filter only.
  No user input is used in SQL queries, eval, or file operations.
- Discord user IDs (snowflakes) are always treated as opaque strings and passed as SQL parameters (`$1`).

## SQL Injection Protection

- All database queries use parameterized queries via `pg` (`$1`, `$2`, etc.).
- No string interpolation into SQL in either `persona-bot.cjs` or `persona-context.cjs`.
- The `ANY($N)` array parameter pattern is used correctly for multi-value filters.

## Resource Leak Protection

- `setInterval` for Discord typing indicator refresh is always cleared in a `finally` block
  (wraps `generateResponse` call), ensuring no leaked intervals on LLM errors or timeouts.

## TEST MODE Warning ⚠️

`MAYA_TEST_MODE_DISCORD_ID` is hardcoded to `'492023474437619732'` (Kim's Discord ID) in
`persona-bot.cjs`. This routes all bot DMs to Kim during development.

**This must be set to `null` before production launch.** Leaving it enabled means:
- All outbound DMs go to Kim instead of the actual player (privacy violation)
- Inbound DMs from Kim are routed to the most recently active conversation (any player's)

Track removal in a dedicated card before the go-live milestone.

## Dependency Notes

The following pre-existing high-severity CVEs are present in the project (unrelated to the
persona bot feature, but should be scheduled for remediation):

- `@aws-sdk/client-s3` (direct, high) — via `fast-xml-parser` XXE
- `axios` (direct, high)
- `multer` (direct, high)

None of these affect the persona bot code paths. Schedule updates in a maintenance sprint.

## Known Sensitive Data

- Discord IDs are logged to console in TEST MODE (pre-existing behavior).
- LLM prompts include player data (raid history, gold amounts, character names).
  Ensure Anthropic API calls go over TLS (they do by default via the SDK).
