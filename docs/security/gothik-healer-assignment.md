# Security: Gothik Healer Side Assignment

**Feature:** Role-aware Gothik healer side assignment (`classifyGothikHealers`)  
**Files:** `public/assignments.js`, `public/roster.js`  
**Reviewed:** 2026-05-28 by Security Gort  
**Verdict:** PASS

---

## Overview

The `classifyGothikHealers(roster, filterFn)` function is a pure client-side algorithm that
classifies raid healers into Human vs Undead sides for the Gothik the Harvester encounter.
It operates entirely in-browser on trusted roster data fetched from the server.

---

## Authentication Requirements

- No changes to authentication. All roster data is already gated behind Discord OAuth session.
- The function is client-side only; it reads from the `roster` array already loaded on the page.

---

## Authorization Rules

- No new API endpoints introduced.
- Read-only access to roster data that the user already has access to (event participant).
- No privileged data paths modified.

---

## Input Validation Rules

- `class_name` is always normalized via `String(r.class_name || '').toLowerCase()` before comparison — protects against null/undefined/non-string values.
- `party_id` is always coerced via `Number(r.party_id)` — protects against string/undefined comparisons.
- These patterns follow the existing codebase convention throughout `assignments.js` and `roster.js`.
- The roster array originates from a trusted server endpoint (`/api/roster/:eventId`), not from unvalidated user input at the classification layer.

---

## XSS Considerations

- `classifyGothikHealers` returns arrays of roster objects; it does not produce HTML.
- Assignment text strings are static hardcoded literals (`'Go heal Undead side.'`, `'Go heal Human side.'`), not derived from user input.
- The caller code (`toAdd.push(...)` / `makeEntry(...)`) uses existing display pipelines already reviewed for XSS.
- An `escapeHtml()` utility exists in both files for any future HTML rendering needs.

---

## SQL Injection

- Not applicable. This is a purely client-side JavaScript change with no server-side code modifications.
- No new database queries introduced.

---

## Known Security Considerations

- The algorithm trusts that `roster` data has been properly validated server-side before being served to the client. This is an existing assumption throughout the codebase.
- The `filterFn` parameter (used in `assignments.js` as `filterAssignable`) is a trusted internal function, not user-supplied.

---

## Pre-existing Dependency Vulnerabilities (Not Introduced by This Card)

`npm audit` reports **39 vulnerabilities** (1 critical, 8 high, 30 moderate) pre-dating this change.
No new packages were added by this card (`git diff HEAD~1 package.json` — no changes).

Notable pre-existing issues for a future tech-debt sprint:
| Package | Severity | Issue |
|---------|----------|-------|
| `fast-xml-parser` | Critical | DoS via XML entity expansion |
| `axios` | High | SSRF / prototype pollution gadget |
| `lodash` | High | Prototype pollution in `_.unset`/`_.omit` |
| `multer` | High | DoS via resource exhaustion |
| `socket.io-parser` | High | Unbounded binary attachments |

**Recommendation:** Open a dedicated tech-debt card to run `npm audit fix` and upgrade affected packages.

---

## Audit Log

- 2026-05-28: Initial security review completed. No issues found in changed code. Pre-existing dependency CVEs noted.
