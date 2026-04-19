import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

let showToast = m => console.log(m);
if (document.getElementById('toast') && document.getElementById('toastMsg')) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  showToast = m => { toastMsg.textContent = m; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3000); };
}

const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
if (overlay) overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

if (document.getElementById('pageDate')) {
  const d = new Date();
  document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

if (document.getElementById('logoutBtn')) {
  document.getElementById('logoutBtn').onclick = async () => {
    try {
      await signOut(auth);
      window.location.href = '../admin-login.html';
    } catch (e) {
      console.error('Logout error:', e);
      window.location.href = '../admin-login.html';
    }
  };
}

let staffLoading = false;
let allOrders = [];

getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))).then(snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  updateOrdersBadge();
});

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  updateOrdersBadge();
});

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

async function loadStaff() {
  const grid = document.getElementById('staffGrid');
  if (!grid) return;
  if (staffLoading) return;
  staffLoading = true;

  try {
    const snap = await getDocs(collection(db, 'Users'));
    const staff = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderStaff(staff);
  } catch (e) {
    console.error('loadStaff error:', e);
    if (document.getElementById('staffGrid')) document.getElementById('staffGrid').innerHTML = `<div class="empty-state">Failed to load staff: ${e.message}</div>`;
  } finally {
    staffLoading = false;
  }
}

function renderStaff(staff) {
  const grid = document.getElementById('staffGrid');
  if (!grid) return;
  
  const pending = staff.filter(s => s.role === 'waiter' && s.status === 'pending');
  const approved = staff.filter(s => s.status === 'approved' || s.role === 'admin' || !s.status || s.status === '');
  const rejected = staff.filter(s => s.role === 'waiter' && s.status === 'rejected');

  let html = '';

  if (pending.length > 0) {
    html += `<div class="pending-banner">
      <div class="pending-banner-icon">🔔</div>
      <div class="pending-banner-text"><strong>${pending.length} pending registration${pending.length > 1 ? 's' : ''}</strong> awaiting your approval</div>
    </div>`;
    html += `<div class="staff-section-label">⏳ Pending Approval</div>`;
    html += pending.map(s => `
      <div class="staff-card pending-card">
        <div class="staff-avatar pending-avatar">${(s.name || s.email || '?')[0].toUpperCase()}</div>
        <div class="staff-info">
          <div class="staff-name">${s.name || '—'}</div>
          <div class="staff-email">${s.email || '—'}</div>
          <div class="staff-meta">${s.phone || ''}</div>
          <span class="status-badge pending-badge">Pending Review</span>
        </div>
        <div class="staff-actions">
          <button class="btn-sm gold" onclick="window._approveStaff('${s.id}','${escapeHtml(s.name || '')}')">✓ Approve</button>
          <button class="btn-sm danger" onclick="window._rejectStaff('${s.id}','${escapeHtml(s.name || '')}')">✕ Reject</button>
        </div>
      </div>`).join('');
  }

  if (approved.length > 0) {
    html += `<div class="staff-section-label">✅ Active Staff</div>`;
    html += approved.map(s => `
      <div class="staff-card">
        <div class="staff-avatar">${(s.name || s.email || '?')[0].toUpperCase()}</div>
        <div class="staff-info">
          <div class="staff-name">${s.name || '—'}</div>
          <div class="staff-email">${s.email || '—'}</div>
          <span class="status-badge ${s.role}">${capitalize(s.role || 'unknown')}</span>
        </div>
        ${s.role === 'waiter' ? `<div class="staff-actions"><button class="btn-sm danger" onclick="window._rejectStaff('${s.id}','${escapeHtml(s.name || '')}')">Suspend</button></div>` : ''}
      </div>`).join('');
  }

  if (rejected.length > 0) {
    html += `<div class="staff-section-label" style="color:var(--red)">❌ Rejected / Suspended</div>`;
    html += rejected.map(s => `
      <div class="staff-card" style="opacity:0.55">
        <div class="staff-avatar" style="background:var(--red-dim);border-color:rgba(192,57,43,0.3);color:var(--red)">${(s.name || s.email || '?')[0].toUpperCase()}</div>
        <div class="staff-info">
          <div class="staff-name">${s.name || '—'}</div>
          <div class="staff-email">${s.email || '—'}</div>
          <span class="status-badge" style="color:var(--red);background:var(--red-dim)">Rejected</span>
        </div>
        <div class="staff-actions"><button class="btn-sm gold" onclick="window._approveStaff('${s.id}','${escapeHtml(s.name || '')}')">Re-approve</button></div>
      </div>`).join('');
  }

  if (!staff.length) html = '<div class="empty-state">No staff accounts found.</div>';
  else if (!html) html = '<div class="empty-state">No staff matched any category.</div>';
  grid.innerHTML = html;

  const staffBadge = document.getElementById('staffBadge');
  if (staffBadge) { staffBadge.textContent = pending.length; staffBadge.style.display = pending.length > 0 ? 'inline-flex' : 'none'; }
}

window._approveStaff = (uid, name) => {
  if (!confirm(`Approve ${name || 'this waiter'} and grant them access to the system?`)) return;
  updateDoc(doc(db, 'Users', uid), { status: 'approved', approvedAt: serverTimestamp() })
  .then(() => { showToast(`${name || 'Waiter'} has been approved.`); loadStaff(); })
  .catch(e => { console.error(e); showToast('Failed to approve.'); });
};

window._rejectStaff = (uid, name) => {
  if (!confirm(`Reject or suspend ${name || 'this waiter'}? They will not be able to log in.`)) return;
  updateDoc(doc(db, 'Users', uid), { status: 'rejected', rejectedAt: serverTimestamp() })
  .then(() => { showToast(`${name || 'Waiter'} has been rejected.`); loadStaff(); })
  .catch(e => { console.error(e); showToast('Failed to reject.'); });
};

onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = '../admin-login.html'; return; }
  const snap = await getDoc(doc(db, 'Users', user.uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    await signOut(auth); window.location.href = '../admin-login.html'; return;
  }
  const name = snap.data().name || user.email;
  if (document.getElementById('userNameSidebar')) document.getElementById('userNameSidebar').textContent = name;
  if (document.getElementById('topbarName')) document.getElementById('topbarName').textContent = name;
  if (document.getElementById('userAvatarSidebar')) document.getElementById('userAvatarSidebar').textContent = name[0].toUpperCase();
  if (document.getElementById('userAvatarTop')) document.getElementById('userAvatarTop').textContent = name[0].toUpperCase();
  loadStaff();
});

onSnapshot(collection(db, 'Users'), snap => {
  const staff = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderStaff(staff);
});
