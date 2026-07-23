/**
 * rbac.js — Role-Based Access Control for Salo sa Antipolo
 *
 * Roles:
 *   admin_manager  — Full access except cannot touch CEO/managers on staff page
 *   admin_owner    — Almost full access; no Live Orders page
 *   admin_cashier  — Overview (revenue hidden) + Orders + Billing only
 *   admin (legacy) — treated as admin_manager
 *   waiter         — waiter portal only
 *   cashier        — dedicated cashier portal with payment processing
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FIRESTORE SECURITY RULES FOR CASHIER ROLE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * The following security rules should be applied in firestore.rules:
 *
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     
 *     // Helper function to get user role
 *     function getUserRole() {
 *       return get(/databases/$(database)/documents/Users/$(request.auth.uid)).data.role;
 *     }
 *     
 *     // Orders collection - cashiers can read to view payment-ready orders
 *     match /orders/{orderId} {
 *       allow read: if request.auth != null && 
 *         (getUserRole() == 'cashier' || 
 *          getUserRole() == 'admin_cashier' ||
 *          getUserRole() == 'admin_manager' ||
 *          getUserRole() == 'admin_owner' ||
 *          getUserRole() == 'waiter');
 *       
 *       // Cashiers can update order status to 'paid' and payment fields
 *       allow update: if request.auth != null && 
 *         (getUserRole() == 'cashier' || getUserRole() == 'admin_cashier') &&
 *         request.resource.data.diff(resource.data).affectedKeys()
 *           .hasOnly(['status', 'paidAt', 'paidBy', 'paymentStatus', 'updatedAt']);
 *     }
 *     
 *     // Payments collection - cashiers can create payment records
 *     match /payments/{paymentId} {
 *       allow read: if request.auth != null && 
 *         (getUserRole() == 'cashier' || 
 *          getUserRole() == 'admin_cashier' ||
 *          getUserRole() == 'admin_manager' ||
 *          getUserRole() == 'admin_owner');
 *       
 *       allow create: if request.auth != null && 
 *         (getUserRole() == 'cashier' || getUserRole() == 'admin_cashier') &&
 *         request.resource.data.cashierId == request.auth.uid;
 *     }
 *     
 *     // Cashier shifts collection - cashiers can manage their own shifts
 *     match /cashier_shifts/{shiftId} {
 *       allow read: if request.auth != null && 
 *         (getUserRole() == 'cashier' || 
 *          getUserRole() == 'admin_cashier' ||
 *          getUserRole() == 'admin_manager' ||
 *          getUserRole() == 'admin_owner');
 *       
 *       allow create: if request.auth != null && 
 *         (getUserRole() == 'cashier' || getUserRole() == 'admin_cashier') &&
 *         request.resource.data.cashierId == request.auth.uid;
 *       
 *       allow update: if request.auth != null && 
 *         (getUserRole() == 'cashier' || getUserRole() == 'admin_cashier') &&
 *         resource.data.cashierId == request.auth.uid;
 *     }
 *     
 *     // Users collection - cashiers can read their own profile
 *     match /Users/{userId} {
 *       allow read: if request.auth != null && request.auth.uid == userId;
 *     }
 *   }
 * }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const ROLES = {
  MANAGER:  'admin_manager',
  OWNER:    'admin_owner',
  CASHIER:  'admin_cashier',
  LEGACY:   'admin',
  WAITER:   'waiter',
  CASHIER_STANDALONE: 'cashier',  // Dedicated cashier portal role
};

// Pages each role may access (filenames relative to admin-html/)
const ROLE_PAGES = {
  admin_manager: [
    'admin-overview.html',
    'admin-orders.html',
    'admin-tables.html',
    'admin-menu.html',
    'admin-billing.html',
    'admin-staff.html',
    'admin-reports.html',
  ],
  admin: [   // legacy → identical to manager
    'admin-overview.html',
    'admin-orders.html',
    'admin-tables.html',
    'admin-menu.html',
    'admin-billing.html',
    'admin-staff.html',
    'admin-reports.html',
  ],
  admin_owner: [
    'admin-overview.html',
    // NO live-orders
    'admin-tables.html',
    'admin-menu.html',
    'admin-billing.html',
    'admin-staff.html',
    'admin-reports.html',
  ],
  admin_cashier: [
    // No embedded admin pages. admin_cashier reaches cashier.html
    // via guardCashierPage, not via ROLE_PAGES.
  ],
  cashier: [
    'cashier.html',  // Dedicated cashier interface
  ],
};

// Sidebar nav data-view keys each role sees
const NAV_ITEMS = {
  admin_manager: ['overview','orders','tables','menu','billing','staff','reports'],
  admin:         ['overview','orders','tables','menu','billing','staff','reports'],
  admin_owner:   ['overview','tables','menu','billing','staff','reports'],
};

// Default landing page after login
const DEFAULT_PAGE = {
  admin_manager: 'admin-overview.html',
  admin:         'admin-overview.html',
  admin_owner:   'admin-overview.html',
  admin_cashier: 'admin-overview.html',
  cashier:       'cashier.html',
};

export const ROLE_LABEL = {
  admin_manager: 'Manager',
  admin:         'Manager',
  admin_owner:   'Owner / CEO',
  admin_cashier: 'Cashier',
  waiter:        'Waiter',
  cashier:       'Cashier',
};

export const ROLE_BADGE_COLOR = {
  admin_manager: '#c9973a',
  admin:         '#c9973a',
  admin_owner:   '#9b59b6',
  admin_cashier: '#27ae60',
  cashier:       '#27ae60',
};

/** Returns true if `role` can view `pageFile`. */
export function canAccess(role, pageFile) {
  return (ROLE_PAGES[role] || []).includes(pageFile);
}

/** Returns the nav-view keys allowed for `role`. */
export function getAllowedNav(role) {
  return NAV_ITEMS[role] || [];
}

/** Returns the default landing page for `role`. */
export function getDefaultPage(role) {
  return DEFAULT_PAGE[role] || 'admin-overview.html';
}

/** Returns true if `role` is any recognised admin-tier role. */
export function isAdminRole(role) {
  return ['admin','admin_manager','admin_owner','admin_cashier'].includes(role);
}

/** Returns true if `role` is the standalone cashier role. */
export function isCashierRole(role) {
  return role === 'cashier';
}

/**
 * Cashier role permissions
 * Defines what actions/operations cashiers can perform
 */
export const CASHIER_PERMISSIONS = {
  viewOrders: true,
  processPayments: true,
  viewPaymentHistory: true,
  manageShifts: true,
  generateReceipts: true,
  viewOrderDetails: true,
  processSplitPayments: true,
  manageCashDrawer: true,
  // Restricted permissions
  modifyOrders: false,
  accessAdminPages: false,
  manageMenu: false,
  manageTables: false,
  manageStaff: false,
  viewReports: false,
};

/**
 * Guards every admin page.
 * - Redirects to login if not authenticated / wrong role.
 * - Redirects to default page if this page is forbidden for the role.
 * - Applies sidebar nav visibility.
 * - Populates name/avatar UI elements.
 * Returns resolved user data { uid, name, role, ... }.
 */
export async function guardAdminPage(auth, db, fb, currentPage) {
  return new Promise((resolve, reject) => {
    auth.onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = '../admin-login.html'; return; }
      try {
        const snap = await fb.getDoc(fb.doc(db, 'Users', user.uid));
        if (!snap.exists()) { window.location.href = '../admin-login.html'; return; }

        const data = snap.data();
        const role = data.role || '';

        if (!isAdminRole(role)) {
          await auth.signOut();
          window.location.href = '../admin-login.html';
          return;
        }

        if (currentPage && !canAccess(role, currentPage)) {
          window.location.href = getDefaultPage(role);
          return;
        }

        const name = data.name || user.email;
        _setText('userNameSidebar', name);
        _setText('topbarName', name);
        _setInitial('userAvatarSidebar', name);
        _setInitial('userAvatarTop', name);

        _applyRoleBadge(role);
        _applyNavVisibility(role);

        resolve({ uid: user.uid, name, role, ...data });
      } catch (err) {
        console.error('guardAdminPage:', err);
        window.location.href = '../admin-login.html';
      }
    });
  });
}

/**
 * Guards cashier pages.
 * - Redirects to cashier login if not authenticated / wrong role.
 * - Redirects to default page if this page is forbidden for the role.
 * - Populates name/avatar UI elements for cashier interface.
 * Returns resolved user data { uid, name, role, ... }.
 */
export async function guardCashierPage(auth, db, fb, currentPage) {
  return new Promise((resolve, reject) => {
    auth.onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = 'cashier-login.html'; return; }
      try {
        const snap = await fb.getDoc(fb.doc(db, 'Users', user.uid));
        if (!snap.exists()) { window.location.href = 'cashier-login.html'; return; }

        const data = snap.data();
        const role = data.role || '';

        // Only allow admin_cashier role
        if (role !== 'admin_cashier') {
          await auth.signOut();
          window.location.href = 'cashier-login.html';
          return;
        }

        // For cashier interface, don't redirect based on canAccess
        // The cashier should always stay on cashier.html

        const name = data.name || user.email;
        // Populate UI elements if they exist
        _setText('cashierName', name);
        _setText('cashierNameDisplay', name);
        _setInitial('cashierAvatar', name);

        _applyRoleBadge(role);

        resolve({ uid: user.uid, name, role, ...data });
      } catch (err) {
        console.error('guardCashierPage:', err);
        window.location.href = 'cashier-login.html';
      }
    });
  });
}

// ── Internals ──────────────────────────────────────────────────────────────────

function _setText(id, text) {
  const el = document.getElementById(id); if (el) el.textContent = text;
}
function _setInitial(id, name) {
  const el = document.getElementById(id); if (el) el.textContent = name[0].toUpperCase();
}

function _applyRoleBadge(role) {
  const roleEl = document.querySelector('.sidebar-user .user-role');
  if (!roleEl) return;
  roleEl.textContent = ROLE_LABEL[role] || 'Administrator';
  roleEl.style.color = ROLE_BADGE_COLOR[role] || '#c9973a';
}

function _applyNavVisibility(role) {
  const allowed = getAllowedNav(role);
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.style.display = allowed.includes(item.dataset.view) ? '' : 'none';
  });
  // Hide orphaned section labels
  document.querySelectorAll('.nav-section-label').forEach(label => {
    let next = label.nextElementSibling;
    let hasVisible = false;
    while (next && !next.classList.contains('nav-section-label')) {
      if (next.classList.contains('nav-item') && next.style.display !== 'none') {
        hasVisible = true; break;
      }
      next = next.nextElementSibling;
    }
    label.style.display = hasVisible ? '' : 'none';
  });
}
