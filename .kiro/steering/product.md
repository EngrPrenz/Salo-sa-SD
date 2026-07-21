# Product

**Salo sa Antipolo** is a web-based restaurant operations system for a Filipino
dine-in and takeout restaurant. It ties together three front-of-house roles
around a single shared order stream backed by Firebase.

## Portals

- **Waiter portal** (`waiter.html`) — Take dine-in and takeout orders, select and
  occupy tables, browse the menu by category, and submit orders. Includes
  time-windowed items (e.g. Bento available 11:00 AM–3:00 PM only).
- **Cashier portal** (`cashier.html`) — Process payments for submitted orders,
  apply Senior/PWD discounts, compute VAT and service charge, handle cash/other
  payment methods, and record payment history.
- **Admin portal** (`admin-html/*.html`) — Management dashboard covering Overview,
  Live Orders, Tables, Menu, Billing, Staff, and Reports. Access to each page is
  gated by role.

## Roles

Roles are stored on each user's Firestore `Users` document (`role` field):

- `admin_manager` (and legacy `admin`) — full admin access
- `admin_owner` — full access except Live Orders
- `admin_cashier` — Overview (revenue hidden), Orders, and Billing only
- `cashier` — dedicated cashier portal
- `waiter` — waiter portal only

Waiter accounts self-register and require admin approval (`status`:
`pending` / `rejected` / active).

## Domain rules

- Financial constants: VAT 12%, service charge 7%, Senior & PWD discounts 20%.
- All currency and date/time formatting targets the Philippines (`en-PH`, PHP).
