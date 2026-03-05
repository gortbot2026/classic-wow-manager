# Security: Maya Conversation Management

## Endpoints

### DELETE /api/admin/maya/conversations/:conversationId

**Authentication:** `requireManagement` middleware — requires authenticated session with Management Discord role. Returns 401 if unauthenticated, 403 if insufficient role.

**Authorization:** Management role only. No user can delete another guild's data — the endpoint operates within the scoped guild DB.

**Input Validation:**
- `conversationId` comes from URL params only; never from request body
- Used exclusively in parameterized queries (`$1` placeholders) — SQL injection not possible
- No length/format validation needed: invalid IDs return 404 gracefully

**Active Conversation Guard:**
- Returns 400 if `status = 'active'` — prevents deletion of in-progress Maya conversations
- Admin must close the conversation via PATCH endpoint first

**Database Safety:**
- All deletes wrapped in a PostgreSQL transaction with `ROLLBACK` on error
- FK-safe deletion order: `bot_messages` → nullify `bot_player_notes.source_conversation_id` → `pending_raidleader_summaries` → `bot_conversations`
- `bot_player_notes` records are **preserved** — only the back-reference is nullified

**Error Handling:**
- 500 responses return generic `"Error deleting conversation"` message only
- Full error detail logged server-side via `console.error('[maya-api] ...')`, never exposed to client

**Socket.io:**
- Emits `maya:conversation-deleted` on `/maya-admin` namespace after successful delete
- Payload: `{ conversationId, discordUserId }` — no secrets or session data

---

## Frontend (public/admin/player.js)

**XSS Prevention:**
- `escapeHtml()` is applied to all conversation data rendered into HTML (id, dateStr, status, preview)
- `escapeHtml()` implementation uses DOM `textContent` → `innerHTML` — safe against all script injection
- `conversationId` in onclick JS string context is safe: IDs are `crypto.randomUUID()` format (hex + hyphens only)

**CSRF/Fetch Security:**
- `credentials: 'include'` on all fetch calls — uses session cookie, consistent with all other admin endpoints
- `encodeURIComponent(conversationId)` on fetch URL — path traversal not possible

**Confirmation Dialog:**
- `confirm()` dialog prevents accidental deletion: "Delete this conversation and all its messages? This cannot be undone."

---

## Known Pre-existing Dependency Vulnerabilities

These CVEs **pre-existed** this feature and were **not introduced** by it:

| Package | Severity | CVE |
|---------|----------|-----|
| fast-xml-parser | Critical | GHSA (ReDoS) |
| multer | High | GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc, GHSA-5528-5vmv-3xc2 |
| axios | High | (see npm audit) |
| qs | High | GHSA-w7fw-mjwx-w883 |
| minimatch | High | (see npm audit) |

**Recommendation:** Address in a dedicated dependency upgrade sprint. Not blocking.

---

*Last reviewed: 2026-03-05 by Security Gort*
*Card: cmmdcspwx000bl0ce2qxfc9rf — Delete conversation histories*
