# Implementation Plan: Order Flow Served/Payment Rework

## Overview

This plan implements the order-flow rework directly inside each portal's own JS
file, matching the project's per-page, self-contained convention (no shared
modules, no build step, no npm). Each of `waiter.js`, `cashier.js`, and
`admin-orders.js` carries its own small, consistent copy of the order-status
vocabulary and predicates it needs; the same status strings are used everywhere
so the portals agree on what counts as paid / served / unpaid / unrecognized.

Language/stack: vanilla JavaScript ES modules loaded directly in the browser.
There are no automated tests — correctness is validated by manual verification
against the live Firebase app at each checkpoint.

## Tasks

- [x] 1. Order-status vocabulary (inlined per portal)
  - [x] 1.1 Inline status constants and classification predicates into each portal
    - `waiter.js`, `cashier.js`: `STATUS` values + `PAID_STATUSES`, `SERVED_STATUSES`, `isPaid`, `isServed` (status or truthy `servedAt`), `isCancelled`, `isUnpaid`
    - `admin-orders.js`: `RECOGNIZED_STATUSES` + `adminGroupOf` (recognized status or `'unrecognized'`)
    - Legacy `pending` tolerated; a missing/unknown status is unrecognized
    - _Requirements: 9.1, 8.1, 3.1, 3.2, 3.3, 3.4, 9.2_

  - [x] 1.2 Inline transitions and UI guards where used
    - Cashier: `belongsInCashierQueue` (= `isUnpaid`), `canFinalizePayment` (= `isUnpaid`), `nextStatusAfterPayment` (served → `served_paid`, else `paid_unserved`)
    - Waiter: `belongsInWaiterSlips`, `shouldShowServedButton` (unpaid & not served), `nextStatusAfterServed` (paid → `served_paid`, else `served_unpaid`; never `completed` for unpaid), `servedAtUpdate` (first-write-wins)
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 6.2, 7.1, 7.2, 7.3, 7.5, 8.2, 8.3, 8.4, 8.5, 9.4_

  - [x] 1.3 Keep each portal's existing `calculateFinancials`
    - No shared financials module; the per-portal copies already share identical constants (VAT 12%, service charge 7%, Senior/PWD 20%) and math
    - _Requirements: 9.5_

- [x] 2. Waiter portal
  - [x] 2.1 Submit new orders as `preparing` via `buildOrderDocument`
    - Pure helper builds the order doc (status `preparing`, waiter name/id, order type, items, total, `tableNumber` = table for dine-in / `null` for takeout); `createdAt`/`updatedAt` attached at write time
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Add the order-slip panel (`waiter.html` / `waiter.css` / `waiter.js`)
    - `#orderSlipPanel` lists orders where `belongsInWaiterSlips(order, waiterId)` from the live snapshot; shows id, location, status label, item count; all order text escaped via `escapeHtml`; selecting a slip renders its detail
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 2.3 Wire the Served action on the selected slip
    - "Mark as Served" shows only when `shouldShowServedButton(order)`; writes `nextStatusAfterServed(order)` + first-write-wins `servedAt` + `updatedAt`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.5, 9.4_

  - [x] 2.4 Replace legacy `'served'`/`'paid'` literals in table/menu rendering
    - `calculateMenuOrderCounts` counts the active status set; `renderTables` keys occupancy off live (non-completed/cancelled) orders and the served visual off `isServed`; the "Customer Left" handler uses `isServed`
    - _Requirements: 9.1_

- [x] 3. Cashier portal
  - [x] 3.1 Show every unpaid order in the queue and badge
    - `renderOrders` and `updateOrdersBadge` filter on `belongsInCashierQueue(o)`; the badge counts exactly the rendered list
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Update `processPayment` outcome, guard, timestamp, and payment record
    - Re-read the live order and reject unless `canFinalizePayment(liveOrder)` (toast on stale selection); write `nextStatusAfterPayment(liveOrder)`; set `paidAt` first-write-wins; keep the `payments` record with cashier identity, order id, and amounts
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 9.3_

- [x] 4. Admin Live Orders
  - [x] 4.1 Scope Start Preparing to legacy `pending` and confirm status grouping/diagnostics
    - `STATUS_ACTIONS` renders no normal-flow Start Preparing control (keyed to legacy `pending` only) and preserves `preparing → served_unpaid`/`paid_unserved`; unrecognized statuses grouped via `adminGroupOf` with a diagnostic `console.warn`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 9.2, 9.6_

- [x] 5. Access control (single cashier experience)
  - [x] 5.1 Remove the embedded Admin cashier view and keep management read-only access
    - `admin_cashier`'s `ROLE_PAGES`/`NAV_ITEMS` reduced to the cashier portal only; the `useCashierInterface` flag and its `guardAdminPage` branch removed (`rbac.js`, `cashier-login.js`); `guardCashierPage` still routes `admin_cashier` to `cashier.html`; management roles keep read access to Orders and Billing
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 6. Checkpoint - Manual verification (end-to-end)
  - Manually run the full flow against the live Firebase app (no automated tests): submit a waiter order → confirm it appears in the cashier queue while `preparing` → mark it served from the waiter slip → take payment in the cashier portal → confirm it lands as `served_paid` in Billing and leaves the cashier queue. Confirm the Cashier login still reaches `cashier.html` and that `admin_cashier` no longer sees embedded Admin Orders/Billing.

## Notes

- The project keeps its no-build, no-npm vanilla setup: no `package.json`, no test
  runner, no `node_modules`, no `tests/` folder, and no shared status/financials
  modules. The order-status logic is inlined per portal.
- Each portal uses the same status strings and predicate definitions, so the
  vocabulary stays consistent without a shared import.
- Correctness is validated by manual verification against the live Firebase
  project (no emulator). The single remaining checkpoint is a manual smoke pass.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "5.1"] },
    { "id": 3, "tasks": ["2.2", "3.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["2.4"] }
  ]
}
```
