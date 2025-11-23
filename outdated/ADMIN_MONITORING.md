# ShareUp Admin Monitoring Guide

## Overview

ShareUp now includes comprehensive monitoring for anonymous user rate limiting. This allows administrators to view which devices and IP addresses are being rate-limited when they exceed the free tier daily room creation limit.

## Features

### 🔍 **Rate Limiting Monitoring**

- Track anonymous users hitting the 3 rooms/day limit
- View device fingerprints and IP addresses
- Monitor bypass attempts using related fingerprints
- See detailed device information (OS, browser, network, etc.)

### 📊 **Admin Dashboard**

- Real-time statistics on blocked devices
- User-friendly interface showing blocked devices
- Auto-refresh every 30 seconds
- Mobile-responsive design
- **Device Management**: Unblock individual devices with one-click removal

### 🚨 **Enhanced Logging**

- Detailed console logs when rate limits are reached
- Warning messages when users approach the limit
- Bypass attempt detection and logging

## Accessing the Admin Dashboard

### 🔐 **Authentication Required**

The admin dashboard is now password protected for security. You need to authenticate before accessing the monitoring features.

**Default Credentials:**

- Password: `shareup_admin_2025` (configurable via ADMIN_PASSWORD environment variable)

### Web Interface

1. Visit: `http://localhost:3000/admin`
2. Enter the admin password when prompted
3. Click "Login" or press Enter

**Session Management:**

- Login sessions last for 24 hours
- Automatic logout on session expiry
- Manual logout button available in the dashboard
- Sessions persist across browser tabs

**Security Features:**

- Password-based authentication
- Session-based access control
- Automatic redirect to login on unauthorized access
- Protected API endpoints

The dashboard shows:

- **Total Blocked Devices**: Number of unique device fingerprints that hit the limit today
- **Unique IPs**: Number of different IP addresses involved
- **Total Room Attempts**: Sum of all room creation attempts from rate-limited devices
- **Device Details**: Comprehensive information about each blocked device

### API Endpoint

**GET** `/api/admin/blocked`

Returns JSON data with blocked devices:

```json
{
  "success": true,
  "totalBlocked": 2,
  "totalUniqueIPs": 4,
  "totalRoomAttempts": 6,
  "blockedDevices": [
    {
      "fingerprint": "device_fingerprint_hash",
      "count": 3,
      "limit": 3,
      "date": "Thu Jan 02 2025",
      "ips": ["192.168.1.100", "192.168.1.101"],
      "metadata": {
        "network": "network_fingerprint",
        "device": "device_fingerprint",
        "os": "Windows 10",
        "browser": "Chrome 120",
        "language": "en-US",
        "userAgent": "Mozilla/5.0...",
        "relatedFingerprints": ["related_fingerprint_1"]
      }
    }
  ]
}
```

## Console Logging

The system provides enhanced logging for monitoring rate limiting:

### Rate Limit Reached

```
🚫 RATE LIMIT REACHED - Anonymous user blocked:
   Fingerprint: abc123def456
   IP Address: 192.168.1.100
   Device: Windows 10/Chrome 120
   Network: network_fingerprint_xyz
   Usage: 3/3 rooms
   Related fingerprints: 2
   User Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)...
```

### Approaching Limit

```
⚠️  APPROACHING LIMIT: Anonymous user abc123def456 used 2/3 daily rooms (Device: Windows 10/Chrome 120) - 1 rooms remaining
```

### Normal Usage

```
Anonymous user abc123def456 used 1/3 daily rooms (Device: Windows 10/Chrome 120)
```

## Device Fingerprinting

The system uses multiple fingerprinting techniques to prevent abuse:

1. **Primary Fingerprint**: Based on IP, user agent, and browser characteristics
2. **Network Fingerprint**: Tracks network-level patterns
3. **Device Fingerprint**: Hardware and software signatures
4. **Related Fingerprints**: Detects attempts to bypass limits

## Testing

### Generate Test Data

```bash
node test-admin-data.js
```

This creates sample blocked devices for testing the admin dashboard.

### Clean Test Data

```bash
node test-admin-data.js clean
```

This removes all test device records.

## Security Notes

- The admin dashboard has no authentication in this basic implementation
- Consider adding authentication for production deployments
- Device fingerprints are anonymized and do not contain personally identifiable information
- IP addresses are logged for rate limiting purposes only

## Rate Limiting Rules

- **Anonymous Users**: 3 rooms per day per device/network combination
- **Logged-in Users**: Unlimited room creation
- **Reset Time**: Daily limits reset at midnight UTC
- **Bypass Detection**: Related fingerprints share the same limit

## Troubleshooting

### No Data Showing

1. Check if the MongoDB connection is working
2. Verify that anonymous users have attempted to create rooms
3. Check the browser console for API errors

### False Positives

- Users sharing the same network may share limits
- Public WiFi networks might cause multiple users to be grouped
- Consider implementing user login for frequent users

### Database Cleanup

The system automatically cleans expired AnonymousLimit records using MongoDB TTL indexes. Records older than 24 hours are automatically removed.

## Device Management

### 🔓 **Unblocking Devices**

Admins can remove rate limits from individual devices directly from the dashboard:

**Dashboard Method:**

1. View blocked devices in the admin dashboard
2. Click the "🔓 Unblock" button next to any device
3. Confirm the action in the dialog
4. Device is immediately unblocked and can create rooms again

**API Method:**

- **DELETE** `/api/admin/blocked/:fingerprint`
- Requires admin authentication
- Returns success confirmation with device details

**Use Cases for Unblocking:**

- False positives from shared networks
- Legitimate users incorrectly rate-limited
- Testing and development purposes
- Customer support requests

**Security Note:** All unblock actions are logged to the console for audit purposes.
