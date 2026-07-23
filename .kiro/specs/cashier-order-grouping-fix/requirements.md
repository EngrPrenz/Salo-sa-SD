# Requirements Document

## Introduction

On the Cashier portal of the Salo sa Antipolo POS system, waiters can submit multiple order slips for the same dine-in table (e.g., an initial order and a follow-up order). Currently each slip appears as a separate card in the cashier queue, requiring the cashier to process and pay them individually. This feature consolidates all unpaid dine-in slips for the same table into a single grouped card so the cashier can review the combined bill and process one payment for the entire table. Takeout orders are always handled as individual cards because they have no shared table identity.

## Glossary

- **Cashier_Queue**: The list of unpaid, non-cancelled order cards displayed in the Orders view of the cashier portal.
- **Slip**: A single Firestore `orders` document submitted by a waiter for one order event at a table.
- **Table_Group**: The set of all unpaid, non-cancelled dine-in Slips that share the same `tableNumber` value.
- **Grouped_Card**: The single card rendered in the Cashier_Queue that represents a Table_Group.
- **Combined_Total**: The arithmetic sum of the `total` field across all Slips in a Table_Group, used as the base for VAT, service charge, and discount calculations.
- **Highest_Value_Slip**: The Slip within a Table_Group whose `total` field is the greatest. When two or more Slips share the same highest `total`, the Slip with the earliest `createdAt` timestamp is chosen as the tiebreaker.
- **Discount_Base**: The `total` of the Highest_Value_Slip, used exclusively to compute the discount amount when a Senior Citizen or PWD discount is applied.
- **calculateFinancials**: The existing JavaScript function `calculateFinancials(total, discount)` in `cashier.js` responsible for computing VAT, service charge, discount, and grand total from a given base total.
- **processPayment**: The existing JavaScript function `processPayment()` in `cashier.js` that writes payment records and updates order statuses in Firestore.
- **selectedOrder**: The module-level variable in `cashier.js` that currently holds a single selected Slip object; this will be replaced by a selected group structure.
- **writeBatch**: The Firestore SDK v10 `writeBatch` function used for atomic multi-document writes.
- **cashier_preselect_order**: A `localStorage` key set by the admin "Send to Cashier" button, containing the Firestore document ID of a specific Slip to be pre-selected.
- **Takeout_Order**: A Slip whose `orderType` field is `'takeout'` or whose `tableNumber` field is absent/falsy.
- **Dine_In_Order**: A Slip that is not a Takeout_Order.

## Requirements

### Requirement 1: Table Group Construction

**User Story:** As a cashier, I want all unpaid order slips for the same dine-in table to be treated as one group, so that I see a single bill per table rather than multiple separate cards.

#### Acceptance Criteria

1. WHEN the Cashier_Queue is computed from `allOrders`, THE Cashier_Queue SHALL group all unpaid, non-cancelled Dine_In_Orders that share the same `tableNumber` into one Table_Group.
2. WHEN the Cashier_Queue is computed from `allOrders`, THE Cashier_Queue SHALL represent each Takeout_Order as its own individual entry, never merged with any other order.
3. WHEN a Table_Group contains exactly one Slip, THE Cashier_Queue SHALL treat that Slip as a Table_Group of size one and render it using the same Grouped_Card structure as multi-slip groups, with no visual distinction from multi-slip groups in the card layout or styling.
4. IF a `tableNumber` value is shared between a Dine_In_Order and any Takeout_Order, THEN THE Cashier_Queue SHALL exclude the Takeout_Order from that Table_Group and keep it as a separate individual entry.

---

### Requirement 2: Grouped Card Display

**User Story:** As a cashier, I want the grouped card to show a meaningful summary, so that I can quickly assess the combined bill for a table at a glance.

#### Acceptance Criteria

1. THE Grouped_Card SHALL display the `tableNumber` of the Table_Group as its location label.
2. THE Grouped_Card SHALL display the Combined_Total as the pre-tax base amount.
3. THE Grouped_Card SHALL display the total count of items across all Slips in the Table_Group.
4. THE Grouped_Card SHALL display an estimated grand total (Combined_Total with no discount, plus 12% VAT and 7% service charge) as a preview note, consistent with the existing card format.
5. WHERE a Table_Group contains more than one Slip, THE Grouped_Card SHALL display the number of constituent Slips (e.g., "2 slips").
6. THE Grouped_Card SHALL display the timestamp of the earliest `createdAt` among all Slips in the Table_Group.

---

### Requirement 3: Combined Detail Panel

**User Story:** As a cashier, I want clicking a grouped card to show all items from every slip merged into one list, so that I can review the complete order before processing payment.

#### Acceptance Criteria

1. WHEN a cashier selects a Grouped_Card, THE Detail_Panel SHALL display all items from all Slips in the Table_Group in a single merged item list.
2. WHEN a cashier selects a Grouped_Card, THE Detail_Panel SHALL use the Combined_Total as the subtotal base for all financial calculations.
3. WHEN a cashier selects a Grouped_Card containing more than one Slip, THE Detail_Panel SHALL display the individual Slip IDs (last 6 characters, uppercase) as a reference, and THE Detail_Panel SHALL not allow payment to proceed until those Slip IDs are successfully rendered.
4. WHEN a cashier selects a Grouped_Card, THE Detail_Panel SHALL display the `tableNumber` as the location identifier.
5. WHEN a cashier selects a Grouped_Card containing items with the same `name` from different Slips, THE Detail_Panel SHALL list those items as separate line entries (one per Slip), preserving per-slip item identity.

---

### Requirement 4: Discount Calculation on Grouped Receipt

**User Story:** As a cashier, I want the Senior Citizen and PWD discounts to apply correctly to a grouped table receipt, so that the discount is fair and legally compliant with Philippine regulations.

#### Acceptance Criteria

1. WHEN a discount of type `'senior'` or `'pwd'` is applied to a Table_Group, THE Discount_Calculation SHALL compute the discount amount as `Discount_Base × 0.20`, where `Discount_Base` is the `total` of the Highest_Value_Slip.
2. WHEN a discount of type `'senior'` or `'pwd'` is applied to a Table_Group, THE Discount_Calculation SHALL apply VAT exemption to the entire Combined_Total (not only to the Highest_Value_Slip).
3. WHEN a discount of type `'senior'` or `'pwd'` is applied to a Table_Group, THE Discount_Calculation SHALL subtract the discount amount from the Combined_Total to produce the after-discount amount used for service charge computation.
4. THE Cashier_Portal SHALL permit only one discount type per Table_Group payment — either `'none'`, `'senior'`, or `'pwd'`.
5. WHEN two or more Slips in a Table_Group share the same highest `total` value, THE Highest_Value_Slip selection SHALL use the Slip with the earliest `createdAt` timestamp as the tiebreaker.
6. WHEN no discount is applied (`discountType` is `'none'`), THE Discount_Calculation SHALL compute VAT and service charge on the Combined_Total using the standard `calculateFinancials` logic unchanged.
7. WHEN a discount of type `'senior'` or `'pwd'` is applied but the Discount_Base is zero (all Slips in the Table_Group have a `total` of zero), THE Discount_Calculation SHALL treat the operation as a no-discount calculation and proceed with the standard `calculateFinancials` logic on the Combined_Total.

---

### Requirement 5: Atomic Batch Payment

**User Story:** As a cashier, I want paying a grouped receipt to update all constituent slips in one atomic operation, so that there is never a partial-payment state in the database.

#### Acceptance Criteria

1. WHEN a cashier confirms payment for a Table_Group, THE Payment_Processor SHALL write exactly one payment document to the `payments` Firestore collection referencing all source Slip IDs in an `orderIds` array field.
2. WHEN a cashier confirms payment for a Table_Group, THE Payment_Processor SHALL update the `status` field of every Slip in the Table_Group atomically using `writeBatch`.
3. WHEN a Slip in the Table_Group has `served_unpaid` status at payment time, THE Payment_Processor SHALL set that Slip's status to `served_paid`.
4. WHEN a Slip in the Table_Group does not have `served_unpaid` status at payment time (i.e., it has not yet been served), THE Payment_Processor SHALL set that Slip's status to `paid_unserved`.
5. IF any write in the batch fails, THEN THE Payment_Processor SHALL abort the entire batch and display an error toast without partially updating any Slip or creating a dangling payment record.
6. WHEN the batch succeeds, THE Payment_Processor SHALL stamp `paidAt` with the server timestamp on each Slip that does not already have a `paidAt` value.
7. WHEN a cashier confirms payment for a Table_Group, THE Payment_Processor SHALL record `cashTendered`, `changeGiven`, `grandTotal`, `discountType`, `discountAmount`, `vatAmount`, `vatExempt`, `serviceCharge`, `subtotal`, `tableNumber`, `cashierId`, `cashierName`, and `paymentMethod` in the payment document.

---

### Requirement 6: Pre-selection Compatibility

**User Story:** As an admin, I want the "Send to Cashier" action to still auto-select the relevant table group on the cashier page, so that the cashier is directed to the right receipt even when multiple slips exist for that table.

#### Acceptance Criteria

1. WHEN the `cashier_preselect_order` key is present in `localStorage` on initial snapshot load, THE Cashier_Portal SHALL resolve the stored Slip ID to the Table_Group that contains that Slip.
2. WHEN the resolved Table_Group is found and belongs in the Cashier_Queue, THE Cashier_Portal SHALL select and display that Table_Group's Grouped_Card in the Detail_Panel automatically.
3. WHEN the `cashier_preselect_order` Slip ID does not match any Slip currently in the Cashier_Queue (e.g., already paid or cancelled), THE Cashier_Portal SHALL silently ignore the pre-selection and clear the `localStorage` key.
4. AFTER processing the pre-selection (whether resolved or not), THE Cashier_Portal SHALL remove the `cashier_preselect_order` key from `localStorage`.
5. WHEN the resolved Grouped_Card is selected via pre-selection, THE Cashier_Portal SHALL scroll the Grouped_Card into the visible area of the Cashier_Queue.

---

### Requirement 7: Queue Badge Count

**User Story:** As a cashier, I want the orders badge count to reflect the number of tables (groups) awaiting payment, so that the badge gives an accurate workload signal.

#### Acceptance Criteria

1. THE Orders_Badge SHALL display the count of distinct Table_Groups currently in the Cashier_Queue, not the count of individual Slips.
2. WHEN all Slips in a Table_Group are paid or cancelled, THE Orders_Badge SHALL decrement by one (the group is removed from the queue).

---

### Requirement 8: Search Compatibility

**User Story:** As a cashier, I want the order search to work against grouped cards, so that I can still find a table quickly by table number or waiter name.

#### Acceptance Criteria

1. WHEN a cashier enters a search term, THE Cashier_Queue SHALL filter Grouped_Cards by matching the search term against the `tableNumber` of the group.
2. WHEN a cashier enters a search term, THE Cashier_Queue SHALL include a Grouped_Card in results if the search term matches the `waiterName` of any Slip in that Table_Group.
3. WHEN a cashier enters a search term, THE Cashier_Queue SHALL include a Takeout_Order card in results if the search term matches `'takeout'` (regardless of whether the Slip has a `waiterName`), the individual Slip ID, or the `waiterName` of that Slip (preserving existing takeout search behavior).
