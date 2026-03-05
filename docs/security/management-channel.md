# Security: Management Channel (Maya)

**File:** `scripts/persona-bot.cjs`
**Last reviewed:** 2026-03-05 by Security Gort
**Card:** Maya: Management channel improvements — respond to all messages + full player lookup

---

## Authentication Requirements

- **Channel gating:** Management channel handler is only reachable when `message.channel.id === MAYA_MANAGEMENT_CHANNEL_ID` (env var). No hardcoded channel ID.
- **Bot guard:** `message.author.bot` check at the top of `messageCreate` prevents any bot — including Maya herself — from triggering the handler.
- **Token:** `PERSONA_BOT_TOKEN` loaded from environment only; missing token silently disables the bot.

## Authorization Rules

- Player data (notes, conversation summaries, stats, full profile) is assembled inside `lookupPlayersInMessage()` and injected into the **system prompt only** — it never flows to a public channel or back to a regular user.
- The management channel is a private leadership-only channel. All messages within it are treated as authorized by default (mention guard intentionally removed per spec).
- No external endpoints are exposed for this feature; all data retrieval is internal (PostgreSQL queries).

## Input Validation Rules

### Regex-based player matching (Passes 1 & 2)
- Character names and Discord usernames from the database are **regex-escaped** before being used in `new RegExp()`:
  ```js
  name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ```
- This prevents regex injection if a player name contains special characters (e.g., `(Gurt)`, `+2`).

### Discord snowflake extraction (Pass 3)
- Pattern: `/\b(\d{17,20})\b/g` — bounded to 17-20 digits.
- No catastrophic backtracking risk (simple linear digit match with word boundaries).
- Extracted snowflakes are validated against `players.discord_id` via a **parameterized query** before any data is fetched.

### SQL Injection Prevention
All database queries in `lookupPlayersInMessage()` and `buildEnrichedSection()` use parameterized queries (`$1` placeholders):
- `bot_player_notes WHERE discord_id = $1`
- `bot_conversations WHERE discord_id = $1`
- `players WHERE discord_id = $1`
- No string concatenation into SQL anywhere in the new code.

## Output Sanitization
- `sanitizeResponse()` and `sanitizeForDiscord()` are applied to all LLM output before Discord delivery — unchanged by this feature.
- Player data injected into the system prompt is consumed by the LLM, not reflected raw to any user.
- Discord 2000-char truncation guard preserved.

## Duplicate Prevention
- `processedIds` Set (keyed on `discord_id`) prevents the same player from being enriched multiple times across all three lookup passes. A player who matches on both character name (Pass 1) and Discord username (Pass 2) will only appear once in the context.

## Known Security Considerations

### Pre-existing Dependency Vulnerabilities (not introduced by this feature)
| Package | Severity | CVEs | Used in Production | Action |
|---------|----------|------|--------------------|--------|
| `multer` | HIGH | DoS via incomplete cleanup, resource exhaustion, uncontrolled recursion | Yes (file uploads in index.cjs) | Update in future sprint |
| `qs` | HIGH | arrayLimit bypass DoS | Transitive | Update in future sprint |
| `axios` | HIGH | `__proto__` DoS via mergeConfig | Transitive | Update in future sprint |
| `fast-xml-parser` | CRITICAL | RangeError DoS, entity encoding bypass | No (migration scripts only) | Low runtime risk; update in future sprint |

These were present before this feature and are unrelated to the management channel changes.

## Audit Logging
- Maya logs management channel replies to `console.log` with username and response length — no sensitive data (no tokens, no player PII) in the log line.
- Errors caught and logged with `err.message` only — no stack dumps to Discord.
