# Security: YouTube Video Embeds

## Overview

Guidelines for embedding YouTube videos within the Classic WoW Manager front-end pages.

## Requirements

### Domain
- **Always use** `youtube-nocookie.com` (privacy-enhanced domain), never `youtube.com` for embeds.
- Example: `https://www.youtube-nocookie.com/embed/{VIDEO_ID}`

### iframe Attributes
All YouTube iframes must include:
```html
<iframe
  src="https://www.youtube-nocookie.com/embed/{VIDEO_ID}"
  title="Descriptive title for accessibility"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
  referrerpolicy="strict-origin-when-cross-origin"
  allowfullscreen>
</iframe>
```

### `sandbox` Attribute
Do **not** add a `sandbox` attribute to YouTube iframes:
- Without `allow-scripts`, YouTube playback breaks entirely.
- `sandbox="allow-scripts allow-same-origin"` is **worse** than no sandbox (negates the security model — scripts + same-origin = full sandbox bypass).
- YouTube (`youtube-nocookie.com`) is a trusted, third-party domain with no access to our origin's cookies or localStorage.

### Tracking Parameters
- `si=` parameters in embed URLs are YouTube share-source analytics identifiers — low-privacy risk since `youtube-nocookie.com` already minimises Google tracking.
- Acceptable to include; removal is optional.

## Authentication / Authorization
- Video embeds are static HTML additions — no authentication or authorization impact.
- Videos embedded in step-gated pages (e.g., `#step1`) are naturally hidden when the step hides — no additional JS logic needed.

## Input Validation
- Not applicable — embed URLs are hardcoded, not user-supplied.

## Known Considerations

### No CSP Header (pre-existing)
The application does not currently set a `Content-Security-Policy` header. This is a **pre-existing** gap unrelated to video embeds. If CSP is added in the future, `frame-src` must include `https://www.youtube-nocookie.com`.

### npm Dependency Vulnerabilities (pre-existing)
As of 2026-03-03, `npm audit` reports 23 vulnerabilities (1 critical `fast-xml-parser`, 20 high). These are pre-existing and unrelated to front-end HTML changes. A separate dependency update task is recommended.

## Audit Log
- 2026-03-03 — Initial doc created during security review of "Video on the Link your Discord ID page" card (cmmanh5cn0150t5721nes20gs). Reviewed by Security Gort.
