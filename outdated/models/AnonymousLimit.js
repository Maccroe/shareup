const mongoose = require('mongoose');

const anonymousLimitSchema = new mongoose.Schema({
  fingerprint: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  type: {
    type: String,
    enum: ['device', 'network'],
    required: true,
    index: true
  },
  count: {
    type: Number,
    required: true,
    default: 0
  },
  date: {
    type: String,
    required: true
  },
  ips: {
    type: [String],
    default: []
  },
  deviceInfo: {
    deviceId: String,         // Unique device identifier (IMEI substitute)
    deviceName: String,       // Device name/model extracted from UserAgent
    networkIp: String,        // Current network IP
    os: String,              // Operating system
    osVersion: String,       // OS version
    browser: String,         // Browser type
    browserVersion: String,  // Browser version
    language: String,        // Accept-Language
    userAgent: String,       // Full user agent
    screenResolution: String, // Screen resolution if available
    timezone: String,        // Timezone if available
    lastSeen: Date           // Last activity timestamp
  },
  relatedIds: {
    deviceFingerprints: [String],  // Related device fingerprints
    networkFingerprints: [String], // Related network fingerprints
    ipHistory: [String]            // IP history for this device
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
anonymousLimitSchema.index({ date: 1, type: 1 });
anonymousLimitSchema.index({ 'deviceInfo.deviceId': 1, date: 1 });
anonymousLimitSchema.index({ 'deviceInfo.networkIp': 1, date: 1 });
anonymousLimitSchema.index({ 'deviceInfo.os': 1, 'deviceInfo.browser': 1, date: 1 });
anonymousLimitSchema.index({ type: 1, date: 1 });

// Clean up old entries automatically (remove entries older than 7 days)
anonymousLimitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('AnonymousLimit', anonymousLimitSchema);