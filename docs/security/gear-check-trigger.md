# Security: Gear-Check Channel Trigger

**Feature:** Maya gear-check channel trigger  
**Review date:** 2026-03-06  
**Reviewer:** Security Gort  
**Verdict:** PASS

---

## Authentication Requirements

- No separate authentication layer — the feature operates within Discord's bot authentication (PERSONA_BOT_TOKEN).
- Only messages from human users in the designated channel are processed; `message.author.bot === true` messages are dropped at the top-level messageCreate handler before any routing.
- Bot self-reply loop is impossible by design.

## Authorization Rules

- The gear-check handler only fires when `message.channel.id === process.env.MAYA_GEAR_CHECK_CHANNEL_ID`.
- The channel ID is set via environment variable (Heroku config var) — not user-controllable.
- No guild-member verification is performed (intentional: any Discord user can post in the gear-check channel to apply).
- The `trigger_type = 'gear_check'` allowlist is enforced on both POST and PATCH `/api/admin/maya/templates` endpoints in `index.cjs`.

## Input Validation Rules

| Input | Handling |
|-------|----------|
| `message.content` | Passed to LLM as a user message parameter only — never interpolated into SQL |
| `message.author.id` | Used as SQL parameter `$1` in all queries (parameterized) |
| `message.author.username` | Used as SQL parameter `$2` (parameterized) |
| `message.attachments` | Filtered by `contentType.startsWith('image/')` before fetching — Discord CDN URLs only |
| LLM output | Run through `sanitizeResponse()` then `sanitizeForDiscord()` before any Discord send |

## SQL Injection

All `pg` queries in `handleGearCheckPost` use parameterized placeholders (`$1`, `$2`, `$3`, `$4`). Verified:
- `bot_conversations` SELECT (returning applicant check): `WHERE discord_id = $1 AND trigger_type = 'gear_check'` — literal string in query, discord_id parameterized
- `discord_users` UPSERT: `$1` = discord_id, `$2` = username
- `bot_templates` SELECT: no user input in query
- `bot_conversations` INSERT: all user-derived values as parameters
- `bot_player_notes` INSERT: note string is SQL parameter (`$2`), not interpolated

## Known Security Considerations

1. **LLM Prompt Injection** (LOW): User post content (`message.content`) is included in LLM prompts as a user-role message, not as part of the system prompt. Adversarial content cannot override system instructions in the classification or generation calls. Risk is minimal given the Discord context.

2. **Image Fetching** (LOW): Only fetches URLs from `message.attachments` (Discord CDN). Users cannot supply arbitrary URLs — attachments are Discord-managed. Non-200 responses are handled gracefully.

3. **Global gearCheckLock** (LOW/Reliability): The lock is a module-level boolean — concurrent gear-check posts result in the second message being silently dropped with a warning log. Not a security concern, but a reliability note for future improvement (consider per-user lock map).

4. **Pre-existing Dependency CVEs** (LOW): npm audit shows 23 vulnerabilities (multer DoS, fast-xml-parser DoS, axios DoS, minimatch ReDoS) — all pre-existing, not introduced by this feature. No new packages added. None are RCE or injection vectors. Should be addressed in a dedicated maintenance sprint.

## Audit Logging

- All LLM calls and DB operations log to `console.error`/`console.warn` on failure.
- Successful gear-check handling is implicit (channel message + bot_messages record).
- New conversations visible in real-time on `/admin/maya-settings` via Socket.IO `maya:conversationUpdate` event.
- `bot_player_notes` stores an initial context summary per applicant.
