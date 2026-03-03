# Security: Sandbox Banner (top-bar.js)

**Feature:** Replace logo with bold orange "SANDBOX" text on staging deployments  
**Files:** `public/top-bar.js`, `public/style.css`  
**Review date:** 2026-03-02  
**Reviewed by:** Security Gort  
**Verdict:** PASS

---

## What It Does

`injectSandboxBanner()` in `public/top-bar.js` detects the staging environment by checking
`window.location.hostname.includes('staging')`. If matched, it replaces the `.app-logo` `<img>`
element inside `.top-bar` with a `<span class="sandbox-logo">SANDBOX</span>` element.

The function runs **after** `normalizeTopBar()` in the `DOMContentLoaded` handler so the
`<a class="logo-link">` anchor wrapping is already in place.

---

## Authentication & Authorization

- **No auth required** — purely cosmetic, client-side only.
- No server-side endpoint touched. No session data accessed.

---

## Input Validation

- **No user input processed.** `window.location.hostname` is a read-only browser API.
- The text inserted into the DOM is the static literal string `'SANDBOX'` via `textContent`
  (never `innerHTML`), so no user-supplied data can reach the DOM.

---

## XSS Considerations

| Risk | Status |
|------|--------|
| innerHTML injection | ❌ Not used — `textContent` only |
| Dynamic string interpolation | ❌ Not used — static `'SANDBOX'` literal |
| User-controlled content in DOM | ❌ None — hostname is read-only |

---

## Fail-Safe Behavior

The entire function is wrapped in `try/catch` with a no-op catch block. Any unexpected
error (e.g., DOM not ready, `.app-logo` absent) silently no-ops without affecting
production or localhost.

---

## Scope Isolation

| Environment | Behavior |
|-------------|----------|
| `classic-wow-manager-staging-*.herokuapp.com` | SANDBOX text shown ✅ |
| `www.1principles.net` (production) | Logo unchanged ✅ |
| `localhost` / `127.0.0.1` | Logo unchanged ✅ |

---

## Dependency Notes

As of 2026-03-02, `npm audit` reports **23 pre-existing vulnerabilities** (1 low, 1 moderate,
20 high, 1 critical) in the project. These are **not introduced by this change** (confirmed via
`git diff HEAD~1 package.json` — empty diff).

Notable pre-existing issues for a future maintenance sprint:
- `fast-xml-parser` — critical CVE (DoS via entity expansion)
- `multer` — high CVE (DoS via resource exhaustion)
- `axios` — high CVE (prototype pollution)
- `qs` — high CVE (array limit bypass DoS)

These should be addressed in a dedicated dependency-update sprint (not blocking this feature).

---

## Known Security Considerations

- This feature has zero server-side footprint — attack surface is nil.
- If someone spoofs `staging` into a hostname on a malicious site, they'd only ever see
  "SANDBOX" text — no security impact.
