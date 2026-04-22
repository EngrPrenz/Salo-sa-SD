import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, updateDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

let allOrders = [];
let activeFilter = 'all';

// Load orders immediately + real-time
getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))).then(snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders();
  updateOrdersBadge();
});

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders();
  updateOrdersBadge();
});

// Auth guard
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

if (document.getElementById('pageDate')) {
  const d = new Date();
  document.getElementById('pageDate').textContent = d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

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

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

function switchTab(status) {
  document.querySelectorAll('.ftab[data-status]').forEach(x => x.classList.remove('active'));
  const tab = document.querySelector(`.ftab[data-status="${status}"]`);
  if (tab) tab.classList.add('active');
  activeFilter = status;
}

async function updateOrderStatus(id, status) {
  await updateDoc(doc(db, 'orders', id), { status, updatedAt: serverTimestamp() });

  // Auto-switch to the matching tab so the order visibly moves there
  if (status === 'served') {
    switchTab('served');
  }

  if (status === 'paid' || status === 'cancelled') {
    // Free up the table
    const order = allOrders.find(o => o.id === id);
    if (order?.tableNumber) {
      const tablesSnap = await getDocs(collection(db, 'tables'));
      const tableDoc = tablesSnap.docs.find(d => {
        const data = d.data();
        return data.tableNumber === order.tableNumber ||
               d.id === `table_${order.tableNumber}`;
      });
      if (tableDoc) {
        await updateDoc(doc(db, 'tables', tableDoc.id), {
          status: 'free',
          waiterId: null,
          waiterName: null,
          lastUpdated: serverTimestamp()
        });
      }
    }

    // Auto-switch to the matching tab
    switchTab(status);
  }

  showToast(`Order updated to "${status}"`);
}

const orderSearch = document.getElementById('orderSearch');
if (orderSearch) orderSearch.addEventListener('input', renderOrders);

document.querySelectorAll('.ftab[data-status]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.ftab[data-status]').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); activeFilter = b.dataset.status; renderOrders();
}));

function renderOrders() {
  const grid = document.getElementById('ordersGrid');
  if (!grid) return;
  let filtered = allOrders;

  // "All" tab shows only actionable orders: pending + preparing
  // served, paid, cancelled only appear under their own explicit tabs
  if (activeFilter === 'all') {
    filtered = filtered.filter(o => !['served', 'paid', 'cancelled'].includes(o.status));
  } else {
    filtered = filtered.filter(o => o.status === activeFilter);
  }

  const q = orderSearch?.value?.trim().toLowerCase() || '';
  if (q) filtered = filtered.filter(o => String(o.tableNumber).includes(q) || (o.waiterName || '').toLowerCase().includes(q));
  if (!filtered.length) { grid.innerHTML = '<div class="empty-state">No orders found.</div>'; return; }

  grid.innerHTML = filtered.map(o => {
    const items = (o.items || []).map(it => `<li>${it.name} × ${it.qty} <span>₱${((it.price || 0) * it.qty).toLocaleString()}</span></li>`).join('');
    const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—';

    const nextStatus = { pending: 'preparing', preparing: 'served' }[o.status];
    const nextLabel = { pending: 'Mark Preparing', preparing: 'Mark Served' }[o.status] || '';

    // Mark Paid button only visible on served orders
    const showMarkPaid = o.status === 'served';

    // Cancel button only on still-actionable orders
    const showCancel = !['paid', 'cancelled', 'served'].includes(o.status);

    return `
      <div class="order-card ${o.status}">
        <div class="order-card-head">
          <div>
            <span class="order-id mono">#${o.id.slice(-5).toUpperCase()}</span>
            <span class="status-badge ${o.status}">${capitalize(o.status || '')}</span>
          </div>
          <span class="order-time">${ts}</span>
        </div>
        <div class="order-meta">Table <strong>${o.tableNumber || '?'}</strong> · ${o.waiterName || 'Unknown'}</div>
        <ul class="order-items">${items}</ul>
        <div class="order-total">Total: <strong>₱${(o.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
        <div class="order-card-actions-row">
          <div class="order-card-actions-top">
            ${nextStatus ? `<button class="btn-sm gold" onclick="window._updateStatus('${o.id}','${nextStatus}')">${nextLabel}</button>` : ''}
            ${showMarkPaid ? `<button class="btn-sm green" onclick="window._updateStatus('${o.id}','paid')">Mark Paid</button>` : ''}
            <button class="btn-sm" onclick="window._showReceipt('${o.id}')">Receipt</button>
          </div>
          ${showCancel ? `<button class="btn-sm danger" onclick="window._updateStatus('${o.id}','cancelled')">Cancel</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

window._updateStatus = updateOrderStatus;

window._showReceipt = id => {
  const o = allOrders.find(x => x.id === id);
  if (!o) { showToast('Order not found'); return; }
  const modal = document.getElementById('receiptModal');
  const body = document.getElementById('receiptModalBody');
  if (!modal || !body) return;
  const items = (o.items || []).map(it => `<div style="display:flex;justify-content:space-between;padding:6px 0;"><div>${escapeHtml(it.name)} × ${it.qty}</div><div>₱${((it.price || 0) * (it.qty || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div></div>`).join('');
  const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH') : '—';
  body.innerHTML = `<div><strong>Order #${o.id.slice(-5).toUpperCase()}</strong><div style="color:var(--text-muted);font-size:12px">${ts}</div><hr></div>${items}<hr><div style="text-align:right;font-size:16px">Total: <strong>₱${(o.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>`;
  modal.classList.add('show');
};

if (document.getElementById('receiptModalClose')) {
  document.getElementById('receiptModalClose').onclick = () => document.getElementById('receiptModal').classList.remove('show');
}
if (document.getElementById('receiptModalClose2')) {
  document.getElementById('receiptModalClose2').onclick = () => document.getElementById('receiptModal').classList.remove('show');
}

if (document.getElementById('receiptModalPrint')) {
  document.getElementById('receiptModalPrint').onclick = () => {
    const body = document.getElementById('receiptModalBody');
    if (!body) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt - Salo sa Antipolo</title>
          <style>
            body { font-family: monospace; padding: 20px; max-width: 300px; margin: 0 auto; }
            h2 { text-align: center; margin-bottom: 5px; }
            .header { text-align: center; color: #666; font-size: 12px; margin-bottom: 20px; }
            hr { border: none; border-top: 1px dashed #ccc; margin: 15px 0; }
            .row { display: flex; justify-content: space-between; padding: 5px 0; }
            .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 10px; }
            .footer { text-align: center; margin-top: 30px; font-size: 11px; color: #666; }
          </style>
        </head>
        <body>
          ${body.innerHTML}
          <div class="footer">Thank you for dining with us!</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };
}