/**
 * MessMate Pro - Frontend Application Engine
 * Handles Authentication, Real-time Meal Response, Public Transparency Ledger,
 * Direct UPI Scanner & Screenshot Proof Submissions, Admin Verification, and Cook Salary Tracking.
 */

// Global State
const state = {
  token: localStorage.getItem('mess_token') || null,
  user: JSON.parse(localStorage.getItem('mess_user') || 'null'),
  settings: null,
  activeView: 'auth',
  currentMonth: new Date().toISOString().slice(0, 7),
  todayDate: new Date().toISOString().split('T')[0],
  transparencyData: null,
  pendingProofs: [],
  billingCalc: null
};

// API Helpers
async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(endpoint, { ...options, headers });
    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = { success: false, message: 'Invalid server response' };
    }

    if (res.status === 401 && endpoint !== '/api/auth/login') {
      logout();
      showToast('Session expired. Please log in again.', 'warning');
      throw new Error(data?.message || 'Unauthorized');
    }
    return data;
  } catch (err) {
    console.error(`API Error on ${endpoint}:`, err);
    throw err;
  }
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : '⚠️');
  toast.innerHTML = `<span>${icon}</span><div>${message}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.animation = 'slideToast 0.3s reverse forwards ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, 3500);
}

function showToastWithAction(message, type = 'warning', actionLabel = 'Review', onAction = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : '🔔');
  toast.innerHTML = `
    <span>${icon}</span>
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.65rem; width: 100%;">
      <span>${message}</span>
      ${actionLabel ? `<button type="button" class="toast-action-btn">${actionLabel}</button>` : ''}
    </div>
  `;
  if (actionLabel && onAction) {
    const btn = toast.querySelector('.toast-action-btn');
    btn?.addEventListener('click', () => {
      try { onAction(); } catch (e) {}
      toast.remove();
    });
  }
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.animation = 'slideToast 0.3s reverse forwards ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, 6000);
}

// Utilities
function formatCurrency(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupNavigation();
  setupAuthEvents();
  setupMealEvents();
  setupPaymentEvents();
  setupAdminEvents();
  setupModalEvents();
  setupRoutineEvents();
  setupCornerWidgetEvents();
  updateDateTimeDisplay();
  setupSavingsCalculator();

  if (state.token && state.user) {
    onLoginSuccess(state.user, false);
  } else {
    switchView('auth');
  }
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('mess_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    document.getElementById('theme-icon').textContent = '☀️';
  }

  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('mess_theme', isLight ? 'light' : 'dark');
    document.getElementById('theme-icon').textContent = isLight ? '☀️' : '🌙';
  });
}

function updateDateTimeDisplay() {
  const elem = document.getElementById('current-date-time-display');
  if (elem) {
    const d = new Date();
    elem.textContent = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
}

// Navigation Bar
function setupNavigation() {
  document.getElementById('brand-home-btn')?.addEventListener('click', () => {
    if (state.user) {
      switchView(state.user.role === 'admin' ? 'admin' : 'user');
    } else {
      switchView('auth');
    }
  });

  document.getElementById('logout-btn')?.addEventListener('click', logout);
}

function renderNavLinks() {
  const navList = document.getElementById('main-nav-links');
  if (!navList) return;
  navList.innerHTML = '';

  if (!state.user) return;

  const links = [];
  if (state.user.role === 'admin') {
    links.push({ id: 'nav-admin', label: '📊 Manager Hub', view: 'admin' });
    links.push({ id: 'nav-transparency', label: '👑 Transparency Board', view: 'transparency' });
    links.push({ id: 'nav-menu', label: '📅 Food & Market Routine', view: 'menu' });
  } else {
    links.push({ id: 'nav-user', label: '🍽️ My Meals & Bill', view: 'user' });
    links.push({ id: 'nav-menu', label: '📅 Food & Market Routine', view: 'menu' });
  }

  links.forEach(item => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = `nav-item-btn ${state.activeView === item.view ? 'active' : ''}`;
    btn.innerHTML = item.label;
    btn.id = item.id;
    btn.addEventListener('click', () => switchView(item.view));
    li.appendChild(btn);
    navList.appendChild(li);
  });

  const logoutLi = document.createElement('li');
  const logoutNavBtn = document.createElement('button');
  logoutNavBtn.className = 'nav-item-btn nav-logout-btn';
  logoutNavBtn.innerHTML = '🚪 Logout';
  logoutNavBtn.title = 'Logout from account';
  logoutNavBtn.addEventListener('click', logout);
  logoutLi.appendChild(logoutNavBtn);
  navList.appendChild(logoutLi);
}

function switchView(viewName) {
  if (viewName === 'transparency' && (!state.user || state.user.role !== 'admin')) {
    showToast('Access denied: Community Transparency is restricted to Admin only.', 'warning');
    switchView(state.user ? 'user' : 'auth');
    return;
  }

  state.activeView = viewName;
  const views = ['auth', 'user', 'transparency', 'admin', 'menu'];

  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = (v === viewName) ? 'block' : 'none';
  });

  document.querySelectorAll('.nav-item-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`nav-${viewName}`);
  if (activeBtn) activeBtn.classList.add('active');

  if (viewName === 'user') {
    loadUserDashboard();
  } else if (viewName === 'transparency') {
    loadTransparencyBoard();
  } else if (viewName === 'admin') {
    loadAdminDashboard();
  } else if (viewName === 'menu') {
    loadWeeklyMenu();
  }
}

// REAL-TIME AUDIO & NOTIFICATIONS
function playNotificationChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.12);
    gain2.gain.setValueAtTime(0.25, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.65);
  } catch (e) {}
}

const messSyncChannel = (typeof window !== 'undefined' && 'BroadcastChannel' in window)
  ? new BroadcastChannel('mess_portal_sync')
  : null;

if (messSyncChannel) {
  messSyncChannel.onmessage = (event) => {
    const data = event.data;
    if (!data) return;

    if (data.type === 'NEW_STUDENT_REGISTERED') {
      if (state.token && state.user && state.user.role === 'admin') {
        playNotificationChime();
        showToastWithAction(`🔔 New student registration: ${data.student?.name || 'Student'}!`, 'warning', 'Review & Approve', () => {
          document.getElementById('admin-tab-pending-btn')?.click();
        });
        pulsePendingBadge();
        loadAdminPendingUsers();
        pollAdminUpdates();
      }
    } else if (data.type === 'STUDENT_APPROVED') {
      if (currentPendingIdentifier) {
        handleStudentApprovalSuccess({
          isApproved: true,
          status: 'active',
          name: data.name,
          email: data.email
        });
      }
      if (state.token && state.user && state.user.role === 'admin') {
        loadAdminPendingUsers();
        loadAdminUsersDirectory();
        pollAdminUpdates();
      }
    } else if (data.type === 'STUDENT_REJECTED') {
      if (currentPendingIdentifier) {
        handleStudentRejection({
          status: 'rejected',
          name: data.name
        });
      }
      if (state.token && state.user && state.user.role === 'admin') {
        loadAdminPendingUsers();
        pollAdminUpdates();
      }
    }
  };
}

function pulsePendingBadge() {
  const badge = document.getElementById('admin-pending-badge');
  if (badge) {
    badge.style.transition = 'transform 0.25s ease';
    badge.style.transform = 'scale(1.5)';
    setTimeout(() => { badge.style.transform = 'scale(1)'; }, 450);
  }
}

let adminPollingTimer = null;
let adminEventSource = null;
let lastAdminCounts = { users: null, proofs: null, resets: null };

function startAdminSSE() {
  stopAdminSSE();
  if (!state.token || !state.user || state.user.role !== 'admin') return;
  try {
    adminEventSource = new EventSource(`/api/admin/live-stream?token=${encodeURIComponent(state.token)}`);
    adminEventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'NEW_STUDENT_REGISTERED') {
          playNotificationChime();
          showToastWithAction(`🔔 New student registration: ${data.student?.name || 'Student'}!`, 'warning', 'Review & Approve', () => {
            document.getElementById('admin-tab-pending-btn')?.click();
          });
          pulsePendingBadge();
          loadAdminPendingUsers();
          pollAdminUpdates();
        } else if (data.type === 'STUDENT_STATUS_CHANGED') {
          loadAdminPendingUsers();
          loadAdminUsersDirectory();
          pollAdminUpdates();
        } else if (data.type === 'NEW_PAYMENT_PROOF') {
          playNotificationChime();
          showToast(`📥 New payment proof submitted!`, 'info');
          loadAdminPendingProofs();
          pollAdminUpdates();
        } else if (data.type === 'NEW_RESET_REQUEST') {
          playNotificationChime();
          showToast(`🔑 New password reset request!`, 'info');
          loadPasswordResetRequests();
          pollAdminUpdates();
        }
      } catch (err) {}
    };
    adminEventSource.onerror = () => {};
  } catch (err) {}
}

function stopAdminSSE() {
  if (adminEventSource) {
    adminEventSource.close();
    adminEventSource = null;
  }
}

function startAdminPolling() {
  stopAdminPolling();
  lastAdminCounts = { users: null, proofs: null, resets: null };
  startAdminSSE();
  pollAdminUpdates();
  adminPollingTimer = setInterval(pollAdminUpdates, 2500);
}

function stopAdminPolling() {
  stopAdminSSE();
  if (adminPollingTimer) {
    clearInterval(adminPollingTimer);
    adminPollingTimer = null;
  }
}

async function pollAdminUpdates() {
  if (!state.token || !state.user || state.user.role !== 'admin') {
    stopAdminPolling();
    return;
  }

  try {
    const res = await apiRequest('/api/admin/dashboard-stats');
    if (!res || !res.success || !res.stats) return;
    const stats = res.stats;

    renderAdminStats(stats);

    const curUsers = Number(stats.pending_users_count || 0);
    const curProofs = Number(stats.pending_proofs_count || 0);
    const curResets = Number(stats.pending_resets_count || 0);

    if (lastAdminCounts.users !== null) {
      if (curUsers > lastAdminCounts.users) {
        const diff = curUsers - lastAdminCounts.users;
        playNotificationChime();
        showToastWithAction(`🔔 ${diff} new student registration pending approval!`, 'warning', 'Review & Approve', () => {
          document.getElementById('admin-tab-pending-btn')?.click();
        });
        pulsePendingBadge();
      }

      if (curProofs > lastAdminCounts.proofs) {
        const diff = curProofs - lastAdminCounts.proofs;
        playNotificationChime();
        showToast(`📥 ${diff} new payment proof submitted for verification!`, 'info');
        const proofsPane = document.getElementById('admin-tab-content-proofs');
        if (proofsPane && proofsPane.style.display !== 'none') {
          loadAdminPendingProofs();
        }
      }

      if (curResets > lastAdminCounts.resets) {
        const diff = curResets - lastAdminCounts.resets;
        playNotificationChime();
        showToast(`🔑 ${diff} new password reset request received!`, 'info');
        const resetsPane = document.getElementById('admin-tab-content-resets');
        if (resetsPane && resetsPane.style.display !== 'none') {
          loadPasswordResetRequests();
        }
      }
    }

    const pendingPane = document.getElementById('admin-tab-content-pending');
    if ((lastAdminCounts.users !== null && curUsers !== lastAdminCounts.users) || (pendingPane && pendingPane.style.display !== 'none')) {
      loadAdminPendingUsers();
    }

    lastAdminCounts.users = curUsers;
    lastAdminCounts.proofs = curProofs;
    lastAdminCounts.resets = curResets;
  } catch (err) {}
}

let studentApprovalPollTimer = null;
let studentEventSource = null;
let currentPendingIdentifier = null;

function startStudentSSE(identifier) {
  stopStudentSSE();
  try {
    studentEventSource = new EventSource(`/api/auth/live-approval-stream?identifier=${encodeURIComponent(identifier)}`);
    studentEventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.isApproved || data.status === 'active') {
          stopStudentSSE();
          handleStudentApprovalSuccess(data);
        } else if (data.status === 'rejected') {
          stopStudentSSE();
          handleStudentRejection(data);
        }
      } catch (err) {}
    };
    studentEventSource.onerror = () => {};
  } catch (err) {}
}

function stopStudentSSE() {
  if (studentEventSource) {
    studentEventSource.close();
    studentEventSource = null;
  }
}

function showStudentPendingCard(identifier, studentName = '') {
  stopStudentPendingPolling();
  currentPendingIdentifier = identifier;

  const card = document.getElementById('student-approval-status-card');
  if (!card) return;

  const displayTarget = studentName ? `<strong>${escapeHtml(studentName)}</strong> (${escapeHtml(identifier)})` : `<strong>${escapeHtml(identifier)}</strong>`;

  card.innerHTML = `
    <div style="background: rgba(245, 158, 11, 0.12); border: 1.5px solid rgba(245, 158, 11, 0.45); border-radius: var(--radius-md); padding: 1.15rem; text-align: center; animation: shakeError 0.3s ease;">
      <div style="font-size: 2.2rem; margin-bottom: 0.25rem;">⏳</div>
      <h4 style="color: #fbbf24; margin: 0 0 0.35rem; font-size: 1.05rem; font-weight: 700;">Account Pending Mess Manager Approval</h4>
      <p style="font-size: 0.83rem; color: var(--text-secondary); margin: 0 0 0.75rem; line-height: 1.45;">
        Registration submitted for ${displayTarget}.<br>
        The Mess Manager has been alerted instantly. As soon as approved, you will be signed in.
      </p>
      <div style="display: flex; gap: 0.6rem; justify-content: center; align-items: center; flex-wrap: wrap;">
        <button type="button" id="btn-manual-check-approval" class="btn btn-sm btn-outline" style="border-color: #f59e0b; color: #fbbf24; font-size: 0.8rem; padding: 0.35rem 0.85rem;">
          🔄 Check Status Now
        </button>
      </div>
      <div id="student-approval-poll-status" style="font-size: 0.74rem; color: var(--text-muted); margin-top: 0.5rem;">
        ⚡ Instant real-time stream active...
      </div>
    </div>
  `;
  card.style.display = 'block';

  document.getElementById('btn-manual-check-approval')?.addEventListener('click', () => {
    checkStudentApprovalStatus(true);
  });

  startStudentSSE(identifier);

  studentApprovalPollTimer = setInterval(() => {
    checkStudentApprovalStatus(false);
  }, 2500);
}

function stopStudentPendingPolling() {
  stopStudentSSE();
  if (studentApprovalPollTimer) {
    clearInterval(studentApprovalPollTimer);
    studentApprovalPollTimer = null;
  }
}

function handleStudentApprovalSuccess(res) {
  stopStudentPendingPolling();
  playNotificationChime();

  const studentName = res.name || state.pendingCredentials?.name || 'Student';
  const studentEmail = res.email || state.pendingCredentials?.email || currentPendingIdentifier;
  const studentPassword = state.pendingCredentials?.password || '';

  const card = document.getElementById('student-approval-status-card');
  if (card) {
    card.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.15); border: 1.5px solid #10b981; border-radius: var(--radius-md); padding: 1.25rem; text-align: center; animation: shakeError 0.3s ease;">
        <div style="font-size: 2.3rem; margin-bottom: 0.25rem;">🎉</div>
        <h4 style="color: #34d399; margin: 0 0 0.35rem; font-size: 1.1rem; font-weight: 700;">Account Approved!</h4>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 0.85rem; line-height: 1.45;">
          Welcome, <strong>${escapeHtml(studentName)}</strong>! Your registration was approved by the Mess Manager. Your credentials have been entered below.
        </p>
        <button type="button" id="btn-quick-signin" class="btn btn-primary" style="background: #10b981; border-color: #10b981; font-weight: 700; padding: 0.6rem 1.4rem; font-size: 0.95rem; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.35);">
          🚀 Click Here to Sign In Now
        </button>
      </div>
    `;

    document.getElementById('btn-quick-signin')?.addEventListener('click', () => {
      document.getElementById('login-submit-btn')?.click();
    });
  }

  showToast(`🎉 Account approved! You can now sign in as ${studentName}.`, 'success');

  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  if (emailInput) emailInput.value = studentEmail;
  if (passwordInput && studentPassword) {
    passwordInput.value = studentPassword;
  }

  const quickBtn = document.getElementById('btn-quick-signin');
  if (quickBtn) quickBtn.focus();
  else if (passwordInput) passwordInput.focus();
}

function handleStudentRejection(res) {
  stopStudentPendingPolling();
  const card = document.getElementById('student-approval-status-card');
  if (card) {
    card.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.15); border: 1.5px solid #ef4444; border-radius: var(--radius-md); padding: 1rem; text-align: center;">
        <div style="font-size: 1.8rem; margin-bottom: 0.3rem;">❌</div>
        <h4 style="color: #f87171; margin: 0 0 0.35rem; font-size: 1rem; font-weight: 700;">Registration Rejected</h4>
        <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0;">
          Your registration request was rejected by the Mess Manager. Please contact administration.
        </p>
      </div>
    `;
  }
}

async function checkStudentApprovalStatus(isManual = false) {
  if (!currentPendingIdentifier) return;
  const statusHint = document.getElementById('student-approval-poll-status');
  if (isManual && statusHint) statusHint.textContent = 'Checking with server...';

  try {
    const res = await apiRequest(`/api/auth/check-status?identifier=${encodeURIComponent(currentPendingIdentifier)}`);
    if (!res || !res.success) return;

    if (res.isApproved) {
      handleStudentApprovalSuccess(res);
    } else if (res.status === 'rejected') {
      handleStudentRejection(res);
    } else {
      if (isManual) {
        showToast('Account is still awaiting approval by the Mess Manager.', 'info');
        if (statusHint) statusHint.textContent = '⏳ Still awaiting approval. Real-time stream active...';
      }
    }
  } catch (err) {}
}

function setupPasswordToggles() {
  const toggleLogin = document.getElementById('toggle-login-password');
  const inputLogin = document.getElementById('login-password');
  if (toggleLogin && inputLogin) {
    toggleLogin.onclick = (e) => {
      e.preventDefault();
      const isPwd = inputLogin.type === 'password';
      inputLogin.type = isPwd ? 'text' : 'password';
      toggleLogin.textContent = isPwd ? '🙈' : '👁️';
    };
  }

  const toggleReg = document.getElementById('toggle-reg-password');
  const inputReg = document.getElementById('reg-password');
  if (toggleReg && inputReg) {
    toggleReg.onclick = (e) => {
      e.preventDefault();
      const isPwd = inputReg.type === 'password';
      inputReg.type = isPwd ? 'text' : 'password';
      toggleReg.textContent = isPwd ? '🙈' : '👁️';
    };
  }
}

function setupAuthEvents() {
  setupPasswordToggles();
  const tabLogin = document.getElementById('tab-login-btn');
  const tabAdminLogin = document.getElementById('tab-admin-login-btn');
  const tabReg = document.getElementById('tab-register-btn');
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');
  const loginBtn = document.getElementById('login-submit-btn');

  const headerIcon = document.getElementById('auth-header-icon');
  const headerTitle = document.getElementById('auth-header-title');
  const headerDesc = document.getElementById('auth-header-desc');
  const switchFooter = document.getElementById('login-switch-footer');
  const loginErrorAlert = document.getElementById('login-error-alert');
  const loginErrorText = document.getElementById('login-error-text');
  const loginErrorHeading = document.getElementById('login-error-heading');
  const loginErrorIcon = document.getElementById('login-error-icon');
  const emailInput = document.getElementById('login-email');
  const emailLabel = document.getElementById('login-email-label');
  const passwordInput = document.getElementById('login-password');

  function showLoginError(message, heading = 'Incorrect Details', isWarning = false) {
    if (loginErrorAlert && loginErrorText) {
      if (loginErrorHeading) loginErrorHeading.textContent = heading;
      loginErrorText.textContent = message;
      if (loginErrorIcon) loginErrorIcon.textContent = isWarning ? '⏳' : '⚠️';

      if (isWarning) {
        loginErrorAlert.classList.add('warning');
      } else {
        loginErrorAlert.classList.remove('warning');
      }

      loginErrorAlert.style.display = 'flex';
      loginErrorAlert.style.animation = 'none';
      void loginErrorAlert.offsetWidth;
      loginErrorAlert.style.animation = 'shakeError 0.35s ease';
    }
    if (!isWarning) {
      if (emailInput) emailInput.classList.add('input-error');
      if (passwordInput) passwordInput.classList.add('input-error');
    }
  }

  function hideLoginError() {
    if (loginErrorAlert) loginErrorAlert.style.display = 'none';
    if (emailInput) emailInput.classList.remove('input-error');
    if (passwordInput) passwordInput.classList.remove('input-error');
  }

  emailInput?.addEventListener('input', hideLoginError);
  passwordInput?.addEventListener('input', hideLoginError);

  if (tabLogin) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabAdminLogin?.classList.remove('active');
      tabReg?.classList.remove('active');
      hideLoginError();
      if (headerIcon) headerIcon.textContent = '🎓';
      if (headerTitle) headerTitle.textContent = 'Student Portal Login';
      if (headerDesc) headerDesc.textContent = 'Sign in to mark meal attendance, check your monthly dues, and view market duty.';
      if (loginForm) loginForm.style.display = 'block';
      if (regForm) regForm.style.display = 'none';
      if (switchFooter) switchFooter.style.display = 'block';
      if (emailLabel) emailLabel.textContent = 'Email or Mobile Number';
      if (emailInput) {
        emailInput.value = '';
        emailInput.placeholder = 'Enter student email or 10-digit mobile';
      }
      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.placeholder = '••••••••';
      }
      if (loginBtn) loginBtn.textContent = 'Sign In as Student';
    });
  }

  if (tabAdminLogin) {
    tabAdminLogin.addEventListener('click', () => {
      tabAdminLogin.classList.add('active');
      tabLogin?.classList.remove('active');
      tabReg?.classList.remove('active');
      hideLoginError();
      stopStudentPendingPolling();
      const card = document.getElementById('student-approval-status-card');
      if (card) card.style.display = 'none';

      if (headerIcon) headerIcon.textContent = '👑';
      if (headerTitle) headerTitle.textContent = 'Mess Admin / Manager Login';
      if (headerDesc) headerDesc.textContent = 'Sign in to manage kitchen headcounts, market duties, student approvals, and billing.';
      if (loginForm) loginForm.style.display = 'block';
      if (regForm) regForm.style.display = 'none';
      if (switchFooter) switchFooter.style.display = 'none';
      if (emailLabel) emailLabel.textContent = 'Admin Email Address';
      if (emailInput) {
        emailInput.value = '';
        emailInput.placeholder = 'Enter admin email';
      }
      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.placeholder = '••••••••';
      }
      if (loginBtn) loginBtn.textContent = 'Sign In as Mess Manager';
    });
  }

  if (tabReg) {
    tabReg.addEventListener('click', () => {
      tabReg.classList.add('active');
      tabLogin?.classList.remove('active');
      tabAdminLogin?.classList.remove('active');
      hideLoginError();
      stopStudentPendingPolling();
      const card = document.getElementById('student-approval-status-card');
      if (card) card.style.display = 'none';

      if (headerIcon) headerIcon.textContent = '📝';
      if (headerTitle) headerTitle.textContent = 'Student Registration';
      if (headerDesc) headerDesc.textContent = 'Create your student account. Access will be activated upon admin approval.';
      if (regForm) regForm.style.display = 'block';
      if (loginForm) loginForm.style.display = 'none';
    });
  }

  document.getElementById('switch-to-register-link')?.addEventListener('click', () => {
    tabReg?.click();
  });

  document.getElementById('switch-to-login-link')?.addEventListener('click', () => {
    tabLogin?.click();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideLoginError();

    const email = emailInput?.value?.trim() || '';
    const password = passwordInput?.value || '';
    const btn = document.getElementById('login-submit-btn');
    const isAdminActive = tabAdminLogin?.classList.contains('active');

    if (!email || !password) {
      showLoginError('Please enter both your email/mobile number and password.', 'Missing Required Fields');
      if (!email && emailInput) emailInput.focus();
      else if (!password && passwordInput) passwordInput.focus();
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = 'Verifying...';

      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      if (res && res.success) {
        stopStudentPendingPolling();
        const card = document.getElementById('student-approval-status-card');
        if (card) card.style.display = 'none';

        state.token = res.token;
        state.user = res.user;
        localStorage.setItem('mess_token', res.token);
        localStorage.setItem('mess_user', JSON.stringify(res.user));
        showToast(res.message || 'Login successful!', 'success');
        onLoginSuccess(res.user);
      } else {
        const errorMsg = res?.message || 'Incorrect email/mobile number or password. Please check your credentials and try again.';
        if (res?.isPending) {
          showStudentPendingCard(res?.email || email, '');
          showLoginError(errorMsg, 'Account Pending Approval', true);
          showToast(errorMsg, 'warning');
        } else {
          showLoginError(errorMsg, 'Incorrect Details', false);
          showToast(errorMsg, 'error');
        }
      }
    } catch (err) {
      const errorMsg = err.message || 'Incorrect email/mobile number or password. Please try again.';
      showLoginError(errorMsg, 'Authentication Error', false);
      showToast(errorMsg, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = isAdminActive ? 'Sign In as Mess Manager' : 'Sign In as Student';
    }
  });

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const room_no = document.getElementById('reg-room').value.trim();
    const rawPhone = document.getElementById('reg-phone').value.trim();
    const phone = rawPhone.replace(/\D/g, '').slice(-10);
    const password = document.getElementById('reg-password').value;
    const cleanPassword = password.trim();
    const btn = document.getElementById('register-submit-btn');

    if (!name || !email || !password) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    if (cleanPassword.length < 6) {
      showToast('Password must be at least 6 characters long.', 'error');
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = 'Submitting Registration...';

      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          room_no,
          phone,
          password: cleanPassword
        })
      });

      if (res && res.success) {
        state.pendingCredentials = { name, email, password: cleanPassword };

        if (messSyncChannel) {
          try {
            messSyncChannel.postMessage({
              type: 'NEW_STUDENT_REGISTERED',
              student: res.user || { name, email, phone, room_no }
            });
          } catch (err) {}
        }

        regForm.reset();
        tabLogin.click();
        const emailInput = document.getElementById('login-email');
        const passwordInput = document.getElementById('login-password');
        if (emailInput) emailInput.value = email;
        if (passwordInput) passwordInput.value = cleanPassword;

        showStudentPendingCard(email, name);
        showToast('Registration submitted! Awaiting Mess Manager approval.', 'warning');
      } else {
        showToast(res?.message || 'Registration failed', 'error');
      }
    } catch (err) {
      showToast('Registration failed. Please check your information.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register as Student';
    }
  });
}

function onLoginSuccess(user, announce = true) {
  const pill = document.getElementById('user-profile-pill');
  if (pill) pill.style.display = 'flex';
  const unauthBtns = document.getElementById('unauth-nav-btns');
  if (unauthBtns) unauthBtns.style.display = 'none';

  document.getElementById('nav-user-name').textContent = user.name;
  document.getElementById('nav-user-avatar').textContent = user.name.charAt(0).toUpperCase();

  const roleTag = document.getElementById('nav-user-role');
  const avatar = document.getElementById('nav-user-avatar');

  if (user.role === 'admin') {
    roleTag.textContent = 'Mess Manager';
    roleTag.className = 'user-role-tag admin-tag';
    avatar.className = 'user-avatar admin-avatar';
    document.getElementById('portal-mode-badge').textContent = 'Manager Mode';
  } else {
    roleTag.textContent = user.room_no ? user.room_no : 'Student';
    roleTag.className = 'user-role-tag';
    avatar.className = 'user-avatar';
    document.getElementById('portal-mode-badge').textContent = 'Student Portal';
  }

  renderNavLinks();
  switchView(user.role === 'admin' ? 'admin' : 'user');
  loadGlobalCornerHeadcount();

  if (user.role === 'admin') {
    startAdminPolling();
  } else {
    stopAdminPolling();
  }
}

function logout() {
  stopAdminPolling();
  stopStudentPendingPolling();
  const studentCard = document.getElementById('student-approval-status-card');
  if (studentCard) studentCard.style.display = 'none';

  state.token = null;
  state.user = null;
  localStorage.removeItem('mess_token');
  localStorage.removeItem('mess_user');
  document.getElementById('user-profile-pill').style.display = 'none';
  const unauthBtns = document.getElementById('unauth-nav-btns');
  if (unauthBtns) unauthBtns.style.display = 'flex';

  const cornerWidget = document.getElementById('corner-headcount-widget');
  if (cornerWidget) cornerWidget.style.display = 'none';

  document.getElementById('main-nav-links').innerHTML = '';
  document.getElementById('portal-mode-badge').textContent = 'Live System';
  switchView('auth');
  showToast('Logged out successfully', 'success');
}
window.logout = logout;

async function loadGlobalCornerHeadcount() {
  const widget = document.getElementById('corner-headcount-widget');
  if (!widget) return;

  if (!state.token || !state.user) {
    widget.style.display = 'none';
    return;
  }

  try {
    const res = await apiRequest('/api/meals/headcount-summary');
    if (res && res.success) {
      widget.style.display = 'block';

      const totalEl = document.getElementById('corner-total-students');
      if (totalEl) totalEl.textContent = `👥 Total: ${res.total_students}`;

      const mEat = document.getElementById('corner-morning-eating');
      if (mEat) mEat.textContent = res.breakfast.eating;

      const mSkip = document.getElementById('corner-morning-skip');
      if (mSkip) mSkip.textContent = res.breakfast.not_eating;

      const nEat = document.getElementById('corner-night-eating');
      if (nEat) nEat.textContent = res.dinner.eating;

      const nSkip = document.getElementById('corner-night-skip');
      if (nSkip) nSkip.textContent = res.dinner.not_eating;

      const updatedEl = document.getElementById('corner-last-updated');
      if (updatedEl) {
        const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        updatedEl.textContent = `Live (${timeStr})`;
      }
    }
  } catch (err) {}
}

function setupCornerWidgetEvents() {
  const toggleBtn = document.getElementById('corner-toggle-btn');
  const widget = document.getElementById('corner-headcount-widget');
  if (toggleBtn && widget) {
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      widget.classList.toggle('minimized');
      toggleBtn.textContent = widget.classList.contains('minimized') ? '▴' : '▾';
    };
    widget.onclick = () => {
      if (widget.classList.contains('minimized')) {
        widget.classList.remove('minimized');
        toggleBtn.textContent = '▾';
      }
    };
  }
}

// USER DASHBOARD LOGIC
async function loadUserDashboard() {
  try {
    loadTodayMarketDutyWidget('user');
    loadGlobalCornerHeadcount();

    const mealRes = await apiRequest(`/api/meals/my?month=${state.currentMonth}`);
    if (mealRes.success) {
      renderUserMeals(mealRes);
    }

    const billRes = await apiRequest(`/api/billing/my?month=${state.currentMonth}`);
    if (billRes.success) {
      renderUserBilling(billRes);
    }

    loadUserPaymentHistory();

  } catch (err) {
    console.error('Error loading dashboard:', err);
  }
}

function renderUserMeals(mealData) {
  const todayStr = state.todayDate;
  const dateBadge = document.getElementById('today-date-badge') || document.getElementById('meal-date-label');
  if (dateBadge) dateBadge.textContent = formatDate(todayStr);

  const todayMeal = (mealData.meals || []).find(m => m.date === todayStr);

  const morningToggle = document.getElementById('toggle-morning') || document.getElementById('user-morning-toggle');
  const nightToggle = document.getElementById('toggle-night') || document.getElementById('user-night-toggle');

  const isMorningEating = todayMeal ? (todayMeal.morning === 1) : true;
  const isNightEating = todayMeal ? (todayMeal.night === 1) : true;

  if (morningToggle) morningToggle.checked = isMorningEating;
  if (nightToggle) nightToggle.checked = isNightEating;

  const summary = mealData.summary || {};
  const mealCountEl = document.getElementById('user-stat-meals');
  if (mealCountEl) mealCountEl.textContent = summary.total_meals || 0;
}

function setupMealEvents() {
  const morningToggle = document.getElementById('toggle-morning') || document.getElementById('user-morning-toggle');
  const nightToggle = document.getElementById('toggle-night') || document.getElementById('user-night-toggle');

  if (morningToggle) {
    morningToggle.addEventListener('change', async () => {
      const morning = morningToggle.checked ? 1 : 0;
      const night = nightToggle ? (nightToggle.checked ? 1 : 0) : 1;
      await saveMealAttendance(state.todayDate, morning, night);
    });
  }

  if (nightToggle) {
    nightToggle.addEventListener('change', async () => {
      const morning = morningToggle ? (morningToggle.checked ? 1 : 0) : 1;
      const night = nightToggle.checked ? 1 : 0;
      await saveMealAttendance(state.todayDate, morning, night);
    });
  }
}

async function saveMealAttendance(date, morning, night) {
  try {
    const res = await apiRequest('/api/meals/mark', {
      method: 'POST',
      body: JSON.stringify({ date, morning, night })
    });
    if (res.success) {
      showToast(`Saved preference for ${date}: Breakfast ${morning ? 'EATING' : 'NOT EATING'}, Dinner ${night ? 'EATING' : 'NOT EATING'}`);
      loadUserDashboard();
      loadGlobalCornerHeadcount();
    }
  } catch (err) {
    showToast('Failed to save meal response', 'error');
  }
}

function renderUserBilling(billData) {
  const bill = billData.current_bill || {};
  const settings = billData.settings || {};
  state.settings = settings;

  const monthlyFeeVal = bill.monthly_fee || settings.monthly_fee || 700;
  const prevDue = bill.prev_due || 0;
  const masiFee = bill.masi_fee || settings.masi_fee || 400;
  const totalPayable = bill.total_payable || (monthlyFeeVal + prevDue + masiFee);
  const paidAmount = bill.paid_amount || 0;
  const dueBalance = Math.max(0, totalPayable - paidAmount);

  document.getElementById('user-stat-total-due').textContent = formatCurrency(dueBalance);
}

async function loadUserPaymentHistory() {
  try {
    const res = await apiRequest('/api/payments/my');
    const tbody = document.getElementById('user-payment-history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!res.success || !res.payments || res.payments.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">No payment submissions recorded yet.</td></tr>`;
      return;
    }

    res.payments.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(p.payment_date || p.created_at)}</td>
        <td><strong>${p.month}</strong></td>
        <td style="color: var(--primary); font-weight: 700;">${formatCurrency(p.amount)}</td>
        <td><code>${p.utr_number}</code></td>
        <td><a href="${p.screenshot_path}" target="_blank" class="btn btn-outline btn-sm">View Proof</a></td>
        <td><span class="status-pill status-${p.status.toLowerCase()}">${p.status}</span></td>
        <td>${p.admin_note || '-'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {}
}

// ADMIN DASHBOARD
async function loadAdminDashboard() {
  try {
    loadTodayMarketDutyWidget('admin');
    loadGlobalCornerHeadcount();

    const statsRes = await apiRequest('/api/admin/dashboard-stats');
    if (statsRes.success) {
      renderAdminStats(statsRes.stats);
    }

    loadAdminDateHeadcount(state.todayDate);
    loadAdminPendingProofs();
    loadAdminPendingUsers();
    loadAdminMasiFund();
    loadAdminUsersDirectory();

  } catch (err) {}
}

function renderAdminStats(stats) {
  if (document.getElementById('admin-stat-morning')) document.getElementById('admin-stat-morning').textContent = stats.today_morning_eating || 0;
  if (document.getElementById('admin-stat-night')) document.getElementById('admin-stat-night').textContent = stats.today_night_eating || 0;
  if (document.getElementById('admin-stat-pending-users')) document.getElementById('admin-stat-pending-users').textContent = stats.pending_users_count || 0;
  if (document.getElementById('admin-pending-badge')) document.getElementById('admin-pending-badge').textContent = stats.pending_users_count || 0;
}

async function loadAdminDateHeadcount(dateStr) {
  try {
    const res = await apiRequest(`/api/meals/date/${dateStr}`);
    const tbody = document.getElementById('admin-meals-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!res.success || !res.members || res.members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No members registered yet.</td></tr>`;
      return;
    }

    res.members.forEach(m => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${m.room_no || 'N/A'}</strong></td>
        <td>${m.name}</td>
        <td>${m.morning === 1 ? '☀️ Eating' : '❌ Skipping'}</td>
        <td>${m.night === 1 ? '🌙 Eating' : '❌ Skipping'}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="adminToggleMeal(${m.id}, '${dateStr}', ${m.morning === 1 ? 0 : 1}, ${m.night === 1 ? 0 : 1})">
            🔄 Toggle
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {}
}

// ADMIN PENDING STUDENT REGISTRATIONS QUEUE
async function loadAdminPendingUsers() {
  try {
    const res = await apiRequest('/api/admin/pending-students');
    const tbody = document.getElementById('admin-pending-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const badge = document.getElementById('admin-pending-badge');
    const stat = document.getElementById('admin-stat-pending-users');

    const pendingList = res.students || res.users || [];

    if (!res.success || pendingList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            ✅ No pending student approvals! All registrations have been processed.
          </td>
        </tr>
      `;
      if (badge) badge.textContent = '0';
      if (stat) stat.textContent = '0';
      return;
    }

    if (badge) badge.textContent = pendingList.length;
    if (stat) stat.textContent = pendingList.length;

    pendingList.forEach(u => {
      const tr = document.createElement('tr');
      const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';

      tr.innerHTML = `
        <td><small style="color: var(--text-secondary);">${dateStr}</small></td>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td><span style="font-family: monospace; color: var(--accent);">${escapeHtml(u.email)}</span></td>
        <td><span class="badge-tag" style="background: rgba(255,255,255,0.06);">${escapeHtml(u.room_no || 'N/A')}</span></td>
        <td>${escapeHtml(u.phone || '-')}</td>
        <td><span class="status-pill status-pending">PENDING APPROVAL</span></td>
        <td>
          <div style="display: flex; gap: 0.4rem; align-items: center;">
            <button class="btn btn-primary btn-sm" style="background: #10b981; border-color: #10b981; padding: 0.25rem 0.65rem; font-size: 0.78rem;" onclick="approveStudent(${u.id}, '${encodeURIComponent(u.name)}')">
              ✅ Approve
            </button>
            <button class="btn btn-outline btn-sm" style="color: #f87171; border-color: rgba(239, 68, 68, 0.4); padding: 0.25rem 0.65rem; font-size: 0.78rem;" onclick="rejectStudent(${u.id}, '${encodeURIComponent(u.name)}')">
              ❌ Reject
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching pending users:', err);
  }
}

window.approveStudent = async function(userId, encodedName) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`Approve student registration for "${name}"?\n\nThey will immediately be allowed to sign in with their email and password.`)) {
    return;
  }

  try {
    const res = await apiRequest(`/api/admin/approve-student/${userId}`, {
      method: 'POST'
    });
    if (res.success) {
      showToast(res.message, 'success');
      loadAdminPendingUsers();
      loadAdminUsersDirectory();
      loadAdminDashboard();
    } else {
      showToast(res.message || 'Failed to approve student', 'error');
    }
  } catch (err) {
    showToast('Failed to approve student', 'error');
  }
};

window.rejectStudent = async function(userId, encodedName) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`Reject registration for "${name}"?\n\nThis account will not be allowed to sign in.`)) {
    return;
  }

  try {
    const res = await apiRequest(`/api/admin/reject-student/${userId}`, {
      method: 'POST'
    });
    if (res.success) {
      showToast(res.message, 'warning');
      loadAdminPendingUsers();
      loadAdminUsersDirectory();
      loadAdminDashboard();
    } else {
      showToast(res.message || 'Failed to reject student', 'error');
    }
  } catch (err) {
    showToast('Failed to reject student', 'error');
  }
};

async function loadAdminPendingProofs() {}
async function loadAdminMasiFund() {}
async function loadAdminUsersDirectory() {}
async function loadTransparencyBoard() {}

// MARKET DUTY WIDGET WITH UNBLOCKED ERROR HANDLING
async function loadTodayMarketDutyWidget(viewType = 'user') {
  try {
    const res = await apiRequest('/api/meals/today-duty');
    if (!res || !res.success) return;

    const dayNameEl = document.getElementById(`${viewType}-today-day-name`) || document.getElementById('today-day-name') || document.getElementById('current-date-time-display');
    const dutyTeamEl = document.getElementById(`${viewType}-today-duty-team`) || document.getElementById('today-duty-team');
    const morningDishEl = document.getElementById(`${viewType}-today-morning-dish`) || document.getElementById('today-morning-dish');
    const nightDishEl = document.getElementById(`${viewType}-today-night-dish`) || document.getElementById('today-night-dish');

    const dayName = res.dayName || new Date().toLocaleDateString('en-IN', { weekday: 'long' });
    const todayData = res.today || {};
    const bengaliDay = todayData.bengali_day ? ` • ${todayData.bengali_day}` : '';

    if (dayNameEl) dayNameEl.textContent = `Today: ${dayName}${bengaliDay}`;
    if (dutyTeamEl) {
      dutyTeamEl.innerHTML = todayData.market_duty 
        ? `<span style="color: #34d399; font-weight: 700;">🛒 ${todayData.market_duty}</span>`
        : 'No squad assigned';
    }
    if (morningDishEl) morningDishEl.textContent = todayData.morning_menu || 'Not scheduled';
    if (nightDishEl) nightDishEl.textContent = todayData.night_menu || 'Not scheduled';
  } catch (err) {
    console.warn('Market duty widget notice:', err.message);
    const dayNameEl = document.getElementById(`${viewType}-today-day-name`) || document.getElementById('today-day-name');
    if (dayNameEl) {
      dayNameEl.textContent = `Today: ${new Date().toLocaleDateString('en-IN', { weekday: 'long' })}`;
    }
  }
}

async function loadWeeklyMenu() {}
function setupRoutineEvents() {}
function setupPaymentEvents() {}
function setupAdminEvents() {}
function setupModalEvents() {}
function setupSavingsCalculator() {}