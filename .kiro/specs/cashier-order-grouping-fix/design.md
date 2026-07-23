# Design Document

## Overview

This feature refactors the Cashier portal (`cashier.js`) to group multiple unpaid dine-in order slips for the same table into a single "Grouped Card" displayed in the queue. Instead of showing each Firestore `orders` document as a separate card, the portal collapses all unpaid, non-cancelled dine-in slips sharing the same `tableNumber` into one group object, processes payment for the entire group atomically via a Firestore `writeBatch`, and writes a single payment record with an `orderIds` array.

Takeout orders are never grouped — each remains its own individual queue card. The existing `calculateFinancials` function is preserved unchanged; a new thin wrapper `calculateGroupFinancials` routes grouped discount logic through it.

No new files are created. All changes are made inside `cashier.js`.

---

## Architecture

The change is confined to a single module (`cashier.js`). The existing Firebase / auth / rendering pipeline is preserved; only the data shape flowing through the rendering and payment pipelines is updated.

```
Firestore onSnapshot
        │
        ▼
  allOrders  (flat array of Slip objects)
        │
        ▼
  groupOrdersByTable(queueOrders)
        │  filters: unpaid + non-cancelled
        │  groups: dine-in by tableNumber
        │  keeps: each takeout as solo group
        ▼
  groups[]  (Group objects — see Data Models)
        │
        ├──► renderOrders()       → renders Grouped_Cards in the queue
        ├──► updateOrdersBadge()  → badge = groups.length
        ├──► preselect logic      → resolves slip ID → group
        │
        └──► selectGroup(key)
                  │
                  ▼
            renderOrderDetail(group)
                  │
                  └──► calculateGroupFinancials(group, discountType)
                               │
                               └──► calculateFinancials(total, discount)
                                       (unchanged)
        │
        └──► processPayment()
                  │
                  ├─ validateGroup()
                  ├─ calculateGroupFinancials()
                  ├─ writeBatch: update all slips
                  └─ addDoc: one payment record with orderIds[]
```

---

## Components and Interfaces

### `groupOrdersByTable(orders)`

Pure function. Accepts a flat array of Slip objects (pre-filtered to unpaid, non-cancelled). Returns an array of Group objects.

```js
/**
 * Groups unpaid dine-in orders by tableNumber.
 * Takeout orders are each wrapped as a solo group.
 *
 * @param {Order[]} orders - Unpaid, non-cancelled orders to group
 * @returns {Group[]}
 */
function groupOrdersByTable(orders) { ... }
```

**Algorithm:**
1. For each order, determine its group key:
   - Dine-in: `key = order.tableNumber`
   - Takeout: `key = order.id` (always unique, never merged)
2. Accumulate orders into a `Map<key, Order[]>`.
3. For each map entry, construct the Group object:
   - `combinedTotal` = sum of all `order.total` values
   - `combinedItems` = flat concat of all `order.items` arrays (preserves per-slip identity; no deduplication)
   - `earliestCreatedAt` = minimum `createdAt` Timestamp across all orders
   - `highestValueSlip` = order with max `total`; ties broken by earliest `createdAt`
4. Return sorted array (earliest `earliestCreatedAt` first, matching queue ordering).

---

### `calculateGroupFinancials(group, discountType)`

Thin wrapper around the existing `calculateFinancials`. All standard financial math remains in `calculateFinancials` untouched.

```js
/**
 * Computes financials for a group, applying grouped discount rules.
 *
 * @param {Group} group
 * @param {'none'|'senior'|'pwd'} discountType
 * @returns {Financials}  — same shape as calculateFinancials()
 */
function calculateGroupFinancials(group, discountType) { ... }
```

**Logic:**
- `discountType === 'none'` → delegate: `calculateFinancials(group.combinedTotal, { type: 'none' })`
- `discountType === 'senior'` or `'pwd'`:
  - If `group.highestValueSlip.total === 0` → fallback to no-discount path
  - Otherwise:
    - `discountBase = group.highestValueSlip.total`
    - `discountAmount = discountBase × 0.20`
    - `afterDiscount = group.combinedTotal − discountAmount`
    - `vatExempt = true` → `vatAmount = 0`
    - `serviceCharge = afterDiscount × SERVICE_CHARGE_RATE`
    - `grandTotal = afterDiscount + serviceCharge`
    - Returns object matching the `calculateFinancials` return shape

---

### `selectedGroup` (module-level state)

The existing `selectedOrder` variable is replaced by `selectedGroup`:

```js
let selectedGroup = null;   // replaces selectedOrder
```

All references to `selectedOrder` in `selectOrder()`, `setDiscount()`, `updateCashTendered()`, `processPayment()`, `renderOrders()`, and the close-button handler are updated to `selectedGroup`.

---

### `selectGroup(groupKey)`

Replaces the existing `window.selectOrder`. Looks up the group by key from the current computed groups array, sets `selectedGroup`, resets payment state, and calls `renderOrderDetail(group)`.

```js
window.selectGroup = function(groupKey) { ... }
```

Card `onclick` attributes change from `selectOrder('${order.id}')` to `selectGroup('${group.key}')`.

---

### `renderOrders()` — updated

Calls `groupOrdersByTable(queueOrders)` to produce groups, then renders one card per group. Card structure:

- Header: `#` + last 6 chars of earliest slip ID (or a multi-slip indicator)
- Table label: `Table ${group.tableNumber}` or Takeout pill
- Body:
  - `₱{combinedTotal}` — pre-tax total
  - `≈ ₱{preview.grandTotal} incl. 12% VAT + 7% SC` (no-discount preview)
  - `{totalItemCount} item(s)`
  - `{n} slips` badge (only when `group.orders.length > 1`)
- Footer: `earliestCreatedAt` formatted via `formatTimeAgo`

Card `data-group-key="${group.key}"` attribute used for selection state.

Search filter operates on the group array:
- Match `group.tableNumber` (dine-in)
- Match any slip's `waiterName` in `group.orders`
- For takeout groups: match `'takeout'`, the order ID, or `waiterName`

---

### `renderOrderDetail(group)` — updated

Accepts a Group object instead of a single Order. Key differences from current implementation:

- **Order Information section**: shows `tableNumber`, `earliestCreatedAt`, and — when `group.orders.length > 1` — a "Slip IDs" row listing last-6-chars of each order ID (uppercase, comma-separated)
- **Order Items section**: renders `group.combinedItems` (flat list from all slips)
- **Financial calculations**: calls `calculateGroupFinancials(group, discountType)`
- **Subtotal row**: labeled as `Combined Total` in the breakdown

---

### `processPayment()` — updated

Replaces the current single `updateDoc` + `addDoc` pattern with a `writeBatch`:

```js
window.processPayment = async function() {
  // 1. Guard: selectedGroup must exist
  // 2. Re-validate all slips in group are still unpaid (canFinalizePayment)
  // 3. Calculate financials via calculateGroupFinancials
  // 4. Validate cashTendered >= grandTotal
  // 5. Build writeBatch:
  //    - For each slip in selectedGroup.orders:
  //        batch.update(doc(db,'orders',slip.id), {
  //          status: nextStatusAfterPayment(liveSlip),
  //          paidBy, paymentMethod, discountType, grandTotal, cashTendered,
  //          changeGiven,
  //          ...(liveSlip.paidAt ? {} : { paidAt: serverTimestamp() })
  //        })
  // 6. Create payment document object (all 14 required fields + orderIds[])
  // 7. await batch.commit()
  // 8. await addDoc(collection(db,'payments'), paymentDoc)
  // 9. On success: clear selectedGroup, show toast, auto-print receipt
  // 10. On error: show error toast, do NOT partially clear state
};
```

`writeBatch` is imported from `firebase-firestore.js` alongside existing imports.

**Payment document fields** (Requirement 5.7):

| Field | Source |
|---|---|
| `orderIds` | `selectedGroup.orders.map(o => o.id)` |
| `tableNumber` | `selectedGroup.tableNumber` |
| `cashierId` | `cashierData.uid` |
| `cashierName` | `cashierData.name` |
| `paymentMethod` | `'Cash'` |
| `discountType` | `discountType` state variable |
| `discountAmount` | `financials.discountAmount` |
| `subtotal` | `financials.subtotal` |
| `vatAmount` | `financials.vatAmount` |
| `vatExempt` | `financials.vatExempt` |
| `serviceCharge` | `financials.serviceCharge` |
| `grandTotal` | `financials.grandTotal` |
| `cashTendered` | `cashTendered` state variable |
| `changeGiven` | `cashTendered − financials.grandTotal` |
| `timestamp` | `serverTimestamp()` |

> Note: `orderId` (singular) in the existing schema is replaced by `orderIds` (array). The billing view and receipt printing will need to handle `orderIds` alongside legacy `orderId` for backward compatibility.

---

### `updateOrdersBadge()` — updated

```js
function updateOrdersBadge() {
  const queueOrders = allOrders.filter(belongsInCashierQueue);
  const groups = groupOrdersByTable(queueOrders);
  $('ordersCountBadge').textContent = groups.length;
}
```

---

### Pre-selection Logic (`subscribeToOrders`) — updated

```js
if (firstLoad) {
  firstLoad = false;
  const preselectId = localStorage.getItem('cashier_preselect_order');
  localStorage.removeItem('cashier_preselect_order'); // always clear
  if (preselectId) {
    const queueOrders = allOrders.filter(belongsInCashierQueue);
    const groups = groupOrdersByTable(queueOrders);
    const targetGroup = groups.find(g => g.orders.some(o => o.id === preselectId));
    if (targetGroup) {
      selectGroup(targetGroup.key);
      setTimeout(() => {
        const card = document.querySelector(`.order-card[data-group-key="${targetGroup.key}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  }
}
```

---

### `printReceipt(group)` — updated

Updated to accept a Group object. Items rows sourced from `group.combinedItems`. Order reference line shows all slip IDs (last-5, comma-separated) when group has multiple slips. Table/takeout line uses `group.tableNumber`.

### `printOrderSlip(group)` — updated

Updated similarly to accept a Group object and render `group.combinedItems`.

---

## Data Models

### Group Object

```js
{
  key: string,              // tableNumber for dine-in; orderId for takeout
  tableNumber: string|null, // null for takeout
  isTakeout: boolean,
  orders: Order[],          // all constituent slips, sorted by createdAt asc
  combinedTotal: number,    // sum of all order.total values
  combinedItems: Item[],    // flat concat of all order.items (no dedup)
  earliestCreatedAt: Timestamp,  // minimum createdAt across all orders
  highestValueSlip: Order   // slip with max total; earliest createdAt as tiebreaker
}
```

### Order (Slip) — existing Firestore shape (unchanged)

```js
{
  id: string,
  tableNumber: string|null,
  orderType: 'dine-in'|'takeout',
  waiterName: string,
  items: Item[],
  total: number,
  status: string,           // e.g. 'served_unpaid', 'paid_unserved', 'served_paid'
  createdAt: Timestamp,
  paidAt?: Timestamp,
  note?: string
}
```

### Item — existing shape (unchanged)

```js
{
  name: string,
  qty: number,
  price: number
}
```

### Financials — return shape of `calculateFinancials` (unchanged)

```js
{
  subtotal: number,
  discountAmount: number,
  discountRate: number,
  vatExempt: boolean,
  netAmount: number,
  vatAmount: number,
  serviceCharge: number,
  grandTotal: number
}
```

### Payment Document — updated shape

```js
{
  orderIds: string[],       // NEW: replaces orderId (singular)
  tableNumber: string|null,
  cashierId: string,
  cashierName: string,
  paymentMethod: 'Cash',
  discountType: 'none'|'senior'|'pwd',
  discountAmount: number,
  subtotal: number,
  vatAmount: number,
  vatExempt: boolean,
  serviceCharge: number,
  grandTotal: number,
  cashTendered: number,
  changeGiven: number,
  timestamp: Timestamp      // serverTimestamp()
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: Dine-in orders with the same tableNumber are always co-grouped

*For any* array of unpaid, non-cancelled dine-in orders, if two orders share the same `tableNumber`, then `groupOrdersByTable` must place them in the same group.

**Validates: Requirements 1.1**

---

### Property 2: Takeout orders are never merged

*For any* array of orders containing takeout orders, every takeout order produced by `groupOrdersByTable` must appear in a group where `group.orders.length === 1` and `group.isTakeout === true`.

**Validates: Requirements 1.2, 1.4**

---

### Property 3: combinedTotal equals the sum of all slip totals

*For any* group produced by `groupOrdersByTable`, `group.combinedTotal` must equal the arithmetic sum of `order.total` across all orders in `group.orders`.

**Validates: Requirements 2.2, 3.2**

---

### Property 4: combinedItems is the flat concatenation of all slip item arrays

*For any* group produced by `groupOrdersByTable`, `group.combinedItems` must contain every item from every slip in `group.orders` (in order, no deduplication), including duplicate item names from different slips listed as separate entries.

**Validates: Requirements 2.3, 3.1, 3.5**

---

### Property 5: earliestCreatedAt is the minimum createdAt across all slips

*For any* group produced by `groupOrdersByTable`, `group.earliestCreatedAt` must be the minimum `createdAt` Timestamp value among all orders in `group.orders`.

**Validates: Requirements 2.6**

---

### Property 6: highestValueSlip is the slip with the maximum total, earliest createdAt as tiebreaker

*For any* group produced by `groupOrdersByTable`, `group.highestValueSlip` must be the order whose `total` is the greatest. When two or more orders share the same maximum `total`, the one with the earliest `createdAt` is chosen.

**Validates: Requirements 4.5**

---

### Property 7: Senior/PWD discount amount is always Discount_Base × 0.20

*For any* group and any `discountType` of `'senior'` or `'pwd'`, `calculateGroupFinancials(group, discountType).discountAmount` must equal `group.highestValueSlip.total × 0.20` (or `0` when `group.highestValueSlip.total === 0`).

**Validates: Requirements 4.1, 4.7**

---

### Property 8: Senior/PWD discount always produces VAT exemption with zero VAT and correct service charge

*For any* group and any `discountType` of `'senior'` or `'pwd'` where `group.highestValueSlip.total > 0`, `calculateGroupFinancials` must return `vatExempt === true`, `vatAmount === 0`, `serviceCharge === (combinedTotal − discountAmount) × 0.07`, and `grandTotal === (combinedTotal − discountAmount) + serviceCharge`.

**Validates: Requirements 4.2, 4.3**

---

### Property 9: No-discount path delegates unchanged to calculateFinancials

*For any* group with `discountType === 'none'`, the result of `calculateGroupFinancials(group, 'none')` must be strictly equal (field-by-field) to `calculateFinancials(group.combinedTotal, { type: 'none' })`.

**Validates: Requirements 4.6**

---

### Property 10: nextStatusAfterPayment is determined purely by serving state

*For any* order that is unpaid and not cancelled, `nextStatusAfterPayment(order)` must return `'served_paid'` if and only if `isServed(order)` is true, and `'paid_unserved'` otherwise.

**Validates: Requirements 5.3, 5.4**

---

### Property 11: Orders badge count equals the number of groups, not slips

*For any* array of orders, the badge count derived from `groupOrdersByTable(queueOrders).length` must equal the number of distinct group keys produced, which is ≤ the number of individual unpaid slips.

**Validates: Requirements 7.1, 7.2**

---

### Property 12: Search returns groups matching tableNumber or any slip's waiterName

*For any* non-empty search term and any array of groups, the filtered result must include exactly those groups where `group.tableNumber` contains the search term OR any order in `group.orders` has a `waiterName` containing the search term; and no group failing both conditions must be included.

**Validates: Requirements 8.1, 8.2**

---

### Property 13: Pre-selection lookup finds the correct group for any slip ID

*For any* array of groups and any slip ID that exists within one of those groups, the lookup `groups.find(g => g.orders.some(o => o.id === slipId))` must return the group containing that slip, and return `undefined` for a slip ID not present in any group.

**Validates: Requirements 6.1, 6.3**

---

## Error Handling

### Stale selection guard (pre-payment)

Before committing the batch, `processPayment` re-checks every slip in `selectedGroup.orders` against the live `allOrders` array using `canFinalizePayment`. If any slip is no longer unpaid (paid or cancelled by a concurrent actor), the entire payment attempt is aborted with a toast message: `"⚠ One or more orders in this group are no longer awaiting payment. Refreshing…"`. `selectedGroup` is cleared and `renderOrders()` is called.

### Batch commit failure

If `batch.commit()` rejects, the catch block shows a descriptive toast (`"❌ Failed to process payment: …"`) and does **not** clear `selectedGroup` — the cashier can retry. The payment `addDoc` is called only after `batch.commit()` resolves successfully, ensuring no dangling payment record is created.

### Zero-slip group guard

`processPayment` guards against a group with no orders (`selectedGroup.orders.length === 0`) and shows `"⚠ No orders in group"`, though this state should not be reachable through normal UI flows.

### Missing `writeBatch` import

`writeBatch` must be added to the existing `import { ... } from "...firebase-firestore.js"` statement. Forgetting this import is the most likely development-time error; it will surface immediately as a `ReferenceError` on payment attempt.

---

## Testing Strategy

### Unit / Example tests

- `groupOrdersByTable([])` returns `[]`
- Two dine-in orders with the same `tableNumber` produce one group
- One dine-in + one takeout with the same `tableNumber` produce two groups
- `combinedTotal` equals the sum of all `order.total` values
- `combinedItems` length equals the sum of all `order.items.length` values
- `earliestCreatedAt` is the minimum `createdAt` among all slips
- `highestValueSlip` uses earliest `createdAt` as tiebreaker when totals are tied
- `calculateGroupFinancials` with `'none'` matches `calculateFinancials(combinedTotal, {type:'none'})`
- `calculateGroupFinancials` with `'senior'` produces `discountAmount = highestValueSlip.total × 0.20`, `vatExempt = true`, `vatAmount = 0`
- `calculateGroupFinancials` with zero `highestValueSlip.total` falls back to no-discount path
- `nextStatusAfterPayment` returns `'served_paid'` for a `served_unpaid` order
- `nextStatusAfterPayment` returns `'paid_unserved'` for a non-served unpaid order
- Pre-selection lookup returns the correct group for a given slip ID
- Pre-selection lookup returns `undefined` / does nothing when slip ID is not in any queue group

### Property-based tests

PBT is applicable here. `groupOrdersByTable` and `calculateGroupFinancials` are pure functions whose correctness must hold across all inputs. The chosen library is **fast-check** (imported from CDN or via npm `fast-check` for local testing).

Each property test runs a minimum of **100 iterations**.

Tag format: `// Feature: cashier-order-grouping-fix, Property {N}: {property_text}`

| Property | Test description |
|---|---|
| P1 | Generate random dine-in order arrays; all same-tableNumber pairs are co-grouped |
| P2 | Generate random order arrays with takeout orders; each takeout is a solo group |
| P3 | Generate random groups; combinedTotal equals sum of order.total |
| P4 | Generate random groups; combinedItems is the flat concat of all items arrays |
| P5 | Generate random groups with varying createdAt; earliestCreatedAt is the minimum |
| P6 | Generate groups with ties in total; highestValueSlip uses earliest createdAt |
| P7 | Generate random groups; senior/pwd discountAmount === highestValueSlip.total × 0.20 |
| P8 | Generate random groups; senior/pwd produces vatExempt=true, vatAmount=0, correct serviceCharge and grandTotal |
| P9 | Generate random groups; no-discount result matches calculateFinancials(combinedTotal, {type:'none'}) |
| P10 | Generate random unpaid orders; nextStatusAfterPayment returns correct status based on isServed |
| P11 | Generate random order arrays; badge count equals groups.length from groupOrdersByTable |
| P12 | Generate random groups + search terms; filtered results match exactly the correct predicate |
| P13 | Generate random group arrays + slip IDs; lookup finds correct group or returns undefined |

### Integration tests (manual / Firestore emulator)

- Confirm `writeBatch` updates all slips in the group atomically
- Confirm payment document is created with the correct `orderIds` array
- Confirm partial failure (mock batch rejection) leaves all orders in their original state
- Confirm `paidAt` is stamped only on slips that lack it
- Confirm billing view displays payment records that use `orderIds` (backward compat with legacy `orderId`)
