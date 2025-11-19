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
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Store active rooms
const rooms = new Map();

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
    const roomId = uuidv4().substring(0, 8).toUpperCase();
    const isAnonymous = !socket.user;
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

    console.log(`Room created: ${roomId} by ${socket.user ? socket.user.username : 'anonymous'} ${isAnonymous ? '(2min limit)' : '(unlimited)'}`);
    callback({
      roomId,
      isAnonymous,
      expiresAt: roomData.expiresAt
    });
  });  // Join an existing room
  socket.on('join-room', async ({ roomId }, callback) => {
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