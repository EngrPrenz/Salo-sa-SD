# Project Structure

Flat, page-oriented layout. Most portals live at the repo root; admin is split
into its own HTML and JS folders. Each page pairs an `.html`, a `.css`, and a
`.js` file that share the same base name.

```
/
├── waiter.html / waiter.css / waiter.js        # Waiter portal
├── waiter-responsiveness.css                   # Extra responsive rules for waiter
├── waiter-login.*  / waiter-register.*         # Waiter auth pages
├── cashier.html / cashier.css / cashier.js     # Cashier portal
├── cashier-login.*                             # Cashier auth
├── admin-login.* / admin.css                   # Admin auth + shared admin styles
│
├── admin-html/            # One HTML file per admin view
│   ├── admin-overview.html
│   ├── admin-orders.html
│   ├── admin-tables.html
│   ├── admin-menu.html
│   ├── admin-billing.html
│   ├── admin-staff.html
│   └── admin-reports.html
│
├── admin-js/              # Logic for each admin view + shared helpers
│   ├── admin-<view>.js    # Matches the HTML file of the same name
│   ├── admin-auth.js      # bootstrapAdmin() — admin page auth guard
│   ├── rbac.js            # Roles, page access map, guard functions
│   └── admin-role-manager.js
│
├── image/                 # Static assets (logo.png)
├── cleanup-duplicate-tables.js   # One-off maintenance script
├── fix-tables-assignedto.html    # One-off repair tool
│
└── .kiro/                 # Kiro specs and steering (this folder)
```

## Conventions

- **Page triplet:** Adding a screen means creating matching `<name>.html`,
  `<name>.css`, and `<name>.js`. Admin views keep HTML in `admin-html/` and JS in
  `admin-js/`; note the relative paths (`../image/`, `../admin.css`).
- **Naming:** kebab-case file names; admin files are prefixed `admin-`.
- **JS module role:** Each page JS owns Firebase init, its auth guard, data
  listeners, rendering, and event wiring for that one page.
- **Shared code:** Cross-cutting concerns (roles, access control) go in
  `admin-js/rbac.js` / `admin-auth.js` and are imported where needed. Everything
  else is intentionally per-page and self-contained.

## Firestore collections

- `Users` — accounts with `role`, `name`, `status`
- `orders` — order stream (subscribed via `onSnapshot`, ordered by `createdAt`)
- `menu` — menu items (`available`, category, price)
- `tables` — table state (`status`, assignment)
- `payments` — cashier payment records
- `cashier_shifts` — cashier shift tracking
- `settings` — app settings (e.g. daily reset markers)
