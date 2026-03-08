# Security: Roster Player Hover Card + Class Icon Role Fade

**Feature:** Player hover card + class icon → spec icon crossfade  
**Card:** cmmgn9c1a03k4l0ceeck0leoi  
**Reviewed:** 2026-03-07  
**Status:** ✅ PASS

---

## Authentication Requirements

- New endpoint `GET /api/roster/:eventId/player-hover/:discordUserId` is protected by `requireRosterManager` middleware.
- Middleware enforces:
  1. `req.isAuthenticated()` — valid Discord OAuth session required
  2. `hasManagementRoleById(req.user.id)` OR `hasHelperRoleById(req.user.id)` — DB role check
- Unauthenticated or non-management users receive `401` / `403`.
- Client-side: hover card fetch is gated behind `currentUserCanManage === true`. This is cosmetic only — real enforcement is server-side.

## Authorization Rules

- Only management + helper roles can retrieve hover card data (raid counts, gold, guild status).
- The `discordUserId` in the URL is the subject of the query, not the requester's identity. Any roster manager can view hover data for any player — this is intentional (raid leaders need full visibility).

## Input Validation

| Input | Source | Server Handling |
|---|---|---|
| `eventId` | URL path param | Accepted but not used in queries; harmless |
| `discordUserId` | URL path param | Passed as `$1` in all parameterized queries |
| `charName` | Query string (`req.query.charName`) | Used only as `$2` in parameterized queries; URL-decoded, no further sanitization needed |
| `charClass` | Query string (`req.query.charClass`) | `.toLowerCase()` applied; used only in JS-land for guild status matching (not directly in SQL) |

**Note:** `charClass` is never interpolated into SQL — it's only used in JavaScript `.find()` comparisons against data already retrieved from the DB. No injection risk.

## SQL Injection

All database queries use parameterized `pg` client queries. No string concatenation into SQL.

The `charNamesArray` (player character names built from DB lookups + current `charName`) is passed via `ANY($2)` parameterized binding:

```js
client.query(
  `SELECT COALESCE(SUM(gold_amount), 0) AS total_spent
   FROM loot_items
   WHERE event_id = ANY($1) AND LOWER(player_name) = ANY($2)`,
  [recentEventIds, charNamesArray]
)
```

This is safe — `ANY($N)` with an array parameter is fully parameterized in `pg`.

## XSS Considerations

### What IS escaped
- Character name (`charName` from `cell.querySelector('.player-name span')?.textContent`) is passed through `escapeHtml()` before injection into innerHTML. ✅

### What is NOT escaped (LOW risk)
- `apiData.guildJoinDate` — rendered into innerHTML via template literal without `escapeHtml()`. Example: `` `📅 Joined: ${apiData.guildJoinDate}` `` → then into `<div>...</div>`. Risk is LOW because `guildJoinDate` is a PostgreSQL `date` column from the `guildies` table, returning a formatted date string (e.g. `2025-06-15`). No user controls this directly.
- `classColor` — injected into inline `style="color: ${classColor}"`. Comes from `nameSpan.style.color`, which was set programmatically from a server-side CLASS_COLORS map (not user input). CSS injection is theoretically possible but practically unreachable.

**Recommendation (LOW, future sprint):** Apply `escapeHtml()` to all `apiData` string fields rendered into innerHTML (`guildJoinDate`) as defense-in-depth.

### Hover card innerHTML construction
The card is built from:
- Hardcoded strings and emoji
- `escapeHtml(charName)` — safe
- API numeric fields (`accountRaidCount`, `raidsLast12Months`, etc.) parsed with `parseInt()`/`Number()` server-side — safe
- `guildJoinDate` — unescaped but low risk (see above)

## Error Handling

Server-side error response:
```js
console.error('[PLAYER_HOVER] Error:', err.message);
res.status(500).json({ error: 'Failed to fetch hover data' });
```

Generic error message to client. No stack traces or query details exposed. ✅

Client-side: fetch errors are silently caught — card stays with client-side data only, no error details leaked to the user:
```js
} catch (_) {
    // Silently fail — card stays with client-side data only
}
```

## Rate Limiting

No explicit rate limiting on the hover endpoint. Mitigated by:
- 600ms client-side still-hover timer prevents rapid firing
- Client-side response cache (`hoverDataCache` Map) prevents repeat fetches for the same user
- `requireRosterManager` auth requirement limits the exposed surface to known, authenticated users

**Note:** Consistent with all other roster endpoints in the codebase. Not a blocking issue.

## Drag-and-Drop Safety

- Hover card has `pointer-events: none` — cannot be dragged, cannot intercept click events
- `isDragging` flag check suppresses hover during active drags
- `dragEndTimestamp` 200ms cooldown prevents hover firing immediately after drag release
- `hideHoverCard()` is called in SortableJS `onStart` and `renderRoster()` for clean state

## Dependency Notes (Pre-existing, Not Introduced by This Card)

No new packages added (`package.json` unchanged in this commit). All CVEs in `npm audit` are pre-existing — see `/docs/security/roster-drag-and-drop.md` for full table.

Summary of npm audit (23 total, all pre-existing):
- **CRITICAL:** `fast-xml-parser` via `@aws-sdk` — XML parsing, not reachable via hover endpoint
- **HIGH:** `axios`, `multer`, `qs` — unrelated to hover feature
- **LOW:** `minimatch`

## Known Non-Issues

- `eventId` is accepted in the URL but not used in any DB query. This is intentional — the endpoint returns account-level data independent of the specific event being viewed. No security concern.
- The hover card singleton persists in the DOM for the lifetime of the page — this is correct and expected behavior.
