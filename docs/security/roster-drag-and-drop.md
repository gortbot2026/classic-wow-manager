# Security: Roster Drag-and-Drop (SortableJS)

**Feature:** Drag-and-drop player slots (swap + bench)  
**Card:** cmmgfxa0503bul0ceutq8uioi  
**Reviewed:** 2026-03-07  
**Status:** ✅ PASS

---

## Authentication Requirements

- All roster mutation API endpoints require an authenticated session via **Discord OAuth** (Passport.js).
- Server-side middleware `requireRosterManager` enforces:
  1. `req.isAuthenticated()` — session must be valid
  2. `hasManagementRoleById(req.user.id)` OR `hasHelperRoleById(req.user.id)` — DB role check

**Affected endpoints:**
- `PUT /api/roster/:eventId/player/:discordUserId/position`
- `POST /api/roster/:eventId/player/:discordUserId/bench`

## Authorization Rules

- Client-side: `initDragAndDrop()` is gated behind `currentUserCanManage === true` (prevents drag handles from being rendered for non-management users).
- **This client gate is cosmetic only.** The real enforcement is `requireRosterManager` on the server.
- Non-management users who attempt direct API calls receive `403 Management or Helper role required`.

## Input Validation

| Input | Source | Validation |
|---|---|---|
| `discordUserId` (URL param) | `data-userid` attr set from server data | Looked up in DB — must exist in roster |
| `targetPartyId` (body) | `data-party-id` attr set during `renderGrid()` | `parseInt(value, 10)` server-side |
| `targetSlotId` (body) | `data-slot-id` attr set during `renderGrid()` | `parseInt(value, 10)` server-side |

**Note:** `data-*` attributes are set via the `dataset` JS property (auto-escapes values). No user text input flows directly into these attributes.

## XSS Considerations

- SortableJS moves existing DOM nodes — it never injects new HTML.
- `data-userid`, `data-party-id`, `data-slot-id`, `data-bench` are set via `el.dataset.X = value` (not `innerHTML`).
- Rollback uses `innerHTML = originalContent` where `originalContent` was captured from the rendered cell *before* the drag operation. This is the same pre-existing pattern used by `OptimisticUpdates` throughout the codebase.
- The inline `escapeHtml()` helper is used in the Discord join events console (unrelated sidebar feature).

## SQL Injection

All queries use parameterized `pg` client queries (`$1`, `$2`, ... placeholders). No string concatenation into SQL. Example:

```js
await client.query(
  'SELECT party_id, slot_id FROM roster_overrides WHERE event_id = $1 AND discord_user_id = $2',
  [eventId, discordUserId]
);
```

## CDN / Third-Party Script

- SortableJS v1.15.6 loaded from `https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js`
- **No SRI (Subresource Integrity) hash** is set.
- Risk: if jsDelivr CDN is compromised, malicious code could be injected.
- **Recommendation (LOW priority):** Add `integrity="sha384-..."` and `crossorigin="anonymous"` to the script tag. Generate hash with: `openssl dgst -sha384 -binary Sortable.min.js | openssl base64 -A`
- FontAwesome CDN on the same page also lacks SRI — this is a pre-existing pattern.

## Known Non-Issues (Pre-existing)

- `debug: error.message` in `PUT .../position` 500 response — leaks internal DB error details. Pre-existing pattern in the endpoint, not introduced by drag-and-drop. Low exploitability (management-only endpoint).
- Extensive `[MOVE DEBUG]` console.log statements in the position endpoint — verbose logging for development. Should be cleaned up before production hardening.

## Dependency Notes (Pre-existing, Not Drag-and-Drop Related)

| Package | Severity | Type | Notes |
|---|---|---|---|
| `fast-xml-parser` | CRITICAL | Transitive (via `@aws-sdk/client-s3`) | Not reachable via DnD code path |
| `multer` | HIGH | Direct | File upload — not used in roster drag |
| `axios` | HIGH | Direct | HTTP client — not used in roster drag |
| `@aws-sdk/*` | HIGH | Transitive | S3/R2 integration — not used in roster drag |

All flagged CVEs are pre-existing and unrelated to this feature. Track separately.
