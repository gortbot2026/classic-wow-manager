# Security: Template Quick-Add Buttons (raidlogs admin)

**Feature:** Raid-type-aware template buttons on `/raidlogs_admin`
**Last reviewed:** 2026-05-25 by Security Gort
**Card:** cmpl6n4xl00cae2uafg69pdqa (Twins Tanks button)

---

## Authentication Requirements

- The `/raidlogs_admin` page requires `isAuthenticated()` + `hasManagementRoleById()`.
- Both `/raidlogs_admin` and `/event/:eventId/raidlogs_admin` enforce this at the route level.
- All POST/PUT/DELETE endpoints under `/api/manual-rewards/:eventId` require `requireManagement` middleware.

## Authorization Rules

- Only users with the Management Discord role can see or interact with template buttons.
- `requireManagement` checks authentication AND role on every mutating API call.
- The GET `/api/assignments/:eventId` is intentionally public (read-only roster data; no PII beyond character names).

## Input Validation Rules

- `player_name`, `description`, and `points` are required fields validated server-side (400 if missing).
- `player_class`, `discord_id`, and `icon_url` are optional and nullable.
- All DB writes use parameterized queries (`$1, $2, ...`) — no raw string interpolation.
- `character_name` values originate from the assignments API (server-side data), not raw user input.
- Icon URL is a hardcoded constant (`zamimg.com` CDN) — not user-supplied.

## Data Flow for Twins Tanks Button

1. Frontend calls `_fetchAndCacheAssignments()` → GET `/api/assignments/:eventId`
2. Assignment panels parsed in JS; warlock entries identified by `class_name === 'warlock'`
3. Up to 2 character names extracted (`.slice(0, 2)`)
4. Each name POSTed to `/api/manual-rewards/:eventId` with fixed `points: 15`, fixed description, fixed icon URL
5. Server inserts via parameterized `INSERT INTO manual_rewards_deductions`

## Known Considerations

- **Caching:** Assignment panels are cached per `activeEventId` on the class instance. Cache invalidates on event change. No TTL — acceptable for short-lived admin sessions.
- **Fail-open:** If assignments API fails, all template buttons default to visible (usability over restriction).
- **Pre-existing CVEs:** `axios` (direct dep, high severity) and `fast-xml-parser` (critical, indirect) have outstanding CVEs unrelated to this feature. Track for future sprint.

## Audit Logging

- All manual reward entries record `created_by: req.user.id` in the database row.
- Server logs every POST with event ID, player name, and points at `⚖️ [MANUAL REWARDS]` log level.
