# Security: Maya Pre-Raid Briefing — Raid Helper Sign-Up Lookup

**Feature:** Fetch player character name + class from Raid Helper at pre-raid briefing start  
**Last Updated:** 2026-03-05  
**Reviewed By:** Security Gort

---

## Authentication & Authorization

- **Endpoint:** `POST /api/admin/maya/conversations`
- **Middleware:** `requireManagement` — only authenticated management-role users can trigger conversation creation
- The Raid Helper lookup is internally triggered; no public endpoint exposes the lookup directly

## Input Validation

- `discordId` — validated as required in the request body; used in parameterized queries only (`$1`, `$2`)
- `resolvedEventId` — derived entirely from a DB lookup against `events_cache` (trigger_type check); **never taken directly from user request body**, preventing SSRF or user-controlled event ID injection
- `playerSignUp.name` and `playerSignUp.className` — external API data from Raid Helper; stored as plain TEXT in `bot_conversations.player_name` and `character_class` columns via parameterized INSERT (`$7`); not executed, eval'd, or rendered as HTML

## SQL Injection

All new queries in this feature use parameterized placeholders:

- `INSERT INTO bot_conversations (..., character_class) VALUES ($1, $2, $3, ..., $7)` ✅
- `SELECT assigned_char_class FROM roster_overrides WHERE event_id = $1 AND discord_user_id = $2` ✅
- `SELECT player_name, character_class, event_id FROM bot_conversations WHERE id = $1` ✅

## Secret / Credential Handling

- `RAID_HELPER_API_KEY` accessed exclusively via `process.env.RAID_HELPER_API_KEY` throughout `index.cjs`
- No hardcoded credentials anywhere in the Raid Helper lookup flow

## Template Variable Security

- `{{pre_raid_character_name}}` and `{{pre_raid_character_class}}` are substituted via `applyTemplateVariables()` — a regex replacement that only replaces known `{{key}}` patterns in bot template strings
- Values come from trusted DB columns; no user-controlled input flows directly into the template substitution without being sanitized through the DB write path

## Error Handling

- All Raid Helper and roster_overrides lookups are wrapped in `try-catch`; conversation creation continues on any failure
- Error messages logged to `console.error` only — not exposed in API responses to clients
- HTTP error responses return generic messages (e.g. `'Error creating conversation'`)

## Logging

Console logs include: Discord user ID, resolved character name, resolved class — server-side only, not sent to external systems. Acceptable sensitivity for a WoW guild management application.

## Pre-Existing Dependency Vulnerabilities (Not Introduced by This Feature)

| Package | Severity | Via | Notes |
|---|---|---|---|
| `fast-xml-parser@5.2.5` | Critical | `@aws-sdk/client-s3` (transitive) | DoS/regex issues in XML parsing; not triggered by Maya flow. Track for AWS SDK upgrade. |
| `axios@^1.11.0` | High | Direct dependency | DoS via `__proto__` key in mergeConfig. Low exploitability in controlled admin context. Consider upgrading. |

These are pre-existing and not related to this feature. Recommend addressing in a dedicated dependency upgrade sprint.

## Known Considerations

- The Raid Helper lookup is scoped to `pre_raid_briefing` trigger type only — other conversation types are unaffected
- No rate limiting on the conversation creation endpoint beyond Discord session auth; acceptable for admin-only use
