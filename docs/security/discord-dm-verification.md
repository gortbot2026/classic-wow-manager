# Security: Discord DM Verification for Alt-Auth Discord ID Linking

**Feature:** Two-step DM verification flow for alt-auth users (Google/email-password) linking their Discord ID.
**Reviewed:** 2026-03-03
**Status:** PASS

---

## Authentication Requirements

- `POST /api/auth/request-discord-verify` — requires active alt-auth session (`req.user.altAuthId` must be set)
- `POST /api/auth/confirm-discord-verify` — requires active alt-auth session (`req.user.altAuthId` must be set)
- `GET /auth/verify-discord?token=TOKEN` — **public route** (no session required; session is restored from the magic token)

## Authorization Rules

- Both POST endpoints gate on `req.user.altAuthId` taken from the **session** (not request body), preventing altAuthId spoofing.
- Discord ID linking is scoped strictly to the authenticated alt-auth user's record.
- altAuthId is never accepted from the request body on any endpoint.

## Input Validation

| Field | Endpoint | Validation |
|-------|----------|------------|
| `discordId` | request-discord-verify, confirm-discord-verify | Server-side: `/^\d{17,20}$/` (Discord snowflake format) |
| `code` | confirm-discord-verify | Server-side: `/^\d{4}$/` (4-digit numeric only) |
| `token` | verify-discord | Length check: must be exactly 64 characters |

**Note:** The magic token format check (`token.length !== 64`) validates length only; hex character set is not explicitly checked. This is LOW risk because the DB query is parameterized and an invalid token simply returns no rows.

## Verification Flow Security Properties

1. **Proof of Discord ownership:** 4-digit code + magic link are delivered exclusively via Discord DM to the claimed Discord ID. Only the account owner can receive the DM.
2. **Single-use codes:** `completed_at` is set on first use; subsequent requests with the same token return no row.
3. **Code invalidation:** Requesting a new code for the same `alt_auth_id + discord_id` combination deletes any existing pending (uncompleted) row before inserting the new one.
4. **Non-expiring magic links:** By design, magic links have no time expiry. `completed_at IS NOT NULL` prevents reuse. This is an acceptable trade-off per the v1 spec.
5. **No code in API response:** The verification code is never returned in any API response — only delivered via Discord DM.

## Database

- `discord_link_verifications` table: stores pending/completed verification records.
- `idx_alt_auth_discord_id` on `alt_auth_users` changed from UNIQUE to non-unique to support multiple alt-auth providers (Google + email/password) sharing a single `discord_id`.
- Magic tokens have a UNIQUE constraint in the DB — collision probability is negligible (64 hex chars = 256-bit entropy).

## Known Limitations (v1 Scope Decisions)

### MEDIUM Risk: No Rate Limiting on confirm-discord-verify
- The code space is 9000 values (1000-9999). Without rate limiting, an attacker with an active alt-auth session could theoretically brute-force the 4-digit code.
- **Mitigating factors:** The attacker must first trigger a DM to the victim's Discord (alerting them), and the victim can request a new code (invalidating the old one).
- **Resolution:** Rate limiting / attempt lockout on `confirm-discord-verify` should be added in v2. Recommended: max 10 attempts per pending verification record, then require a new code request.

### LOW Risk: Code Briefly in Redirect URL
- `GET /auth/verify-discord` redirects to `/auth/link-discord?code=XXXX&discord_id=ID&auto=1`. The code appears in the URL briefly before client-side JS clears it via `history.replaceState`.
- **Mitigating factors:** The code alone is insufficient — an attacker also needs an active alt-auth session (cookie). The URL is cleaned immediately.
- **Resolution:** Acceptable for v1. Could be improved in v2 by using a short-lived server-side token instead of passing the code in the URL.

## Dependency Notes (Pre-existing, not introduced by this feature)

- **CRITICAL:** `fast-xml-parser` via `@aws-sdk` — XML entity encoding bypass. Add to backlog for update.
- **HIGH:** `multer` DoS via resource exhaustion / incomplete cleanup. Add to backlog.
- **HIGH:** `minimatch` ReDoS via repeated wildcards. Add to backlog.
- **HIGH:** `axios` DoS via `__proto__` key in mergeConfig. Add to backlog.

These vulnerabilities were pre-existing in the codebase and were not introduced by this feature.

## Audit Logging

- Successful linkings are logged: `[alt-auth] Verified and linked alt_auth_id=X to discord_id=Y`
- Errors logged without sensitive data (code/token values are not logged)
