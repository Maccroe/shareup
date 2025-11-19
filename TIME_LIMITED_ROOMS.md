# Time-Limited Rooms for Anonymous Users

## Feature Overview

Anonymous users can now create rooms with a **2-minute time limit**. After expiration, they see a popup encouraging them to login for unlimited room access.

## How It Works

### For Anonymous Users

1. **Create Room** → Room expires in 2 minutes
2. **Timer Display** → Live countdown shows remaining time
3. **Auto-Expiration** → Room automatically deletes after 2 minutes
4. **Login Popup** → Modal appears encouraging registration/login

### For Logged-in Users

- **Unlimited Time** → No room expiration
- **Full Features** → All functionality without restrictions

## Implementation Details

### Backend (server.js)

- **Room Tracking**: Rooms track `isAnonymous` and `expiresAt` fields
- **Auto-Deletion**: setTimeout deletes anonymous rooms after 2 minutes
- **Notifications**: Broadcasts `room-expired` event to all participants

### Frontend Features

- **Live Timer**: Real-time countdown display in room header
- **Warning State**: Timer turns red and pulses under 30 seconds
- **Expiration Modal**: Popup with benefits of registration
- **Seamless UX**: Timer clears automatically on room leave

### Server Console Output

```
Room created: ABC12345 by anonymous (2min limit)
Room created: DEF67890 by username (unlimited)
Anonymous room ABC12345 expired after 2 minutes
Room ABC12345 deleted after expiration
```

## User Experience Flow

### Anonymous User Journey

1. **Visit App** → See login/register buttons (optional)
2. **Create Room** → Room created with 2-minute timer
3. **Use Normally** → Share files, full functionality
4. **Timer Warning** → See countdown, red pulsing under 30s
5. **Room Expires** → Popup appears with login benefits
6. **Auto-Redirect** → After 3 seconds, automatically returns to home page
7. **Two Options**:
   - **Login/Register** → Get unlimited rooms (redirects to home first)
   - **Continue Anonymous** → Return to home screen immediately

### Benefits Highlighted in Popup

- ✅ Create rooms without time limits
- ✅ Track your room history
- ✅ Customize your profile

## Technical Features

### Timer Display

- Shows in room header as: "🕐 Room expires in: 1:30"
- Updates every second
- Automatically hidden for logged-in users
- Warning style (red + pulse) under 30 seconds

### Room Management

- **Server-side enforcement** → Cannot be bypassed by client
- **Graceful cleanup** → 5-second delay after notification for UX
- **Memory efficient** → Automatic cleanup prevents memory leaks

### Modal Integration

- **Smooth transition** → Expired popup → Login modal
- **Auto-redirect** → Users automatically return to home page after 3 seconds
- **Skip option** → Users can continue anonymous if desired
- **State cleanup** → WebRTC connections and file transfers properly cleaned up
- **No data loss** → Transfers in progress are handled gracefully

## Testing

### Anonymous User Test

1. Visit app without logging in
2. Click "Create Room"
3. Observe 2-minute timer in room header
4. Wait for expiration or create short test timer
5. See expiration popup with login benefits

### Logged-in User Test

1. Register/login to account
2. Create room → No timer appears
3. Room persists indefinitely
4. Normal cleanup still works (24h server cleanup)

## Benefits

### For Users

- **Try before commit** → Experience app before registering
- **Clear value prop** → See benefits of registration
- **No forced signup** → Can continue anonymous

### For App

- **Encourages registration** → Clear incentive to sign up
- **Resource management** → Prevents abandoned room buildup
- **Conversion funnel** → Natural upgrade path

The feature balances free access with gentle encouragement toward registration, providing clear value for both anonymous and registered users.
