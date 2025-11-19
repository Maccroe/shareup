const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

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

// Store active rooms
const rooms = new Map();

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create a new room
  socket.on('create-room', (callback) => {
    const roomId = uuidv4().substring(0, 8).toUpperCase();
    rooms.set(roomId, {
      id: roomId,
      creator: socket.id,
      participants: [socket.id],
      createdAt: new Date()
    });

    socket.join(roomId);
    console.log(`Room created: ${roomId}`);

    callback({ roomId });
  });

  // Join an existing room
  socket.on('join-room', ({ roomId }, callback) => {
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
    socket.join(roomId);

    // Notify other participants
    socket.to(roomId).emit('user-joined', { userId: socket.id });

    console.log(`User ${socket.id} joined room ${roomId}`);
    callback({ success: true, room });
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
    console.log('User disconnected:', socket.id);

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