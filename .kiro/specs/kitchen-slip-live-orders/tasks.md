# Implementation Plan: Kitchen Slip — Live Orders

## Overview

Replace the Receipt modal and print window on the Live Orders admin page with a Kitchen Slip modal and matching print window. All changes are confined to `admin-html/admin-orders.html` and `admin-js/admin-orders.js`. Existing order management functionality is left untouched.

---

## Tasks

- [x] 1. Replace the Receipt modal DOM with the Kitchen Slip modal in `admin-orders.html`
  - Remove the `<div class="modal" id="receiptModal">` block entirely
  - Add `<div class="modal" id="kitchenSlipModal">` using the same `.modal` / `.modal-backdrop` / `.modal-content` pattern
  - Inner structure: `.modal-head` with `<h3>Kitchen Slip</h3>` and `button#kitchenSlipModalClose`, `.modal-body#kitchenSlipModalBody`, `.modal-foot` with `button.btn-sm.gold#kitchenSlipModalPrint` (Print) and `button.btn-sm#kitchenSlipModalClose2` (Close)
  - Add `.modal-content-kitchen-slip { max-width: 440px; }` to the page `<style>` block
  - No heading or title reading "Receipt" may remain in the HTML file
  - _Requirements: 1.1, 1.5, 2.3_

- [x] 2. Implement `kitchenSlipModalBodyHtml(o)` pure render helper in `admin-orders.js`
  - [x] 2.1 Write the `kitchenSlipModalBodyHtml(o)` function
    - Header block: short order ID (last 5 chars, uppercase), full `en-PH` timestamp (`o.createdAt?.toDate()` fallback `'—'`), table number, waiter name — all values pass through `escapeHtml()`
    - Items list: for each item in `o.items`, render name at ≥ 16 px and quantity at ≥ 14 px; prepend a dot marker element (`•`) on rows whose `id` appears in `o.newItems`; no price column
    - New-items badge + announcement block (conditional): rendered only when `o.newItems` is a non-empty array AND `o.status` is neither `'served_paid'` nor `'cancelled'`; lists each new item's name and quantity
    - Note block (conditional): if `o.note` is a non-empty string, a visually separated `"Note:"` block after the item list
    - No monetary values, no `₱` symbol, no VAT/service/discount/total lines
    - Does not call `calculateFinancials()`
    - _Requirements: 1.2, 1.3, 1.4, 4.1, 4.2, 5.1, 5.4_

  - [ ]* 2.2 Write property test — P1: modal body contains required order identity fields
    - Use `fast-check` with `fc.record({ id: fc.string(), createdAt, tableNumber: fc.integer(), waiterName: fc.string(), items: fc.array(...) })`
    - Assert modal HTML contains the short ID (last 5 chars upper), table number string, and waiter name
    - **Property 1: Modal body contains required order identity fields**
    - **Validates: Requirements 1.2**

  - [ ]* 2.3 Write property test — P2: no monetary values in modal HTML
    - Generate orders with arbitrary `total`, `discountType`, and items with `price`
    - Assert modal HTML contains none of `₱`, `"VAT"`, `"Service"`, `"Total"`, `"Discount"`
    - **Property 2: Modal and print window contain no monetary values**
    - **Validates: Requirements 1.3, 1.4**

  - [ ]* 2.4 Write property test — P3: item names and quantities appear; prices do not
    - Generate a non-empty `items` array with `name`, `qty`, `price` fields
    - Assert each item's `name` and `qty` appear in the modal HTML; assert no `₱\d` pattern tied to an item row
    - **Property 3: Item names and quantities appear; prices do not**
    - **Validates: Requirements 1.3, 3.2**

  - [ ]* 2.5 Write property test — P5: new-items flag and announcement preserved for applicable orders
    - Generate orders with a non-empty `newItems` array and a status from `['pending','preparing','served_unpaid','paid_unserved']`
    - Assert the new-items badge element and each new item's name/qty are present in the modal HTML
    - **Property 5: New-items flag and announcement are preserved in modal for applicable orders**
    - **Validates: Requirements 4.1, 6.3**

  - [ ]* 2.6 Write property test — P6 (modal half): new item rows carry dot marker
    - For orders where some items appear in `newItems`, assert each such item's row includes the dot marker element
    - **Property 6: New item rows are marked in modal**
    - **Validates: Requirements 4.2**

  - [ ]* 2.7 Write property test — P7 (modal half): note block present when note is non-empty
    - Generate orders with `fc.string({ minLength: 1 })` as `note`
    - Assert the modal HTML contains `"Note:"` followed by the escaped note content
    - **Property 7: Special note appears in modal when present**
    - **Validates: Requirements 5.4**

- [x] 3. Implement `kitchenSlipPrintHtml(o)` pure render helper in `admin-orders.js`
  - [x] 3.1 Write the `kitchenSlipPrintHtml(o)` function
    - Fixed heading `"KITCHEN SLIP"` as the topmost heading
    - Restaurant name `"Salo sa Antipolo"`, Order ID (last 5 chars, uppercase), full `en-PH` timestamp, table number, waiter name — all pass through `escapeHtml()`
    - Item table with columns for name and quantity only — no amount/price column
    - Rows whose item `id` appears in `o.newItems` are prefixed with `[NEW]`
    - Note block labelled `"Note:"` if `o.note` is non-empty
    - Auto-print script: `window.onload = () => setTimeout(() => window.print(), 400);`
    - `<style>` block: monospace font, `color: #000`, `background: #fff`, no financial rows
    - No monetary values, no `₱` symbol, no VAT/service/discount/total lines
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.3, 5.2, 5.3, 5.4_

  - [ ]* 3.2 Write property test — P2 (print half): no monetary values in print HTML
    - Same arbitrary as 2.3; assert `kitchenSlipPrintHtml(o)` also contains none of the financial strings
    - **Property 2: Modal and print window contain no monetary values**
    - **Validates: Requirements 3.2, 3.3, 5.2**

  - [ ]* 3.3 Write property test — P6 (print half): new item rows carry [NEW] prefix
    - For orders where some items appear in `newItems`, assert each such item's row in the print HTML includes `[NEW]`
    - **Property 6: New item rows are marked in print**
    - **Validates: Requirements 4.3**

  - [ ]* 3.4 Write property test — P7 (print half): note block present when note is non-empty
    - Assert `kitchenSlipPrintHtml(o)` contains `"Note:"` when `o.note` is non-empty
    - **Property 7: Special note appears in print when present**
    - **Validates: Requirements 5.4**

  - [ ]* 3.5 Write property test — P8: print HTML always contains "KITCHEN SLIP" heading and required metadata
    - Generate any valid order; assert `"KITCHEN SLIP"`, `"Salo sa"`, the short ID, table number, and waiter name are all present in the print HTML
    - **Property 8: Print heading and metadata**
    - **Validates: Requirements 3.1, 5.3**

- [x] 4. Checkpoint — Verify render helpers
  - Ensure all tests written so far pass, ask the user if questions arise.

- [x] 5. Implement `printKitchenSlip(o)` with validation and pop-up guards in `admin-orders.js`
  - [x] 5.1 Write the `printKitchenSlip(o)` function
    - Validation guard: if `!o.id || !o.tableNumber || !(o.items?.length)` → call `showToast('Cannot print: order is missing required fields', 'error')` and return without calling `window.open`
    - Pop-up blocked guard: `const pw = window.open('', '_blank', 'width=400,height=600'); if (!pw) { showToast('Allow pop-ups to print the kitchen slip.'); return; }`
    - On success: call `kitchenSlipPrintHtml(o)`, write the result to `pw.document`, and call `pw.document.close()`
    - _Requirements: 3.1, 3.4, 3.5, 3.6_

  - [ ]* 5.2 Write property test — P9: validation guard prevents printing for malformed orders
    - Generate orders where `items` is empty OR `id` is falsy OR `tableNumber` is falsy
    - Stub `window.open`; assert it is NOT called and `showToast` IS called with an error message
    - **Property 9: Validation guard prevents printing for malformed orders**
    - **Validates: Requirements 3.6**

- [x] 6. Implement `window._showKitchenSlip(id)` and remove `window._showReceipt` in `admin-orders.js`
  - [x] 6.1 Add `window._showKitchenSlip(id)` function
    - Look up order by `id` in `allOrders`; if not found call `showToast('Order not found')` and return
    - Defensive guard: if `#kitchenSlipModal` or `#kitchenSlipModalBody` is missing from the DOM, return early
    - Call `kitchenSlipModalBodyHtml(o)` and inject the result into `#kitchenSlipModalBody`
    - Store `id` in `document.body.dataset.orderId` (or directly on the modal element) for the print button to read
    - Open the modal by adding `.show` to `#kitchenSlipModal`
    - Remove (or replace) the `window._showReceipt` assignment — no function named `_showReceipt` should remain
    - _Requirements: 1.1, 1.2, 6.1_

  - [x] 6.2 Wire modal close and print button event listeners
    - `#kitchenSlipModalClose` click → remove `.show` from `#kitchenSlipModal`
    - `#kitchenSlipModalClose2` click → remove `.show` from `#kitchenSlipModal`
    - Modal backdrop click → remove `.show` (match existing confirm-modal pattern)
    - `#kitchenSlipModalPrint` click → resolve current order from `allOrders` using stored ID, call `printKitchenSlip(o)`
    - _Requirements: 1.5, 3.1_

- [x] 7. Update `orderCardHtml(o)` to render "Kitchen Slip" button in `admin-orders.js`
  - In the secondary-buttons section, replace:
    `onclick="window._showReceipt('${o.id}')">Receipt</button>`
    with:
    `onclick="window._showKitchenSlip('${o.id}')">Kitchen Slip</button>`
  - The `if (o.status !== 'cancelled')` guard is unchanged — button still hidden for cancelled orders
  - No other change to `orderCardHtml` logic
  - _Requirements: 2.1, 2.2_

  - [ ]* 7.1 Write property test — P4: "Kitchen Slip" button present on non-cancelled cards; "Receipt" absent
    - For each status in `['pending','preparing','served_unpaid','served_paid','paid_unserved']`, assert `orderCardHtml(o)` contains `"Kitchen Slip"` and does not contain `"Receipt"`
    - **Property 4: Non-cancelled order cards carry "Kitchen Slip" button; no "Receipt" label appears**
    - **Validates: Requirements 2.1**

  - [ ]* 7.2 Write property test — P10: card still renders correct status badge and action buttons
    - For each recognized status, assert `orderCardHtml(o)` contains the matching `STATUS_META[status].label` and the action button labels from `STATUS_ACTIONS[status]`
    - **Property 10: Non-cancelled order card still renders correct status badge and action buttons**
    - **Validates: Requirements 6.1, 6.3**

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All property-based tests use [fast-check](https://github.com/dubzzz/fast-check) and can be run with `vitest --run` (no build step required)
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties across arbitrary inputs
- Unit tests validate specific examples and edge cases
- The design's `escapeHtml()` must be applied to all Firestore-sourced strings before HTML injection — this is verified implicitly by the property tests using strings with special characters
- No changes to any file other than `admin-html/admin-orders.html` and `admin-js/admin-orders.js`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1"] },
    { "id": 5, "tasks": ["6.2", "7"] },
    { "id": 6, "tasks": ["7.1", "7.2"] }
  ]
}
```
