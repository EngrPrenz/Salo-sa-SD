# Implementation Plan: Dine-In and Takeout Order Flow

## Overview

This implementation plan converts the dine-in and takeout order flow design into discrete coding tasks. The feature adds an "Order Now" button as the entry point, introduces an order type selection modal, and supports two distinct order workflows: dine-in (table selection → order taking → submit) and takeout (order taking → submit). The implementation leverages the existing waiter.js infrastructure and maintains visual consistency with the current dark theme and gold accent system.

## Tasks

- [x] 1. Set up project structure and core state management
  - Create new state variables for order type tracking
  - Add utility functions for state validation and reset
  - Define constants for order types ('dine-in', 'takeout')
  - _Requirements: 4.1, 4.2_

- [x] 2. Implement Order Now button and entry screen
  - [x] 2.1 Create Order Now button HTML structure in waiter.html
    - Add the order entry screen container with icon, title, subtitle, and button
    - Insert at the beginning of `#stepTables` section
    - Include Font Awesome icon reference for arrow
    - _Requirements: 1.1, 1.2_
  
  - [x] 2.2 Add CSS styling for Order Now button and entry screen
    - Implement full-height centered layout with flexbox
    - Style gold gradient button with hover effects matching existing buttons
    - Add fade-in animation on load
    - Ensure responsive behavior for mobile devices
    - _Requirements: 1.2, 7.3_
  
  - [x] 2.3 Wire Order Now button click handler in waiter.js
    - Implement `showOrderTypeModal()` function
    - Add click event listener to `#orderNowBtn`
    - Ensure modal displays correctly when clicked
    - _Requirements: 1.3_

- [x] 3. Implement Order Type Selection Modal
  - [x] 3.1 Create Order Type Selection Modal HTML structure
    - Add modal overlay with two option buttons (Dine In, Takeout)
    - Include modal header with title and close button
    - Add icons and descriptions for each option
    - Follow existing modal pattern structure
    - _Requirements: 1.4, 1.5_
  
  - [x] 3.2 Add CSS styling for Order Type Selection Modal
    - Style modal following existing `.modal-overlay` and `.modal` patterns
    - Create tappable order type buttons with hover effects
    - Implement responsive layout (horizontal on desktop, stacked on mobile)
    - Add scale transform and border color change on hover
    - _Requirements: 1.4_
  
  - [x] 3.3 Implement order type selection logic in waiter.js
    - Create `selectOrderType(type)` function that stores order type and navigates appropriately
    - Add click handlers for "Dine In" and "Takeout" buttons
    - Implement modal close functionality
    - Ensure modal closes after selection
    - _Requirements: 2.1, 3.1, 4.1_

- [x] 4. Implement dine-in order flow navigation
  - [x] 4.1 Implement dine-in navigation path
    - When "Dine In" is selected, show table selection step
    - Update step indicator to show all three pills
    - Maintain existing table selection functionality
    - _Requirements: 2.1, 2.2, 5.1_
  
  - [x] 4.2 Update table selection step for dine-in orders
    - Ensure table grid displays correctly
    - Verify table status indicators work properly
    - Maintain existing table click handlers
    - _Requirements: 2.2, 2.3_
  
  - [x] 4.3 Navigate from table selection to order taking for dine-in
    - Store selected table number in state
    - Display table number in order header
    - Proceed to order taking step after table selection
    - _Requirements: 2.3, 2.4, 7.2_

- [x] 5. Implement takeout order flow navigation
  - [x] 5.1 Implement takeout direct navigation function
    - Create `goToOrderDirect()` function that skips table selection
    - Set `selectedTable` to null for takeout orders
    - Display "Takeout Order" label in header
    - Update step pills appropriately
    - _Requirements: 3.1, 3.2, 7.1_
  
  - [x] 5.2 Update step indicator for takeout orders
    - Create `updateStepIndicator()` function to hide/show pills based on order type
    - Hide table selection pill for takeout orders
    - Show only two steps: Take Order → Submit
    - Add IDs to step arrows for dynamic visibility control
    - _Requirements: 3.2, 5.2_
  
  - [x] 5.3 Add visual indicators for takeout orders
    - Display "Takeout Order" badge in cart panel header
    - Apply distinct orange styling for takeout badge
    - Update `#selectedTableLabel` to show "Takeout Order"
    - _Requirements: 3.5, 7.1, 7.3_

- [x] 6. Modify order submission logic
  - [x] 6.1 Update order data structure construction
    - Add `orderType` field to order documents
    - Conditionally include `tableNumber` only for dine-in orders
    - Maintain all existing order fields (items, waiterName, waiterId, status, etc.)
    - _Requirements: 2.5, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [x] 6.2 Update table status logic for dine-in orders only
    - Conditionally update table status to "occupied" only when `orderType === 'dine-in'`
    - Skip table status update for takeout orders
    - Maintain waiter assignment for dine-in orders
    - _Requirements: 2.4_
  
  - [x] 6.3 Add order submission validation
    - Validate `currentOrderType` is set before submission
    - For dine-in orders, validate `selectedTable` is not null
    - Display error toast and prevent submission if validation fails
    - _Requirements: 6.3, 6.4_

- [ ]* 6.4 Write unit tests for order submission logic
  - Test dine-in order includes `orderType: 'dine-in'` and `tableNumber`
  - Test takeout order includes `orderType: 'takeout'` and omits `tableNumber`
  - Test validation prevents dine-in submission without table
  - Test validation prevents submission without order type
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Implement back navigation modifications
  - [x] 7.1 Update back navigation logic based on order type
    - Create `goBackFromOrder()` function with conditional logic
    - For takeout orders, return to order type selection modal
    - For dine-in orders, return to table selection (existing behavior)
    - _Requirements: 5.3, 5.4, 5.5_
  
  - [x] 7.2 Wire back button to new navigation logic
    - Update existing back button click handler
    - Ensure proper state preservation during navigation
    - Test navigation in both order flow types
    - _Requirements: 5.3, 5.4, 5.5_

- [x] 8. Implement order flow reset functionality
  - [x] 8.1 Create comprehensive reset function
    - Implement `resetOrderFlow()` function to clear all order state
    - Reset `currentOrderType`, `selectedTable`, and `cart` to initial values
    - Return UI to entry screen
    - Reset step indicator pills to initial state
    - _Requirements: 4.2, 4.3_
  
  - [x] 8.2 Integrate reset after successful order submission
    - Call `resetOrderFlow()` after showing success message
    - Add appropriate delay for user feedback
    - Ensure clean state for next order
    - _Requirements: 4.2_

- [x] 9. Update order confirmation modal
  - [x] 9.1 Add order type display to confirmation modal
    - Show "Table: [number]" for dine-in orders
    - Show "Order Type: Takeout" for takeout orders
    - Use appropriate icons for visual distinction
    - _Requirements: 7.4, 7.5_
  
  - [x] 9.2 Update confirmation modal body generation
    - Modify existing modal content generation to include order type info
    - Ensure formatting matches existing modal style
    - Test with both order types
    - _Requirements: 7.4, 7.5_

- [x] 10. Checkpoint - Ensure all core functionality works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Add responsive design improvements
  - [x] 11.1 Optimize for mobile and tablet devices
    - Ensure order type modal displays correctly on small screens
    - Make order type buttons easily tappable on touch screens
    - Verify step indicator adapts to smaller screens
    - Test text readability across viewport sizes
    - _Requirements: 1.4, 7.3_
  
  - [x] 11.2 Test browser compatibility
    - Test on Chrome/Edge (Chromium)
    - Test on Firefox
    - Test on Safari (macOS/iOS)
    - Verify modal animations work across browsers
    - _Requirements: 1.2, 1.4_

- [ ]* 11.3 Write integration tests for end-to-end flows
  - Test complete dine-in order flow (entry → dine-in selection → table selection → order → submit)
  - Test complete takeout order flow (entry → takeout selection → order → submit)
  - Test mixed order sequence (dine-in, takeout, dine-in)
  - Verify Firestore documents contain correct fields
  - Verify table status updates only for dine-in orders
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4_

- [x] 12. Implement error handling and edge cases
  - [x] 12.1 Add error handling for modal display failures
    - Log errors if modal elements don't exist
    - Show toast notification on modal failure
    - Fall back to direct table selection if needed
    - _Requirements: 1.3_
  
  - [x] 12.2 Handle browser refresh during order taking
    - Ensure clean state after refresh
    - Return user to entry screen safely
    - Document current behavior (no localStorage persistence)
    - _Requirements: 4.2_
  
  - [x] 12.3 Add state consistency validation
    - Validate state before navigation actions
    - Reset to known good state on inconsistency
    - Log errors for debugging
    - Guide user back to entry screen on errors
    - _Requirements: 4.1, 4.2_

- [ ]* 12.4 Write unit tests for error handling
  - Test modal close without selection returns to entry
  - Test submission with missing order type shows error
  - Test submission with missing table for dine-in shows error
  - Test state reset on validation failure
  - _Requirements: 4.1, 6.3, 6.4_

- [x] 13. Final checkpoint and documentation
  - [x] 13.1 Verify all requirements are met
    - Cross-check implementation against all acceptance criteria
    - Test all user stories end-to-end
    - Ensure no regressions in existing functionality
    - _Requirements: All_
  
  - [x] 13.2 Add code comments and documentation
    - Document new functions and their parameters
    - Add comments explaining order type logic
    - Update any existing documentation
    - _Requirements: All_

- [x] 14. Final testing and validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability using the format X.Y
- Checkpoints ensure incremental validation at key milestones
- The implementation builds on existing waiter.js infrastructure without requiring major refactoring
- Property-based tests are not applicable for this UI-focused feature with modal interactions and DOM manipulation
- Unit tests and integration tests validate specific examples, edge cases, and end-to-end workflows
- The design uses JavaScript, HTML, and CSS for the web interface implementation
- Testing focuses on manual testing checklists, unit tests for functions, and integration tests for workflows

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2"] },
    { "id": 3, "tasks": ["2.3", "3.3"] },
    { "id": 4, "tasks": ["4.1", "5.1"] },
    { "id": 5, "tasks": ["4.2", "5.2"] },
    { "id": 6, "tasks": ["4.3", "5.3"] },
    { "id": 7, "tasks": ["6.1", "7.1", "9.1"] },
    { "id": 8, "tasks": ["6.2", "7.2", "9.2"] },
    { "id": 9, "tasks": ["6.3", "8.1"] },
    { "id": 10, "tasks": ["6.4", "8.2"] },
    { "id": 11, "tasks": ["11.1"] },
    { "id": 12, "tasks": ["11.2", "11.3"] },
    { "id": 13, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 14, "tasks": ["12.4", "13.1"] },
    { "id": 15, "tasks": ["13.2"] }
  ]
}
```
