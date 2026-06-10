import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { bootstrapAdmin, } from './admin-auth.js';
import { ROLE_LABEL, ROLE_BADGE_COLOR } from './rbac.js';

const app = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

// ── Permission helpers ────────────────────────────────────────────────────────
const ADMIN_ROLES   = ['admin','admin_manager','admin_owner','admin_cashier'];
const MANAGER_ROLES = ['admin','admin_manager'];
const OWNER_ROLES   = ['admin_owner'];

/** Is `targetRole` an admin-tier role? */
function isAdmin(role)   { return ADMIN_ROLES.includes(role); }
/** Is `targetRole` a manager-level role? */
function isManager(role) { return MANAGER_ROLES.includes(role); }
/** Is `targetRole` the owner/CEO? */
function isOwner(role)   { return OWNER_ROLES.includes(role); }

/**
 * Can `actorRole` perform approval/rejection/deletion on a user with `targetRole`?
 *
 * Rules:
 *  - Owner/CEO  → can act on waiters AND managers (not on other owners)
 *  - Manager    → can act on waiters ONLY
 *  - Cashier    → no staff page access (guarded at route level)
 */
function canAct(actorRole, targetRole) {
  if (isOwner(actorRole)) {
    // CEO can manage waiters and managers, but NOT other owners
    return targetRole === 'waiter' || isManager(targetRole);
  }
  if (isManager(actorRole)) {
    // Manager can ONLY manage waiters
    return targetRole === 'waiter';
  }
  return false;
}

// ── State ─────────────────────────────────────────────────────────────────────
let currentUserRole = '';
let currentUid      = '';
let allOrders       = [];

// ── Bootstrap ─────────────────────────────────────────────────────────────────
bootstrapAdmin(auth, db, { doc, getDoc, signOut }, 'admin-staff.html')
  .then(userInfo => {
    currentUserRole = userInfo.role;
    currentUid      = userInfo.uid;
    startListeners();
  });

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl  = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
if (toastEl && toastMsg) {
  showToast = m => { toastMsg.textContent=m; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),3000); };
}

// ── Data listeners ────────────────────────────────────────────────────────────
function startListeners() {
  onSnapshot(query(collection(db,'orders'), orderBy('createdAt','desc')), snap => {
    allOrders = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    updateOrdersBadge();
  });
  onSnapshot(collection(db,'Users'), snap => {
    const staff = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderStaff(staff);
  });
}

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending','preparing'].includes(o.status)).length;
  const badge  = document.getElementById('ordersBadge');
  if (badge) { badge.textContent=active; badge.style.display=active>0?'inline-flex':'none'; }
}

// ── Render staff list ─────────────────────────────────────────────────────────
function renderStaff(staff) {
  const grid = document.getElementById('staffGrid'); if (!grid) return;

  const actor = currentUserRole;

  // Partition users
  const pendingWaiters  = staff.filter(s => s.role==='waiter' && s.status==='pending');
  const approvedWaiters = staff.filter(s => s.role==='waiter' && (s.status==='approved' || !s.status || s.status===''));
  const rejectedWaiters = staff.filter(s => s.role==='waiter' && s.status==='rejected');
  const adminUsers      = staff.filter(s => isAdmin(s.role));

  let html = '';

  // ── Pending waiters banner ────────────────────────────────────────────────
  if (pendingWaiters.length > 0 && canAct(actor, 'waiter')) {
    html += `
      <div class="pending-banner">
        <div class="pending-banner-icon">🔔</div>
        <div class="pending-banner-text">
          <strong>${pendingWaiters.length} pending registration${pendingWaiters.length>1?'s':''}</strong> awaiting your approval
        </div>
      </div>`;
  }

  // ── Pending waiters ───────────────────────────────────────────────────────
  if (pendingWaiters.length > 0) {
    html += `<div class="staff-section-label">⏳ Pending Approval</div>`;
    html += pendingWaiters.map(s => buildWaiterCard(s, actor, 'pending')).join('');
  }

  // ── Active waiters ────────────────────────────────────────────────────────
  if (approvedWaiters.length > 0) {
    html += `<div class="staff-section-label">✅ Active Waiters</div>`;
    html += approvedWaiters.map(s => buildWaiterCard(s, actor, 'approved')).join('');
  }

  // ── Rejected / suspended waiters ─────────────────────────────────────────
  if (rejectedWaiters.length > 0) {
    html += `<div class="staff-section-label" style="color:var(--red)">❌ Rejected / Suspended</div>`;
    html += rejectedWaiters.map(s => buildWaiterCard(s, actor, 'rejected')).join('');
  }

  // ── Admin accounts section (owner + manager see this) ────────────────────
  if (adminUsers.length > 0) {
    html += `<div class="staff-section-label" style="margin-top:16px;">🛡️ Admin Accounts</div>`;
    html += adminUsers.map(s => buildAdminCard(s, actor)).join('');
  }

  if (!staff.length) html = '<div class="empty-state">No staff accounts found.</div>';
  grid.innerHTML = html;

  const staffBadge = document.getElementById('staffBadge');
  if (staffBadge) {
    staffBadge.textContent = pendingWaiters.length;
    staffBadge.style.display = pendingWaiters.length > 0 ? 'inline-flex' : 'none';
  }
}

// ── Build waiter card ─────────────────────────────────────────────────────────
function buildWaiterCard(s, actor, status) {
  const canManage = canAct(actor, 'waiter');
  const isSelf    = s.id === currentUid;

  let actionHtml = '';
  if (canManage && !isSelf) {
    if (status === 'pending') {
      actionHtml = `
        <div class="staff-actions">
          <button class="btn-sm gold"   onclick="window._approveStaff('${s.id}','${escapeHtml(s.name||'')}')">✓ Approve</button>
          <button class="btn-sm danger" onclick="window._rejectStaff('${s.id}','${escapeHtml(s.name||'')}')">✕ Reject</button>
          <button class="btn-sm danger" onclick="window._deleteStaff('${s.id}','${escapeHtml(s.name||'')}')">🗑 Delete</button>
        </div>`;
    } else if (status === 'approved') {
      const promoteBtn = isOwner(actor)
        ? `<button class="btn-sm" style="border-color:rgba(155,89,182,0.4);color:#9b59b6;" onclick="window._promoteToManager('${s.id}','${escapeHtml(s.name||'')}')">⬆ Manager</button>`
        : '';
      actionHtml = `
        <div class="staff-actions">
          ${promoteBtn}
          <button class="btn-sm danger" onclick="window._rejectStaff('${s.id}','${escapeHtml(s.name||'')}')">Suspend</button>
          <button class="btn-sm danger" onclick="window._deleteStaff('${s.id}','${escapeHtml(s.name||'')}')">🗑 Delete</button>
        </div>`;
    } else {
      // rejected
      actionHtml = `
        <div class="staff-actions">
          <button class="btn-sm gold"   onclick="window._approveStaff('${s.id}','${escapeHtml(s.name||'')}')">Re-approve</button>
          <button class="btn-sm danger" onclick="window._deleteStaff('${s.id}','${escapeHtml(s.name||'')}')">🗑 Delete</button>
        </div>`;
    }
  }

  const cardStyle = status === 'rejected' ? ' style="opacity:0.55"' : (status === 'pending' ? ' class="staff-card pending-card"' : ' class="staff-card"');
  const avatarStyle = status === 'rejected' ? ' style="background:var(--red-dim);border-color:rgba(192,57,43,0.3);color:var(--red)"' : (status === 'pending' ? ' class="staff-avatar pending-avatar"' : ' class="staff-avatar"');
  const badgeHtml = status === 'pending'
    ? `<span class="status-badge pending-badge">Pending Review</span>`
    : status === 'rejected'
    ? `<span class="status-badge" style="color:var(--red);background:var(--red-dim)">Rejected</span>`
    : `<span class="status-badge waiter">Waiter</span>`;

  return `
    <div${status==='rejected'?' class="staff-card"'+cardStyle:''}${status!=='rejected'?cardStyle:''}>
      <div${avatarStyle}>${(s.name||s.email||'?')[0].toUpperCase()}</div>
      <div class="staff-info">
        <div class="staff-name">${escapeHtml(s.name||'—')}</div>
        <div class="staff-email">${escapeHtml(s.email||'—')}</div>
        <div class="staff-meta">${escapeHtml(s.phone||'')}</div>
        ${badgeHtml}
      </div>
      ${actionHtml}
    </div>`;
}

// ── Build admin card ──────────────────────────────────────────────────────────
function buildAdminCard(s, actor) {
  const isSelf     = s.id === currentUid;
  const targetRole = s.role;
  const color      = ROLE_BADGE_COLOR[targetRole] || '#c9973a';
  const label      = ROLE_LABEL[targetRole] || capitalize(targetRole);

  let actionHtml = '';

  if (!isSelf) {
    const actorCanFire   = canAct(actor, targetRole);
    const actorIsOwner   = isOwner(actor);
    const actorIsManager = isManager(actor);

    // Owner can change roles of managers; managers cannot touch other admins
    if (actorCanFire) {
      const changeRoleBtn = actorIsOwner
        ? `<button class="btn-sm" onclick="window._openRoleChange('${s.id}','${escapeHtml(s.name||s.email||'')}','${targetRole}')">Change Role</button>`
        : '';
      const fireLabel = isManager(targetRole) ? 'Demote / Fire' : 'Suspend';
      actionHtml = `
        <div class="staff-actions">
          ${changeRoleBtn}
          <button class="btn-sm danger" onclick="window._fireAdmin('${s.id}','${escapeHtml(s.name||'')}','${targetRole}')">🔥 ${fireLabel}</button>
          <button class="btn-sm danger" onclick="window._deleteStaff('${s.id}','${escapeHtml(s.name||'')}')">🗑 Delete</button>
        </div>`;
    } else if (actorIsManager && isManager(targetRole)) {
      // Fellow managers — manager can only VIEW, not act
      actionHtml = `<div class="staff-actions"><span style="font-size:11px;color:var(--text-muted);padding:6px 0;">View only</span></div>`;
    }
  }

  return `
    <div class="staff-card" style="border-left:3px solid ${color};">
      <div class="staff-avatar" style="background:${color}22;border-color:${color}55;color:${color};">
        ${(s.name||s.email||'?')[0].toUpperCase()}
      </div>
      <div class="staff-info">
        <div class="staff-name">
          ${escapeHtml(s.name||'—')}
          ${isSelf ? '<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">(you)</span>' : ''}
        </div>
        <div class="staff-email">${escapeHtml(s.email||'—')}</div>
        <span class="status-badge" style="color:${color};background:${color}18;">${label}</span>
      </div>
      ${actionHtml}
    </div>`;
}

// ── Confirm modal helper ──────────────────────────────────────────────────────
function showConfirmModal({ icon='⚠️', title, message, okLabel='Confirm', okClass='gold', onConfirm }) {
  const overlay   = document.getElementById('confirmModal');
  if (!overlay) { if (confirm(message)) onConfirm(); return; }

  const iconEl    = document.getElementById('confirmIcon');
  const titleEl   = document.getElementById('confirmTitle');
  const msgEl     = document.getElementById('confirmMessage');
  const okBtn     = document.getElementById('confirmOk');
  const cancelBtn = document.getElementById('confirmCancel');
  const closeBtn  = document.getElementById('confirmModalClose');

  if (iconEl)  iconEl.textContent  = icon;
  if (titleEl) titleEl.textContent = title;
  if (msgEl)   msgEl.textContent   = message;
  if (okBtn) { okBtn.textContent = okLabel; okBtn.className = `btn-sm ${okClass}`; }

  overlay.classList.add('show');

  const close    = () => overlay.classList.remove('show');
  const onOk     = () => { close(); onConfirm(); cleanup(); };
  const onCancel = () => { close(); cleanup(); };
  function cleanup() {
    okBtn?.removeEventListener('click', onOk);
    cancelBtn?.removeEventListener('click', onCancel);
    closeBtn?.removeEventListener('click', onCancel);
    overlay.removeEventListener('click', onOverlay);
  }
  function onOverlay(e) { if (e.target === overlay) onCancel(); }

  okBtn?.addEventListener('click', onOk);
  cancelBtn?.addEventListener('click', onCancel);
  closeBtn?.addEventListener('click', onCancel);
  overlay.addEventListener('click', onOverlay);
}

// ── Role-change modal (owner only) ────────────────────────────────────────────
const ROLE_OPTIONS = [
  { value:'admin_manager', label:'Manager',     desc:'Full access — statistics & all operations', color:'#c9973a' },
  { value:'admin_owner',   label:'Owner / CEO', desc:'Business insights — overview & reports only', color:'#9b59b6' },
  { value:'admin_cashier', label:'Cashier',     desc:'Operations — orders & billing only', color:'#27ae60' },
  { value:'waiter',        label:'Waiter',      desc:'Demote to waiter — waiter portal access only', color:'#5e5e5e' },
];

let _roleTargetUid  = '';
let _roleSelected   = '';

window._openRoleChange = (uid, name, currentRole) => {
  _roleTargetUid = uid;
  _roleSelected  = currentRole;

  const modal = document.getElementById('roleChangeModal');
  if (!modal) return;

  document.getElementById('roleChangeTitle').textContent    = `Change role for ${name}`;
  document.getElementById('roleChangeSubtitle').textContent = 'Select the access level for this account.';

  const container = document.getElementById('roleChangeOptions');
  container.innerHTML = ROLE_OPTIONS.map(opt => `
    <label style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;
      background:var(--black-mid);border:1.5px solid ${opt.value===currentRole ? opt.color : 'var(--border)'};
      border-radius:12px;cursor:pointer;transition:border-color 0.15s;margin:0;" id="roleOpt_${opt.value}">
      <input type="radio" name="roleChoice" value="${opt.value}" ${opt.value===currentRole?'checked':''} style="margin-top:3px;accent-color:${opt.color};" />
      <div>
        <div style="font-size:13px;font-weight:600;color:${opt.color};">${opt.label}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${opt.desc}</div>
      </div>
    </label>`).join('');

  container.querySelectorAll('input[name="roleChoice"]').forEach(radio => {
    radio.addEventListener('change', () => {
      _roleSelected = radio.value;
      container.querySelectorAll('label').forEach(l => {
        const opt = ROLE_OPTIONS.find(o => o.value === l.querySelector('input').value);
        l.style.borderColor = l.querySelector('input').checked ? opt.color : 'var(--border)';
      });
    });
  });

  modal.classList.add('show');
};

document.getElementById('roleChangeModalClose')?.addEventListener('click', () => document.getElementById('roleChangeModal')?.classList.remove('show'));
document.getElementById('roleChangeCancel')?.addEventListener('click',     () => document.getElementById('roleChangeModal')?.classList.remove('show'));
document.getElementById('roleChangeModal')?.addEventListener('click',      e  => { if (e.target === document.getElementById('roleChangeModal')) document.getElementById('roleChangeModal').classList.remove('show'); });

document.getElementById('roleChangeSave')?.addEventListener('click', async () => {
  if (!_roleSelected || !_roleTargetUid) return;
  const btn = document.getElementById('roleChangeSave');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const updateData = { role: _roleSelected, roleUpdatedAt: serverTimestamp() };
    // If demoting to waiter, ensure status is approved so they can log in
    if (_roleSelected === 'waiter') updateData.status = 'approved';
    await updateDoc(doc(db,'Users',_roleTargetUid), updateData);
    showToast(`Role updated to ${ROLE_LABEL[_roleSelected] || _roleSelected}`);
    document.getElementById('roleChangeModal')?.classList.remove('show');
  } catch(e) {
    console.error(e); showToast('Failed to update role.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Role';
  }
});

// ── Action handlers ───────────────────────────────────────────────────────────

window._approveStaff = (uid, name) => {
  showConfirmModal({
    icon:'✅', title:`Approve ${name||'this waiter'}?`,
    message:`${name||'This waiter'} will be granted access and can log in immediately.`,
    okLabel:'✓ Approve', okClass:'gold',
    onConfirm: async () => {
      try {
        await updateDoc(doc(db,'Users',uid), { status:'approved', approvedAt:serverTimestamp() });
        showToast(`${name||'Waiter'} approved.`);
      } catch(e) { console.error(e); showToast('Failed to approve.'); }
    },
  });
};

window._rejectStaff = (uid, name) => {
  showConfirmModal({
    icon:'🚫', title:`Suspend ${name||'this waiter'}?`,
    message:`${name||'This waiter'} will lose access and cannot log in. You can re-approve them later.`,
    okLabel:'Suspend', okClass:'danger',
    onConfirm: async () => {
      try {
        await updateDoc(doc(db,'Users',uid), { status:'rejected', rejectedAt:serverTimestamp() });
        showToast(`${name||'Waiter'} suspended.`);
      } catch(e) { console.error(e); showToast('Failed to suspend.'); }
    },
  });
};

window._deleteStaff = (uid, name) => {
  showConfirmModal({
    icon:'🗑️', title:`Permanently delete ${name||'this account'}?`,
    message:`This will remove "${name||'this account'}" from the staff list. This cannot be undone.`,
    okLabel:'Delete', okClass:'danger',
    onConfirm: async () => {
      try {
        await deleteDoc(doc(db,'Users',uid));
        showToast(`${name||'Account'} deleted.`);
      } catch(e) { console.error(e); showToast('Failed to delete account.'); }
    },
  });
};

window._promoteToManager = (uid, name) => {
  showConfirmModal({
    icon:'⬆️', title:`Promote ${name} to Manager?`,
    message:`${name} will gain full admin access (excluding Owner-only privileges). This can be reversed later.`,
    okLabel:'Promote', okClass:'gold',
    onConfirm: async () => {
      try {
        await updateDoc(doc(db,'Users',uid), { role:'admin_manager', roleUpdatedAt:serverTimestamp() });
        showToast(`${name} promoted to Manager.`);
      } catch(e) { console.error(e); showToast('Failed to promote.'); }
    },
  });
};

window._fireAdmin = (uid, name, targetRole) => {
  const isManagerTarget = isManager(targetRole);
  const actionLabel     = isManagerTarget ? 'demote and remove access for' : 'suspend';
  showConfirmModal({
    icon:'🔥',
    title: isManagerTarget ? `Demote ${name}?` : `Suspend ${name}?`,
    message: isManagerTarget
      ? `${name} will be demoted to Waiter and lose admin access. You can restore their role later.`
      : `${name} will lose access and cannot log in.`,
    okLabel: isManagerTarget ? 'Demote to Waiter' : 'Suspend',
    okClass:'danger',
    onConfirm: async () => {
      try {
        const update = isManagerTarget
          ? { role:'waiter', status:'approved', roleUpdatedAt:serverTimestamp() }
          : { status:'rejected', rejectedAt:serverTimestamp() };
        await updateDoc(doc(db,'Users',uid), update);
        showToast(isManagerTarget ? `${name} demoted to Waiter.` : `${name} suspended.`);
      } catch(e) { console.error(e); showToast('Failed to update account.'); }
    },
  });
};
