# Security: Maya Player Notes Feature

**Feature:** "What Maya knows" notes panel on `/admin/player/` page  
**Reviewed:** 2026-03-04  
**Reviewer:** Security Gort  
**Status:** ✅ PASS

---

## Authentication Requirements

All three API endpoints require **management-level authentication** via `requireManagement` middleware:

- `GET /api/admin/maya/notes/:discordId` — read notes for a player
- `POST /api/admin/maya/notes/:discordId` — manually create a note
- `DELETE /api/admin/maya/notes/:noteId` — delete a note

The `requireManagement` middleware:
1. Checks `req.isAuthenticated()` — returns 401 if not logged in
2. Checks `hasManagementRoleById(req.user.id)` via DB — returns 403 if not management role

No public or unauthenticated access to notes is possible.

---

## Authorization Rules

- Only users with the **Management** app role can read, create, or delete notes.
- There is no per-player ownership check — any management user can manage notes for any player. This is by design (guild management use case).
- Socket.io events are emitted on the `/maya-admin` namespace, which has its own authentication middleware. Unauthorized users cannot receive real-time note events.

---

## Input Validation Rules

### `discordId` (URL param)
- Validated against `/^[0-9]{1,20}$/` regex — only numeric Discord snowflakes allowed
- Returns 400 if invalid

### `note` (POST body)
- Must be present and a non-empty string — returns 400 if missing/empty
- Maximum 500 characters — returns 400 if exceeded
- `.trim()` applied before storage
- **Client-side** also enforces 500-char limit with an `alert()` on the Add button

### `noteId` (DELETE URL param)
- Parsed with `parseInt(noteId, 10)` — returns 400 if `NaN` or `< 1`
- Passed as typed integer `noteIdNum` to parameterized SQL query

### Auto-extracted notes (LLM path)
- Each note validated: must be non-empty string
- Sliced to 500 chars via `.slice(0, 500)` before DB insert
- Entire extraction wrapped in try/catch; failures are non-blocking

---

## SQL Injection Prevention

All database queries use **parameterized placeholders** (`$1`, `$2`) via the `pg` library:

```sql
-- GET
SELECT ... FROM bot_player_notes WHERE discord_id = $1 ORDER BY created_at DESC

-- POST
INSERT INTO bot_player_notes (discord_id, note, source_conversation_id) VALUES ($1, $2, NULL)

-- DELETE
DELETE FROM bot_player_notes WHERE id = $1 RETURNING discord_id

-- Context query (persona-context.cjs)
SELECT note, created_at FROM bot_player_notes WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 10

-- Extraction fetch (persona-bot.cjs)
SELECT note FROM bot_player_notes WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 10
INSERT INTO bot_player_notes (discord_id, note, source_conversation_id) VALUES ($1, $2, $3)
```

No string interpolation in SQL. ✅

---

## XSS Prevention

The UI renders note content via a custom `escNote()` helper:

```javascript
function escNote(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

This is the standard DOM-based HTML escaping pattern. Both `note` text and `created_at` date strings are passed through `escNote()` before being inserted into `innerHTML`.

The `n.id` value used in the inline `onclick="deleteMayaNote(n.id)"` is a PostgreSQL `SERIAL` integer — it is always a positive integer from the database and is not user-controlled input.

---

## Sensitive Data Handling

- Error logs use `err.message || err` — no full stack traces or query details exposed to clients
- API error responses return generic messages (`'Error getting player notes'`) without internal details
- Extraction failure is logged server-side only, not surfaced to the user

---

## LLM Extraction Security Considerations

The auto-extraction feature sends player message content and Maya's reply to Claude Haiku (via `ANTHROPIC_API_KEY` env var — not hardcoded). Key considerations:

- Player DM content is sent to Anthropic's API — this is inherent to the feature design and consistent with existing Maya chat functionality
- The extraction prompt is constrained: only extracts facts about the player, not game mechanics or bot internals
- Existing notes are passed into the extraction prompt to prevent duplicate storage
- All extraction is fire-and-forget: `.catch()` ensures failures never block the main Discord reply flow
- Extracted notes are deduplicated before insert at the LLM prompt level (not enforced at DB level — a UNIQUE constraint could be added in future for extra safety)

---

## Known Security Notes

1. **No rate limiting on POST `/api/admin/maya/notes/:discordId`** — Management users could spam notes. LOW risk given the restricted audience (guild management only).

2. **No DB-level deduplication** — The LLM is instructed to avoid duplicates, but there's no `UNIQUE` constraint on `(discord_id, note)`. A race condition could theoretically insert duplicates. LOW risk.

3. **Pre-existing npm audit findings (23 vulnerabilities, not introduced by this feature):**
   - 1 critical: `fast-xml-parser` via `@aws-sdk` (not in Maya notes path)
   - 20 high: `multer`, `minimatch`, `axios`, various AWS SDK deps (not in this feature path)
   - 1 moderate: `lodash` prototype pollution
   - Recommend addressing these in a dedicated dependency update sprint.
