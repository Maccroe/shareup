const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
require('dotenv').config();

// Logging configuration
const LOG_LEVEL = process.env.LOG_LEVEL || 'minimal'; // 'minimal', 'normal', 'verbose'

const logger = {
  info: (message) => {
    if (LOG_LEVEL !== 'minimal') {
      console.log(message);
    }
  },
  warn: (message) => {
    console.log(message); // Always show warnings
  },
  error: (message) => {
    console.error(message); // Always show errors
  },
  verbose: (message) => {
    if (LOG_LEVEL === 'verbose') {
      console.log(message);
    }
  },
  essential: (message) => {
    console.log(message); // Always show essential info
  }
};

// Import authentication middleware
const { socketAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const User = require('./models/User');
const AnonymousLimit = require('./models/AnonymousLimit');
const Room = require('./models/Room');
const discordLogger = require('./utils/discord');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Session middleware for admin authentication
app.use(session({
  secret: process.env.ADMIN_SESSION_SECRET || 'shareup-admin-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Admin authentication middleware
const requireAdminAuth = (req, res, next) => {
  if (req.session.isAdminAuthenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Admin authentication required' });
};

// Authentication routes
app.use('/api/auth', authRoutes);

// Admin authentication routes
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (password === adminPassword) {
    req.session.isAdminAuthenticated = true;
    res.json({ success: true, message: 'Admin authenticated successfully' });
  } else {
    res.status(401).json({ success: false, error: 'Invalid admin password' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

app.get('/api/admin/status', (req, res) => {
  res.json({
    authenticated: !!req.session.isAdminAuthenticated,
    message: req.session.isAdminAuthenticated ? 'Authenticated' : 'Not authenticated'
  });
});

// Remove blocked device endpoint
app.delete('/api/admin/blocked/:fingerprint', requireAdminAuth, async (req, res) => {
  try {
    const { fingerprint } = req.params;

    if (!fingerprint) {
      return res.status(400).json({
        success: false,
        error: 'Fingerprint is required'
      });
    }

    const deletedDevice = await AnonymousLimit.findOneAndDelete({ fingerprint });

    if (deletedDevice) {
      logger.info(`🔓 Admin removed rate limit for device: ${fingerprint} (${deletedDevice.deviceInfo?.os}/${deletedDevice.deviceInfo?.browser})`);

      // Send Discord notification for device unblock
      await discordLogger.logDeviceUnblocked(
        fingerprint,
        deletedDevice.deviceInfo?.deviceName || 'Unknown Device',
        deletedDevice.deviceInfo?.os || 'Unknown',
        deletedDevice.deviceInfo?.browser || 'Unknown',
        deletedDevice.type || 'device' // Pass the tracking type
      );

      res.json({
        success: true,
        message: 'Device unblocked successfully',
        device: {
          fingerprint: deletedDevice.fingerprint,
          count: deletedDevice.count,
          ips: deletedDevice.ips,
          metadata: deletedDevice.metadata
        }
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Device not found or already unblocked'
      });
    }
  } catch (error) {
    console.error('Error removing blocked device:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove blocked device',
      message: error.message
    });
  }
});// Admin endpoint to view blocked/rate-limited devices and IPs
app.get('/api/admin/blocked', requireAdminAuth, async (req, res) => {
  try {
    const today = new Date().toDateString(); // Use same format as database

    // Get all entries for today (not just blocked ones)
    const allDevices = await AnonymousLimit.find({
      date: today
    }).sort({ count: -1, updatedAt: -1 });

    // Separate blocked vs active devices
    const blockedDevices = allDevices.filter(device => device.count >= DAILY_ROOM_LIMIT);
    const activeDevices = allDevices.filter(device => device.count < DAILY_ROOM_LIMIT);

    // Calculate statistics
    const uniqueIPs = new Set();
    let totalRoomAttempts = 0;

    allDevices.forEach(device => {
      device.ips.forEach(ip => uniqueIPs.add(ip));
      totalRoomAttempts += device.count;
    });

    // Format all devices data
    const formatDevice = (entry) => ({
      fingerprint: entry.fingerprint,
      count: entry.count,
      limit: DAILY_ROOM_LIMIT,
      date: entry.date,
      ips: entry.ips || [],
      isBlocked: entry.count >= DAILY_ROOM_LIMIT,
      metadata: {
        network: entry.metadata?.network || 'Unknown',
        device: entry.metadata?.device || 'Unknown',
        os: entry.metadata?.os || 'Unknown',
        browser: entry.metadata?.browser || 'Unknown',
        language: entry.metadata?.language || 'Unknown',
        userAgent: entry.metadata?.userAgent || 'Unknown',
        relatedFingerprints: entry.metadata?.relatedFingerprints || []
      }
    });

    res.json({
      success: true,
      totalBlocked: blockedDevices.length,
      totalActive: activeDevices.length,
      totalDevices: allDevices.length,
      totalUniqueIPs: uniqueIPs.size,
      totalRoomAttempts: totalRoomAttempts,
      blockedDevices: [...blockedDevices.map(formatDevice), ...activeDevices.map(formatDevice)]
    });
  } catch (error) {
    console.error('Error fetching blocked devices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch blocked devices',
      message: error.message
    });
  }
});

// New enhanced admin endpoint for device and network tracking
app.get('/api/admin/devices', requireAdminAuth, async (req, res) => {
  try {
    const today = new Date().toDateString();

    // Get all device and network entries for today
    const allEntries = await AnonymousLimit.find({
      date: today
    }).sort({ 'deviceInfo.lastSeen': -1, count: -1 });

    // Separate device and network entries
    const deviceEntries = allEntries.filter(entry => entry.type === 'device');
    const networkEntries = allEntries.filter(entry => entry.type === 'network');

    // Calculate statistics
    const uniqueDevices = deviceEntries.length;
    const uniqueNetworks = networkEntries.length;
    const blockedDevices = deviceEntries.filter(entry => entry.count >= DAILY_ROOM_LIMIT);
    const blockedNetworks = networkEntries.filter(entry => entry.count >= DAILY_ROOM_LIMIT);

    let totalRoomAttempts = 0;
    const uniqueIPs = new Set();

    allEntries.forEach(entry => {
      totalRoomAttempts += entry.count;
      entry.ips.forEach(ip => uniqueIPs.add(ip));
    });

    // Format device data for admin dashboard
    const formatDeviceEntry = (entry) => ({
      id: entry._id,
      fingerprint: entry.fingerprint,
      type: entry.type,
      count: entry.count,
      limit: DAILY_ROOM_LIMIT,
      isBlocked: entry.count >= DAILY_ROOM_LIMIT,
      deviceInfo: {
        deviceName: entry.deviceInfo?.deviceName || 'Unknown Device',
        os: entry.deviceInfo?.os || 'Unknown',
        osVersion: entry.deviceInfo?.osVersion || 'Unknown',
        browser: entry.deviceInfo?.browser || 'Unknown',
        browserVersion: entry.deviceInfo?.browserVersion || 'Unknown',
        networkIp: entry.deviceInfo?.networkIp || 'Unknown',
        language: entry.deviceInfo?.language || 'Unknown',
        lastSeen: entry.deviceInfo?.lastSeen || entry.updatedAt
      },
      ips: entry.ips || [],
      relatedIds: entry.relatedIds || {},
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt
    });

    res.json({
      success: true,
      summary: {
        totalDevices: uniqueDevices,
        totalNetworks: uniqueNetworks,
        blockedDevices: blockedDevices.length,
        blockedNetworks: blockedNetworks.length,
        totalUniqueIPs: uniqueIPs.size,
        totalRoomAttempts: totalRoomAttempts,
        lastUpdate: new Date().toISOString()
      },
      devices: deviceEntries.map(formatDeviceEntry),
      networks: networkEntries.map(formatDeviceEntry)
    });
  } catch (error) {
    console.error('Error fetching device data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch device data',
      message: error.message
    });
  }
});

// MongoDB Connection with retry logic
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/shareup', {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    logger.essential('Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    return false;
  }
};

// Handle MongoDB disconnection
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection error:', error);
});

mongoose.connection.on('reconnected', () => {
  logger.essential('MongoDB reconnected');
});

connectDB().then(async (connected) => {
  if (connected) {
    // Clean up old anonymous limit entries on startup (entries from previous days only)
    try {
      const today = new Date().toDateString();
      const deletedCount = await AnonymousLimit.deleteMany({
        date: { $ne: today } // Delete entries that are NOT from today
      });
      if (deletedCount.deletedCount > 0) {
        logger.verbose(`Cleaned up ${deletedCount.deletedCount} old anonymous limit entries`);
      }
    } catch (error) {
      console.error('Error cleaning up old limit entries:', error);
    }

    // Initial cleanup of expired rooms on startup
    try {
      await Room.cleanExpiredRooms();
    } catch (error) {
      console.error('Error cleaning up expired rooms on startup:', error);
    }
  } else {
    console.error('Failed to connect to MongoDB. Some features may not work properly.');
  }
})
  .catch(err => console.error('MongoDB connection setup error:', err));

// Store active rooms
const rooms = new Map();

// Helper function to check MongoDB connection
const isDBConnected = () => {
  return mongoose.connection.readyState === 1;
};

// Helper function to safely perform database operations
const safeDBOperation = async (operation, fallback = null) => {
  if (!isDBConnected()) {
    console.warn('Database not connected, skipping operation');
    return fallback;
  }

  try {
    return await operation();
  } catch (error) {
    console.error('Database operation error:', error);
    return fallback;
  }
};

// Periodic cleanup of expired rooms (backup to MongoDB TTL)
setInterval(async () => {
  try {
    await Room.cleanExpiredRooms();

    // Also clean expired rooms from memory
    const now = new Date();
    const expiredRooms = [];

    rooms.forEach((room, roomId) => {
      if (room.expiresAt && room.expiresAt < now) {
        expiredRooms.push(roomId);
      }
    });

    expiredRooms.forEach(roomId => {
      rooms.delete(roomId);
      logger.verbose(`Cleaned expired room ${roomId} from memory`);
    });

    if (expiredRooms.length > 0) {
      logger.verbose(`Cleaned ${expiredRooms.length} expired rooms from memory during periodic cleanup`);
    }
  } catch (error) {
    console.error('Error during periodic room cleanup:', error);
  }
}, 5 * 60 * 1000); // Run every 5 minutes

const DAILY_ROOM_LIMIT = 5;

// Enhanced user fingerprinting with device ID and network IP tracking
function generateUserFingerprint(socket) {
  // Get real client IP with better detection
  let ip = socket.handshake.headers['x-forwarded-for'] ||
    socket.handshake.headers['x-real-ip'] ||
    socket.handshake.address ||
    socket.conn.remoteAddress ||
    'unknown';

  // Handle comma-separated IPs from proxies (take first one)
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }

  // Remove IPv6 prefix if present
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // For local development, use a unique identifier instead of just 'localhost'
  // This helps distinguish between different devices connecting locally
  if (ip === '::1' || ip === '127.0.0.1') {
    // Use User-Agent hash as unique identifier for local connections
    const userAgent = socket.handshake.headers['user-agent'] || 'unknown';
    const crypto = require('crypto');
    ip = 'local-' + crypto.createHash('md5').update(userAgent).digest('hex').substring(0, 8);
  }

  const userAgent = socket.handshake.headers['user-agent'] || 'unknown';
  const acceptLanguage = socket.handshake.headers['accept-language'] || 'unknown';
  const acceptEncoding = socket.handshake.headers['accept-encoding'] || 'unknown';
  const referer = socket.handshake.headers['referer'] || 'unknown';
  const origin = socket.handshake.headers['origin'] || 'unknown';

  // Extract detailed device information from User-Agent
  const uaLower = userAgent.toLowerCase();

  // Extract device name and OS version
  let deviceName = 'Unknown Device';
  let os = 'unknown';
  let osVersion = 'unknown';
  let browserVersion = 'unknown';

  // iPhone detection with model
  if (uaLower.includes('iphone')) {
    os = 'iOS';
    const iosMatch = userAgent.match(/OS\s([\d_]+)/);
    osVersion = iosMatch ? iosMatch[1].replace(/_/g, '.') : 'unknown';
    deviceName = 'iPhone';
    // Try to get iPhone model
    if (uaLower.includes('iphone14')) deviceName = 'iPhone 14';
    else if (uaLower.includes('iphone13')) deviceName = 'iPhone 13';
    else if (uaLower.includes('iphone12')) deviceName = 'iPhone 12';
    else if (uaLower.includes('iphonese')) deviceName = 'iPhone SE';
  }
  // iPad detection
  else if (uaLower.includes('ipad')) {
    os = 'iPadOS';
    const iosMatch = userAgent.match(/OS\s([\d_]+)/);
    osVersion = iosMatch ? iosMatch[1].replace(/_/g, '.') : 'unknown';
    deviceName = 'iPad';
  }
  // Android detection with device model
  else if (uaLower.includes('android')) {
    os = 'Android';
    const androidMatch = userAgent.match(/Android\s([\d\.]+)/);
    osVersion = androidMatch ? androidMatch[1] : 'unknown';

    // Extract device model
    const deviceMatch = userAgent.match(/\(([^;]+);\s*([^)]+)\)/);
    if (deviceMatch && deviceMatch[2]) {
      deviceName = deviceMatch[2].trim();
    } else {
      deviceName = 'Android Device';
    }

    // Common Android device patterns
    if (uaLower.includes('samsung')) deviceName = deviceName.includes('Samsung') ? deviceName : 'Samsung ' + deviceName;
    else if (uaLower.includes('pixel')) deviceName = 'Google Pixel';
    else if (uaLower.includes('oneplus')) deviceName = 'OnePlus Device';
  }
  // Windows detection
  else if (uaLower.includes('windows')) {
    os = 'Windows';
    const winMatch = userAgent.match(/Windows NT\s([\d\.]+)/);
    osVersion = winMatch ? winMatch[1] : 'unknown';
    deviceName = 'Windows PC';
  }
  // Mac detection
  else if (uaLower.includes('mac') && !uaLower.includes('iphone') && !uaLower.includes('ipad')) {
    os = 'macOS';
    const macMatch = userAgent.match(/Mac OS X\s([\d_]+)/);
    osVersion = macMatch ? macMatch[1].replace(/_/g, '.') : 'unknown';
    deviceName = 'Mac';
  }
  // Linux detection
  else if (uaLower.includes('linux')) {
    os = 'Linux';
    deviceName = 'Linux PC';
  }

  // Extract browser info
  let browser = 'unknown';
  if (uaLower.includes('chrome')) {
    browser = 'Chrome';
    const chromeMatch = userAgent.match(/Chrome\/([\d\.]+)/);
    browserVersion = chromeMatch ? chromeMatch[1] : 'unknown';
  } else if (uaLower.includes('firefox')) {
    browser = 'Firefox';
    const firefoxMatch = userAgent.match(/Firefox\/([\d\.]+)/);
    browserVersion = firefoxMatch ? firefoxMatch[1] : 'unknown';
  } else if (uaLower.includes('safari')) {
    browser = 'Safari';
    const safariMatch = userAgent.match(/Version\/([\d\.]+)/);
    browserVersion = safariMatch ? safariMatch[1] : 'unknown';
  } else if (uaLower.includes('edge')) {
    browser = 'Edge';
    const edgeMatch = userAgent.match(/Edge\/([\d\.]+)/);
    browserVersion = edgeMatch ? edgeMatch[1] : 'unknown';
  }

  // Create device-specific fingerprints
  const crypto = require('crypto');

  // Device ID - unique identifier for this device (IMEI substitute)
  // Uses hardware/software characteristics that don't change with network
  const deviceId = crypto.createHash('sha256')
    .update(os + deviceName + userAgent + acceptLanguage + acceptEncoding)
    .digest('hex').substring(0, 16);

  // Network fingerprint - changes with network/location
  const networkFingerprint = crypto.createHash('sha256')
    .update(ip + origin + referer)
    .digest('hex').substring(0, 12);

  // Debug logging to help identify issues
  // console.log('🔍 Device Fingerprinting Debug:', {
  //   deviceName: deviceName,
  //   os: `${os} ${osVersion}`,
  //   browser: `${browser} ${browserVersion}`,
  //   networkIp: ip,
  //   deviceId: deviceId,
  //   networkFingerprint: networkFingerprint,
  //   userAgent: userAgent.substring(0, 80) + '...'
  // });

  return {
    deviceId: deviceId,
    networkFingerprint: networkFingerprint,
    deviceInfo: {
      deviceId: deviceId,
      deviceName: deviceName,
      networkIp: ip,
      os: os,
      osVersion: osVersion,
      browser: browser,
      browserVersion: browserVersion,
      language: acceptLanguage,
      userAgent: userAgent,
      lastSeen: new Date()
    },
    ip: ip,
    userAgent: userAgent,
    language: acceptLanguage
  };
}

// Get time until daily limit reset (midnight)
function getTimeUntilReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const msUntilReset = tomorrow.getTime() - now.getTime();

  return {
    milliseconds: msUntilReset,
    resetTime: tomorrow.toISOString(),
    hours: Math.floor(msUntilReset / (1000 * 60 * 60)),
    minutes: Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((msUntilReset % (1000 * 60)) / 1000)
  };
}

// Check if anonymous user can create/join room with enhanced bypass protection
// Check if anonymous user can create/join room with device ID and network IP tracking
async function checkAnonymousRoomLimit(socket) {
  const fingerprints = generateUserFingerprint(socket);
  const today = new Date().toDateString();

  try {
    // Check both device ID and network IP separately
    const [deviceLimitData, networkLimitData] = await Promise.all([
      AnonymousLimit.findOne({
        fingerprint: fingerprints.deviceId,
        type: 'device',
        date: today
      }),
      AnonymousLimit.findOne({
        fingerprint: fingerprints.networkFingerprint,
        type: 'network',
        date: today
      })
    ]);

    // Check if either device ID or network IP has reached the limit
    const deviceCount = deviceLimitData ? deviceLimitData.count : 0;
    const networkCount = networkLimitData ? networkLimitData.count : 0;

    // console.log('🚨 Limit Check:', {
    //   deviceId: fingerprints.deviceId,
    //   deviceCount: deviceCount,
    //   networkIp: fingerprints.ip,
    //   networkCount: networkCount,
    //   limit: DAILY_ROOM_LIMIT
    // });

    // Block if EITHER device ID OR network IP has reached limit
    if (deviceCount >= DAILY_ROOM_LIMIT || networkCount >= DAILY_ROOM_LIMIT) {
      const resetInfo = getTimeUntilReset();
      const blockedBy = deviceCount >= DAILY_ROOM_LIMIT ? 'device' : 'network';

      // Send to Discord
      await discordLogger.logRateLimit(
        fingerprints.deviceId,
        fingerprints.ip,
        fingerprints.deviceInfo.deviceName,
        fingerprints.deviceInfo.os,
        fingerprints.deviceInfo.browser,
        Math.max(deviceCount, networkCount),
        DAILY_ROOM_LIMIT,
        fingerprints.networkFingerprint,
        blockedBy
      );

      return {
        allowed: false,
        remaining: 0,
        resetTime: resetInfo,
        message: `Daily limit reached. This ${blockedBy} has already created/joined ${DAILY_ROOM_LIMIT} rooms today. Login for unlimited access.`
      };
    }

    const remainingForDevice = DAILY_ROOM_LIMIT - deviceCount;
    const remainingForNetwork = DAILY_ROOM_LIMIT - networkCount;
    const actualRemaining = Math.min(remainingForDevice, remainingForNetwork);

    return {
      allowed: true,
      remaining: actualRemaining,
      resetTime: getTimeUntilReset(),
      message: null
    };

  } catch (error) {
    console.error('Error checking room limit:', error);
    // Fallback to allow if database error
    return {
      allowed: true,
      remaining: DAILY_ROOM_LIMIT,
      resetTime: getTimeUntilReset(),
      message: null
    };
  }
}

// Increment room usage for anonymous user (both device and network)
async function incrementAnonymousRoomUsage(socket) {
  const fingerprints = generateUserFingerprint(socket);
  const today = new Date().toDateString();

  try {
    // Update or create device limit record
    let deviceLimitData = await AnonymousLimit.findOne({
      fingerprint: fingerprints.deviceId,
      type: 'device',
      date: today
    });

    if (!deviceLimitData) {
      deviceLimitData = new AnonymousLimit({
        fingerprint: fingerprints.deviceId,
        type: 'device',
        count: 0,
        date: today,
        ips: [fingerprints.ip],
        deviceInfo: fingerprints.deviceInfo,
        relatedIds: {
          deviceFingerprints: [fingerprints.deviceId],
          networkFingerprints: [fingerprints.networkFingerprint],
          ipHistory: [fingerprints.ip]
        }
      });
    }

    // Update or create network limit record
    let networkLimitData = await AnonymousLimit.findOne({
      fingerprint: fingerprints.networkFingerprint,
      type: 'network',
      date: today
    });

    if (!networkLimitData) {
      networkLimitData = new AnonymousLimit({
        fingerprint: fingerprints.networkFingerprint,
        type: 'network',
        count: 0,
        date: today,
        ips: [fingerprints.ip],
        deviceInfo: fingerprints.deviceInfo,
        relatedIds: {
          deviceFingerprints: [fingerprints.deviceId],
          networkFingerprints: [fingerprints.networkFingerprint],
          ipHistory: [fingerprints.ip]
        }
      });
    }

    // Increment both counters
    deviceLimitData.count++;
    networkLimitData.count++;

    // Update device info and IP history
    deviceLimitData.deviceInfo = fingerprints.deviceInfo;
    networkLimitData.deviceInfo = fingerprints.deviceInfo;

    if (!deviceLimitData.ips.includes(fingerprints.ip)) {
      deviceLimitData.ips.push(fingerprints.ip);
      deviceLimitData.relatedIds.ipHistory.push(fingerprints.ip);
    }

    if (!networkLimitData.ips.includes(fingerprints.ip)) {
      networkLimitData.ips.push(fingerprints.ip);
      networkLimitData.relatedIds.ipHistory.push(fingerprints.ip);
    }

    // Save both records
    await Promise.all([
      deviceLimitData.save(),
      networkLimitData.save()
    ]);

    const deviceRemaining = DAILY_ROOM_LIMIT - deviceLimitData.count;
    const networkRemaining = DAILY_ROOM_LIMIT - networkLimitData.count;

    // console.log('📊 Usage Updated:', {
    //   device: `${deviceLimitData.count}/${DAILY_ROOM_LIMIT} (${deviceRemaining} left)`,
    //   network: `${networkLimitData.count}/${DAILY_ROOM_LIMIT} (${networkRemaining} left)`,
    //   deviceName: fingerprints.deviceInfo.deviceName,
    //   os: fingerprints.deviceInfo.os
    // });

    // Log approaching limit
    if (Math.min(deviceRemaining, networkRemaining) <= 1) {
      await discordLogger.logApproachingLimit(
        fingerprints.deviceId,
        fingerprints.deviceInfo.deviceName,
        fingerprints.deviceInfo.os,
        fingerprints.deviceInfo.browser,
        Math.max(deviceLimitData.count, networkLimitData.count),
        DAILY_ROOM_LIMIT,
        Math.min(deviceRemaining, networkRemaining),
        [fingerprints.deviceInfo.browser]
      );
    }

  } catch (error) {
    console.error('Error incrementing room usage:', error);
  }
}// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve comparison page
app.get('/comparison', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'comparison.html'));
});

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Socket.io connection handling
io.use(socketAuth); // Add optional authentication to sockets

io.on('connection', (socket) => {
  logger.verbose('User connected:', socket.id, socket.user ? `(${socket.user.username})` : '(anonymous)');

  // For debugging: if user is logged in, immediately check their room history
  if (socket.user) {
    setTimeout(async () => {
      try {
        const rooms = await Room.getUserRoomHistory(socket.user._id);
        logger.verbose(`DEBUG: User ${socket.user.username} has ${rooms.length} rooms in database`);
      } catch (error) {
        console.error('DEBUG: Error checking user room history:', error);
      }
    }, 1000);
  }

  // Create a new room
  socket.on('create-room', async (callback) => {
    const isAnonymous = !socket.user;

    // Check daily room limit for anonymous users
    if (isAnonymous) {
      const limitCheck = await checkAnonymousRoomLimit(socket);
      if (!limitCheck.allowed) {
        return callback({
          error: limitCheck.message,
          limitReached: true,
          remaining: limitCheck.remaining,
          resetTime: limitCheck.resetTime
        });
      }
    }

    const roomId = uuidv4().substring(0, 8).toUpperCase();
    let roomData = null;

    try {
      // Check database connection first
      if (!isDBConnected()) {
        throw new Error('Database connection not available');
      }

      // Create room in MongoDB
      const roomDoc = new Room({
        roomId: roomId,
        creator: socket.user ? socket.user._id : null,
        isAnonymous: isAnonymous,
        expiresAt: isAnonymous ?
          new Date(Date.now() + 2 * 60 * 1000) : // 2 minutes for anonymous
          new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours for logged-in users
      });

      await roomDoc.save();
      logger.verbose(`Room ${roomId} saved to database with creator: ${roomDoc.creator}`);

      // Add creator as participant in database
      if (socket.user) {
        await roomDoc.addParticipant(socket.user._id, socket.id, 'creator');
        logger.verbose(`Creator ${socket.user.username} (ID: ${socket.user._id}) added to room ${roomId} in database`);
      } else {
        await roomDoc.addParticipant(null, socket.id, 'creator');
        logger.verbose(`Anonymous creator added to room ${roomId} in database`);
      }

      // Keep in-memory copy for quick access
      roomData = {
        id: roomId,
        creator: socket.id,
        creatorUser: socket.user ? socket.user.getPublicProfile() : null,
        participants: [socket.id],
        participantUsers: socket.user ? [socket.user.getPublicProfile()] : [],
        createdAt: new Date(),
        isAnonymous: isAnonymous,
        expiresAt: roomDoc.expiresAt,
        dbId: roomDoc._id
      };

      rooms.set(roomId, roomData);
      socket.join(roomId);

      // Set timer for anonymous room deletion
      if (isAnonymous) {
        setTimeout(async () => {
          const room = rooms.get(roomId);
          if (room && room.isAnonymous) {
            logger.verbose(`Anonymous room ${roomId} expired after 2 minutes`);
            // Notify participants about expiration
            io.to(roomId).emit('room-expired', {
              roomId,
              message: 'Room has expired. Login to create rooms with unlimited time.'
            });
            // Delete room from memory and database after notification
            setTimeout(async () => {
              rooms.delete(roomId);
              try {
                await Room.findOneAndDelete({ roomId });
                logger.verbose(`Room ${roomId} deleted from memory and database after expiration`);
              } catch (error) {
                console.error(`Error deleting expired room ${roomId} from database:`, error);
              }
            }, 5000); // 5 second delay to show message
          }
        }, 2 * 60 * 1000); // 2 minutes
      }

      // Set 24-hour expiration timer for logged-in user rooms
      if (!isAnonymous) {
        setTimeout(async () => {
          const room = rooms.get(roomId);
          if (room && !room.isAnonymous) {
            logger.verbose(`Logged-in user room ${roomId} expired after 24 hours`);
            // Notify participants about expiration
            io.to(roomId).emit('room-expired', {
              roomId,
              message: 'Room has expired after 24 hours. Create a new room to continue.'
            });
            // Delete room from memory and database after notification
            setTimeout(async () => {
              rooms.delete(roomId);
              try {
                await Room.findOneAndDelete({ roomId });
                logger.verbose(`Room ${roomId} deleted from memory and database after 24-hour expiration`);
              } catch (error) {
                console.error(`Error deleting expired room ${roomId} from database:`, error);
              }
            }, 5000);
          }
        }, 24 * 60 * 60 * 1000); // 24 hours
      }

      // Increment room usage for anonymous users
      if (isAnonymous) {
        await safeDBOperation(async () => {
          await incrementAnonymousRoomUsage(socket);
        });
      }

      logger.info(`Room created: ${roomId} by ${socket.user ? socket.user.username : 'anonymous'} ${isAnonymous ? '(2min limit)' : '(24hr limit)'}`);

      // Send success response
      callback({
        roomId,
        isAnonymous,
        expiresAt: roomData.expiresAt
      });

    } catch (error) {
      console.error('Error creating room:', error);

      // Handle specific MongoDB connection errors
      if (error.name === 'MongoNetworkError' || error.code === 'ECONNRESET') {
        return callback({
          error: 'Database connection error. Please check your internet connection and try again.'
        });
      }

      return callback({
        error: 'Failed to create room. Please try again.'
      });
    }
  });

  // Join an existing room
  socket.on('join-room', async ({ roomId }, callback) => {
    const isAnonymous = !socket.user;

    // Check daily room limit for anonymous users
    if (isAnonymous) {
      const limitCheck = await checkAnonymousRoomLimit(socket);
      if (!limitCheck.allowed) {
        return callback({
          error: limitCheck.message,
          limitReached: true,
          remaining: limitCheck.remaining,
          resetTime: limitCheck.resetTime
        });
      }
    }

    const room = rooms.get(roomId);

    if (!room) {
      callback({ error: 'Room not found' });
      return;
    }

    if (room.participants.length >= 2) {
      callback({ error: 'Room is full' });
      return;
    }

    room.participants.push(socket.id);

    // Add user info if logged in and update database
    if (socket.user) {
      room.participantUsers.push(socket.user.getPublicProfile());

      // Update database with participant
      await safeDBOperation(async () => {
        const roomDoc = await Room.findOne({ roomId });
        if (roomDoc) {
          await roomDoc.addParticipant(socket.user._id, socket.id, 'participant');
          logger.verbose(`User ${socket.user.username} added as participant to room ${roomId} in database`);
        } else {
          console.error(`Room ${roomId} not found in database when adding participant`);
        }
      });
    } else {
      // Update room document for anonymous user
      await safeDBOperation(async () => {
        const roomDoc = await Room.findOne({ roomId });
        if (roomDoc) {
          await roomDoc.addParticipant(null, socket.id, 'participant');
          logger.verbose(`Anonymous user added as participant to room ${roomId} in database`);
        } else {
          console.error(`Room ${roomId} not found in database when adding anonymous participant`);
        }
      });
    }

    socket.join(roomId);

    // Notify other participants with user info
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      user: socket.user ? socket.user.getPublicProfile() : null
    });

    // Increment room usage for anonymous users
    if (isAnonymous) {
      await incrementAnonymousRoomUsage(socket);
    }

    logger.verbose(`User ${socket.user ? socket.user.username : socket.id} joined room ${roomId}`);

    // Send detailed success response
    callback({
      success: true,
      room: {
        id: roomId,
        participants: room.participants,
        participantUsers: room.participantUsers,
        creator: room.creator,
        creatorUser: room.creatorUser,
        isAnonymous: room.isAnonymous,
        expiresAt: room.expiresAt
      },
      isCreator: room.creator === socket.id,
      isParticipant: true
    });
  });

  // Get user's room history (for rejoining rooms) - works directly from Room database
  socket.on('get-room-history', async (callback) => {
    if (!socket.user) {
      return callback({ error: 'Must be logged in to get room history' });
    }

    try {
      logger.verbose(`Getting room history for user ${socket.user.username} (ID: ${socket.user._id})`);

      // Get rooms directly from Room collection
      const roomsFromDB = await Room.getUserRoomHistory(socket.user._id);

      logger.verbose(`Found ${roomsFromDB.length} rooms in database for user ${socket.user.username}`);
      roomsFromDB.forEach(room => {
        const historyCount = room.participantHistory ? room.participantHistory.length : 0;
        logger.verbose(`Room ${room.roomId}: Creator=${room.creator?._id}, Active Participants=${room.participants.length}, History=${historyCount}, Expires=${room.expiresAt}`);
        if (room.participantHistory) {
          room.participantHistory.forEach((p, idx) => {
            logger.verbose(`  History ${idx}: ${p.user} - Role: ${p.role}`);
          });
        }
      });

      const validRooms = roomsFromDB.map(room => {
        const memoryRoom = rooms.get(room.roomId);

        // Check if user is creator
        const isCreator = room.creator?.toString() === socket.user._id.toString();

        // Find user in participantHistory (for joinedAt date)
        const userInHistory = room.participantHistory ?
          room.participantHistory.find(p => p.user?.toString() === socket.user._id.toString()) : null;

        return {
          roomId: room.roomId,
          role: isCreator ? 'creator' : 'participant',
          joinedAt: userInHistory?.joinedAt || room.createdAt,
          expiresAt: room.expiresAt,
          participants: memoryRoom ? memoryRoom.participants.length : room.participants.length,
          isActive: memoryRoom ? memoryRoom.participants.includes(socket.id) : false
        };
      });

      logger.verbose(`Returning ${validRooms.length} valid rooms for user ${socket.user.username}`);
      callback({ success: true, rooms: validRooms });
    } catch (error) {
      console.error('Error getting room history:', error);
      callback({ error: 'Failed to get room history' });
    }
  });

  // Rejoin existing room
  socket.on('rejoin-room', async ({ roomId }, callback) => {
    if (!socket.user) {
      return callback({ error: 'Must be logged in to rejoin rooms' });
    }

    try {
      // First check if room exists in database
      const roomDoc = await Room.findOne({
        roomId,
        $or: [
          { creator: socket.user._id },
          { 'participants.user': socket.user._id }
        ],
        expiresAt: { $gt: new Date() },
        isActive: true
      });

      if (!roomDoc) {
        return callback({ error: 'Room not found or has expired' });
      }

      // Check if room exists in memory, if not recreate it
      let room = rooms.get(roomId);
      if (!room) {
        // Recreate room in memory from database
        room = {
          id: roomId,
          creator: null, // Will be set when creator rejoins
          creatorUser: null,
          participants: [],
          participantUsers: [],
          createdAt: roomDoc.createdAt,
          isAnonymous: roomDoc.isAnonymous,
          expiresAt: roomDoc.expiresAt,
          dbId: roomDoc._id
        };

        // Set creator info if creator exists in database
        if (roomDoc.creator) {
          room.creator = roomDoc.creator.toString();
          if (roomDoc.creator.username) {
            room.creatorUser = {
              _id: roomDoc.creator._id,
              username: roomDoc.creator.username,
              avatar: roomDoc.creator.avatar
            };
          }
        }

        rooms.set(roomId, room);
        logger.verbose(`Room ${roomId} recreated in memory from database with ${roomDoc.participants.length} participants in DB`);
      }      // Add user to room if not already present
      if (!room.participants.includes(socket.id)) {
        room.participants.push(socket.id);
        room.participantUsers.push(socket.user.getPublicProfile());

        // Determine user role
        const isCreator = roomDoc.creator?.toString() === socket.user._id.toString();
        const userRole = isCreator ? 'creator' : 'participant';

        // Update database
        await safeDBOperation(async () => {
          await roomDoc.addParticipant(socket.user._id, socket.id, userRole);
        });

        logger.verbose(`User ${socket.user.username} rejoined room ${roomId} as ${userRole}`);

        // If user is the creator, update the memory room info
        if (isCreator) {
          room.creator = socket.id;
          room.creatorUser = socket.user.getPublicProfile();
        }
      }

      socket.join(roomId);

      // Check if this is the first person rejoining an empty room
      const isFirstRejoiner = room.participants.length === 1;

      // Notify other participants about rejoin (if any)
      if (!isFirstRejoiner) {
        socket.to(roomId).emit('user-joined', {
          userId: socket.id,
          user: socket.user.getPublicProfile(),
          rejoined: true
        });

        // If there are other participants, trigger WebRTC negotiation.
        // Broadcast to room so the initiator (creator) will start the offer.
        setTimeout(() => {
          io.to(roomId).emit('start-webrtc-offer');
        }, 500);
      }

      // Send enhanced success response
      callback({
        success: true,
        room: {
          id: roomId,
          participants: room.participants,
          participantUsers: room.participantUsers,
          creator: room.creator,
          creatorUser: room.creatorUser,
          isAnonymous: room.isAnonymous,
          expiresAt: room.expiresAt
        },
        isCreator: roomDoc.creator?.toString() === socket.user._id.toString(),
        rejoined: true,
        participantCount: room.participants.length,
        isFirstRejoiner: room.participants.length === 1
      });
    } catch (error) {
      console.error('Error rejoining room:', error);
      callback({ error: 'Failed to rejoin room. Please try again.' });
    }
  });

  // Delete room (only creator can delete)
  socket.on('delete-room', async ({ roomId }, callback) => {
    logger.verbose(`Delete room request from ${socket.user ? socket.user.username : 'anonymous'} for room ${roomId}`);

    if (!socket.user) {
      logger.verbose('Delete room rejected: User not logged in');
      return callback({ error: 'Must be logged in to delete rooms' });
    }

    try {
      // Get room from database to check creator
      const roomDoc = await Room.findOne({ roomId });
      if (!roomDoc) {
        logger.verbose(`Delete room rejected: Room ${roomId} not found in database`);
        return callback({ error: 'Room not found' });
      }

      logger.verbose(`Room ${roomId} found. Creator: ${roomDoc.creator}, Requesting user: ${socket.user._id}`);

      // Check if user is the creator using the Room model method
      if (!roomDoc.isCreator(socket.user._id)) {
        logger.verbose(`Delete room rejected: User ${socket.user.username} is not the creator of room ${roomId}`);
        return callback({ error: 'Only the room creator can delete the room' });
      }

      logger.verbose(`Delete room authorized for user ${socket.user.username} on room ${roomId}`);

      // Notify all participants about room deletion
      io.to(roomId).emit('room-deleted', {
        roomId,
        message: 'Room has been deleted by the creator.'
      });

      // Remove room from memory
      rooms.delete(roomId);

      // Remove room from database
      await Room.findOneAndDelete({ roomId });
      logger.info(`Room ${roomId} deleted from memory and database by creator ${socket.user.username}`);

      callback({ success: true });
    } catch (error) {
      console.error(`Error deleting room ${roomId}:`, error);
      callback({ error: 'Failed to delete room' });
    }
  });

  // WebRTC signaling
  socket.on('offer', ({ roomId, offer }) => {
    socket.to(roomId).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('answer', { answer, from: socket.id });
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', { candidate, from: socket.id });
  });

  // Connection status events
  socket.on('connection-ready', ({ roomId }) => {
    logger.verbose(`User ${socket.user ? socket.user.username : socket.id} reported WebRTC ready in room ${roomId}`);
    socket.to(roomId).emit('peer-connection-ready', {
      userId: socket.id,
      user: socket.user ? socket.user.getPublicProfile() : null
    });
  });

  socket.on('connection-established', ({ roomId }) => {
    logger.verbose(`Connection established in room ${roomId} by ${socket.user ? socket.user.username : socket.id}`);
    socket.to(roomId).emit('peer-connected', {
      userId: socket.id,
      user: socket.user ? socket.user.getPublicProfile() : null
    });
  });

  // File transfer events
  socket.on('file-info', ({ roomId, fileInfo }) => {
    socket.to(roomId).emit('file-info', { fileInfo, from: socket.id });
  });

  socket.on('transfer-complete', ({ roomId }) => {
    socket.to(roomId).emit('transfer-complete', { from: socket.id });
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    logger.verbose('User disconnected:', socket.id, socket.user ? `(${socket.user.username})` : '(anonymous)');

    // Clean up rooms in memory and database
    for (const [roomId, room] of rooms.entries()) {
      const index = room.participants.indexOf(socket.id);
      if (index !== -1) {
        room.participants.splice(index, 1);
        socket.to(roomId).emit('user-left', { userId: socket.id });

        // Update database room
        await safeDBOperation(async () => {
          const roomDoc = await Room.findOne({ roomId });
          if (roomDoc) {
            await roomDoc.removeParticipant(socket.id);
            logger.verbose(`Removed ${socket.user ? socket.user.username : 'anonymous'} from room ${roomId} in database`);
          }
        });

        // Delete room if empty
        if (room.participants.length === 0) {
          rooms.delete(roomId);
          // Don't delete from database immediately - let TTL handle it or creator delete it
          logger.verbose(`Room ${roomId} removed from memory (empty)`);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  logger.essential(`Server running on port ${PORT}`);
  logger.essential(`Access the app at http://localhost:${PORT}`);
});