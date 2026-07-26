# Design Document — admin-cashier-bypass

## Overview

The admin-cashier-bypass feature eliminates a redundant login step for
`admin_manager`, `admin_owner`, and legacy `admin` users when they click
"SEND TO CASHIER" from the Live Orders page. Today the button opens
`cashier-login.html` in a new tab, which forces a second authentication
even though the admin session already exists at a higher privilege level.

The change has three moving parts:
1. **`cashier-login.js`** — add a Bypass_Check that detects admin sessions
   and skips straight to `cashier.html`.
2. **`admin-js/rbac.js`** — widen `guardCashierPage` to accept admin roles.
3. **`admin-js/admin-orders.js`** — update `window._sendToCashier` to open
   `cashier.html` directly instead of `cashier-login.html`.

The existing `admin_cashier` login flow, the preselect-order token mechanism,
and all financial logic are preserved unchanged.

---

## Architecture

The system is a flat, page-oriented Vanilla JS + Firebase app with no build
step. All auth is handled client-side via Firebase Auth v10.12.0 with
Firestore role lookup. There is no server-side middleware — the bypass is a
purely client-side routing decision made during the `onAuthStateChanged`
callback.

```
admin-orders.html
  └─ admin-js/admin-orders.js
       └─ window._sendToCashier(orderId)
            │  localStorage.setItem('cashier_preselect_order', id)
            └─ window.open('cashier.html', '_blank')   ← NEW (was cashier-login.html)

cashier-login.html
  └─ cashier-login.js
       └─ onAuthStateChanged callback  ← MODIFIED
            │  No session     → show login form  (unchanged)
            │  admin_cashier  → redirect cashier.html  (unchanged)
            │  admin role     → write sessionStorage + redirect cashier.html  ← NEW
            └─ unknown role   → show login form  (unchanged)

cashier.html
  └─ cashier.js
       └─ guardCashierPage(auth, db, fb, 'cashier.html')  ← calls rbac.js
            └─ admin-js/rbac.js :: guardCashierPage  ← MODIFIED
                 │  admin_cashier → admit (unchanged)
                 │  admin roles   → admit + populate UI  ← NEW
                 └─ anything else → signOut + redirect cashier-login.html
```

The Firestore `Users` collection is the single source of truth for role
data. The client never trusts `sessionStorage` alone; `guardCashierPage` always
re-validates against Firestore on every page load.

---

## Components and Interfaces

### 1. `cashier-login.js` — Bypass_Check

**Change:** Extend the existing `onAuthStateChanged` handler to handle admin
roles before displaying the form.

Current flow (simplified):
```
onAuthStateChanged(user => {
  if (!user) return;
  if (role === 'admin_cashier') → redirect
})
```

New flow:
```
onAuthStateChanged(user => {
  if (!user) return;                           // show form (unchanged)
  if (role === 'admin_cashier') → redirect     // unchanged
  if (role in ADMIN_BYPASS_ROLES)              // NEW
    → write sessionStorage
    → redirect cashier.html
  // otherwise: show form (role unknown / waiter / etc.)
})
```

The `ADMIN_BYPASS_ROLES` set: `['admin_manager', 'admin_owner', 'admin']`.

A 10-second timeout wraps the Firestore `getDoc` call. If it rejects or
times out, the login form is shown and the Firebase Auth session is preserved
(not signed out).

**sessionStorage keys written for admin bypass:**
- `userRole` — the Firestore role string (e.g. `"admin_manager"`)
- `userName` — `data.name || user.email`
- `userId`   — `user.uid`

**Interface (exported, same as today):**
```js
export { authenticateCashier, showError, showToast };
```
No new exports are required. The Bypass_Check logic lives entirely inside the
`onAuthStateChanged` callback.

---

### 2. `admin-js/rbac.js` — `guardCashierPage`

**Change:** Expand the role admission check to include admin roles.

Current:
```js
if (role !== 'admin_cashier') {
  await auth.signOut();
  window.location.href = 'cashier-login.html';
  return;
}
```

New:
```js
const CASHIER_ALLOWED_ROLES = ['admin_cashier', 'admin_manager', 'admin_owner', 'admin'];

if (!CASHIER_ALLOWED_ROLES.includes(role)) {
  await auth.signOut();
  window.location.href = 'cashier-login.html';
  return;
}
```

The UI population block that follows (`_setText`, `_setInitial`) already uses
generic element IDs (`cashierName`, `cashierNameDisplay`, `cashierAvatar`) and
needs no structural change — the same code path runs for both `admin_cashier`
and admin role sessions.

The function signature is unchanged:
```js
export async function guardCashierPage(auth, db, fb, currentPage)
```

---

### 3. `admin-js/admin-orders.js` — `window._sendToCashier`

**Change:** Open `cashier.html` directly instead of `cashier-login.html`.

Current:
```js
window._sendToCashier = (id) => {
  localStorage.setItem('cashier_preselect_order', id);
  window.open('../cashier-login.html', '_blank');
};
```

New:
```js
window._sendToCashier = (id) => {
  localStorage.setItem('cashier_preselect_order', id);
  window.open('../cashier.html', '_blank');
};
```

The preselect token write (`localStorage.setItem`) is unchanged. The only
difference is the target URL.

> **Relative path note:** `admin-orders.js` lives under `admin-html/` at
> runtime, so `../cashier.html` correctly resolves to the root `cashier.html`.
> The existing `../cashier-login.html` used the same prefix, so this is a
> drop-in substitution.

---

## Data Models

No new Firestore collections or document fields are required.

### Existing Firestore `Users` document (unchanged)

```
Users/{uid}
  role   : string   — 'admin_manager' | 'admin_owner' | 'admin' |
                       'admin_cashier' | 'cashier' | 'waiter'
  name   : string   — display name
  status : string   — 'active' | 'pending' | 'rejected'
```

### sessionStorage keys (extended)

| Key        | Set by                  | Value                          |
|------------|-------------------------|--------------------------------|
| `userRole` | cashier-login.js bypass | Firestore role string          |
| `userName` | cashier-login.js bypass | `data.name \|\| user.email`    |
| `userId`   | cashier-login.js bypass | Firebase Auth UID              |

These keys were already written for `admin_cashier`; the bypass adds the same
write for admin roles.

### localStorage key (unchanged)

| Key                       | Set by               | Consumed by    |
|---------------------------|----------------------|----------------|
| `cashier_preselect_order` | admin-orders.js      | cashier.js     |

The token is written immediately before `window.open`, read on the first
Firestore snapshot in `cashier.js`, and deleted immediately after reading
regardless of whether a matching group is found.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all
valid executions of a system — essentially, a formal statement about what the
system should do. Properties serve as the bridge between human-readable
specifications and machine-verifiable correctness guarantees.*

---

### Property 1: Admin bypass writes sessionStorage and redirects

*For any* user whose Firestore `role` field is `admin_manager`, `admin_owner`,
or `admin`, when that user visits `cashier-login.html` with an active Firebase
session, the Bypass_Check SHALL write `userRole`, `userName`, and `userId` to
`sessionStorage` and redirect to `cashier.html` — without ever rendering the
login form.

**Validates: Requirements 1.1, 4.1**

---

### Property 2: Non-bypass roles are blocked at the login page

*For any* role string that is not in `{admin_manager, admin_owner, admin,
admin_cashier}` (e.g. `waiter`, empty string, unknown strings), when a user
with that role visits `cashier-login.html` with an active Firebase session, the
Bypass_Check SHALL NOT redirect to `cashier.html` AND SHALL leave the login
form visible.

**Validates: Requirements 1.4, 4.3, 4.5**

---

### Property 3: guardCashierPage admits all bypass-eligible roles

*For any* role in `{admin_manager, admin_owner, admin, admin_cashier}`, a call
to `guardCashierPage` with a Firestore document carrying that role SHALL
resolve with a user data object (not redirect to `cashier-login.html`).

**Validates: Requirements 1.6, 2.1, 5.5**

---

### Property 4: guardCashierPage rejects all other roles

*For any* role string not in `{admin_manager, admin_owner, admin,
admin_cashier, cashier}`, a call to `guardCashierPage` SHALL sign out the
session and redirect to `cashier-login.html`.

**Validates: Requirements 2.4**

---

### Property 5: User name is rendered correctly for any name string

*For any* non-empty name string resolved from Firestore, after
`guardCashierPage` resolves for an admin or cashier session, `#userName` in
the cashier UI SHALL contain the full name and `#userAvatar` SHALL contain the
uppercased first character of the name.

**Validates: Requirements 2.2**

---

### Property 6: _sendToCashier always writes the preselect token

*For any* order ID string passed to `window._sendToCashier`, the function
SHALL write exactly that value to `localStorage` under the key
`cashier_preselect_order` before opening the new tab.

**Validates: Requirements 3.1**

---

### Property 7: Preselect token is always cleared after first snapshot

*For any* value stored in `localStorage['cashier_preselect_order']` (matching
an existing group or not), after the first Firestore snapshot fires in
`cashier.js`, `localStorage.getItem('cashier_preselect_order')` SHALL be
`null`.

**Validates: Requirements 3.4, 3.5**

---

### Property 8: Matching preselect group is selected on first load

*For any* non-empty set of order groups where at least one group contains an
order with ID equal to the stored `cashier_preselect_order` token, after the
first Firestore snapshot, exactly that group SHALL be marked as `selectedGroup`
and its card SHALL have the `selected` CSS class.

**Validates: Requirements 3.2**

---

## Error Handling

### Firestore lookup timeout in Bypass_Check

The `getDoc` call inside `cashier-login.js`'s `onAuthStateChanged` is wrapped
in a `Promise.race` with a 10-second timeout sentinel:

```js
const BYPASS_TIMEOUT_MS = 10_000;

const snapPromise = getDoc(doc(db, 'Users', user.uid));
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('bypass_timeout')), BYPASS_TIMEOUT_MS)
);

try {
  const snap = await Promise.race([snapPromise, timeoutPromise]);
  // ... role check logic
} catch (err) {
  // Timeout or Firestore error — fall through and show login form.
  // Do NOT sign out; preserve the Firebase Auth session.
  console.warn('Bypass_Check failed, falling back to login form:', err.message);
}
```

The login form is already visible by default in the HTML (not hidden until JS
hides it). If the bypass fails, no JS action is needed to show it — the default
DOM state covers the fallback.

### guardCashierPage Firestore error

The existing `catch` block in `guardCashierPage` already redirects to
`cashier-login.html` on any Firestore error. This behaviour is preserved
unchanged and is correct for admin roles as well.

### Invalid/missing role field

If the `Users` document exists but the `role` field is absent, null, or an
unrecognised value, both the Bypass_Check and `guardCashierPage` treat it as
an unauthorised session. The Bypass_Check shows the login form; `guardCashierPage`
signs out and redirects.

### Stale preselect token

If `cashier_preselect_order` holds an order ID that no longer appears in any
unpaid group (order was paid, cancelled, or not yet replicated), `cashier.js`
clears the token immediately after reading and renders the full unpaid queue
with no group selected. No error message or toast is shown.

---

## Testing Strategy

This feature touches three files and is entirely client-side logic. The
testing approach uses property-based tests for the universal invariants and
example-based unit tests for specific flows and regressions.

### Property-Based Testing

**Library:** [fast-check](https://github.com/dubzzz/fast-check) — well-suited
for Vanilla JS projects; runs in Node without a build step.

**Minimum iterations:** 100 per property.

Each test is tagged with a comment in the format:
`// Feature: admin-cashier-bypass, Property N: <property text>`

**Properties to implement:**

| Test file | Property | fast-check arbitraries |
|-----------|----------|------------------------|
| `tests/bypass-check.test.js` | P1 — admin roles redirect + write sessionStorage | `fc.constantFrom('admin_manager', 'admin_owner', 'admin')` |
| `tests/bypass-check.test.js` | P2 — non-bypass roles blocked | `fc.string()` filtered to exclude bypass roles |
| `tests/rbac-guard.test.js`   | P3 — guardCashierPage admits all eligible roles | `fc.constantFrom('admin_manager', 'admin_owner', 'admin', 'admin_cashier')` |
| `tests/rbac-guard.test.js`   | P4 — guardCashierPage rejects all other roles | `fc.string()` filtered to exclude eligible roles |
| `tests/rbac-guard.test.js`   | P5 — name/avatar rendering | `fc.string({ minLength: 1 })` |
| `tests/send-to-cashier.test.js` | P6 — token always written | `fc.string({ minLength: 1 })` (any order ID) |
| `tests/cashier-preselect.test.js` | P7 — token always cleared | `fc.string({ minLength: 1 })` (any token value) |
| `tests/cashier-preselect.test.js` | P8 — matching group selected | generated group arrays with guaranteed match |

**Mocking strategy:** Firebase Auth and Firestore are mocked at the module
boundary. Tests pass in stub `auth` and `db` objects whose methods resolve
with controlled data. No live Firebase calls are made in tests.

### Example-Based Unit Tests

- **1.2 admin_cashier existing redirect** — verify the existing path is not
  broken.
- **1.3 no session shows form** — arrange `user = null`, assert form is
  visible and no redirect fires.
- **1.5 Firestore timeout** — simulate a `getDoc` that never resolves + 10s
  timer; assert login form shown, auth not signed out.
- **2.3 logout flow** — click logout, assert `signOut` called, sessionStorage
  cleared, redirect to `cashier-login.html`.
- **2.5 all payment ops available** — load cashier with admin role, assert
  discount buttons, cash input, and process payment button are present and
  not disabled/hidden.
- **3.3 no preselect token** — load with empty localStorage, assert no card
  selected and detail panel shows empty-selection prompt.
- **5.1–5.4 cashier login regression** — validate empty inputs, wrong
  password error, successful `admin_cashier` login, and form-submit behaviour
  are all unchanged.

### Integration Tests

- End-to-end flow: open `cashier-login.html` with a live test admin account,
  verify bypass redirects to `cashier.html` with the correct user name shown.
  Run with 1–2 representative admin roles (manager + owner) against the
  Firebase live project in a test browser session.

### What is NOT property-tested

- The DOM rendering of the full cashier order list (UI snapshot test territory)
- Firebase Auth state transitions (external service — example tests only)
- The Firestore security rules (infrastructure — verified via Firebase console
  or Emulator rules tests)
