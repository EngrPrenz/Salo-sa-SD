# Requirements Document

## Introduction

This feature adds takeout ordering capability to the waiter interface of the Salo sa Antipolo restaurant ordering system. Currently, waiters can only take dine-in orders by first selecting a table, then ordering food. The new feature introduces an "Order Now" button that allows waiters to choose between "Dine In" and "Takeout" order types. Dine-in orders follow the existing table-selection flow, while takeout orders skip table selection and go directly to food ordering.

## Glossary

- **Waiter_Interface**: The web application interface used by restaurant staff with waiter role to manage orders
- **Order_Type_Selection_Modal**: A modal dialog that displays "Dine In" and "Takeout" options
- **Table_Selection_Step**: The first step in the current ordering workflow where the waiter chooses a table
- **Order_Taking_Step**: The step where the waiter selects menu items and builds an order
- **Cashier**: The destination system that receives completed orders for payment processing
- **Order_Now_Button**: A new button that initiates the order flow by presenting order type options

## Requirements

### Requirement 1: Order Type Selection Entry Point

**User Story:** As a waiter, I want to see an "Order Now" button at the start of my workflow, so that I can quickly initiate an order without first deciding on the order type.

#### Acceptance Criteria

1. WHEN the Waiter_Interface loads, THE Order_Now_Button SHALL be displayed before the table selection interface
2. THE Order_Now_Button SHALL be visually prominent and clearly labeled with text "Order Now"
3. WHEN the Order_Now_Button is clicked, THE Waiter_Interface SHALL display the Order_Type_Selection_Modal
4. THE Order_Type_Selection_Modal SHALL contain exactly two options labeled "Dine In" and "Takeout"
5. THE Order_Type_Selection_Modal SHALL include a close mechanism to cancel order initiation

### Requirement 2: Dine-In Order Flow

**User Story:** As a waiter, I want to select "Dine In" to follow the existing workflow, so that I can take orders for customers seated at tables.

#### Acceptance Criteria

1. WHEN the waiter selects "Dine In" from the Order_Type_Selection_Modal, THE Waiter_Interface SHALL navigate to the Table_Selection_Step
2. WHEN the Table_Selection_Step is displayed, THE Waiter_Interface SHALL show all available tables with their current status
3. WHEN a table is selected, THE Waiter_Interface SHALL navigate to the Order_Taking_Step
4. WHEN the order is completed, THE Waiter_Interface SHALL associate the table number with the order
5. WHEN the order is sent to the Cashier, THE order SHALL include the table number

### Requirement 3: Takeout Order Flow

**User Story:** As a waiter, I want to select "Takeout" to skip table selection, so that I can quickly take orders for customers who are not dining in.

#### Acceptance Criteria

1. WHEN the waiter selects "Takeout" from the Order_Type_Selection_Modal, THE Waiter_Interface SHALL navigate directly to the Order_Taking_Step
2. WHEN the Order_Taking_Step is displayed for takeout, THE Waiter_Interface SHALL omit table selection interface
3. WHEN the takeout order is completed, THE Waiter_Interface SHALL mark the order as takeout type
4. WHEN the takeout order is sent to the Cashier, THE order SHALL not include a table number
5. THE Waiter_Interface SHALL display a visual indicator that the current order is a takeout order throughout the Order_Taking_Step

### Requirement 4: Order Type Persistence

**User Story:** As a waiter, I want the system to remember my order type selection, so that I can complete the order without confusion about whether it is dine-in or takeout.

#### Acceptance Criteria

1. WHEN an order type is selected, THE Waiter_Interface SHALL store the order type in the active order session
2. WHILE the order is being taken, THE Waiter_Interface SHALL maintain the order type selection
3. WHEN the waiter navigates back from the Order_Taking_Step, THE Waiter_Interface SHALL preserve the order type selection
4. WHEN the order is submitted, THE Waiter_Interface SHALL include the order type in the order data

### Requirement 5: Navigation and Workflow Consistency

**User Story:** As a waiter, I want the order flow to remain consistent with the current interface, so that I can work efficiently without relearning the system.

#### Acceptance Criteria

1. WHEN taking a dine-in order, THE Waiter_Interface SHALL display the existing step indicator showing "Select Table → Take Order → Submit"
2. WHEN taking a takeout order, THE Waiter_Interface SHALL display a modified step indicator showing "Take Order → Submit"
3. WHEN the waiter clicks the back navigation, THE Waiter_Interface SHALL return to the appropriate previous step based on order type
4. WHEN a dine-in order back navigation is triggered from Order_Taking_Step, THE Waiter_Interface SHALL return to Table_Selection_Step
5. WHEN a takeout order back navigation is triggered from Order_Taking_Step, THE Waiter_Interface SHALL return to the Order_Type_Selection_Modal

### Requirement 6: Order Submission and Data Integrity

**User Story:** As a cashier, I want orders to include correct order type information, so that I can process dine-in and takeout orders appropriately.

#### Acceptance Criteria

1. WHEN a dine-in order is submitted, THE Waiter_Interface SHALL include the order type field with value "dine-in" in the order document
2. WHEN a takeout order is submitted, THE Waiter_Interface SHALL include the order type field with value "takeout" in the order document
3. WHEN a dine-in order is submitted, THE Waiter_Interface SHALL include the tableNumber field in the order document
4. WHEN a takeout order is submitted, THE Waiter_Interface SHALL omit the tableNumber field or set it to null in the order document
5. WHEN an order is submitted, THE Waiter_Interface SHALL include the waiter name and waiter ID in the order document

### Requirement 7: Visual Differentiation

**User Story:** As a waiter, I want to clearly see whether I am taking a dine-in or takeout order, so that I can avoid errors in order entry.

#### Acceptance Criteria

1. WHEN a takeout order is active, THE Waiter_Interface SHALL display "Takeout Order" label in the order header
2. WHEN a dine-in order is active, THE Waiter_Interface SHALL display the table number in the order header
3. THE takeout order label SHALL use a distinct visual style different from the table number display
4. WHEN the order confirmation modal is displayed, THE Waiter_Interface SHALL include the order type in the confirmation details
5. THE order confirmation modal SHALL display "Table: [number]" for dine-in orders and "Order Type: Takeout" for takeout orders
