# Security: Session Authentication & Discord OAuth Token Refresh

_Last updated: 2026-03-03 by Security Gort_

## Overview

The Classic WoW Manager uses Passport.js with the Discord OAuth2 strategy for authentication. Sessions are persisted in PostgreSQL via `connect-pg-simple`.

## Authentication Requirements

- All sensitive routes must be protected by `isAuthenticated()` middleware (Passport).
- Session cookies are `httpOnly` (default), `sameSite: 'lax'`, and `secure: true` when `NODE_ENV=production`.
- `NODE_ENV=production` **must** be set in Heroku config vars for both production and staging apps. Without it, cookies will lack the `Secure` flag and cache TTLs will be development-length.

## Session Configuration

| Setting | Value | Notes |
|---|---|---|
| Cookie `maxAge` | 90 days (7,776,000,000 ms) | Resets on every response (`rolling: true`) |
| PG store `ttl` | 90 days (7,776,000 s) | |
| `secure` flag | `NODE_ENV === 'production'` | Must be true in production |
| `sameSite` | `lax` | Appropriate for OAuth redirect flows |
| Session secret | `process.env.SESSION_SECRET` | Must be set in Heroku env |

## Discord OAuth Token Refresh

### Purpose
Discord access tokens expire after 7 days. The refresh middleware proactively refreshes tokens at the 6-day mark (1-day buffer), preventing token expiry. This is **defensive/future-proofing** — current role checks use the local DB (`app_user_roles` table), not live Discord API calls.

### Implementation
- **Function:** `refreshDiscordToken(req)` in `index.cjs`
- **Trigger:** Middleware running after `passport.session()` on every authenticated request
- **Threshold:** Token refreshed when `tokenIssuedAt` is > 6 days old
- **Rate limit:** Maximum 1 refresh attempt per hour per session (tracked via `lastRefreshAttempt`)
- **Non-blocking:** Fire-and-forget — never delays the request
- **Failure behaviour:** Logs warning, continues — session remains valid

### Authorization Rules

| Scenario | Behaviour |
|---|---|
| Unauthenticated user | Middleware skips entirely |
| QA bypass user (`accessToken === 'qa-bypass'`) | Skipped explicitly |
| Token < 6 days old | No refresh |
| Token ≥ 6 days old | Async refresh triggered |
| Missing `tokenIssuedAt` (legacy session) | Refresh attempted once, then timestamp set |
| Refresh fails | Warning logged, session unaffected |
| Refresh within 1hr cooldown | Skipped |

### Secrets & Credentials
- `DISCORD_CLIENT_ID` — must be set as Heroku env var
- `DISCORD_CLIENT_SECRET` — must be set as Heroku env var
- `SESSION_SECRET` — must be set as Heroku env var
- `QA_BYPASS_TOKEN` — must be set on staging only; never production

**Never hardcode any of the above.** They must come exclusively from `process.env`.

## Input Validation

No user input flows into the token refresh path. The `refresh_token` used in the Discord POST request is sourced exclusively from the server-side session (`req.user.refreshToken`), which is stored from the OAuth callback.

## Logging Rules

✅ **OK to log:** `discord_id`, HTTP status code, Discord API error response body (e.g., `{"error":"invalid_grant"}`), timestamps  
❌ **Never log:** `accessToken`, `refreshToken`, `SESSION_SECRET`, `DISCORD_CLIENT_SECRET`

Discord API error responses do **not** echo back submitted tokens, so logging `err.response.data` is safe. However, avoid adding verbose request logging that might capture full request bodies on OAuth endpoints.

## Known Vulnerabilities (Pre-existing, Not Blocking)

| Package | Severity | CVE Type | Notes |
|---|---|---|---|
| `axios` | High | DoS via `__proto__` in mergeConfig | Used for token refresh. Attack requires crafted config object — not exploitable from user input. Update in future sprint. |
| `multer` | High | DoS via resource exhaustion | Used for file uploads. Patch available. Fix in future sprint. |
| `fast-xml-parser` | Critical | DoS / entity expansion | Transitive via `@aws-sdk`. Review if S3 SDK is in active use. |
| `minimatch` | High | ReDoS | Transitive dep. Low exposure unless user-controlled glob patterns. |

## Audit Checklist (for future changes to auth/session code)

- [ ] No secrets hardcoded — all from `process.env`
- [ ] Token refresh POST goes to hardcoded HTTPS URL (never user-controlled)
- [ ] Refresh token is session-sourced only — no user input
- [ ] Error logs contain only discord_id + status, no tokens
- [ ] QA bypass path explicitly skipped
- [ ] Session save errors handled (reject on success path, best-effort on failure path)
- [ ] Rate limiting in place for any endpoint that calls external APIs
