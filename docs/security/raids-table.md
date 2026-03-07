# Security: Unified Raids Table

**Feature:** Homepage unified Raids table (replaces separate Upcoming/Completed panels)
**Files:** `public/events.html`, `public/script.js`, `public/style.css`
**Reviewed:** 2026-03-06

---

## Authentication Requirements

- All data-fetching API endpoints require `req.isAuthenticated()`:
  - `GET /api/events` — upcoming events
  - `GET /api/events/historic` — completed events
  - `GET /api/event-duration/:id` — raid duration
  - `GET /api/event-goldpot/:id` — gold pot
  - `GET /api/event-biggestitem/:id` — biggest loot item
  - `POST /api/events/refresh` — refresh cache
  - `POST /api/events/historic/refresh` — refresh historic cache
- Unauthenticated users see a sign-in prompt in the table; no data is exposed.

---

## Authorization Rules

- All endpoints use standard session-based auth (passport-discord).
- No role-based access differences for reading the raids table — any authenticated guild member can view.
- Refresh endpoints require auth; no admin role required (acceptable — cache refresh is low-risk).

---

## Input Validation

- **Event IDs:** Sourced from `/api/events` and `/api/events/historic` (server-controlled). Never from user input. Used in DOM element IDs and fetch URLs.
- **Gold pot:** Validated as `typeof data.goldPot === 'number'` before rendering — safe.
- **Channel names:** Processed via `cleanChannelName()` which strips non-word characters and renders via `textContent`.
- **Row rendering:** `buildRaidRow()` uses `document.createElement` + `textContent` exclusively — no innerHTML with external data.

---

## Known Security Considerations

### ⚠️ MEDIUM: `data.itemName` / `data.iconLink` in innerHTML

**Location:** `public/script.js` lines 373–378 in `fetchEventBiggestItem()`

**Pattern:**
```javascript
const iconHtml = data.iconLink
    ? `<img src="${data.iconLink}" alt="${data.itemName}" class="raid-item-icon">`
    : '';
biggestItemElement.innerHTML = `${iconHtml}<span class="raid-item-name">${data.itemName}</span>`;
```

**Risk:** If `item_name` or `icon_link` in the database contains HTML/script content, it would execute in users' browsers (stored XSS).

**Mitigating factors:**
- `item_name` and `icon_link` are populated from WoW game data (Wowhead/game exports), not from end-user text input.
- Only guild admins can import loot data — exploit requires admin account compromise.
- Pre-existing pattern (present before this feature).

**Recommended fix (future sprint):**
```javascript
// Use textContent for itemName, and validate iconLink is a safe URL
const span = document.createElement('span');
span.className = 'raid-item-name';
span.textContent = data.itemName; // safe
if (data.iconLink && /^https?:\/\//i.test(data.iconLink)) {
    const img = document.createElement('img');
    img.src = data.iconLink;
    img.alt = data.itemName;
    img.className = 'raid-item-icon';
    biggestItemElement.appendChild(img);
}
biggestItemElement.appendChild(span);
```

---

## Audit Logging

No audit logging required for the read-only raids table display.
