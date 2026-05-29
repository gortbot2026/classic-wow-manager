# Security: Four Horsemen Smarter Healer Distribution

**Feature:** Healer auto-assignment sourced from Healing panel, with Priest/Druid anchor + Shaman fill distribution  
**Files:** `public/assignments.js`, `public/roster.js`  
**Reviewed:** 2026-05-29 by Security Gort  
**Verdict:** PASS

---

## Overview

Updated the Four Horsemen healer auto-assignment logic in both `assignments.js` and `roster.js`:

1. **Healer sourcing** changed from scanning full roster for Shaman/Priest/Druid to pulling names exclusively from the Healing panel (Main page), then matching against the roster.
2. **Distribution algorithm** replaced flat sequential fill with a two-step priority system: Priest/Druid anchors assigned one per mark (Skull→Moon), then Shamans + excess anchors fill remaining slots.
3. **Rotation positions** — Shamans occupy positions 1–2, Priest/Druid anchor occupies position 3 (last) within each mark.
4. **Cleave branch** uses same sourcing/distribution with Cleave-specific assignment text.

---

## Authentication Requirements

- No new authentication surfaces introduced.
- The new `fetch('/api/assignments/${eventId}')` call in `assignments.js` reuses the existing endpoint already called later in the same function (previously at line ~3099, now moved earlier). No new endpoints accessed.
- All roster/panel data is already gated behind Discord OAuth session.

---

## Authorization Rules

- No new API endpoints introduced.
- No privilege escalation — same read access to assignment panels the page already had.
- Write path (save assignments) unchanged; uses existing `requireRosterManager` middleware.

---

## Input Validation Rules

- **Healing panel name extraction:** `(e.character_name || '').trim()` — null-safe, trims whitespace.
- **Roster name matching:** Case-insensitive `.toLowerCase()` comparison on both sides — consistent with codebase convention.
- **Class filtering:** Whitelist approach — only `['shaman', 'priest', 'druid']` pass; any other class (or null/undefined) is silently dropped.
- **`filterAssignable()` safety net:** Applied in `assignments.js` after matching panel names to roster entries — excludes any no-assignment-flagged players. (Not used in `roster.js`, consistent with surrounding code in that file.)
- **Integer position counter:** `pos` is a plain integer incremented in a loop — no user data influences assignment text.
- **Assignment text strings:** Entirely hardcoded (`"Start on skull rotate on 1"` etc.) — `raid.name` comes from a hardcoded `raidOrder` array, `pos` is an integer. No user-supplied data injected into text.

---

## XSS Considerations

- Assignment text is rendered via `textContent` (line 1048 pattern), never `innerHTML`.
- When `innerHTML` is used for editing mode, it's wrapped in `escapeHtml()`.
- `raid.name` values are hardcoded strings (`skull`, `cross`, `square`, `moon`).
- Character names from roster go through the existing rendering pipeline, which uses `textContent` or `escapeHtml()` for all display.

---

## SQL Injection

- No server-side code was modified by this card.
- The `eventId` used in `fetch('/api/assignments/${eventId}')` comes from the URL path and is passed as a parameterized query on the server (`$1`). Consistent with all existing uses.

---

## Error Handling

- The new `fetch` block is wrapped in `try/catch {}` — network failure produces an empty `panelsAll` array, gracefully resulting in no healer assignments (safe degradation, no crash or data leak).
- All edge cases handled silently: 0 healers, fewer than 12, all Shamans, all Priests/Druids, names not in roster.

---

## Known Security Considerations

- Trusts that `roster` and panel data has been server-side validated before being served to the client — existing assumption throughout the codebase.
- No new trusted/untrusted data boundaries introduced.

---

## Pre-existing Dependency Vulnerabilities (Not Introduced by This Card)

`npm audit` reports **39 vulnerabilities** (1 critical, 8 high, 30 moderate) pre-dating this change.
No new packages added (`git diff HEAD~1 package.json` — no changes).

| Package | Severity | Issue |
|---------|----------|-------|
| `fast-xml-parser` | Critical | DoS via XML entity expansion |
| `axios` | High | SSRF / prototype pollution |
| `multer` | High | DoS via resource exhaustion (prod dep — file uploads) |
| `lodash` | High | Prototype pollution |
| `socket.io-parser` | High | Unbounded binary attachments |

**Recommendation:** Open a dedicated tech-debt card to run `npm audit fix` and upgrade affected packages. `multer` in particular is a prod dep used for file uploads.

---

## Audit Log

- 2026-05-29: Initial security review completed. No issues found in changed code. Pre-existing dependency CVEs noted (pre-date this card).
