import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp({ apiKey: "AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain: "salo-sa-antipolo.firebaseapp.com", projectId: "salo-sa-antipolo", storageBucket: "salo-sa-antipolo.firebasestorage.app", messagingSenderId: "60032898501", appId: "1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db = getFirestore(app);

function escapeHtml(s) { return (s + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

// ── Toast ──
let showToast = m => console.log(m);
const toastEl = document.getElementById('toast');
const toastMsgEl = document.getElementById('toastMsg');
if (toastEl && toastMsgEl) {
  showToast = (m, type = '') => {
    toastMsgEl.textContent = m;
    toastEl.className = 'toast' + (type ? ' toast-' + type : '');
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 3000);
  };
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
  loadMenu();
});

// ── Logout ──
if (document.getElementById('logoutBtn')) {
  document.getElementById('logoutBtn').onclick = async () => {
    try { await signOut(auth); } catch(e) {}
    window.location.href = '../admin-login.html';
  };
}

// ── Date ──
if (document.getElementById('pageDate')) {
  document.getElementById('pageDate').textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Sidebar ──
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');
if (hamburger) hamburger.onclick = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
if (overlay) overlay.onclick = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

// ── State ──
let menuItems = [];
let editMenuId = null;
let menuCatFilter = 'all';
let menuSearchQuery = '';
let pendingImageFile = null;
let currentImageUrl = null;
let allOrders = [];
let menuOrderCounts = {};
const ORDER_LIMIT = 20;

// ── Bento time-window (11 AM – 3 PM) ──
const BENTO_WINDOW = { start: 11, end: 15 };
function isBentoItem(name = '') { return name.toLowerCase().includes('bento'); }
function isBentoWindowOpen() { const h = new Date().getHours() + new Date().getMinutes()/60; return h >= BENTO_WINDOW.start && h < BENTO_WINDOW.end; }
function getBentoWindowLabel() { return 'Available 11:00 AM – 3:00 PM only'; }

// ── Orders (for badge + counts) ──
getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'))).then(snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  calculateMenuOrderCounts(); updateOrdersBadge(); renderMenuGrid();
});
onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  calculateMenuOrderCounts(); updateOrdersBadge(); renderMenuGrid();
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

// ── Menu load ──
async function loadMenu() {
  if (!document.getElementById('menuGrid')) return;
  const snap = await getDocs(collection(db, 'menu'));
  menuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  buildMenuCategoryTabs(); renderMenuGrid();
}

onSnapshot(collection(db, 'menu'), snap => {
  menuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  buildMenuCategoryTabs(); renderMenuGrid();
});

// ── Search ──
const menuSearch = document.getElementById('menuSearch');
if (menuSearch) menuSearch.addEventListener('input', e => { menuSearchQuery = e.target.value; renderMenuGrid(); });

// ── Category dropdown ──
function buildMenuCategoryTabs() {
  const wrap = document.getElementById('menuCategoryTabs');
  if (!wrap) return;
  const cats = ['all', ...new Set(menuItems.map(m => m.category || 'Other'))];

  // Render a custom dropdown
  wrap.innerHTML = `
    <div class="cat-dropdown" id="catDropdown">
      <button class="cat-dropdown-btn" id="catDropdownBtn" type="button">
        <span class="cat-dropdown-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
        </span>
        <span class="cat-dropdown-label" id="catDropdownLabel">${menuCatFilter === 'all' ? 'All Categories' : escapeHtml(menuCatFilter)}</span>
        <span class="cat-dropdown-count" id="catDropdownCount">${menuCatFilter === 'all' ? menuItems.length : menuItems.filter(m => (m.category||'Other') === menuCatFilter).length}</span>
        <svg class="cat-dropdown-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="cat-dropdown-menu" id="catDropdownMenu">
        ${cats.map(c => {
          const count = c === 'all' ? menuItems.length : menuItems.filter(m => (m.category||'Other') === c).length;
          const active = menuCatFilter === c;
          return `<button class="cat-dropdown-item${active ? ' active' : ''}" data-cat="${escapeHtml(c)}" type="button">
            <span class="cat-dropdown-item-name">${c === 'all' ? 'All Categories' : escapeHtml(c)}</span>
            <span class="cat-dropdown-item-count">${count}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;

  const btn = document.getElementById('catDropdownBtn');
  const menu = document.getElementById('catDropdownMenu');
  const label = document.getElementById('catDropdownLabel');
  const countEl = document.getElementById('catDropdownCount');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.classList.toggle('show');
    btn.classList.toggle('open', open);
  });

  menu.querySelectorAll('.cat-dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      menuCatFilter = item.dataset.cat;
      label.textContent = menuCatFilter === 'all' ? 'All Categories' : menuCatFilter;
      const cnt = menuCatFilter === 'all' ? menuItems.length : menuItems.filter(m => (m.category||'Other') === menuCatFilter).length;
      countEl.textContent = cnt;
      menu.querySelectorAll('.cat-dropdown-item').forEach(x => x.classList.remove('active'));
      item.classList.add('active');
      menu.classList.remove('show');
      btn.classList.remove('open');
      renderMenuGrid();
    });
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) { menu.classList.remove('show'); btn.classList.remove('open'); }
  }, { capture: true });
}

// ── Render grid ──
function renderMenuGrid() {
  const grid = document.getElementById('menuGrid');
  if (!grid) return;
  const searchTerm = (menuSearchQuery || '').trim().toLowerCase();
  let items = menuCatFilter === 'all' ? menuItems : menuItems.filter(m => (m.category || 'Other') === menuCatFilter);
  if (searchTerm) items = items.filter(m =>
    (m.name || '').toLowerCase().includes(searchTerm) ||
    (m.description || '').toLowerCase().includes(searchTerm) ||
    (m.category || '').toLowerCase().includes(searchTerm)
  );
  if (!items.length) { grid.innerHTML = '<div class="empty-state">No items found.</div>'; return; }
  grid.innerHTML = items.map(m => {
    const isBento = isBentoItem(m.name);
    const bentoWindowOpen = isBentoWindowOpen();
    const effectivelyUnavailable = m.available === false || (isBento && !bentoWindowOpen);
    const bannerClass = effectivelyUnavailable ? 'off' : 'on';
    const bannerText = m.available === false ? 'Unavailable' : (isBento && !bentoWindowOpen ? 'Outside Hours' : 'Available');
    const imgHtml = m.imageUrl
      ? `<img src="${escapeHtml(m.imageUrl)}" alt="${escapeHtml(m.name || '')}" class="menu-card-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="menu-card-img-placeholder" style="display:none;"><img src="../image/logo.png" alt="Salo sa Antipolo" class="menu-card-logo-placeholder" /></div>`
      : `<div class="menu-card-img-placeholder"><img src="../image/logo.png" alt="Salo sa Antipolo" class="menu-card-logo-placeholder" /></div>`;
    const itemName = m.name || '';
    const orderCount = menuOrderCounts[itemName]?.served || 0;
    const atLimit = orderCount >= ORDER_LIMIT;
    const warningHtml = orderCount > 0 ? `<div class="menu-card-orders ${atLimit ? 'at-limit' : ''}">${orderCount}/${ORDER_LIMIT} served orders${atLimit ? ' ⚠️' : ''}</div>` : '';
    const bentoTagHtml = isBento ? `<div class="menu-card-time-tag ${bentoWindowOpen ? 'time-tag-open' : 'time-tag-closed'}">🕐 ${getBentoWindowLabel()}</div>` : '';
    return `
      <div class="menu-card ${effectivelyUnavailable ? 'unavailable' : ''}">
        ${imgHtml}
        <div class="menu-avail-banner ${bannerClass}">
          <span class="menu-avail-banner-dot"></span>${bannerText}
        </div>
        <div class="menu-card-body">
          <div class="menu-card-cat">${escapeHtml(m.category || 'Other')}</div>
          <div class="menu-card-name">${escapeHtml(m.name || '—')}</div>
          <div class="menu-card-desc">${escapeHtml(m.description || '')}</div>
          ${bentoTagHtml}
          ${warningHtml}
        </div>
        <div class="menu-card-footer">
          <span class="menu-card-price">₱${(m.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
          <div class="menu-card-actions">
            <button class="btn-sm" onclick="window._editMenu('${m.id}')">Edit</button>
            <button class="btn-sm danger" onclick="window._deleteMenu('${m.id}', '${escapeHtml((m.name || 'this item').replace(/'/g, "\\'"))}')">Del</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Image upload helpers ──
function clearImagePreview() {
  pendingImageFile = null;
  currentImageUrl = null;
  const imgPreview = document.getElementById('imgPreview');
  if (imgPreview) { imgPreview.src = ''; imgPreview.classList.remove('visible'); }
  const zone = document.getElementById('imgUploadZone');
  if (zone) zone.classList.remove('has-img');
  const nameEl = document.getElementById('imgStripName');
  if (nameEl) nameEl.textContent = '';
}

function setImagePreview(src, name) {
  currentImageUrl = src;
  const imgPreview = document.getElementById('imgPreview');
  if (imgPreview) { imgPreview.src = src; imgPreview.classList.add('visible'); }
  const zone = document.getElementById('imgUploadZone');
  if (zone) zone.classList.add('has-img');
  const nameEl = document.getElementById('imgStripName');
  if (nameEl) nameEl.textContent = name || '';
}

// Wire up image upload zone
const imgUploadZone = document.getElementById('imgUploadZone');
const menuItemImageInput = document.getElementById('menuItemImage');

if (imgUploadZone && menuItemImageInput) {
  imgUploadZone.addEventListener('click', e => {
    if (e.target.closest('#imgRemoveBtn')) return;
    menuItemImageInput.click();
  });

  menuItemImageInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2 MB.', 'error'); return; }
    pendingImageFile = file;
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(ev.target.result, file.name);
    reader.readAsDataURL(file);
  });

  imgUploadZone.addEventListener('dragover', e => { e.preventDefault(); imgUploadZone.classList.add('drag-over'); });
  imgUploadZone.addEventListener('dragleave', () => imgUploadZone.classList.remove('drag-over'));
  imgUploadZone.addEventListener('drop', e => {
    e.preventDefault(); imgUploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2 MB.', 'error'); return; }
    pendingImageFile = file;
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(ev.target.result, file.name);
    reader.readAsDataURL(file);
  });
}

const imgRemoveBtn = document.getElementById('imgRemoveBtn');
if (imgRemoveBtn) imgRemoveBtn.addEventListener('click', e => { e.stopPropagation(); clearImagePreview(); if (menuItemImageInput) menuItemImageInput.value = ''; });

// ── Open / close menu modal ──
function openMenuModal() { document.getElementById('menuModal').classList.add('show'); }
function closeMenuModal() {
  document.getElementById('menuModal').classList.remove('show');
  clearImagePreview();
  const notice = document.getElementById('bentoTimeNotice');
  if (notice) notice.remove();
}

if (document.getElementById('addMenuItemBtn')) {
  document.getElementById('addMenuItemBtn').onclick = () => {
    editMenuId = null;
    document.getElementById('menuModalTitle').textContent = 'Add Menu Item';
    ['menuItemName', 'menuItemPrice', 'menuItemCategory', 'menuItemDesc'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const avail = document.getElementById('menuItemAvail'); if (avail) avail.value = 'true';
    clearImagePreview();
    openMenuModal();
  };
}

if (document.getElementById('menuModalClose')) document.getElementById('menuModalClose').onclick = closeMenuModal;
if (document.getElementById('menuModalCancel')) document.getElementById('menuModalCancel').onclick = closeMenuModal;

// Close on backdrop click
document.getElementById('menuModal').addEventListener('click', e => {
  if (e.target === document.getElementById('menuModal')) closeMenuModal();
});

// ── Edit ──
window._editMenu = id => {
  const item = menuItems.find(m => m.id === id);
  if (!item) return;
  editMenuId = id;
  document.getElementById('menuModalTitle').textContent = 'Edit Menu Item';
  document.getElementById('menuItemName').value = item.name || '';
  document.getElementById('menuItemPrice').value = item.price || '';
  document.getElementById('menuItemCategory').value = item.category || '';
  document.getElementById('menuItemDesc').value = item.description || '';
  const avail = document.getElementById('menuItemAvail');
  if (avail) avail.value = item.available === false ? 'false' : 'true';
  const existingNotice = document.getElementById('bentoTimeNotice');
  if (existingNotice) existingNotice.remove();
  if (isBentoItem(item.name)) {
    const open = isBentoWindowOpen();
    const notice = document.createElement('div');
    notice.id = 'bentoTimeNotice';
    notice.style.cssText = `display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;font-size:12.5px;font-weight:500;margin-top:2px;background:${open?'rgba(201,151,58,0.12)':'rgba(192,57,43,0.12)'};border:1px solid ${open?'rgba(201,151,58,0.35)':'rgba(192,57,43,0.35)'};color:${open?'var(--gold)':'#e07070'};`;
    notice.innerHTML = `<span style="font-size:15px">${open?'🟢':'🔴'}</span> Bento items are only available <strong style="margin:0 3px">11:00 AM – 3:00 PM</strong>. Currently <strong style="margin-left:3px">${open?'within':'outside'}</strong> serving hours.`;
    const modalBody = document.querySelector('#menuModal .page-modal-body');
    if (modalBody) modalBody.prepend(notice);
  }
  clearImagePreview();
  if (item.imageUrl) setImagePreview(item.imageUrl, 'Current photo');
  openMenuModal();
};

// ── Save ──
if (document.getElementById('menuModalSave')) {
  document.getElementById('menuModalSave').onclick = async () => {
    const name = document.getElementById('menuItemName')?.value.trim();
    const price = parseFloat(document.getElementById('menuItemPrice')?.value) || 0;
    const category = document.getElementById('menuItemCategory')?.value.trim();
    const description = document.getElementById('menuItemDesc')?.value.trim();
    const available = document.getElementById('menuItemAvail')?.value === 'true';
    if (!name) { showToast('Please enter an item name.', 'error'); return; }
    const btn = document.getElementById('menuModalSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const data = { name, price, category, description, available, imageUrl: currentImageUrl || null };
      if (editMenuId) {
        await updateDoc(doc(db, 'menu', editMenuId), data);
        showToast('Item updated.', 'success');
      } else {
        await addDoc(collection(db, 'menu'), data);
        showToast('Item added.', 'success');
      }
      closeMenuModal();
      await loadMenu();
    } catch (e) {
      console.error(e); showToast('Failed to save item.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Item';
    }
  };
}

// ── Delete with custom confirm modal ──
const confirmModal = document.getElementById('confirmModal');
let pendingDeleteId = null;

function openConfirmModal(id, name) {
  pendingDeleteId = id;
  document.getElementById('confirmItemName').textContent = `"${name}"`;
  confirmModal.classList.add('show');
}
function closeConfirmModal() {
  confirmModal.classList.remove('show');
  pendingDeleteId = null;
}

window._deleteMenu = (id, name) => openConfirmModal(id, name);

document.getElementById('confirmModalClose').onclick = closeConfirmModal;
document.getElementById('confirmCancelBtn').onclick = closeConfirmModal;
confirmModal.addEventListener('click', e => { if (e.target === confirmModal) closeConfirmModal(); });

document.getElementById('confirmDeleteBtn').onclick = async () => {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('confirmDeleteBtn');
  btn.disabled = true; btn.textContent = 'Deleting…';
  try {
    await deleteDoc(doc(db, 'menu', pendingDeleteId));
    closeConfirmModal();
    await loadMenu();
    showToast('Item deleted.', 'success');
  } catch (e) {
    console.error(e); showToast('Failed to delete item.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Delete';
  }
};