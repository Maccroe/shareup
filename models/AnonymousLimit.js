const mongoose = require('mongoose');

const anonymousLimitSchema = new mongoose.Schema({
  fingerprint: {
    type: String,
    required: true,
    unique: true,
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
  metadata: {
    network: String,           // Network fingerprint
    device: String,            // Device fingerprint  
    os: String,               // Operating system
    browser: String,          // Browser type
    language: String,         // Accept-Language
    userAgent: String,        // Full user agent
    relatedFingerprints: [String]  // List of related fingerprints
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

// Indexes for efficient queries
anonymousLimitSchema.index({ date: 1 });
anonymousLimitSchema.index({ 'metadata.network': 1, date: 1 });
anonymousLimitSchema.index({ 'metadata.device': 1, date: 1 });
anonymousLimitSchema.index({ 'metadata.os': 1, 'metadata.browser': 1, date: 1 });
anonymousLimitSchema.index({ ips: 1, date: 1 });

// Clean up old entries automatically (remove entries older than 7 days)
anonymousLimitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('AnonymousLimit', anonymousLimitSchema);