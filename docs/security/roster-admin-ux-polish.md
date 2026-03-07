# Security: Roster Admin Menu UX Polish

**Feature:** Admin sidebar UX polish — icons+text, padding, toggle discoverability, input labels, character frame cleanup  
**Card:** cmmg9d3ss034cl0cezr9hi0mw  
**Reviewed:** 2026-03-07

---

## Scope

Pure frontend CSS/HTML/JS changes. No backend changes, no new API endpoints, no new data flows, no new dependencies.

**Files changed:**
- `public/roster.html` — Removed external text labels, updated placeholders, added Comp Tool span
- `public/roster.css` — Sidebar sizing, button spacing, toggle restyle, cell width, safety-net display:none
- `public/roster.js` — Removed specIconHTML, confirmationIconHTML rendering; added sessionStorage pulse flag

---

## Authentication Requirements

No change from prior audit (`roster-design-overhaul.md`):
- Admin sidebar is only rendered for users with `currentUserCanManage === true`
- All admin API endpoints protected by `requireRosterManager` middleware

## Authorization Rules

No change. This PR is UI-only.

## Input Validation

**Placeholder-only changes** — no new input fields introduced. Existing inputs:
- `#raidleader-input`: text search (pre-existing, autocomplete, server-side validated)
- `#raidleader-cut-input`: number input with `min="0"`, `step="0.01"` (pre-existing)
- `#invites-by-input`: text input (pre-existing)

No new user input is introduced. Placeholders are display-only (`placeholder` attribute), not values.

## sessionStorage Usage

**Key:** `adminToggleSeen`  
**Value:** `'1'` (string literal)  
**Purpose:** Suppress first-load pulse animation after first view (per browser session)  
**Risk:** None. No sensitive data. No server-side interaction. Cannot be exploited to bypass auth.

## XSS Considerations

`displayName` is interpolated into innerHTML (`<span>${displayName}</span>`) — **pre-existing pattern**, not introduced by this PR. This PR actually _reduced_ the innerHTML surface by removing specIconHTML and confirmationIconHTML, which previously injected Discord CDN image URLs and Font Awesome icons.

External image source removed: `https://cdn.discordapp.com/emojis/${spec_emote}.png` — elimination of this reduces potential for unexpected external resource loading if spec_emote data were ever tampered with.

## Known Security Considerations

### Pre-existing CVEs (not introduced by this PR)

| Package | Severity | Via | Notes |
|---------|----------|-----|-------|
| fast-xml-parser | Critical | @aws-sdk/client-s3 (transitive) | RangeError DoS, entity encoding bypass |
| multer | High | Direct dep | DoS via incomplete cleanup / resource exhaustion |
| qs | High | Transitive | arrayLimit DoS bypass |

These are pre-existing and tracked separately. `npm audit fix` resolves all of them. Should be addressed in a dedicated dependency update sprint.

## Audit Logging

No change. Admin actions that affect server state are logged via existing mechanisms.
