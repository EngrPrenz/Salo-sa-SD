# Requirements Document

## Introduction

This feature allows admin-tier users (Manager and Owner roles) to access the
Cashier portal directly from the Live Orders page without needing to log in
again. Currently, clicking "Send to Cashier" on an order card opens a new tab
that redirects to `cashier-login.html`, forcing the admin to authenticate a
second time — even though the admin session already exists and carries a
higher-privilege role. The bypass eliminates that redundant login step by
detecting an active admin session and routing directly to `cashier.html`, while
preserving the existing pre-selection behaviour (the target order is
auto-highlighted in the cashier queue via `localStorage`).

## Glossary

- **Admin_Portal**: The set of pages under `admin-html/` accessed by
  `admin_manager`, `admin_owner`, and `admin_cashier` roles.
- **Cashier_Portal**: The `cashier.html` page that processes payments for
  unpaid orders.
- **Bypass_Check**: The logic, executed on `cashier-login.html` and
  `cashier.html`, that detects an active admin session and skips the
  login step.
- **guardCashierPage**: The existing RBAC guard function in `admin-js/rbac.js`
  that controls access to `cashier.html`.
- **Admin_Role**: Any of `admin_manager`, `admin_owner`, or the legacy `admin`
  role, as defined in `admin-js/rbac.js`.
- **Cashier_Role**: The `admin_cashier` standalone cashier role.
- **Eligible_Admin**: An authenticated user whose Firestore `Users` document
  carries an `Admin_Role`.
- **Send_To_Cashier_Button**: The "SEND TO CASHIER" action on order cards in
  `admin-html/admin-orders.html`, implemented via `window._sendToCashier` in
  `admin-js/admin-orders.js`.
- **Preselect_Token**: The order ID stored in `localStorage` under the key
  `cashier_preselect_order` so the Cashier_Portal can auto-select the
  relevant order group on load.

---

## Requirements

### Requirement 1: Admin Bypass on the Cashier Login Page

**User Story:** As a Manager or Owner, when the Cashier portal is opened from
the Live Orders page, I want to be taken directly into the cashier portal
without being asked for credentials, so that I can process a payment
immediately without interruption.

#### Acceptance Criteria

1. WHEN a user with role `admin_manager`, `admin_owner`, or `admin` (legacy)
   visits `cashier-login.html` while an active Firebase session exists, THE
   Bypass_Check SHALL write `userRole`, `userName`, and `userId` to
   `sessionStorage` and then redirect the browser to `cashier.html` without
   ever displaying the login form.

2. WHEN a user with role `admin_cashier` visits `cashier-login.html` while an
   active Firebase session exists, THE Bypass_Check SHALL redirect the browser
   to `cashier.html` (existing behaviour — unchanged).

3. WHEN a user visits `cashier-login.html` with no active Firebase session,
   THE Bypass_Check SHALL display the login form and require credential entry
   (existing behaviour — unchanged).

4. WHEN a user visits `cashier-login.html` with an active session whose role
   is not one of `admin_manager`, `admin_owner`, `admin`, or `admin_cashier`
   (e.g. `waiter`), THE Bypass_Check SHALL NOT redirect to `cashier.html`
   AND SHALL display the login form.

5. IF the Firestore `Users` document cannot be retrieved within 10 seconds
   during the Bypass_Check, THEN THE Bypass_Check SHALL allow the login form
   to render, SHALL preserve the Firebase Auth session, and SHALL NOT block
   the page indefinitely.

6. WHERE the Bypass_Check redirects a user with role `admin_manager`,
   `admin_owner`, or `admin` to `cashier.html`, THE `guardCashierPage`
   function in `rbac.js` SHALL admit those roles and resolve the user data
   object so the portal loads fully without bouncing back to
   `cashier-login.html`.

---

### Requirement 2: Cashier Portal Access for Eligible Admins

**User Story:** As a Manager or Owner, once bypassed into `cashier.html`, I
want the portal to remain accessible and functional for my entire session, so
that I can complete payment processing without being kicked out.

#### Acceptance Criteria

1. WHEN a user with role `admin_manager`, `admin_owner`, or `admin` (legacy)
   loads `cashier.html`, THE `guardCashierPage` function SHALL grant access
   and resolve the user data object for that session.

2. WHEN an Eligible_Admin is active in `cashier.html`, THE Cashier_Portal
   SHALL display the admin user's name in `#userName` and the first character
   of that name as the avatar initial in `#userAvatar`, using the same
   rendering logic already used for `admin_cashier` users.

3. WHEN an Eligible_Admin clicks "Logout" in `cashier.html`, THE
   Cashier_Portal SHALL call `firebase.auth().signOut()`, clear
   `sessionStorage`, and redirect to `cashier-login.html` (same behaviour
   as for `admin_cashier` users).

4. IF a user whose role is not one of `admin_manager`, `admin_owner`, `admin`,
   `admin_cashier`, or `cashier` attempts to load `cashier.html`, THEN THE
   `guardCashierPage` function SHALL sign out the session and redirect to
   `cashier-login.html`.

5. WHILE an Eligible_Admin session is active in `cashier.html`, THE
   Cashier_Portal SHALL make available the same payment processing operations
   accessible to `admin_cashier` users — view unpaid order groups, apply
   Senior/PWD discounts, enter cash tendered, select payment method, and
   finalise payment — with no feature hidden or disabled solely because the
   session role is an admin role rather than `admin_cashier`.

---

### Requirement 3: Preserve Order Pre-selection on Bypass

**User Story:** As a Manager or Owner, when I click "Send to Cashier" on a
specific order card, I want that order to be automatically selected in the
Cashier portal, so that I do not have to find it manually.

#### Acceptance Criteria

1. WHEN `window._sendToCashier` is called with an order ID, THE
   Send_To_Cashier_Button SHALL write that order ID to
   `localStorage` under the key `cashier_preselect_order` and then open
   `cashier.html` in a new browser tab.

2. WHEN `cashier.html` completes its first Firestore data load and a value
   is present in `localStorage['cashier_preselect_order']`, THE
   Cashier_Portal SHALL locate the unpaid order group that contains the
   stored order ID, mark that group's card as selected, open and populate
   the detail panel with that group's data, and scroll the card into view.

3. WHEN `cashier.html` loads and no value is present in
   `localStorage['cashier_preselect_order']`, THE Cashier_Portal SHALL
   display all unpaid order groups with no card selected, no detail panel
   open, and show the empty-selection prompt in the detail area.

4. IF the value in `localStorage['cashier_preselect_order']` is not present
   in any current unpaid, non-cancelled order group when the first Firestore
   data load completes, THEN THE Cashier_Portal SHALL clear the token and
   render the orders list as described in criterion 3, without showing an
   error message.

5. THE Cashier_Portal SHALL remove the value from
   `localStorage['cashier_preselect_order']` as the first action after
   reading it on the first Firestore data load, regardless of whether a
   matching group was found.

---

### Requirement 4: Role Hierarchy Enforcement

**User Story:** As a system administrator, I want the role hierarchy to be
enforced consistently so that only authorised roles can bypass cashier login,
and no lower-privilege role can exploit the bypass path.

#### Acceptance Criteria

1. IF a user's Firestore role field is `admin_manager`, `admin_owner`, or
   `admin` (legacy), THEN THE Bypass_Check SHALL grant bypass access and
   redirect to `cashier.html` after writing `sessionStorage`.

2. IF a user's Firestore role field is `admin_cashier`, THEN THE
   Bypass_Check SHALL NOT apply the admin bypass path; instead it SHALL
   redirect to `cashier.html` via the existing `Cashier_Role` redirect
   path unchanged.

3. IF a user's Firestore role field is `waiter`, THEN THE Bypass_Check
   SHALL NOT redirect to `cashier.html` AND SHALL display the login form.

4. IF no active Firebase Auth session exists, THEN THE Bypass_Check SHALL
   NOT redirect to `cashier.html` AND SHALL display the login form.

5. IF the Firestore `Users` document role field is absent, null, or an
   unrecognised value, THEN THE Bypass_Check SHALL treat the session as
   unauthorised AND SHALL display the login form without redirecting.

---

### Requirement 5: No Disruption to Existing Cashier Login Flow

**User Story:** As a Cashier (standalone `admin_cashier` role), I want my
existing login flow to continue working exactly as it does today, so that the
new bypass does not affect my ability to sign in.

#### Acceptance Criteria

1. THE `cashier-login.html` page SHALL continue to accept email and password
   credentials for `admin_cashier` users and submit them to Firebase
   Authentication (existing behaviour — unchanged).

2. WHEN an `admin_cashier` user successfully authenticates via the login
   form, THE Cashier_Portal SHALL redirect to `cashier.html`
   (existing behaviour — unchanged).

3. IF an `admin_cashier` user submits the login form with an empty email or
   password field, THEN THE `cashier-login.html` SHALL display a validation
   error and SHALL NOT attempt Firebase Authentication.

4. IF an `admin_cashier` user enters credentials that Firebase Authentication
   rejects (wrong password, user not found, or account disabled), THEN THE
   `cashier-login.html` SHALL display a descriptive error message identifying
   the failure category and SHALL NOT redirect.

5. THE `guardCashierPage` function SHALL continue to allow sessions with role
   `admin_cashier` to access `cashier.html` after this feature is
   implemented, with no change to the data resolved for that role.
