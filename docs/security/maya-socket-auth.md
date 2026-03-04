# Maya Socket.IO Authentication — Security Requirements

**Feature:** Real-time Maya admin chat panel (`/admin/player/:discordId`)
**Last updated:** 2026-03-04

## Authentication Requirements

- Socket.IO namespace `/maya-admin` requires an authenticated Discord user ID
- The `userId` passed in socket auth **must** come from a verified server session (via `/user` endpoint), never from client-side DOM or user input
- Socket init **must** be called after `currentUser` is populated from `/user` fetch — never race against the auth fetch
- Server-side middleware calls `hasManagementRoleById(userId)` — only users with management role may connect

## Authorization Rules

- Socket events (`maya:message`, `maya:typing`, `maya:status`, `maya:note-added`, `maya:note-deleted`) are scoped by `conversationId` or `discordId`
- Client must filter events by matching `data.conversationId === currentConversation.id` or `data.discordId === discordId` to prevent cross-player data leakage

## Input Validation Rules

- `discordId` from URL must match `/^[0-9]{1,20}$/` before being used
- `userId` parameter to `initMayaSocket()` must be truthy — guard `if (!userId) return` prevents null/undefined auth
- All message content rendered via `escapeHtml()` (uses `textContent` → `innerHTML` pattern) — XSS safe
- All note content rendered via `escNote()` — XSS safe

## Implementation Notes

- `initMayaSocket()` and `initMayaNotesSocket()` **must be in the same IIFE scope** as the `init()` function that calls them, or otherwise made accessible (e.g., via `window.*` or merged into a single IIFE)
- Calling across separate IIFE scopes will cause `ReferenceError` at runtime

## Known Security Considerations

- `connect_error` handler logs `err.message` to console — acceptable since admins are trusted users and no sensitive data is in the error
- Pre-existing CVEs in `multer` (HIGH - DoS) and `axios` (HIGH) are production dependencies — should be addressed in a dedicated dependency update sprint

## Audit Logging

- Server logs `maya-admin Admin connected` on successful socket auth
- `connect_error` handler logs warning to browser console for debug visibility
