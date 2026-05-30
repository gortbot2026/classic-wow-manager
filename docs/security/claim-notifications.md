# Security: Character Claim Notifications

_Last updated: 2026-05-30 by Security Gort_

## Overview

The claim notification system posts Discord messages when characters are claimed, approved, declined, or unlinked. Three settings are now admin-configurable via `/admin/maya-settings`:

- **Claim notification channel** (`claim_notification_channel_id`) — Discord channel ID
- **Tag user on new claims** (`claim_tag_discord_id`) — Discord user ID to @mention
- **DM on resolve** (`claim_dm_on_resolve`) — boolean, whether to DM claimants

---

## Authentication & Authorization

All configuration endpoints are protected by `requireManagement` middleware (`index.cjs`, function at ~line 3325), which:

1. Validates active session (`req.isAuthenticated()`) — returns 401 if not authenticated
2. Checks Discord role via `hasManagementRoleById(req.user.id)` — returns 403 if missing management role

**Affected endpoints:**
- `GET /api/admin/maya/persona` — read current settings
- `PATCH /api/admin/maya/persona` — update settings (includes claim fields)

No unauthenticated access is possible.

---

## Input Validation Rules

### `claim_notification_channel_id` (VARCHAR(32))
- **Frontend:** `pattern="[0-9]*"` attribute on input (client-side hint only)
- **Backend:** `.trim()` applied; empty string → stored as `NULL`
- **No server-side numeric validation** — invalid IDs fail gracefully when Discord API rejects the channel fetch (wrapped in try/catch)
- **Recommendation (future):** Add `/^\d{17,20}$/` regex check server-side to reject non-snowflakes early

### `claim_tag_discord_id` (VARCHAR(32))
- Same validation as channel ID above
- Used in Discord message as `<@${tagUserId}>` — the `<@>` wrapper prevents `@everyone` text injection
- Empty/null → tag entirely omitted from message (no broken mention sent)

### `claim_dm_on_resolve` (BOOLEAN)
- Sent as JSON boolean from frontend (`element.checked` → always boolean)
- PostgreSQL BOOLEAN type enforces type safety at DB layer
- Logic uses `!== false` check (not `!truthy`) — correctly defaults to `true` when not set

---

## SQL Injection Prevention

All new queries use parameterized statements:

```js
// Cache load (no parameters — safe)
pool.query('SELECT claim_notification_channel_id, claim_tag_discord_id, claim_dm_on_resolve FROM bot_persona ORDER BY id LIMIT 1')

// PATCH update (parameterized)
pool.query(
  `UPDATE bot_persona SET ${updates.join(', ')} WHERE id = (SELECT id FROM bot_persona ORDER BY id LIMIT 1) RETURNING *`,
  params  // all user-supplied values passed as params, never interpolated
)
```

No raw string interpolation of user input. ✅

---

## XSS Prevention

- Settings values are Discord snowflake IDs stored in DB and sent to Discord API
- Values are **never rendered as HTML** in admin pages — displayed in `<input>` elements via `.value` assignment
- No `innerHTML`, `document.write`, or `dangerouslySetInnerHTML` used

---

## Discord Mention Injection

The tag user ID is used to construct a Discord mention:

```js
const tagUser = getClaimTagUserId();
const tagPrefix = tagUser ? `<@${tagUser}> ` : '';
```

**Threat model:** If a malicious admin enters `everyone` as the user ID, the resulting string `<@everyone>` is **not** a valid Discord @everyone ping — Discord only processes `@everyone` as plain text, not `<@everyone>`. The `<@>` wrapper neutralises plain-text injection.

**Access control:** Only management-role users can set these values, limiting blast radius.

---

## Cache Security

- In-memory cache (`claimSettingsCache`) is module-level in `index.cjs`
- Populated at startup after `initializeMayaTables()` completes
- Refreshed on every successful `PATCH /api/admin/maya/persona`
- No TTL needed — admin saves are the sole write path
- Cache defaults are safe public Discord snowflakes (not secrets)

`persona-bot.cjs` queries `bot_persona` directly for `claim_dm_on_resolve` (DB hit per resolve call) — acceptable overhead, no cache sharing needed for this read-only consumer.

---

## Known Pre-Existing Dependency Vulnerabilities

These are **not introduced by this feature** (package.json unchanged):

| Severity | Package | CVE | Notes |
|----------|---------|-----|-------|
| Critical | fast-xml-parser ≤5.6.0 | GHSA-37qj-frw5-hhjh, GHSA-m7jm-9gc2-mpf2, GHSA-jmr7-xgp7-cmfj, GHSA-fj3w-jwp8-x2g3, GHSA-8gc5-j5rx-235r | DoS via entity expansion / regex injection |
| High | ws 8.0.0–8.20.0 | GHSA-58qx-3vcg-4xpx | Uninitialized memory disclosure |
| High | engine.io, socket.io-adapter | Depend on vulnerable ws | Inherited |
| High | @smithy/middleware-retry | — | Dependency chain |

**Recommendation:** Dedicate a sprint to `npm audit fix` and update these packages. The fast-xml-parser criticals should be prioritised.

---

## Audit Logging

No dedicated audit log for claim settings changes beyond:
- Standard Express error logs on PATCH failure
- `[claim-settings] Cache loaded: {...}` log on every cache refresh (logs channel/user IDs — non-secret)

**Future consideration:** Log setting changes (old value → new value, changed by whom) for accountability.
