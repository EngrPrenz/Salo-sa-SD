import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app  = initializeApp({ 
  apiKey:"AIzaSyCKQneulIrm9KWuOg69f29nFo6TGz2PF4w", 
  authDomain:"salo-sa-antipolo.firebaseapp.com", 
  projectId:"salo-sa-antipolo", 
  storageBucket:"salo-sa-antipolo.firebasestorage.app", 
  messagingSenderId:"60032898501", 
  appId:"1:60032898501:web:3a4e663fee4ccd2adae7ac" 
});
const auth = getAuth(app);
const db   = getFirestore(app);

const loginBtn = document.getElementById('loginBtn');
const emailEl  = document.getElementById('email');
const pwEl     = document.getElementById('password');
const errMsg   = document.getElementById('errorMsg');
const errTxt   = document.getElementById('errorText');
const togglePw = document.getElementById('togglePw');
const toast    = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');

// Auto-redirect if already authenticated as cashier
onAuthStateChanged(auth, async user => {
  if (!user) return;
  try {
    const snap = await getDoc(doc(db, 'Users', user.uid));
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.role === 'admin_cashier') {
      sessionStorage.setItem('userRole', 'admin_cashier');
      sessionStorage.setItem('userName', data.name || user.email);
      sessionStorage.setItem('userId', user.uid);
      sessionStorage.setItem('useCashierInterface', 'true'); // Flag to prevent admin redirect
      window.location.href = 'cashier.html';
    }
  } catch (_) {}
});

togglePw.onclick = () => {
  const t = pwEl.type === 'text';
  pwEl.type = t ? 'password' : 'text';
  togglePw.textContent = t ? '👁' : '⌣';
};

const showToast = m => { 
  toastMsg.textContent = m; 
  toast.classList.add('show'); 
  setTimeout(() => toast.classList.remove('show'), 3000); 
};

const showError = m => { 
  errTxt.textContent = m; 
  errMsg.classList.remove('show'); 
  requestAnimationFrame(() => errMsg.classList.add('show')); 
};

const setLoad = v => { 
  loginBtn.disabled = v; 
  loginBtn.classList.toggle('loading', v); 
};

/**
 * Authenticate cashier with email and password
 * Validates credentials and role before granting access
 */
async function authenticateCashier(email, password) {
  errMsg.classList.remove('show');
  
  if (!email || !password) { 
    showError('Please enter your email and password.'); 
    return; 
  }
  
  setLoad(true);
  
  try {
    // Set session persistence
    await setPersistence(auth, browserLocalPersistence);
    
    // Authenticate with Firebase
    const cred = await signInWithEmailAndPassword(auth, email, password);
    
    // Verify user exists in database
    const snap = await getDoc(doc(db, 'Users', cred.user.uid));
    if (!snap.exists()) {
      showError('Account not found. Please contact admin.');
      await auth.signOut();
      setLoad(false);
      return;
    }
    
    const data = snap.data();
    
    // Verify cashier role (accept admin_cashier)
    if (data.role !== 'admin_cashier') {
      showError('This portal is for cashiers only. Use Admin or Waiter Login.');
      await auth.signOut();
      setLoad(false);
      return;
    }
    
    // Store session data
    sessionStorage.setItem('userRole', 'admin_cashier');
    sessionStorage.setItem('userName', data.name || email);
    sessionStorage.setItem('userId', cred.user.uid);
    sessionStorage.setItem('useCashierInterface', 'true'); // Flag to prevent admin redirect
    
    showToast(`Welcome, ${data.name || 'Cashier'}!`);
    setTimeout(() => window.location.href = 'cashier.html', 1500);
  } catch (err) {
    setLoad(false);
    const c = err.code;
    
    if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(c)) {
      showError('Invalid email or password. Try again.');
    } else if (c === 'auth/too-many-requests') {
      showError('Too many attempts. Please wait and try again.');
    } else if (c === 'auth/invalid-email') {
      showError('Please enter a valid email address.');
    } else {
      showError('Something went wrong. Please try again.');
    }
  }
}

loginBtn.onclick = async () => {
  const email = emailEl.value.trim();
  const pw = pwEl.value;
  await authenticateCashier(email, pw);
};

[emailEl, pwEl].forEach(el => el.addEventListener('keydown', e => {
  if (e.key === 'Enter') loginBtn.click();
}));

export { authenticateCashier, showError, showToast };
