# Security: Sandbox Logo (Staging Indicator)

## Feature Overview
On staging deployments, `injectSandboxBanner()` in `public/top-bar.js` replaces the 1Principles logo image with bold orange "SANDBOX" text. This visually distinguishes staging from production.

## Authentication Requirements
- None. This is a purely visual, client-side change with no auth interaction.

## Authorization Rules
- Not applicable. No server-side endpoints involved.

## Staging Detection
- Detection: `window.location.hostname.includes('staging')`
- Read-only; cannot be manipulated by user input to affect server state
- Only affects client-side rendering

## Input Validation
- No user input is involved in this feature
- The SANDBOX text is a hardcoded string literal assigned via `element.textContent` (not `innerHTML`) — XSS not possible

## Known Security Considerations
- **textContent vs innerHTML:** The implementation correctly uses `textContent = 'SANDBOX'` — no XSS vector exists here
- **Inline style injection:** Color is set via `element.style.color = '#FF6600'` (hardcoded constant) — no injection vector
- **CSS !important usage:** Belt-and-suspenders approach for color specificity; no security implications
- **Pre-existing npm vulnerabilities:** As of 2026-03-03, `npm audit` reports 23 pre-existing vulnerabilities (1 critical: `fast-xml-parser`, 20 high: various AWS SDK + axios packages, 1 moderate, 1 low). **None introduced by this change.** Track resolution in a separate chore card.

## Audit Logging
- Not applicable (client-side only, no state changes).

## Review History
- 2026-03-03: Security Gort reviewed. PASS. Pure CSS/JS frontend change, no security concerns.
