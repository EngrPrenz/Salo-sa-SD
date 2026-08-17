# Requirements Document

## Introduction

The **Print Receipt** feature enables the cashier portal (`cashier.html` / `cashier.js`) of **Salo sa Antipolo** to automatically generate and print a formatted customer receipt immediately after a payment is confirmed. The receipt is produced using the browser's native print dialog via a detached popup window containing a print-optimised HTML layout. No new server-side component is required — all rendering and printing happens entirely client-side.

The feature covers two distinct receipt flows:
1. **Post-payment auto-print** — triggered automatically when `processPayment()` succeeds, showing full payment details (cash tendered, change).
2. **Manual re-print** — triggered on demand from the Billing view or from the detail panel before payment, allowing a preview or reprint at any time.

The receipt must faithfully reflect the financial breakdown already computed by the cashier portal: itemised order lines, VAT (12%), service charge (7%), Senior/PWD discounts (20%), grand total, and cash change. All monetary values use Philippine Peso formatting (`en-PH` locale, `₱` symbol).

---

## Glossary

- **Receipt_Generator**: The client-side subsystem within `cashier.js` responsible for composing and opening the print-ready HTML document.
- **Print_Window**: The browser popup (`window.open`) that hosts the receipt HTML and triggers `window.print()`.
- **Group**: One or more order slips belonging to the same table (dine-in) or a single takeout slip, combined for billing purposes.
- **Slip**: A single Firestore `orders` document representing one order submission by a waiter.
- **Financials**: The computed breakdown produced by `calculateGroupFinancials()` or `calculateFinancials()`: subtotal, discount amount, VAT amount, service charge, and grand total.
- **Cashier_Portal**: The `cashier.html` / `cashier.js` page used by the cashier role.
- **VAT**: Value-Added Tax at 12%, extracted from the price (inclusive pricing model).
- **Service_Charge**: 7% fee applied to the after-discount amount.
- **Senior_Discount / PWD_Discount**: 20% discount for Senior Citizens or Persons with Disability; also grants VAT exemption on the full combined total.
- **Highest_Value_Slip**: The slip within a Group with the greatest `total`; the discount base for Senior/PWD.
- **Logo**: The restaurant logo image at `image/logo.png`, embedded as a Base64 data URI so it renders in the isolated Print_Window.
- **Takeout**: An order where `orderType === 'takeout'` or no `tableNumber` is present.
- **Dine_In**: An order with a valid `tableNumber` that is not Takeout.

---

## Requirements

### Requirement 1: Auto-Print After Payment Confirmation

**User Story:** As a cashier, I want the receipt to print automatically after I confirm a payment, so that I can hand it to the customer without any extra steps.

#### Acceptance Criteria

1. WHEN `processPayment()` succeeds and all Firestore writes complete without error, THE Receipt_Generator SHALL open a Print_Window containing the completed receipt within 600 milliseconds.
2. WHEN the Print_Window opens, THE Receipt_Generator SHALL call `window.print()` on the Print_Window automatically without requiring any cashier interaction.
3. WHEN the auto-print is triggered, THE Receipt_Generator SHALL pass the confirmed Financials (including the actual cash tendered and change given) to the receipt template.
4. IF `window.open()` returns `null` (popup blocked), THEN THE Cashier_Portal SHALL display a toast notification reading "Allow popups to print receipts" and SHALL NOT attempt further print operations for that payment.
5. WHILE the payment batch commit is in progress, THE Receipt_Generator SHALL NOT open any Print_Window prematurely.

---

### Requirement 2: Receipt Content — Header

**User Story:** As a customer, I want the receipt to clearly identify the restaurant, so that I know where the receipt came from.

#### Acceptance Criteria

1. THE Receipt_Generator SHALL include the restaurant name "Salo sa Antipolo" in every receipt.
2. THE Receipt_Generator SHALL include the restaurant address "Sumulong Highway, Siete Media, Antipolo City, Rizal, Philippines, 1870" in every receipt.
3. WHERE the logo image at `image/logo.png` is accessible, THE Receipt_Generator SHALL embed the logo as a Base64 data URI and display it above the restaurant name.
4. IF the logo fetch fails for any reason, THEN THE Receipt_Generator SHALL render the receipt without the logo image and SHALL NOT display a broken-image placeholder.
5. THE Receipt_Generator SHALL include the social handle "@salosantipolo" in the receipt footer.

---

### Requirement 3: Receipt Content — Order Identification

**User Story:** As a cashier, I want each receipt to show the order's identifying details, so that disputes or re-prints can be traced back to the original transaction.

#### Acceptance Criteria

1. THE Receipt_Generator SHALL display the short Order ID (last 5 characters of the Firestore document ID, upper-cased) on every receipt.
2. WHEN the Group contains multiple slips, THE Receipt_Generator SHALL display the earliest slip's short ID as the primary Order ID.
3. THE Receipt_Generator SHALL display the order date and time formatted in `en-PH` locale with long month name, numeric day and year, 12-hour clock, and AM/PM indicator (e.g. "June 15, 2025, 02:30 PM").
4. WHEN the order is Dine_In, THE Receipt_Generator SHALL display the table number on the receipt.
5. WHEN the order is Takeout, THE Receipt_Generator SHALL display "🥡 Takeout" (with the emoji) in place of a table number.
6. THE Receipt_Generator SHALL display the waiter name(s) on the receipt; WHEN a Group has multiple slips with different waiters, THE Receipt_Generator SHALL display all distinct waiter names separated by a comma.
7. WHEN any slip in the Group has a non-empty `note` field, THE Receipt_Generator SHALL display the concatenated notes on the receipt.

---

### Requirement 4: Receipt Content — Itemised Order Lines

**User Story:** As a customer, I want to see exactly what I ordered with individual prices, so that I can verify I was charged correctly.

#### Acceptance Criteria

1. THE Receipt_Generator SHALL list every item across all slips in the Group as individual rows, each showing item name, quantity, and line total (unit price × quantity).
2. THE Receipt_Generator SHALL format each line-total amount using `en-PH` locale with a minimum of 2 decimal places and the `₱` prefix.
3. THE Receipt_Generator SHALL HTML-escape all item names before injecting them into the receipt template.
4. WHEN a Group contains multiple slips, THE Receipt_Generator SHALL combine (`flatMap`) all items from every slip into a single flat list for display; the receipt SHALL NOT show slip-level sub-groupings.

---

### Requirement 5: Receipt Content — Financial Breakdown

**User Story:** As a customer, I want the receipt to show a transparent financial breakdown including taxes and charges, so that I understand how the total was calculated.

#### Acceptance Criteria

1. THE Receipt_Generator SHALL display the VAT-exclusive subtotal (combined total of all slips before any charges) on the receipt.
2. WHEN a Senior_Discount or PWD_Discount is applied, THE Receipt_Generator SHALL display a discount line showing the discount type label ("Senior 20%" or "PWD 20%") and the discount amount prefixed with "−₱".
3. WHEN no discount is applied, THE Receipt_Generator SHALL display a VAT line showing "VAT (12%)" and the extracted VAT amount.
4. WHEN a Senior_Discount or PWD_Discount is applied (VAT exempt), THE Receipt_Generator SHALL display "VAT Exempt" with an amount of "₱0.00" in place of the VAT line.
5. THE Receipt_Generator SHALL display a service charge line showing "Service Charge (7%)" and the computed service charge amount.
6. THE Receipt_Generator SHALL display the grand total as the final line of the financial breakdown, clearly distinguished from the other rows (larger font or bold).
7. THE Receipt_Generator SHALL use the Financials object produced by `calculateGroupFinancials()` as the authoritative source for all monetary values on the receipt; THE Receipt_Generator SHALL NOT recompute totals independently.

---

### Requirement 6: Receipt Content — Payment Information

**User Story:** As a cashier, I want the receipt to show the cash tendered and change given, so that both the cashier and customer can confirm the transaction was settled correctly.

#### Acceptance Criteria

1. WHEN the cash tendered amount is greater than zero, THE Receipt_Generator SHALL display a "Cash Tendered" line with the amount on the receipt.
2. WHEN the cash tendered amount is greater than zero, THE Receipt_Generator SHALL display a "Change" line with the computed change amount on the receipt.
3. WHEN the receipt is a preview (printed before payment confirmation), THE Receipt_Generator SHALL omit the cash tendered and change sections from the receipt.
4. THE Receipt_Generator SHALL format cash tendered and change amounts using `en-PH` locale with a minimum of 2 decimal places and the `₱` prefix.

---

### Requirement 7: Receipt Layout and Print Formatting

**User Story:** As a cashier, I want the printed receipt to look like a standard thermal receipt, so that it fits standard receipt paper and is easy to read.

#### Acceptance Criteria

1. THE Receipt_Generator SHALL render the receipt in a monospace font (`Courier New`, monospace) to match thermal-printer output conventions.
2. THE Receipt_Generator SHALL apply `@media print` CSS rules so that print margins are removed and the layout fits standard 80 mm thermal receipt paper width.
3. THE Receipt_Generator SHALL open the Print_Window at a width of 400 px and height of 750 px.
4. THE Receipt_Generator SHALL include a separator line (solid `<hr>`) between the header and the order metadata block, and a dashed `<hr>` between the metadata block and the items table.
5. THE Receipt_Generator SHALL include a closing thank-you message reading "Thank you for dining with us! Please come again 🍽️" in the receipt footer.
6. THE Receipt_Generator SHALL set `<meta charset="UTF-8">` in the Print_Window document so that Philippine Peso symbols and emoji render correctly.

---

### Requirement 8: Manual Re-Print from Billing View

**User Story:** As a cashier, I want to reprint a receipt for any paid order from the Billing view, so that I can provide a duplicate if the customer misplaces theirs.

#### Acceptance Criteria

1. WHEN the cashier clicks the "Receipt" button for a paid order in the Billing view, THE Cashier_Portal SHALL display that order's receipt details in the detail panel.
2. WHEN the cashier clicks "Print Receipt" in the detail panel for a billing entry, THE Receipt_Generator SHALL open a Print_Window with the receipt for that individual order slip.
3. WHEN reprinting from billing, THE Receipt_Generator SHALL use the `discountType`, `cashTendered`, and `changeGiven` values stored on the Firestore order document rather than the current UI state.
4. THE Receipt_Generator SHALL HTML-escape all data-origin strings (waiter names, item names, notes) before injecting them into the Print_Window document.

---

### Requirement 9: Manual Pre-Payment Preview Print

**User Story:** As a cashier, I want to print a receipt preview before confirming payment, so that the customer can review the total before tendering cash.

#### Acceptance Criteria

1. WHEN the cashier clicks "Print Receipt" in the order detail panel before payment is confirmed, THE Receipt_Generator SHALL open a Print_Window with the current financial breakdown based on the selected discount type.
2. WHEN generating a preview receipt, THE Receipt_Generator SHALL omit the cash tendered and change sections.
3. WHEN generating a preview receipt, THE Receipt_Generator SHALL use the current `discountType` state from the UI to compute and display the correct financial breakdown.

---

### Requirement 10: Popup Permission Handling

**User Story:** As a cashier, I want a clear message when my browser blocks the print popup, so that I know to allow popups and can try again.

#### Acceptance Criteria

1. IF `window.open()` returns `null` for any print operation, THEN THE Cashier_Portal SHALL show a toast notification with the message "Allow popups to print receipts".
2. IF `window.open()` returns `null`, THEN THE Cashier_Portal SHALL NOT throw an uncaught JavaScript error.
3. THE Receipt_Generator SHALL check the return value of `window.open()` before writing any document content to the Print_Window.
