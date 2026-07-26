# Implementation Plan

## Overview

Implement the admin-cashier bypass feature by extending `guardCashierPage` in `rbac.js` to admit admin roles, adding a Bypass_Check with 10-second timeout to `cashier-login.js`, and verifying that `_sendToCashier` in `admin-orders.js` already opens `cashier.html` directly. No changes are needed to `cashier.js` — pre-selection is already implemented.

## Tasks

- [ ] 1. Extend guardCashierPage to admit admin roles in rbac.js
  - Define a `CASHIER_ALLOWED_ROLES` constant array containing `['admin_cashier', 'admin_manager', 'admin_owner', 'admin']` inside `guardCashierPage`
  - Replace the current `if (role !== 'admin_cashier')` guard with `if (!CASHIER_ALLOWED_ROLES.includes(role))` so all four roles are admitted and any other role is signed out and redirected
  - Verify that the `resolve({ uid, name, role, ...data })` call and the name/avatar population (`_setText`, `_setInitial`) remain unchanged
  - **File:** `admin-js/rbac.js`
  - **Requirements:** R1.6, R2.1, R2.4, R4.1, R4.2, R5.5

- [ ] 2. Add admin Bypass_Check to cashier-login.js
  - Define `ADMIN_BYPASS_ROLES = ['admin_manager', 'admin_owner', 'admin']` near the top of the file
  - Wrap the `getDoc` call inside `onAuthStateChanged` in a `Promise.race` against a 10-second `setTimeout` rejection so Firestore timeouts fall through to the login form
  - Add a new `if (ADMIN_BYPASS_ROLES.includes(role))` branch after the existing `admin_cashier` branch that writes `userRole`, `userName`, and `userId` to `sessionStorage` then redirects to `cashier.html`
  - Leave the `admin_cashier` branch and the `authenticateCashier` submit handler completely unchanged
  - Ensure `waiter`, `cashier`, absent/null, and unrecognised roles fall through without redirecting
  - **File:** `cashier-login.js`
  - **Requirements:** R1.1, R1.2, R1.3, R1.4, R1.5, R4.1, R4.3, R4.4, R4.5, R5.1–R5.5
  - **Depends on:** 1

- [ ] 3. Verify and fix _sendToCashier in admin-orders.js
  - Locate `window._sendToCashier` in `admin-orders.js`
  - Confirm it calls `localStorage.setItem('cashier_preselect_order', id)` and `window.open('../cashier.html', '_blank')`
  - If it opens `cashier-login.html` or any other URL instead, update it to open `'../cashier.html'`
  - If already correct, no change needed
  - **File:** `admin-js/admin-orders.js`
  - **Requirements:** R3.1
  - **Depends on:** 1

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] }
  ]
}
```

## Notes

- `cashier.js` requires no changes — pre-selection via `cashier_preselect_order` is already implemented in `subscribeToOrders()`
- Task 4 (end-to-end verification) is manual and not tracked here — it is documented in design.md under Error Handling
- Firebase SDK version must stay at v10.12.0 throughout
