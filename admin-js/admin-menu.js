import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

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
  loadMenu();
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

let menuItems = [];
let editMenuId = null;
let menuCatFilter = 'all';
let menuSearchQuery = '';
let pendingImageFile = null;
let currentImageUrl = null;
let allOrders = [];
let menuOrderCounts = {};

const ORDER_LIMIT = 20;

getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))).then(snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  calculateMenuOrderCounts();
  updateOrdersBadge();
  renderMenuGrid();
});

onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  calculateMenuOrderCounts();
  updateOrdersBadge();
  renderMenuGrid();
});

function calculateMenuOrderCounts() {
  menuOrderCounts = {};
  allOrders.filter(o => o.status === 'served').forEach(o => {
    (o.items || []).forEach(item => {
      const key = item.name || item.id;
      if (!menuOrderCounts[key]) menuOrderCounts[key] = { served: 0, total: 0 };
      menuOrderCounts[key].served += item.qty || 1;
      menuOrderCounts[key].total += item.qty || 1;
    });
  });
}

function updateOrdersBadge() {
  const active = allOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length;
  const badge = document.getElementById('ordersBadge');
  if (badge) { badge.textContent = active; badge.style.display = active > 0 ? 'inline-flex' : 'none'; }
}

async function loadMenu() {
  if (!document.getElementById('menuGrid')) return;
  const snap = await getDocs(collection(db, 'menu'));
  menuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  buildMenuCategoryTabs();
  renderMenuGrid();
}

onSnapshot(collection(db, 'menu'), snap => {
  menuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  buildMenuCategoryTabs();
  renderMenuGrid();
});

const menuSearch = document.getElementById('menuSearch');
if (menuSearch) {
  menuSearch.addEventListener('input', (e) => { menuSearchQuery = e.target.value; renderMenuGrid(); });
}

function buildMenuCategoryTabs() {
  const tabs = document.getElementById('menuCategoryTabs');
  if (!tabs) return;
  const cats = [...new Set(menuItems.map(m => m.category || 'Other'))];
  tabs.innerHTML = `<button class="ftab active" data-cat="all">All</button>` + cats.map(c => `<button class="ftab" data-cat="${c}">${c}</button>`).join('');
  tabs.querySelectorAll('.ftab').forEach(b => b.addEventListener('click', () => {
    tabs.querySelectorAll('.ftab').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); menuCatFilter = b.dataset.cat; renderMenuGrid();
  }));
}

function renderMenuGrid() {
  const grid = document.getElementById('menuGrid');
  if (!grid) return;
  
  const searchTerm = (menuSearchQuery || '').trim().toLowerCase();
  
  let items = menuCatFilter === 'all' ? menuItems : menuItems.filter(m => (m.category || 'Other') === menuCatFilter);
  if (searchTerm) {
    items = items.filter(m => 
      (m.name || '').toLowerCase().includes(searchTerm) || 
      (m.description || '').toLowerCase().includes(searchTerm) || 
      (m.category || '').toLowerCase().includes(searchTerm)
    );
  }
  if (!items.length) { grid.innerHTML = '<div class="empty-state">No items found.</div>'; return; }

  grid.innerHTML = items.map(m => {
    const bannerClass = m.available === false ? 'off' : 'on';
    const bannerText = m.available === false ? 'Unavailable' : 'Available';
    const imgHtml = m.imageUrl 
      ? `<img src="${m.imageUrl}" alt="${m.name || ''}" class="menu-card-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="menu-card-img-placeholder" style="display:none;">🍽️</div>`
      : `<div class="menu-card-img-placeholder">🍽️</div>`;
    
    const itemName = m.name || '';
    const orderCount = menuOrderCounts[itemName]?.served || 0;
    const atLimit = orderCount >= ORDER_LIMIT;
    const warningHtml = orderCount > 0 ? `<div class="menu-card-orders ${atLimit ? 'at-limit' : ''}">${orderCount}/${ORDER_LIMIT} served orders${atLimit ? ' ⚠️' : ''}</div>` : '';
    
    return `
      <div class="menu-card ${!m.available ? 'unavailable' : ''}">
        ${imgHtml}
        <div class="menu-avail-banner ${bannerClass}">
          <span class="menu-avail-banner-dot"></span>${bannerText}
        </div>
        <div class="menu-card-body">
          <div class="menu-card-cat">${m.category || 'Other'}</div>
          <div class="menu-card-name">${m.name || '—'}</div>
          <div class="menu-card-desc">${m.description || ''}</div>
          ${warningHtml}
        </div>
        <div class="menu-card-footer">
          <span class="menu-card-price">₱${(m.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          <div class="menu-card-actions">
            <button class="btn-sm" onclick="window._editMenu('${m.id}')">Edit</button>
            <button class="btn-sm danger" onclick="window._deleteMenu('${m.id}')">Del</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

if (document.getElementById('addMenuItemBtn')) {
  document.getElementById('addMenuItemBtn').onclick = () => {
    editMenuId = null;
    document.getElementById('menuModalTitle').textContent = 'Add Menu Item';
    ['menuItemName', 'menuItemPrice', 'menuItemCategory', 'menuItemDesc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const avail = document.getElementById('menuItemAvail'); if (avail) avail.value = 'true';
    clearImagePreview();
    document.getElementById('menuModal').classList.add('show');
  };
}

function clearImagePreview() {
  pendingImageFile = null;
  currentImageUrl = null;
  const imgPreview = document.getElementById('imgPreview');
  if (imgPreview) { imgPreview.src = ''; imgPreview.classList.remove('visible'); }
  const zone = document.getElementById('imgUploadZone');
  if (zone) zone.classList.remove('has-img');
}

window._editMenu = id => {
  const item = menuItems.find(m => m.id === id);
  if (!item) return;
  editMenuId = id;
  document.getElementById('menuModalTitle').textContent = 'Edit Menu Item';
  document.getElementById('menuItemName').value = item.name || '';
  document.getElementById('menuItemPrice').value = item.price || '';
  document.getElementById('menuItemCategory').value = item.category || '';
  document.getElementById('menuItemDesc').value = item.description || '';
  const avail = document.getElementById('menuItemAvail'); if (avail) avail.value = item.available === false ? 'false' : 'true';
  clearImagePreview();
  if (item.imageUrl) { currentImageUrl = item.imageUrl; const img = document.getElementById('imgPreview'); if (img) img.src = item.imageUrl; }
  document.getElementById('menuModal').classList.add('show');
};

window._deleteMenu = async id => {
  if (!confirm('Delete this menu item?')) return;
  await deleteDoc(doc(db, 'menu', id));
  await loadMenu();
  showToast('Item deleted.');
};

if (document.getElementById('menuModalClose')) {
  document.getElementById('menuModalClose').onclick = () => { document.getElementById('menuModal').classList.remove('show'); clearImagePreview(); };
}
if (document.getElementById('menuModalCancel')) {
  document.getElementById('menuModalCancel').onclick = () => { document.getElementById('menuModal').classList.remove('show'); clearImagePreview(); };
}

if (document.getElementById('menuModalSave')) {
  document.getElementById('menuModalSave').onclick = async () => {
    const name = document.getElementById('menuItemName')?.value.trim();
    const price = parseFloat(document.getElementById('menuItemPrice')?.value) || 0;
    const category = document.getElementById('menuItemCategory')?.value.trim();
    const description = document.getElementById('menuItemDesc')?.value.trim();
    const available = document.getElementById('menuItemAvail')?.value === 'true';

    if (!name) { showToast('Please enter a name.'); return; }

    const btn = document.getElementById('menuModalSave');
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      const data = { name, price, category, description, available, imageUrl: currentImageUrl };
      if (editMenuId) {
        await updateDoc(doc(db, 'menu', editMenuId), data);
      } else {
        await addDoc(collection(db, 'menu'), data);
      }
      document.getElementById('menuModal').classList.remove('show');
      clearImagePreview();
      await loadMenu();
      showToast(editMenuId ? 'Item updated.' : 'Item added.');
    } catch (e) { console.error(e); showToast('Failed to save item.'); }
    finally { btn.disabled = false; btn.textContent = 'Save Item'; }
  };
}