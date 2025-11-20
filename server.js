const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
require('dotenv').config();

// Import authentication middleware
const { socketAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const User = require('./models/User');
const AnonymousLimit = require('./models/AnonymousLimit');
const Room = require('./models/Room');

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

// Admin endpoint to view blocked/rate-limited devices and IPs
app.get('/api/admin/blocked', requireAdminAuth, async (req, res) => {
  try {
    const today = new Date().toDateString(); // Use same format as database

    // Get all entries for today that have reached the limit
    const blockedDevices = await AnonymousLimit.find({
      date: today,
      count: { $gte: DAILY_ROOM_LIMIT }
    }).sort({ count: -1, updatedAt: -1 });

    // Get all entries for today to calculate stats
    const allDevices = await AnonymousLimit.find({ date: today });

    // Calculate statistics
    const uniqueIPs = new Set();
    let totalRoomAttempts = 0;

    allDevices.forEach(device => {
      device.ips.forEach(ip => uniqueIPs.add(ip));
      totalRoomAttempts += device.count;
    });

    // Format blocked devices data
    const formattedData = blockedDevices.map(entry => ({
      fingerprint: entry.fingerprint,
      count: entry.count,
      limit: DAILY_ROOM_LIMIT,
      date: entry.date,
      ips: entry.ips || [],
      metadata: {
        network: entry.metadata?.network || 'Unknown',
        device: entry.metadata?.device || 'Unknown',
        os: entry.metadata?.os || 'Unknown',
        browser: entry.metadata?.browser || 'Unknown',
        language: entry.metadata?.language || 'Unknown',
        userAgent: entry.metadata?.userAgent || 'Unknown',
        relatedFingerprints: entry.metadata?.relatedFingerprints || []
      }
    }));

    res.json({
      success: true,
      totalBlocked: blockedDevices.length,
      totalUniqueIPs: uniqueIPs.size,
      totalRoomAttempts: totalRoomAttempts,
      blockedDevices: formattedData
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

// MongoDB Connection with retry logic
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/shareup', {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4
    });
    console.log('Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    return false;
  }
};

// Handle MongoDB disconnection
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection error:', error);
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
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
        console.log(`Cleaned up ${deletedCount.deletedCount} old anonymous limit entries`);
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
      console.log(`Cleaned expired room ${roomId} from memory`);
    });

    if (expiredRooms.length > 0) {
      console.log(`Cleaned ${expiredRooms.length} expired rooms from memory during periodic cleanup`);
    }
  } catch (error) {
    console.error('Error during periodic room cleanup:', error);
  }
}, 5 * 60 * 1000); // Run every 5 minutes

const DAILY_ROOM_LIMIT = 5;

// Enhanced user fingerprinting for anonymous limit tracking
function generateUserFingerprint(socket) {
  const ip = socket.handshake.address || socket.conn.remoteAddress || 'unknown';
  const userAgent = socket.handshake.headers['user-agent'] || 'unknown';
  const acceptLanguage = socket.handshake.headers['accept-language'] || 'unknown';
  const acceptEncoding = socket.handshake.headers['accept-encoding'] || 'unknown';
  const referer = socket.handshake.headers['referer'] || 'unknown';
  const origin = socket.handshake.headers['origin'] || 'unknown';

  // Extract more specific browser/device info from User-Agent
  const uaLower = userAgent.toLowerCase();
  const osPattern = /(windows|mac|linux|android|ios|iphone|ipad)/i;
  const browserPattern = /(chrome|firefox|safari|edge|opera)/i;
  const os = (uaLower.match(osPattern) || ['unknown'])[0];
  const browser = (uaLower.match(browserPattern) || ['unknown'])[0];

  // Create multiple fingerprint layers
  const crypto = require('crypto');

  // Primary fingerprint (main identifier)
  const primaryFingerprint = crypto.createHash('sha256')
    .update(userAgent + acceptLanguage + acceptEncoding + os + browser)
    .digest('hex').substring(0, 16);

  // Secondary fingerprint (network-based)
  const networkFingerprint = crypto.createHash('sha256')
    .update(ip + origin + referer)
    .digest('hex').substring(0, 12);

  // Device fingerprint (browser/OS specific)
  const deviceFingerprint = crypto.createHash('sha256')
    .update(os + browser + acceptLanguage)
    .digest('hex').substring(0, 12);

  return {
    primary: primaryFingerprint,
    network: networkFingerprint,
    device: deviceFingerprint,
    ip: ip,
    userAgent: userAgent,
    os: os,
    browser: browser,
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
async function checkAnonymousRoomLimit(socket) {
  const fingerprints = generateUserFingerprint(socket);
  const today = new Date().toDateString();

  try {
    // Check all fingerprint variations to detect bypass attempts
    const [primaryData, networkMatches, deviceMatches] = await Promise.all([
      AnonymousLimit.findOne({ fingerprint: fingerprints.primary }),
      AnonymousLimit.find({
        date: today,
        $or: [
          { 'metadata.network': fingerprints.network },
          { 'ips': fingerprints.ip }
        ]
      }),
      AnonymousLimit.find({
        date: today,
        'metadata.device': fingerprints.device,
        'metadata.os': fingerprints.os,
        'metadata.browser': fingerprints.browser
      })
    ]);

    // Calculate total usage across all related fingerprints
    const relatedFingerprints = new Set();
    let totalUsage = 0;

    if (primaryData) {
      relatedFingerprints.add(primaryData.fingerprint);
      totalUsage += primaryData.count;
    }

    // Add usage from network matches (same IP/network fingerprint)
    networkMatches.forEach(match => {
      if (!relatedFingerprints.has(match.fingerprint)) {
        relatedFingerprints.add(match.fingerprint);
        totalUsage += match.count;
      }
    });

    // Add usage from device matches (same device signature)
    deviceMatches.forEach(match => {
      if (!relatedFingerprints.has(match.fingerprint)) {
        relatedFingerprints.add(match.fingerprint);
        totalUsage += match.count;
      }
    });

    // Create or update primary fingerprint data
    let limitData = primaryData;
    if (!limitData) {
      limitData = new AnonymousLimit({
        fingerprint: fingerprints.primary,
        count: 0,
        date: today,
        ips: [fingerprints.ip],
        metadata: {
          network: fingerprints.network,
          device: fingerprints.device,
          os: fingerprints.os,
          browser: fingerprints.browser,
          language: fingerprints.language,
          userAgent: fingerprints.userAgent,
          relatedFingerprints: Array.from(relatedFingerprints)
        }
      });
    } else {
      // Update existing data
      if (limitData.date !== today) {
        limitData.count = 0;
        limitData.date = today;
        limitData.ips = [fingerprints.ip];
        totalUsage = 0; // Reset for new day
      } else {
        // Add current IP if not already present
        if (!limitData.ips.includes(fingerprints.ip)) {
          limitData.ips.push(fingerprints.ip);
        }
      }

      // Update metadata with latest info
      limitData.metadata = {
        ...limitData.metadata,
        network: fingerprints.network,
        device: fingerprints.device,
        os: fingerprints.os,
        browser: fingerprints.browser,
        language: fingerprints.language,
        userAgent: fingerprints.userAgent,
        relatedFingerprints: Array.from(relatedFingerprints)
      };
    }

    await limitData.save();

    // Use the higher of individual count or total related usage
    const effectiveUsage = Math.max(limitData.count, totalUsage);

    // Check limit against effective usage
    if (effectiveUsage >= DAILY_ROOM_LIMIT) {
      const resetInfo = getTimeUntilReset();

      // Enhanced logging for admin monitoring
      console.log(`🚫 RATE LIMIT REACHED - Anonymous user blocked:`);
      console.log(`   Fingerprint: ${fingerprints.primary}`);
      console.log(`   IP Address: ${fingerprints.ip}`);
      console.log(`   Device: ${fingerprints.os}/${fingerprints.browser}`);
      console.log(`   Network: ${fingerprints.network}`);
      console.log(`   Usage: ${effectiveUsage}/${DAILY_ROOM_LIMIT} rooms`);
      console.log(`   Related fingerprints: ${relatedFingerprints.size}`);
      console.log(`   User Agent: ${fingerprints.userAgent.substring(0, 50)}...`);

      return {
        allowed: false,
        remaining: 0,
        resetTime: resetInfo,
        message: `Daily limit reached. Anonymous users can only create/join ${DAILY_ROOM_LIMIT} rooms per day. Login for unlimited access.`
      };
    }

    return {
      allowed: true,
      remaining: DAILY_ROOM_LIMIT - effectiveUsage,
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

// Increment room usage for anonymous user
async function incrementAnonymousRoomUsage(socket) {
  const fingerprints = generateUserFingerprint(socket);

  try {
    const limitData = await AnonymousLimit.findOne({ fingerprint: fingerprints.primary });
    if (limitData) {
      limitData.count++;
      await limitData.save();

      const remaining = DAILY_ROOM_LIMIT - limitData.count;
      const logMessage = `Anonymous user ${fingerprints.primary} used ${limitData.count}/${DAILY_ROOM_LIMIT} daily rooms (Device: ${fingerprints.os}/${fingerprints.browser})`;

      if (remaining <= 1) {
        console.log(`⚠️  APPROACHING LIMIT: ${logMessage} - ${remaining} rooms remaining`);
      } else {
        console.log(logMessage);
      }
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
  console.log('User connected:', socket.id, socket.user ? `(${socket.user.username})` : '(anonymous)');

  // For debugging: if user is logged in, immediately check their room history
  if (socket.user) {
    setTimeout(async () => {
      try {
        const rooms = await Room.getUserRoomHistory(socket.user._id);
        console.log(`DEBUG: User ${socket.user.username} has ${rooms.length} rooms in database`);
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
      console.log(`Room ${roomId} saved to database with creator: ${roomDoc.creator}`);

      // Add creator as participant in database
      if (socket.user) {
        await roomDoc.addParticipant(socket.user._id, socket.id, 'creator');
        console.log(`Creator ${socket.user.username} (ID: ${socket.user._id}) added to room ${roomId} in database`);
      } else {
        await roomDoc.addParticipant(null, socket.id, 'creator');
        console.log(`Anonymous creator added to room ${roomId} in database`);
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
            console.log(`Anonymous room ${roomId} expired after 2 minutes`);
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
                console.log(`Room ${roomId} deleted from memory and database after expiration`);
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
            console.log(`Logged-in user room ${roomId} expired after 24 hours`);
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
                console.log(`Room ${roomId} deleted from memory and database after 24-hour expiration`);
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

      console.log(`Room created: ${roomId} by ${socket.user ? socket.user.username : 'anonymous'} ${isAnonymous ? '(2min limit)' : '(24hr limit)'}`);

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
          console.log(`User ${socket.user.username} added as participant to room ${roomId} in database`);
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
          console.log(`Anonymous user added as participant to room ${roomId} in database`);
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

    console.log(`User ${socket.user ? socket.user.username : socket.id} joined room ${roomId}`);

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
      console.log(`Getting room history for user ${socket.user.username} (ID: ${socket.user._id})`);

      // Get rooms directly from Room collection
      const roomsFromDB = await Room.getUserRoomHistory(socket.user._id);

      console.log(`Found ${roomsFromDB.length} rooms in database for user ${socket.user.username}`);
      roomsFromDB.forEach(room => {
        const historyCount = room.participantHistory ? room.participantHistory.length : 0;
        console.log(`Room ${room.roomId}: Creator=${room.creator?._id}, Active Participants=${room.participants.length}, History=${historyCount}, Expires=${room.expiresAt}`);
        if (room.participantHistory) {
          room.participantHistory.forEach((p, idx) => {
            console.log(`  History ${idx}: ${p.user} - Role: ${p.role}`);
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

      console.log(`Returning ${validRooms.length} valid rooms for user ${socket.user.username}`);
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
        console.log(`Room ${roomId} recreated in memory from database with ${roomDoc.participants.length} participants in DB`);
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

        console.log(`User ${socket.user.username} rejoined room ${roomId} as ${userRole}`);

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
    console.log(`Delete room request from ${socket.user ? socket.user.username : 'anonymous'} for room ${roomId}`);

    if (!socket.user) {
      console.log('Delete room rejected: User not logged in');
      return callback({ error: 'Must be logged in to delete rooms' });
    }

    try {
      // Get room from database to check creator
      const roomDoc = await Room.findOne({ roomId });
      if (!roomDoc) {
        console.log(`Delete room rejected: Room ${roomId} not found in database`);
        return callback({ error: 'Room not found' });
      }

      console.log(`Room ${roomId} found. Creator: ${roomDoc.creator}, Requesting user: ${socket.user._id}`);

      // Check if user is the creator using the Room model method
      if (!roomDoc.isCreator(socket.user._id)) {
        console.log(`Delete room rejected: User ${socket.user.username} is not the creator of room ${roomId}`);
        return callback({ error: 'Only the room creator can delete the room' });
      }

      console.log(`Delete room authorized for user ${socket.user.username} on room ${roomId}`);

      // Notify all participants about room deletion
      io.to(roomId).emit('room-deleted', {
        roomId,
        message: 'Room has been deleted by the creator.'
      });

      // Remove room from memory
      rooms.delete(roomId);

      // Remove room from database
      await Room.findOneAndDelete({ roomId });
      console.log(`Room ${roomId} deleted from memory and database by creator ${socket.user.username}`);

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
    console.log(`User ${socket.user ? socket.user.username : socket.id} reported WebRTC ready in room ${roomId}`);
    socket.to(roomId).emit('peer-connection-ready', {
      userId: socket.id,
      user: socket.user ? socket.user.getPublicProfile() : null
    });
  });

  socket.on('connection-established', ({ roomId }) => {
    console.log(`Connection established in room ${roomId} by ${socket.user ? socket.user.username : socket.id}`);
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
    console.log('User disconnected:', socket.id, socket.user ? `(${socket.user.username})` : '(anonymous)');

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
            console.log(`Removed ${socket.user ? socket.user.username : 'anonymous'} from room ${roomId} in database`);
          }
        });

        // Delete room if empty
        if (room.participants.length === 0) {
          rooms.delete(roomId);
          // Don't delete from database immediately - let TTL handle it or creator delete it
          console.log(`Room ${roomId} removed from memory (empty)`);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the app at http://localhost:${PORT}`);
});