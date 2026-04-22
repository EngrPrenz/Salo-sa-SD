import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

let allOrders = [];
let billingFilter = 'all';

// ── Toast ──
let showToast = m => console.log(m);
if (document.getElementById('toast') && document.getElementById('toastMsg')) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  showToast = m => {
    toastMsg.textContent = m;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  };
}

// ── Orders: initial fetch + live listener ──
getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))).then(snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderBilling();
  updateOrdersBadge();
});

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderBilling();
  updateOrdersBadge();
});

// ── Orders badge ──
function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

// ── Auth ──
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
});

// ── Logout ──
if (document.getElementById('logoutBtn')) {
  document.getElementById('logoutBtn').onclick = async () => {
    try { await signOut(auth); window.location.href = '../admin-login.html'; }
    catch (e) { window.location.href = '../admin-login.html'; }
  };
}

// ── Date header ──
if (document.getElementById('pageDate')) {
  const d = new Date();
  document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Sidebar hamburger ──
const sidebar = document.getElementById('sidebar');
const overlayEl = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar?.classList.toggle('open'); overlayEl?.classList.toggle('show'); };
if (overlayEl) overlayEl.onclick = () => { sidebar?.classList.remove('open'); overlayEl?.classList.remove('show'); };

// ── Render billing table ──
function renderBilling() {
  const tbody = document.getElementById('billingTableBody');
  if (!tbody) return;

  // Only show paid orders
  const paidOrders = allOrders.filter(o => o.status === 'paid');

  // ── TODAY'S TOTAL (fixed) ──
  // Build a start-of-day timestamp in local time using year/month/day
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  const todayTotal = paidOrders
    .filter(o => {
      if (!o.createdAt) return false;
      // Handle both Firestore Timestamp and plain Date
      const ts = typeof o.createdAt.toDate === 'function' ? o.createdAt.toDate() : new Date(o.createdAt);
      return ts >= todayStart;
    })
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  const totalEl = document.getElementById('billingTodayTotal');
  if (totalEl) {
    totalEl.textContent = `₱${todayTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  }

  if (!paidOrders.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No paid orders yet.</td></tr>';
    return;
  }

  tbody.innerHTML = paidOrders.map(o => {
    const ts = o.createdAt?.toDate
      ? o.createdAt.toDate().toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })
      : '—';
    const itemCount = (o.items || []).length;
    return `<tr>
      <td class="mono">#${o.id.slice(-5).toUpperCase()}</td>
      <td>Table ${escapeHtml(String(o.tableNumber || '—'))}</td>
      <td class="col-waiter">${escapeHtml(o.waiterName || '—')}</td>
      <td class="col-items">${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
      <td><strong>₱${(Number(o.total) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></td>
      <td class="col-date" style="white-space:nowrap">${ts}</td>
      <td><span class="status-badge ${escapeHtml(o.status)}">${capitalize(o.status || '')}</span></td>
      <td><button class="btn-sm" onclick="window._showReceipt('${escapeHtml(o.id)}')">Receipt</button></td>
    </tr>`;
  }).join('');
}

// ── Receipt modal ──
window._showReceipt = id => {
  const o = allOrders.find(x => x.id === id);
  if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('receiptModal');
  const body = document.getElementById('receiptModalBody');
  if (!modal || !body) return;

  const items = (o.items || []).map(it =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(it.name)} <span style="color:var(--text-muted)">× ${it.qty}</span></div>
      <div style="flex-shrink:0;margin-left:12px;font-weight:600;">₱${((Number(it.price) || 0) * (Number(it.qty) || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
    </div>`
  ).join('');

  const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH') : '—';

  body.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="font-size:15px;font-weight:700;color:var(--white)">Order #${o.id.slice(-5).toUpperCase()}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-top:3px;">${ts}</div>
      <div style="color:var(--text-muted);font-size:12px;">Table ${escapeHtml(String(o.tableNumber || '—'))} · ${escapeHtml(o.waiterName || '—')}</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:0 0 10px;">
    ${items}
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0 10px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted)">Total</span>
      <span style="font-size:20px;font-weight:700;color:var(--gold-light);font-family:'Cormorant Garamond',serif;">₱${(Number(o.total) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
    </div>`;

  modal.classList.add('show');
};

// ── Receipt modal close ──
document.getElementById('receiptModalClose')?.addEventListener('click', () => {
  document.getElementById('receiptModal')?.classList.remove('show');
});
document.getElementById('receiptModalClose2')?.addEventListener('click', () => {
  document.getElementById('receiptModal')?.classList.remove('show');
});
// Close on backdrop click
document.getElementById('receiptModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('receiptModal')) {
    document.getElementById('receiptModal').classList.remove('show');
  }
});

// ── Print receipt ──
document.getElementById('receiptModalPrint')?.addEventListener('click', () => {
  const body = document.getElementById('receiptModalBody');
  if (!body) return;
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Receipt — Salo sa Antipolo</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Courier New', monospace; padding: 24px 20px; max-width: 320px; margin: 0 auto; font-size: 13px; color: #111; }
          h2 { text-align: center; font-size: 18px; margin-bottom: 4px; }
          .sub { text-align: center; color: #666; font-size: 11px; margin-bottom: 20px; }
          hr { border: none; border-top: 1px dashed #bbb; margin: 14px 0; }
          .row { display: flex; justify-content: space-between; padding: 5px 0; gap: 8px; }
          .row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .total { font-size: 16px; font-weight: bold; text-align: right; margin-top: 8px; }
          .footer { text-align: center; margin-top: 28px; font-size: 11px; color: #888; }
        </style>
      </head>
      <body>
        <h2>Salo sa Antipolo</h2>
        <div class="sub">Official Receipt</div>
        ${body.innerHTML}
        <div class="footer">Thank you for dining with us!</div>
      </body>
    </html>
  `);
  printWindow.document.close();
  setTimeout(() => printWindow.print(), 300);
});

