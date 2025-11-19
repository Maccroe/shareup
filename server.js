const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

// Import authentication middleware
const { socketAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const User = require('./models/User');
const AnonymousLimit = require('./models/AnonymousLimit');

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

// Authentication routes
app.use('/api/auth', authRoutes);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/shareup')
  .then(async () => {
    console.log('Connected to MongoDB');

    // Clean up old anonymous limit entries on startup
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const deletedCount = await AnonymousLimit.deleteMany({
        date: { $lt: yesterday.toDateString() }
      });
      if (deletedCount.deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount.deletedCount} old anonymous limit entries`);
      }
    } catch (error) {
      console.error('Error cleaning up old limit entries:', error);
    }
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Store active rooms
const rooms = new Map();

const DAILY_ROOM_LIMIT = 5;

// Generate user fingerprint for anonymous limit tracking
function generateUserFingerprint(socket) {
  const ip = socket.handshake.address || socket.conn.remoteAddress || 'unknown';
  const userAgent = socket.handshake.headers['user-agent'] || 'unknown';
  const acceptLanguage = socket.handshake.headers['accept-language'] || 'unknown';

  // Create fingerprint from multiple factors
  const crypto = require('crypto');
  const fingerprint = crypto.createHash('sha256')
    .update(ip + userAgent + acceptLanguage)
    .digest('hex').substring(0, 16);

  return { fingerprint, ip };
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

// Check if anonymous user can create/join room
async function checkAnonymousRoomLimit(socket) {
  const { fingerprint, ip } = generateUserFingerprint(socket);
  const today = new Date().toDateString();

  try {
    let limitData = await AnonymousLimit.findOne({ fingerprint });

    if (!limitData) {
      // Create new limit entry
      limitData = new AnonymousLimit({
        fingerprint,
        count: 0,
        date: today,
        ips: [ip]
      });
      await limitData.save();
    } else {
      // Check if it's a new day
      if (limitData.date !== today) {
        limitData.count = 0;
        limitData.date = today;
        limitData.ips = [ip];
        await limitData.save();
      } else {
        // Add current IP if not already present
        if (!limitData.ips.includes(ip)) {
          limitData.ips.push(ip);
          await limitData.save();
        }
      }
    }

    // Check limit
    if (limitData.count >= DAILY_ROOM_LIMIT) {
      const resetInfo = getTimeUntilReset();
      return {
        allowed: false,
        remaining: 0,
        resetTime: resetInfo,
        message: `Daily limit reached. Anonymous users can only create/join ${DAILY_ROOM_LIMIT} rooms per day. Login for unlimited access.`
      };
    }

    return {
      allowed: true,
      remaining: DAILY_ROOM_LIMIT - limitData.count,
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
  const { fingerprint } = generateUserFingerprint(socket);

  try {
    const limitData = await AnonymousLimit.findOne({ fingerprint });
    if (limitData) {
      limitData.count++;
      await limitData.save();
      console.log(`Anonymous user ${fingerprint} used ${limitData.count}/${DAILY_ROOM_LIMIT} daily rooms`);
    }
  } catch (error) {
    console.error('Error incrementing room usage:', error);
  }
}

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io connection handling
io.use(socketAuth); // Add optional authentication to sockets

io.on('connection', (socket) => {
  console.log('User connected:', socket.id, socket.user ? `(${socket.user.username})` : '(anonymous)');

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
    const roomData = {
      id: roomId,
      creator: socket.id,
      creatorUser: socket.user ? socket.user.getPublicProfile() : null,
      participants: [socket.id],
      participantUsers: socket.user ? [socket.user.getPublicProfile()] : [],
      createdAt: new Date(),
      isAnonymous: isAnonymous,
      expiresAt: isAnonymous ? new Date(Date.now() + 2 * 60 * 1000) : null // 2 minutes for anonymous
    };

    rooms.set(roomId, roomData);
    socket.join(roomId);

    // If user is logged in, add room to their history
    if (socket.user) {
      try {
        await socket.user.addRoom(roomId, 'creator');
      } catch (error) {
        console.error('Error adding room to user history:', error);
      }
    } else {
      // Set timer for anonymous room deletion
      setTimeout(() => {
        const room = rooms.get(roomId);
        if (room && room.isAnonymous) {
          console.log(`Anonymous room ${roomId} expired after 2 minutes`);
          // Notify participants about expiration
          io.to(roomId).emit('room-expired', {
            roomId,
            message: 'Room has expired. Login to create rooms with unlimited time.'
          });
          // Delete room after notification
          setTimeout(() => {
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted after expiration`);
          }, 5000); // 5 second delay to show message
        }
      }, 2 * 60 * 1000); // 2 minutes
    }

    // Increment room usage for anonymous users
    if (isAnonymous) {
      await incrementAnonymousRoomUsage(socket);
    }

    console.log(`Room created: ${roomId} by ${socket.user ? socket.user.username : 'anonymous'} ${isAnonymous ? '(2min limit)' : '(unlimited)'}`);
    callback({
      roomId,
      isAnonymous,
      expiresAt: roomData.expiresAt
    });
  });  // Join an existing room
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

    // Add user info if logged in
    if (socket.user) {
      room.participantUsers.push(socket.user.getPublicProfile());
      try {
        await socket.user.addRoom(roomId, 'participant');
      } catch (error) {
        console.error('Error adding room to user history:', error);
      }
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
    callback({
      success: true,
      room: {
        ...room,
        participants: room.participants,
        participantUsers: room.participantUsers
      }
    });
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

  // File transfer events
  socket.on('file-info', ({ roomId, fileInfo }) => {
    socket.to(roomId).emit('file-info', { fileInfo, from: socket.id });
  });

  socket.on('transfer-complete', ({ roomId }) => {
    socket.to(roomId).emit('transfer-complete', { from: socket.id });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id, socket.user ? `(${socket.user.username})` : '(anonymous)');

    // Clean up rooms
    for (const [roomId, room] of rooms.entries()) {
      const index = room.participants.indexOf(socket.id);
      if (index !== -1) {
        room.participants.splice(index, 1);
        socket.to(roomId).emit('user-left', { userId: socket.id });

        // Delete room if empty
        if (room.participants.length === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted`);
        }
      }
    }
  });
});

// Clean up old rooms (older than 24 hours)
setInterval(() => {
  const now = new Date();
  for (const [roomId, room] of rooms.entries()) {
    const timeDiff = now - room.createdAt;
    if (timeDiff > 24 * 60 * 60 * 1000) { // 24 hours
      rooms.delete(roomId);
      console.log(`Room ${roomId} expired and deleted`);
    }
  }
}, 60 * 60 * 1000); // Check every hour

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the app at http://localhost:${PORT}`);
});