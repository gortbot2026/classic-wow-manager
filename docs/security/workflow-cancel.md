# Security: Logs Import Workflow Cancel Feature

**Feature:** Cancel button for the 10-step logs import workflow  
**Route:** `/event/:eventId/logs`  
**Files:** `public/logs.html`, `public/logs.js`, `public/logs.css`  
**Last reviewed:** 2026-05-25 by Security Gort

---

## Overview

The cancel feature allows a raid manager to abort the logs import workflow mid-execution. Cancellation is purely client-side — a boolean flag on the `workflowState` object is checked between steps.

---

## Authentication Requirements

- No change. The `/event/:eventId/logs` route is already protected by session-based auth (Discord OAuth via passport).
- The cancel button triggers no new API calls. It modifies only in-memory JavaScript state.

---

## Authorization Rules

- N/A — no server-side calls added. The feature is entirely browser-side.

---

## Input Validation

- **No user input involved.** The cancel button sets `workflowState.cancelled = true` — a hardcoded boolean write. There is no user-controlled value being processed.
- The log URL input field is re-enabled after cancellation but validation on that field is unchanged from before.

---

## DOM Safety

- `finalizeCancellation()` sets `runButton.innerHTML = 'Run Complete Workflow'` — this is a **hardcoded string**, not derived from any user input. No XSS risk.
- All step indicator updates use `updateWorkflowStep()` which uses `textContent` (existing safe pattern).

---

## Known Security Considerations

1. **In-flight step completes on cancel** — by design, the cancel flag is checked *between* steps. An in-flight API request (e.g. step 5 importing to DB) will complete normally. This avoids partial data corruption. No security concern; this is the correct behaviour.

2. **`failedStep` set after cancellation** — `finalizeCancellation()` sets `failedStep = lastCompleted + 1`, enabling Retry to resume from the right position. This value is used only for step-index logic (1–10), not for any database queries or URL construction.

3. **Pre-existing dependency CVEs (not introduced by this PR):**
   - `fast-xml-parser <=5.6.0` — Critical/High CVEs (DoS, entity expansion bypass). Transitive via `@aws-sdk/client-s3`. Not exposed to untrusted XML in this app's usage path. Track for future update sprint.
   - `ws 8.0.0–8.20.0` — Moderate CVE (memory disclosure). Via `socket.io`, `engine.io`. Update in future sprint.

---

## Audit Logging

- No new audit logging needed — this feature makes no database writes and no API calls.

