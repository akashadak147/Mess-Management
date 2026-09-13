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
      // Session expired for authenticated API calls
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
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : '⚠️');
  toast.innerHTML = `<span>${icon}</span><div>${message}</div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideToast 0.3s reverse forwards ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Format Currency
function formatCurrency(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

// Format Date
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Format Date & Time
function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Escape HTML utility
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

  // Check auth state
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
  const d = new Date();
  elem.textContent = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Navigation Bar & View Router
function setupNavigation() {
  document.getElementById('brand-home-btn').addEventListener('click', () => {
    if (state.user) {
      switchView(state.user.role === 'admin' ? 'admin' : 'user');
    } else {
      switchView('auth');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', logout);
}

function renderNavLinks() {
  const navList = document.getElementById('main-nav-links');
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
}

function switchView(viewName) {
  // Enforce security rule: Community Transparency is Admin-only
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

  // Update active class on nav links
  document.querySelectorAll('.nav-item-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`nav-${viewName}`);
  if (activeBtn) activeBtn.classList.add('active');

  // Trigger data loading for the activated view
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

// Authentication Handlers (Direct Student & Admin Portals)
function setupAuthEvents() {
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
      // Retrigger shake animation
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

  // Clear error alert as soon as the user edits credentials
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
      if (emailInput) {
        emailInput.value = '';
        emailInput.placeholder = 'Enter your student email';
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
      if (headerIcon) headerIcon.textContent = '👑';
      if (headerTitle) headerTitle.textContent = 'Mess Admin / Manager Login';
      if (headerDesc) headerDesc.textContent = 'Sign in to manage kitchen headcounts, market duties, student approvals, and billing.';
      if (loginForm) loginForm.style.display = 'block';
      if (regForm) regForm.style.display = 'none';
      if (switchFooter) switchFooter.style.display = 'none';
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

  // Navbar Quick Auth buttons
  document.getElementById('nav-student-quick-btn')?.addEventListener('click', () => {
    switchView('auth');
    tabLogin?.click();
  });
  document.getElementById('nav-manager-quick-btn')?.addEventListener('click', () => {
    switchView('auth');
    tabAdminLogin?.click();
  });

  // Login Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideLoginError();

    const email = emailInput?.value?.trim() || '';
    const password = passwordInput?.value || '';
    const btn = document.getElementById('login-submit-btn');
    const isAdminActive = tabAdminLogin?.classList.contains('active');

    if (!email || !password) {
      showLoginError('Please enter both your email address and password.', 'Missing Required Fields');
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
        state.token = res.token;
        state.user = res.user;
        localStorage.setItem('mess_token', res.token);
        localStorage.setItem('mess_user', JSON.stringify(res.user));
        showToast(res.message || 'Login successful!', 'success');
        onLoginSuccess(res.user);
      } else {
        const errorMsg = res?.message || 'Incorrect email or password. Please check your credentials and try again.';
        if (res?.isPending) {
          showLoginError(errorMsg, 'Account Pending Approval', true);
          showToast(errorMsg, 'warning');
        } else {
          showLoginError(errorMsg, 'Incorrect Email or Password', false);
          showToast(errorMsg, 'error');
        }
      }
    } catch (err) {
      const errorMsg = err.message || 'Incorrect email or password. Please try again.';
      showLoginError(errorMsg, 'Incorrect Email or Password', false);
      showToast(errorMsg, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = isAdminActive ? 'Sign In as Mess Manager' : 'Sign In as Student';
    }
  });

  // =========================================================================
  // 1. DIRECT STUDENT REGISTRATION (NO OTP)
  // =========================================================================
  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const room_no = document.getElementById('reg-room').value.trim();
    const rawPhone = document.getElementById('reg-phone').value.trim();
    const phone = rawPhone.replace(/\D/g, '').slice(-10);
    const password = document.getElementById('reg-password').value;
    const btn = document.getElementById('register-submit-btn');

    if (!name || !email || !password) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    if (password.length < 6) {
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
          password
        })
      });

      if (res && res.success) {
        if (res.pendingApproval) {
          regForm.reset();
          tabLogin.click();
          document.getElementById('login-email').value = email;
          document.getElementById('login-password').value = '';
          alert(`✅ Registration Submitted Successfully!\n\n${res.message}\n\nPlease ask your Mess Manager to approve your account. Once approved, you can sign in anytime using your email (${email}) and password.`);
          showToast('Registration submitted! Awaiting Mess Manager approval.', 'warning');
        } else {
          state.token = res.token;
          state.user = res.user;
          localStorage.setItem('mess_token', res.token);
          localStorage.setItem('mess_user', JSON.stringify(res.user));
          showToast('Account registered successfully!', 'success');
          onLoginSuccess(res.user);
        }
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

  // =========================================================================
  // 2. FORGOT PASSWORD: REQUEST NEW PASSWORD TO ADMIN
  // =========================================================================
  const forgotModal = document.getElementById('forgot-password-modal');
  const forgotModalClose = document.getElementById('forgot-modal-close-btn');
  const forgotLink = document.getElementById('forgot-password-link');
  const forgotRequestForm = document.getElementById('forgot-request-form');
  const forgotIdentifierInput = document.getElementById('forgot-identifier-input');
  const forgotNoteInput = document.getElementById('forgot-note-input');
  const forgotRequestSubmitBtn = document.getElementById('forgot-request-submit-btn');
  const forgotSuccessView = document.getElementById('forgot-success-view');
  const forgotSuccessDesc = document.getElementById('forgot-success-desc');
  const forgotDoneBtn = document.getElementById('forgot-done-btn');
  const forgotErrorAlert = document.getElementById('forgot-error-alert');
  const forgotErrorText = document.getElementById('forgot-error-text');

  function showForgotError(msg) {
    if (forgotErrorAlert && forgotErrorText) {
      forgotErrorText.textContent = msg;
      forgotErrorAlert.style.display = 'flex';
      forgotErrorAlert.style.animation = 'none';
      void forgotErrorAlert.offsetWidth;
      forgotErrorAlert.style.animation = 'shakeError 0.35s ease';
    }
  }

  function resetForgotModal() {
    if (forgotErrorAlert) forgotErrorAlert.style.display = 'none';
    if (forgotRequestForm) {
      forgotRequestForm.reset();
      forgotRequestForm.style.display = 'block';
    }
    if (forgotSuccessView) forgotSuccessView.style.display = 'none';
    if (forgotRequestSubmitBtn) {
      forgotRequestSubmitBtn.disabled = false;
      forgotRequestSubmitBtn.textContent = '📩 Send Reset Request to Admin';
    }
  }

  forgotLink?.addEventListener('click', () => {
    resetForgotModal();
    if (forgotModal) forgotModal.style.display = 'flex';
    forgotIdentifierInput?.focus();
  });

  forgotModalClose?.addEventListener('click', () => {
    if (forgotModal) forgotModal.style.display = 'none';
  });

  forgotDoneBtn?.addEventListener('click', () => {
    if (forgotModal) forgotModal.style.display = 'none';
    tabLogin?.click();
    document.getElementById('login-password')?.focus();
  });

  forgotModal?.addEventListener('click', (e) => {
    if (e.target === forgotModal) {
      forgotModal.style.display = 'none';
    }
  });

  forgotRequestForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = forgotIdentifierInput?.value?.trim() || '';
    const note = forgotNoteInput?.value?.trim() || '';

    if (!identifier) {
      showForgotError('Please enter your registered email address or mobile number.');
      forgotIdentifierInput?.focus();
      return;
    }

    try {
      if (forgotErrorAlert) forgotErrorAlert.style.display = 'none';
      forgotRequestSubmitBtn.disabled = true;
      forgotRequestSubmitBtn.textContent = 'Submitting Request...';

      const res = await apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ identifier, message: note })
      });

      if (res && res.success) {
        if (forgotRequestForm) forgotRequestForm.style.display = 'none';
        if (forgotSuccessView) forgotSuccessView.style.display = 'block';
        if (forgotSuccessDesc) {
          forgotSuccessDesc.textContent = res.message || 'Your password reset request has been received by the Mess Manager. Please contact your manager to collect your new password.';
        }
        showToast(res.message, res.alreadyPending ? 'info' : 'success');
      } else {
        showForgotError(res?.message || 'Failed to submit reset request. Please check your information.');
      }
    } catch (err) {
      showForgotError(err.message || 'Error submitting password reset request.');
    } finally {
      forgotRequestSubmitBtn.disabled = false;
      forgotRequestSubmitBtn.textContent = '📩 Send Reset Request to Admin';
    }
  });
}

function onLoginSuccess(user, announce = true) {
  // Update Profile Pill & Hide Unauthenticated Nav Buttons
  const pill = document.getElementById('user-profile-pill');
  pill.style.display = 'flex';
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
}

function logout() {
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

// Real-Time Corner Headcount Widget Logic (Visible to All Users & Admins)
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
  } catch (err) {
    console.warn('Could not load corner headcount:', err);
  }
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

// ============================================================================
// USER DASHBOARD LOGIC
// ============================================================================
async function loadUserDashboard() {
  try {
    // 0. Fetch Today's Market Duty & Dishes & Global Headcount
    loadTodayMarketDutyWidget('user');
    loadGlobalCornerHeadcount();

    // 1. Fetch Today's Meal Status for user
    const mealRes = await apiRequest(`/api/meals/my?month=${state.currentMonth}`);
    if (mealRes.success) {
      renderUserMeals(mealRes);
    }

    // 2. Fetch User Billing & Dues
    const billRes = await apiRequest(`/api/billing/my?month=${state.currentMonth}`);
    if (billRes.success) {
      renderUserBilling(billRes);
    }

    // 3. Fetch User Submitted Payments
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
  const morningBadge = document.getElementById('morning-status-badge');
  const nightBadge = document.getElementById('night-status-badge');
  const morningSub = document.getElementById('morning-status-sub');
  const nightSub = document.getElementById('night-status-sub');

  const isMorningMarked = todayMeal !== undefined && todayMeal.morning !== null;
  const isNightMarked = todayMeal !== undefined && todayMeal.night !== null;

  // Unmarked defaults to Eating (1)
  const isMorningEating = todayMeal ? (todayMeal.morning === 1) : true;
  const isNightEating = todayMeal ? (todayMeal.night === 1) : true;

  if (morningToggle) morningToggle.checked = isMorningEating;
  if (nightToggle) nightToggle.checked = isNightEating;

  if (morningBadge) {
    morningBadge.className = 'badge-tag';
    if (!isMorningMarked) {
      morningBadge.textContent = '🍽️ Eating (Default - Auto)';
      morningBadge.classList.add('badge-eating-default');
      if (morningSub) morningSub.textContent = 'Status: Scheduled to Eat by Default (Unmarked)';
    } else if (isMorningEating) {
      morningBadge.textContent = '🍽️ Eating (Confirmed)';
      morningBadge.classList.add('badge-eating-marked');
      if (morningSub) morningSub.textContent = 'Status: Confirmed Eating';
    } else {
      morningBadge.textContent = '❌ Not Eating (No-Show)';
      morningBadge.classList.add('badge-not-eating');
      if (morningSub) morningSub.textContent = 'Status: Opted Out / Skipping';
    }
  }

  if (nightBadge) {
    nightBadge.className = 'badge-tag';
    if (!isNightMarked) {
      nightBadge.textContent = '🍽️ Eating (Default - Auto)';
      nightBadge.classList.add('badge-eating-default');
      if (nightSub) nightSub.textContent = 'Status: Scheduled to Eat by Default (Unmarked)';
    } else if (isNightEating) {
      nightBadge.textContent = '🍽️ Eating (Confirmed)';
      nightBadge.classList.add('badge-eating-marked');
      if (nightSub) nightSub.textContent = 'Status: Confirmed Eating';
    } else {
      nightBadge.textContent = '❌ Not Eating (No-Show)';
      nightBadge.classList.add('badge-not-eating');
      if (nightSub) nightSub.textContent = 'Status: Opted Out / Skipping';
    }
  }

  // Fallback status text
  const morningText = document.getElementById('morning-status-text');
  const nightText = document.getElementById('night-status-text');
  if (morningText) {
    morningText.textContent = isMorningEating ? 'EATING' : 'SKIPPING';
    morningText.style.color = isMorningEating ? 'var(--primary)' : 'var(--danger)';
  }
  if (nightText) {
    nightText.textContent = isNightEating ? 'EATING' : 'SKIPPING';
    nightText.style.color = isNightEating ? 'var(--primary)' : 'var(--danger)';
  }

  // Stats
  const summary = mealData.summary || {};
  const mealCountEl = document.getElementById('user-stat-meals');
  if (mealCountEl) mealCountEl.textContent = summary.total_meals || 0;

  // Advance 5-day planner (if element exists)
  if (document.getElementById('advance-planner-container')) {
    renderAdvancePlanner(mealData.meals || []);
  }
}

function renderAdvancePlanner(loggedMeals) {
  const container = document.getElementById('advance-planner-container');
  if (!container) return;
  container.innerHTML = '';

  const today = new Date();
  for (let i = 1; i <= 5; i++) {
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + i);
    const dateStr = nextDate.toISOString().split('T')[0];
    const dayName = nextDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });

    const existing = loggedMeals.find(m => m.date === dateStr);
    const morningActive = existing ? existing.morning === 1 : true;
    const nightActive = existing ? existing.night === 1 : true;

    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-md);
      padding: 0.65rem 0.85rem;
      min-width: 140px;
      text-align: center;
      font-size: 0.8rem;
    `;

    card.innerHTML = `
      <div style="font-weight: 700; margin-bottom: 0.35rem;">${dayName}</div>
      <div style="display: flex; gap: 0.4rem; justify-content: center;">
        <button class="btn btn-sm ${morningActive ? 'btn-primary' : 'btn-outline'}" id="adv-m-${dateStr}" style="padding: 0.25rem 0.45rem; font-size: 0.72rem;">
          ☀️ ${morningActive ? 'Yes' : 'No'}
        </button>
        <button class="btn btn-sm ${nightActive ? 'btn-primary' : 'btn-outline'}" id="adv-n-${dateStr}" style="padding: 0.25rem 0.45rem; font-size: 0.72rem;">
          🌙 ${nightActive ? 'Yes' : 'No'}
        </button>
      </div>
    `;

    container.appendChild(card);

    // Event listeners for quick advance toggling
    card.querySelector(`#adv-m-${dateStr}`)?.addEventListener('click', async () => {
      const newM = !morningActive;
      await saveMealAttendance(dateStr, newM ? 1 : 0, nightActive ? 1 : 0);
      loadUserDashboard();
    });

    card.querySelector(`#adv-n-${dateStr}`)?.addEventListener('click', async () => {
      const newN = !nightActive;
      await saveMealAttendance(dateStr, morningActive ? 1 : 0, newN ? 1 : 0);
      loadUserDashboard();
    });
  }
}

function setupMealEvents() {
  const morningToggle = document.getElementById('toggle-morning') || document.getElementById('user-morning-toggle');
  const nightToggle = document.getElementById('toggle-night') || document.getElementById('user-night-toggle');
  const saveBtn = document.getElementById('save-meal-response-btn');
  const eatBothBtn = document.getElementById('btn-quick-eating-all');
  const skipBothBtn = document.getElementById('btn-quick-skip-all');

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const m = morningToggle ? (morningToggle.checked ? 1 : 0) : 1;
      const n = nightToggle ? (nightToggle.checked ? 1 : 0) : 1;
      await saveMealAttendance(state.todayDate, m, n);
    });
  }

  if (eatBothBtn) {
    eatBothBtn.addEventListener('click', async () => {
      if (morningToggle) morningToggle.checked = true;
      if (nightToggle) nightToggle.checked = true;
      await saveMealAttendance(state.todayDate, 1, 1);
    });
  }

  if (skipBothBtn) {
    skipBothBtn.addEventListener('click', async () => {
      if (morningToggle) morningToggle.checked = false;
      if (nightToggle) nightToggle.checked = false;
      await saveMealAttendance(state.todayDate, 0, 0);
    });
  }

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
      if (morning === 1 || night === 1) {
        playAudioFeedback('chime');
      } else {
        playAudioFeedback('skip');
      }
      showToast(`Saved preference for ${date}: Breakfast ${morning ? 'EATING' : 'NOT EATING'}, Dinner ${night ? 'EATING' : 'NOT EATING'}`);
      loadUserDashboard();
      loadGlobalCornerHeadcount();
    }
  } catch (err) {
    showToast('Failed to save meal response', 'error');
  }
}

// User Billing Breakdown & Direct UPI Scanner Rendering
function renderUserBilling(billData) {
  const bill = billData.current_bill || {};
  const settings = billData.settings || {};
  state.settings = settings;

  const monthlyFeeVal = bill.monthly_fee || settings.monthly_fee || 700;
  const prevDue = bill.prev_due || 0;
  const masiFee = bill.masi_fee || settings.masi_fee || 400;
  const isMasiPaid = bill.masi_paid === 1;
  const fineAmount = bill.fine_amount || 0;
  const totalPayable = bill.total_payable || (monthlyFeeVal + prevDue + masiFee + fineAmount);
  const paidAmount = bill.paid_amount || 0;
  const dueBalance = Math.max(0, totalPayable - paidAmount);

  state.billingCalc = {
    messFee: monthlyFeeVal,
    masiFee: masiFee,
    prevDue: prevDue,
    fineAmount: fineAmount,
    totalPayable: totalPayable,
    paidAmount: paidAmount,
    dueBalance: dueBalance,
    isMasiPaid: isMasiPaid
  };

  // Top Stat Cards
  const mealRateEl = document.getElementById('user-stat-meal-rate');
  if (mealRateEl) mealRateEl.textContent = 'Morning & Night Attendance';
  const statMonthlyElem = document.getElementById('user-stat-monthly-fee');
  if (statMonthlyElem) statMonthlyElem.textContent = formatCurrency(monthlyFeeVal);

  document.getElementById('user-stat-masi').textContent = formatCurrency(masiFee);
  document.getElementById('user-stat-masi-status').textContent = isMasiPaid ? '✅ Cleared for Month' : '⏳ Due by 7th of Month';
  document.getElementById('user-stat-prev-due').textContent = formatCurrency(prevDue);
  document.getElementById('user-stat-total-due').textContent = formatCurrency(dueBalance);

  const statusLabel = dueBalance === 0 ? 'Status: PAID' : (bill.fine_applied === 1 ? 'Status: OVERDUE (+₹100 Fine)' : 'Status: PENDING');
  document.getElementById('user-stat-bill-status').textContent = statusLabel;

  // Invoice Breakdown Card
  const invMonthlyElem = document.getElementById('inv-monthly-fee');
  if (invMonthlyElem) invMonthlyElem.textContent = formatCurrency(monthlyFeeVal);

  if (document.getElementById('inv-prev-due')) document.getElementById('inv-prev-due').textContent = formatCurrency(prevDue);
  if (document.getElementById('inv-masi-fee')) document.getElementById('inv-masi-fee').textContent = formatCurrency(masiFee);
  if (document.getElementById('inv-masi-substatus')) document.getElementById('inv-masi-substatus').textContent = isMasiPaid ? '✅ Paid' : 'Unpaid (Due by 7th)';
  if (document.getElementById('inv-late-fine')) document.getElementById('inv-late-fine').textContent = formatCurrency(fineAmount);
  if (document.getElementById('inv-total-payable')) document.getElementById('inv-total-payable').textContent = formatCurrency(totalPayable);
  if (document.getElementById('inv-paid-amount')) document.getElementById('inv-paid-amount').textContent = `- ${formatCurrency(paidAmount)}`;
  if (document.getElementById('inv-due-balance')) document.getElementById('inv-due-balance').textContent = formatCurrency(dueBalance);

  // Status Badge
  const badge = document.getElementById('user-invoice-badge');
  if (dueBalance === 0 && totalPayable > 0) {
    badge.className = 'status-pill status-paid';
    badge.textContent = 'PAID IN FULL';
  } else if (bill.fine_applied === 1) {
    badge.className = 'status-pill status-overdue';
    badge.textContent = 'OVERDUE (+₹100 FINE)';
  } else {
    badge.className = 'status-pill status-pending';
    badge.textContent = 'PAYMENT DUE';
  }

  // Previous Due Pill and Checklist Row Visibility
  const prevWrap = document.getElementById('calc-wrap-prev-due');
  const prevAmountEl = document.getElementById('calc-prev-due-amount');
  const prevPill = document.getElementById('pill-prev-due');
  const prevCheck = document.getElementById('calc-check-prev-due');

  if (prevDue > 0) {
    if (prevWrap) prevWrap.style.display = 'flex';
    if (prevAmountEl) prevAmountEl.textContent = formatCurrency(prevDue);
    if (prevPill) {
      prevPill.style.display = 'inline-block';
      prevPill.textContent = `⏳ Prev Due (${formatCurrency(prevDue)})`;
    }
  } else {
    if (prevWrap) prevWrap.style.display = 'none';
    if (prevPill) prevPill.style.display = 'none';
    if (prevCheck) prevCheck.checked = false;
  }

  // Fine Row Visibility
  const fineWrap = document.getElementById('calc-wrap-fine');
  const fineAmountEl = document.getElementById('calc-fine-amount');
  const fineCheck = document.getElementById('calc-check-fine');

  if (fineAmount > 0) {
    if (fineWrap) fineWrap.style.display = 'flex';
    if (fineAmountEl) fineAmountEl.textContent = formatCurrency(fineAmount);
  } else {
    if (fineWrap) fineWrap.style.display = 'none';
    if (fineCheck) fineCheck.checked = false;
  }

  // Set intelligent default checkbox selections
  const messCheck = document.getElementById('calc-check-mess');
  const maidCheck = document.getElementById('calc-check-maid');

  if (messCheck) messCheck.checked = true;
  if (maidCheck) {
    if (isMasiPaid) {
      maidCheck.checked = false;
      maidCheck.disabled = true;
    } else {
      maidCheck.checked = true;
      maidCheck.disabled = false;
    }
  }

  // Update due pill text
  const duePill = document.getElementById('dash-fill-due-pill');
  if (duePill) {
    duePill.textContent = `⚡ Full Due (₹${dueBalance})`;
  }

  document.getElementById('pay-month-input').value = state.currentMonth;

  // Run the automatic payment amount calculation
  calculateSelectedPaymentTotal();

  // Ensure Direct UPI QR Scanner on User Dashboard is rendered!
  renderDirectUpiDashboardScanner(dueBalance, settings);
}

// Debounced QR code generator to keep QR image synced with exact payable amount
let qrUpdateTimer = null;
function updateDynamicPaymentQr(amount) {
  if (qrUpdateTimer) clearTimeout(qrUpdateTimer);
  qrUpdateTimer = setTimeout(async () => {
    const upiId = state.settings?.upi_id || '8927971674@fam';
    const upiName = state.settings?.upi_name || 'Bhabani Prasad Ghosh';
    try {
      const res = await apiRequest(`/api/payments/qr-code?amount=${amount}&upi_id=${encodeURIComponent(upiId)}&upi_name=${encodeURIComponent(upiName)}`);
      if (res && res.qr_data_url) {
        const scannerImg = document.getElementById('dashboard-qr-scanner-img');
        if (scannerImg) scannerImg.src = res.qr_data_url;
        const modalQr = document.getElementById('pay-modal-qr-img');
        if (modalQr) modalQr.src = res.qr_data_url;
      }
    } catch (e) {
      console.warn('QR code generation warning:', e);
    }
  }, 200);
}

// Automatic Payable Amount Calculator based on student selection
function calculateSelectedPaymentTotal() {
  const calc = state.billingCalc || { messFee: 700, masiFee: 400, prevDue: 0, fineAmount: 0, dueBalance: 1100 };
  let total = 0;

  const checkMess = document.getElementById('calc-check-mess');
  const checkMaid = document.getElementById('calc-check-maid');
  const checkPrev = document.getElementById('calc-check-prev-due');
  const checkFine = document.getElementById('calc-check-fine');

  const isMess = checkMess ? checkMess.checked : true;
  const isMaid = checkMaid ? checkMaid.checked : true;
  const isPrev = checkPrev ? checkPrev.checked : false;
  const isFine = checkFine ? checkFine.checked : false;

  if (isMess) total += (calc.messFee || 700);
  if (isMaid) total += (calc.masiFee || 400);
  if (isPrev) total += (calc.prevDue || 0);
  if (isFine) total += (calc.fineAmount || 0);

  if (total === 0) {
    total = calc.dueBalance > 0 ? calc.dueBalance : (calc.messFee || 700);
  }

  // Update UI displays
  const calcTotalDisp = document.getElementById('calc-total-display');
  if (calcTotalDisp) calcTotalDisp.textContent = formatCurrency(total);

  const btnLabel = document.getElementById('btn-pay-amount-label');
  if (btnLabel) btnLabel.textContent = formatCurrency(total);

  const payInput = document.getElementById('pay-amount-input');
  if (payInput) payInput.value = total;

  const directPayInput = document.getElementById('direct-pay-amount');
  if (directPayInput) directPayInput.value = total;

  // Sync active pill state in #dash-upi-amount-pills
  const pills = document.querySelectorAll('#dash-upi-amount-pills .upi-amount-pill');
  pills.forEach(p => p.classList.remove('active'));

  if (isMess && isMaid && !isPrev && !isFine && total === 1100) {
    document.getElementById('pill-both-1100')?.classList.add('active');
  } else if (isMess && !isMaid && !isPrev && !isFine && total === (calc.messFee || 700)) {
    document.getElementById('pill-mess-700')?.classList.add('active');
  } else if (!isMess && isMaid && !isPrev && !isFine && total === (calc.masiFee || 400)) {
    document.getElementById('pill-maid-400')?.classList.add('active');
  } else if (isPrev && !isMess && !isMaid && !isFine && total === calc.prevDue) {
    document.getElementById('pill-prev-due')?.classList.add('active');
  } else if (total === calc.dueBalance && calc.dueBalance > 0) {
    document.getElementById('dash-fill-due-pill')?.classList.add('active');
  }

  // Dynamically update QR code with the exact calculated amount
  updateDynamicPaymentQr(total);

  return total;
}

/**
 * Render Direct UPI Payment Scanner directly on the User Dashboard
 * Using Bhabani Payment Scanner (Bhabani Prasad Ghosh / 8927971674@fam)
 */
function renderDirectUpiDashboardScanner(dueBalance, settings) {
  let directScannerContainer = document.getElementById('direct-upi-dashboard-card');
  if (!directScannerContainer) {
    // Insert before the payment submissions history table
    const targetParent = document.getElementById('view-user');
    directScannerContainer = document.createElement('div');
    directScannerContainer.id = 'direct-upi-dashboard-card';
    directScannerContainer.className = 'glass-panel';
    directScannerContainer.style.cssText = `
      padding: 1.75rem;
      margin-bottom: 2rem;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(17, 24, 39, 0.9) 100%);
      border: 2px solid rgba(16, 185, 129, 0.35);
      border-radius: var(--radius-lg);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    `;

    const submissionsBox = targetParent.querySelector('.glass-panel:last-of-type');
    targetParent.insertBefore(directScannerContainer, submissionsBox);
  }

  const upiId = settings.upi_id || '8927971674@fam';
  const upiName = settings.upi_name || 'Bhabani Prasad Ghosh';
  const scannerName = settings.scanner_name || 'Bhabani Payment Scanner';
  const scannerImage = settings.scanner_image || '/assets/bhabani_scanner.jpeg';
  const amountToPay = dueBalance > 0 ? dueBalance : 700;
  const upiUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${amountToPay}&cu=INR&tn=Mess_Payment`;

  directScannerContainer.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border-glass); padding-bottom: 0.85rem;">
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 44px; height: 44px; border-radius: var(--radius-md); background: rgba(16, 185, 129, 0.2); display: flex; align-items: center; justify-content: center; font-size: 1.4rem;">
          📱
        </div>
        <div>
          <h3 style="font-size: 1.25rem; color: var(--primary);">${scannerName}</h3>
          <p style="font-size: 0.82rem; color: var(--text-secondary);">
            Pay to: <strong>${upiName}</strong> (${upiId}) • Pay ₹700 mess fee by 5th, ₹400 maid fee by 7th
          </p>
        </div>
      </div>
      <div>
        <span class="badge-tag" style="background: rgba(16, 185, 129, 0.2); color: #34d399; font-size: 0.85rem; padding: 0.4rem 0.85rem;">
          Active Due: <strong>${formatCurrency(dueBalance)}</strong>
        </span>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; align-items: center;">
      
      <!-- Live Bhabani Scanner Card -->
      <div style="text-align: center; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 1.25rem;">
        <div style="position: relative; display: inline-block;">
          <img src="${scannerImage}" alt="Bhabani Payment Scanner" style="width: 200px; height: 200px; object-fit: contain; border-radius: 12px; background: #fff; padding: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);" id="dashboard-qr-scanner-img">
        </div>
        <div style="margin-top: 0.75rem;">
          <div style="font-size: 0.82rem; color: var(--text-secondary);">Bhabani UPI ID:</div>
          <div class="upi-pill" onclick="navigator.clipboard.writeText('${upiId}'); showToast('Copied UPI ID to clipboard: ${upiId}');" title="Click to copy">
            <span>${upiId}</span> 📋
          </div>
        </div>
        <div style="display: flex; gap: 0.4rem; justify-content: center; margin-top: 0.75rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" id="direct-fill-1100-btn">
            ⚡ ₹1,100 (Both)
          </button>
          <button type="button" class="btn btn-outline btn-sm" id="direct-fill-700-btn">
            🍲 ₹700 (Mess)
          </button>
          <button type="button" class="btn btn-outline btn-sm" id="direct-fill-400-btn">
            👩‍🍳 ₹400 (Maid)
          </button>
          <button type="button" class="btn btn-outline btn-sm" id="direct-fill-due-btn">
            🌟 Full Due
          </button>
        </div>
        <div style="margin-top: 0.75rem;">
          <button type="button" class="btn btn-primary btn-sm" style="width: 100%; border-radius: var(--radius-full); font-size: 0.84rem; font-weight: 700;" onclick="launchUpiPayment('upi')">
            ⚡ Pay Now via Any UPI App (Amount Pre-filled)
          </button>
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.4rem;">
          ${settings.bank_name || 'SBI'} A/C: ${settings.account_number || '382910482910'} (IFSC: ${settings.ifsc_code || 'SBIN0012345'})
        </div>
      </div>

      <!-- Quick Proof Submission Form -->
      <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 1.25rem;">
        <h4 style="margin-bottom: 0.75rem; font-size: 1rem;">📤 Submit Payment Screenshot Proof</h4>
        <form id="direct-payment-proof-form">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; margin-bottom: 0.75rem;">
            <div>
              <label class="form-label" style="font-size: 0.76rem;">Amount Paid (₹)</label>
              <input type="number" id="direct-pay-amount" class="form-control" value="${amountToPay}" required>
            </div>
            <div>
              <label class="form-label" style="font-size: 0.76rem;">Transaction / UTR ID</label>
              <input type="text" id="direct-pay-utr" class="form-control" placeholder="12 digit UTR" required>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 0.75rem;">
            <label class="form-label" style="font-size: 0.76rem;">Payment Screenshot (Required)</label>
            <input type="file" id="direct-pay-file" class="form-control" accept="image/*" required style="font-size: 0.8rem; padding: 0.45rem;">
          </div>

          <div class="form-group" style="margin-bottom: 0.75rem;">
            <input type="text" id="direct-pay-note" class="form-control" placeholder="e.g. Paid ₹700 monthly fee via Bhabani scanner" style="font-size: 0.8rem;">
          </div>

          <button type="submit" class="btn btn-primary" style="width: 100%;" id="direct-pay-submit-btn">
            🚀 Submit Proof for Manager Verification
          </button>
        </form>
      </div>

    </div>
  `;

  // Quick fill event listeners
  const fill1100Btn = document.getElementById('direct-fill-1100-btn');
  if (fill1100Btn) {
    fill1100Btn.addEventListener('click', () => {
      document.getElementById('direct-pay-amount').value = 1100;
      updateDynamicPaymentQr(1100);
      showToast('Set payment amount to ₹1,100 (Mess + Maid)', 'info');
    });
  }

  const fill700Btn = document.getElementById('direct-fill-700-btn');
  if (fill700Btn) {
    fill700Btn.addEventListener('click', () => {
      document.getElementById('direct-pay-amount').value = 700;
      updateDynamicPaymentQr(700);
      showToast('Set payment amount to ₹700 (Monthly Mess Fee - Due 5th)', 'info');
    });
  }

  const fill400Btn = document.getElementById('direct-fill-400-btn');
  if (fill400Btn) {
    fill400Btn.addEventListener('click', () => {
      document.getElementById('direct-pay-amount').value = 400;
      updateDynamicPaymentQr(400);
      showToast('Set payment amount to ₹400 (Maid Fee - Due 7th)', 'info');
    });
  }

  const fillDueBtn = document.getElementById('direct-fill-due-btn');
  if (fillDueBtn) {
    fillDueBtn.addEventListener('click', () => {
      document.getElementById('direct-pay-amount').value = dueBalance;
      updateDynamicPaymentQr(dueBalance);
      showToast(`Set payment amount to full due: ${formatCurrency(dueBalance)}`, 'info');
    });
  }

  // Asynchronously fetch local backend generated QR code
  apiRequest(`/api/payments/qr-code?amount=${amountToPay}&upi_id=${encodeURIComponent(upiId)}&upi_name=${encodeURIComponent(upiName)}`)
    .then(res => {
      if (res && res.qr_data_url) {
        const scannerImg = document.getElementById('dashboard-qr-scanner-img');
        if (scannerImg) scannerImg.src = res.qr_data_url;
      }
    })
    .catch(() => {});

  // Attach direct proof submit handler
  const directForm = document.getElementById('direct-payment-proof-form');
  if (directForm) {
    directForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = document.getElementById('direct-pay-amount').value;
      const utr = document.getElementById('direct-pay-utr').value;
      const fileInput = document.getElementById('direct-pay-file');
      const note = document.getElementById('direct-pay-note').value;
      const btn = document.getElementById('direct-pay-submit-btn');

      if (!fileInput.files || fileInput.files.length === 0) {
        showToast('Please attach the payment screenshot', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('amount', amount);
      formData.append('utr_number', utr);
      formData.append('month', state.currentMonth);
      formData.append('note', note);
      formData.append('screenshot', fileInput.files[0]);

      try {
        btn.disabled = true;
        btn.textContent = 'Uploading Proof...';

        const res = await apiRequest('/api/payments/submit', {
          method: 'POST',
          body: formData
        });

        if (res.success) {
          showToast(res.message, 'success');
          directForm.reset();
          loadUserDashboard();
        } else {
          showToast(res.message || 'Submission failed', 'error');
        }
      } catch (err) {
        showToast('Failed to upload proof. Please try again.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Submit Proof for Manager Verification';
      }
    });
  }
}

// User Payment Submissions List
async function loadUserPaymentHistory() {
  try {
    const res = await apiRequest('/api/payments/my');
    const tbody = document.getElementById('user-payment-history-tbody');
    tbody.innerHTML = '';

    if (!res.success || !res.payments || res.payments.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            No payment submissions recorded yet. Use the UPI Scanner above to make your payment.
          </td>
        </tr>
      `;
      return;
    }

    res.payments.forEach(p => {
      const tr = document.createElement('tr');
      let statusClass = 'status-pending';
      if (p.status === 'APPROVED') statusClass = 'status-paid';
      if (p.status === 'REJECTED') statusClass = 'status-overdue';

      tr.innerHTML = `
        <td>${formatDate(p.payment_date || p.created_at)}</td>
        <td><strong>${p.month}</strong></td>
        <td style="color: var(--primary); font-weight: 700;">${formatCurrency(p.amount)}</td>
        <td>
          <code style="font-size: 0.85rem;">${p.utr_number}</code>
          ${p.upi_app ? `<div style="font-size: 0.72rem; color: var(--text-muted);">${p.upi_app}${p.payer_upi_id ? ` (${p.payer_upi_id})` : ''}</div>` : ''}
        </td>
        <td>
          <a href="${p.screenshot_path}" target="_blank" class="btn btn-outline btn-sm" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;">
            🖼️ View Proof
          </a>
        </td>
        <td><span class="status-pill ${statusClass}">${p.status}</span></td>
        <td style="font-size: 0.8rem; color: var(--text-secondary);">${p.admin_note || '-'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching payments:', err);
  }
}

// ============================================================================
// PUBLIC TRANSPARENCY BOARD (VISIBLE TO ALL USERS)
// ============================================================================
async function loadTransparencyBoard(targetMonth) {
  const monthToLoad = targetMonth || state.currentMonth;
  try {
    // Populate month dropdown
    setupMonthSelector(monthToLoad);

    const res = await apiRequest(`/api/billing/transparency?month=${monthToLoad}`);
    if (res.success) {
      state.transparencyData = res;
      renderTransparencyView(res);
    }
  } catch (err) {
    showToast('Failed to load community transparency ledger', 'error');
  }
}

function setupMonthSelector(currentVal) {
  const select = document.getElementById('transparency-month-select');
  if (select.children.length === 0) {
    const today = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      select.appendChild(opt);
    }

    select.addEventListener('change', (e) => {
      loadTransparencyBoard(e.target.value);
    });
  }
  select.value = currentVal;
}

function renderTransparencyView(data) {
  const summary = data.summary || {};
  const members = data.members || [];

  // Summary Metrics
  document.getElementById('trans-stat-meals').textContent = summary.total_meals || 0;
  document.getElementById('trans-stat-members').textContent = `Across ${summary.total_students || summary.total_members || 0} active students`;
  document.getElementById('trans-stat-collected').textContent = formatCurrency(summary.total_paid);
  document.getElementById('trans-stat-billed').textContent = `Out of ${formatCurrency(summary.total_billed)} billed`;
  document.getElementById('trans-stat-due').textContent = formatCurrency(summary.total_due);
  document.getElementById('trans-stat-overdue-count').textContent = `${summary.overdue_members_count || 0} students overdue (>15th fine)`;
  document.getElementById('trans-stat-masi').textContent = formatCurrency(summary.masi_pool_collected);
  document.getElementById('trans-stat-masi-target').textContent = `Pool Target: ${formatCurrency(summary.masi_pool_total)} (7th cutoff)`;

  // Filter and Render Table
  applyTransparencyFilters(members);
}

function applyTransparencyFilters(membersList) {
  const query = document.getElementById('transparency-search-input').value.toLowerCase().trim();
  const statusFilter = document.getElementById('transparency-status-filter').value;
  const tbody = document.getElementById('transparency-tbody');
  tbody.innerHTML = '';

  const filtered = membersList.filter(m => {
    const matchName = m.name.toLowerCase().includes(query) || (m.room_no && m.room_no.toLowerCase().includes(query));
    if (!matchName) return false;
    if (statusFilter === 'ALL') return true;
    return m.status === statusFilter;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          No matching students found for this filter.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(m => {
    const tr = document.createElement('tr');

    let statusClass = 'status-pending';
    if (m.status === 'PAID') statusClass = 'status-paid';
    if (m.status === 'OVERDUE') statusClass = 'status-overdue';

    let masiClass = 'status-pending';
    if (m.masi_status === 'PAID') masiClass = 'status-paid';
    if (m.masi_status === 'OVERDUE') masiClass = 'status-overdue';

    tr.innerHTML = `
      <td>
        <div class="member-cell">
          <div class="member-avatar-mini">${m.name.charAt(0).toUpperCase()}</div>
          <div>
            <div class="member-meta-title">${m.name}</div>
            <div class="member-meta-sub">${m.room_no} | ${m.phone || m.email}</div>
          </div>
        </div>
      </td>
      <td><strong>${m.meals_count}</strong></td>
      <td style="color: var(--primary); font-weight: 700;">${formatCurrency(m.monthly_fee || 700)}</td>
      <td style="color: ${m.prev_due > 0 ? 'var(--accent)' : 'var(--text-muted)'}; font-weight: ${m.prev_due > 0 ? '700' : 'normal'}">
        ${formatCurrency(m.prev_due)}
      </td>
      <td>
        <div style="display: flex; align-items: center; gap: 0.35rem;">
          <span>${formatCurrency(m.masi_fee)}</span>
          <span class="status-pill ${masiClass}" style="font-size: 0.65rem; padding: 0.15rem 0.45rem;">${m.masi_status}</span>
        </div>
      </td>
      <td>
        ${m.fine_applied ? `<span class="badge-tag fine-tag">🚨 +₹100 Fine</span>` : `<span style="color: var(--text-muted);">₹0</span>`}
      </td>
      <td><strong>${formatCurrency(m.total_payable)}</strong></td>
      <td style="color: var(--primary); font-weight: 700;">${formatCurrency(m.paid_amount)}</td>
      <td>
        <strong style="color: ${m.due_balance > 0 ? '#f87171' : 'var(--primary)'}; font-size: 0.95rem;">
          ${formatCurrency(m.due_balance)}
        </strong>
      </td>
      <td>
        <span class="status-pill ${statusClass}">${m.status}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Setup search & filters on transparency board
document.getElementById('transparency-search-input').addEventListener('input', () => {
  if (state.transparencyData) applyTransparencyFilters(state.transparencyData.members || []);
});
document.getElementById('transparency-status-filter').addEventListener('change', () => {
  if (state.transparencyData) applyTransparencyFilters(state.transparencyData.members || []);
});
document.getElementById('print-board-btn').addEventListener('click', () => {
  window.print();
});

// ============================================================================
// ADMIN CONTROL CENTER LOGIC
// ============================================================================
async function loadAdminDashboard() {
  try {
    // 0. Fetch Today's Market Duty & Dishes & Global Headcount
    loadTodayMarketDutyWidget('admin');
    loadGlobalCornerHeadcount();

    // 1. Fetch Top Stats
    const statsRes = await apiRequest('/api/admin/dashboard-stats');
    if (statsRes.success) {
      renderAdminStats(statsRes.stats);
    }

    // 2. Load Active Date Headcount
    loadAdminDateHeadcount(state.todayDate);

    // 3. Load Pending Proofs
    loadAdminPendingProofs();

    // 3b. Load Pending Student Approvals
    loadAdminPendingUsers();

    // 4. Load Rannar Masi Fund
    loadAdminMasiFund();

    // 5. Load Users Directory
    loadAdminUsersDirectory();

    // 6. Load Settings
    loadAdminSettings();

  } catch (err) {
    console.error('Error loading admin dashboard:', err);
  }
}

function renderAdminStats(stats) {
  document.getElementById('admin-stat-morning').textContent = stats.today_morning_eating || 0;
  document.getElementById('admin-stat-morning-skip').textContent = `${stats.today_morning_skipping || 0} no-shows (skipping)`;

  document.getElementById('admin-stat-night').textContent = stats.today_night_eating || 0;
  document.getElementById('admin-stat-night-skip').textContent = `${stats.today_night_skipping || 0} no-shows (skipping)`;

  document.getElementById('admin-stat-pending-proofs').textContent = stats.pending_proofs_count || 0;
  document.getElementById('admin-proofs-badge').textContent = stats.pending_proofs_count || 0;

  if (document.getElementById('admin-stat-pending-users')) {
    document.getElementById('admin-stat-pending-users').textContent = stats.pending_users_count || 0;
  }
  if (document.getElementById('admin-pending-badge')) {
    document.getElementById('admin-pending-badge').textContent = stats.pending_users_count || 0;
  }
  if (document.getElementById('admin-resets-badge')) {
    document.getElementById('admin-resets-badge').textContent = stats.pending_resets_count || 0;
  }

  document.getElementById('admin-stat-overdue-count').textContent = stats.overdue_members || 0;
}

async function loadAdminDateHeadcount(dateStr) {
  try {
    document.getElementById('admin-meal-date-picker').value = dateStr;
    const res = await apiRequest(`/api/meals/date/${dateStr}`);
    const tbody = document.getElementById('admin-meals-tbody');
    tbody.innerHTML = '';

    if (!res.success || !res.members || res.members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No members registered yet.</td></tr>`;
      return;
    }

    // Update Quick Headcount Pills
    if (res.counts) {
      const totalBadge = document.getElementById('admin-headcount-total-badge');
      if (totalBadge) totalBadge.textContent = `👥 Total Students: ${res.counts.total_members}`;

      const mEat = document.getElementById('admin-hc-morning-eating');
      if (mEat) mEat.textContent = res.counts.morning_eaters;

      const mSkip = document.getElementById('admin-hc-morning-skip');
      if (mSkip) mSkip.textContent = res.counts.morning_skippers;

      const nEat = document.getElementById('admin-hc-night-eating');
      if (nEat) nEat.textContent = res.counts.night_eaters;

      const nSkip = document.getElementById('admin-hc-night-skip');
      if (nSkip) nSkip.textContent = res.counts.night_skippers;
    }

    // Update Dedicated No-Shows Callout List
    const noShowsList = document.getElementById('admin-no-shows-list');
    if (noShowsList) {
      const mNoShows = (res.no_shows && res.no_shows.morning) || [];
      const nNoShows = (res.no_shows && res.no_shows.night) || [];

      if (mNoShows.length === 0 && nNoShows.length === 0) {
        noShowsList.innerHTML = `<span style="color: #34d399; font-weight: 600;">✅ No students have opted out. Everyone is scheduled to eat!</span>`;
      } else {
        let html = '<div style="display: flex; flex-direction: column; gap: 0.45rem;">';
        if (mNoShows.length > 0) {
          html += `<div><strong style="color: #fca5a5;">☀️ Breakfast No-Shows (${mNoShows.length}):</strong> `;
          html += mNoShows.map(s => `<span class="no-show-chip">🚪 ${s.room_no || 'N/A'}: ${s.name}</span>`).join(' ');
          html += '</div>';
        }
        if (nNoShows.length > 0) {
          html += `<div><strong style="color: #fca5a5;">🌙 Dinner No-Shows (${nNoShows.length}):</strong> `;
          html += nNoShows.map(s => `<span class="no-show-chip">🚪 ${s.room_no || 'N/A'}: ${s.name}</span>`).join(' ');
          html += '</div>';
        }
        html += '</div>';
        noShowsList.innerHTML = html;
      }
    }

    // Populate Detailed Student Response Table
    res.members.forEach(m => {
      const tr = document.createElement('tr');
      const isMorningEating = m.morning === 1;
      const isNightEating = m.night === 1;

      const morningBadge = isMorningEating
        ? (m.morning_default
            ? `<span class="badge-tag badge-eating-default" title="Student did not mark, auto-defaulted to Eating">☀️ Eating (Default)</span>`
            : `<span class="badge-tag badge-eating-marked" title="Student marked attendance">☀️ Eating (Marked)</span>`)
        : `<span class="badge-tag badge-not-eating" title="Student explicitly opted out">❌ Not Eating (No-Show)</span>`;

      const nightBadge = isNightEating
        ? (m.night_default
            ? `<span class="badge-tag badge-eating-default" title="Student did not mark, auto-defaulted to Eating">🌙 Eating (Default)</span>`
            : `<span class="badge-tag badge-eating-marked" title="Student marked attendance">🌙 Eating (Marked)</span>`)
        : `<span class="badge-tag badge-not-eating" title="Student explicitly opted out">❌ Not Eating (No-Show)</span>`;

      tr.innerHTML = `
        <td><strong>${m.room_no || 'N/A'}</strong></td>
        <td>${m.name}</td>
        <td>${morningBadge}</td>
        <td>${nightBadge}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="adminToggleMeal(${m.id}, '${dateStr}', ${isMorningEating ? 0 : 1}, ${isNightEating ? 0 : 1})">
            🔄 Toggle
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching date headcount:', err);
  }
}

// Window helper for admin meal toggle
window.adminToggleMeal = async function(userId, date, newMorning, newNight) {
  try {
    const res = await apiRequest('/api/meals/admin/override', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, date, morning: newMorning, night: newNight })
    });
    if (res.success) {
      showToast('Meal attendance updated', 'success');
      loadAdminDateHeadcount(date);
      loadAdminDashboard();
      loadGlobalCornerHeadcount();
    }
  } catch (err) {
    showToast('Failed to update meal', 'error');
  }
};

// ============================================================================
// ADMIN PENDING STUDENT REGISTRATIONS QUEUE
// ============================================================================
async function loadAdminPendingUsers() {
  try {
    const res = await apiRequest('/api/admin/pending-users');
    const tbody = document.getElementById('admin-pending-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const badge = document.getElementById('admin-pending-badge');
    const stat = document.getElementById('admin-stat-pending-users');

    if (!res.success || !res.users || res.users.length === 0) {
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

    if (badge) badge.textContent = res.users.length;
    if (stat) stat.textContent = res.users.length;

    res.users.forEach(u => {
      const tr = document.createElement('tr');
      const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';

      tr.innerHTML = `
        <td><small style="color: var(--text-secondary);">${dateStr}</small></td>
        <td><strong>${u.name}</strong></td>
        <td><span style="font-family: monospace; color: var(--accent);">${u.email}</span></td>
        <td><span class="badge-tag" style="background: rgba(255,255,255,0.06);">${u.room_no || 'N/A'}</span></td>
        <td>${u.phone || '-'}</td>
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
    const res = await apiRequest(`/api/admin/users/${userId}/approve`, {
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
    const res = await apiRequest(`/api/admin/users/${userId}/reject`, {
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

// Admin Payment Proof Verification Queue
async function loadAdminPendingProofs() {
  try {
    const res = await apiRequest('/api/payments/pending');
    const tbody = document.getElementById('admin-proofs-tbody');
    tbody.innerHTML = '';

    if (!res.success || !res.payments || res.payments.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">
            ✅ All caught up! No pending payment verification proofs in queue.
          </td>
        </tr>
      `;
      document.getElementById('admin-proofs-badge').textContent = '0';
      return;
    }

    state.pendingProofs = res.payments;
    document.getElementById('admin-proofs-badge').textContent = res.payments.length;

    res.payments.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(p.created_at).toLocaleString('en-IN')}</td>
        <td>
          <strong>${p.user_name}</strong>
          ${p.payer_upi_id ? `<br><small style="color: var(--accent); font-family: monospace;">UPI: ${p.payer_upi_id}</small>` : ''}
          ${p.upi_app ? `<br><span class="badge-tag" style="font-size: 0.68rem; padding: 1px 5px;">${p.upi_app}</span>` : ''}
        </td>
        <td>${p.room_no || 'N/A'}</td>
        <td><strong>${p.month}</strong></td>
        <td style="color: var(--primary); font-weight: 700;">${formatCurrency(p.amount)}</td>
        <td><code style="font-size: 0.85rem;">${p.utr_number}</code></td>
        <td>
          <a href="${p.screenshot_path}" target="_blank">
            <img src="${p.screenshot_path}" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border-glass);" alt="Proof">
          </a>
        </td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="openVerifyModal(${p.id})">
            🔍 Inspect & Verify
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching pending proofs:', err);
  }
}

// Window helper for opening verification lightbox modal
window.openVerifyModal = function(paymentId) {
  const payment = state.pendingProofs.find(p => p.id === paymentId);
  if (!payment) return;

  document.getElementById('verify-modal-user-meta').textContent = `Submitted by ${payment.user_name} (${payment.room_no || 'Room N/A'}) • Due Balance: ${formatCurrency(payment.due_balance)}`;
  document.getElementById('verify-lightbox-img').src = payment.screenshot_path;
  document.getElementById('verify-amount').textContent = formatCurrency(payment.amount);
  document.getElementById('verify-month').textContent = payment.month;
  document.getElementById('verify-utr').textContent = payment.utr_number;
  document.getElementById('verify-date').textContent = formatDate(payment.payment_date);
  
  const payerUpiEl = document.getElementById('verify-payer-upi');
  if (payerUpiEl) payerUpiEl.textContent = payment.payer_upi_id || 'Not specified';
  const upiAppEl = document.getElementById('verify-upi-app');
  if (upiAppEl) upiAppEl.textContent = payment.upi_app || 'UPI App';

  document.getElementById('verify-admin-note').value = 'Verified and approved with bank statement.';

  const modal = document.getElementById('admin-verify-modal');
  modal.classList.add('active');

  // Bind Actions
  document.getElementById('verify-approve-btn').onclick = async () => {
    const note = document.getElementById('verify-admin-note').value;
    await processPaymentVerification(payment.id, 'APPROVE', note);
    modal.classList.remove('active');
  };

  document.getElementById('verify-reject-btn').onclick = async () => {
    const note = document.getElementById('verify-admin-note').value;
    await processPaymentVerification(payment.id, 'REJECT', note);
    modal.classList.remove('active');
  };
};

async function processPaymentVerification(paymentId, action, admin_note) {
  try {
    const res = await apiRequest(`/api/payments/verify/${paymentId}`, {
      method: 'POST',
      body: JSON.stringify({ action, admin_note })
    });
    if (res.success) {
      showToast(res.message, 'success');
      loadAdminPendingProofs();
      loadAdminDashboard();
    } else {
      showToast(res.message || 'Verification failed', 'error');
    }
  } catch (err) {
    showToast('Failed to process verification', 'error');
  }
}

// Admin Rannar Masi Fund Tracker
async function loadAdminMasiFund() {
  try {
    const res = await apiRequest(`/api/admin/masi-fund?month=${state.currentMonth}`);
    if (!res.success) return;

    const summary = res.summary || {};
    const students = res.students || [];

    const pct = summary.total_target > 0 ? Math.round((summary.total_collected / summary.total_target) * 100) : 0;
    document.getElementById('masi-progress-bar').style.width = `${pct}%`;
    document.getElementById('masi-collected-text').textContent = `${formatCurrency(summary.total_collected)} (${summary.paid_count} students)`;
    document.getElementById('masi-target-text').textContent = `${formatCurrency(summary.total_target)} (${summary.total_students || students.length} students @ ₹400)`;
    document.getElementById('masi-deficit-text').textContent = formatCurrency(summary.total_pending);

    const tbody = document.getElementById('admin-masi-tbody');
    tbody.innerHTML = '';

    students.forEach(b => {
      const tr = document.createElement('tr');
      let pillClass = 'status-pending';
      if (b.status === 'PAID') pillClass = 'status-paid';
      if (b.status === 'OVERDUE') pillClass = 'status-overdue';

      tr.innerHTML = `
        <td><strong>${b.name}</strong></td>
        <td>${b.room_no}</td>
        <td><strong>${formatCurrency(b.fee)}</strong></td>
        <td>
          <span style="font-size: 0.8rem; color: ${b.status === 'OVERDUE' ? '#f87171' : 'var(--text-secondary)'};">
            ${b.status === 'OVERDUE' ? '⚠️ Past 7th Deadline!' : 'Cutoff: 7th of Month'}
          </span>
        </td>
        <td><span class="status-pill ${pillClass}">${b.status}</span></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching masi fund:', err);
  }
}

// ============================================================================
// ADMIN: FULL STUDENT CONTROL & DIRECTORY MANAGEMENT
// ============================================================================
let currentStudentFilter = 'active';
let allAdminStudentsCache = [];

window.setStudentFilter = function(filter) {
  currentStudentFilter = filter;
  ['all', 'active', 'inactive'].forEach(f => {
    const btn = document.getElementById(`admin-users-filter-${f}`);
    if (btn) {
      if (f === filter) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  loadAdminUsersDirectory();
};

window.filterStudentsTable = function() {
  const query = (document.getElementById('admin-users-search-input')?.value || '').toLowerCase().trim();
  renderStudentsTable(allAdminStudentsCache.filter(u => {
    if (!query) return true;
    return (
      (u.name && u.name.toLowerCase().includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      (u.room_no && u.room_no.toLowerCase().includes(query)) ||
      (u.phone && u.phone.toLowerCase().includes(query))
    );
  }));
};

function renderStudentsTable(users) {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!users || users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No students found matching current filter.</td></tr>`;
    return;
  }

  users.forEach(u => {
    const tr = document.createElement('tr');
    const due = Math.max(0, (u.total_payable || 0) - (u.paid_amount || 0));
    const prevDue = u.prev_due || 0;
    const lifetimePaid = u.lifetime_paid || 0;
    const isInactive = u.status === 'inactive';

    tr.innerHTML = `
      <td>${u.id}</td>
      <td>
        <strong>${escapeHtml(u.name)}</strong>
        <div style="font-size: 0.75rem; color: var(--text-muted);">Room: ${escapeHtml(u.room_no || 'N/A')}</div>
      </td>
      <td>
        <div>${escapeHtml(u.email)}</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(u.phone || '-')}</div>
      </td>
      <td style="color: ${prevDue > 0 ? '#fbbf24' : 'var(--text-muted)'}; font-weight: 600;">
        ${formatCurrency(prevDue)}
      </td>
      <td style="color: ${due > 0 ? '#f87171' : 'var(--primary)'}; font-weight: 700;">
        ${formatCurrency(due)}
      </td>
      <td style="color: var(--primary); font-weight: 600;">
        ${formatCurrency(lifetimePaid)}
      </td>
      <td>
        <span class="status-pill status-${u.status}">${u.status}</span>
      </td>
      <td>
        <div class="action-btn-group">
          <button class="btn btn-outline btn-xs" onclick="openStudentDossier(${u.id})" title="View Complete Record & Attendance Dossier">
            👁️ Dossier
          </button>
          <button class="btn btn-outline btn-xs" onclick="openEditStudentModal(${u.id})" title="Edit Student Profile">
            ✏️ Edit
          </button>
          <button class="btn btn-outline btn-xs" onclick="openResetPasswordModal(${u.id}, '${escapeHtml(u.name)}')" title="Reset Password">
            🔑 Password
          </button>
          <button class="btn btn-outline btn-xs" onclick="toggleStudentStatus(${u.id}, '${u.status}')" title="${isInactive ? 'Activate Account' : 'Deactivate Account'}">
            ${isInactive ? '🟢 Activate' : '⏸️ Deactivate'}
          </button>
          ${!isInactive ? `
            <button class="btn btn-danger btn-xs" onclick="softRemoveStudent(${u.id}, '${escapeHtml(u.name)}')" title="Soft Remove from Active Roster">
              🗑️ Remove
            </button>
          ` : ''}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Load Students Directory
async function loadAdminUsersDirectory() {
  try {
    const res = await apiRequest(`/api/admin/users?status=${currentStudentFilter}`);
    if (!res.success || !res.users) {
      allAdminStudentsCache = [];
      renderStudentsTable([]);
      return;
    }

    allAdminStudentsCache = res.users;
    filterStudentsTable();
  } catch (err) {
    console.error('Error fetching admin users directory:', err);
    showToast('Failed to load students directory', 'error');
  }
}

// View Complete Student Dossier
window.openStudentDossier = async function(userId) {
  try {
    const res = await apiRequest(`/api/admin/users/${userId}/details`);
    if (!res.success || !res.user) {
      showToast('Could not load student dossier', 'error');
      return;
    }

    const u = res.user;
    const bill = res.currentBill;
    const payments = res.payments || [];
    const meals = res.meals || [];
    const lifetimePaid = res.lifetime_paid || 0;
    const dueBalance = bill ? Math.max(0, (bill.total_payable || 0) - (bill.paid_amount || 0)) : 0;
    const prevDue = bill ? (bill.prev_due || 0) : 0;

    // Header & Meta
    document.getElementById('dossier-name').textContent = u.name;
    document.getElementById('dossier-avatar').textContent = (u.name || 'U').charAt(0).toUpperCase();
    const statusBadge = document.getElementById('dossier-status-badge');
    statusBadge.className = `status-pill status-${u.status}`;
    statusBadge.textContent = u.status.toUpperCase();
    document.getElementById('dossier-meta').textContent = `Room: ${u.room_no || 'N/A'} • Enrolled: ${formatDate(u.created_at)}`;

    // Overview Stats
    document.getElementById('dossier-current-due').textContent = formatCurrency(dueBalance);
    document.getElementById('dossier-bill-breakdown').textContent = `Mess: ${formatCurrency(bill?.monthly_fee || 700)} • Masi: ${formatCurrency(bill?.masi_fee || 400)}`;
    document.getElementById('dossier-prev-due').textContent = formatCurrency(prevDue);
    document.getElementById('dossier-lifetime-paid').textContent = formatCurrency(lifetimePaid);

    // Attendance stats (last 30 days)
    let morningEats = 0;
    let nightEats = 0;
    meals.forEach(m => {
      if (m.morning_att === 'eat') morningEats++;
      if (m.night_att === 'eat') nightEats++;
    });
    document.getElementById('dossier-attendance-summary').textContent = `${morningEats + nightEats} Meals`;
    document.getElementById('dossier-attendance-detail').textContent = `${morningEats} Breakfast • ${nightEats} Dinner`;

    // Contact Grid
    document.getElementById('dossier-email').textContent = u.email;
    document.getElementById('dossier-phone').textContent = u.phone || 'Not Provided';
    document.getElementById('dossier-room').textContent = u.room_no || 'N/A';
    document.getElementById('dossier-id').textContent = `#${u.id}`;

    // Render Payments Table
    const payTbody = document.getElementById('dossier-payments-tbody');
    payTbody.innerHTML = '';
    if (payments.length === 0) {
      payTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1rem;">No payment records found for this student.</td></tr>`;
    } else {
      payments.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${formatDateTime(p.created_at)}</td>
          <td>${p.month || '-'}</td>
          <td style="color: var(--primary); font-weight: 700;">${formatCurrency(p.amount)}</td>
          <td><code style="font-size: 0.75rem;">${escapeHtml(p.utr_number || 'N/A')}</code></td>
          <td>${escapeHtml(p.payment_type || 'Mess Fee')}</td>
          <td><span class="status-pill status-${p.status}">${p.status}</span></td>
          <td style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(p.admin_note || '-')}</td>
        `;
        payTbody.appendChild(tr);
      });
    }

    // Render Meals Table
    const mealsTbody = document.getElementById('dossier-meals-tbody');
    mealsTbody.innerHTML = '';
    if (meals.length === 0) {
      mealsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1rem;">No meal records recorded in the last 30 days.</td></tr>`;
    } else {
      meals.forEach(m => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${m.date}</strong></td>
          <td>${m.morning_att === 'eat' ? '<span style="color: #34d399;">🟢 Eating</span>' : '<span style="color: #f87171;">🔴 Skip / No-Show</span>'}</td>
          <td>${m.night_att === 'eat' ? '<span style="color: #34d399;">🟢 Eating</span>' : '<span style="color: #f87171;">🔴 Skip / No-Show</span>'}</td>
          <td style="font-size: 0.75rem; color: var(--text-secondary);">${m.is_auto ? '🤖 Default Eating' : '👤 Student Marked'}</td>
          <td style="font-size: 0.72rem; color: var(--text-muted);">${formatDateTime(m.updated_at || m.created_at)}</td>
        `;
        mealsTbody.appendChild(tr);
      });
    }

    // Modal footer action buttons
    const actionBtns = document.getElementById('dossier-action-buttons');
    actionBtns.innerHTML = `
      <button class="btn btn-outline btn-sm" onclick="openEditStudentModal(${u.id})">✏️ Edit Profile</button>
      <button class="btn btn-outline btn-sm" onclick="openResetPasswordModal(${u.id}, '${escapeHtml(u.name)}')">🔑 Reset Password</button>
    `;

    document.getElementById('admin-student-dossier-modal').classList.add('active');
  } catch (err) {
    console.error('Error opening student dossier:', err);
    showToast('Failed to open student dossier', 'error');
  }
};

// Open Edit Student Modal
window.openEditStudentModal = async function(userId) {
  try {
    const res = await apiRequest(`/api/admin/users/${userId}/details`);
    if (!res.success || !res.user) {
      showToast('Could not load student information', 'error');
      return;
    }
    const u = res.user;
    document.getElementById('edit-student-id').value = u.id;
    document.getElementById('edit-student-name').value = u.name;
    document.getElementById('edit-student-email').value = u.email;
    document.getElementById('edit-student-room').value = u.room_no || '';
    document.getElementById('edit-student-phone').value = u.phone || '';
    document.getElementById('edit-student-status').value = u.status || 'active';

    document.getElementById('admin-edit-student-modal').classList.add('active');
  } catch (err) {
    showToast('Failed to load student details', 'error');
  }
};

// Open Reset Password Modal
window.openResetPasswordModal = function(userId, userName) {
  document.getElementById('reset-pwd-user-id').value = userId;
  document.getElementById('reset-pwd-user-name').textContent = userName;
  document.getElementById('reset-new-password').value = '';
  document.getElementById('reset-confirm-password').value = '';
  document.getElementById('admin-reset-pwd-modal').classList.add('active');
};

// Toggle Student Status (Activate / Deactivate)
window.toggleStudentStatus = async function(userId, currentStatus) {
  const nextAction = currentStatus === 'active' ? 'deactivate' : 'activate';
  if (!confirm(`Are you sure you want to ${nextAction} this student's account?`)) return;

  try {
    const res = await apiRequest(`/api/admin/users/${userId}/toggle-status`, { method: 'POST' });
    if (res.success) {
      showToast(res.message, 'success');
      loadAdminUsersDirectory();
      loadAdminDashboard();
    } else {
      showToast(res.message || 'Status toggle failed', 'error');
    }
  } catch (err) {
    showToast('Failed to update student status', 'error');
  }
};

// Soft-Remove Student
window.softRemoveStudent = async function(userId, userName) {
  const confirmed = confirm(
    `Are you sure you want to soft-remove ${userName} from the active mess roster?\n\n` +
    `Security Assurance:\n` +
    `• All meal attendance records will be permanently preserved.\n` +
    `• All payment transactions and historical billing ledgers remain intact.\n` +
    `• The student will be archived under 'Inactive / Removed' and excluded from active billing cycles.`
  );
  if (!confirmed) return;

  try {
    const res = await apiRequest(`/api/admin/users/${userId}/remove`, { method: 'POST' });
    if (res.success) {
      showToast(res.message, 'success');
      loadAdminUsersDirectory();
      loadAdminDashboard();
    } else {
      showToast(res.message || 'Failed to remove student', 'error');
    }
  } catch (err) {
    showToast('Failed to remove student', 'error');
  }
};

// ============================================================================
// ADMIN MANAGEMENT (OWNER EXCLUSIVE)
// ============================================================================
async function loadAdminAccounts() {
  try {
    const res = await apiRequest('/api/admin/admins');
    const tbody = document.getElementById('admin-admins-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!res.success || !res.admins || res.admins.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No admin accounts found.</td></tr>`;
      return;
    }

    // Toggle Add Admin button visibility depending on whether caller is owner
    const addAdminBtn = document.getElementById('admin-add-admin-modal-btn');
    if (addAdminBtn) {
      if (!res.callerIsOwner) {
        addAdminBtn.style.opacity = '0.5';
        addAdminBtn.title = 'Only the Website Owner can register new administrators';
      } else {
        addAdminBtn.style.opacity = '1';
        addAdminBtn.title = 'Register a new administrator';
      }
    }

    res.admins.forEach(a => {
      const tr = document.createElement('tr');
      const isOwner = a.is_owner === 1;
      const isSelf = state.user && state.user.id === a.id;

      let actionsHtml = '';
      if (isOwner) {
        actionsHtml = `<span style="font-size: 0.75rem; color: var(--text-muted);">Protected Owner</span>`;
      } else if (res.callerIsOwner) {
        actionsHtml = `
          <button class="btn btn-outline btn-xs" onclick="toggleAdminStatus(${a.id}, '${a.status}')" ${isSelf ? 'disabled' : ''}>
            ${a.status === 'active' ? '⏸️ Deactivate' : '🟢 Activate'}
          </button>
        `;
      } else {
        actionsHtml = `<span style="font-size: 0.75rem; color: var(--text-muted);">Owner Only</span>`;
      }

      tr.innerHTML = `
        <td>${a.id}</td>
        <td>
          <strong>${escapeHtml(a.name)}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(a.email)} • ${escapeHtml(a.phone || '-')}</div>
        </td>
        <td>
          ${isOwner ? '<span class="badge-owner">👑 Website Owner</span>' : '<span class="badge-admin-role">🛡️ Manager</span>'}
        </td>
        <td>
          <code style="font-size: 0.75rem; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px;">
            ${escapeHtml(a.permissions || 'all')}
          </code>
        </td>
        <td>
          <span class="status-pill status-${a.status}">${a.status}</span>
        </td>
        <td style="font-size: 0.8rem; color: var(--text-secondary);">${formatDate(a.created_at)}</td>
        <td style="text-align: right;">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching admins:', err);
    showToast('Failed to load admin accounts', 'error');
  }
}

window.openAddAdminModal = function() {
  if (state.user && state.user.is_owner !== 1 && state.user.is_owner !== true) {
    showToast('Only the primary Website Owner can register administrators', 'warning');
    return;
  }
  document.getElementById('admin-add-admin-modal').classList.add('active');
};

window.toggleAdminStatus = async function(adminId, currentStatus) {
  const next = currentStatus === 'active' ? 'deactivate' : 'activate';
  if (!confirm(`Are you sure you want to ${next} this administrator account?`)) return;

  try {
    const res = await apiRequest(`/api/admin/admins/${adminId}/toggle-status`, { method: 'POST' });
    if (res.success) {
      showToast(res.message, 'success');
      loadAdminAccounts();
    } else {
      showToast(res.message || 'Failed to toggle admin status', 'error');
    }
  } catch (err) {
    showToast('Failed to toggle admin status', 'error');
  }
};

// ============================================================================
// AUDIT LOG MANAGEMENT
// ============================================================================
async function loadAdminAuditLogs() {
  try {
    const action = document.getElementById('audit-action-filter')?.value || '';
    const search = document.getElementById('audit-search-input')?.value || '';

    const queryParams = new URLSearchParams();
    if (action) queryParams.append('action', action);
    if (search) queryParams.append('search', search);

    const res = await apiRequest(`/api/admin/audit-logs?${queryParams.toString()}`);
    const tbody = document.getElementById('admin-audit-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!res.success || !res.logs || res.logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No activity log records found.</td></tr>`;
      return;
    }

    res.logs.forEach(l => {
      const tr = document.createElement('tr');
      let actionTagClass = 'audit-action-tag';
      if (l.action.startsWith('STUDENT_')) actionTagClass += ' audit-action-student';
      else if (l.action.startsWith('PAYMENT_')) actionTagClass += ' audit-action-payment';
      else if (l.action.startsWith('ADMIN_')) actionTagClass += ' audit-action-admin';
      else actionTagClass += ' audit-action-tag';

      tr.innerHTML = `
        <td style="font-size: 0.78rem; color: var(--text-secondary);">${formatDateTime(l.created_at)}</td>
        <td>
          <strong>${escapeHtml(l.admin_name || 'Admin')}</strong>
          <div style="font-size: 0.72rem; color: var(--text-muted);">ID: #${l.admin_id}</div>
        </td>
        <td>
          <span class="${actionTagClass}">${escapeHtml(l.action)}</span>
        </td>
        <td>
          ${l.target_user_name ? `<strong>${escapeHtml(l.target_user_name)}</strong><div style="font-size: 0.72rem; color: var(--text-muted);">ID: #${l.target_user_id}</div>` : '<span style="color: var(--text-muted);">-</span>'}
        </td>
        <td style="font-size: 0.8rem; color: var(--text-secondary); max-width: 320px;">
          ${escapeHtml(l.details || '-')}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
  }
}

window.filterAuditLogs = function() {
  loadAdminAuditLogs();
};

// ============================================================================
// STUDENT PASSWORD RESET REQUESTS MANAGEMENT
// ============================================================================
async function loadPasswordResetRequests() {
  try {
    const res = await apiRequest('/api/admin/password-resets');
    const tbody = document.getElementById('admin-resets-tbody');
    const badge = document.getElementById('admin-resets-badge');
    if (badge) badge.textContent = res.pending_count || 0;
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!res.success || !res.requests || res.requests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">No password reset requests found.</td></tr>`;
      return;
    }

    res.requests.forEach(r => {
      const tr = document.createElement('tr');
      let statusHtml = '';
      if (r.status === 'pending') {
        statusHtml = '<span class="status-pill status-unpaid" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);">⏳ Pending Reset</span>';
      } else if (r.status === 'resolved') {
        statusHtml = `<span class="status-pill status-paid">✅ Resolved${r.resolved_by_name ? ` by ${escapeHtml(r.resolved_by_name)}` : ''}</span>`;
      } else {
        statusHtml = '<span class="status-pill status-overdue">❌ Rejected</span>';
      }

      let actionsHtml = '';
      if (r.status === 'pending') {
        actionsHtml = `
          <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
            <button class="btn btn-primary btn-sm" onclick="openResolveResetModal(${r.id}, '${escapeHtml(r.name)}', '${escapeHtml(r.email)}', '${escapeHtml(r.phone || '')}', '${escapeHtml(r.request_message || '')}')">
              🔑 Set Password
            </button>
            <button class="btn btn-outline btn-sm" style="color: #f87171; border-color: rgba(239, 68, 68, 0.35);" onclick="rejectPasswordReset(${r.id}, '${escapeHtml(r.name)}')">
              ✕ Reject
            </button>
          </div>
        `;
      } else {
        actionsHtml = `<span style="font-size: 0.75rem; color: var(--text-muted);">${r.resolved_at ? formatDateTime(r.resolved_at) : '-'}</span>`;
      }

      tr.innerHTML = `
        <td style="font-size: 0.78rem; color: var(--text-secondary); white-space: nowrap;">${formatDateTime(r.created_at)}</td>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td><code style="color: #60a5fa;">${escapeHtml(r.email)}</code></td>
        <td>${escapeHtml(r.room_no || '-')}</td>
        <td>${escapeHtml(r.phone || '-')}</td>
        <td style="font-size: 0.8rem; color: var(--text-secondary); max-width: 220px;">
          ${escapeHtml(r.request_message || '-')}
        </td>
        <td>${statusHtml}</td>
        <td style="text-align: right;">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching password reset requests:', err);
  }
}

window.openResolveResetModal = function(id, name, email, phone, note) {
  document.getElementById('resolve-modal-request-id').value = id;
  document.getElementById('resolve-modal-student-name').textContent = name;
  document.getElementById('resolve-modal-student-email').textContent = email;
  document.getElementById('resolve-modal-student-phone').textContent = phone || 'Not provided';
  document.getElementById('resolve-modal-student-note').textContent = note || 'Forgot password, requested reset';
  document.getElementById('resolve-modal-new-pwd').value = 'Mess@' + Math.floor(1000 + Math.random() * 9000);
  const modal = document.getElementById('admin-resolve-reset-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeResolveResetModal = function() {
  const modal = document.getElementById('admin-resolve-reset-modal');
  if (modal) modal.style.display = 'none';
};

window.generateResetPassword = function() {
  const pwdInput = document.getElementById('resolve-modal-new-pwd');
  if (pwdInput) {
    pwdInput.value = 'Mess@' + Math.floor(1000 + Math.random() * 9000);
  }
};

window.rejectPasswordReset = async function(id, name) {
  if (!confirm(`Are you sure you want to reject the password reset request for ${name}?`)) return;
  try {
    const res = await apiRequest(`/api/admin/password-resets/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Rejected by Admin' })
    });
    if (res.success) {
      showToast('Password reset request rejected', 'info');
      loadPasswordResetRequests();
      loadAdminDashboardStats();
    } else {
      showToast(res.message || 'Failed to reject request', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Error rejecting request', 'error');
  }
};

// Admin Settings
async function loadAdminSettings() {
  try {
    const res = await apiRequest('/api/admin/settings');
    if (!res.success) return;
    const s = res.settings;
    state.settings = s;

    document.getElementById('mess-name-display').textContent = s.mess_name;
    document.getElementById('announcement-text').textContent = s.announcement;

    document.getElementById('set-mess-name').value = s.mess_name;
    if (document.getElementById('set-monthly-fee')) document.getElementById('set-monthly-fee').value = s.monthly_fee || 700;
    if (document.getElementById('set-scanner-name')) document.getElementById('set-scanner-name').value = s.scanner_name || 'Bhabani Payment Scanner';
    if (document.getElementById('set-meal-rate')) document.getElementById('set-meal-rate').value = s.meal_rate || 0;
    document.getElementById('set-fine-amount').value = s.fine_amount;
    document.getElementById('set-fine-cutoff').value = s.fine_cutoff_day;
    document.getElementById('set-masi-fee').value = s.masi_fee;
    document.getElementById('set-masi-cutoff').value = s.masi_cutoff_day;
    document.getElementById('set-upi-id').value = s.upi_id;
    document.getElementById('set-upi-name').value = s.upi_name;
    document.getElementById('set-bank-name').value = s.bank_name;
    document.getElementById('set-acc-no').value = s.account_number;
    document.getElementById('set-ifsc').value = s.ifsc_code;
    document.getElementById('set-announcement').value = s.announcement;

    // Update Pay Modal QR code
    updatePayModalUpiDetails(s);

  } catch (err) {
    console.error('Error fetching settings:', err);
  }
}

function updatePayModalUpiDetails(s) {
  const upiId = s.upi_id || 'messmanager@okaxis';
  const upiName = s.upi_name || 'Mess Food Manager';
  const upiUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&cu=INR`;
  const fallbackQr = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUri)}`;

  const qrImg = document.getElementById('pay-modal-qr-img');
  if (qrImg) qrImg.src = fallbackQr;

  const upiEl = document.getElementById('pay-modal-upi-id');
  if (upiEl) upiEl.textContent = upiId;

  const bankEl = document.getElementById('pay-modal-bank-text');
  if (bankEl) {
    bankEl.textContent = `${s.bank_name || 'Bank'} A/C: ${s.account_number || ''} | IFSC: ${s.ifsc_code || ''}`;
  }

  // Fetch local QR code from backend
  apiRequest(`/api/payments/qr-code?upi_id=${encodeURIComponent(upiId)}&upi_name=${encodeURIComponent(upiName)}`)
    .then(res => {
      if (res && res.qr_data_url && qrImg) {
        qrImg.src = res.qr_data_url;
      }
    })
    .catch(() => {});
}

function setupAdminEvents() {
  // Admin Tabs Navigation
  const tabs = ['meals', 'pending', 'proofs', 'masi', 'users', 'resets', 'admins', 'audit', 'settings'];
  tabs.forEach(t => {
    const btn = document.getElementById(`admin-tab-${t}-btn`);
    if (btn) {
      btn.addEventListener('click', () => {
        tabs.forEach(other => {
          document.getElementById(`admin-tab-${other}-btn`)?.classList.remove('active');
          const content = document.getElementById(`admin-tab-content-${other}`);
          if (content) content.style.display = 'none';
        });
        btn.classList.add('active');
        const activeContent = document.getElementById(`admin-tab-content-${t}`);
        if (activeContent) activeContent.style.display = 'block';

        // Auto-refresh data on tab switch
        if (t === 'users') loadAdminUsersDirectory();
        if (t === 'resets') loadPasswordResetRequests();
        if (t === 'admins') loadAdminAccounts();
        if (t === 'audit') loadAdminAuditLogs();
        if (t === 'masi') loadAdminMasiFund();
        if (t === 'proofs') loadAdminPendingProofs();
        if (t === 'pending') loadAdminPendingUsers();
      });
    }
  });

  // Date picker in meals tab
  const datePicker = document.getElementById('admin-meal-date-picker');
  if (datePicker) {
    datePicker.value = state.todayDate;
    datePicker.addEventListener('change', (e) => {
      loadAdminDateHeadcount(e.target.value);
    });
  }

  // Refresh & Recalculate Buttons
  document.getElementById('admin-refresh-stats-btn')?.addEventListener('click', () => {
    loadAdminDashboard();
    showToast('Dashboard data refreshed', 'success');
  });

  document.getElementById('admin-recalc-btn')?.addEventListener('click', async () => {
    try {
      const res = await apiRequest('/api/billing/recalculate', { method: 'POST' });
      if (res.success) {
        showToast('All student bills recalculated successfully', 'success');
        loadAdminDashboard();
      }
    } catch (err) {
      showToast('Error recalculating bills', 'error');
    }
  });

  // Pending users, proofs & password resets refresh
  document.getElementById('admin-refresh-pending-btn')?.addEventListener('click', loadAdminPendingUsers);
  document.getElementById('admin-refresh-proofs-btn')?.addEventListener('click', loadAdminPendingProofs);
  document.getElementById('admin-refresh-resets-btn')?.addEventListener('click', () => {
    loadPasswordResetRequests();
    showToast('Password reset requests refreshed', 'success');
  });

  // Password Reset Resolve Modal Listeners
  document.getElementById('admin-close-resolve-modal-btn')?.addEventListener('click', closeResolveResetModal);
  document.getElementById('resolve-modal-gen-pwd-btn')?.addEventListener('click', generateResetPassword);
  document.getElementById('resolve-modal-reject-btn')?.addEventListener('click', () => {
    const id = document.getElementById('resolve-modal-request-id')?.value;
    const name = document.getElementById('resolve-modal-student-name')?.textContent || 'Student';
    closeResolveResetModal();
    if (id) rejectPasswordReset(id, name);
  });

  document.getElementById('admin-resolve-reset-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('resolve-modal-request-id')?.value;
    const newPassword = document.getElementById('resolve-modal-new-pwd')?.value?.trim();
    const studentName = document.getElementById('resolve-modal-student-name')?.textContent || 'Student';
    const studentEmail = document.getElementById('resolve-modal-student-email')?.textContent || '';

    if (!newPassword || newPassword.length < 4) {
      showToast('Password must be at least 4 characters long.', 'error');
      return;
    }

    try {
      const res = await apiRequest(`/api/admin/password-resets/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ newPassword })
      });

      if (res && res.success) {
        closeResolveResetModal();
        alert(`✅ Password Assigned Successfully!\n\nStudent: ${studentName}\nEmail: ${studentEmail}\nNew Assigned Password: ${res.newPassword}\n\nPlease share this password with the student.`);
        showToast(`New password set for ${studentName}`, 'success');
        loadPasswordResetRequests();
        loadAdminDashboard();
      } else {
        showToast(res?.message || 'Failed to assign password', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Error assigning password', 'error');
    }
  });

  // Settings Form Submit
  document.getElementById('admin-settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      mess_name: document.getElementById('set-mess-name').value,
      monthly_fee: parseFloat(document.getElementById('set-monthly-fee')?.value || 700),
      scanner_name: document.getElementById('set-scanner-name')?.value || 'Bhabani Payment Scanner',
      meal_rate: parseFloat(document.getElementById('set-meal-rate')?.value || 0),
      fine_amount: parseFloat(document.getElementById('set-fine-amount').value),
      fine_cutoff_day: parseInt(document.getElementById('set-fine-cutoff').value),
      masi_fee: parseFloat(document.getElementById('set-masi-fee').value),
      masi_cutoff_day: parseInt(document.getElementById('set-masi-cutoff').value),
      upi_id: document.getElementById('set-upi-id').value,
      upi_name: document.getElementById('set-upi-name').value,
      bank_name: document.getElementById('set-bank-name').value,
      account_number: document.getElementById('set-acc-no').value,
      ifsc_code: document.getElementById('set-ifsc').value,
      announcement: document.getElementById('set-announcement').value
    };

    try {
      const res = await apiRequest('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (res.success) {
        showToast('Settings saved successfully', 'success');
        loadAdminSettings();
      }
    } catch (err) {
      showToast('Failed to save settings', 'error');
    }
  });

  // Add User Modal
  document.getElementById('admin-add-user-modal-btn')?.addEventListener('click', () => {
    document.getElementById('admin-add-user-modal').classList.add('active');
  });

  document.getElementById('admin-add-user-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('admin-new-name').value,
      email: document.getElementById('admin-new-email').value,
      room_no: document.getElementById('admin-new-room').value,
      phone: document.getElementById('admin-new-phone').value,
      password: document.getElementById('admin-new-password').value
    };

    try {
      const res = await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.success) {
        showToast('New student added successfully', 'success');
        document.getElementById('admin-add-user-modal').classList.remove('active');
        document.getElementById('admin-add-user-form').reset();
        loadAdminUsersDirectory();
        loadAdminDashboard();
      } else {
        showToast(res.message || 'Failed to add user', 'error');
      }
    } catch (err) {
      showToast('Error adding student', 'error');
    }
  });

  // Edit Student Form Submit
  document.getElementById('admin-edit-student-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('edit-student-id').value;
    const payload = {
      name: document.getElementById('edit-student-name').value,
      email: document.getElementById('edit-student-email').value,
      room_no: document.getElementById('edit-student-room').value,
      phone: document.getElementById('edit-student-phone').value,
      status: document.getElementById('edit-student-status').value
    };

    try {
      const res = await apiRequest(`/api/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (res.success) {
        showToast('Student profile updated successfully', 'success');
        document.getElementById('admin-edit-student-modal').classList.remove('active');
        loadAdminUsersDirectory();
        loadAdminDashboard();
      } else {
        showToast(res.message || 'Failed to update student profile', 'error');
      }
    } catch (err) {
      showToast('Failed to update student profile', 'error');
    }
  });

  // Reset Student Password Form Submit
  document.getElementById('admin-reset-pwd-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('reset-pwd-user-id').value;
    const newPwd = document.getElementById('reset-new-password').value;
    const confirmPwd = document.getElementById('reset-confirm-password').value;

    if (newPwd !== confirmPwd) {
      showToast('Passwords do not match', 'error');
      return;
    }

    try {
      const res = await apiRequest(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: newPwd })
      });
      if (res.success) {
        showToast(res.message || 'Password successfully updated', 'success');
        document.getElementById('admin-reset-pwd-modal').classList.remove('active');
        document.getElementById('admin-reset-pwd-form').reset();
      } else {
        showToast(res.message || 'Failed to reset password', 'error');
      }
    } catch (err) {
      showToast('Failed to reset password', 'error');
    }
  });

  // Add Secondary Admin Form Submit
  document.getElementById('admin-add-admin-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('new-admin-name').value,
      email: document.getElementById('new-admin-email').value,
      phone: document.getElementById('new-admin-phone').value,
      password: document.getElementById('new-admin-password').value,
      permissions: document.getElementById('new-admin-permissions').value
    };

    try {
      const res = await apiRequest('/api/admin/admins', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.success) {
        showToast('Administrator created successfully', 'success');
        document.getElementById('admin-add-admin-modal').classList.remove('active');
        document.getElementById('admin-add-admin-form').reset();
        loadAdminAccounts();
      } else {
        showToast(res.message || 'Failed to create administrator', 'error');
      }
    } catch (err) {
      showToast('Failed to create administrator', 'error');
    }
  });
}

// ============================================================================
// TODAY'S MARKET DUTY & KITCHEN ROUTINE WIDGET
// ============================================================================
async function loadTodayMarketDutyWidget(viewType = 'user') {
  try {
    const res = await apiRequest('/api/meals/today-duty');
    if (!res.success) return;

    const dayNameEl = document.getElementById(`${viewType}-today-day-name`);
    const dutyTeamEl = document.getElementById(`${viewType}-today-duty-team`);
    const morningDishEl = document.getElementById(`${viewType}-today-morning-dish`);
    const nightDishEl = document.getElementById(`${viewType}-today-night-dish`);

    const dayName = res.dayName || '';
    const todayData = res.today || {};
    const bengaliDay = todayData.bengali_day ? ` • ${todayData.bengali_day}` : '';

    if (dayNameEl) dayNameEl.textContent = `${dayName}${bengaliDay}`;
    if (dutyTeamEl) {
      if (todayData.market_duty) {
        dutyTeamEl.innerHTML = `<span style="color: #34d399; font-weight: 700;">🛒 ${todayData.market_duty}</span>`;
      } else {
        dutyTeamEl.textContent = 'No squad assigned';
      }
    }
    if (morningDishEl) morningDishEl.textContent = todayData.morning_menu || 'Not scheduled';
    if (nightDishEl) nightDishEl.textContent = todayData.night_menu || 'Not scheduled';
  } catch (err) {
    console.error('Error fetching today market duty:', err);
  }
}

// ============================================================================
// WEEKLY FOOD & MARKET ROUTINE
// ============================================================================
let cachedWeeklyMenu = [];

async function loadWeeklyMenu() {
  try {
    const res = await apiRequest('/api/meals/menu');
    if (!res.success || !res.menu) return;

    cachedWeeklyMenu = res.menu;

    // Show/hide Edit Routine button based on role
    const editBtn = document.getElementById('edit-routine-btn');
    if (editBtn) {
      editBtn.style.display = (state.user && state.user.role === 'admin') ? 'inline-flex' : 'none';
    }

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = days[new Date().getDay()];

    // 1. Populate Master Routine Table (handwritten table replica)
    const tbody = document.getElementById('routine-master-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      res.menu.forEach(item => {
        const isToday = (item.day_of_week === todayName);
        const tr = document.createElement('tr');
        if (isToday) {
          tr.className = 'routine-today-row';
        }

        tr.innerHTML = `
          <td>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div>
                <strong style="font-size: 0.95rem;">${item.day_of_week}</strong>
                <div style="font-size: 0.8rem; color: #fbbf24; font-weight: 600;">${item.bengali_day || ''}</div>
              </div>
              ${isToday ? '<span class="badge-tag" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 0.68rem; font-weight: 700;">TODAY</span>' : ''}
            </div>
          </td>
          <td>
            <div class="duty-chip">
              <span style="font-size: 1.1rem;">🛒</span>
              <div>
                <strong style="color: #34d399; font-size: 0.92rem;">${item.market_duty || 'Unassigned'}</strong>
                <div style="font-size: 0.7rem; color: var(--text-muted);">Market Duty Squad</div>
              </div>
            </div>
          </td>
          <td>
            <div style="display: flex; align-items: flex-start; gap: 0.45rem;">
              <span style="color: var(--accent); font-size: 1rem;">☀️</span>
              <div>
                <strong style="color: var(--text-primary); font-size: 0.88rem;">${item.morning_menu}</strong>
                <div style="font-size: 0.72rem; color: var(--text-secondary);">Breakfast & Lunch</div>
              </div>
            </div>
          </td>
          <td>
            <div style="display: flex; align-items: flex-start; gap: 0.45rem;">
              <span style="color: var(--purple); font-size: 1rem;">🌙</span>
              <div>
                <strong style="color: var(--text-primary); font-size: 0.88rem;">${item.night_menu}</strong>
                <div style="font-size: 0.72rem; color: var(--text-secondary);">Dinner</div>
              </div>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    // 2. Populate Visual Cards Container
    const container = document.getElementById('weekly-menu-cards-container');
    if (container) {
      container.innerHTML = '';
      res.menu.forEach(item => {
        const isToday = (item.day_of_week === todayName);
        const card = document.createElement('div');
        card.className = `glass-panel ${isToday ? 'routine-card-today' : ''}`;
        card.style.padding = '1.35rem';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.justifyContent = 'space-between';

        card.innerHTML = `
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-glass); padding-bottom: 0.6rem;">
              <div style="display: flex; align-items: baseline; gap: 0.5rem;">
                <h3 style="font-size: 1.15rem; color: var(--primary); margin: 0;">${item.day_of_week}</h3>
                <span style="font-size: 0.85rem; color: #fbbf24; font-weight: 600;">${item.bengali_day || ''}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 0.4rem;">
                ${isToday ? '<span class="badge-tag" style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 0.7rem; font-weight: 700;">TODAY</span>' : ''}
                <span style="font-size: 1.25rem;">🥘</span>
              </div>
            </div>

            <!-- Market Duty Box -->
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-sm); padding: 0.65rem 0.85rem; margin-bottom: 0.85rem;">
              <div style="font-size: 0.7rem; color: #34d399; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">
                🛒 Market Duty Squad (বাজারের দায়িত্ব)
              </div>
              <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-top: 0.2rem;">
                ${item.market_duty || 'Unassigned'}
              </div>
            </div>

            <!-- Morning Dish -->
            <div style="margin-bottom: 0.85rem; background: rgba(245, 158, 11, 0.05); padding: 0.6rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid rgba(245, 158, 11, 0.15);">
              <div style="font-size: 0.72rem; color: var(--accent); font-weight: 700; text-transform: uppercase; display: flex; align-items: center; gap: 0.35rem;">
                <span>☀️</span> Morning (সকাল ও দুপুর)
              </div>
              <p style="font-size: 0.88rem; font-weight: 600; margin: 0.25rem 0 0; color: var(--text-primary);">${item.morning_menu}</p>
            </div>

            <!-- Night Dish -->
            <div style="background: rgba(139, 92, 246, 0.05); padding: 0.6rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid rgba(139, 92, 246, 0.15);">
              <div style="font-size: 0.72rem; color: var(--purple); font-weight: 700; text-transform: uppercase; display: flex; align-items: center; gap: 0.35rem;">
                <span>🌙</span> Night (রাতের খাবার)
              </div>
              <p style="font-size: 0.88rem; font-weight: 600; margin: 0.25rem 0 0; color: var(--text-primary);">${item.night_menu}</p>
            </div>
          </div>
        `;
        container.appendChild(card);
      });
    }

  } catch (err) {
    console.error('Error fetching menu:', err);
  }
}

function setupRoutineEvents() {
  // Print routine button
  document.getElementById('print-routine-btn')?.addEventListener('click', () => {
    window.print();
  });

  // Edit routine button (Admin only)
  document.getElementById('edit-routine-btn')?.addEventListener('click', () => {
    openEditRoutineModal();
  });

  // Edit routine form submission
  document.getElementById('edit-routine-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveEditedRoutine();
  });
}

function openEditRoutineModal() {
  const modal = document.getElementById('edit-routine-modal');
  const body = document.getElementById('edit-routine-modal-body');
  if (!modal || !body) return;

  body.innerHTML = '';

  cachedWeeklyMenu.forEach((day, idx) => {
    const dayBox = document.createElement('div');
    dayBox.className = 'glass-panel';
    dayBox.style.padding = '1rem';
    dayBox.style.marginBottom = '1rem';
    dayBox.style.background = 'rgba(255, 255, 255, 0.03)';
    dayBox.style.border = '1px solid var(--border-glass)';

    dayBox.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
        <h4 style="color: var(--primary); font-size: 1rem; margin: 0;">
          📅 ${day.day_of_week} <span style="color: #fbbf24; font-size: 0.85rem;">(${day.bengali_day || ''})</span>
        </h4>
        <span class="badge-tag" style="font-size: 0.72rem;">Day ${idx + 1}</span>
      </div>
      <input type="hidden" class="edit-day-name" value="${day.day_of_week}">
      <input type="hidden" class="edit-bengali-day" value="${day.bengali_day || ''}">

      <div style="margin-bottom: 0.75rem;">
        <label class="form-label" style="font-size: 0.78rem;">🛒 Market Duty Squad (Students on Bazaar Duty)</label>
        <input type="text" class="form-control edit-market-duty" value="${day.market_duty || ''}" placeholder="e.g. Kalyan + Sujan + Arghya" required>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <div>
          <label class="form-label" style="font-size: 0.78rem;">☀️ Morning Menu (সকালের মেনু)</label>
          <input type="text" class="form-control edit-morning-menu" value="${day.morning_menu || ''}" placeholder="e.g. Veg + Dal (সবজি + ডাল)" required>
        </div>
        <div>
          <label class="form-label" style="font-size: 0.78rem;">🌙 Night Menu (রাতের মেনু)</label>
          <input type="text" class="form-control edit-night-menu" value="${day.night_menu || ''}" placeholder="e.g. Chicken (মাংস)" required>
        </div>
      </div>
    `;
    body.appendChild(dayBox);
  });

  modal.classList.add('active');
}

async function saveEditedRoutine() {
  const body = document.getElementById('edit-routine-modal-body');
  const dayBoxes = body.querySelectorAll('.glass-panel');
  const updatedMenu = [];

  dayBoxes.forEach(box => {
    updatedMenu.push({
      day_of_week: box.querySelector('.edit-day-name').value,
      bengali_day: box.querySelector('.edit-bengali-day').value,
      market_duty: box.querySelector('.edit-market-duty').value.trim(),
      morning_menu: box.querySelector('.edit-morning-menu').value.trim(),
      night_menu: box.querySelector('.edit-night-menu').value.trim(),
      special_note: ''
    });
  });

  try {
    const saveBtn = document.getElementById('save-routine-modal-btn');
    if (saveBtn) saveBtn.disabled = true;

    const res = await apiRequest('/api/meals/menu', {
      method: 'POST',
      body: JSON.stringify({ menu: updatedMenu })
    });

    if (res.success) {
      showToast('Food Menu & Market Duty Routine updated successfully!', 'success');
      document.getElementById('edit-routine-modal')?.classList.remove('active');
      loadWeeklyMenu();
      loadTodayMarketDutyWidget('user');
      loadTodayMarketDutyWidget('admin');
    } else {
      showToast(res.message || 'Failed to update routine', 'error');
    }
  } catch (err) {
    console.error('Save routine error:', err);
    showToast('Failed to save routine.', 'error');
  } finally {
    const saveBtn = document.getElementById('save-routine-modal-btn');
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ============================================================================
// PAYMENT MODAL & UPLOAD EVENTS
// ============================================================================
function getSelectedPayAmount() {
  const payModal = document.getElementById('pay-modal');
  const payInput = document.getElementById('pay-amount-input');

  // If pay modal is open and has user-specified amount
  if (payModal && payModal.classList.contains('active') && payInput && parseFloat(payInput.value) > 0) {
    return parseFloat(payInput.value);
  }

  // If direct pay input is available
  const directInput = document.getElementById('direct-pay-amount');
  if (directInput && parseFloat(directInput.value) > 0) {
    return parseFloat(directInput.value);
  }

  return calculateSelectedPaymentTotal();
}

function launchUpiPayment(appScheme = 'upi') {
  const upiId = state.settings?.upi_id || '8927971674@fam';
  const upiName = state.settings?.upi_name || 'Bhabani Prasad Ghosh';
  const amount = getSelectedPayAmount();
  const studentUpiId = document.getElementById('dash-payer-upi-input')?.value || document.getElementById('pay-payer-upi-id')?.value || '';

  // Build descriptive note for transaction
  const items = [];
  if (document.getElementById('calc-check-mess')?.checked) items.push('Mess700');
  if (document.getElementById('calc-check-maid')?.checked) items.push('Maid400');
  if (document.getElementById('calc-check-prev-due')?.checked) items.push('PrevDue');
  const itemDesc = items.length > 0 ? ` [${items.join('+')}]` : '';
  const note = `Mess Mate Rm ${state.user?.room_no || ''} ${state.user?.name || ''}${itemDesc}`.trim();

  let uri = '';
  if (appScheme === 'gpay') {
    uri = `tez://upi/pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  } else if (appScheme === 'phonepe') {
    uri = `phonepe://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  } else if (appScheme === 'paytm') {
    uri = `paytmmp://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  } else if (appScheme === 'bhim') {
    uri = `bhim://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  } else {
    // Standard Any UPI / generic intent handler (GPay, PhonePe, Paytm, BHIM, Cred, Amazon Pay, etc.)
    uri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
  }

  // Pre-fill amount & payer info into pay modal form and direct proof form
  if (document.getElementById('pay-amount-input')) {
    document.getElementById('pay-amount-input').value = amount;
  }
  if (document.getElementById('direct-pay-amount')) {
    document.getElementById('direct-pay-amount').value = amount;
  }
  if (document.getElementById('pay-payer-upi-id') && studentUpiId) {
    document.getElementById('pay-payer-upi-id').value = studentUpiId;
  }
  if (document.getElementById('pay-upi-app')) {
    const appMap = { gpay: 'Google Pay', phonepe: 'PhonePe', paytm: 'Paytm', bhim: 'BHIM UPI', upi: 'Any UPI App' };
    document.getElementById('pay-upi-app').value = appMap[appScheme] || 'Any UPI App';
  }
  if (document.getElementById('pay-notes') && !document.getElementById('pay-notes').value) {
    document.getElementById('pay-notes').value = note;
  }
  if (document.getElementById('direct-pay-note') && !document.getElementById('direct-pay-note').value) {
    document.getElementById('direct-pay-note').value = note;
  }

  // Launch the mobile payment intent with the exact locked amount
  window.location.href = uri;

  const appNames = { gpay: 'Google Pay', phonepe: 'PhonePe', paytm: 'Paytm', bhim: 'BHIM UPI', upi: 'Any UPI App' };
  showToast(`Opening ${appNames[appScheme] || 'UPI App'} for ₹${amount}. The calculated amount is pre-filled. Please take a screenshot after paying!`, 'info');

  // Open modal so student can immediately submit proof upon returning
  setTimeout(() => {
    document.getElementById('pay-modal')?.classList.add('active');
  }, 800);
}

function setupPaymentEvents() {
  // Open Pay Modal button
  const openPayBtn = document.getElementById('open-pay-modal-btn');
  if (openPayBtn) {
    openPayBtn.addEventListener('click', () => {
      document.getElementById('pay-modal').classList.add('active');
    });
  }

  // View QR code button on dashboard
  const viewQrBtn = document.getElementById('dash-view-qr-btn');
  if (viewQrBtn) {
    viewQrBtn.addEventListener('click', () => {
      document.getElementById('pay-modal').classList.add('active');
    });
  }

  // Big Pay via Any UPI App button
  const btnPayAny = document.getElementById('btn-pay-any-upi');
  if (btnPayAny) {
    btnPayAny.addEventListener('click', () => {
      launchUpiPayment('upi');
    });
  }

  // Itemized Checkboxes change events
  const checkMess = document.getElementById('calc-check-mess');
  const checkMaid = document.getElementById('calc-check-maid');
  const checkPrev = document.getElementById('calc-check-prev-due');
  const checkFine = document.getElementById('calc-check-fine');

  [checkMess, checkMaid, checkPrev, checkFine].forEach(cb => {
    if (cb) {
      cb.addEventListener('change', () => {
        calculateSelectedPaymentTotal();
      });
    }
  });

  // Quick select pills in #dash-upi-amount-pills
  document.getElementById('pill-both-1100')?.addEventListener('click', () => {
    if (checkMess) checkMess.checked = true;
    if (checkMaid && !checkMaid.disabled) checkMaid.checked = true;
    if (checkPrev) checkPrev.checked = false;
    if (checkFine) checkFine.checked = false;
    const total = calculateSelectedPaymentTotal();
    showToast(`Selected ₹${total} (Mess + Maid)`, 'info');
  });

  document.getElementById('pill-mess-700')?.addEventListener('click', () => {
    if (checkMess) checkMess.checked = true;
    if (checkMaid) checkMaid.checked = false;
    if (checkPrev) checkPrev.checked = false;
    if (checkFine) checkFine.checked = false;
    const total = calculateSelectedPaymentTotal();
    showToast(`Selected ₹${total} (Mess Fee Only • Due 5th)`, 'info');
  });

  document.getElementById('pill-maid-400')?.addEventListener('click', () => {
    if (checkMess) checkMess.checked = false;
    if (checkMaid && !checkMaid.disabled) checkMaid.checked = true;
    if (checkPrev) checkPrev.checked = false;
    if (checkFine) checkFine.checked = false;
    const total = calculateSelectedPaymentTotal();
    showToast(`Selected ₹${total} (Maid Fee Only • Due 7th)`, 'info');
  });

  document.getElementById('pill-prev-due')?.addEventListener('click', () => {
    if (checkMess) checkMess.checked = false;
    if (checkMaid) checkMaid.checked = false;
    if (checkPrev) checkPrev.checked = true;
    if (checkFine) checkFine.checked = false;
    const total = calculateSelectedPaymentTotal();
    showToast(`Selected Previous Due: ₹${total}`, 'info');
  });

  document.getElementById('dash-fill-due-pill')?.addEventListener('click', () => {
    const calc = state.billingCalc;
    if (calc && calc.dueBalance > 0) {
      if (checkMess) checkMess.checked = true;
      if (checkMaid && !checkMaid.disabled) checkMaid.checked = true;
      if (checkPrev && calc.prevDue > 0) checkPrev.checked = true;
      if (checkFine && calc.fineAmount > 0) checkFine.checked = true;
      calculateSelectedPaymentTotal();
      showToast(`Selected Full Total Due: ${formatCurrency(calc.dueBalance)}`, 'info');
    }
  });

  // Modal quick fill buttons
  document.getElementById('pay-modal-quick-1100-btn')?.addEventListener('click', () => {
    const payInput = document.getElementById('pay-amount-input');
    if (payInput) {
      payInput.value = 1100;
      updateDynamicPaymentQr(1100);
      showToast('Selected ₹1,100 (Mess + Maid)', 'info');
    }
  });

  document.getElementById('pay-modal-quick-700-btn')?.addEventListener('click', () => {
    const payInput = document.getElementById('pay-amount-input');
    if (payInput) {
      payInput.value = 700;
      updateDynamicPaymentQr(700);
      showToast('Selected ₹700 (Mess Fee)', 'info');
    }
  });

  document.getElementById('pay-modal-quick-400-btn')?.addEventListener('click', () => {
    const payInput = document.getElementById('pay-amount-input');
    if (payInput) {
      payInput.value = 400;
      updateDynamicPaymentQr(400);
      showToast('Selected ₹400 (Maid Fee)', 'info');
    }
  });

  document.getElementById('pay-modal-quick-due-btn')?.addEventListener('click', () => {
    const payInput = document.getElementById('pay-amount-input');
    const calc = state.billingCalc;
    const due = calc?.dueBalance > 0 ? calc.dueBalance : 1100;
    if (payInput) {
      payInput.value = due;
      updateDynamicPaymentQr(due);
      showToast(`Selected Full Due: ₹${due}`, 'info');
    }
  });

  // Pay amount input on manual typing in modal updates QR code dynamically
  document.getElementById('pay-amount-input')?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (val > 0) {
      updateDynamicPaymentQr(val);
    }
  });

  // Copy UPI pill
  const copyPill = document.getElementById('copy-upi-pill');
  if (copyPill) {
    copyPill.addEventListener('click', () => {
      const upiId = document.getElementById('pay-modal-upi-id').textContent;
      navigator.clipboard.writeText(upiId);
      showToast(`Copied UPI ID to clipboard: ${upiId}`, 'success');
    });
  }

  // Copy Payment Link Button
  const copyLinkBtn = document.getElementById('dash-upi-copy-link-btn');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      const upiId = state.settings?.upi_id || '8927971674@fam';
      const upiName = state.settings?.upi_name || 'Bhabani Prasad Ghosh';
      const amount = getSelectedPayAmount();
      const uri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&am=${amount.toFixed(2)}&cu=INR&tn=MessMate_Payment`;
      navigator.clipboard.writeText(uri);
      showToast(`Copied UPI Payment Link to clipboard!`, 'success');
    });
  }

  // Dashboard Direct UPI App Buttons
  document.getElementById('dash-pay-gpay-btn')?.addEventListener('click', () => launchUpiPayment('gpay'));
  document.getElementById('dash-pay-phonepe-btn')?.addEventListener('click', () => launchUpiPayment('phonepe'));
  document.getElementById('dash-pay-paytm-btn')?.addEventListener('click', () => launchUpiPayment('paytm'));
  document.getElementById('dash-pay-bhim-btn')?.addEventListener('click', () => launchUpiPayment('bhim'));
  document.getElementById('dash-pay-generic-btn')?.addEventListener('click', () => launchUpiPayment('upi'));

  // Modal Direct UPI App Buttons
  document.getElementById('modal-pay-gpay-btn')?.addEventListener('click', () => launchUpiPayment('gpay'));
  document.getElementById('modal-pay-phonepe-btn')?.addEventListener('click', () => launchUpiPayment('phonepe'));
  document.getElementById('modal-pay-paytm-btn')?.addEventListener('click', () => launchUpiPayment('paytm'));
  document.getElementById('modal-pay-bhim-btn')?.addEventListener('click', () => launchUpiPayment('bhim'));
  document.getElementById('modal-pay-generic-btn')?.addEventListener('click', () => launchUpiPayment('upi'));

  // Drag & drop dropzone
  const dropzone = document.getElementById('proof-dropzone');
  const fileInput = document.getElementById('proof-file-input');
  const previewContainer = document.getElementById('proof-preview-container');
  const previewImg = document.getElementById('proof-preview-img');
  const removeBtn = document.getElementById('remove-proof-btn');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleFilePreview(fileInput.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        handleFilePreview(fileInput.files[0]);
      }
    });

    removeBtn.addEventListener('click', () => {
      fileInput.value = '';
      previewContainer.style.display = 'none';
      dropzone.style.display = 'block';
    });
  }

  function handleFilePreview(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file (JPG, PNG, WebP)', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      previewContainer.style.display = 'block';
      dropzone.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  // Submit Payment Modal Form
  const payForm = document.getElementById('payment-submission-form');
  if (payForm) {
    payForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = document.getElementById('pay-amount-input').value;
      const month = document.getElementById('pay-month-input').value;
      const utr = document.getElementById('pay-utr-input').value;
      const note = document.getElementById('pay-note-input').value;
      const payerUpiId = document.getElementById('pay-payer-upi-id')?.value || '';
      const upiApp = document.getElementById('pay-upi-app')?.value || 'UPI App';
      const btn = document.getElementById('submit-payment-proof-btn');

      if (!fileInput.files || fileInput.files.length === 0) {
        showToast('Please attach the payment screenshot proof', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('amount', amount);
      formData.append('month', month);
      formData.append('utr_number', utr);
      formData.append('note', note);
      formData.append('payer_upi_id', payerUpiId);
      formData.append('upi_app', upiApp);
      formData.append('screenshot', fileInput.files[0]);

      try {
        btn.disabled = true;
        btn.textContent = 'Uploading Screenshot...';

        const res = await apiRequest('/api/payments/submit', {
          method: 'POST',
          body: formData
        });

        if (res.success) {
          showToast(res.message, 'success');
          document.getElementById('pay-modal').classList.remove('active');
          payForm.reset();
          previewContainer.style.display = 'none';
          dropzone.style.display = 'block';
          loadUserDashboard();
        } else {
          showToast(res.message || 'Payment submission failed', 'error');
        }
      } catch (err) {
        showToast('Failed to submit payment proof', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Submit Proof for Verification';
      }
    });
  }
}

// Modal Global Setup
function setupModalEvents() {
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-modal');
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('active');
    });
  });

  // Close when clicking backdrop
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });
}

// ============================================================================
// MESSMITRA SAVINGS CALCULATOR & SOUNDBOX AUDIO
// ============================================================================
function setupSavingsCalculator() {
  const studentsSlider = document.getElementById('calc-students-slider');
  const skipSlider = document.getElementById('calc-skip-slider');

  if (!studentsSlider || !skipSlider) return;

  const updateCalc = () => {
    const students = parseInt(studentsSlider.value);
    const skipPct = parseInt(skipSlider.value);

    document.getElementById('calc-students-val').textContent = `${students} Students`;
    document.getElementById('calc-skip-val').textContent = `${skipPct}% Skipping`;

    // 2 meals a day * 30 days = 60 meals per student/month
    const totalPlannedMeals = students * 60;
    const skippedMeals = Math.round(totalPlannedMeals * (skipPct / 100));

    // ~180g of raw ingredient waste prevented per skipped meal
    const wasteKg = Math.round(skippedMeals * 0.18);
    // Approx ₹50 per meal with 60% variable grocery component saved
    const savedMoney = Math.round(skippedMeals * 50 * 0.6);
    // Weekly manual ledger/register hours saved
    const savedHours = Math.max(4, Math.round(students * 0.12));

    document.getElementById('calc-metric-waste').textContent = `${wasteKg.toLocaleString('en-IN')} kg`;
    document.getElementById('calc-metric-money').textContent = `₹${savedMoney.toLocaleString('en-IN')}`;
    document.getElementById('calc-metric-hours').textContent = `${savedHours} hrs`;
  };

  studentsSlider.addEventListener('input', updateCalc);
  skipSlider.addEventListener('input', updateCalc);
  updateCalc();
}

function playAudioFeedback(type = 'chime') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === 'skip') {
      // De-escalating lower tone for skipping
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.2);
    } else {
      // Pleasant bright chime for eating / approval
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.18); // A5
    }

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    // AudioContext blocked or not supported in environment
  }
}

