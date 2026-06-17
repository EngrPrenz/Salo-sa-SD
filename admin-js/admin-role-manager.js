/**
 * admin-role-manager.js
 *
 * Adds admin-role management UI to the staff page.
 * Only visible to admin_manager (and legacy 'admin') role.
 *
 * Injects:
 *  - An "Admin Accounts" section into the staff grid showing all admin-role users
 *  - A "Change Role" button per admin user
 *  - A role-change modal
 *
 * Import this AFTER admin-staff.js has fully loaded (use a dynamic import or
 * place the <script> tag after the staff script tag).
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  updateDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ROLE_LABEL, ROLE_BADGE_COLOR } from './rbac.js';

// Re-use existing app if already initialised by admin-staff.js
const app = getApps().length
  ? getApps()[0]
  : initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });

const auth = getAuth(app);
const db   = getFirestore(app);

function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const ADMIN_ROLES = ['admin_manager', 'admin_owner', 'admin_cashier'];
const ROLE_OPTIONS = [
  { value:'admin_manager', label:'Manager',    desc:'Full access — statistics & all operations', color:'#c9973a' },
  { value:'admin_owner',   label:'Owner / CEO', desc:'Business insights — overview & reports only', color:'#9b59b6' },
  { value:'admin_cashier', label:'Cashier',    desc:'Operations — orders, tables, menu & billing', color:'#27ae60' },
];

let currentUid = '';

// Wait for auth, then check if current user is manager
auth.onAuthStateChanged(async user => {
  if (!user) return;
  currentUid = user.uid;
  const snap = await getDoc(doc(db,'Users',user.uid));
  if (!snap.exists()) return;
  const role = snap.data().role;
  if (!['admin_manager','admin'].includes(role)) return;  // only managers see this section

  injectAdminSection();
  injectRoleModal();
  subscribeAdmins();
});

// ── Inject the "Admin Accounts" section ────────────────────────────────────────
function injectAdminSection() {
  const grid = document.getElementById('staffGrid');
  if (!grid || document.getElementById('adminAccountsSection')) return;

  const section = document.createElement('div');
  section.id = 'adminAccountsSection';
  section.innerHTML = `
    <div class="staff-section-label" style="margin-top:12px;">🛡️ Admin Accounts</div>
    <div id="adminAccountsList"></div>`;
  grid.appendChild(section);
}

// ── Inject role-change modal ───────────────────────────────────────────────────
function injectRoleModal() {
  if (document.getElementById('roleChangeModal')) return;

  const modal = document.createElement('div');
  modal.id = 'roleChangeModal';
  modal.className = 'confirm-modal-overlay';
  modal.innerHTML = `
    <div class="confirm-modal" role="dialog" aria-modal="true">
      <div class="confirm-modal-head">
        <div class="confirm-modal-icon-wrap"><span>🛡️</span></div>
        <button class="confirm-modal-close" id="roleChangeModalClose">✕</button>
      </div>
      <div class="confirm-modal-body">
        <div class="confirm-modal-title" id="roleChangeTitle">Change Admin Role</div>
        <div class="confirm-modal-message" id="roleChangeSubtitle" style="margin-bottom:16px;"></div>
        <div id="roleChangeOptions" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>
      <div class="confirm-modal-foot">
        <button class="btn-sm" id="roleChangeCancel">Cancel</button>
        <button class="btn-sm gold" id="roleChangeSave">Save Role</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  let selectedRole = '';
  let targetUid    = '';

  const close = () => modal.classList.remove('show');
  document.getElementById('roleChangeModalClose').onclick = close;
  document.getElementById('roleChangeCancel').onclick     = close;
  modal.addEventListener('click', e => { if(e.target===modal) close(); });

  document.getElementById('roleChangeSave').onclick = async () => {
    if (!selectedRole || !targetUid) return;
    const btn = document.getElementById('roleChangeSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await updateDoc(doc(db,'Users',targetUid), { role: selectedRole, roleUpdatedAt: serverTimestamp() });
      showToast(`Role updated to ${ROLE_LABEL[selectedRole] || selectedRole}`);
      close();
    } catch(e) {
      console.error(e);
      showToast('Failed to update role.');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Role';
    }
  };

  window._openRoleChange = (uid, name, currentRole) => {
    targetUid    = uid;
    selectedRole = currentRole;
    document.getElementById('roleChangeTitle').textContent    = `Change role for ${name}`;
    document.getElementById('roleChangeSubtitle').textContent = 'Select the access level for this admin account.';

    const container = document.getElementById('roleChangeOptions');
    container.innerHTML = ROLE_OPTIONS.map(opt => `
      <label style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;
        background:var(--black-mid);border:1.5px solid ${opt.value===currentRole?opt.color:'var(--border)'};
        border-radius:12px;cursor:pointer;transition:border-color 0.15s;margin:0;"
        id="roleOpt_${opt.value}">
        <input type="radio" name="roleChoice" value="${opt.value}" ${opt.value===currentRole?'checked':''} style="margin-top:3px;accent-color:${opt.color};" />
        <div>
          <div style="font-size:13px;font-weight:600;color:${opt.color};">${opt.label}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${opt.desc}</div>
        </div>
      </label>`).join('');

    container.querySelectorAll('input[name="roleChoice"]').forEach(radio => {
      radio.addEventListener('change', () => {
        selectedRole = radio.value;
        container.querySelectorAll('label').forEach(l => {
          const opt = ROLE_OPTIONS.find(o => o.value===l.querySelector('input').value);
          l.style.borderColor = l.querySelector('input').checked ? opt.color : 'var(--border)';
        });
      });
    });

    modal.classList.add('show');
  };
}

// ── Subscribe to admin users ───────────────────────────────────────────────────
function subscribeAdmins() {
  onSnapshot(collection(db,'Users'), snap => {
    const admins = snap.docs
      .map(d => ({ id:d.id, ...d.data() }))
      .filter(u => ADMIN_ROLES.includes(u.role) || u.role==='admin');
    renderAdminList(admins);
  });
}

function renderAdminList(admins) {
  const container = document.getElementById('adminAccountsList');
  if (!container) return;

  if (!admins.length) {
    container.innerHTML = '<div class="empty-state" style="padding:16px 0;">No admin accounts found.</div>';
    return;
  }

  container.innerHTML = admins.map(u => {
    const roleKey    = u.role === 'admin' ? 'admin_manager' : u.role;
    const label      = ROLE_LABEL[u.role] || 'Admin';
    const color      = ROLE_BADGE_COLOR[u.role] || '#c9973a';
    const isSelf     = u.id === currentUid;
    return `
      <div class="staff-card" style="border-left:3px solid ${color};">
        <div class="staff-avatar" style="background:${color}22;border-color:${color}55;color:${color};">
          ${(u.name||u.email||'?')[0].toUpperCase()}
        </div>
        <div class="staff-info">
          <div class="staff-name">${escapeHtml(u.name||'—')} ${isSelf?'<span style="font-size:10px;color:var(--text-muted);">(you)</span>':''}</div>
          <div class="staff-email">${escapeHtml(u.email||'—')}</div>
          <span class="status-badge" style="color:${color};background:${color}18;">${label}</span>
        </div>
        ${!isSelf?`
          <div class="staff-actions">
            <button class="btn-sm" onclick="window._openRoleChange('${u.id}','${escapeHtml(u.name||u.email||'')}','${u.role}')">
              Change Role
            </button>
          </div>`:''
        }
      </div>`;
  }).join('');
}

// ── Toast fallback (in case staff page toast isn't available) ─────────────────
function showToast(m) {
  const toastEl  = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  if (toastEl && toastMsg) {
    toastMsg.textContent=m; toastEl.classList.add('show');
    setTimeout(()=>toastEl.classList.remove('show'),3000);
  } else { console.log(m); }
}
