# Security: Roster Dropdown — "Show Player Data Page"

**Feature:** Show player data page menu item in roster character dropdown  
**Card:** cmmbzipiv008pl55jdrhw5zct  
**Reviewed:** 2026-03-04  
**Reviewer:** Security Gort  
**Verdict:** PASS

---

## Feature Overview

A "Show player data page" item was added to the Management-role character dropdown on `/roster`. Clicking it opens `/admin/player/{discordId}` in a new browser tab.

---

## Authentication Requirements

- The roster dropdown itself is gated by `currentUserCanManage` (client-side check).
- The Admin Player **API** (`GET /api/admin/player/:discordId`) is protected by `requireManagement` middleware server-side — unauthenticated or non-Management users receive 401/403.
- The Admin Player **HTML page** (`GET /admin/player/:discordId`) is served as a static file without server-side auth middleware — this is pre-existing behaviour. The page only displays meaningful data via the protected API; the HTML shell itself is harmless.

## Authorization Rules

- Only users with Management role see the dropdown (existing gate, unchanged).
- The linked `/admin/player/:discordId` page fetches from `/api/admin/player/:discordId` which enforces `requireManagement` on every request.
- No privilege escalation is possible through this feature.

---

## Input Handling

| Field | Source | Validation |
|-------|--------|------------|
| `player.userid` (Discord snowflake) | Server-provided player data | Truthiness-checked in JS before `window.open` |
| `data-userid` HTML attribute | Same server data | Rendered with `|| ''` fallback to avoid `"null"` / `"undefined"` as literals |

**Notes:**
- Discord IDs (snowflakes) are 18–19 digit integers — no HTML special characters possible, XSS risk is effectively zero.
- `window.open('/admin/player/' + userid, '_blank')` uses a relative URL path → always same-origin → no open redirect risk.
- Tabnapping does not apply (same-origin target, no `rel` needed for external URLs).

---

## Defense-in-Depth for Disabled State

When `player.userid` is falsy (placeholder or unlinked player):
1. **CSS layer:** `pointer-events: none; opacity: 0.4; cursor: not-allowed` — visually and interactively disabled.
2. **JS layer:** `if (userid) window.open(...)` — even if CSS is bypassed via dev tools, the handler does nothing without a valid userid.
3. **Server layer:** The API itself requires Management role regardless.

---

## Known Pre-Existing Issues (Not Introduced by This PR)

- `npm audit` reports 20 high + 1 critical CVE in existing dependencies (`@aws-sdk`, `multer`, `qs`). These are **unrelated to this feature** and were present before this change. They should be addressed in a dedicated dependency-update sprint.

---

## No New Risks Introduced

This is a purely client-side UI enhancement. No new API endpoints, no new server-side code, no new packages. The attack surface is unchanged from the perspective of data access.
