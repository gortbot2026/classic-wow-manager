# Security: Admin Navigation Bar Component

**Feature:** Shared admin navigation bar (`admin-nav-bar`)  
**Pages:** `/admin`, `/admin/raid-channels`, `/admin/points`, `/admin/maya-settings`, `/admin/player/:id`  
**Last reviewed:** 2026-03-05 by Security Gort  

---

## Authentication Requirements

All admin pages must be protected by server-side authentication middleware. The nav bar HTML itself does not enforce auth — this is handled by the Express route layer (passport-discord session check). Verify that all routes serving these HTML files require an authenticated admin session.

## Authorization Rules

- Admin pages are restricted to users with admin role
- The "Exit Admin" button links to `/` (home) — safe static href, no redirect parameter
- No admin-level actions are performed by the nav bar itself

## Input Validation

The nav bar component contains **no user input fields**. All nav links are static hardcoded hrefs:
- `/admin` — Admin Home
- `/admin/raid-channels` — Raid Channels  
- `/admin/points` — Points
- `/admin/maya-settings` — Maya Settings

No dynamic values are injected into nav link hrefs. No open redirect risk.

## Dark Mode Toggle

- Reads/writes `localStorage['admin-theme']` only
- Toggles `html.dark` CSS class on client side
- No server interaction, no injection surface
- Handled by `/admin-dark-mode.js` (shared script)

## Known Security Considerations

### Font Awesome CDN (LOW risk)
`https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css` is loaded without a Subresource Integrity (SRI) hash. If the CDN is compromised, malicious CSS could be injected. Risk is acceptable for admin-only internal pages; consider adding SRI hash in a future hardening sprint.

### Pre-existing Dependency Vulnerabilities (track separately)
The following pre-existing CVEs exist in `package.json` dependencies and are **not** related to the nav bar component. They should be tracked and fixed in a dedicated dependency update card:

- **CRITICAL:** `fast-xml-parser` (via `@aws-sdk/client-s3`) — entity encoding bypass, DoS via DOCTYPE expansion, RangeError DoS. Run `npm audit fix` to resolve.
- **HIGH:** `multer` ≤2.1.0 — DoS via incomplete cleanup / resource exhaustion / uncontrolled recursion
- **HIGH:** `minimatch` ≤3.1.3 — ReDoS via repeated wildcards
- **MODERATE:** `lodash` — prototype pollution in `_.unset` and `_.omit`

## Audit Logging

No audit logging required for nav bar navigation. Admin actions on individual pages (e.g., saving Maya settings, modifying roles) should be logged at the feature level.
