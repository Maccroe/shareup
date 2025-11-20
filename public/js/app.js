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
    if (fileLimitInfo) {
      fileLimitInfo.textContent = 'Logged in: Unlimited file sizes • Full speed transfers • 24-hour room persistence';
      fileLimitInfo.classList.add('logged-in');
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

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthStatus();
  initializeSocket();
  setupEventListeners();
  setupAuthEventListeners();
  showScreen('home');
  // Disable file selection until peer connection established
  setFileSelectionEnabled(false);
});

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
    // Only show error if it's not an intentional reconnection
    if (!isReconnecting) {
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
  // Home screen buttons
  document.getElementById('create-room-btn').addEventListener('click', createRoom);
  document.getElementById('join-room-btn').addEventListener('click', () => showScreen('join'));

  // Join screen
  document.getElementById('join-submit-btn').addEventListener('click', joinRoom);
  document.getElementById('back-from-join-btn').addEventListener('click', () => showScreen('home'));
  document.getElementById('room-code').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoom();
  });

  // Room screen
  document.getElementById('leave-room-btn').addEventListener('click', leaveRoom);
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

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelection);

  // Drag and drop
  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleFileDrop);

  // Error modal
  document.getElementById('error-ok-btn').addEventListener('click', hideError);

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
  // Login/Register button listeners
  document.getElementById('login-btn').addEventListener('click', () => showModal('login-modal'));
  document.getElementById('register-btn').addEventListener('click', () => showModal('register-modal'));

  // Modal close buttons
  document.getElementById('login-close-btn').addEventListener('click', () => hideModal('login-modal'));
  document.getElementById('register-close-btn').addEventListener('click', () => hideModal('register-modal'));
  document.getElementById('profile-close-btn').addEventListener('click', () => hideModal('profile-modal'));

  // Switch between login and register
  document.getElementById('show-register-btn').addEventListener('click', () => {
    hideModal('login-modal');
    showModal('register-modal');
  });
  document.getElementById('show-login-btn').addEventListener('click', () => {
    hideModal('register-modal');
    showModal('login-modal');
  });

  // Form submissions
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);

  // User menu actions
  document.getElementById('user-profile-btn').addEventListener('click', showProfile);
  document.getElementById('user-logout-btn').addEventListener('click', logout);

  // Avatar upload
  document.getElementById('change-avatar-btn').addEventListener('click', () => {
    document.getElementById('avatar-input').click();
  });
  document.getElementById('avatar-input').addEventListener('change', handleAvatarUpload);

  // User avatar click to open dropdown
  const userMenu = document.getElementById('user-menu');
  userMenu.addEventListener('click', () => {
    userMenu.querySelector('.user-dropdown').classList.toggle('show');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!userMenu.contains(e.target)) {
      userMenu.querySelector('.user-dropdown').classList.remove('show');
    }
  });

  // Room expiration modal
  document.getElementById('expired-login-btn').addEventListener('click', () => {
    hideModal('room-expired-modal');
    showScreen('home'); // Go to home first
    showModal('login-modal');
  });
  document.getElementById('expired-close-btn').addEventListener('click', () => {
    hideModal('room-expired-modal');
    showScreen('home');
  });
}

// Modal management
function showModal(modalId) {
  document.getElementById(modalId).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hideModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
  document.body.style.overflow = 'auto';
}

// Authentication handlers
async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    showError('Please fill in all fields');
    return;
  }

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
        isReconnecting = false;
      }, 100);

      showError('Login successful!', false); // Show as success message
    } else {
      showError(data.error || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    showError('Login failed. Please try again.');
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const username = document.getElementById('register-username').value.trim();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
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
        isReconnecting = false;
      }, 100);

      showError('Registration successful!', false); // Show as success message
    } else {
      showError(data.error || 'Registration failed');
    }
  } catch (error) {
    console.error('Registration error:', error);
    showError('Registration failed. Please try again.');
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

  // Auto-hide after 10 seconds (longer to see countdown)
  setTimeout(() => {
    stopResetCountdown();
    hideModal('room-limit-modal');
  }, 10000);
}

function createRoomLimitModal() {
  const modalHTML = `
    <div id="room-limit-modal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Daily Room Limit Reached</h3>
          <span class="close" onclick="hideModal('room-limit-modal')">&times;</span>
        </div>
        <div class="modal-body">
          <div class="limit-icon">⚠️</div>
          <p id="limit-message" class="limit-message"></p>
          <p id="remaining-rooms" class="remaining-count"></p>
          <div id="reset-countdown" class="reset-countdown">
            <h4>Limit resets in:</h4>
            <div class="countdown-display">
              <span id="countdown-time">--:--:--</span>
            </div>
          </div>
          <div class="limit-benefits">
            <h4>Login for unlimited access:</h4>
            <ul>
              <li>✅ Unlimited rooms per day</li>
              <li>✅ Rooms never expire</li>
              <li>✅ Unlimited file sizes (500MB)</li>
              <li>✅ Full speed transfers</li>
              <li>✅ Room history tracking</li>
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
  if (!isPeerConnected()) {
    showError('Cannot select files until connected.');
    return;
  }

  // Different limits for anonymous vs logged-in users
  const maxFileSize = currentUser ? (500 * 1024 * 1024) : (30 * 1024 * 1024); // 500MB for logged-in, 30MB for anonymous
  const maxFileSizeText = currentUser ? '500MB' : '30MB';
  const validFiles = [];

  for (const file of files) {
    if (file.size > maxFileSize) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
      if (!currentUser) {
        showError(`File "${file.name}" (${fileSizeMB}MB) is too large. Anonymous users are limited to ${maxFileSizeText}. Login for unlimited file sizes.`);
      } else {
        showError(`File "${file.name}" is too large. Maximum size is ${maxFileSizeText}.`);
      }
      continue;
    }
    validFiles.push(file);
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
  ref.status.textContent = speed ? `Sending… ${Math.round(percent)}% · ${formatTransferSpeed(speed)}` : `Sending… ${Math.round(percent)}%`;
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
  document.getElementById('error-message').textContent = message;
  document.getElementById('error-modal').classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-modal').classList.add('hidden');
}

function showSuccess(message) {
  // Simple success notification - you can enhance this
  console.log('Success:', message);

  // Create temporary success message
  const successDiv = document.createElement('div');
  successDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #d4edda;
        color: #155724;
        padding: 12px 24px;
        border-radius: 8px;
        border: 1px solid #c3e6cb;
        z-index: 1001;
        font-weight: 500;
    `;
  successDiv.textContent = message;

  document.body.appendChild(successDiv);

  setTimeout(() => {
    document.body.removeChild(successDiv);
  }, 3000);
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
    historyList.innerHTML = '<p class="no-rooms">No recent rooms found.</p>';
    return;
  }

  historyList.innerHTML = rooms.map(room => {
    const expiresAt = new Date(room.expiresAt);
    const now = new Date();
    const timeLeft = expiresAt - now;
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    return `
      <div class="room-history-item ${room.isActive ? 'active' : ''}">
        <div class="room-info">
          <div class="room-code">${room.roomId}</div>
          <div class="room-details">
            <span class="room-role">${room.role === 'creator' ? '👤 Creator' : '👥 Participant'}</span>
            <span class="room-participants">${room.participants} participant(s)</span>
            <span class="room-expires">Expires in ${hoursLeft}h ${minutesLeft}m</span>
          </div>
        </div>
        <div class="room-actions">
          ${room.isActive ?
        '<span class="active-indicator">Currently in room</span>' :
        `<button onclick="rejoinRoom('${room.roomId}')" class="btn secondary small">Rejoin</button>`
      }
          ${room.role === 'creator' ?
        `<button onclick="deleteRoom('${room.roomId}')" class="btn danger small" title="Delete Room" style="margin-left: 8px;">🗑️</button>` :
        ''
      }
        </div>
      </div>
    `;
  }).join('');
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

// Expose functions used by inline onclick handlers in room history
// Ensures availability even if bundlers or scopes change
window.deleteRoom = deleteRoom;
window.rejoinRoom = rejoinRoom;