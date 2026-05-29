# Security: Profile Page — Claim Banner & Notification Fallback

## Feature Overview
- **BUG 1:** `.pending-claim-notice` CSS updated to dark-mode warning colors
- **BUG 2:** Maya Discord notification fallback logging when `discordClient` is null

## Files Changed
- `public/user-settings.css` — CSS color values only
- `index.cjs` — 2 `else` branches for fallback console.warn

## Authentication Requirements
- Character unlink endpoint (`DELETE /api/characters/:name`) — requires authenticated session (passport-discord)
- Character claim endpoint — requires authenticated session (passport-discord)
- No changes to auth requirements in this card

## Authorization Rules
- Users can only unlink/claim characters associated with their own Discord ID
- No changes to authorization logic in this card

## Input Validation
- No new user input paths introduced
- Changes are output-only: CSS color values and console.warn logging

## Notification Logging (console.warn)
- When `discordClient` is null, fallback logs include: username, character name, class, discord_id, claim ID
- This data is server-side Heroku logs only (not exposed to clients)
- Discord IDs are semi-public guild management data — acceptable in internal logs
- No tokens, passwords, or session secrets are logged

## Hardcoded Values
- Channel ID `1479091461982126181` is hardcoded in both notification blocks — this is the management channel ID, matches the Discord guild setup. Not a secret.

## Known Security Considerations
- The stub bot pattern (`createPersonaBot()` returning a stub when token is missing) silently skips notifications. The `else` branch added here surfaces this as a logged warning rather than silent failure.
- Pre-existing CVEs in dependencies (fast-xml-parser critical, axios/lodash/multer/etc. high) are unrelated to this feature. Track for future dependency update sprint.

## Audit Logging
- Notification attempts (both success and failure) are logged server-side
- Failed Discord sends log full message content at WARN level with `[persona-bot]` prefix
