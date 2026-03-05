# Security: Management Channel (Maya)

**Files:** `scripts/persona-bot.cjs`, `scripts/persona-management-context.cjs`
**Last reviewed:** 2026-03-05 by Security Gort
**Cards:**
- Maya: Management channel improvements — respond to all messages + full player lookup
- Maya: Raid awareness in management channel — look up sign-ups by day/name

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

## Raid Intelligence Context Module (`persona-management-context.cjs`)

Added in card: Maya: Raid awareness in management channel

### Secrets Handling
- `RAID_HELPER_API_KEY` accessed exclusively via `process.env.RAID_HELPER_API_KEY` (line 303).
- If the env var is missing, `fetchSignups()` silently returns an empty string — no crash, no fallback to a hardcoded key.

### Input Handling
- `messageContent` (raw Discord message) is only passed to:
  - `detectContextNeeds()` — lowercased, regex-matched via `matchesKeyword()` only
  - `resolveEventFromMessage()` — used for string `.includes()` / regex `.test()` against event titles; never inserted into SQL
- **No user input ever flows directly into a SQL query.**

### SQL Injection Prevention
All 11 SQL queries in the module use parameterized `$1` / `ANY($1)` placeholders:
- `eventId` values are sourced from `events_cache` JSON (DB-controlled), then used as `$1`
- `discordIds` are sourced from `lookupPlayersInMessage()` (pre-validated snowflakes), then used as `ANY($1)`

### External API / SSRF
- Raid Helper fetch URL: `https://raid-helper.dev/api/v2/events/${eventId}` — domain is hardcoded, only the path segment (eventId from DB) is dynamic. Not user-controllable.
- Request includes `AbortSignal.timeout(8000)` — prevents resource exhaustion on API hang.
- Non-OK HTTP responses return empty string (no exception propagates).

### In-Memory Cache
- Cache keys: `moduleName:eventId` or `moduleName:discordIds` — values are DB/API-sourced, not user-controlled.
- No cache poisoning vector: user input cannot influence cache keys or inject malicious cached values.
- TTL: 5 minutes (Map-based, process-scoped). Resets on dyno restart.

### Error Isolation
- Every fetcher is wrapped in `try/catch`, returns `''` on failure.
- Errors logged as `console.error('[persona-mgmt-ctx] fetchX error:', err.message)` — message only, no stack trace or data dump.
- A single module failure never blocks the entire response.

### Authorization
- No new endpoints exposed. All access is via the existing management Discord channel gate.
- Data exposed (raids, rosters, gold, player notes) is already accessible to leadership via the web dashboard — no privilege escalation.

## Audit Logging
- Maya logs management channel replies to `console.log` with username and response length — no sensitive data (no tokens, no player PII) in the log line.
- Errors caught and logged with `err.message` only — no stack dumps to Discord.
