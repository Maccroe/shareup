# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v2.0.0] - 2025-11-23

### 🎉 Major Admin Enhancement Release

This major release introduces powerful new admin controls for managing device rate limits in real-time, significantly improving the administrative experience and providing more flexibility in user management.

### ✨ Added

#### Admin Dashboard Enhancements

- **Reset Limit Functionality**: New "🔄 Reset Limit" button for active devices in admin dashboard
  - Allows admins to reset room count to 0 for any active device/network
  - Provides immediate relief to users without waiting for daily reset
  - Maintains full audit trail of admin actions

#### Enhanced Device Management

- **Granular Control**: Separate actions for different device states
  - **Blocked Devices (5/5 rooms)**: "🔓 Unblock" button (removes device entirely)
  - **Active Devices (1-4/5 rooms)**: "🔄 Reset Limit" button (resets count to 0)
- **Real-time Updates**: Immediate dashboard refresh after admin actions
- **User-friendly Interface**: Clear visual distinction between reset and unblock actions

#### Backend API Improvements

- **New REST Endpoint**: `POST /api/admin/reset-limit/:fingerprint`
  - Validates admin authentication
  - Safely resets device count to 0
  - Maintains device history and metadata
  - Returns detailed response with updated device information
- **Enhanced Error Handling**: Comprehensive error messages for edge cases
- **Audit Logging**: Detailed server logs for all admin reset actions

#### Discord Integration Updates

- **New Notification Type**: Device limit reset notifications
  - Deep sky blue colored embeds for easy identification
  - Complete device information and admin action details
  - Separate from unblock notifications for better tracking
- **Enhanced Logging**: `logDeviceLimitReset()` method for Discord webhooks
- **Fallback Handling**: Graceful degradation when Discord notifications fail

### 🔧 Improved

#### Admin User Experience

- **Intuitive Controls**: Clear button labels and confirmation dialogs
- **Action Feedback**: Loading states and success indicators
- **Confirmation Dialogs**: Prevent accidental limit resets with clear descriptions
- **Responsive Design**: Reset buttons work seamlessly on mobile devices

#### Security & Validation

- **Input Sanitization**: Proper URL encoding for device fingerprints
- **Authentication Checks**: All reset actions require valid admin session
- **Database Validation**: Ensures device exists before attempting reset
- **Transaction Safety**: Atomic operations for data consistency

### 🛠️ Technical Implementation

#### Frontend Architecture

- **Modular JavaScript**: `resetDeviceLimit()` function with comprehensive error handling
- **Progressive Enhancement**: Buttons only appear for applicable device states
- **Async/Await Pattern**: Modern JavaScript for clean asynchronous operations
- **User Feedback**: Visual state changes during reset operations

#### Backend Architecture

- **RESTful Design**: Follows existing API patterns for consistency
- **Mongoose Integration**: Safe database operations with proper error handling
- **Express Middleware**: Reuses existing admin authentication system
- **Discord Integration**: Optional webhook notifications with error tolerance

#### Database Operations

- **In-place Updates**: Efficient count reset without recreating records
- **Metadata Preservation**: Maintains all device information and history
- **TTL Compliance**: Respects existing TTL indexes for automatic cleanup
- **Concurrency Safe**: Proper handling of simultaneous admin operations

### 📊 Administrative Benefits

#### Operational Efficiency

- **Instant Relief**: No need to wait for midnight reset for legitimate users
- **Reduced Support**: Users can get immediate help through admin action
- **Fine-grained Control**: Reset specific devices without affecting others
- **Complete Audit Trail**: Full logging of all administrative actions

#### User Management

- **Flexible Policies**: Admins can implement custom rate limiting policies
- **Emergency Access**: Quick resolution for users who need immediate access
- **Testing Support**: Easy reset for development and testing scenarios
- **Customer Service**: Better support for legitimate high-usage scenarios

### 🔐 Security Considerations

#### Access Control

- **Admin-only Feature**: Reset functionality requires admin authentication
- **Session Validation**: Proper session management for all admin actions
- **CSRF Protection**: Follows existing security patterns
- **Input Validation**: Comprehensive parameter validation and sanitization

#### Audit & Compliance

- **Action Logging**: All reset actions logged to server console
- **Discord Notifications**: External audit trail through Discord webhooks
- **Database Records**: Reset actions update existing records with timestamps
- **Fingerprint Tracking**: Maintains complete device identification history

### 🚀 Deployment Notes

#### Backward Compatibility

- **Zero Breaking Changes**: Fully backward compatible with v1.0.0
- **Database Schema**: No database migrations required
- **API Compatibility**: All existing endpoints remain unchanged
- **Client Compatibility**: No frontend changes required for basic functionality

#### Configuration

- **No New Environment Variables**: Uses existing configuration
- **Discord Integration**: Leverages existing Discord webhook setup
- **Admin Authentication**: Uses existing admin password system
- **MongoDB**: Compatible with existing database schema

### 📚 Documentation Updates

#### API Documentation

- New endpoint documentation for reset limit functionality
- Updated admin dashboard usage guide
- Enhanced error code documentation

#### Security Guidelines

- Admin action best practices
- Rate limit policy recommendations
- Audit logging configuration

---

### 📝 Migration Notes

This is a major version bump due to the significant new administrative functionality. However, no breaking changes were introduced, making this a safe upgrade for all existing deployments. The new reset functionality is immediately available to all admin users without requiring any configuration changes.

### 🔗 Related Issues

- Enhanced admin control over rate limiting system
- Improved user experience for legitimate high-usage scenarios
- Better administrative tools for customer support

## [v1.0.0] - 2024-11-23

### 🎉 Initial Release

This is the first major release of the P2P File Share application, a complete peer-to-peer file sharing solution with advanced features.

### ✨ Added

#### Core Features

- **P2P File Sharing**: Direct WebRTC-based file transfer between devices worldwide
- **Room-based System**: Simple 8-character room codes for secure file sharing
- **Real-time Progress**: Live transfer progress indicators with speed monitoring
- **Multiple File Support**: Support for all file types including videos, photos, documents
- **Mobile Optimized**: Perfect experience on phones and tablets with PWA support

#### Authentication & User Management

- **User Registration & Login**: Secure JWT-based authentication system
- **Anonymous Access**: Guest users can create/join rooms with daily limits
- **User Profiles**: Avatar upload and profile management
- **Room History**: Persistent room history for logged-in users
- **Session Management**: Secure session handling with automatic reconnection

#### Advanced Rate Limiting & Security

- **Device Fingerprinting**: Enhanced device identification system
- **Network Tracking**: IP-based and device-based limit enforcement
- **Daily Room Limits**: Anonymous users limited to 5 rooms per day
- **Timezone Support**: Configurable timezone-aware daily limit resets
- **Admin Dashboard**: Comprehensive monitoring and management interface

#### Real-time Features

- **Room Expiration**: Automatic room cleanup after 24 hours
- **Live Countdown Timers**: Real-time display of room expiration and limit resets
- **Transfer Controls**: Pause, resume, and cancel file transfers (for authenticated users)
- **Connection Status**: Live connection status indicators
- **Bulk Operations**: Manage multiple file transfers simultaneously

#### UI/UX Enhancements

- **Responsive Design**: Modern, mobile-first interface
- **Progressive Web App**: Installable as native app on mobile devices
- **Tab-based Interface**: Organized Send/Receive tabs in room view
- **File Management**: Intuitive drag-and-drop with file preview
- **Status Indicators**: Visual feedback for all transfer states
- **Error Handling**: User-friendly error messages and recovery options

### 🔧 Configuration

#### Environment Variables

- **MongoDB Integration**: Full database support with connection string configuration
- **JWT Security**: Configurable JWT secret keys for secure authentication
- **Timezone Configuration**: `TIMEZONE` environment variable for global timezone settings
- **Admin Access**: Configurable admin dashboard password
- **Discord Integration**: Optional Discord webhook notifications for rate limiting
- **Cloudinary Support**: Optional cloud storage for user avatars

#### Supported Timezones

- UTC (default)
- America/New_York (Eastern Time)
- America/Chicago (Central Time)
- America/Denver (Mountain Time)
- America/Los_Angeles (Pacific Time)
- Europe/London (GMT/BST)
- Europe/Paris (CET/CEST)
- Asia/Tokyo (JST)
- Asia/Kolkata (IST)
- Australia/Sydney (AEST/AEDT)

### 🛠️ Technical Implementation

#### Backend Architecture

- **Node.js + Express**: RESTful API server
- **Socket.io**: Real-time WebSocket communication
- **MongoDB + Mongoose**: Database with TTL indexes for automatic cleanup
- **JWT Authentication**: Stateless session management
- **Express Sessions**: Admin dashboard authentication

#### Frontend Technology

- **Vanilla JavaScript**: No external frameworks for optimal performance
- **WebRTC**: Direct peer-to-peer file transfer
- **Progressive Enhancement**: Works without JavaScript (basic functionality)
- **Responsive CSS**: Modern layout with CSS Grid and Flexbox

#### Database Schema

- **Users**: Authentication and profile management
- **Rooms**: Persistent room data with expiration
- **Anonymous Limits**: Device and network-based rate limiting
- **TTL Indexes**: Automatic cleanup of expired data

### 📊 Performance & Limits

#### File Transfer

- **Maximum File Size**: 500MB per file
- **Concurrent Transfers**: Multiple files simultaneously
- **Transfer Speed**: Optimized chunk size for various network conditions
- **Recovery**: Automatic retry mechanisms for failed transfers

#### Rate Limiting

- **Anonymous Users**: 5 rooms per day (resets at timezone-aware midnight)
- **Authenticated Users**: Unlimited room access
- **Device Tracking**: Multiple fingerprinting methods for bypass prevention
- **Network Detection**: IP-based limiting for shared networks

### 🔐 Security Features

#### Data Protection

- **End-to-End Transfer**: Files never stored on servers
- **WebRTC Encryption**: Automatic encryption for all file transfers
- **JWT Security**: Secure token-based authentication
- **Input Validation**: Comprehensive server-side validation

#### Privacy

- **No File Storage**: Files transferred directly between devices
- **Automatic Cleanup**: Room data automatically expires after 24 hours
- **Anonymous Support**: Full functionality without creating accounts
- **Optional Logging**: Minimal logging with configurable levels

### 📱 Browser Support

#### Desktop

- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

#### Mobile

- Chrome Mobile (Android)
- Safari (iOS 11+)
- Firefox Mobile
- Samsung Internet

### 🚀 Deployment

#### Platform Support

- **Heroku**: One-click deployment support
- **Vercel**: Serverless deployment ready
- **Railway**: Container deployment
- **DigitalOcean**: App Platform compatible
- **AWS**: Elastic Beanstalk support

#### Docker

- Containerized deployment with MongoDB
- Environment variable configuration
- Health checks and graceful shutdown

### 📚 Documentation

#### Setup Guides

- `README.md`: Comprehensive setup and usage guide
- `AUTH_README.md`: Authentication system documentation
- `ADMIN_MONITORING.md`: Admin dashboard guide
- `DISCORD_SETUP.md`: Discord integration setup
- `CLOUDINARY_SETUP.md`: Cloud storage configuration
- `TIME_LIMITED_ROOMS.md`: Room expiration documentation
- `ANONYMOUS_LIMITATIONS.md`: Rate limiting explanation

#### Configuration Files

- `.env.example`: Complete environment variable template
- `package.json`: Dependency and script management
- `manifest.json`: PWA configuration

### 🏗️ Development

#### Scripts

- `npm start`: Production server
- `npm run dev`: Development with nodemon
- File-based utilities for testing and database management

#### Architecture

- **Modular Design**: Separated concerns with utils, middleware, models
- **Error Handling**: Comprehensive error catching and user feedback
- **Logging**: Configurable log levels for different environments
- **Testing**: Built-in utilities for rate limiting and Discord testing

---

### 📝 Notes

This release represents a complete, production-ready file sharing solution with enterprise-grade features including user management, rate limiting, admin monitoring, and comprehensive security measures. The application is designed to scale from personal use to multi-user deployments with full customization options.

### 🔗 Links

- [Repository](https://github.com/Maccroe/shareupbackup)
- [Documentation](README.md)
- [Issue Tracker](https://github.com/Maccroe/shareupbackup/issues)
