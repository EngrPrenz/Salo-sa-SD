import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { bootstrapAdmin } from './admin-auth.js';

const app = initializeApp({ apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", authDomain:"salo-sa-antipolo.firebaseapp.com", projectId:"salo-sa-antipolo", storageBucket:"salo-sa-antipolo.firebasestorage.app", messagingSenderId:"60032898501", appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" });
const auth = getAuth(app);
const db   = getFirestore(app);

function escapeHtml(s) { return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s)  { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToast = m => console.log(m);
const toastEl  = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
if (toastEl && toastMsg) {
  showToast = m => { toastMsg.textContent=m; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),3000); };
}

// ── Confirm modal ─────────────────────────────────────────────────────────────
function showConfirm({ icon='⚠️', title='Confirm', message, okLabel='Confirm', onOk }) {
  const modal = document.getElementById('confirmModal'); if(!modal){if(onOk&&window.confirm(message))onOk();return;}
  document.getElementById('confirmIcon').textContent   = icon;
  document.getElementById('confirmTitle').textContent  = title;
  document.getElementById('confirmMessage').textContent = message;
  const okBtn = document.getElementById('confirmOk'); okBtn.textContent = okLabel;
  modal.classList.add('show');
  if (window.lucide) lucide.createIcons();
  const close = () => modal.classList.remove('show');
  const cleanup = () => {
    ['confirmOk','confirmCancel','confirmModalClose'].forEach(id => {
      const el=document.getElementById(id); if(el){const clone=el.cloneNode(true);el.parentNode.replaceChild(clone,el);}
    });
  };
  const handler  = () => { close(); cleanup(); if(onOk) onOk(); };
  const cancelH  = () => { close(); cleanup(); };
  document.getElementById('confirmOk')?.addEventListener('click', handler, {once:true});
  document.getElementById('confirmCancel')?.addEventListener('click', cancelH, {once:true});
  document.getElementById('confirmModalClose')?.addEventListener('click', cancelH, {once:true});
}

// ── State ─────────────────────────────────────────────────────────────────────
let tableStatuses = {};
let tableDocsList = [];
let allOrders     = [];

// ── Bootstrap then start listeners ───────────────────────────────────────────
bootstrapAdmin(auth, db, { doc, getDoc, signOut }, 'admin-tables.html')
  .then(() => startListeners());

function startListeners() {
  // Show skeleton in tables grid while waiting for first snapshot
  const grid = document.getElementById('tablesGrid');
  if (grid) {
    grid.innerHTML = Array(8).fill(null).map((_,i) =>
      `<div style="border-radius:12px;height:110px;background:linear-gradient(90deg,var(--black-mid) 25%,var(--black-light) 50%,var(--black-mid) 75%);background-size:600px 100%;animation:shimmer 1.4s ${i*0.08}s infinite linear;"></div>`
    ).join('');
  }

  onSnapshot(query(collection(db,'orders'), orderBy('createdAt','desc')), snap => {
    allOrders = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    updateOrdersBadge();
  });

  onSnapshot(collection(db,'tables'), snap => {
    tableStatuses = {}; tableDocsList = [];
    snap.forEach(d => {
      const data=d.data();
      const rawNum=data.tableNumber?parseInt(data.tableNumber):parseInt(d.id.replace('table_',''));
      const num=isNaN(rawNum)?null:rawNum; if(!num) return;
      if(tableStatuses[num]&&!data.tableNumber) return;
      tableStatuses[num]={docId:d.id,...data,tableNumber:num};
      const idx=tableDocsList.findIndex(t=>t.tableNumber===num);
      if(idx!==-1) tableDocsList.splice(idx,1);
      tableDocsList.push({docId:d.id,tableNumber:num,...data});
    });
    tableDocsList.sort((a,b)=>a.tableNumber-b.tableNumber);
    renderTablesGrid();
    updateTableCountStat();
  });
}

function updateOrdersBadge() {
  const active=allOrders.filter(o=>['pending','preparing'].includes(o.status)).length;
  const badge=document.getElementById('ordersBadge');
  if(badge){badge.textContent=active;badge.style.display=active>0?'inline-flex':'none';}
}

const STATUS_CFG = {
  free:      {icon:'armchair',     label:'Free',      textColor:'#5e5e5e'},
  occupied:  {icon:'users',        label:'Occupied',  textColor:'#e07070'},
  'walk-in': {icon:'users',        label:'Walk-in',   textColor:'#e8c07a'},
  pending:   {icon:'clock',        label:'Pending',   textColor:'#f39c12'},
  preparing: {icon:'chef-hat',     label:'Preparing', textColor:'#3498db'},
  served:    {icon:'check-circle', label:'Served',    textColor:'#2ecc71'},
  billed:    {icon:'banknote',     label:'Billed',    textColor:'#9b59b6'},
};

function updateTableCountStat() {
  const el=document.getElementById('tablesToolbarTitle'); if(el) el.textContent=`${tableDocsList.length} Tables`;
}

function renderTablesGrid() {
  const grid=document.getElementById('tablesGrid'); if(!grid) return;
  const cards=tableDocsList.map(entry=>{
    const n=entry.tableNumber, data=tableStatuses[n];
    const rawSt=(data?.status||'free').toLowerCase().trim();
    const st=rawSt==='available'?'free':rawSt;
    const cfg=STATUS_CFG[st]||STATUS_CFG.free;
    const waiter=data?.waiterName||null;
    const label=data?.name||`Table ${n}`, cap=data?.capacity?`· ${data.capacity} seats`:'';
    return `
      <div class="table-card ${st}">
        <div class="table-card-num" style="color:${cfg.textColor}">${escapeHtml(label)}</div>
        ${cap?`<div class="table-card-info muted" style="font-size:11px;margin-top:-6px;">${escapeHtml(cap)}</div>`:''}
        <div class="table-card-icon"><i data-lucide="${cfg.icon}"></i></div>
        <div class="table-card-status">
          <span class="status-badge ${st}" style="color:${cfg.textColor};border-color:${cfg.textColor}33;background:${cfg.textColor}18">${cfg.label}</span>
        </div>
        ${renderTableDetail(st, cfg, waiter)}
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button class="btn-sm" style="flex:1;" onclick="window._openEditTableModal(${n})"><i data-lucide="edit-3"></i></button>
          <button class="btn-sm danger" onclick="window._deleteTable(${n})"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  });
  cards.push(`<div class="table-card free add-table-card" onclick="window._openAddTableModal()" style="cursor:pointer;border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0.65;">
    <i data-lucide="plus" style="font-size:32px;"></i>
    <div style="font-size:13px;font-weight:600;color:var(--text-muted);">Add Table</div>
  </div>`);
  grid.innerHTML=cards.join('');
  setTimeout(()=>{if(window.lucide)lucide.createIcons();},100);
}

function renderTableDetail(st, cfg, waiter) {
  if(st==='free'){
    return `<div class="table-card-info muted">No waiter assigned</div>`;
  }
  return `<div class="table-card-info" style="color:${cfg.textColor}">${waiter?`<i data-lucide="user"></i> ${escapeHtml(waiter)}`:'No waiter assigned'}</div>`;
}

// ── Add / Edit table ──────────────────────────────────────────────────────────
window._openAddTableModal = () => openTableModal('add');
window._openEditTableModal = n => openTableModal('edit', n);
let tableModalMode='add', tableModalTarget=null;

function openTableModal(mode, tableNum=null) {
  tableModalMode=mode; tableModalTarget=tableNum;
  const modal=document.getElementById('tableModal'); if(!modal) return;
  const numRow=document.getElementById('tableModalNumberRow');
  document.getElementById('tableModalTitle').textContent = mode==='add'?'Add New Table':'Edit Table';
  if(numRow) numRow.style.display = mode==='add'?'':'none';
  if(mode==='add'){
    let next=1; while(tableDocsList.find(t=>t.tableNumber===next)) next++;
    const ni=document.getElementById('tableModalNumber'); if(ni) ni.value=next;
    const nn=document.getElementById('tableModalName'); if(nn) nn.value='';
    const nc=document.getElementById('tableModalCapacity'); if(nc) nc.value='';
  } else {
    const data=tableStatuses[tableNum];
    const nn=document.getElementById('tableModalName'); if(nn) nn.value=data?.name||'';
    const nc=document.getElementById('tableModalCapacity'); if(nc) nc.value=data?.capacity||'';
  }
  modal.classList.add('show');
  document.getElementById('tableModalName')?.focus();
}

document.getElementById('tableModalClose')?.addEventListener('click',  ()=>document.getElementById('tableModal').classList.remove('show'));
document.getElementById('tableModalCancel')?.addEventListener('click', ()=>document.getElementById('tableModal').classList.remove('show'));

document.getElementById('tableModalSave')?.addEventListener('click', async ()=>{
  const name=document.getElementById('tableModalName')?.value.trim();
  const capacity=document.getElementById('tableModalCapacity')?.value?parseInt(document.getElementById('tableModalCapacity').value):null;
  const btn=document.getElementById('tableModalSave');
  if(tableModalMode==='add'){
    const num=parseInt(document.getElementById('tableModalNumber')?.value);
    if(!num||num<1){showToast('Enter a valid table number.');return;}
    if(tableStatuses[num]){showToast(`Table ${num} already exists.`);return;}
    btn.disabled=true;btn.textContent='Saving…';
    try{await setDoc(doc(db,'tables',`table_${num}`),{tableNumber:num,name:name||null,capacity:capacity||null,status:'free',reservation:null,waiterId:null,waiterName:null,lastUpdated:serverTimestamp()});showToast(`Table ${num} added.`);document.getElementById('tableModal').classList.remove('show');}
    catch(e){showToast('Failed to add table.');console.error(e);}finally{btn.disabled=false;btn.textContent='Save';}
  }else{
    const data=tableStatuses[tableModalTarget]; if(!data){showToast('Table not found.');return;}
    btn.disabled=true;btn.textContent='Saving…';
    try{await updateDoc(doc(db,'tables',data.docId),{name:name||null,capacity:capacity||null,lastUpdated:serverTimestamp()});showToast(`Table ${tableModalTarget} updated.`);document.getElementById('tableModal').classList.remove('show');}
    catch(e){showToast('Failed to update table.');console.error(e);}finally{btn.disabled=false;btn.textContent='Save';}
  }
});

window._deleteTable = n => {
  const data=tableStatuses[n]; if(!data) return;
  const label=data.name?`"${data.name}" (Table ${n})`:`Table ${n}`;
  showConfirm({icon:'🗑️',title:'Delete Table',message:`Delete ${label}? This cannot be undone.`,okLabel:'Delete',
    onOk:async()=>{try{await deleteDoc(doc(db,'tables',data.docId));showToast(`${label} deleted.`);}catch(e){showToast('Failed.');console.error(e);}}
  });
};

// ── Clear all modal ───────────────────────────────────────────────────────────
document.getElementById('clearAllTablesBtn')?.addEventListener('click',  ()=>{document.getElementById('clearAllModal').classList.add('show');if(window.lucide)lucide.createIcons();});
document.getElementById('clearAllModalClose')?.addEventListener('click', ()=>document.getElementById('clearAllModal').classList.remove('show'));
document.getElementById('clearAllModalCancel')?.addEventListener('click',()=>document.getElementById('clearAllModal').classList.remove('show'));
document.getElementById('clearAllModalConfirm')?.addEventListener('click', async()=>{
  const btn=document.getElementById('clearAllModalConfirm');btn.disabled=true;btn.textContent='Clearing…';
  try{
    const snap=await getDocs(collection(db,'tables'));
    await Promise.all(snap.docs.map(d=>updateDoc(d.ref,{
      status:'free',
      reservation:null,
      reservations:[],
      waiterId:null,
      waiterName:null,
      assignedTo:null,
      lastUpdated:serverTimestamp()
    })));
    showToast('All tables cleared.');document.getElementById('clearAllModal').classList.remove('show');
  }catch(e){showToast('Failed to clear tables.');console.error(e);}
  finally{btn.disabled=false;btn.textContent='Yes, Clear All';}
});


