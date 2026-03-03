# Security: Alternative Authentication (Google OAuth + Email/Password)

_Reviewed by: Security Gort — 2026-03-03_

## Overview

Feature adds Google OAuth and Email/Password as alternative login methods for guild members in regions where Discord is blocked. All alt-auth users must link a Discord ID before accessing authenticated features.

## Authentication Requirements

- Discord OAuth remains the primary and recommended login method
- Google OAuth requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` env vars (never hardcoded)
- Email/Password requires `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` env vars
- Google OAuth requires callback URIs configured in Google Cloud Console for both prod and staging

## Authorization Rules

- Alt-auth users **must** link a Discord ID before accessing any authenticated endpoint
- Discord ID gate middleware runs after `passport.session()` and redirects unlinked users to `/auth/link-discord`
- The gate skips: `/auth/*` routes, `/public/*`, static assets (js/css/images), `/logout`
- Once Discord ID is linked, `req.user.id` is set to the Discord ID — identical to Discord OAuth sessions
- All role checks, polls, character lookups use `req.user.id` (Discord ID) consistently

## Input Validation Rules

| Input | Validation |
|-------|-----------|
| Email address | Regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` + disposable domain blocklist |
| Password | Minimum 8 characters |
| Discord ID | Regex: `/^\d{17,20}$/` (Discord snowflake format) |
| `returnTo` parameter | Must start with `/` (blocks absolute URLs) |

## Password Security

- Bcrypt with cost factor **12** (server-side, not configurable at runtime)
- Verification tokens: `crypto.randomBytes(32).toString('hex')` — 64 hex chars, 24h expiry
- Tokens cleared from DB after successful verification (one-time use)

## Known Security Considerations

### MEDIUM: Open Redirect via Protocol-Relative returnTo
- **Issue:** `returnTo` validation uses `startsWith('/')`, which permits `//evil.com`
- **Affected routes:** `GET /auth/google`, `POST /auth/local/login`
- **Risk:** Phishing — attacker crafts login link that redirects to malicious site after successful login
- **Fix (v2):** Change check to `/^\/(?!\/)/.test(returnTo)` to block protocol-relative URLs
- **Workaround:** Users must not click untrusted login links

### MEDIUM: Discord ID Uniqueness (Application-Level Only)
- **Issue:** `alt_auth_users.discord_id` has only an index, not a UNIQUE constraint
- **Risk:** Race condition — two concurrent users could link to the same Discord ID
- **Fix (v2):** Add `ALTER TABLE alt_auth_users ADD CONSTRAINT unique_discord_id UNIQUE (discord_id)` and handle constraint errors
- **Mitigation:** Application-level check before update reduces likelihood; exploit requires precise timing

### LOW: Session Save Race Condition in /auth/link-discord
- **Issue:** Response sent before `session.save()` completes — very fast redirect could use stale session
- **Fix (v2):** Await session save before sending JSON response
- **Mitigation:** Client JS has 800ms delay before redirect; in practice not exploitable

### LOW: Email Enumeration
- **Issue:** Registration endpoint returns `409` if email already registered and verified
- **Risk:** Attacker can enumerate valid email addresses
- **Acceptable:** Low-value target (guild site, not financial); consistent error messages for wrong password

## Dependency Audit

As of 2026-03-03 — new packages introduced by this feature are **all clean**:
- `passport-google-oauth20` — no CVEs
- `passport-local` — no CVEs
- `bcrypt` — no CVEs
- `nodemailer` — no CVEs
- `disposable-email-domains` — no CVEs

Pre-existing vulnerabilities (not introduced by this feature):
- `fast-xml-parser` CRITICAL (via @aws-sdk) — DoS/RCE via XML parsing
- `multer` HIGH — DoS via incomplete cleanup
- `minimatch` HIGH — ReDoS
- `axios` HIGH — DoS via proto key
- `lodash` MODERATE — prototype pollution

These pre-existing CVEs should be addressed in a separate dependency upgrade sprint.

## Audit Logging

Session creation logged:
- `[session] Created for google alt-auth id=X discord_id=Y`
- `[session] Created for local alt-auth id=X discord_id=Y`
- `[alt-auth] Linked alt_auth_id=X to discord_id=Y`

Token refresh skip logged implicitly (no action taken for alt-auth users).

## Future Enhancements (v2)

1. Fix open redirect — use `/^\/(?!\/)/.test(returnTo)` check
2. Add DB UNIQUE constraint on `alt_auth_users.discord_id`
3. Await `session.save()` before responding in `/auth/link-discord`
4. Rate limiting on `/auth/local/register` and `/auth/local/login`
5. CAPTCHA on registration
6. Password reset flow
7. Address pre-existing dependency CVEs
