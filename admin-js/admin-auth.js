/**
 * admin-auth.js
 * Shared bootstrap called at the top of every admin page JS.
 *
 * Usage:
 *   import { bootstrapAdmin } from './admin-auth.js';
 *   const user = await bootstrapAdmin(auth, db, { doc, getDoc, signOut }, 'admin-orders.html');
 *
 * Returns the resolved user object { uid, name, role, ... }.
 */
import { guardAdminPage } from './rbac.js';

/** Hide the full-page loader overlay after auth resolves. */
function hidePageLoader() {
  const loader = document.getElementById('pageLoader');
  if (loader) loader.classList.add('hidden');
}

export async function bootstrapAdmin(auth, db, fb, currentPage) {
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try { await fb.signOut(auth); } catch (_) {}
      window.location.href = '../admin-login.html';
    };
  }

  // Date label
  const pageDate = document.getElementById('pageDate');
  if (pageDate) {
    pageDate.textContent = new Date().toLocaleDateString('en-PH', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  // Sidebar hamburger
  const sidebar   = document.getElementById('sidebar');
  const overlay   = document.getElementById('overlay');
  const hamburger = document.getElementById('hamburger');
  if (hamburger) hamburger.onclick = () => { sidebar?.classList.toggle('open'); overlay?.classList.toggle('show'); };
  if (overlay)   overlay.onclick   = () => { sidebar?.classList.remove('open'); overlay.classList.remove('show'); };

  // Guard + nav filter + resolve user, then dismiss loader
  try {
    const user = await guardAdminPage(auth, db, { doc: fb.doc, getDoc: fb.getDoc }, currentPage);
    hidePageLoader();
    return user;
  } catch (err) {
    // guardAdminPage redirects on auth failure — loader stays shown during redirect
    hidePageLoader();
    throw err;
  }
}
