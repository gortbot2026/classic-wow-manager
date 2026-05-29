# Security: Character Profile Sub-Page

**Feature:** `/user-settings/character/:characterName`  
**API:** `GET /api/my-characters/:characterName/profile`  
**Reviewed:** 2026-05-29  
**Reviewer:** Security Gort  

---

## Authentication Requirements

- User must be authenticated (`req.isAuthenticated()`).
- Unauthenticated requests return `401`.

## Authorization Rules

- Only the **character owner** (matched via `discord_id = req.user.id`) may view the profile.
- Users with **management role** (`hasManagementRoleById`) may view any character profile.
- All other users receive `403`.
- The ownership check is performed server-side only — the client renders only after the API confirms access.

## Input Validation

| Input | Validation |
|---|---|
| `characterName` URL param | `!characterName \|\| length > 50` → 400 Bad Request |
| Profile fields (spec/contact/notes) | Handled by existing PATCH endpoint (pre-reviewed) |

Note: WoW character names are 2–12 alphanumeric characters, but the server allows up to 50 to be permissive. All DB lookups use `LOWER($1)` parameterized queries — no injection risk regardless of input format.

## SQL Injection Prevention

All queries in the new endpoint use `pg` parameterized queries (`$1` placeholders):

- `WHERE LOWER(g.character_name) = LOWER($1)` — character lookup
- `WHERE LOWER(li.player_name) = LOWER($1)` — loot items
- `WHERE discord_id = $1` — manual rewards
- `WHERE LOWER(ro.assigned_char_name) = LOWER($1)` — raid history

No raw string concatenation in any query.

## XSS Prevention

Client-side rendering uses `escapeHtml()` consistently via `document.createElement('div').textContent` pattern. Applied to:
- Character name, class, race, rank
- Item names, event names, spec names
- Wowhead links and icon URLs

Note: `wowheadLink`/`iconLink` are database values (set by admins), not user input — XSS risk is negligible, but `escapeHtml()` is applied anyway as a defence-in-depth measure.

## Data Scope & Leakage Prevention

- Loot history filtered to `LOWER(player_name) = LOWER(characterName)` — character-scoped.
- Manual rewards returned by `discord_id` (player-level, not character-scoped). This is intentional per spec: gold rewards are player-level. All rewards belong to the same owner.
- Raid history filtered to `LOWER(assigned_char_name) = LOWER(characterName)` — character-scoped.
- Generic error messages returned on 500 (`'Error fetching character profile.'`) — no stack traces exposed.
- `created_by` field in manual rewards exposes admin username who created the reward. Considered acceptable since the user sees their own rewards only.

## Route Ordering

`PATCH /api/my-characters/:name/profile` is registered at line ~13111 in `index.cjs`, **before** `GET /api/my-characters/:characterName/profile` at line ~13184. Express matches routes in order — no conflict.

## Known Pre-Existing Dependency Issues (Not Introduced by This Feature)

| Package | Severity | Used In | Notes |
|---|---|---|---|
| `fast-xml-parser` | Critical | AWS SDK S3 (indirect) | Not in HTTP request path for this endpoint; upgrade via `npm audit fix` |
| `multer` | High | File uploads | Pre-existing; not used in character profile endpoint |
| `path-to-regexp` | High | Express routing | Pre-existing; update recommended |
| `lodash` | High | Various | Pre-existing; update recommended |

These are pre-existing issues. No new vulnerable dependencies introduced by this feature.

## Audit Logging

No dedicated audit log for character profile views. Profile field edits (`PATCH`) follow the existing pattern. Consider adding audit logging for profile access in a future sprint if compliance requirements emerge.
