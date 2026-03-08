# Security: Candidate Outreach Feature

_Reviewed: 2026-03-08 | Reviewer: Security Gort | Verdict: PASS_

## Feature Overview

The Candidate Outreach feature enables raid managers to send personalized DMs to candidate players via Maya bot. It includes:
- A new "Candidate Outreach" context block in Maya Settings admin
- Enhanced `POST /api/roster/:eventId/outreach` endpoint accepting candidate metadata
- New template variables: `{{player_name}}`, `{{class_name}}`, `{{tonight_raid}}`
- Outreach-specific overrides for `{{character_name}}`, `{{last_raid_name}}`, `{{last_raid_date}}`

---

## Authentication & Authorization

| Endpoint | Middleware | Notes |
|---|---|---|
| `POST /api/roster/:eventId/outreach` | `requireRosterManager` | Session-based, Discord OAuth |
| `PATCH /api/admin/maya/persona` | `requireManagement` | Higher privilege — management role |
| `GET /api/admin/maya/persona` | `requireManagement` | Returns full persona row |

**Rule:** Only authenticated roster managers may initiate outreach. Only management roles may modify Maya persona context.

---

## Input Validation Rules

### `/api/roster/:eventId/outreach` POST body

| Field | Validation | Notes |
|---|---|---|
| `discordIds` | Required. Non-empty array of non-empty strings | Hard reject if invalid |
| `candidates[]` | Optional array | Silently ignored if not array |
| `candidates[].discordId` | `typeof === 'string'` check | Entry skipped if invalid |
| `candidates[].charName` | `\|\| null` fallback | No explicit length limit — LOW risk, TEXT column |
| `candidates[].className` | `\|\| null` fallback | No explicit length limit |
| `candidates[].lastRaidName` | `\|\| null` fallback | No explicit length limit |
| `candidates[].lastRaidDate` | `\|\| null` fallback | No explicit length limit |

**⚠️ NOTE (LOW):** `charName`, `className`, `lastRaidName`, `lastRaidDate` have no explicit length validation. Values are stored via parameterized queries (no SQL injection risk) and used as template variables in Discord DMs. Discord API enforces a 2000-char message limit which acts as a soft guard, but consider adding explicit max-length checks (e.g. 100 chars) in a future improvement sprint.

### `/api/admin/maya/persona` PATCH body

| Field | Validation |
|---|---|
| `candidate_outreach_context` | Stored as-is (TEXT). Consistent with `management_context`, `channel_context`, `gear_check_context`. Admin-only field. |

---

## SQL Injection Assessment

All new queries use parameterized `$N` placeholders. No string interpolation with user data.

Key new queries:
```sql
-- bot_conversations INSERT — all 11 params parameterized
INSERT INTO bot_conversations (...) VALUES ($1, $2, $3, 'active', 'outreach', $4, $5, $6, $7, $8, $9, $10, $11)

-- bot_persona UPDATE — dynamic SET clause with $N params, no user data in column names
UPDATE bot_persona SET candidate_outreach_context = $1 WHERE id = ...

-- candidate_class lookup — parameterized
SELECT class FROM players WHERE discord_id = $1 LIMIT 1
```

---

## XSS Assessment

- **Maya Settings admin UI:** `candidate_outreach_context` is read/written via `textarea.value` (not `innerHTML`). Safe.
- **Template variables:** Resolved server-side and used in Discord DMs (not rendered in browser). Not a browser XSS surface.
- **candidates.js:** Candidate metadata is read from API response and sent in POST body, not rendered via innerHTML.

---

## Template Variable Security

New variables `{{class_name}}`, `{{tonight_raid}}`, `{{player_name}}` are resolved server-side in `resolveTemplateVariables()`. Fallback chain:

1. `bot_conversations` outreach candidate columns (outreach only)
2. Generic DB resolution (players table, etc.)
3. `'unknown'` default

Non-outreach conversations are **not affected** — the override block is gated by `trigger_type === 'candidate_outreach'`.

---

## Dependency Notes (Pre-existing — Not Introduced by This PR)

| Package | Severity | CVE | Notes |
|---|---|---|---|
| `fast-xml-parser` (via `@aws-sdk/core`) | CRITICAL (9.3) | GHSA-m7jm-9gc2-mpf2 | Entity encoding bypass. Pre-existing. AWS SDK not used in outreach feature. Recommend upgrading @aws-sdk in future sprint. |
| `multer` | HIGH | GHSA-xf7r-hgr6-v32p | DoS via incomplete cleanup. Pre-existing. Used for file uploads, not outreach. |
| `qs` | HIGH | GHSA-w7fw-mjwx-w883 | DoS via comma parsing. Pre-existing. |

None of these CVEs are triggered by or related to the candidate outreach feature. They should be addressed in a maintenance sprint.

---

## Known Security Considerations

1. **Rate limiting on outreach endpoint:** Currently limited by 500ms delay between DMs + Discord rate limits. No HTTP-level rate limiting on the endpoint itself. Acceptable for current threat model (roster manager role required).

2. **No audit log for outreach sends:** Outreach actions are not logged to an audit table. Recommend adding audit logging in future (who sent outreach, to whom, at what time).

3. **Backward compatibility:** Bare `discordIds` array still works. No security regression from previous behavior.
