/**
 * rbac.js — Role-Based Access Control for Salo sa Antipolo
 *
 * Roles:
 *   admin_manager  — Full access except cannot touch CEO/managers on staff page
 *   admin_owner    — Almost full access; no Live Orders page
 *   admin_cashier  — Overview (revenue hidden) + Orders + Billing only
 *   admin (legacy) — treated as admin_manager
 *   waiter         — waiter portal only
 */

export const ROLES = {
  MANAGER:  'admin_manager',
  OWNER:    'admin_owner',
  CASHIER:  'admin_cashier',
  LEGACY:   'admin',
  WAITER:   'waiter',
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
    'admin-overview.html',
    'admin-orders.html',
    // NO tables, menu, staff
    'admin-billing.html',
    // NO reports
  ],
};

// Sidebar nav data-view keys each role sees
const NAV_ITEMS = {
  admin_manager: ['overview','orders','tables','menu','billing','staff','reports'],
  admin:         ['overview','orders','tables','menu','billing','staff','reports'],
  admin_owner:   ['overview','tables','menu','billing','staff','reports'],
  admin_cashier: ['overview','orders','billing'],
};

// Default landing page after login
const DEFAULT_PAGE = {
  admin_manager: 'admin-overview.html',
  admin:         'admin-overview.html',
  admin_owner:   'admin-overview.html',
  admin_cashier: 'admin-overview.html',
};

export const ROLE_LABEL = {
  admin_manager: 'Manager',
  admin:         'Manager',
  admin_owner:   'Owner / CEO',
  admin_cashier: 'Cashier',
  waiter:        'Waiter',
};

export const ROLE_BADGE_COLOR = {
  admin_manager: '#c9973a',
  admin:         '#c9973a',
  admin_owner:   '#9b59b6',
  admin_cashier: '#27ae60',
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
