# Tech Stack

## Overview

Vanilla client-side web app — no build step, no framework, no bundler. Plain
HTML, CSS, and ES modules loaded directly in the browser. Firebase provides
auth and the realtime database.

## Stack

- **Language:** JavaScript (ES modules, `import` from CDN URLs). No TypeScript.
- **Backend:** Firebase (project `salo-sa-antipolo`)
  - **Auth:** Firebase Authentication (`firebase-auth.js`)
  - **Data:** Cloud Firestore (`firebase-firestore.js`), consumed via realtime
    `onSnapshot` listeners
- **Firebase SDK:** v10.12.0, imported from
  `https://www.gstatic.com/firebasejs/10.12.0/...` (keep versions consistent).
- **CSS:** Hand-written stylesheets per portal. Theming via
  `data-theme` on `<html>` plus `localStorage`.
- **Icons/Fonts (via CDN):**
  - Font Awesome 6.5.0 (waiter/cashier)
  - Lucide (`lucide.min.js`, admin pages — call `lucide.createIcons()`)
  - Google Fonts: Outfit, Cormorant Garamond

## Conventions

- Each page's JS initializes its own Firebase app inline with the same config
  block. Copy the existing config exactly when adding a page.
- DOM helper `const $ = id => document.getElementById(id)` is used throughout.
- Toast pattern: set `#toastMsg` text, add `.show` to `#toast`, remove after 3s.
- Access control lives in `admin-js/rbac.js`. Guard admin pages with
  `bootstrapAdmin(...)` and the cashier page with `guardCashierPage(...)` before
  starting data listeners. Never render sensitive UI before the guard resolves.
- Escape user/data strings before injecting into HTML (see `escapeHtml`).
- Financial math is duplicated per portal — reuse the existing constants
  (`VAT_RATE`, `SERVICE_CHARGE_RATE`, discount rates) rather than hardcoding.

## Running

Static files — no compile or install step. Serve the folder with any static
web server and open the relevant HTML page, e.g.:

```
npx serve .
# or
python -m http.server 8000
```

Open `waiter-login.html`, `cashier-login.html`, or `admin-login.html`.
Firebase runs against the live hosted project; there is no local emulator setup.

## Notes

- `cleanup-duplicate-tables.js` and `fix-tables-assignedto.html` are one-off
  maintenance/repair utilities, not part of the main flow.
