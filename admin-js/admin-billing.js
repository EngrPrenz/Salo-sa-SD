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

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

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
    try { await signOut(auth); window.location.href = '../admin-login.html'; }
    catch (e) { window.location.href = '../admin-login.html'; }
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

function renderBilling() {
  const tbody = document.getElementById('billingTableBody');
  if (!tbody) return;

  // Only show paid orders
  let orders = allOrders.filter(o => o.status === 'paid');

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayTotal = orders.filter(o => o.createdAt?.toDate() >= today).reduce((s, o) => s + (o.total || 0), 0);
  if (document.getElementById('billingTodayTotal')) {
    document.getElementById('billingTodayTotal').textContent = `₱${todayTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  }

  if (!orders.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No paid orders yet.</td></tr>'; return; }

  tbody.innerHTML = orders.map(o => {
    const ts = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    return `<tr>
      <td class="mono">#${o.id.slice(-5).toUpperCase()}</td>
      <td>Table ${o.tableNumber || '—'}</td>
      <td>${o.waiterName || '—'}</td>
      <td>${(o.items || []).length} items</td>
      <td><strong>₱${(o.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></td>
      <td style="white-space:nowrap">${ts}</td>
      <td><span class="status-badge ${o.status}">${capitalize(o.status || '')}</span></td>
      <td><button class="btn-sm" onclick="window._showReceipt('${o.id}')">Receipt</button></td>
    </tr>`;
  }).join('');
}

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