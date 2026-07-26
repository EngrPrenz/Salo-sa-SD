# Requirements Document

## Introduction

The Live Orders page (`admin-html/admin-orders.html`) currently includes a "Receipt" modal and a matching print window. Both display financial details intended for the customer or cashier (VAT-excl. amount, VAT at 12%, service charge at 7%, grand total in PHP, and discount lines). Kitchen staff who view or print from this modal do not need that financial breakdown — they need to know *what* to cook, *how many*, and *for which table and waiter*.

This feature replaces the Receipt modal and its associated print window with a **Kitchen Slip** modal. The new modal retains all operationally relevant information (order identity, table, waiter, timestamp, and the full item list with quantities) while removing every financial line. The "Print" button opens a clean, printer-friendly kitchen slip instead of a customer receipt.

The change is confined to `admin-html/admin-orders.html` and `admin-js/admin-orders.js`. No other portal (cashier, waiter) is affected.

---

## Glossary

- **Kitchen_Slip_Modal**: The on-screen modal that replaces the former Receipt modal. Accessible via the "Kitchen Slip" button on each order card.
- **Kitchen_Slip_Print_Window**: The pop-up print window opened by the "Print" button inside the Kitchen Slip modal. Contains no financial data.
- **Admin_Orders_Page**: The Live Orders admin page (`admin-html/admin-orders.html` + `admin-js/admin-orders.js`).
- **Order_Card**: A card rendered in the orders grid representing one live order.
- **New_Items_Flag**: The green "New items" badge displayed on Order_Cards when a waiter has added more items to an already-served order.
- **Order_ID**: The Firestore document ID, displayed as the last 5 characters in uppercase (e.g. `#A1B2C`).

---

## Requirements

### Requirement 1: Replace "Receipt" with "Kitchen Slip" in the modal

**User Story:** As a kitchen staff member or admin, I want the modal triggered from the Live Orders page to show only kitchen-relevant information, so that I can quickly read what to prepare without being distracted by financial figures.

#### Acceptance Criteria

1. WHEN a user clicks the "Kitchen Slip" button on an Order_Card, THE Admin_Orders_Page SHALL open a modal whose visible heading is "Kitchen Slip", and no heading or title reading "Receipt" SHALL be present anywhere in the modal.
2. WHEN the Kitchen_Slip_Modal is open, THE Admin_Orders_Page SHALL display the Order_ID, the order timestamp formatted as a full date and time in the `en-PH` locale, the table number, and the waiter name.
3. WHEN the Kitchen_Slip_Modal is open, THE Admin_Orders_Page SHALL display each ordered item showing only its name and quantity; no per-item price column SHALL be present.
4. WHEN the Kitchen_Slip_Modal is open, THE Admin_Orders_Page SHALL NOT display any monetary value, including per-item prices, VAT-excl. amount, VAT (12%), service charge (7%), discount amounts, or grand total.
5. THE Kitchen_Slip_Modal SHALL contain a "Print" button that opens the Kitchen_Slip_Print_Window and a "Close" button that dismisses the modal; no other primary actions SHALL be present.

---

### Requirement 2: Rename the trigger button on each Order Card

**User Story:** As an admin user, I want the button that opens the slip to be labelled consistently with the new modal name, so that the UI is self-explanatory for kitchen use.

#### Acceptance Criteria

1. THE Admin_Orders_Page SHALL render a button labelled "Kitchen Slip" on every Order_Card whose status is not `cancelled`; no button labelled "Receipt" SHALL appear on any Order_Card.
2. IF an Order_Card has status `cancelled`, THEN THE Admin_Orders_Page SHALL NOT render a "Kitchen Slip" button on that card.
3. THE Kitchen_Slip_Modal SHALL display the heading "Kitchen Slip"; the text "Receipt" SHALL NOT appear as a heading or title within the modal.

---

### Requirement 3: Kitchen Slip print window contains no financial data

**User Story:** As a kitchen staff member, I want a printed kitchen slip that shows only what needs to be cooked, so that I can pin it at a kitchen station without exposing financial information.

#### Acceptance Criteria

1. WHEN the "Print" button inside the Kitchen_Slip_Modal is clicked, THE Admin_Orders_Page SHALL open the Kitchen_Slip_Print_Window containing: the restaurant name, Order_ID, order timestamp formatted as a full date and time in the `en-PH` locale, table number, and waiter name.
2. WHEN the Kitchen_Slip_Print_Window is rendered, THE Kitchen_Slip_Print_Window SHALL display each ordered item showing its name, quantity, and any item-level notes or modifiers if present; no price column SHALL be shown.
3. WHEN the Kitchen_Slip_Print_Window is rendered, THE Kitchen_Slip_Print_Window SHALL NOT include any monetary values, VAT lines, service charge lines, discount lines, subtotals, or grand totals.
4. WHEN the Kitchen_Slip_Print_Window is rendered, THE Admin_Orders_Page SHALL automatically trigger the browser print dialog once all slip content has been rendered in the window.
5. IF the pop-up window cannot be opened (e.g. blocked by the browser), THEN THE Admin_Orders_Page SHALL display a toast message instructing the user to allow pop-ups.
6. IF the order data passed to the print function has an empty item list or is missing the Order_ID or table number, THEN THE Admin_Orders_Page SHALL NOT open the Kitchen_Slip_Print_Window and SHALL instead display an error toast indicating the slip cannot be printed.

---

### Requirement 4: New-items flag preserved in the Kitchen Slip

**User Story:** As a kitchen staff member, I want the Kitchen Slip to highlight items that were added in a re-order, so that I can immediately identify what still needs to be cooked on a partially-served ticket.

#### Acceptance Criteria

1. WHEN an order has a non-empty `newItems` array and the order status is neither `served_paid` nor `cancelled`, THE Kitchen_Slip_Modal SHALL display both (a) a pulsing "New items" badge in the modal header and (b) an announcement section listing each new item's name and quantity.
2. WHEN the Kitchen_Slip_Modal displays new items, THE Admin_Orders_Page SHALL render each new item row with a visible dot marker (•) prepended to the item name to distinguish it from previously ordered items.
3. WHEN the Kitchen_Slip_Print_Window is rendered for an order with a non-empty `newItems` array, THE Kitchen_Slip_Print_Window SHALL prefix each new item row with a "NEW" label so that printed copies clearly distinguish new items from the rest of the item list.

---

### Requirement 5: Modal and print window use kitchen-appropriate styling

**User Story:** As a kitchen staff member, I want the slip to be easy to read at a glance, so that I can act on orders quickly even in a busy environment.

#### Acceptance Criteria

1. THE Kitchen_Slip_Modal SHALL render item names at a minimum font size of 16px and quantities at a minimum font size of 14px.
2. THE Kitchen_Slip_Print_Window SHALL use a monospace or print-friendly font, black text on a white background, and SHALL NOT include any subtotal, VAT, service charge, discount, or grand total rows.
3. THE Kitchen_Slip_Print_Window SHALL include the fixed header text "KITCHEN SLIP" as its topmost visible heading so that printed copies are distinguishable from customer receipts.
4. WHERE the order has a special note (`note` field is non-empty), THE Kitchen_Slip_Modal AND THE Kitchen_Slip_Print_Window SHALL display the note in a visually separated block labelled "Note:", positioned after the item list, so that kitchen staff do not miss special instructions.

---

### Requirement 6: No regression to other page functionality

**User Story:** As an admin, I want all other order management actions on the Live Orders page to continue working after the modal rename, so that day-to-day operations are unaffected.

#### Acceptance Criteria

1. THE Admin_Orders_Page SHALL render Order_Cards with correct status badges, action buttons, tab counts, and real-time Firestore updates regardless of the Kitchen Slip changes.
2. THE Admin_Orders_Page SHALL support status transitions, cancellations, discount setting, and the "Send to Cashier" action, producing the same Firestore writes and UI feedback as before the Kitchen Slip changes.
3. THE Admin_Orders_Page SHALL display the New_Items_Flag badge and new-items announcement banner on applicable Order_Cards regardless of the Kitchen Slip changes.
