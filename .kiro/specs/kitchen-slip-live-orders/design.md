# Design Document — Kitchen Slip: Live Orders

## Overview

This feature replaces the existing Receipt modal and print window on the Live Orders admin page (`admin-html/admin-orders.html` + `admin-js/admin-orders.js`) with a Kitchen Slip modal and a matching print window. The change strips all financial data from both surfaces while preserving all kitchen-relevant fields (order identity, timestamp, table, waiter, items with quantities, new-items flag, and special notes). No other portal or page is affected.

The implementation is entirely self-contained within two files and requires no new dependencies. All existing order management functionality — status transitions, cancellations, discount controls, Send to Cashier, real-time Firestore updates — is left untouched.

---

## Architecture

The feature is a focused in-place replacement within the existing single-page, module-per-page architecture.

```
admin-html/admin-orders.html
  └── <div id="kitchenSlipModal">  ← replaces <div id="receiptModal">
  └── modal header, body, footer

admin-js/admin-orders.js
  ├── window._showKitchenSlip(id)     ← replaces window._showReceipt(id)
  ├── printKitchenSlip(o)             ← replaces inline print handler
  ├── kitchenSlipModalBodyHtml(o)     ← pure render helper (modal body)
  └── kitchenSlipPrintHtml(o)         ← pure render helper (print document)
```

Because the project uses no build step or framework, the replacement follows the existing pattern precisely:

- DOM structure is declared inline in the HTML file.
- JavaScript is a plain ES module (`type="module"`) loaded via a `<script>` tag.
- `window._showKitchenSlip` is assigned to `window` so inline `onclick` attributes on order cards can call it.
- Styling lives in the `<style>` block inside the HTML file and in inline styles in the JS-generated HTML.

---

## Components and Interfaces

### 1. Kitchen Slip Modal (HTML)

**Element:** `<div class="modal" id="kitchenSlipModal">`

Replaces `<div class="modal" id="receiptModal">` in `admin-orders.html`.

Structure mirrors the existing modal pattern:

```
.modal#kitchenSlipModal
  .modal-backdrop
  .modal-content.modal-content-kitchen-slip
    .modal-head
      h3 "Kitchen Slip"
      button.modal-close#kitchenSlipModalClose  ×
    .modal-body#kitchenSlipModalBody
      <!-- dynamically populated by JS -->
    .modal-foot
      button.btn-sm.gold#kitchenSlipModalPrint  Print
      button.btn-sm#kitchenSlipModalClose2       Close
```

The `modal-content-kitchen-slip` class sets `max-width: 440px` to give item names enough room at 16 px+.

### 2. `window._showKitchenSlip(id)` (JS)

Assigned to `window` for inline `onclick` access. Replaces `window._showReceipt`.

Responsibilities:
- Looks up the order in `allOrders`.
- Calls `kitchenSlipModalBodyHtml(o)` to generate the modal body HTML.
- Injects the result into `#kitchenSlipModalBody`.
- Stores `id` in `body.dataset.orderId` for the print handler to read.
- Opens the modal by adding `.show`.

No financial calculations are performed.

### 3. `kitchenSlipModalBodyHtml(o)` (JS — pure render helper)

Returns an HTML string for the modal body. Accepts an order object `o`.

Content rendered:
- **Header block:** Order ID (last 5 chars, uppercase), full timestamp in `en-PH` locale, table number, waiter name.
- **New-items badge + announcement** (conditional — see §4).
- **Items list:** for each item in `o.items`, renders name (≥ 16 px) and quantity (≥ 14 px). New items receive a dot marker `•`. No price column.
- **Note block** (conditional): if `o.note` is non-empty, a visually separated "Note:" block after the item list.

No monetary values are rendered.

### 4. `printKitchenSlip(o)` (JS)

Called when the Print button is clicked. Reads `body.dataset.orderId`, resolves the order, performs the validation guard, generates the print document via `kitchenSlipPrintHtml(o)`, opens a pop-up window, and writes the document.

Validation guard (Req 3.6):
```
if (!o.id || !o.tableNumber || !(o.items?.length)) {
  showToast('Cannot print: order is missing required fields', 'error');
  return;
}
```

Pop-up blocked guard (Req 3.5):
```
const pw = window.open('', '_blank', 'width=400,height=600');
if (!pw) { showToast('Allow pop-ups to print the kitchen slip.'); return; }
```

### 5. `kitchenSlipPrintHtml(o)` (JS — pure render helper)

Returns the full HTML string for the print window document. Accepts an order object `o`.

Content rendered:
- `"KITCHEN SLIP"` as the topmost heading.
- Restaurant name (`Salo sa Antipolo`).
- Order ID, timestamp (full `en-PH` locale), table number, waiter name.
- Item table: columns for Item name and Qty only — no Amount/Price column.
- New items are prefixed with `[NEW]` label in the item row.
- Note block labelled `"Note:"` if `o.note` is non-empty.
- Auto-print script: `window.onload = () => setTimeout(() => window.print(), 400);`

**No** financial rows (VAT, service charge, discount, grand total).

### 6. Order Card button change

In `orderCardHtml(o)`, the secondary-buttons section is updated:

```js
// Before
secondaryButtons += `<button … onclick="window._showReceipt('${o.id}')">Receipt</button>`;

// After
secondaryButtons += `<button … onclick="window._showKitchenSlip('${o.id}')">Kitchen Slip</button>`;
```

The guard `if (o.status !== 'cancelled')` is unchanged — the button is still hidden for cancelled orders.

---

## Data Models

No new Firestore collections or document fields are introduced. The feature reads from the existing `orders` collection documents. Relevant fields consumed:

| Field | Type | Used for |
|---|---|---|
| `id` | `string` (Firestore doc ID) | Order ID display & validation guard |
| `createdAt` | `Timestamp` | Timestamp display |
| `tableNumber` | `string\|number` | Table display & validation guard |
| `waiterName` | `string` | Waiter display |
| `items` | `Array<{id, name, qty, price}>` | Item list (name + qty only; price ignored) |
| `newItems` | `Array<{id, name, qty}>` | New-items flag & announcement |
| `note` | `string` | Special instructions block |
| `status` | `string` | Determines new-items flag visibility |

`price` is present in each item object but is intentionally not read in `kitchenSlipModalBodyHtml` or `kitchenSlipPrintHtml`. The financial constants `VAT_RATE`, `SERVICE_CHARGE_RATE`, and `calculateFinancials` are not called from any kitchen slip code path.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Modal body contains required order identity fields

*For any* order object with an `id`, `createdAt`, `tableNumber`, and `waiterName`, the HTML returned by `kitchenSlipModalBodyHtml(o)` SHALL contain the order's short ID (last 5 chars, uppercase), a formatted timestamp, the table number, and the waiter name.

**Validates: Requirements 1.2**

---

### Property 2: Modal and print window contain no monetary values

*For any* order object regardless of `total`, `discountType`, or the prices stored on individual items, neither `kitchenSlipModalBodyHtml(o)` nor `kitchenSlipPrintHtml(o)` SHALL contain the currency symbol `₱`, the strings `"VAT"`, `"Service"`, `"Total"`, `"Discount"`, or any decimal number formatted as a Philippine peso amount.

**Validates: Requirements 1.3, 1.4, 3.2, 3.3, 5.2**

---

### Property 3: Item names and quantities appear; prices do not

*For any* order with a non-empty `items` array, `kitchenSlipModalBodyHtml(o)` SHALL render each item's `name` and `qty`, and SHALL NOT render any per-item price value (i.e., no string matching `₱\d` associated with an item row).

**Validates: Requirements 1.3, 3.2**

---

### Property 4: Non-cancelled order cards carry "Kitchen Slip" button; no "Receipt" label appears

*For any* order whose `status` is not `"cancelled"`, the HTML returned by `orderCardHtml(o)` SHALL contain the text `"Kitchen Slip"` and SHALL NOT contain the text `"Receipt"`.

**Validates: Requirements 2.1**

---

### Property 5: New-items flag and announcement are preserved in modal for applicable orders

*For any* order with a non-empty `newItems` array and a `status` that is neither `"served_paid"` nor `"cancelled"`, `kitchenSlipModalBodyHtml(o)` SHALL contain the new-items badge element and SHALL list each new item's name and quantity in the announcement section.

**Validates: Requirements 4.1, 6.3**

---

### Property 6: New item rows are marked in modal and print

*For any* order where an item appears in `newItems`, the modal HTML SHALL include a dot marker element on that item's row, and the print HTML SHALL prefix that item's row with `"NEW"`.

**Validates: Requirements 4.2, 4.3**

---

### Property 7: Special note appears in both modal and print when present

*For any* order where `note` is a non-empty string, both `kitchenSlipModalBodyHtml(o)` and `kitchenSlipPrintHtml(o)` SHALL contain the string `"Note:"` followed by the escaped note content.

**Validates: Requirements 5.4**

---

### Property 8: Print HTML always contains "KITCHEN SLIP" heading and required metadata

*For any* valid order, `kitchenSlipPrintHtml(o)` SHALL contain the heading `"KITCHEN SLIP"`, the restaurant name `"Salo sa"`, the order short ID, the table number, and the waiter name.

**Validates: Requirements 3.1, 5.3**

---

### Property 9: Validation guard prevents printing for malformed orders

*For any* order object where `items` is empty or `id` is falsy or `tableNumber` is falsy, `printKitchenSlip(o)` SHALL NOT call `window.open` and SHALL call `showToast` with an error message.

**Validates: Requirements 3.6**

---

### Property 10: Non-cancelled order card still renders correct status badge and action buttons

*For any* order with a recognized status, `orderCardHtml(o)` SHALL still render the status badge with the correct label from `STATUS_META` and the action buttons matching `STATUS_ACTIONS[o.status]`.

**Validates: Requirements 6.1, 6.3**

---

## Error Handling

| Scenario | Handling |
|---|---|
| Order ID not found in `allOrders` when `_showKitchenSlip` is called | `showToast('Order not found')` — modal does not open |
| `#kitchenSlipModal` or `#kitchenSlipModalBody` missing from DOM | Early return (defensive guard) |
| `o.items` is empty, `o.id` is falsy, or `o.tableNumber` is falsy when Print is clicked | `showToast('Cannot print: order is missing required fields', 'error')` — `window.open` not called |
| `window.open` returns `null` (pop-up blocked) | `showToast('Allow pop-ups to print the kitchen slip.')` |
| `o.createdAt` is null or has no `.toDate()` | Falls back to `'—'` for the timestamp — does not throw |
| `o.note` is `null`, `undefined`, or empty string | Note block is omitted entirely — no error |
| `o.newItems` is undefined or not an array | Treated as empty array — no new-items UI rendered |

All user-facing strings that originate from Firestore data pass through `escapeHtml()` before injection into HTML strings to prevent XSS.

---

## Testing Strategy

### Approach

This feature is amenable to property-based testing because the two key render functions (`kitchenSlipModalBodyHtml` and `kitchenSlipPrintHtml`) are **pure functions** — they take an order object and return an HTML string. Input variation reveals edge cases (items with special characters, missing fields, new-items arrays of varying size, notes with HTML entities, etc.).

The chosen property-based testing library is **[fast-check](https://github.com/dubzzz/fast-check)** (JavaScript, runs in Node without a build step; can be executed with `node --experimental-vm-modules` + a test runner or directly with `vitest --run`).

Each property test runs a minimum of **100 iterations**.

### Unit Tests (example-based)

| Test | Validates |
|---|---|
| Modal heading is `"Kitchen Slip"`; `"Receipt"` absent | Req 1.1, 2.3 |
| Modal footer has Print button and Close button only | Req 1.5 |
| Cancelled order card has no "Kitchen Slip" button | Req 2.2 |
| Print HTML contains `window.print()` auto-trigger script | Req 3.4 |
| `window.open` returns `null` → pop-up toast fired | Req 3.5 |
| Print HTML `<style>` block uses monospace font, `color:#000`, `background:#fff` | Req 5.2 |
| Item names in modal have `font-size` ≥ 16px inline style; quantities ≥ 14px | Req 5.1 |

### Property-Based Tests

Each test is tagged with: `Feature: kitchen-slip-live-orders, Property {N}: {property text}`

| Property | Test description | fast-check arbitraries |
|---|---|---|
| **P1** — Order identity fields | `fc.record({ id, createdAt, tableNumber, waiterName, items })` → modal HTML contains all four values | `fc.string`, `fc.integer`, `fc.date` |
| **P2** — No monetary values | `fc.record({ total, discountType, items (with price) })` → modal + print HTML contain no `₱`, `"VAT"`, `"Service"`, `"Total"`, `"Discount"` | `fc.float`, `fc.constantFrom('none','senior','pwd')` |
| **P3** — Item names + qty, no price | `fc.array(fc.record({ name, qty, price }))` → each item name and qty appears; no price value | `fc.string`, `fc.nat`, `fc.float` |
| **P4** — "Kitchen Slip" button on non-cancelled card | `fc.constantFrom('pending','preparing','served_unpaid','served_paid','paid_unserved')` → card HTML has "Kitchen Slip", no "Receipt" | `fc.constantFrom` |
| **P5** — New-items flag in modal | `fc.array(fc.record({ id, name, qty }), { minLength: 1 })` + applicable status → badge + announcement present | `fc.array`, `fc.string` |
| **P6** — New item row markers | Items array where a subset appear in `newItems` → modal has `•` marker, print has `NEW` prefix | `fc.array`, set intersection |
| **P7** — Note block | `fc.string({ minLength: 1 })` as `note` → `"Note:"` present in modal + print HTML | `fc.string` |
| **P8** — Print heading and metadata | Any valid order → `"KITCHEN SLIP"` in print HTML + restaurant name + short ID + table + waiter | `fc.record` |
| **P9** — Validation guard | Orders with empty `items` OR falsy `id` OR falsy `tableNumber` → `window.open` not called, toast fired | `fc.oneof`, `fc.constant` |
| **P10** — Card status badge non-regression | Any recognized status → `orderCardHtml()` badge label matches `STATUS_META[status].label` and action buttons match `STATUS_ACTIONS[status]` | `fc.constantFrom(recognized statuses)` |

### Integration / Manual Checks

- Load the page in a browser with live Firestore data and verify real-time order cards render "Kitchen Slip" button.
- Open the modal on a real order and confirm no financial data is visible.
- Click Print and verify the kitchen slip pop-up auto-prints with "KITCHEN SLIP" heading.
- Confirm all existing order card actions (status buttons, cancel, send to cashier, discount) still function without regression.
