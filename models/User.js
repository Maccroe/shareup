const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  avatar: {
    type: String,
    default: null
  },
  rooms: [{
    roomId: String,
    role: {
      type: String,
      enum: ['creator', 'participant'],
      default: 'participant'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  lastLogin: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Add room to user's room history
userSchema.methods.addRoom = function (roomId, role = 'participant') {
  // Remove existing room entry if present
  this.rooms = this.rooms.filter(room => room.roomId !== roomId);

  // Add new room entry
  this.rooms.push({
    roomId,
    role,
    joinedAt: new Date()
  });

  // Keep only last 10 rooms
  if (this.rooms.length > 10) {
    this.rooms = this.rooms.slice(-10);
  }

  return this.save();
};

// Get user's public profile
userSchema.methods.getPublicProfile = function () {
  return {
    id: this._id,
    username: this.username,
    avatar: this.avatar,
    lastLogin: this.lastLogin,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);