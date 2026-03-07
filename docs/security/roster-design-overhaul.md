# Security: Roster Page Design Overhaul

**Feature:** Visual overhaul — Tailwind CSS, admin sidebar, bench layout, player badges, bg color  
**Card:** cmmg47y2402ujl0cew9fqlzli  
**Reviewed:** 2026-03-07

---

## Authentication Requirements

- Admin sidebar is **never rendered in the DOM** for non-management users. Guard: `currentUserCanManage` boolean (set from `/user` API endpoint, which requires Discord OAuth session).
- All admin action API endpoints (`/api/roster/:eventId/player/*`, etc.) continue to use `requireRosterManager` middleware.

## Authorization Rules

### isConfirmed Stripping (Backend)

**Route:** `GET /api/roster/:eventId`  
**Change:** The `isConfirmed` field is now stripped from all player objects (both `raidDrop` and `bench` arrays) for non-management users before the response is sent.

**Implementation pattern:**
```javascript
let isManagement = false;
try {
    if (req.isAuthenticated && req.isAuthenticated() && req.user && req.user.id) {
        isManagement = await hasManagementRoleById(req.user.id);
    }
} catch (authErr) {
    // If auth check fails, treat as non-management (safe default)
}
if (!isManagement) {
    rosterData.raidDrop.forEach(p => { if (p) delete p.isConfirmed; });
    rosterData.bench.forEach(p => { if (p) delete p.isConfirmed; });
}
```

**Security properties:**
- Default is `false` — auth failure never grants management access
- Strips from both `raidDrop` (in-raid) and `bench` arrays
- Frontend also has an explicit check: only renders confirmation icons when `isConfirmed !== undefined && isConfirmed !== null`

## Input Validation

- No new user input fields introduced by this PR.
- `adminSidebarCollapsed` localStorage key stores only a boolean string — not user-controlled sensitive data.
- Discord Recent Joins panel: username rendered via `escapeHtmlSidebar()` (XSS-safe).

## XSS Considerations

### New Code (This PR) — Clean
- Recent Discord Joins sidebar: usernames escaped with `escapeHtmlSidebar()` ✅
- Bench class column headers: use DOM `createElement`/`textContent` (not innerHTML) ✅
- CLASS_ICONS: hardcoded numeric Discord emoji IDs — not user input ✅
- Class icon `src` URLs: constructed from CLASS_ICONS map (static, not user-controlled) ✅

### Pre-existing Pattern — Noted
- `displayName` (`player.mainCharacterName || player.name`) is inserted into `cell.innerHTML` via template literals without explicit escaping. This is a pre-existing pattern throughout the codebase. Mitigation: these values are WoW character names / Discord display names stored in the DB, and all write APIs require `requireRosterManager`. Risk is LOW in this trust model.

## Known Security Notes

### `/api/discord/member-events` — No Auth Required (Pre-existing)
This endpoint is unauthenticated and returns Discord member join/leave events (usernames, Discord IDs, timestamps). The frontend sidebar correctly gates calling this endpoint behind `currentUserCanManage`, but the API itself has no auth middleware. This is a pre-existing state:
- **Risk:** LOW — data is non-sensitive (Discord join events are publicly observable for guild members)
- **Recommendation:** Add `requireAuth` middleware in a future sprint if this data should be access-controlled

### npm Audit — Pre-existing CVEs
All 23 vulnerabilities in `npm audit` are from pre-existing dependencies — no new vulnerable packages were added in this PR:
- **Critical:** `fast-xml-parser` via `@aws-sdk/client-s3` (pre-existing)
- **High:** `multer <=2.1.0`, `axios`, others (pre-existing)
- **Recommendation:** Run `npm audit fix` in a dedicated dependency update sprint

## localStorage Security
Only `adminSidebarCollapsed` (true/false string) is added. Pre-existing localStorage keys also non-sensitive. No session tokens, credentials, or PII stored in localStorage.
