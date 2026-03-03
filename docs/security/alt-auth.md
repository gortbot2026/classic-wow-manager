# Security Documentation: Alternative Authentication (Google + Email/Password)

**Feature:** Alternative login methods for region-restricted users  
**Last updated:** 2026-03-03 (Round 2 — all MEDIUM findings resolved)  
**Status:** ✅ PASS — approved for QA

---

## Overview

Adds Google OAuth and Email/Password as supplementary login methods alongside Discord OAuth. All alt-auth users must link their Discord ID before accessing any authenticated endpoint, ensuring `req.user.id` is always a valid Discord snowflake ID.

---

## Authentication Requirements

- Discord OAuth remains the primary/recommended method
- Google OAuth and Email/Password are for users in Discord-restricted regions
- All alt-auth users must link a Discord ID before accessing any protected routes
- The Discord ID gate middleware enforces this constraint globally

---

## Authorization Rules

- `req.user.id` MUST always resolve to a Discord snowflake (17-20 digits)
- Alt-auth sessions are normalized at login/link-discord to set `req.user.id = discordId`
- Discord token refresh middleware skips users without `req.user.refreshToken` — alt-auth users are safe
- Role checks, polls, character lookups all use `req.user.id` unchanged

---

## Input Validation Rules

| Field | Validation |
|-------|-----------|
| Email | RFC-format, not in disposable-email-domains blocklist |
| Password | Minimum 8 characters |
| Discord ID | 17–20 digit numeric string (snowflake format) |
| returnTo param | `/^\/(?!\/)/.test(value)` — rejects protocol-relative `//evil.com` |

---

## Database Security

### alt_auth_users table
- `password_hash`: bcrypt with cost factor 12
- `verification_token`: 32 bytes `crypto.randomBytes`, hex-encoded, 24h expiry
- `discord_id`: UNIQUE INDEX (WHERE NOT NULL) — prevents race conditions on duplicate linking
- `(provider, email)`: UNIQUE INDEX
- `(provider, provider_id)`: UNIQUE INDEX WHERE NOT NULL

---

## Known Security Considerations

### Open Redirect Prevention ✅ (fixed Round 2)
`safeReturnTo()` helper at index.cjs line ~378 uses `/^\/(?!\/)/.test(value)` to reject all non-path values including protocol-relative URLs. Applied at all 4 returnTo handling locations.

### Discord ID Race Condition ✅ (fixed Round 2)
DB-level UNIQUE constraint on `discord_id WHERE NOT NULL` (line ~863) prevents duplicate linking even under concurrent requests.

### Session Save Race Condition ✅ (fixed Round 2)
`/auth/link-discord POST` now awaits `session.save()` via Promise wrapper before responding (line ~3049).

### Email Enumeration (LOW — accepted risk)
Registration endpoint returns "email already registered" error. For this use case (guild management, closed community), this is an accepted LOW risk. Recommendation: normalize to "If this email is not registered, a verification link will be sent" in a future sprint.

### Rate Limiting (OUT OF SCOPE v1)
No rate limiting on registration/login endpoints. Acceptable for v1 guild tool. Add in v2.

---

## Pre-existing Dependency CVEs (NOT introduced by this PR)

| Package | Severity | Note |
|---------|----------|------|
| fast-xml-parser | CRITICAL | Pre-existing, not used in auth flow |
| multer | HIGH | Pre-existing file upload library |
| minimatch | HIGH | Pre-existing glob matching |
| axios | HIGH | Pre-existing HTTP client |
| @aws-sdk/* | HIGH | Pre-existing S3 integration |

**New packages added by this PR:** passport-google-oauth20, passport-local, bcrypt, nodemailer, disposable-email-domains — **zero CVEs**.

---

## Audit Logging

- Successful Google logins logged: `[alt-auth] Google login for profile ${profile.id}`
- Discord ID linking logged: `[alt-auth] Linked alt_auth_id=${id} to discord_id=${discordId}`
- Session save errors logged as errors

---

## Future Enhancements (v2)

- Password reset flow
- Rate limiting on registration/login endpoints
- CAPTCHA on registration
- Admin UI for managing alt-auth users
- Normalize email enumeration response
