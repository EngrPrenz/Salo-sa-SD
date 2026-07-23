# Implementation Plan: Cashier Order Grouping Fix

## Overview

All changes are confined to `cashier.js`. The implementation adds grouped-order logic on top of the existing Firebase/rendering pipeline: orders are collapsed into Group objects by table, a new `selectGroup` replaces `selectOrder`, `processPayment` becomes a `writeBatch`, and the badge, search, pre-selection, and print paths are all updated to work with groups.

## Tasks

- [ ] 1. Add `writeBatch` to the Firebase Firestore import and declare `selectedGroup`
  - [ ] 1.1 Add `writeBatch` to the existing `import { ... } from "...firebase-firestore.js"` line
    - The import line is at the top of `cashier.js`; append `, writeBatch` to the destructured list alongside `updateDoc`, `addDoc`, etc.
    - _Requirements: 5.2_

  - [ ] 1.2 Replace `let selectedOrder = null` with `let selectedGroup = null`
    - Remove the `selectedOrder` declaration in the module-level State block and add `let selectedGroup = null` in its place
    - _Requirements: 3.1, 3.2_

- [ ] 2. Implement `groupOrdersByTable(orders)` pure function
  - [ ] 2.1 Write the `groupOrdersByTable` function body
    - Place the function after `calculateFinancials` and before `subscribeToOrders`
    - Accept a flat array of Slip objects (already filtered to unpaid, non-cancelled)
    - Determine group key: `order.tableNumber` for dine-in, `order.id` for takeout
    - Accumulate into a `Map<key, Order[]>`; for each entry build the Group object:
      - `key`, `tableNumber` (null for takeout), `isTakeout`, `orders` (sorted by `createdAt` asc)
      - `combinedTotal` = sum of all `order.total`
      - `combinedItems` = flat concat of all `order.items` (no dedup)
      - `earliestCreatedAt` = minimum `createdAt` Timestamp
      - `highestValueSlip` = order with max `total`; ties broken by earliest `createdAt`
    - Return array sorted by `earliestCreatedAt` ascending
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.3, 2.6_

  - [ ]* 2.2 Write property test — Property 1: Dine-in same tableNumber are co-grouped
    - **Property 1: Dine-in orders with the same tableNumber are always co-grouped**
    - **Validates: Requirements 1.1**
    - Use fast-check; generate random arrays of dine-in slips; assert all same-tableNumber slips land in one group

  - [ ]* 2.3 Write property test — Property 2: Takeout orders are never merged
    - **Property 2: Takeout orders are never merged**
    - **Validates: Requirements 1.2, 1.4**
    - Generate arrays with takeout slips; assert every takeout group has `orders.length === 1` and `isTakeout === true`

  - [ ]* 2.4 Write property test — Property 3: combinedTotal equals sum of slip totals
    - **Property 3: combinedTotal equals the sum of all slip totals**
    - **Validates: Requirements 2.2, 3.2**

  - [ ]* 2.5 Write property test — Property 4: combinedItems is flat concat of all items arrays
    - **Property 4: combinedItems is the flat concatenation of all slip item arrays**
    - **Validates: Requirements 2.3, 3.1, 3.5**

  - [ ]* 2.6 Write property test — Property 5: earliestCreatedAt is the minimum createdAt
    - **Property 5: earliestCreatedAt is the minimum createdAt across all slips**
    - **Validates: Requirements 2.6**

  - [ ]* 2.7 Write property test — Property 6: highestValueSlip uses earliest createdAt as tiebreaker
    - **Property 6: highestValueSlip is the slip with max total, earliest createdAt as tiebreaker**
    - **Validates: Requirements 4.5**

- [ ] 3. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement `calculateGroupFinancials(group, discountType)` wrapper function
  - [ ] 4.1 Write the `calculateGroupFinancials` function body
    - Place the function directly after `groupOrdersByTable`
    - `discountType === 'none'` → delegate to `calculateFinancials(group.combinedTotal, { type: 'none' })`
    - `discountType === 'senior'` or `'pwd'` with `group.highestValueSlip.total === 0` → same delegation
    - `discountType === 'senior'` or `'pwd'` with `group.highestValueSlip.total > 0`:
      - `discountBase = group.highestValueSlip.total`
      - `discountAmount = discountBase × 0.20`
      - `afterDiscount = group.combinedTotal − discountAmount`
      - `vatExempt = true`, `vatAmount = 0`
      - `serviceCharge = afterDiscount × SERVICE_CHARGE_RATE`
      - `grandTotal = afterDiscount + serviceCharge`
      - Return the same shape as `calculateFinancials`
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7_

  - [ ]* 4.2 Write property test — Property 7: Senior/PWD discountAmount = highestValueSlip.total × 0.20
    - **Property 7: Senior/PWD discount amount is always Discount_Base × 0.20**
    - **Validates: Requirements 4.1, 4.7**

  - [ ]* 4.3 Write property test — Property 8: Senior/PWD produces vatExempt, zero VAT, correct SC and grandTotal
    - **Property 8: Senior/PWD discount always produces VAT exemption with zero VAT and correct service charge**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 4.4 Write property test — Property 9: No-discount path delegates unchanged to calculateFinancials
    - **Property 9: No-discount path delegates unchanged to calculateFinancials**
    - **Validates: Requirements 4.6**

- [ ] 5. Update `renderOrders()` to work with groups
  - [ ] 5.1 Refactor the `renderOrders` function body to use groups
    - Compute `const groups = groupOrdersByTable(queueOrders)` instead of the flat orders array
    - Apply the search filter to groups:
      - Dine-in: match `group.tableNumber`; match `waiterName` of any slip in `group.orders`
      - Takeout: match `'takeout'`, the order ID (`group.key`), or `waiterName` of the slip
    - Render one card per group; set `data-group-key="${group.key}"` on each card
    - Card content per design: `#` + last-6-chars of earliest slip ID, table label, `combinedTotal`, grand-total preview, total item count, `{n} slips` badge (only when `group.orders.length > 1`), `earliestCreatedAt` timestamp
    - Change `onclick` to `selectGroup('${group.key}')`
    - Selected state: `group.key === selectedGroup?.key`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1, 8.2, 8.3_

  - [ ]* 5.2 Write property test — Property 12: Search returns groups matching tableNumber or any slip's waiterName
    - **Property 12: Search returns groups matching tableNumber or any slip's waiterName**
    - **Validates: Requirements 8.1, 8.2**

- [ ] 6. Implement `window.selectGroup(groupKey)` and remove `window.selectOrder`
  - [ ] 6.1 Replace `window.selectOrder` with `window.selectGroup`
    - Look up the group by key: `groups.find(g => g.key === groupKey)` — compute groups from `allOrders.filter(belongsInCashierQueue)` inside the function
    - Set `selectedGroup = group`, reset `discountType = 'none'`, `cashTendered = 0`
    - Call `renderOrderDetail(group)` and `renderOrders()`
    - Show `detailPanel`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 7. Update `renderOrderDetail` to accept a Group object
  - [ ] 7.1 Rewrite `renderOrderDetail(group)` to accept a Group instead of a single Order
    - Call `calculateGroupFinancials(group, discountType)` for all financial display
    - **Order Information section**: show `group.tableNumber` (or Takeout badge), `group.earliestCreatedAt`, and — when `group.orders.length > 1` — a "Slip IDs" row listing last-6-chars of each slip ID (uppercase, comma-separated)
    - **Order Items section**: render `group.combinedItems`; label subtotal row as "Combined Total"
    - **Print Order Slip button**: call `printOrderSlip(group)` (pass group object, not ID)
    - All discount, cash tendered, and payment button HTML remain the same structure but reference `group.combinedTotal` for quick-cash amounts and grand total
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 8. Update `setDiscount` and `updateCashTendered` to reference `selectedGroup`
  - [ ] 8.1 Update `window.setDiscount` to use `selectedGroup`
    - Replace `if (selectedOrder) renderOrderDetail(selectedOrder)` with `if (selectedGroup) renderOrderDetail(selectedGroup)`
    - _Requirements: 4.4_

  - [ ] 8.2 Update `window.updateCashTendered` to use `selectedGroup`
    - Replace all `calculateFinancials(selectedOrder.total, ...)` calls with `calculateGroupFinancials(selectedGroup, discountType)`
    - _Requirements: 3.2_

- [ ] 9. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Update `processPayment` to use `writeBatch` and write payment doc with `orderIds[]`
  - [ ] 10.1 Rewrite `window.processPayment` to use `writeBatch` over the group
    - Guard: `if (!selectedGroup || selectedGroup.orders.length === 0)` → toast and return
    - Re-validate all slips: if any slip in `selectedGroup.orders` fails `canFinalizePayment` against `allOrders` → abort with stale-group toast, clear `selectedGroup`, call `renderOrders()`
    - Calculate financials via `calculateGroupFinancials(selectedGroup, discountType)`
    - Guard: `cashTendered < financials.grandTotal` → toast and return
    - Build `writeBatch`:
      - For each slip in `selectedGroup.orders`, look up live slip from `allOrders`
      - `batch.update(doc(db, 'orders', slip.id), { status: nextStatusAfterPayment(liveSlip), paidBy, paymentMethod, discountType, grandTotal, cashTendered, changeGiven, ...(liveSlip.paidAt ? {} : { paidAt: serverTimestamp() }) })`
    - Build payment document with all 15 required fields including `orderIds: selectedGroup.orders.map(o => o.id)` (replacing the old `orderId` singular)
    - `await batch.commit()`
    - `await addDoc(collection(db, 'payments'), paymentData)`
    - On success: clear `selectedGroup`, reset discount/payment state, show success toast, show empty-state in detail panel, `renderOrders()`, auto-print receipt via `printReceipt(selectedGroup)` after 500 ms
    - On error: show descriptive toast; do NOT clear `selectedGroup` so cashier can retry
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 10.2 Write property test — Property 10: nextStatusAfterPayment is determined purely by serving state
    - **Property 10: nextStatusAfterPayment is determined purely by serving state**
    - **Validates: Requirements 5.3, 5.4**

- [ ] 11. Update `updateOrdersBadge` to use group count
  - [ ] 11.1 Rewrite `updateOrdersBadge` to count groups, not slips
    - `const groups = groupOrdersByTable(allOrders.filter(belongsInCashierQueue))`
    - `$('ordersCountBadge').textContent = groups.length`
    - _Requirements: 7.1, 7.2_

  - [ ]* 11.2 Write property test — Property 11: Orders badge count equals number of groups, not slips
    - **Property 11: Orders badge count equals the number of groups, not slips**
    - **Validates: Requirements 7.1, 7.2**

- [ ] 12. Update pre-selection logic in `subscribeToOrders`
  - [ ] 12.1 Update the pre-selection block inside `subscribeToOrders` to resolve slip ID → group
    - Always clear `localStorage.removeItem('cashier_preselect_order')` first
    - Compute groups from queue orders
    - `const targetGroup = groups.find(g => g.orders.some(o => o.id === preselectId))`
    - If found: call `selectGroup(targetGroup.key)` and scroll to `.order-card[data-group-key="${targetGroup.key}"]`
    - If not found: do nothing (silently ignore)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 12.2 Write property test — Property 13: Pre-selection lookup finds the correct group for any slip ID
    - **Property 13: Pre-selection lookup finds the correct group for any slip ID**
    - **Validates: Requirements 6.1, 6.3**

- [ ] 13. Update close-button handler to clear `selectedGroup`
  - [ ] 13.1 In the `init()` close-button event listener, replace all `selectedOrder` references with `selectedGroup`
    - Change `selectedOrder = null` → `selectedGroup = null`
    - _Requirements: 3.1_

- [ ] 14. Update `printReceipt` and `printOrderSlip` to accept Group objects
  - [ ] 14.1 Update `window.printOrderSlip` to accept a Group object
    - Change signature to `printOrderSlip(group)`; source items from `group.combinedItems`
    - Order reference line: show all slip IDs (last-5, comma-separated) when `group.orders.length > 1`, else show the single slip's ID
    - Table/type line: use `group.tableNumber` (or Takeout for `group.isTakeout`)
    - Waiter line: show waiter names from all slips (deduplicated) — or use the first slip's `waiterName`
    - Update the `onclick` in `renderOrderDetail` to pass `group` instead of `order.id`
    - _Requirements: 3.1, 3.4_

  - [ ] 14.2 Update `window.printReceipt` to accept a Group object
    - Change signature to `printReceipt(group)`; source items from `group.combinedItems`
    - Calculate financials via `calculateGroupFinancials(group, group.orders[0]?.discountType || discountType)`
    - Order reference line: show all slip IDs (last-5, comma-separated) when multi-slip
    - Table/type line: use `group.tableNumber`
    - Cash tendered / change: read from the first paid slip in the group (`liveSlip.cashTendered`, `liveSlip.changeGiven`) or fall back to the `cashTendered` / change state variable at time of payment
    - Update the auto-print call in `processPayment` (task 10.1) to pass the group object
    - Update the `onclick` in `showBillingReceipt` to remain backward-compatible (still passes a single `orderId`; no change required there)
    - _Requirements: 3.1, 5.7_

- [ ] 15. Final checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All changes are inside `cashier.js` only — no other files are modified
- `calculateFinancials` is left completely unchanged; `calculateGroupFinancials` wraps it
- The old `window.selectOrder` and `selectedOrder` variable are fully removed
- `writeBatch` must be imported before `processPayment` runs or a `ReferenceError` will surface immediately
- Property tests (tasks 2.2–2.7, 4.2–4.4, 5.2, 10.2, 11.2, 12.2) use fast-check; tag each: `// Feature: cashier-order-grouping-fix, Property N: <text>`
- `printReceipt` called from `showBillingReceipt` (billing view) still receives a single `orderId` string — keep that path working via an internal branch or a separate helper; the group-aware path is only for the post-payment auto-print

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "5.1", "6.1"] },
    { "id": 4, "tasks": ["5.2", "7.1"] },
    { "id": 5, "tasks": ["8.1", "8.2", "11.1"] },
    { "id": 6, "tasks": ["10.1", "11.2", "13.1"] },
    { "id": 7, "tasks": ["10.2", "12.1"] },
    { "id": 8, "tasks": ["12.2", "14.1"] },
    { "id": 9, "tasks": ["14.2"] }
  ]
}
```
