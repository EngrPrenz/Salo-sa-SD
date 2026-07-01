# Implementation Plan: Cashier Payment Interface

## Overview

This implementation plan breaks down the cashier payment interface feature into discrete coding tasks. The interface will be built using vanilla JavaScript (ES6 modules), HTML5, CSS3, and Firebase services (Authentication and Firestore), following the existing pattern used in the admin and waiter interfaces.

The implementation follows an incremental approach: set up authentication → build order display → implement payment processing → add receipt generation → integrate cash drawer management → add split payment support.

## Tasks

- [x] 1. Set up project structure and authentication
  - [x] 1.1 Create cashier login page and authentication flow
    - Create `cashier-login.html` with email/password form matching admin/waiter login design
    - Create `cashier-login.css` with styling consistent with existing login pages
    - Create `cashier-login.js` implementing authentication using Firebase Auth
    - Implement `authenticateCashier()` function with email/password validation
    - Add error handling for invalid credentials and display error messages
    - Implement session persistence using `browserLocalPersistence`
    - Add auto-redirect if user is already authenticated
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  
  - [ ]* 1.2 Write property test for authentication result validity
    - **Property 1: Authentication Result Validity**
    - **Validates: Requirements 1.2, 1.3**
    - Test that authentication either succeeds with valid credentials or fails with error message
    - Generate random credential combinations (valid/invalid)
    - Verify no access granted on authentication failure
  
  - [x] 1.3 Extend RBAC module to support cashier role
    - Modify `rbac.js` to add `cashier` role definition
    - Define cashier permissions: view orders, process payments, view payment history, manage shifts
    - Create `guardCashierPage()` function to protect cashier routes
    - Update Firestore security rules to allow cashiers to read orders and write payments
    - _Requirements: 9.5_

- [ ] 2. Create main cashier interface and order display
  - [x] 2.1 Build cashier interface HTML structure
    - Create `cashier.html` with header, navigation, order list area, and main content area
    - Create `cashier.css` with responsive layout (three-column desktop, two-column tablet, single-column mobile)
    - Add logout button in header
    - Implement theme support (light/dark mode) using CSS custom properties
    - Add restaurant branding consistent with existing interfaces
    - _Requirements: 1.4, 1.5, 9.6_
  
  - [~] 2.2 Implement order list component
    - Create `cashier.js` as main module
    - Implement `subscribeToOrders()` function with Firestore `onSnapshot` listener
    - Query orders collection with filter: `where('status', 'in', ['served', 'ready_for_payment'])`
    - Exclude orders with status 'paid' from results
    - Implement `renderOrderList()` function to display orders with ID, table number, total, timestamp
    - Add real-time list updates when new orders become available
    - Display "No orders ready for payment" message when list is empty
    - _Requirements: 2.1, 2.2, 2.3, 2.6_
  
  - [ ]* 2.3 Write property test for payment-ready order filtering
    - **Property 2: Payment-Ready Order Filtering**
    - **Validates: Requirements 2.1, 2.6**
    - Generate random collections of orders with various statuses
    - Verify only 'served' and 'ready_for_payment' orders appear in filtered results
    - Verify 'paid' orders are excluded
  
  - [~] 2.4 Implement order search functionality
    - Add search input field to order list section
    - Implement `filterOrders()` function to search by table number or order ID
    - Debounce search input with 300ms delay
    - Update displayed order list in real-time as user types
    - Highlight matching search terms in results
    - _Requirements: 2.5, 5.6_
  
  - [ ]* 2.5 Write property test for order search accuracy
    - **Property 4: Order Search Accuracy**
    - **Validates: Requirements 2.5, 5.6**
    - Generate random orders with various IDs and table numbers
    - Verify searching by order ID returns correct order
    - Verify searching by table number returns all orders for that table
  
  - [~] 2.6 Implement order details view
    - Create order details panel that displays when order is selected
    - Implement `selectOrder()` function to load and display full order details
    - Display all order items with names, quantities, individual prices
    - Show order notes/special instructions if present
    - Display waiter name and order timestamp
    - Calculate and display elapsed time since order creation
    - _Requirements: 2.4, 7.1, 7.3, 7.4, 7.5_
  
  - [ ]* 2.7 Write property test for order display completeness
    - **Property 3: Order Display Completeness**
    - **Validates: Requirements 2.2, 2.4, 7.1, 7.4, 7.5**
    - Generate random orders with various item counts and metadata
    - Verify all required fields are displayed (ID, table, items, total, waiter, timestamp)
  
  - [ ]* 2.8 Write property test for order notes display
    - **Property 18: Order Notes Display**
    - **Validates: Requirements 7.3**
    - Generate orders with and without notes
    - Verify notes are displayed when present
    - Verify UI handles orders without notes gracefully

- [~] 3. Checkpoint - Verify order display functionality
  - Ensure all tests pass, verify order list displays correctly, test search functionality, ask the user if questions arise.

- [ ] 4. Implement financial calculations and display
  - [~] 4.1 Create financial calculation utility functions
    - Implement `calculateReceiptTotals()` function
    - Calculate VAT-exclusive amount: `subtotal = total / 1.12`
    - Calculate VAT: `vat = total - subtotal`
    - Calculate service charge: `serviceCharge = total * 0.07`
    - Calculate grand total: `grandTotal = total + serviceCharge`
    - Export functions for reuse across components
    - _Requirements: 7.2_
  
  - [ ]* 4.2 Write property test for financial calculation consistency
    - **Property 19: Financial Calculation Consistency**
    - **Validates: Requirements 7.2**
    - Generate random order totals
    - Verify formula: subtotal = total / 1.12, vat = total - subtotal, serviceCharge = total * 0.07, grandTotal = total + serviceCharge
    - Test edge cases (very small and very large amounts)
  
  - [~] 4.3 Update order details view to show financial breakdown
    - Display subtotal (VAT-exclusive), VAT amount (12%), service charge (7%), and grand total
    - Format currency values with ₱ symbol and two decimal places
    - Clearly label each line item in the financial breakdown
    - _Requirements: 7.2_

- [ ] 5. Implement basic payment processing
  - [~] 5.1 Create payment form UI
    - Add payment method selection (Cash, Credit Card, Debit Card, GCash, PayMaya)
    - Add amount input field with numeric validation
    - Add confirm payment button
    - Display order grand total prominently
    - Show change calculation for cash payments
    - Style payment methods as large, touch-friendly buttons
    - _Requirements: 3.1, 3.2_
  
  - [~] 5.2 Implement payment validation
    - Create `validatePaymentAmount()` function
    - Check payment amount is numeric (not NaN)
    - Check payment amount is greater than zero
    - Check payment method is selected
    - Check payment amount is not less than order total
    - Display appropriate error messages for each validation failure
    - Prevent form submission if validation fails
    - _Requirements: 3.3, 3.7, 8.1, 8.2_
  
  - [ ]* 5.3 Write property test for payment amount validation
    - **Property 5: Payment Amount Validation**
    - **Validates: Requirements 3.3, 3.7, 8.2**
    - Generate random payment amounts (negative, zero, positive, non-numeric)
    - Generate random order totals
    - Verify payments with amount <= 0 are rejected
    - Verify payments with amount < order total are rejected
    - Verify non-numeric amounts are rejected
  
  - [~] 5.4 Implement change calculation
    - Create `calculateChange()` function
    - Calculate change as: `amountPaid - orderTotal`
    - Display change amount in real-time as user types payment amount
    - Only show change calculation for cash payments
    - Format change with currency symbol
    - _Requirements: 3.4_
  
  - [ ]* 5.5 Write property test for change calculation accuracy
    - **Property 6: Change Calculation Accuracy**
    - **Validates: Requirements 3.4**
    - Generate random cash payment amounts and order totals
    - Verify change = amountPaid - orderTotal for all valid inputs
    - Test edge case where payment exactly equals order total (change = 0)
  
  - [~] 5.6 Implement payment transaction processing
    - Create `processPayment()` async function
    - Use Firestore transaction to ensure atomicity
    - Step 1: Check order status is not already 'paid' (duplicate prevention)
    - Step 2: Create payment record in `payments` collection with all required fields
    - Step 3: Update order status to 'paid' and add `paidAt` and `paidBy` fields
    - Step 4: Update shift cash totals if payment method is cash
    - Generate unique transaction reference number (format: TXN-YYYYMMDD-XXX)
    - Handle transaction failures with rollback and error display
    - _Requirements: 3.5, 3.6, 8.3_
  
  - [ ]* 5.7 Write property test for payment persistence and status update
    - **Property 7: Payment Persistence and Status Update**
    - **Validates: Requirements 3.5, 3.6**
    - Generate random payment transactions
    - Verify payment record is created with all required fields (method, amount, timestamp, cashier ID)
    - Verify order status is updated to 'paid'
    - Verify both operations succeed or both fail (atomicity)
  
  - [ ]* 5.8 Write property test for duplicate payment prevention
    - **Property 20: Duplicate Payment Prevention**
    - **Validates: Requirements 8.5**
    - Generate orders that are already marked as 'paid'
    - Attempt to process payment for paid orders
    - Verify payment is rejected with appropriate message
  
  - [~] 5.9 Implement payment error handling and logging
    - Add try-catch blocks around payment processing
    - Log payment errors to console with timestamp, order ID, cashier ID, error details
    - Display user-friendly error messages for network errors, database failures
    - Maintain order as 'unpaid' if payment fails
    - Add retry functionality for failed payments
    - _Requirements: 8.3, 8.4, 8.6_

- [~] 6. Checkpoint - Verify basic payment processing
  - Ensure all tests pass, test payment validation, verify payment records are created, test error handling, ask the user if questions arise.

- [ ] 7. Implement receipt generation
  - [~] 7.1 Create receipt generator component
    - Create `generateReceipt()` function that returns formatted receipt object
    - Include restaurant name "Salo sa Antipolo" and address
    - Include order ID, table number, all items with quantities and prices
    - Include financial breakdown (subtotal, VAT, service charge, grand total)
    - Include payment method(s) and amounts
    - Include change given (for cash payments)
    - Include timestamp and waiter name
    - Include unique transaction reference number
    - _Requirements: 4.1, 4.2, 4.6_
  
  - [ ]* 7.2 Write property test for receipt generation completeness
    - **Property 8: Receipt Generation Completeness**
    - **Validates: Requirements 4.1, 4.2, 4.6**
    - Generate random completed payments
    - Verify receipt includes all required fields (restaurant info, order details, financial breakdown, payment info, transaction ref)
  
  - [~] 7.3 Implement receipt printing functionality
    - Create `printReceipt()` function that formats receipt for printing
    - Format receipt for 80mm thermal printer (48 characters width)
    - Use browser print API to send receipt to connected printer
    - Create print-specific CSS for receipt formatting
    - Show print dialog after successful payment
    - Handle printer not available errors gracefully
    - _Requirements: 4.3, 4.4_
  
  - [~] 7.4 Implement receipt reprinting
    - Add "Reprint" button in payment history for each payment
    - Load payment and order data from database when reprint is requested
    - Generate receipt with same transaction reference and original timestamp
    - Verify reprinted receipt has identical content to original
    - _Requirements: 4.5_
  
  - [ ]* 7.5 Write property test for receipt reprint idempotency
    - **Property 9: Receipt Reprint Idempotency**
    - **Validates: Requirements 4.5**
    - Generate random payment records
    - Generate receipt, then reprint receipt
    - Verify both receipts have identical transaction details

- [ ] 8. Implement payment history tracking
  - [~] 8.1 Create payment history component
    - Create payment history section in cashier interface
    - Implement `subscribeToShiftPayments()` function with Firestore listener
    - Query payments collection filtered by current shift ID
    - Display payment records with order ID, table number, amount, method, timestamp
    - Implement pagination (25 records per page)
    - Add lazy loading on scroll for performance
    - _Requirements: 5.1, 5.2_
  
  - [ ]* 8.2 Write property test for shift payment history filtering
    - **Property 10: Shift Payment History Filtering**
    - **Validates: Requirements 5.1**
    - Generate payments for multiple different shifts
    - Verify payment history only shows payments for current shift
  
  - [ ]* 8.3 Write property test for payment history display completeness
    - **Property 11: Payment History Display Completeness**
    - **Validates: Requirements 5.2**
    - Generate random payment records
    - Verify all required fields are displayed (order ID, table number, amount, method, timestamp)
  
  - [~] 8.4 Implement payment method filtering
    - Add filter dropdown for payment methods (All, Cash, Credit Card, Debit Card, GCash, PayMaya)
    - Create `filterByPaymentMethod()` function
    - Update displayed payment list when filter changes
    - Preserve filter selection across page refreshes
    - _Requirements: 5.5_
  
  - [ ]* 8.5 Write property test for payment method filtering
    - **Property 14: Payment Method Filtering**
    - **Validates: Requirements 5.5**
    - Generate random payment collections with various payment methods
    - For each payment method, verify filter returns only payments with that method
  
  - [~] 8.6 Implement shift total calculation
    - Create `calculateShiftTotal()` function to sum all payments in current shift
    - Display running total at top of payment history
    - Update total in real-time as new payments are processed
    - Break down total by payment method
    - _Requirements: 5.3_
  
  - [ ]* 8.7 Write property test for shift total calculation
    - **Property 12: Shift Total Calculation**
    - **Validates: Requirements 5.3**
    - Generate random sets of payments for a shift
    - Verify displayed total equals sum of all payment amounts
    - Test with various payment method combinations

- [ ] 9. Implement cash drawer management
  - [~] 9.1 Create cash drawer shift tracking
    - Create `startShift()` function to initialize new shift record
    - Prompt cashier for starting cash amount on login
    - Create shift record in `cashier_shifts` collection with starting amount and timestamp
    - Store shift ID in session storage for current session
    - Update user's `activeShiftId` field in Users collection
    - _Requirements: 10.1_
  
  - [~] 9.2 Implement cash payment tracking
    - Create `recordCashPayment()` function
    - Increment shift's `cashPayments` total when cash payment is processed
    - Add payment reference to shift record
    - Update shift's `transactionCount` and payment method breakdowns
    - _Requirements: 10.2_
  
  - [~] 9.3 Implement shift end and cash reconciliation
    - Create `endShift()` function
    - Calculate expected cash total: `startingAmount + cashPayments + sum(adjustments)`
    - Prompt cashier for actual cash count
    - Calculate variance: `actualCount - expectedTotal`
    - Update shift record with end time, actual count, and variance
    - Mark shift status as 'closed'
    - _Requirements: 10.3, 10.4_
  
  - [ ]* 9.4 Write property test for cash tracking and reconciliation
    - **Property 22: Cash Tracking and Reconciliation**
    - **Validates: Requirements 10.2, 10.3, 10.4**
    - Generate random shifts with starting amounts, cash payments, and adjustments
    - Verify expectedTotal = startingAmount + sum(cashPayments) + sum(adjustments)
    - Verify variance = actualCount - expectedTotal
  
  - [~] 9.5 Implement cash drawer adjustments
    - Create `recordAdjustment()` function
    - Add adjustment form with amount and reason code fields
    - Validate adjustment amount (can be positive or negative)
    - Require reason for all adjustments
    - Store adjustment in shift's adjustments array
    - Update expected total calculation
    - _Requirements: 10.6_
  
  - [ ]* 9.6 Write property test for cash drawer adjustment recording
    - **Property 23: Cash Drawer Adjustment Recording**
    - **Validates: Requirements 10.6**
    - Generate random adjustments with amounts and reasons
    - Verify adjustments are persisted with all required fields (amount, reason, timestamp)
  
  - [~] 9.7 Generate shift summary and reconciliation report
    - Create `generateShiftSummary()` function
    - Display shift summary on logout
    - Include: shift ID, cashier info, start/end times, transaction count, total collected
    - Include: starting amount, cash payments, adjustments, expected total, actual count, variance
    - Include: breakdown by payment method
    - Highlight variance if > 5% of expected total
    - Provide option to export report as PDF or print
    - _Requirements: 5.4, 10.5_
  
  - [ ]* 9.8 Write property test for reconciliation report completeness
    - **Property 24: Reconciliation Report Completeness**
    - **Validates: Requirements 10.5**
    - Generate random completed shifts
    - Verify report includes all required fields (starting amount, payments, adjustments, expected, actual, variance)

- [~] 10. Checkpoint - Verify cash drawer management
  - Ensure all tests pass, test shift start/end flow, verify cash tracking calculations, test adjustment recording, ask the user if questions arise.

- [ ] 11. Implement split payment functionality
  - [~] 11.1 Add split payment UI
    - Add "Split Payment" toggle button in payment form
    - Show multiple partial payment entry fields when split payment is enabled
    - Add "Add Another Payment" button to add more partial payments
    - Display remaining balance after each partial payment entry
    - Show all partial payments in summary before final confirmation
    - _Requirements: 6.1_
  
  - [~] 11.2 Implement split payment processing
    - Create `processSplitPayment()` async function
    - Generate unique split payment group ID
    - Use Firestore transaction for atomicity
    - Create separate payment record for each partial payment with shared group ID
    - Track total of partial payments
    - Update order status to 'paid' only when total partial payments >= order total
    - Prevent marking as paid if partial payments < order total
    - _Requirements: 6.2, 6.4, 6.6_
  
  - [ ]* 11.3 Write property test for split payment tracking integrity
    - **Property 15: Split Payment Tracking Integrity**
    - **Validates: Requirements 6.2, 6.5**
    - Generate random split payment transactions with 2-5 partial payments
    - Verify each partial payment is recorded with method and amount
    - Verify all partial payments share the same order ID and group ID
  
  - [~] 11.4 Implement split payment remaining balance calculation
    - Create `calculateRemainingBalance()` function
    - Calculate: `orderTotal - sum(partialPayments)`
    - Display remaining balance in real-time as partial payments are entered
    - Disable "Add Another Payment" button when remaining balance is zero
    - _Requirements: 6.3_
  
  - [ ]* 11.5 Write property test for split payment remaining balance
    - **Property 16: Split Payment Remaining Balance**
    - **Validates: Requirements 6.3**
    - Generate random order totals and partial payment sets
    - Verify remaining balance = orderTotal - sum(partialPayments)
  
  - [ ]* 11.6 Write property test for split payment completion
    - **Property 17: Split Payment Completion**
    - **Validates: Requirements 6.4, 6.6**
    - Generate split payments where sum equals order total
    - Verify order is marked as 'paid'
    - Generate split payments where sum is less than order total
    - Verify order is NOT marked as 'paid'
  
  - [~] 11.7 Update receipt generator for split payments
    - Modify `generateReceipt()` to handle multiple payment methods
    - Display each payment method and amount on separate lines
    - Show "Split Payment" label on receipt
    - Calculate total change across all cash partial payments
    - _Requirements: 6.5_

- [ ] 12. Integration and cross-interface synchronization
  - [~] 12.1 Verify real-time order status synchronization
    - Test that order status changes in cashier interface are reflected in admin dashboard
    - Test that order status changes in cashier interface are reflected in waiter interface
    - Verify Firestore onSnapshot listeners update all interfaces in real-time
    - _Requirements: 9.1, 9.2_
  
  - [~] 12.2 Ensure payment data compatibility with billing module
    - Verify payment records in `payments` collection include all fields needed for reports
    - Test that payment data can be queried by admin billing module
    - Ensure transaction reference numbers are unique and searchable
    - Verify payment method breakdown data is accessible for reporting
    - _Requirements: 9.4_
  
  - [~] 12.3 Verify database integration consistency
    - Confirm cashier interface reads orders from same `orders` collection as admin/waiter
    - Verify authentication uses same Firebase Auth configuration
    - Test that user roles are enforced correctly across all interfaces
    - _Requirements: 9.3, 9.5_

- [ ] 13. Implement network error handling and offline behavior
  - [~] 13.1 Add connection status monitoring
    - Implement Firestore connection state listener
    - Display persistent warning banner when connection is lost
    - Disable payment processing when offline
    - Show "Connection restored" toast when connection returns
    - _Requirements: 8.4_
  
  - [~] 13.2 Implement error recovery mechanisms
    - Add retry logic for failed Firestore operations (3 attempts with exponential backoff)
    - Store failed operations in sessionStorage for retry after reconnection
    - Provide manual retry button for failed payments
    - Display clear error messages for different failure types
    - _Requirements: 8.3_

- [ ] 14. Add responsive design and accessibility features
  - [~] 14.1 Implement responsive layout breakpoints
    - Desktop (≥1200px): Three-column layout
    - Tablet (768px-1199px): Two-column layout
    - Mobile (<768px): Single column with tabs
    - Test layout on various screen sizes
    - Ensure touch targets are minimum 44x44px on mobile
    - _Requirements: 9.6_
  
  - [~] 14.2 Add keyboard navigation and ARIA labels
    - Implement Tab navigation through all interactive elements
    - Add Enter key handler for payment form submission
    - Add Escape key handler for closing modals
    - Add ARIA labels to all form inputs
    - Add ARIA live regions for dynamic content updates
    - Test with screen reader
    - _Requirements: 9.6_
  
  - [~] 14.3 Ensure color contrast and visual accessibility
    - Verify color contrast ratio ≥ 4.5:1 for all text
    - Add focus indicators on all interactive elements
    - Use icon-text combinations (avoid icon-only buttons)
    - Test with browser zoom up to 200%
    - Associate error messages with form fields via aria-describedby
    - _Requirements: 9.6_

- [~] 15. Final checkpoint and integration testing
  - Ensure all tests pass, test complete payment workflows end-to-end, verify cross-interface synchronization, test error recovery scenarios, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP delivery
- Each task references specific requirements from requirements.md for traceability
- Property tests use fast-check library with minimum 100 iterations per test
- Implementation follows existing code patterns from admin and waiter interfaces
- All database operations use Firestore transactions where atomicity is required
- Authentication reuses existing Firebase Auth configuration
- Financial calculations follow Philippine tax structure (12% VAT, 7% service charge)
- Receipt format is optimized for 80mm thermal printers
- Real-time synchronization uses Firestore onSnapshot listeners
- Checkpoints ensure incremental validation and provide opportunities for user feedback

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.6"] },
    { "id": 4, "tasks": ["2.5", "2.7", "2.8", "4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.4"] },
    { "id": 7, "tasks": ["5.3", "5.5", "5.6"] },
    { "id": 8, "tasks": ["5.7", "5.8", "5.9"] },
    { "id": 9, "tasks": ["7.1"] },
    { "id": 10, "tasks": ["7.2", "7.3"] },
    { "id": 11, "tasks": ["7.4", "7.5", "8.1"] },
    { "id": 12, "tasks": ["8.2", "8.3", "8.4", "8.6"] },
    { "id": 13, "tasks": ["8.5", "8.7", "9.1"] },
    { "id": 14, "tasks": ["9.2"] },
    { "id": 15, "tasks": ["9.3", "9.5"] },
    { "id": 16, "tasks": ["9.4", "9.6", "9.7"] },
    { "id": 17, "tasks": ["9.8", "11.1"] },
    { "id": 18, "tasks": ["11.2", "11.4"] },
    { "id": 19, "tasks": ["11.3", "11.5", "11.6"] },
    { "id": 20, "tasks": ["11.7", "12.1"] },
    { "id": 21, "tasks": ["12.2", "12.3", "13.1"] },
    { "id": 22, "tasks": ["13.2", "14.1"] },
    { "id": 23, "tasks": ["14.2", "14.3"] }
  ]
}
```
