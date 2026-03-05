# Security Notes: Maya Persona Bot

_Last updated: 2026-03-05 by Security Gort (updated for pre-raid briefing summary feature)_

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

## Typing Simulation Security (`simulateTypingWithPauses`)

Added in card: "Maya: More realistic typing delays with thinking pauses"

- **No user input in timing logic.** `typingDelay(replyText)` takes word count of the
  *sanitized LLM output* only. Raw player messages never influence timing calculations.
- **Bounded loop.** The inner `while (remaining > 0)` loop uses `Math.min(remaining, 8000)`,
  ensuring each iteration shrinks `remaining` by at least 1ms. No infinite loop risk.
- **Discord API error handling.** All `channel.sendTyping()` calls use `.catch(() => {})`.
  Failures are silently swallowed — typing indicator expiry never crashes the bot or
  propagates to the player.
- **No new dependencies.** Implementation uses only built-in `setTimeout` and the existing
  `channel.sendTyping()` Discord.js method. No new packages introduced.
- **Pause count is capped.** `Math.min(Math.floor(totalTypingMs / 2500), 3)` ensures at most
  3 pauses regardless of message length. Prevents unbounded loops on edge-case inputs.

## Pre-Raid Briefing Summary DM Security

Added in card: "Maya: Pre-raid summary DM to raidleader + new template variables"

### Summary Delivery
- `sendSummaryToRaidleader()` always routes through `sendDM()`, which applies
  `sanitizeForDiscord()` and respects `MAYA_TEST_MODE_DISCORD_ID` redirect.
- `processPendingSummaries()` (5-min polling) also uses `sendDM()` — TEST_MODE redirect applies.
- No new DM delivery paths exist outside of `sendDM()`.

### SQL Injection
- All queries in `sendSummaryToRaidleader()` and `processPendingSummaries()` use
  parameterized statements (`$1`, `$2`). No string interpolation into SQL.
- `pending_raidleader_summaries` table INSERT and UPDATE use parameterized queries only.

### Timer Security
- `briefingTimeouts` Map is in-memory only. All entries cleared on `disconnect` event.
  No timer handles survive bot restart — stale timers are automatically garbage collected.
- `pendingSummaryPollInterval` cleared on `disconnect`. No orphaned `setInterval` risk.

### Socket.IO Emissions
- `emitToAdmin('maya:error', ...)` for raidleader lookup failures contains only:
  `type`, `eventId`, `raidleaderName`, `message` — no tokens, passwords, or Discord IDs.
- Emitted to `/maya-admin` namespace, which is the internal admin UI only.

### Known Behavioral Notes (LOW risk, non-security)
1. **Retry loop on blocked raidleader**: In `processPendingSummaries`, if `sendDM()` returns
   false (raidleader blocked Maya), `sent_at` is not updated. The 5-min poll will retry
   indefinitely. No security impact; generates noisy logs. Consider adding a retry limit
   or failed_at timestamp in a future sprint.
2. **Path A fires on any reply**: `checkBriefingCompletion` triggers on ANY player reply
   after the final Q&A marker — not only "nothing to add" replies. A follow-up question
   from the player will also trigger summary delivery. Functional bug (not security).
   QA should validate the expected UX flow.

### New Template Variables
- `{{raidleader_name}}` and `{{next_upcoming_raid}}` are resolved server-side in
  `resolveTemplateVariables()` via read-only DB/cache queries. Values are substituted
  into LLM prompts only — never rendered as HTML.
- `raidleader_name` falls back to `'TBD'`; `next_upcoming_raid` falls back to
  `'No upcoming raids scheduled'`. No user-controlled input influences these values.

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
