# Security: Sandbox Banner (Staging Environment Indicator)

**Feature:** Orange "SANDBOX" text replaces the 1Principles logo on staging deployments.
**Files:** `public/top-bar.js`, `public/style.css`
**Last reviewed:** 2026-03-03 by Security Gort

## Authentication Requirements
None — this is a purely visual, client-side feature with no auth involvement.

## Authorization Rules
None — the banner is visible to all users on staging.

## How Staging is Detected
- Detection is purely client-side via `window.location.hostname.includes('staging')`
- This is not user-controllable input; hostname is set by the server/DNS
- Production site is unaffected — `staging` does not appear in its hostname

## Input Validation
No user input is involved. The injected text is the literal string `'SANDBOX'` (hardcoded, not user-supplied).

## XSS Considerations
- `sandboxLabel.textContent = 'SANDBOX'` is used — **not** `innerHTML`
- `textContent` is safe from XSS by design (content is treated as text, not HTML)
- CSS color values are hex literals (`#FF6600`) — no dynamic evaluation

## SQL Injection
Not applicable — this is a front-end CSS/JS change with no database interaction.

## Known Security Considerations
- The banner does NOT provide any security guarantee — it is purely informational
- An attacker could spoof the banner by injecting CSS/JS on a compromised page, but this does not affect security posture
- The `hostname.includes('staging')` check could theoretically match a custom domain containing "staging" — acceptable risk, as no sensitive logic is gated on this check

## Pre-existing Dependency Vulnerabilities (noted, not introduced by this change)
- `multer <=2.0.2` — high severity DoS (file upload handling)
- `qs 6.7.0-6.14.1` — high severity DoS (query string parsing)
- `minimatch` — ReDoS vulnerability
- Recommendation: Run `npm audit fix` in a dedicated sprint

## Audit Logging
Not applicable — no server-side changes made.
