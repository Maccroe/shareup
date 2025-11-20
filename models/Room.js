const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    socketId: String,
    joinedAt: {
      type: Date,
      default: Date.now
    },
    role: {
      type: String,
      enum: ['creator', 'participant'],
      default: 'participant'
    }
  }],
  isAnonymous: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // MongoDB TTL index for automatic deletion
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient querying
roomSchema.index({ creator: 1, expiresAt: 1 });
roomSchema.index({ 'participants.user': 1, expiresAt: 1 });

// Update last activity
roomSchema.methods.updateActivity = function () {
  this.lastActivity = new Date();
  return this.save();
};

// Add participant
roomSchema.methods.addParticipant = function (userId, socketId, role = 'participant') {
  // Verbose logging only - can be controlled by LOG_LEVEL
  if (process.env.LOG_LEVEL === 'verbose') {
    console.log(`Adding participant to room ${this.roomId}: userId=${userId}, socketId=${socketId}, role=${role}`);
  }

  // Remove existing participant entry
  this.participants = this.participants.filter(p =>
    p.user?.toString() !== userId?.toString() && p.socketId !== socketId
  );

  // Add new participant
  this.participants.push({
    user: userId || null,
    socketId,
    joinedAt: new Date(),
    role
  });

  // Initialize participantHistory if it doesn't exist
  if (!this.participantHistory) {
    this.participantHistory = [];
  }

  // Add to participant history if not already there (for logged-in users)
  if (userId) {
    const userIdStr = userId.toString();
    const existsInHistory = this.participantHistory.some(p =>
      p.user && p.user.toString() === userIdStr
    );

    if (!existsInHistory) {
      this.participantHistory.push({
        user: userId,
        joinedAt: new Date(),
        role
      });
      if (process.env.LOG_LEVEL === 'verbose') {
        console.log(`Added user ${userId} to participant history for room ${this.roomId}`);
      }
    } else {
      if (process.env.LOG_LEVEL === 'verbose') {
        console.log(`User ${userId} already exists in participant history for room ${this.roomId}`);
      }
    }
  }

  const historyCount = this.participantHistory ? this.participantHistory.length : 0;
  if (process.env.LOG_LEVEL === 'verbose') {
    console.log(`Room ${this.roomId} now has ${this.participants.length} active participants, ${historyCount} in history`);
  }
  this.lastActivity = new Date();
  return this.save();
};

// Remove participant
roomSchema.methods.removeParticipant = function (socketId, userId = null) {
  if (process.env.LOG_LEVEL === 'verbose') {
    console.log(`Removing participant from room ${this.roomId}: socketId=${socketId}, userId=${userId}`);
  }

  const initialCount = this.participants.length;
  this.participants = this.participants.filter(p =>
    p.socketId !== socketId &&
    (userId ? p.user?.toString() !== userId?.toString() : true)
  );

  const finalCount = this.participants.length;
  if (process.env.LOG_LEVEL === 'verbose') {
    console.log(`Room ${this.roomId} participant count: ${initialCount} -> ${finalCount}`);
  }

  this.lastActivity = new Date();
  return this.save();
};

// Get active participants count
roomSchema.methods.getActiveParticipants = function () {
  return this.participants.length;
};

// Check if user is creator
roomSchema.methods.isCreator = function (userId) {
  return this.creator && this.creator.toString() === userId?.toString();
};

// Static method to clean expired rooms manually (backup to TTL)
roomSchema.statics.cleanExpiredRooms = async function () {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  if (result.deletedCount > 0 && process.env.LOG_LEVEL === 'verbose') {
    console.log(`Cleaned ${result.deletedCount} expired rooms from database`);
  }
  return result;
};

// Static method to get user's room history
roomSchema.statics.getUserRoomHistory = async function (userId) {
  if (process.env.LOG_LEVEL === 'verbose') {
    console.log(`Getting room history for user: ${userId}`);
  }

  try {
    const now = new Date();
    const rooms = await this.find({
      $or: [
        { creator: userId },
        { 'participantHistory.user': userId }
      ],
      expiresAt: { $gt: now },
      isActive: true
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('creator', 'username avatar')
      .populate('participants.user', 'username');

    if (process.env.LOG_LEVEL === 'verbose') {
      console.log(`Found ${rooms.length} rooms for user ${userId}`);
      rooms.forEach(room => {
        const participantHistoryLength = room.participantHistory ? room.participantHistory.length : 0;
        console.log(`  Room ${room.roomId}: ${room.participants.length} active participants, ${participantHistoryLength} in history`);
        if (room.participantHistory) {
          room.participantHistory.forEach(p => {
            console.log(`    - History User: ${p.user}, Role: ${p.role || 'participant'}`);
          });
        }
      });
    }

    return rooms;
  } catch (error) {
    console.error('Error getting user room history:', error);
    throw error;
  }
}; module.exports = mongoose.model('Room', roomSchema);