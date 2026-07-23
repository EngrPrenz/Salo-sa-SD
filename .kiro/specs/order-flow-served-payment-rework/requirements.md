# Requirements Document

## Introduction

This feature reworks the end-to-end order flow of the Salo sa Antipolo restaurant system so that preparation, serving, and payment behave as intended across the Waiter, Cashier, and Admin portals.

Today an order is created by the waiter with status `pending` and stays invisible to the kitchen workflow until an admin clicks a manual "Start Preparing" button in the Admin Live Orders page. That same manual step causes unpaid orders to disappear from the Cashier's pending list the moment preparation starts, because the Cashier only shows orders whose status is exactly `pending`. In addition, the system currently exposes two ways to act as a cashier: the dedicated Cashier portal (`cashier.html`) and a limited cashier experience embedded in the Admin pages (accessed via the `admin_cashier` role through Admin Orders and Admin Billing).

The rework standardizes the flow around the following intended behavior:

- A submitted order automatically enters preparation — no manual "Start Preparing" step.
- Preparation progress and payment are independent. An order is only Complete once it is both paid and served.
- The Cashier always sees every unpaid order until it is paid, regardless of preparation or serving progress.
- The dedicated Cashier portal (`cashier.html`) is the single cashier experience; the limited embedded Admin cashier view is removed.
- Waiters mark orders as served from a clickable order-slip panel on the Waiter portal.

This is a rework of the existing `dine-in-takeout-order-flow` spec and reuses its established patterns (`escapeHtml`, `rbac.js` guards, the toast pattern, and shared financial constants VAT 12%, service charge 7%, Senior/PWD 20%).

## Glossary

- **Waiter_Portal**: The web interface (`waiter.html` / `waiter.js`) used by staff with the `waiter` role to take orders and mark orders as served.
- **Cashier_Portal**: The dedicated payment interface (`cashier.html` / `cashier.js`) used to process payments and record payment history.
- **Admin_Portal**: The management dashboard (`admin-html/*.html`) whose pages are gated by role via `rbac.js`.
- **Admin_Live_Orders**: The Admin page (`admin-orders.html` / `admin-orders.js`) that displays the shared order stream and its status controls.
- **Order**: A document in the Firestore `orders` collection containing items, total, waiter identity, an optional table number, an order type, and a status.
- **Order_Status**: The single `status` field on an Order. Recognized values are `preparing`, `served_unpaid`, `paid_unserved`, `served_paid`, `completed`, and `cancelled`. The legacy value `pending` is recognized only for backward compatibility with pre-existing Orders.
- **Paid_Order**: An Order whose Order_Status is `paid_unserved`, `served_paid`, or `completed`.
- **Unpaid_Order**: An Order that is not a Paid_Order and is not `cancelled` (i.e. Order_Status is `preparing`, `served_unpaid`, or the legacy `pending`).
- **Served_Order**: An Order whose Order_Status is `served_unpaid` or `served_paid`, or an Order that carries a recorded `servedAt` timestamp.
- **Complete_Order**: A dine-in Order that has been both paid and served, represented by Order_Status `served_paid` (which the system may subsequently archive as `completed`). A takeout Order requires no serving step and is considered complete once paid (Order_Status `completed`).
- **Order_Slip_Panel**: A panel on the right side of the Waiter_Portal that lists the current waiter's unserved active Orders (`preparing`/legacy `pending` and `paid_unserved`) as clickable order slips.
- **Served_Button**: A control on the Waiter_Portal Order_Slip_Panel that marks a selected Order as served.
- **Cashier_Pending_List**: The list of Unpaid_Orders shown in the Cashier_Portal for payment processing.
- **Start_Preparing_Control**: The existing manual "Start Preparing" button in Admin_Live_Orders that transitions an Order from `pending` to `preparing`.
- **Embedded_Admin_Cashier_View**: The limited cashier experience reachable through the Admin_Portal by the `admin_cashier` role, comprising the Admin Orders and Admin Billing pages used to act as a cashier.

## Requirements

### Requirement 1: Automatic Preparation on Submission

**User Story:** As a waiter, I want a submitted order to immediately enter preparation, so that the kitchen starts without waiting for a manual admin action.

#### Acceptance Criteria

1. WHEN the Waiter_Portal submits a new Order, THE Waiter_Portal SHALL set the Order_Status to `preparing` in the created Order document.
2. WHEN a new Order is created, THE Waiter_Portal SHALL record the `createdAt` timestamp and the `updatedAt` timestamp on the Order document.
3. WHEN a new Order is created, THE Waiter_Portal SHALL include the waiter name, waiter identifier, order type, item list, and computed total in the Order document.
4. WHERE a new Order has order type `dine-in`, THE Waiter_Portal SHALL include the table number in the Order document.
5. WHERE a new Order has order type `takeout`, THE Waiter_Portal SHALL set the table number to null in the Order document.

### Requirement 2: Removal of the Manual Start Preparing Step

**User Story:** As an admin, I want the manual "Start Preparing" step removed, so that the order flow no longer depends on a manual transition.

#### Acceptance Criteria

1. THE Admin_Live_Orders SHALL omit the Start_Preparing_Control from every rendered Order card.
2. THE Admin_Live_Orders SHALL treat `preparing` as the initial Order_Status for newly submitted Orders.
3. WHERE a displayed Order carries the legacy Order_Status `pending`, THE Admin_Live_Orders SHALL offer a control on that Order to transition the Order to `preparing`.
4. THE Admin_Live_Orders SHALL preserve the existing transitions from `preparing` to `served_unpaid` and from `preparing` to `paid_unserved`.

### Requirement 3: Cashier Visibility of Unpaid Orders

**User Story:** As a cashier, I want every unpaid order to remain visible until it is paid, so that no order is lost from my queue when it enters preparation or is served.

#### Acceptance Criteria

1. WHILE an Order is an Unpaid_Order, THE Cashier_Portal SHALL display that Order in the Cashier_Pending_List.
2. WHEN an Order becomes a Paid_Order, THE Cashier_Portal SHALL remove that Order from the Cashier_Pending_List.
3. THE Cashier_Portal SHALL display an Unpaid_Order in the Cashier_Pending_List regardless of whether the Order_Status is `preparing`, `served_unpaid`, or the legacy `pending`.
4. THE Cashier_Portal SHALL exclude Orders with Order_Status `cancelled` from the Cashier_Pending_List.
5. WHEN the Cashier_Portal computes the count badge for pending payments, THE Cashier_Portal SHALL count the Orders present in the Cashier_Pending_List.

### Requirement 4: Payment Processing Outcome

**User Story:** As a cashier, I want processing a payment to correctly advance the order's status, so that the paid state reflects whether the order was already served.

#### Acceptance Criteria

1. WHEN the Cashier_Portal processes payment for a dine-in Order whose Order_Status is `served_unpaid`, THE Cashier_Portal SHALL set the Order_Status to `served_paid`.
2. WHEN the Cashier_Portal processes payment for a dine-in Unpaid_Order that is not a Served_Order, THE Cashier_Portal SHALL set the Order_Status to `paid_unserved`.
3. WHEN the Cashier_Portal processes a payment, THE Cashier_Portal SHALL record the `paidAt` timestamp on the Order document.
4. WHEN the Cashier_Portal processes a payment, THE Cashier_Portal SHALL create a payment record in the `payments` collection containing the cashier identity, the order identifier, and the collected amounts.
5. WHEN payment is submitted, THE Cashier_Portal SHALL re-check the current Order_Status immediately before finalizing the payment.
6. IF the selected Order is no longer an Unpaid_Order at the moment payment is finalized, THEN THE Cashier_Portal SHALL cancel the payment attempt and notify the cashier that the Order is no longer awaiting payment.
7. WHEN the Cashier_Portal processes payment for a takeout Order, THE Cashier_Portal SHALL set the Order_Status to `completed`, because a takeout Order requires no serving step.

### Requirement 5: Single Cashier Experience

**User Story:** As an owner, I want a single cashier experience, so that cashiering is standardized on the dedicated Cashier portal.

#### Acceptance Criteria

1. THE Admin_Portal SHALL omit the Embedded_Admin_Cashier_View from the Admin pages.
2. THE Cashier_Portal SHALL be the interface through which payments are processed.
3. WHEN a user with a cashier-designated role authenticates, THE Cashier_Portal SHALL grant access to the Cashier_Portal.
4. THE Admin_Portal SHALL continue to provide read-only visibility of Orders and payment history to admin management roles.

### Requirement 6: Waiter Order-Slip Panel

**User Story:** As a waiter, I want my active orders shown as clickable order slips on a side panel, so that I can review and act on the orders I am responsible for.

#### Acceptance Criteria

1. THE Waiter_Portal SHALL display an Order_Slip_Panel on the right side of the interface.
2. THE Order_Slip_Panel SHALL list the Orders belonging to the signed-in waiter that are not a Served_Order and not `completed` and not `cancelled` (i.e. `preparing`/legacy `pending` and `paid_unserved` Orders).
3. WHEN a new Order for the signed-in waiter is created, THE Order_Slip_Panel SHALL add a corresponding order slip.
4. WHEN an Order in the Order_Slip_Panel changes Order_Status, THE Order_Slip_Panel SHALL update the displayed status of that order slip.
5. WHEN a waiter selects an order slip, THE Waiter_Portal SHALL display the details of the selected Order.
6. THE Order_Slip_Panel SHALL escape Order-derived text before rendering it into the panel.
7. WHEN a waiter selects an order slip, THE Order_Slip_Panel SHALL provide a control to print a kitchen order slip for that Order showing the location, waiter, time, and items with quantities (no prices), suitable for saving as a PDF via the browser print dialog.

### Requirement 7: Waiter Served Action

**User Story:** As a waiter, I want to mark an order as served from its order slip, so that I record that the food has been delivered to the table.

#### Acceptance Criteria

1. WHERE a selected Order in the Order_Slip_Panel is not a Served_Order and is not `completed` or `cancelled` (i.e. `preparing`/legacy `pending` or `paid_unserved`), THE Waiter_Portal SHALL display the Served_Button for that Order.
2. WHEN the waiter activates the Served_Button for an Order whose Order_Status is `preparing` or the legacy `pending`, THE Waiter_Portal SHALL set the Order_Status to `served_unpaid`.
3. WHEN the waiter activates the Served_Button for an Order whose Order_Status is `paid_unserved`, THE Waiter_Portal SHALL set the Order_Status to `served_paid`.
4. WHEN the Waiter_Portal marks an Order as served, THE Waiter_Portal SHALL record the `servedAt` timestamp on the Order document.
5. WHERE a selected Order is already a Served_Order, THE Waiter_Portal SHALL omit the Served_Button for that Order.

### Requirement 8: Order Completion Rule

**User Story:** As an owner, I want an order to count as complete only when it is both paid and served, so that reporting and clearing reflect fully finished orders.

#### Acceptance Criteria

1. THE Waiter_Portal SHALL treat a dine-in Order as a Complete_Order only when the Order is both a Paid_Order and a Served_Order.
2. WHILE an Order is a Paid_Order that is not a Served_Order, THE Cashier_Portal SHALL classify the Order as `paid_unserved`.
3. WHILE an Order is a Served_Order that is not a Paid_Order, THE Cashier_Portal SHALL classify the Order as `served_unpaid`.
4. WHEN an Order becomes both paid and served, THE system SHALL classify the Order as `served_paid`.
5. IF a waiter attempts to mark an Order complete while the Order is an Unpaid_Order, THEN THE Waiter_Portal SHALL leave the Order as an Unpaid_Order that is served rather than completing the Order.
6. WHERE an Order is a takeout Order, THE system SHALL treat the Order as complete once it is paid, without requiring a Served_Order state, and SHALL set its Order_Status to `completed`.

### Requirement 9: Status Model Consistency

**User Story:** As a developer, I want all portals to share one status vocabulary, so that orders are never silently hidden or misclassified across the Waiter, Cashier, and Admin views.

#### Acceptance Criteria

1. THE Waiter_Portal, THE Cashier_Portal, and THE Admin_Live_Orders SHALL each recognize the Order_Status values `preparing`, `served_unpaid`, `paid_unserved`, `served_paid`, `completed`, and `cancelled`.
2. WHERE an Order carries an Order_Status value not in the recognized set, THE Admin_Live_Orders SHALL display that Order under an "Unrecognized Status" grouping rather than hiding the Order.
3. WHEN any portal records that an Order was paid, THE portal SHALL set the `paidAt` timestamp on the Order the first time payment is recorded.
4. WHEN any portal records that an Order was served, THE portal SHALL set the `servedAt` timestamp on the Order the first time serving is recorded.
5. THE Waiter_Portal, THE Cashier_Portal, and THE Admin_Live_Orders SHALL compute payable amounts using the shared financial constants VAT 12 percent, service charge 7 percent, and Senior and PWD discounts of 20 percent.
6. WHEN an Order with an unrecognized Order_Status is encountered, THE Admin_Live_Orders SHALL log a diagnostic message identifying the affected Order.
