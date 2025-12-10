// Application State
let currentScreen = 'home';
let socket = null;
let webrtc = null;
// Queue for early signaling messages that arrive before WebRTC is ready
let pendingSignals = [];
let currentRoom = null;
let selectedFiles = [];
let sentFiles = [];
// Per-file progress maps
window.sentItemMap = new Map();
window.incomingItemMap = new Map();
// Map to keep stable IDs for outgoing files across UI (keyed by name:size:lastModified)
window.outgoingIdByKey = new Map();
// Control flags for each outgoing transfer (paused / cancelled)
window.outgoingControl = new Map();

// Authentication state
let currentUser = null;
let authToken = null;
let isReconnecting = false; // Flag to prevent disconnect error during auth reconnection
let isIntentionalDisconnect = false; // Flag to distinguish intentional leave from connection loss

// Room timer state
let roomTimer = null;
let roomExpirationTime = null;

// Authentication functions
async function checkAuthStatus() {
  const token = localStorage.getItem('authToken');
  if (!token) return null;

  try {
    const response = await fetch('/api/auth/verify', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (data.success && data.authenticated) {
      currentUser = data.user;
      window.currentUser = data.user;
      authToken = token;
      updateUserUI(true);
      return data.user;
    } else {
      localStorage.removeItem('authToken');
      return null;
    }
  } catch (error) {
    console.error('Auth check error:', error);
    localStorage.removeItem('authToken');
    return null;
  }
}

function updateUserUI(isLoggedIn) {
  const userMenu = document.getElementById('user-menu');
  const authButtons = document.getElementById('auth-buttons');
  const fileLimitInfo = document.getElementById('file-limit-info');

  if (isLoggedIn && currentUser) {
    // Add logged-in class to body for CSS styling
    document.body.classList.add('logged-in');

    userMenu.classList.remove('hidden');
    authButtons.classList.add('hidden');

    document.getElementById('user-name').textContent = currentUser.username;
    if (currentUser.avatar) {
      updateAvatarDisplay(currentUser.avatar);
    } else {
      // Reset to default avatar
      const userAvatar = document.getElementById('user-avatar');
      userAvatar.style.backgroundImage = '';
      userAvatar.textContent = '👤';
    }

    // Update file limit info for logged-in users
    const isPremium = currentUser.subscription?.plan === 'premium' && currentUser.subscription?.status === 'active';

    // Show/hide upgrade button based on premium status
    const upgradePremiumBtn = document.getElementById('upgrade-premium-btn');
    if (isPremium) {
      upgradePremiumBtn.style.display = 'none';
    } else {
      upgradePremiumBtn.style.display = 'block';
    }

    if (fileLimitInfo) {
      if (isPremium) {
        fileLimitInfo.textContent = '👑 Premium: 10GB file sizes • Maximum speed transfers • Unlimited rooms';
        fileLimitInfo.classList.add('logged-in', 'premium');
      } else {
        fileLimitInfo.textContent = 'Free Account: 500MB file sizes • Up to 1MB/s transfers • Unlimited rooms';
        fileLimitInfo.classList.add('logged-in');
      }
    }

    // Load room history for logged-in users
    setTimeout(() => loadRoomHistory(), 100);
  } else {
    // Remove logged-in class from body for CSS styling
    document.body.classList.remove('logged-in');

    userMenu.classList.add('hidden');
    authButtons.classList.remove('hidden');

    // Update file limit info for anonymous users
    if (fileLimitInfo) {
      fileLimitInfo.textContent = 'Anonymous users: 30MB limit per file • 0.03 MB/s speed • 2-minute rooms • No transfer controls • Login for premium features';
      fileLimitInfo.classList.remove('logged-in');
    }

    // Hide room history for anonymous users
    const roomHistorySection = document.getElementById('room-history-section');
    if (roomHistorySection) {
      roomHistorySection.classList.add('hidden');
    }
  }
}

function logout() {
  currentUser = null;
  window.currentUser = null;
  authToken = null;
  localStorage.removeItem('authToken');

  // Clear profile modal content when logging out
  hideModal('profile-modal');
  const profileRoomsList = document.getElementById('profile-rooms');
  if (profileRoomsList) {
    profileRoomsList.innerHTML = '';
  }

  updateUserUI(false);

  // Reconnect socket without auth
  if (socket) {
    isReconnecting = true;
    socket.disconnect();
    setTimeout(() => {
      initializeSocket();
      isReconnecting = false;
    }, 100);
  }
}

// Show premium upgrade modal
function showPremiumModal() {
  console.log('showPremiumModal called');

  // Close user dropdown menu
  const userDropdown = document.querySelector('.user-dropdown');
  if (userDropdown) {
    userDropdown.classList.remove('show');
  }

  showModal('premium-modal');
}

// Upgrade to premium with Stripe
async function upgradeToPremium() {
  const btn = document.getElementById('start-premium-trial-btn');
  if (!btn) {
    showNotification('Payment button unavailable. Please reload and try again.', 'error');
    return;
  }

  const originalText = btn.textContent;

  try {
    // Show loading state
    btn.disabled = true;
    btn.textContent = 'Creating checkout session...';

    const response = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();

    if (response.ok && data.url) {
      // Redirect to Stripe Checkout
      btn.textContent = 'Redirecting to payment...';
      window.location.href = data.url;
    } else {
      showNotification(data.error || 'Failed to create checkout session', 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch (error) {
    console.error('Premium upgrade error:', error);
    showNotification('Failed to start checkout. Please try again.', 'error');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthStatus();
  // Remove loading class to show auth UI
  document.body.classList.remove('loading');

  // Check for payment success/cancel
  await checkPaymentStatus();

  initializeSocket();
  setupEventListeners();
  setupAuthEventListeners();
  showScreen('home');
  // Disable file selection until peer connection established
  setFileSelectionEnabled(false);
});

// Check payment status from URL parameters
async function checkPaymentStatus() {
  const urlParams = new URLSearchParams(window.location.search);
  const payment = urlParams.get('payment');
  const sessionId = urlParams.get('session_id');

  if (payment === 'success' && sessionId) {
    await handlePaymentSuccess(sessionId);
  } else if (payment === 'cancelled') {
    // Payment cancelled
    showNotification('Payment cancelled. You can try again anytime.', 'info');

    // Clean URL
    window.history.replaceState({}, document.title, '/');
  }
}

async function handlePaymentSuccess(sessionId) {
  try {
    if (!authToken) {
      showNotification('Log back in to finalize your upgrade.', 'info');
      window.history.replaceState({}, document.title, '/');
      return;
    }

    const response = await fetch('/api/stripe/confirm-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ sessionId })
    });

    const data = await response.json();

    if (!response.ok) {
      showNotification(data.error || 'Unable to confirm payment right now.', 'error');
      window.history.replaceState({}, document.title, '/');
      return;
    }

    if (data.user) {
      currentUser = data.user;
      window.currentUser = data.user;
      updateUserUI(true);
    } else {
      // Refresh as fallback
      await checkAuthStatus();
    }

    showPurchaseSuccess({ sessionId, subscription: data.subscription });
  } catch (error) {
    console.error('Payment confirmation failed:', error);
    showNotification('Payment succeeded, but we could not refresh your account. Please contact support.', 'error');
  }

  // Clean URL
  window.history.replaceState({}, document.title, '/');
}

function showPurchaseSuccess({ sessionId, subscription }) {
  const successLayer = document.getElementById('payment-success');
  if (!successLayer) return;

  const sessionEl = successLayer.querySelector('[data-session-id]');
  const planEl = successLayer.querySelector('[data-plan-status]');
  const periodEl = successLayer.querySelector('[data-period-end]');

  if (sessionEl && sessionId) {
    sessionEl.textContent = `Session • ${sessionId.slice(-8)}`;
  }

  if (planEl) {
    planEl.textContent = subscription?.plan ? `${subscription.plan} plan` : 'Premium activated';
  }

  if (periodEl && subscription?.endDate) {
    const end = new Date(subscription.endDate);
    // Format as DD/MM/YYYY
    const day = String(end.getDate()).padStart(2, '0');
    const month = String(end.getMonth() + 1).padStart(2, '0');
    const year = end.getFullYear();
    periodEl.textContent = `Renews ${day}/${month}/${year}`;
  } else if (periodEl) {
    periodEl.textContent = 'Renews monthly';
  }

  successLayer.classList.remove('hidden');
  document.body.classList.add('success-open');
}

function hidePurchaseSuccess() {
  const successLayer = document.getElementById('payment-success');
  if (successLayer) {
    successLayer.classList.add('hidden');
  }
  document.body.classList.remove('success-open');
}

// Socket.io initialization
function initializeSocket() {
  const options = {};
  if (authToken) {
    options.auth = { token: authToken };
  }

  socket = io(options);

  socket.on('connect', () => {
    console.log('Connected to server');
    isReconnecting = false; // Reset flag on successful connection
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    if (webrtc) {
      webrtc.disconnect();
    }
    // Show room exited modal only if user intentionally left
    // Otherwise, show connection lost error if not reconnecting
    if (isIntentionalDisconnect) {
      isIntentionalDisconnect = false; // Reset flag
      showRoomExitedModal();
    } else if (!isReconnecting) {
      showError('Connection lost. Please refresh the page.');
    }
  });

  // Room events
  socket.on('user-joined', (data) => {
    console.log('User joined:', data.userId);
    if (webrtc && webrtc.isInitiator) {
      webrtc.createOffer();
    }
  });

  socket.on('user-left', (data) => {
    console.log('User left:', data.userId);
    updateConnectionStatus(false);
  });

  // WebRTC connection events
  socket.on('peer-connection-ready', (data) => {
    console.log('Peer WebRTC ready:', data.userId);
    // Peer is ready, we can start offering if we're the initiator
    if (webrtc && webrtc.isInitiator) {
      setTimeout(() => webrtc.createOffer(), 100); // Small delay to ensure both sides are ready
    }
  });

  socket.on('peer-connected', (data) => {
    console.log('Peer fully connected:', data.userId);
    updateConnectionStatus(true);
  });

  // Handle WebRTC offer initiation for rejoined creators
  socket.on('start-webrtc-offer', () => {
    console.log('Starting WebRTC offer as creator');
    if (webrtc && webrtc.isInitiator) {
      setTimeout(() => webrtc.createOffer(), 100);
    }
  });

  // Room expiration event
  socket.on('room-expired', (data) => {
    console.log('Room expired:', data);
    clearRoomTimer();

    // Clean up room state and redirect to home
    if (webrtc) {
      webrtc.disconnect();
      webrtc = null;
    }

    currentRoom = null;
    selectedFiles = [];
    sentFiles = [];
    clearSelectedFiles();
    clearSentFiles();
    clearReceivedFiles();
    hideTransferProgress();

    // Show expiration modal, then redirect
    showRoomExpiredModal(data.message);

    // Auto-redirect to home after showing the modal
    setTimeout(() => {
      showScreen('home');
    }, 3000); // 3 seconds to read the message
  });

  // Handle room deletion
  socket.on('room-deleted', (data) => {
    console.log('Room deleted:', data);

    showSuccess(data.message || 'Room has been deleted');

    // Clean up room state and redirect to home
    if (webrtc) {
      webrtc.disconnect();
      webrtc = null;
    }

    currentRoom = null;
    selectedFiles = [];
    sentFiles = [];
    clearSelectedFiles();
    clearSentFiles();
    clearReceivedFiles();
    hideTransferProgress();

    // Refresh room history to remove deleted room
    loadRoomHistory();

    // Redirect to home
    showScreen('home');
  });

  // WebRTC signaling
  socket.on('offer', async (data) => {
    if (webrtc) {
      await webrtc.handleOffer(data.offer);
    } else {
      // Queue the offer until WebRTC is initialized
      pendingSignals.push({ type: 'offer', payload: data.offer });
      console.log('Queued early offer');
    }
  });

  socket.on('answer', async (data) => {
    if (webrtc) {
      await webrtc.handleAnswer(data.answer);
    } else {
      pendingSignals.push({ type: 'answer', payload: data.answer });
      console.log('Queued early answer');
    }
  });

  socket.on('ice-candidate', async (data) => {
    if (webrtc) {
      await webrtc.handleIceCandidate(data.candidate);
    } else {
      pendingSignals.push({ type: 'ice', payload: data.candidate });
      // Do not log too noisy
    }
  });
}

// Event Listeners
function setupEventListeners() {
  // Helper function to safely add event listeners
  const addListener = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(event, handler);
    } else {
      console.warn(`Element with ID "${id}" not found for event "${event}"`);
    }
  };

  // Home screen buttons
  addListener('create-room-btn', 'click', createRoom);
  addListener('join-room-btn', 'click', () => showScreen('join'));

  // Join screen
  addListener('join-submit-btn', 'click', joinRoom);
  addListener('back-from-join-btn', 'click', () => showScreen('home'));
  addListener('room-code', 'keypress', (e) => {
    if (e.key === 'Enter') joinRoom();
  });

  // Room screen
  addListener('leave-room-btn', 'click', leaveRoom);
  // Wire up header delete button to delete current room
  const headerDeleteBtn = document.getElementById('delete-room-btn');
  if (headerDeleteBtn) {
    headerDeleteBtn.addEventListener('click', () => {
      if (currentRoom) {
        deleteRoom(currentRoom);
      }
    });
  }
  // Tabs
  const tabSend = document.getElementById('tab-send');
  const tabReceive = document.getElementById('tab-receive');
  if (tabSend && tabReceive) {
    tabSend.addEventListener('click', () => switchRoomTab('send'));
    tabReceive.addEventListener('click', () => switchRoomTab('receive'));
  }
  // Manual send button
  const sendBtn = document.getElementById('send-selected-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendSelectedFiles);
  }

  // File handling
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('file-drop-zone');

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelection);

    // Drag and drop
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleFileDrop);
  }

  // Error modal
  const errorOkBtn = document.getElementById('error-ok-btn');
  if (errorOkBtn) {
    errorOkBtn.addEventListener('click', hideError);
  }

  // Prevent default drag behavior on the whole page
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // Sent files action buttons (pause/resume/cancel) via delegation
  const sentList = document.getElementById('sent-files-list');
  if (sentList) {
    sentList.addEventListener('click', (e) => {
      const btn = e.target.closest('.sent-btn');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (!id || !action) return;
      if (action === 'pause') outgoingFilePause(id);
      else if (action === 'resume') outgoingFileResume(id);
      else if (action === 'cancel') outgoingFileCancel(id);
      else if (action === 'retry') outgoingFileRetry(id);
    });
  }

  // Bulk action buttons
  const pauseAllBtn = document.getElementById('pause-all-btn');
  const resumeAllBtn = document.getElementById('resume-all-btn');
  const cancelAllBtn = document.getElementById('cancel-all-btn');
  const clearCancelledSentBtn = document.getElementById('clear-cancelled-sent-btn');
  const clearCancelledIncomingBtn = document.getElementById('clear-cancelled-incoming-btn');
  if (pauseAllBtn) pauseAllBtn.addEventListener('click', outgoingPauseAll);
  if (resumeAllBtn) resumeAllBtn.addEventListener('click', outgoingResumeAll);
  if (cancelAllBtn) cancelAllBtn.addEventListener('click', outgoingCancelAll);
  if (clearCancelledSentBtn) clearCancelledSentBtn.addEventListener('click', clearCancelledSent);
  if (clearCancelledIncomingBtn) clearCancelledIncomingBtn.addEventListener('click', clearCancelledIncoming);
}

// Enable/disable file selection UI
function setFileSelectionEnabled(enabled) {
  const dropZone = document.getElementById('file-drop-zone');
  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.disabled = !enabled;
  if (dropZone) {
    dropZone.classList.toggle('disabled', !enabled);
    dropZone.setAttribute('aria-disabled', !enabled ? 'true' : 'false');
  }
}

// Authentication event listeners
function setupAuthEventListeners() {
  // Helper to safely add listeners
  const addListener = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(event, handler);
    }
  };

  // Login/Register button listeners
  addListener('login-btn', 'click', () => showModal('login-modal'));
  addListener('register-btn', 'click', () => showModal('register-modal'));

  // Modal close buttons
  addListener('login-close-btn', 'click', () => hideModal('login-modal'));
  addListener('register-close-btn', 'click', () => hideModal('register-modal'));
  addListener('profile-close-btn', 'click', () => hideModal('profile-modal'));

  // Premium modal close buttons
  document.querySelectorAll('[data-modal="premium-modal"]').forEach(btn => {
    btn.addEventListener('click', () => hideModal('premium-modal'));
  });

  // Switch between login and register
  addListener('show-register-btn', 'click', () => {
    hideModal('login-modal');
    showModal('register-modal');
  });
  addListener('show-login-btn', 'click', () => {
    hideModal('register-modal');
    showModal('login-modal');
  });

  // Form submissions
  addListener('login-form', 'submit', handleLogin);
  addListener('register-form', 'submit', handleRegister);

  // User menu actions
  const userProfileBtn = document.getElementById('user-profile-btn');
  const upgradePremiumBtn = document.getElementById('upgrade-premium-btn');
  const userLogoutBtn = document.getElementById('user-logout-btn');
  const startPremiumTrialBtn = document.getElementById('start-premium-trial-btn');

  if (userProfileBtn) {
    userProfileBtn.addEventListener('click', showProfile);
  }

  if (upgradePremiumBtn) {
    upgradePremiumBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Upgrade button clicked');

      // Close the dropdown first
      const userDropdown = document.querySelector('.user-dropdown');
      if (userDropdown) {
        userDropdown.classList.remove('show');
      }

      // Then show the premium modal
      setTimeout(() => {
        showPremiumModal();
      }, 100);
    });
  }

  if (userLogoutBtn) {
    userLogoutBtn.addEventListener('click', logout);
  }

  // Premium upgrade
  if (startPremiumTrialBtn) {
    startPremiumTrialBtn.addEventListener('click', upgradeToPremium);
  }

  // Payment history and cancel subscription
  addListener('view-payment-history-btn', 'click', showPaymentHistory);
  addListener('cancel-subscription-btn', 'click', showCancelConfirm);
  addListener('confirm-cancel-btn', 'click', confirmCancelSubscription);
  addListener('keep-subscription-btn', 'click', () => hideModal('cancel-subscription-modal'));
  addListener('history-close-btn', 'click', () => hideModal('payment-history-modal'));

  // Avatar upload
  const changeAvatarBtn = document.getElementById('change-avatar-btn');
  const avatarInput = document.getElementById('avatar-input');

  if (changeAvatarBtn && avatarInput) {
    changeAvatarBtn.addEventListener('click', () => {
      avatarInput.click();
    });
    avatarInput.addEventListener('change', handleAvatarUpload);
  }

  // User avatar click to open dropdown
  const userMenu = document.getElementById('user-menu');
  const userInfo = userMenu ? userMenu.querySelector('.user-info') : null;
  const userDropdown = userMenu ? userMenu.querySelector('.user-dropdown') : null;

  if (userMenu && userInfo && userDropdown) {
    userInfo.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!userMenu.contains(e.target)) {
        userDropdown.classList.remove('show');
      }
    });

    // Don't close dropdown when clicking inside it
    userDropdown.addEventListener('click', () => {
      // Let the button handlers work, but don't close dropdown yet
      // It will close after the modal opens
    });
  } else {
    console.warn('User menu not found. Skipping dropdown listeners.');
  }

  // Room expiration modal
  const expiredLoginBtn = document.getElementById('expired-login-btn');
  const expiredCloseBtn = document.getElementById('expired-close-btn');
  const expiredContinueBtn = document.getElementById('expired-cancel-btn');

  if (expiredLoginBtn) {
    expiredLoginBtn.addEventListener('click', () => {
      hideModal('room-expired-modal');
      showScreen('home'); // Go to home first
      showModal('login-modal');
    });
  }

  if (expiredCloseBtn) {
    expiredCloseBtn.addEventListener('click', () => {
      hideModal('room-expired-modal');
      showScreen('home');
    });
  }

  if (expiredContinueBtn) {
    expiredContinueBtn.addEventListener('click', () => {
      hideModal('room-expired-modal');
      showScreen('home');
    });
  }

  // Payment success overlay
  addListener('success-close-btn', 'click', hidePurchaseSuccess);
  addListener('success-start-btn', 'click', () => {
    hidePurchaseSuccess();
    showScreen('home');
  });
  addListener('success-profile-btn', 'click', () => {
    hidePurchaseSuccess();
    showProfile();
  });

  // Password toggle buttons
  const togglePasswordButtons = document.querySelectorAll('.toggle-password');
  togglePasswordButtons.forEach(button => {
    button.addEventListener('click', function () {
      const targetId = this.getAttribute('data-target');
      const passwordInput = document.getElementById(targetId);
      const eyeIcon = this.querySelector('.eye-icon');

      if (passwordInput && eyeIcon) {
        if (passwordInput.type === 'password') {
          passwordInput.type = 'text';
          eyeIcon.textContent = '🙈';
        } else {
          passwordInput.type = 'password';
          eyeIcon.textContent = '👁️';
        }
      }
    });
  });

  // Add input focus animations
  const authInputs = document.querySelectorAll('.auth-input');
  authInputs.forEach(input => {
    input.addEventListener('focus', function () {
      this.parentElement.classList.add('focused');
    });

    input.addEventListener('blur', function () {
      this.parentElement.classList.remove('focused');
      if (!this.value) {
        this.classList.remove('error');
      }
    });

    input.addEventListener('input', function () {
      this.classList.remove('error');
    });
  });
}

// Modal management
function showModal(modalId) {
  console.log('showModal called with:', modalId);
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    console.log('Modal shown:', modalId);
  } else {
    console.error('Modal not found:', modalId);
  }
}

function hideModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
  document.body.style.overflow = 'auto';
  if (modalId === 'room-limit-modal') {
    stopResetCountdown();
  }
}

// Authentication handlers
async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = e.target.querySelector('.auth-submit');
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');

  if (!username || !password) {
    if (!username) usernameInput.classList.add('error');
    if (!password) passwordInput.classList.add('error');
    showError('Please fill in all fields');
    return;
  }

  // Add loading state
  submitBtn.classList.add('loading');
  submitBtn.disabled = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login: username,
        password: password
      })
    });

    const data = await response.json();

    if (data.success) {
      currentUser = data.user;
      window.currentUser = data.user;
      authToken = data.token;
      localStorage.setItem('authToken', data.token);

      hideModal('login-modal');
      updateUserUI(true);

      // Reconnect socket with auth
      isReconnecting = true;
      socket.disconnect();
      setTimeout(() => {
        initializeSocket();
        // Load room history after socket reconnection
        setTimeout(() => {
          loadRoomHistory();
        }, 300);
        isReconnecting = false;
      }, 100);

      showError('Login successful!', false); // Show as success message
    } else {
      passwordInput.classList.add('error');
      showError(data.error || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    passwordInput.classList.add('error');
    showError('Login failed. Please try again.');
  } finally {
    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const username = document.getElementById('register-username').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const submitBtn = e.target.querySelector('.auth-submit');
  const usernameInput = document.getElementById('register-username');
  const emailInput = document.getElementById('register-email');
  const passwordInput = document.getElementById('register-password');

  if (!username || !email || !password) {
    if (!username) usernameInput.classList.add('error');
    if (!email) emailInput.classList.add('error');
    if (!password) passwordInput.classList.add('error');
    showError('Please fill in all fields');
    return;
  }

  if (password.length < 6) {
    passwordInput.classList.add('error');
    showError('Password must be at least 6 characters');
    return;
  }

  // Add loading state
  submitBtn.classList.add('loading');
  submitBtn.disabled = true;
  const confirmPassword = document.getElementById('register-confirm-password').value;

  if (!username || !email || !password || !confirmPassword) {
    showError('Please fill in all fields');
    return;
  }

  if (password !== confirmPassword) {
    showError('Passwords do not match');
    return;
  }

  if (password.length < 6) {
    showError('Password must be at least 6 characters long');
    return;
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: username,
        email: email,
        password: password
      })
    });

    const data = await response.json();

    if (data.success) {
      currentUser = data.user;
      window.currentUser = data.user;
      authToken = data.token;
      localStorage.setItem('authToken', data.token);

      hideModal('register-modal');
      updateUserUI(true);

      // Reconnect socket with auth
      isReconnecting = true;
      socket.disconnect();
      setTimeout(() => {
        initializeSocket();
        // Load room history after socket reconnection
        setTimeout(() => {
          loadRoomHistory();
        }, 300);
        isReconnecting = false;
      }, 100);

      showError('Registration successful!', false); // Show as success message
    } else {
      if (data.error.includes('Email')) emailInput.classList.add('error');
      if (data.error.includes('Username')) usernameInput.classList.add('error');
      showError(data.error || 'Registration failed');
    }
  } catch (error) {
    console.error('Registration error:', error);
    showError('Registration failed. Please try again.');
  } finally {
    submitBtn.classList.remove('loading');
    submitBtn.disabled = false;
  }
}

// Avatar upload handler
async function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file || !authToken) return;

  // Validate file type
  if (!file.type.startsWith('image/')) {
    showError('Please select an image file');
    return;
  }

  // Validate file size (5MB)
  if (file.size > 5 * 1024 * 1024) {
    showError('Image file must be less than 5MB');
    return;
  }

  try {
    const progressContainer = document.getElementById('avatar-upload-progress');
    const progressFill = document.getElementById('avatar-progress-fill');
    const progressText = document.getElementById('avatar-progress-text');

    progressContainer.classList.remove('hidden');
    progressText.textContent = 'Uploading...';
    progressFill.style.width = '0%';

    const formData = new FormData();
    formData.append('avatar', file);

    const response = await fetch('/api/auth/avatar', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      body: formData
    });

    const data = await response.json();

    if (data.success) {
      // Update current user data
      currentUser.avatar = data.avatar;

      // Update UI elements
      updateAvatarDisplay(data.avatar);

      progressText.textContent = 'Upload complete!';
      progressFill.style.width = '100%';

      setTimeout(() => {
        progressContainer.classList.add('hidden');
      }, 2000);

      showError('Avatar updated successfully!', false);
    } else {
      progressContainer.classList.add('hidden');
      showError(data.error || 'Failed to upload avatar');
    }
  } catch (error) {
    console.error('Avatar upload error:', error);
    document.getElementById('avatar-upload-progress').classList.add('hidden');
    showError('Failed to upload avatar. Please try again.');
  }

  // Clear the input
  e.target.value = '';
}

function updateAvatarDisplay(avatarUrl) {
  // Update profile modal avatar
  const profileAvatar = document.getElementById('profile-avatar');
  if (avatarUrl) {
    profileAvatar.style.backgroundImage = `url(${avatarUrl})`;
    profileAvatar.style.backgroundSize = 'cover';
    profileAvatar.style.backgroundPosition = 'center';
    profileAvatar.textContent = '';
  }

  // Update header user avatar
  const userAvatar = document.getElementById('user-avatar');
  if (avatarUrl && userAvatar) {
    userAvatar.style.backgroundImage = `url(${avatarUrl})`;
    userAvatar.style.backgroundSize = 'cover';
    userAvatar.style.backgroundPosition = 'center';
    userAvatar.textContent = '';
  }
}

async function showProfile() {
  if (!currentUser || !authToken) return;

  // Close dropdown menu
  const userDropdown = document.querySelector('.user-dropdown');
  if (userDropdown) {
    userDropdown.classList.remove('show');
  }

  try {
    const response = await fetch('/api/auth/profile', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();

    if (data.success) {
      // Populate profile modal
      document.getElementById('profile-username').textContent = data.user.username;
      document.getElementById('profile-email').textContent = (data.user.email) ? data.user.email : 'Not provided';
      document.getElementById('profile-joined').textContent = new Date(data.user.createdAt).toLocaleDateString();
      document.getElementById('profile-last-login').textContent = new Date(data.user.lastLogin).toLocaleDateString();

      if (data.user.avatar) {
        updateAvatarDisplay(data.user.avatar);
      } else {
        // Reset to default if no avatar
        const profileAvatar = document.getElementById('profile-avatar');
        profileAvatar.style.backgroundImage = '';
        profileAvatar.textContent = '👤';
      }

      // Show premium badge if user has premium subscription
      const premiumSection = document.getElementById('premium-section');
      if (data.user.subscription?.plan === 'premium' && data.user.subscription?.status === 'active') {
        premiumSection.classList.remove('hidden');
        document.getElementById('premium-start').textContent = new Date(data.user.subscription.startDate).toLocaleDateString();
        const endDate = new Date(data.user.subscription.endDate);
        const day = String(endDate.getDate()).padStart(2, '0');
        const month = String(endDate.getMonth() + 1).padStart(2, '0');
        const year = endDate.getFullYear();
        document.getElementById('premium-end').textContent = `${day}/${month}/${year}`;
      } else {
        premiumSection.classList.add('hidden');
      }

      // Show recent rooms (creator, participants, room id)
      const roomsList = document.getElementById('profile-rooms');
      roomsList.innerHTML = '';

      if (data.rooms && data.rooms.length > 0) {
        // Most recent first
        data.rooms.forEach(room => {
          const names = (room.participants || []);
          const previewNames = names.slice(0, 3);
          const moreCount = Math.max(0, names.length - previewNames.length);
          const participantsText = previewNames.join(', ') + (moreCount > 0 ? ` +${moreCount}` : (names.length === 0 ? 'None' : ''));

          const roomItem = document.createElement('div');
          roomItem.className = 'room-item';
          roomItem.innerHTML = `
            <div class="room-info">
              <div class="room-row">
                <span class="room-id" title="Room ID">${room.roomId}</span>
                <span class="room-role badge ${room.role === 'creator' ? 'creator' : 'participant'}">${room.role}</span>
                <span class="room-date">${new Date(room.joinedAt).toLocaleString()}</span>
              </div>
              <div class="room-row small">
                <span class="label">Creator:</span>
                <span class="value">${room.creator && room.creator.username ? room.creator.username : 'Unknown'}</span>
              </div>
              <div class="room-row small">
                <span class="label">Participants:</span>
                <span class="value">${participantsText}</span>
              </div>
            </div>
            <div class="room-actions">
              <button class="btn secondary small" onclick="rejoinRoom('${room.roomId}')">Rejoin</button>
              ${room.role === 'creator' ? `<button class="btn danger small" onclick="deleteRoom('${room.roomId}')">Delete</button>` : ''}
            </div>
          `;
          roomsList.appendChild(roomItem);
        });
      } else {
        roomsList.innerHTML = '<p class="no-rooms">No recent rooms</p>';
      }

      showModal('profile-modal');
    } else {
      showError('Failed to load profile');
    }
  } catch (error) {
    console.error('Profile error:', error);
    showError('Failed to load profile');
  }
}

// Show payment history
async function showPaymentHistory() {
  if (!currentUser || !authToken) return;

  try {
    const response = await fetch('/api/stripe/subscription-status', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      const subscription = data.subscription;

      // Populate current subscription
      document.getElementById('history-plan').textContent = subscription?.plan || 'Free';
      document.getElementById('history-status').textContent = subscription?.status || 'inactive';

      if (subscription?.startDate) {
        document.getElementById('history-started').textContent = new Date(subscription.startDate).toLocaleDateString();
      }

      if (subscription?.endDate) {
        const endDate = new Date(subscription.endDate);
        const day = String(endDate.getDate()).padStart(2, '0');
        const month = String(endDate.getMonth() + 1).padStart(2, '0');
        const year = endDate.getFullYear();
        document.getElementById('history-next-billing').textContent = `${day}/${month}/${year}`;
      }

      // For now, show a single transaction (can be extended with more history)
      const transactionsList = document.getElementById('transactions-list');
      if (subscription?.startDate) {
        transactionsList.innerHTML = `
          <div class="transaction-item">
            <div class="transaction-info">
              <h4>Premium Subscription Charge</h4>
              <p>Monthly subscription activated</p>
            </div>
            <div class="transaction-amount">
              <div class="amount">$9.99</div>
              <div class="date">${new Date(subscription.startDate).toLocaleDateString()}</div>
            </div>
          </div>
        `;
      } else {
        transactionsList.innerHTML = '<div class="no-transactions">No transactions yet</div>';
      }

      showModal('payment-history-modal');
    }
  } catch (error) {
    console.error('Payment history error:', error);
    showError('Failed to load payment history');
  }
}

// Cancel subscription with confirmation
async function showCancelConfirm() {
  if (!currentUser?.subscription?.endDate) return;

  const endDate = new Date(currentUser.subscription.endDate);
  const day = String(endDate.getDate()).padStart(2, '0');
  const month = String(endDate.getMonth() + 1).padStart(2, '0');
  const year = endDate.getFullYear();

  document.getElementById('cancel-until-date').textContent = `${day}/${month}/${year}`;
  showModal('cancel-subscription-modal');
}

// Confirm cancel subscription
async function confirmCancelSubscription() {
  if (!authToken) return;

  try {
    const response = await fetch('/api/stripe/cancel-subscription', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      showNotification('✅ Subscription cancelled. You can use premium features until your renewal date.', 'success');

      // Update user status
      await checkAuthStatus();
      updateUserUI(true);

      hideModal('cancel-subscription-modal');
      hideModal('payment-history-modal');
    } else {
      showNotification(data.error || 'Failed to cancel subscription', 'error');
    }
  } catch (error) {
    console.error('Cancel subscription error:', error);
    showNotification('Failed to cancel subscription. Please try again.', 'error');
  }
}


// Room timer functions
function startRoomTimer(expirationTime) {
  if (!expirationTime) return;

  roomExpirationTime = new Date(expirationTime);
  updateTimerDisplay();

  roomTimer = setInterval(() => {
    updateTimerDisplay();

    const timeLeft = roomExpirationTime - new Date();
    if (timeLeft <= 0) {
      clearRoomTimer();
    }
  }, 1000);
}

function clearRoomTimer() {
  if (roomTimer) {
    clearInterval(roomTimer);
    roomTimer = null;
  }
  roomExpirationTime = null;

  const timerElement = document.getElementById('room-timer');
  if (timerElement) {
    timerElement.style.display = 'none';
  }
}

function updateTimerDisplay() {
  if (!roomExpirationTime) return;

  const timeLeft = roomExpirationTime - new Date();
  if (timeLeft <= 0) return;

  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  let timerElement = document.getElementById('room-timer');
  if (!timerElement) {
    // Create timer element if it doesn't exist
    timerElement = document.createElement('div');
    timerElement.id = 'room-timer';
    timerElement.className = 'room-timer';

    const roomHeader = document.querySelector('.room-header');
    if (roomHeader) {
      roomHeader.appendChild(timerElement);
    }
  }

  timerElement.innerHTML = `
    <span class="timer-icon">⏰</span>
    <span class="timer-text">Room expires in: ${minutes}:${seconds.toString().padStart(2, '0')}</span>
  `;
  timerElement.style.display = 'flex';

  // Add warning style when under 30 seconds
  if (timeLeft < 30000) {
    timerElement.classList.add('warning');
  }
}

// Room timer functions
function startRoomTimer(expirationTime) {
  if (!expirationTime) return;

  roomExpirationTime = new Date(expirationTime);
  updateTimerDisplay();

  roomTimer = setInterval(() => {
    updateTimerDisplay();

    const timeLeft = roomExpirationTime - new Date();
    if (timeLeft <= 0) {
      clearRoomTimer();
    }
  }, 1000);
}

function clearRoomTimer() {
  if (roomTimer) {
    clearInterval(roomTimer);
    roomTimer = null;
  }
  roomExpirationTime = null;

  const timerElement = document.getElementById('room-timer');
  if (timerElement) {
    timerElement.style.display = 'none';
  }
}

function updateTimerDisplay() {
  if (!roomExpirationTime) return;

  const timeLeft = roomExpirationTime - new Date();
  if (timeLeft <= 0) return;

  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  let timerElement = document.getElementById('room-timer');
  if (!timerElement) {
    // Create timer element if it doesn't exist
    timerElement = document.createElement('div');
    timerElement.id = 'room-timer';
    timerElement.className = 'room-timer';

    const roomHeader = document.querySelector('.room-header');
    if (roomHeader) {
      roomHeader.appendChild(timerElement);
    }
  }

  timerElement.innerHTML = `
    <span class="timer-icon">⏰</span>
    <span class="timer-text">Room expires in: ${minutes}:${seconds.toString().padStart(2, '0')}</span>
  `;
  timerElement.style.display = 'flex';

  // Add warning style when under 30 seconds
  if (timeLeft < 30000) {
    timerElement.classList.add('warning');
  }
}

function showRoomExpiredModal(message) {
  // Clean up room timer display
  clearRoomTimer();

  // Show the modal
  const modal = document.getElementById('room-expired-modal');
  if (modal) {
    showModal('room-expired-modal');
  }
}

function showRoomLimitModal(message, remaining, resetTime) {
  let modal = document.getElementById('room-limit-modal');
  if (!modal) {
    // Create modal if it doesn't exist
    createRoomLimitModal();
    // Get the modal again after creation
    modal = document.getElementById('room-limit-modal');
  }

  const messageElement = document.getElementById('limit-message');
  const remainingElement = document.getElementById('remaining-rooms');
  const countdownElement = document.getElementById('reset-countdown');

  if (messageElement) messageElement.textContent = message;
  if (remainingElement) remainingElement.textContent = `Rooms remaining today: ${remaining}`;

  // Start countdown timer if reset time is provided
  if (resetTime) {
    // Calculate and display exact reset time in user's local timezone
    const resetTimeObj = new Date(resetTime.resetTime);
    const exactResetTimeElement = document.getElementById('exact-reset-time');
    if (exactResetTimeElement) {
      // Format time in user's local timezone
      const timeOptions = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      };
      const formattedTime = resetTimeObj.toLocaleTimeString('en-US', timeOptions);

      // Extract just the time part (remove timezone if it's too long)
      const timeParts = formattedTime.split(' ');
      const timeOnly = timeParts[0] + ' ' + timeParts[1]; // "12:00 AM/PM"
      const timezone = timeParts[2] || ''; // timezone abbreviation

      exactResetTimeElement.textContent = `at ${timeOnly}${timezone ? ' (' + timezone + ')' : ''}`;
    }

    // Small delay to ensure DOM elements are ready
    setTimeout(() => {
      const countdownElement = document.getElementById('reset-countdown');
      const countdownTimeElement = document.getElementById('countdown-time');
      console.log('Starting countdown with resetTime:', resetTime);
      console.log('countdownElement:', countdownElement);
      console.log('countdownTimeElement:', countdownTimeElement);

      if (countdownElement && countdownTimeElement) {
        startResetCountdown(resetTime, countdownElement);
      } else {
        console.error('Countdown elements not found after modal creation');
      }
    }, 100);
  } else {
    console.log('No resetTime provided:', resetTime);
  }

  showModal('room-limit-modal');
}

function createRoomLimitModal() {
  const modalHTML = `
    <div id="room-limit-modal" class="modal">
      <div class="modal-content limit-modal">
        <div class="modal-header limit-header">
          <div class="limit-title">
            <span class="limit-icon">⚠️</span>
            <div>
              <p class="limit-subtitle">Daily Room Limit</p>
              <h3>Limit Reached</h3>
            </div>
          </div>
          <button class="close-modal" aria-label="Close" onclick="hideModal('room-limit-modal')">×</button>
        </div>
        <div class="modal-body">
          <p id="limit-message" class="limit-message"></p>
          <div id="remaining-rooms" class="remaining-count"></div>
          <div id="reset-countdown" class="reset-countdown">
            <div class="reset-label">Limit resets in:</div>
            <div class="countdown-display">
              <span id="countdown-time">--:--:--</span>
            </div>
            <div class="reset-time-display">
              <span id="exact-reset-time">at --:-- --</span>
            </div>
          </div>
          <div class="limit-benefits">
            <h4>Login for unlimited access:</h4>
            <ul>
              <li>✅ Unlimited rooms per day</li>
              <li>✅ Rooms never expire</li>
              <li>✅ 500MB file sizes (10GB with Premium 👑)</li>
              <li>✅ Full speed transfers (High-speed with Premium 🚀)</li>
              <li>✅ Room history tracking</li>
              <li>✅ Priority support with Premium</li>
            </ul>
          </div>
          <div class="modal-actions">
            <button onclick="showModal('login-modal'); hideModal('room-limit-modal');" class="btn-primary">
              Login Now
            </button>
            <button onclick="showModal('register-modal'); hideModal('room-limit-modal');" class="btn-secondary">
              Create Account
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// Countdown timer for room limit reset
let resetCountdownInterval = null;

function startResetCountdown(resetTime, countdownElement) {
  console.log('startResetCountdown called with:', resetTime);
  stopResetCountdown(); // Clear any existing countdown

  const updateCountdown = () => {
    const now = new Date().getTime();
    const resetTimeMs = new Date(resetTime.resetTime).getTime();
    const timeLeft = resetTimeMs - now;

    console.log('Countdown update - now:', now, 'resetTimeMs:', resetTimeMs, 'timeLeft:', timeLeft);

    if (timeLeft <= 0) {
      // Time expired
      const countdownTimeElement = document.getElementById('countdown-time');
      if (countdownTimeElement) {
        countdownTimeElement.textContent = 'Resetting...';
        countdownTimeElement.style.color = '#4caf50';
      }
      stopResetCountdown();
      return;
    }

    // Calculate hours, minutes, seconds
    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

    // Update display
    const countdownTimeElement = document.getElementById('countdown-time');
    if (countdownTimeElement) {
      countdownTimeElement.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

      // Change color based on time remaining
      if (timeLeft < 60000) { // Less than 1 minute
        countdownTimeElement.style.color = '#ff4444';
      } else if (timeLeft < 300000) { // Less than 5 minutes
        countdownTimeElement.style.color = '#ff9800';
      } else {
        countdownTimeElement.style.color = '#4285f4';
      }
    }
  };

  // Update immediately
  updateCountdown();

  // Update every second
  resetCountdownInterval = setInterval(updateCountdown, 1000);
}

function stopResetCountdown() {
  if (resetCountdownInterval) {
    clearInterval(resetCountdownInterval);
    resetCountdownInterval = null;
  }
}

// Screen Management
function showScreen(screenName) {
  // Hide all screens
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });

  // Show target screen
  document.getElementById(`${screenName}-screen`).classList.add('active');
  currentScreen = screenName;
  // Default to Send tab when entering room
  if (screenName === 'room') {
    switchRoomTab('send');
  }
}

// Room Management
async function createRoom() {
  showLoading('Creating room...');

  try {
    const response = await new Promise((resolve) => {
      socket.emit('create-room', resolve);
    });

    if (response.error) {
      if (response.limitReached) {
        hideLoading();
        showScreen('home');
        showRoomLimitModal(response.error, response.remaining || 0, response.resetTime);
        return;
      }
      throw new Error(response.error);
    }

    currentRoom = response.roomId;
    document.getElementById('room-code-display').textContent = response.roomId;

    // Start timer for anonymous users
    if (response.isAnonymous && response.expiresAt) {
      startRoomTimer(response.expiresAt);
    }

    // Initialize WebRTC
    webrtc = new WebRTCManager();
    await webrtc.initializePeerConnection(socket, currentRoom);
    // Mark roles: creator is initiator and not polite (wins glare)
    webrtc.isInitiator = true;
    webrtc.polite = false;
    // Process any queued signals (usually none for creator)
    processPendingSignals();

    // Show delete button only for logged-in users (not anonymous)
    const deleteBtn = document.getElementById('delete-room-btn');
    if (deleteBtn) {
      if (response.isAnonymous || !currentUser) {
        deleteBtn.classList.add('hidden');
      } else {
        deleteBtn.classList.remove('hidden');
      }
    }

    showScreen('room');
    updateConnectionStatus(false);

  } catch (error) {
    showError('Failed to create room: ' + error.message);
    showScreen('home');
  }
}

async function joinRoom() {
  const roomCode = document.getElementById('room-code').value.trim().toUpperCase();

  if (!roomCode || roomCode.length !== 8) {
    showError('Please enter a valid 8-character room code');
    return;
  }

  showLoading('Joining room...');

  try {
    // Prepare WebRTC before joining to avoid race with early offer
    webrtc = new WebRTCManager();
    await webrtc.initializePeerConnection(socket, roomCode);
    // Joiner is polite (accepts glare by rolling back)
    webrtc.polite = true;

    const response = await new Promise((resolve) => {
      socket.emit('join-room', { roomId: roomCode }, resolve);
    });

    if (response.error) {
      if (response.limitReached) {
        hideLoading();
        showScreen('join');
        showRoomLimitModal(response.error, response.remaining || 0, response.resetTime);
        return;
      }
      throw new Error(response.error);
    }

    currentRoom = roomCode;
    document.getElementById('room-code-display').textContent = roomCode;

    // Hide delete button for participants (only creator can delete)
    const deleteBtn = document.getElementById('delete-room-btn');
    if (deleteBtn) {
      deleteBtn.classList.add('hidden');
    }

    // Process any offers/candidates received during join
    processPendingSignals();

    showScreen('room');
    updateConnectionStatus(false);

  } catch (error) {
    showError('Failed to join room: ' + error.message);
    showScreen('join');
  }
}

function leaveRoom() {
  // Mark this as intentional disconnect so the disconnect handler knows
  isIntentionalDisconnect = true;

  // Clear room timer
  clearRoomTimer();

  if (webrtc) {
    webrtc.disconnect();
    webrtc = null;
  }

  currentRoom = null;
  selectedFiles = [];
  sentFiles = [];
  clearSelectedFiles();
  clearSentFiles();
  clearReceivedFiles();
  hideTransferProgress();

  socket.disconnect();
  socket.connect();

  showScreen('home');

  // Load room history if user is logged in
  if (currentUser) {
    setTimeout(() => loadRoomHistory(), 100);
  }
}

// File Handling
function handleFileSelection(event) {
  if (!isPeerConnected()) {
    showError('Connection not ready yet. Wait until connected.');
    event.target.value = '';
    return;
  }
  const files = Array.from(event.target.files);
  addSelectedFiles(files);
  event.target.value = ''; // Reset input
}

function handleDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('dragover');
}

function handleDragLeave(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragover');
}

function handleFileDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragover');

  if (!isPeerConnected()) {
    showError('Connection not ready yet. Wait until connected.');
    return;
  }

  const files = Array.from(event.dataTransfer.files);
  addSelectedFiles(files);
}

function addSelectedFiles(files) {
  console.log('addSelectedFiles called with', files.length, 'files');
  // Different limits for anonymous vs logged-in users vs premium users
  const isPremium = currentUser && currentUser.subscription?.plan === 'premium' && currentUser.subscription?.status === 'active';
  const maxFileSize = isPremium ? (10 * 1024 * 1024 * 1024) : currentUser ? (500 * 1024 * 1024) : (30 * 1024 * 1024); // 10GB for premium, 500MB for free, 30MB for anonymous
  const maxFileSizeText = isPremium ? '10GB' : currentUser ? '500MB' : '30MB';
  console.log('User type:', currentUser ? 'logged-in' : 'anonymous', 'Max size:', maxFileSizeText);
  const validFiles = [];

  for (const file of files) {
    console.log('Checking file:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(1), 'MB', 'Limit:', maxFileSizeText);
    if (file.size > maxFileSize) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
      const fileSizeGB = (file.size / (1024 * 1024 * 1024)).toFixed(2);
      const displaySize = file.size > 1024 * 1024 * 1024 ? `${fileSizeGB}GB` : `${fileSizeMB}MB`;

      if (!currentUser) {
        showError(`File "${file.name}" (${displaySize}) is too large. Anonymous users are limited to ${maxFileSizeText}. Login for higher limits.`);
      } else if (!isPremium) {
        showError(`File "${file.name}" (${displaySize}) exceeds ${maxFileSizeText} limit. Upgrade to Premium for 10GB file sizes.`);
      } else {
        showError(`File "${file.name}" is too large. Maximum size is ${maxFileSizeText}.`);
      }
      continue;
    }
    validFiles.push(file);
  }

  if (!isPeerConnected()) {
    showError('Cannot select files until connected.');
    return;
  }

  selectedFiles.push(...validFiles);
  displaySelectedFiles();

  // If a send is currently in progress, show newly added files as Queued in Sent list
  if (webrtc && webrtc.isSending && webrtc.dataChannel && webrtc.dataChannel.readyState === 'open') {
    validFiles.forEach((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      let id = window.outgoingIdByKey.get(key);
      if (!id) {
        id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        window.outgoingIdByKey.set(key, id);
      }
      // Store file reference for retry
      if (!window.outgoingFileRefs) window.outgoingFileRefs = new Map();
      window.outgoingFileRefs.set(id, file);
      try { if (typeof outgoingFileQueued === 'function') outgoingFileQueued({ id, name: file.name, size: file.size }); } catch (_) { }
    });
  }
  // Removed auto-send: user must click "Send selected files"
}

function displaySelectedFiles() {
  const container = document.getElementById('selected-files');
  container.innerHTML = '';

  if (selectedFiles.length === 0) {
    return;
  }

  selectedFiles.forEach((file, index) => {
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';

    const fileIcon = getFileIcon(file.name);

    fileItem.innerHTML = `
            <div class="file-info">
                <span class="file-icon ${fileIcon}"></span>
                <div class="file-details">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <button class="file-remove" onclick="removeSelectedFile(${index})" title="Remove file">×</button>
        `;

    container.appendChild(fileItem);
  });
}

function removeSelectedFile(index) {
  selectedFiles.splice(index, 1);
  displaySelectedFiles();
}

function clearSelectedFiles() {
  selectedFiles = [];
  displaySelectedFiles();
}

async function sendSelectedFiles() {
  if (!webrtc || !webrtc.dataChannel || webrtc.dataChannel.readyState !== 'open') {
    showError('Not connected to peer. Please wait for connection.');
    return;
  }

  if (selectedFiles.length === 0) {
    showError('No files selected to send.');
    return;
  }

  if (webrtc.isSending) {
    // Prevent duplicate concurrent sends (auto-send + manual click)
    return;
  }

  try {
    // Disable send button during active transfer
    const sendBtn = document.getElementById('send-selected-btn');
    if (sendBtn) sendBtn.disabled = true;

    // Take a snapshot of current selection as the batch to send
    const batch = selectedFiles.slice();
    // Clear current selection so files added during transfer are preserved for next batch
    selectedFiles = [];
    displaySelectedFiles();

    // Build stable ids for the batch, creating queued UI entries if absent
    const ids = batch.map((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      let id = window.outgoingIdByKey.get(key);
      if (!id) {
        id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        window.outgoingIdByKey.set(key, id);
        try { outgoingFileQueued({ id, name: file.name, size: file.size }); } catch (_) { }
      }
      // If previous mapping was cancelled, create fresh id & UI entry
      const ctrl = window.outgoingControl.get(id);
      if (ctrl && ctrl.cancelled) {
        id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        window.outgoingIdByKey.set(key, id);
        window.outgoingControl.set(id, { paused: false, cancelled: false });
        try { outgoingFileQueued({ id, name: file.name, size: file.size }); } catch (_) { }
      }
      if (!window.outgoingFileRefs) window.outgoingFileRefs = new Map();
      window.outgoingFileRefs.set(id, file);
      return id;
    });
    const result = await webrtc.sendFiles(batch, ids);
    if (result.started > 0) {
      showSuccess(`Files sent successfully (${result.started})`);
    } else {
      showError('No files were sent (all cancelled before start)');
    }
  } catch (error) {
    showError('Failed to send files: ' + error.message);
  } finally {
    const sendBtn = document.getElementById('send-selected-btn');
    if (sendBtn) sendBtn.disabled = false;
  }
}

// Received Files Management
function displayIncomingFile(fileInfo, id) {
  // Start incoming item with progress in Receive tab
  try {
    const key = id || `${fileInfo.name}:${fileInfo.size}`;
    incomingFileStart({ id: key, name: fileInfo.name, size: fileInfo.size });
  } catch (_) { }
  switchRoomTab('receive');
}

function displayReceivedFile(file) {
  const receivedContainer = document.getElementById('files-list');
  const key = file.id || `${file.name}:${file.size}`;
  const existing = window.incomingItemMap.get(key);
  const fileIcon = getFileIcon(file.name);

  if (existing && existing.el) {
    // Transform the existing incoming item into a completed received item and move it
    const { el } = existing;
    el.className = 'received-file';
    el.innerHTML = `
      <div class="file-info">
        <span class="file-icon ${fileIcon}"></span>
        <div class="file-details">
          <div class="file-name">${file.name}</div>
          <div class="file-size">${formatFileSize(file.size)}</div>
        </div>
      </div>
      <button class="download-btn" onclick="downloadFile('${file.name}')">Download</button>
    `;
    // Move element from Incoming list to Received list
    receivedContainer.appendChild(el);
    window.incomingItemMap.delete(key);
  } else {
    // Fallback: create a new received item
    const fileItem = document.createElement('div');
    fileItem.className = 'received-file';
    fileItem.innerHTML = `
      <div class="file-info">
        <span class="file-icon ${fileIcon}"></span>
        <div class="file-details">
          <div class="file-name">${file.name}</div>
          <div class="file-size">${formatFileSize(file.size)}</div>
        </div>
      </div>
      <button class="download-btn" onclick="downloadFile('${file.name}')">Download</button>
    `;
    receivedContainer.appendChild(fileItem);
  }

  // Store file for download
  if (!window.receivedFiles) {
    window.receivedFiles = new Map();
  }
  window.receivedFiles.set(file.name, file);
}

function downloadFile(fileName) {
  if (!window.receivedFiles || !window.receivedFiles.has(fileName)) {
    showError('File not found');
    return;
  }

  const file = window.receivedFiles.get(fileName);
  const url = URL.createObjectURL(file.blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

function clearReceivedFiles() {
  document.getElementById('files-list').innerHTML = '';
  if (window.receivedFiles) {
    window.receivedFiles.clear();
  }
  if (window.incomingItemMap) window.incomingItemMap.clear();
}

// Sent Files Management
function displaySentFile(file) {
  // Backcompat: create an immediate completed entry
  const id = file.id || `${file.name}-${Date.now()}`;
  outgoingFileStart({ id, name: file.name, size: file.size });
  outgoingFileComplete(id);
}

function clearSentFiles() {
  const container = document.getElementById('sent-files-list');
  if (container) container.innerHTML = '';
}

// Outgoing per-file lifecycle
function outgoingFileCreate({ id, name, size, status = 'queued' }) {
  sentFiles.push({ id, name, size, ts: Date.now() });
  const container = document.getElementById('sent-files-list');
  if (!container) return;
  const fileIcon = getFileIcon(name);
  const when = new Date().toLocaleTimeString();
  const item = document.createElement('div');
  item.className = 'sent-file';
  item.setAttribute('data-id', id);
  const statusClass = status === 'sent' ? 'sent' : status === 'sending' ? 'sending' : '';
  const statusText = status === 'sent' ? 'Sent' : status === 'sending' ? 'Sending…' : 'Queued';

  // Only show transfer controls for logged-in users
  const isLoggedIn = window.currentUser && window.currentUser.username;
  const transferControls = isLoggedIn ? `
        <button class=\"sent-btn pause\" data-action=\"pause\" data-id=\"${id}\" title=\"Pause\">⏸</button>
        <button class=\"sent-btn resume hidden\" data-action=\"resume\" data-id=\"${id}\" title=\"Resume\">▶</button>
        <button class=\"sent-btn cancel\" data-action=\"cancel\" data-id=\"${id}\" title=\"Cancel\">✕</button>` : '';

  // Multi-line layout (no flex):
  item.innerHTML = `
    <div class=\"line file-name\"><span class=\"file-icon ${fileIcon}\"></span> ${name}</div>
    <div class=\"line sent-meta\">${formatFileSize(size)} · ${when}</div>
    <div class=\"line status\"><span class=\"status-label ${statusClass}\">${statusText}</span></div>
    <div class=\"line progress\"><div class=\"sent-progress\"><div class=\"sent-progress-bar\"><div class=\"sent-progress-fill\"></div></div></div></div>
    <div class=\"line actions\"><div class=\"sent-actions\">
        ${transferControls}
        </div></div>
        `;
  // <button class=\"sent-btn retry hidden\" data-action=\"retry\" data-id=\"${id}\" title=\"Retry\">🔄</button>
  container.prepend(item);
  const fill = item.querySelector('.sent-progress-fill');
  const statusEl = item.querySelector('.status-label');
  window.sentItemMap.set(id, { el: item, fill, status: statusEl });
  if (!window.outgoingControl.get(id)) {
    window.outgoingControl.set(id, { paused: false, cancelled: false });
  }
}

function outgoingFileStart({ id, name, size }) {
  if (!window.sentItemMap.get(id)) {
    outgoingFileCreate({ id, name, size, status: 'queued' });
  }
  outgoingFileMarkSending(id);
}

function outgoingFileQueued({ id, name, size }) {
  if (!window.sentItemMap.get(id)) {
    outgoingFileCreate({ id, name, size, status: 'queued' });
  }
}

function outgoingFileMarkSending(id) {
  const ref = window.sentItemMap.get(id);
  if (!ref) return;
  ref.status.textContent = 'Sending…';
  ref.status.classList.remove('sent');
  ref.status.classList.add('sending');
  ref.fill.style.width = '0%';
}

function outgoingFileProgress(id, percent, speed) {
  // Throttle UI updates to reduce layout thrash
  if (!window._sentUpdateTs) window._sentUpdateTs = new Map();
  const now = Date.now();
  const last = window._sentUpdateTs.get(id) || 0;
  if (now - last < 100 && percent < 100) return; // ~10fps during transfer
  window._sentUpdateTs.set(id, now);

  const ref = window.sentItemMap.get(id);
  if (!ref) return;
  ref.fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  let etaText = '';
  if (speed && speed > 0 && window.outgoingFileRefs && window.outgoingFileRefs.get(id)) {
    const file = window.outgoingFileRefs.get(id);
    const remainingBytes = file.size * (1 - percent / 100);
    const etaSeconds = remainingBytes / speed;
    const mins = Math.floor(etaSeconds / 60);
    const secs = Math.max(0, Math.floor(etaSeconds % 60));
    etaText = ` · ETA ${mins}:${secs.toString().padStart(2, '0')}`;
  }
  ref.status.textContent = speed ? `Sending… ${Math.round(percent)}% · ${formatTransferSpeed(speed)}${etaText}` : `Sending… ${Math.round(percent)}%`;
}

function outgoingFileComplete(id) {
  const ref = window.sentItemMap.get(id);
  if (!ref) return;
  ref.fill.style.width = '100%';
  ref.status.textContent = 'Sent';
  ref.status.classList.remove('sending');
  ref.status.classList.add('sent');
  // Hide controls after completion
  const actions = ref.el.querySelector('.sent-actions');
  if (actions) {
    actions.querySelectorAll('.sent-btn').forEach(b => b.classList.add('hidden'));
  }
}

// Pause / Resume / Cancel
function outgoingFilePause(id) {
  // Only allow logged-in users to pause transfers
  if (!window.currentUser || !window.currentUser.username) {
    return;
  }

  const ref = window.sentItemMap.get(id);
  const ctrl = window.outgoingControl.get(id);
  if (!ref || !ctrl || ctrl.cancelled) return;
  ctrl.paused = true;
  ref.status.textContent = 'Paused';
  ref.status.classList.remove('sending');
  ref.status.classList.remove('sent');
  ref.status.classList.add('paused');
  const pauseBtn = ref.el.querySelector('.sent-btn.pause');
  const resumeBtn = ref.el.querySelector('.sent-btn.resume');
  if (pauseBtn) pauseBtn.classList.add('hidden');
  if (resumeBtn) resumeBtn.classList.remove('hidden');
  // Notify peer
  try { if (webrtc && webrtc.dataChannel && webrtc.dataChannel.readyState === 'open') webrtc.dataChannel.send(JSON.stringify({ type: 'file-paused', file: { id } })); } catch (_) { }
}

function outgoingFileResume(id) {
  // Only allow logged-in users to resume transfers
  if (!window.currentUser || !window.currentUser.username) {
    return;
  }

  const ref = window.sentItemMap.get(id);
  const ctrl = window.outgoingControl.get(id);
  if (!ref || !ctrl || ctrl.cancelled) return;
  ctrl.paused = false;
  ref.status.textContent = 'Sending…';
  ref.status.classList.remove('paused');
  ref.status.classList.add('sending');
  const pauseBtn = ref.el.querySelector('.sent-btn.pause');
  const resumeBtn = ref.el.querySelector('.sent-btn.resume');
  if (resumeBtn) resumeBtn.classList.add('hidden');
  if (pauseBtn) pauseBtn.classList.remove('hidden');
  // Notify peer
  try { if (webrtc && webrtc.dataChannel && webrtc.dataChannel.readyState === 'open') webrtc.dataChannel.send(JSON.stringify({ type: 'file-resumed', file: { id } })); } catch (_) { }
}

function outgoingFileCancel(id) {
  // Only allow logged-in users to cancel transfers
  if (!window.currentUser || !window.currentUser.username) {
    return;
  }

  const ref = window.sentItemMap.get(id);
  const ctrl = window.outgoingControl.get(id);
  if (!ref || !ctrl || ctrl.cancelled) return;
  ctrl.cancelled = true;
  ctrl.paused = false;
  ref.status.textContent = 'Cancelled';
  ref.status.classList.remove('sending');
  ref.status.classList.remove('paused');
  ref.status.classList.add('cancelled');
  ref.fill.style.width = '0%';
  const actions = ref.el.querySelector('.sent-actions');
  if (actions) {
    // Hide pause/resume/cancel, show retry
    const pauseBtn = actions.querySelector('.sent-btn.pause');
    const resumeBtn = actions.querySelector('.sent-btn.resume');
    const cancelBtn = actions.querySelector('.sent-btn.cancel');
    const retryBtn = actions.querySelector('.sent-btn.retry');
    if (pauseBtn) pauseBtn.classList.add('hidden');
    if (resumeBtn) resumeBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (retryBtn) retryBtn.classList.remove('hidden');
  }
  // Notify peer only if file actually started transferring
  try {
    if (webrtc && webrtc.startedIds && webrtc.startedIds.has(id) && webrtc.dataChannel && webrtc.dataChannel.readyState === 'open') {
      webrtc.dataChannel.send(JSON.stringify({ type: 'file-cancelled', file: { id } }));
    }
  } catch (_) { }
}

function incomingFileCancelled(id) {
  const ref = window.incomingItemMap.get(id);
  if (!ref) return;
  ref.status.textContent = 'Cancelled';
  ref.status.classList.remove('receiving');
  ref.status.classList.add('cancelled');
  ref.fill.style.width = '0%';
}

// Incoming per-file lifecycle
function incomingFileStart({ id, name, size }) {
  const container = document.getElementById('receiving-files-list');
  if (!container) return;
  const fileIcon = getFileIcon(name);
  const when = new Date().toLocaleTimeString();
  const item = document.createElement('div');
  item.className = 'incoming-file';
  item.setAttribute('data-id', id);
  item.innerHTML = `
    <div class=\"line file-name\"><span class=\"file-icon ${fileIcon}\"></span> ${name}</div>
    <div class=\"line sent-meta\">${formatFileSize(size)} · ${when}</div>
    <div class=\"line status\"><span class=\"status-label receiving\">Receiving…</span></div>
    <div class=\"line progress\"><div class=\"recv-progress\"><div class=\"recv-progress-bar\"><div class=\"recv-progress-fill\"></div></div></div></div>
  `;
  container.prepend(item);
  const fill = item.querySelector('.recv-progress-fill');
  const status = item.querySelector('.status-label');
  window.incomingItemMap.set(id, { el: item, fill, status });
}

function incomingFileProgress(id, percent, speed) {
  // Throttle UI updates to reduce layout thrash
  if (!window._recvUpdateTs) window._recvUpdateTs = new Map();
  const now = Date.now();
  const last = window._recvUpdateTs.get(id) || 0;
  if (now - last < 100 && percent < 100) return; // ~10fps during transfer
  window._recvUpdateTs.set(id, now);

  const ref = window.incomingItemMap.get(id);
  if (!ref) return;
  ref.fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  ref.status.textContent = speed ? `Receiving… ${Math.round(percent)}% · ${formatTransferSpeed(speed)}` : `Receiving… ${Math.round(percent)}%`;
}

function incomingFileComplete(id) {
  const ref = window.incomingItemMap.get(id);
  if (!ref) return;
  ref.fill.style.width = '100%';
  ref.status.textContent = 'Received';
  ref.status.classList.remove('receiving');
  ref.status.classList.add('received');
}

function incomingFilePaused(id) {
  const ref = window.incomingItemMap.get(id);
  if (!ref) return;
  ref.status.textContent = 'Paused by sender';
  ref.status.classList.remove('receiving');
  ref.status.classList.remove('received');
  ref.status.classList.add('paused');
}

function incomingFileResumed(id) {
  const ref = window.incomingItemMap.get(id);
  if (!ref) return;
  ref.status.textContent = 'Receiving…';
  ref.status.classList.remove('paused');
  ref.status.classList.add('receiving');
}

// Bulk operations
function outgoingPauseAll() {
  window.outgoingControl.forEach((v, id) => { if (!v.cancelled && !v.paused) outgoingFilePause(id); });
}
function outgoingResumeAll() {
  window.outgoingControl.forEach((v, id) => { if (!v.cancelled && v.paused) outgoingFileResume(id); });
}
function outgoingCancelAll() {
  window.outgoingControl.forEach((v, id) => {
    // Don't cancel if already cancelled or completed
    if (!v.cancelled) {
      const ref = window.sentItemMap.get(id);
      if (ref && ref.status && ref.status.classList.contains('sent')) {
        // Skip already completed files
        return;
      }
      outgoingFileCancel(id);
    }
  });
}

// Clear cancelled (Sent)
function clearCancelledSent() {
  const toRemove = [];
  window.sentItemMap.forEach((ref, id) => {
    if (!ref || !ref.status) return;
    if (ref.status.classList.contains('cancelled') || ref.status.textContent === 'Cancelled') {
      // Remove DOM element
      if (ref.el && ref.el.parentNode) ref.el.parentNode.removeChild(ref.el);
      toRemove.push(id);
    }
  });
  toRemove.forEach(id => {
    window.sentItemMap.delete(id);
    window.outgoingControl.delete(id);
    if (window.outgoingFileRefs) window.outgoingFileRefs.delete(id);

    // Clear corresponding key mapping to allow files to be sent again
    window.outgoingIdByKey.forEach((mappedId, key) => {
      if (mappedId === id) {
        window.outgoingIdByKey.delete(key);
      }
    });
  });
  if (toRemove.length > 0) showSuccess(`Cleared ${toRemove.length} cancelled sent item(s)`);
}

// Clear cancelled (Incoming)
function clearCancelledIncoming() {
  const toRemove = [];
  window.incomingItemMap.forEach((ref, id) => {
    if (!ref || !ref.status) return;
    if (ref.status.classList.contains('cancelled') || ref.status.textContent === 'Cancelled') {
      if (ref.el && ref.el.parentNode) ref.el.parentNode.removeChild(ref.el);
      toRemove.push(id);
    }
  });
  toRemove.forEach(id => window.incomingItemMap.delete(id));
  if (toRemove.length > 0) showSuccess(`Cleared ${toRemove.length} cancelled incoming item(s)`);
}

function outgoingFileRetry(id) {
  const ctrl = window.outgoingControl.get(id);
  if (!ctrl || !ctrl.cancelled) return; // Only retry cancelled
  const refFile = window.outgoingFileRefs ? window.outgoingFileRefs.get(id) : null;
  if (!refFile) return;
  // Create new id for fresh transfer
  const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.outgoingFileRefs.set(newId, refFile);
  window.outgoingControl.set(newId, { paused: false, cancelled: false });
  outgoingFileQueued({ id: newId, name: refFile.name, size: refFile.size });
  // If currently sending batch, just queue; else start immediately
  if (!webrtc.isSending && webrtc && webrtc.dataChannel && webrtc.dataChannel.readyState === 'open') {
    webrtc.sendFiles([refFile], [newId]);
  }
}

// Transfer Progress
function getProgressElements(mode = 'auto') {
  // mode: 'send' | 'receive' | 'auto'
  if (mode === 'auto') {
    if (window.webrtc && webrtc.currentTransfer && webrtc.currentTransfer.receiving) mode = 'receive';
    else mode = 'send';
  }
  if (mode === 'receive') {
    return {
      section: document.getElementById('receive-transfer-section'),
      fill: document.getElementById('receive-progress-fill'),
      text: document.getElementById('receive-progress-text'),
      speed: document.getElementById('receive-transfer-speed')
    };
  }
  return {
    section: document.getElementById('transfer-section'),
    fill: document.getElementById('progress-fill'),
    text: document.getElementById('progress-text'),
    speed: document.getElementById('transfer-speed')
  };
}

function showTransferProgress(mode = 'auto') {
  const { section } = getProgressElements(mode);
  if (section) section.classList.add('active');
  // Switch to the appropriate tab for clarity
  if (mode === 'receive' || (mode === 'auto' && webrtc && webrtc.currentTransfer && webrtc.currentTransfer.receiving)) {
    switchRoomTab('receive');
  } else {
    switchRoomTab('send');
  }
}

function hideTransferProgress(mode = 'auto') {
  const send = getProgressElements('send');
  const recv = getProgressElements('receive');
  [send, recv].forEach(({ section }) => section && section.classList.remove('active'));
  updateTransferProgress(0, 0, 0, 0, 'send');
  updateTransferProgress(0, 0, 0, 0, 'receive');
}

function updateTransferProgress(percentage, transferred, total, speed = 0, mode = 'auto') {
  const { fill, text, speed: speedEl } = getProgressElements(mode);
  if (!fill || !text || !speedEl) return;
  fill.style.width = Math.min(percentage, 100) + '%';
  text.textContent = Math.round(percentage) + '%';

  if (speed > 0) {
    let speedText = formatTransferSpeed(speed);
    // Add throttling indicator for anonymous users
    if (!currentUser && mode !== 'receive') {
      speedText += ' <span class="speed-indicator throttled">(very limited speed)</span>';
      speedEl.innerHTML = speedText;
    } else {
      speedEl.textContent = speedText;
    }
  } else {
    speedEl.textContent = '';
  }
}

// Connection Status
function updateConnectionStatus(_isConnectedHint) {
  const statusElement = document.getElementById('connection-status');
  const statusText = statusElement.querySelector('.status-text');

  const pcState = (webrtc && webrtc.peerConnection) ? webrtc.peerConnection.connectionState : 'new';
  const dcState = (webrtc && webrtc.dataChannel) ? webrtc.dataChannel.readyState : 'closed';

  if (dcState === 'open') {
    statusElement.classList.add('connected');
    statusText.textContent = 'Connected - Ready to transfer files';
    setFileSelectionEnabled(true);
    return;
  }

  // Data channel not open yet
  statusElement.classList.remove('connected');
  setFileSelectionEnabled(false);
  if (pcState === 'connected') {
    statusText.textContent = 'Peer connected — setting up data channel…';
  } else if (pcState === 'connecting' || pcState === 'checking') {
    statusText.textContent = 'Connecting to peer…';
  } else if (pcState === 'disconnected' || pcState === 'failed') {
    statusText.textContent = 'Disconnected — attempting to reconnect…';
  } else {
    statusText.textContent = 'Waiting for connection...';
  }
}

function isPeerConnected() {
  // Only allow transfers when the data channel is truly open
  return !!(webrtc && webrtc.dataChannel && webrtc.dataChannel.readyState === 'open');
}

// Tabs logic for Send / Receive
function switchRoomTab(tab) {
  const isSend = tab === 'send';
  const sendTab = document.getElementById('tab-send');
  const recvTab = document.getElementById('tab-receive');
  const sendPanel = document.getElementById('panel-send');
  const recvPanel = document.getElementById('panel-receive');
  if (!sendTab || !recvTab || !sendPanel || !recvPanel) return;

  sendTab.classList.toggle('active', isSend);
  recvTab.classList.toggle('active', !isSend);
  sendPanel.classList.toggle('active', isSend);
  recvPanel.classList.toggle('active', !isSend);
}

// Process any queued signaling messages that arrived before webrtc was initialized
function processPendingSignals() {
  if (!webrtc || pendingSignals.length === 0) return;
  const queue = pendingSignals;
  pendingSignals = [];
  queue.forEach(async (msg) => {
    try {
      if (msg.type === 'offer') {
        await webrtc.handleOffer(msg.payload);
      } else if (msg.type === 'answer') {
        await webrtc.handleAnswer(msg.payload);
      } else if (msg.type === 'ice') {
        await webrtc.handleIceCandidate(msg.payload);
      }
    } catch (e) {
      console.error('Failed processing queued signal', msg.type, e);
    }
  });
}

// UI Helpers
function showLoading(message) {
  document.getElementById('loading-text').textContent = message;
  showScreen('loading');
}

function hideLoading() {
  // Loading screen will be hidden when another screen is shown
  // This function exists for clarity and future extensibility
}

function hideLoading() {
  // Loading screen will be hidden when another screen is shown
}

function showError(message, isError = true) {
  if (!isError) {
    showSuccess(message);
    return;
  }

  // For critical errors like connection loss, use modal
  if (message.includes('Connection lost') || message.includes('connection lost')) {
    showErrorModal(message);
  } else {
    // For regular errors, use toast
    showToast(message, 'error', 4000);
  }
}

function hideError() {
  const modal = document.getElementById('error-modal');
  if (modal) {
    hideModal('error-modal');
  }
}

function showErrorModal(message) {
  const errorModal = document.getElementById('error-modal');
  const errorMsg = document.getElementById('error-message');
  if (!errorModal) {
    console.error('Error modal not found');
    alert(message);
    return;
  }
  if (errorMsg) {
    errorMsg.textContent = message;
  }
  // Force visibility
  const forceStyle = {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.6)',
    zIndex: '20000',
    visibility: 'visible',
    opacity: '1',
    pointerEvents: 'auto'
  };
  Object.assign(errorModal.style, forceStyle);
  showModal('error-modal');
}

function showRoomExitedModal() {
  const modal = document.getElementById('room-exited-modal');
  if (!modal) {
    console.error('Room exited modal not found');
    return;
  }

  // Show the modal
  showModal('room-exited-modal');

  // Set up the continue button
  const continueBtn = document.getElementById('room-exited-continue-btn');
  if (continueBtn) {
    continueBtn.onclick = () => {
      hideModal('room-exited-modal');
      showScreen('home');
    };
  }
}

// Toast Notification System
const toastQueue = [];
let toastTimeout = null;

function showToast(message, type = 'success', duration = 3000) {
  console.log(`Toast [${type}]:`, message);

  const container = document.getElementById('toast-container');
  if (!container) {
    console.error('Toast container not found');
    alert(message);
    return;
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Icon mapping
  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || '•'}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" aria-label="Close toast">×</button>
  `;

  // Add to container
  container.appendChild(toast);

  // Close button handler
  const closeBtn = toast.querySelector('.toast-close');
  const removeToast = () => {
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        container.removeChild(toast);
      }
    }, 400); // Match animation duration
  };

  closeBtn.addEventListener('click', removeToast);

  // Auto-remove after duration
  setTimeout(() => {
    if (toast.parentNode) {
      removeToast();
    }
  }, duration);
}

function showSuccess(message) {
  showToast(message, 'success', 3000);
}

function showWarning(message) {
  showToast(message, 'warning', 3500);
}

// Auto-format room code input
document.addEventListener('DOMContentLoaded', () => {
  const roomCodeInput = document.getElementById('room-code');
  if (roomCodeInput) {
    roomCodeInput.addEventListener('input', (e) => {
      let value = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (value.length > 8) {
        value = value.substring(0, 8);
      }
      e.target.value = value;
    });
  }

  // Add cursor-tracking glow effect to room history items
  document.addEventListener('mousemove', (e) => {
    const roomItems = document.querySelectorAll('.room-history-item');
    roomItems.forEach(item => {
      const rect = item.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Set CSS variables for the glow position
      item.style.setProperty('--mouse-x', `${x}px`);
      item.style.setProperty('--mouse-y', `${y}px`);
    });
  });
});

// Room History and Management Functions
async function loadRoomHistory() {
  if (!currentUser) {
    document.getElementById('room-history-section').classList.add('hidden');
    return;
  }

  try {
    const response = await new Promise((resolve) => {
      socket.emit('get-room-history', resolve);
    });

    if (response.success) {
      displayRoomHistory(response.rooms);
      document.getElementById('room-history-section').classList.remove('hidden');
    } else {
      console.error('Failed to load room history:', response.error);
      document.getElementById('room-history-section').classList.add('hidden');
    }
  } catch (error) {
    console.error('Error loading room history:', error);
    document.getElementById('room-history-section').classList.add('hidden');
  }
}

function displayRoomHistory(rooms) {
  const historyList = document.getElementById('room-history-list');

  if (!rooms || rooms.length === 0) {
    historyList.innerHTML = '<p class="no-rooms">📭 No recent rooms found. Create one to get started!</p>';
    return;
  }

  historyList.innerHTML = rooms.map((room, index) => {
    const expiresAt = new Date(room.expiresAt);
    const now = new Date();
    const timeLeft = expiresAt - now;
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    const isCreator = !!(room.isCreator || room.role === 'creator');
    const roleIcon = isCreator ? '👑' : '👤';
    const roleText = isCreator ? 'Creator' : 'Participant';

    console.log('Room history item:', room);
    console.log(`Room ${room.roomId}: role=${room.role}, isCreator=${isCreator}`);

    return `
      <div class="room-history-item ${room.isActive ? 'active' : ''}" style="animation-delay: ${index * 0.08}s;">
        <div class="room-info">
          <div class="room-code">${room.roomId}</div>
          <div class="room-details">
            <span class="room-role ${isCreator ? 'creator' : ''}">${roleIcon} ${roleText}</span>
            <span class="room-participants">👥 ${room.participants} participant(s)</span>
            <span class="room-expires">⏱️ ${hoursLeft}h ${minutesLeft}m</span>
          </div>
        </div>
        <div class="room-actions">
          ${room.isActive ?
        '<span class="active-indicator">🟢 Active</span>' :
        `<button onclick="rejoinRoom('${room.roomId}')" class="btn secondary small">↩️ Rejoin</button>`
      }
          ${isCreator ? `<button onclick="deleteRoomDirect('${room.roomId}')" class="btn danger small" title="Delete this room" style="margin-left: 8px;">🗑️ Delete</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Add cursor tracking for room history items
  setTimeout(() => {
    const historyItems = document.querySelectorAll('.room-history-item');
    historyItems.forEach(item => {
      item.addEventListener('mousemove', (e) => {
        const rect = item.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Calculate angle based on cursor position
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const angle = Math.atan2(y - centerY, x - centerX) * (180 / Math.PI) + 90;

        // Set CSS custom properties
        item.style.setProperty('--mouse-x', `${x}px`);
        item.style.setProperty('--mouse-y', `${y}px`);
        item.style.setProperty('--angle', `${angle}deg`);
      });

      item.addEventListener('mouseleave', () => {
        item.style.setProperty('--mouse-x', '50%');
        item.style.setProperty('--mouse-y', '50%');
      });
    });
  }, 100);
}

async function rejoinRoom(roomId) {
  showLoading('Rejoining room...');

  try {
    // Prepare WebRTC before joining
    webrtc = new WebRTCManager();
    await webrtc.initializePeerConnection(socket, roomId);

    const response = await new Promise((resolve) => {
      socket.emit('rejoin-room', { roomId }, resolve);
    });

    if (response.error) {
      throw new Error(response.error);
    }

    // Set WebRTC role based on response
    if (response.isCreator) {
      webrtc.isInitiator = true;
      webrtc.polite = false;
      console.log('Rejoined as creator (initiator)');
    } else {
      webrtc.isInitiator = false;
      webrtc.polite = true;
      console.log('Rejoined as participant (polite)');
    }

    currentRoom = roomId;
    document.getElementById('room-code-display').textContent = roomId;

    // Show delete button if user is creator
    const deleteBtn = document.getElementById('delete-room-btn');
    if (response.isCreator) {
      deleteBtn.classList.remove('hidden');
    } else {
      deleteBtn.classList.add('hidden');
    }

    console.log(`Rejoined room ${roomId}: ${response.participantCount} participants, firstRejoiner: ${response.isFirstRejoiner}`);

    // If not the first rejoiner and we're the creator, start WebRTC offer
    if (!response.isFirstRejoiner && response.isCreator) {
      console.log('Creator rejoining with existing participants, will initiate WebRTC');
      setTimeout(() => {
        if (webrtc) {
          webrtc.createOffer();
        }
      }, 1000); // Give time for other participants to be ready
    }

    // Process any offers/candidates received during rejoin
    processPendingSignals();

    showScreen('room');
    updateConnectionStatus(false);
    hideLoading();

  } catch (error) {
    showError('Failed to rejoin room: ' + error.message);
    showScreen('home');
    hideLoading();
  }
}

async function deleteRoom(roomId) {
  console.log('deleteRoom called with roomId:', roomId);

  if (!confirm('Are you sure you want to delete this room? This action cannot be undone.')) {
    console.log('Delete confirmation cancelled');
    return;
  }

  console.log('Sending delete-room request...');
  try {
    const response = await new Promise((resolve) => {
      socket.emit('delete-room', { roomId }, resolve);
    });

    console.log('Delete room response:', response);
    if (response.success) {
      showSuccess('Room deleted successfully');
      loadRoomHistory(); // Refresh room history

      // If we're currently in the deleted room, go back to home
      if (currentRoom === roomId) {
        leaveRoom();
      }
    } else {
      throw new Error(response.error);
    }
  } catch (error) {
    console.error('Delete room error:', error);
    showError('Failed to delete room: ' + error.message);
  }
}

// Delete room directly from history without rejoining
async function deleteRoomDirect(roomId) {
  // Show confirmation toast with better UX
  if (!confirm('🗑️ Delete this room permanently? This cannot be undone.')) {
    return;
  }

  try {
    const response = await new Promise((resolve) => {
      socket.emit('delete-room', { roomId }, resolve);
    });

    if (response.success) {
      showToast('✅ Room deleted successfully', 'success', 3000);
      loadRoomHistory(); // Refresh room history to remove deleted room
    } else {
      showToast('❌ Failed to delete room: ' + response.error, 'error', 4000);
    }
  } catch (error) {
    console.error('Delete room error:', error);
    showToast('❌ Error deleting room: ' + error.message, 'error', 4000);
  }
}

// Expose functions used by inline onclick handlers in room history
// Ensures availability even if bundlers or scopes change
window.deleteRoom = deleteRoom;
window.rejoinRoom = rejoinRoom;