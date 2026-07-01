# Requirements Document

## Introduction

This document specifies requirements for a dedicated cashier payment interface for the Salo sa Antipolo restaurant management system. The cashier interface will provide a focused view for processing payments on orders, separate from the existing admin and waiter interfaces. The system will allow cashiers to view orders ready for payment, process different payment methods, generate receipts, and mark orders as paid.

## Glossary

- **Cashier_Interface**: The dedicated HTML page and associated functionality for cashier operations
- **Payment_Processor**: The component responsible for recording payment transactions
- **Order_Manager**: The system component that manages order status and lifecycle
- **Receipt_Generator**: The component that creates printable receipts for completed payments
- **Admin_Dashboard**: The existing administrative interface for restaurant management
- **Waiter_Interface**: The existing interface used by waiters to take and manage orders
- **Payment_Method**: The type of payment used (Cash, Credit Card, Debit Card, GCash, PayMaya)

## Requirements

### Requirement 1: Cashier Interface Access

**User Story:** As a cashier, I want to access a dedicated cashier interface, so that I can focus on payment processing without admin distractions

#### Acceptance Criteria

1. THE Cashier_Interface SHALL provide a login page separate from admin and waiter login
2. WHEN valid cashier credentials are provided, THE Cashier_Interface SHALL authenticate the user and display the main cashier view
3. WHEN invalid credentials are provided, THE Cashier_Interface SHALL display an error message and prevent access
4. THE Cashier_Interface SHALL display the restaurant branding consistent with existing interfaces
5. THE Cashier_Interface SHALL provide a logout button to end the cashier session

### Requirement 2: Order Display for Payment

**User Story:** As a cashier, I want to view all orders that are ready for payment, so that I can process customer transactions

#### Acceptance Criteria

1. THE Cashier_Interface SHALL display a list of all orders with status "served" or "ready for payment"
2. FOR EACH order displayed, THE Cashier_Interface SHALL show order ID, table number, total amount, and order timestamp
3. THE Cashier_Interface SHALL update the order list in real-time when new orders become ready for payment
4. WHEN an order is selected, THE Cashier_Interface SHALL display detailed order information including all items and prices
5. THE Cashier_Interface SHALL provide a search function to find orders by table number or order ID
6. THE Cashier_Interface SHALL filter out orders already marked as paid from the payment-ready list

### Requirement 3: Payment Processing

**User Story:** As a cashier, I want to process payments using various payment methods, so that I can complete customer transactions

#### Acceptance Criteria

1. WHEN a cashier selects an order for payment, THE Payment_Processor SHALL display available payment methods (Cash, Credit Card, Debit Card, GCash, PayMaya)
2. WHEN a payment method is selected, THE Payment_Processor SHALL allow the cashier to enter the payment amount
3. WHEN payment amount is less than order total, THE Payment_Processor SHALL display an error and prevent payment completion
4. WHEN payment amount equals or exceeds order total, THE Payment_Processor SHALL calculate and display change due for cash payments
5. WHEN payment is confirmed, THE Payment_Processor SHALL record the payment method, amount, timestamp, and cashier ID
6. WHEN payment is recorded, THE Order_Manager SHALL update the order status to "paid"
7. THE Payment_Processor SHALL validate that payment amount is a positive number

### Requirement 4: Receipt Generation

**User Story:** As a cashier, I want to generate and print receipts for paid orders, so that I can provide proof of payment to customers

#### Acceptance Criteria

1. WHEN an order payment is completed, THE Receipt_Generator SHALL automatically generate a receipt
2. THE Receipt_Generator SHALL include restaurant name, address, order ID, table number, order items with prices, subtotal, tax, total amount, payment method, amount paid, change given, and timestamp
3. THE Receipt_Generator SHALL format the receipt for standard receipt printer paper
4. THE Cashier_Interface SHALL provide a print button to send the receipt to the connected printer
5. THE Cashier_Interface SHALL allow reprinting of receipts for previously paid orders
6. THE Receipt_Generator SHALL include a transaction reference number on each receipt

### Requirement 5: Payment History Tracking

**User Story:** As a cashier, I want to view payment history, so that I can verify completed transactions during my shift

#### Acceptance Criteria

1. THE Cashier_Interface SHALL display a history of all payments processed during the current shift
2. FOR EACH payment in history, THE Cashier_Interface SHALL show order ID, table number, payment amount, payment method, and timestamp
3. THE Cashier_Interface SHALL calculate and display total payments collected during the current shift
4. WHEN a cashier logs out, THE Cashier_Interface SHALL generate a shift summary report showing total transactions and amount collected
5. THE Cashier_Interface SHALL allow filtering payment history by payment method
6. THE Cashier_Interface SHALL allow searching payment history by order ID or table number

### Requirement 6: Split Payment Support

**User Story:** As a cashier, I want to process split payments, so that I can accommodate customers who want to pay separately

#### Acceptance Criteria

1. WHEN a cashier selects split payment option, THE Payment_Processor SHALL allow multiple partial payments for a single order
2. THE Payment_Processor SHALL track each partial payment with its payment method and amount
3. THE Payment_Processor SHALL display remaining balance after each partial payment
4. WHEN total partial payments equal or exceed order total, THE Payment_Processor SHALL mark the order as fully paid
5. THE Receipt_Generator SHALL show all payment methods and amounts used when printing receipt for split payment
6. THE Payment_Processor SHALL prevent marking an order as paid if partial payments are less than order total

### Requirement 7: Order Details Display

**User Story:** As a cashier, I want to view complete order details before processing payment, so that I can verify the order with the customer

#### Acceptance Criteria

1. WHEN a cashier selects an order, THE Cashier_Interface SHALL display all order items with names, quantities, and individual prices
2. THE Cashier_Interface SHALL display order subtotal, tax amount, and grand total
3. WHEN an order has special instructions, THE Cashier_Interface SHALL display the order notes
4. THE Cashier_Interface SHALL display the waiter name who took the order
5. THE Cashier_Interface SHALL display the order timestamp and elapsed time since order creation
6. THE Cashier_Interface SHALL highlight any order modifications or special requests

### Requirement 8: Error Handling and Validation

**User Story:** As a cashier, I want the system to prevent invalid payment operations, so that I can avoid processing errors

#### Acceptance Criteria

1. WHEN a cashier attempts to process payment without selecting a payment method, THE Payment_Processor SHALL display an error message and prevent completion
2. WHEN a cashier enters non-numeric payment amount, THE Payment_Processor SHALL display an error message
3. WHEN payment processing fails, THE Payment_Processor SHALL display an error message and maintain order status as unpaid
4. WHEN network connection is lost, THE Cashier_Interface SHALL display a warning message
5. IF an order has already been paid by another cashier, THEN THE Payment_Processor SHALL prevent duplicate payment and display a notification
6. THE Payment_Processor SHALL log all payment errors with timestamp and error details

### Requirement 9: Integration with Existing System

**User Story:** As a system administrator, I want the cashier interface to integrate with existing order management, so that order status updates are reflected across all interfaces

#### Acceptance Criteria

1. WHEN an order status changes to "paid" in Cashier_Interface, THE Order_Manager SHALL update the status in the Admin_Dashboard
2. WHEN an order status changes to "paid", THE Order_Manager SHALL update the status visible in Waiter_Interface
3. THE Cashier_Interface SHALL retrieve order data from the same database used by Admin_Dashboard and Waiter_Interface
4. THE Payment_Processor SHALL store payment records in a format accessible to the billing and reporting modules
5. THE Cashier_Interface SHALL use the same authentication mechanism as existing interfaces
6. THE Cashier_Interface SHALL maintain consistent styling and theming with existing interfaces (light/dark mode support)

### Requirement 10: Cash Drawer Management

**User Story:** As a cashier, I want to track cash drawer operations, so that I can maintain accurate cash handling records

#### Acceptance Criteria

1. WHEN a cashier logs in, THE Cashier_Interface SHALL prompt for starting cash amount in drawer
2. THE Cashier_Interface SHALL track all cash payments received during the shift
3. THE Cashier_Interface SHALL calculate expected cash in drawer based on starting amount and cash payments
4. WHEN a cashier logs out, THE Cashier_Interface SHALL prompt for actual cash count and calculate variance
5. THE Cashier_Interface SHALL generate a cash drawer reconciliation report showing starting amount, payments received, expected total, actual count, and variance
6. THE Cashier_Interface SHALL allow recording of cash drawer adjustments with reason codes
