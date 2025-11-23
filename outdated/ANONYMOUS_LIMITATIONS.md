# Anonymous User Limitations & Room Management

## Overview

Anonymous users have multiple restrictions to encourage registration while maintaining functionality. The system now includes comprehensive room management with automatic MongoDB cleanup and 24-hour persistence for logged-in users.

## MongoDB Room Storage & Auto-Deletion

### Database Architecture

- **Room Collection**: All rooms are stored in MongoDB with TTL (Time To Live) indexing
- **Automatic Expiration**: MongoDB automatically deletes expired rooms using TTL index
- **Periodic Cleanup**: Server runs cleanup every 5 minutes as backup to TTL
- **Memory + Database**: Rooms stored in both memory (for speed) and MongoDB (for persistence)

### Auto-Deletion System

- **TTL Index**: MongoDB automatically removes expired rooms
- **Server Timers**: Redundant deletion timers for immediate cleanup
- **Startup Cleanup**: Expired rooms cleaned on server restart
- **Graceful Notifications**: Users notified before room deletion

## Daily Room Limits

### Anonymous Users

- **Maximum rooms per day**: 5 rooms (create + join combined)
- **Tracking method**: Multi-factor fingerprinting to prevent easy bypass
- **Reset time**: Daily at midnight (server time)
- **Error message**: Shows remaining rooms and login benefits
- **Bypass prevention**: Uses IP + User Agent + Accept-Language hash

### Logged-in Users

- **Unlimited rooms**: No daily restrictions
- **Room persistence**: Rooms last for 24 hours instead of 2 minutes
- **Room history**: All rooms tracked in user profile
- **Room rejoin**: Can rejoin any room within 24 hours
- **Room deletion**: Creators can delete rooms they created

## Room Duration and Management

### Anonymous Users

- **Room duration**: 2 minutes before automatic expiration
- **No persistence**: Cannot rejoin expired rooms
- **No history**: No record of past rooms
- **No control**: Cannot delete or manage rooms

### Logged-in Users

- **Room duration**: 24 hours before automatic expiration
- **Room history**: Can view all recent rooms with expiration times
- **Rejoin capability**: Can rejoin any room within 24 hours
- **Delete control**: Room creators can delete rooms before expiration
- **Role tracking**: Clear distinction between creators and participants

## File Size Limits

### Anonymous Users

- **Maximum file size**: 30MB per file
- **Error message**: Shows file size and encourages login
- **UI indicator**: Orange notification showing limit

### Logged-in Users

- **Maximum file size**: 500MB per file (unchanged)
- **UI indicator**: Green notification showing unlimited access

## Transfer Speed Limitations

### Anonymous Users

- **Speed throttling**: Very limited at 0.03 MB/s (30 KB/s)
- **Implementation**: 533ms delay between 16KB chunks
- **Visual indicator**: Shows "(very limited speed)" in transfer progress
- **Applies to**: Outgoing transfers only (sending files)

### Logged-in Users

- **Full speed**: No throttling applied
- **No delays**: Immediate chunk transmission
- **Visual indicator**: Normal speed display

## User Experience

### Anonymous User Interface

```
File Drop Zone:
"Anonymous users: 30MB limit per file • Login for unlimited sizes"
(Orange styling)

Transfer Progress:
"2.5 MB/s (limited speed)"
```

### Logged-in User Interface

```
File Drop Zone:
"Logged in: Unlimited file sizes • Full speed transfers"
(Green styling)

Transfer Progress:
"8.2 MB/s"
```

## Implementation Details

### File Validation (`addSelectedFiles`)

- Checks `currentUser` status for limits
- Shows appropriate error messages
- Encourages login for better limits

### Speed Throttling (`sendFile` in WebRTC)

- Applied during chunk transmission
- Uses `setTimeout` with 150ms delay
- Only affects anonymous users
- Only affects outgoing transfers

### UI Updates

- File limit info updates on login/logout
- Speed indicators show throttling status
- Color coding (orange for limited, green for unlimited)

## Technical Implementation

### Backend Changes

- No server-side changes needed
- All enforcement is client-side

### Frontend Changes

1. **File size validation** with user-specific limits
2. **Speed throttling** in WebRTC manager
3. **UI indicators** for limitations
4. **Dynamic updates** on authentication state change

### Throttling Algorithm

```javascript
const throttleDelay = isAnonymous ? 150 : 0; // 150ms for anonymous
// In send loop:
await new Promise((resolve) => setTimeout(resolve, throttleDelay));
```

## Benefits

### For Anonymous Users

- **Still functional**: Can transfer files up to 30MB
- **Clear limitations**: Understands restrictions
- **Clear upgrade path**: Sees benefits of registration

### For Registered Users

- **Full functionality**: No restrictions on files or rooms
- **Better experience**: Faster transfers, unlimited sizes, persistent rooms
- **Room control**: Can manage, rejoin, and delete rooms
- **Clear benefits**: Long-lasting rooms with full management features

### For the App

- **Encourages registration**: Clear incentive to sign up
- **Resource management**: Prevents abuse of anonymous access
- **Conversion funnel**: Natural upgrade path

## Error Messages

### Room Expired (Anonymous)

```
"This room has expired (2 minutes max for anonymous users).
Login for 24-hour room persistence and rejoin capability."
```

### Room Expired (Logged-in)

```
"This room has expired after 24 hours.
Create a new room to continue."
```

### Room Not Found (Rejoin)

```
"Room not found or expired.
Check your room history for active rooms."
```

### Delete Room Confirmation

```
"Are you sure you want to delete this room?
This action cannot be undone."
```

## Error Messages

### File Too Large (Anonymous)

```
"File 'large-video.mp4' (45.2MB) is too large.
Anonymous users are limited to 30MB.
Login for unlimited file sizes."
```

### File Too Large (Logged-in)

```
"File 'huge-file.zip' is too large.
Maximum size is 500MB."
```

## Testing

### Anonymous User Test

1. Create room without logging in
2. Try uploading 30+ MB file → See size limit error
3. Upload smaller file → See throttled speed indicator
4. Observe orange limit notification in UI

### Logged-in User Test

1. Login and create room
2. Upload large files (up to 500MB) → Works normally
3. Observe full speed transfers
4. See green unlimited notification
5. View room history after leaving
6. Rejoin room from history
7. Delete room as creator

### Room Management Test

1. **Database Persistence**: Create room → Room saved in MongoDB with expiration
2. **Auto-Cleanup**: Wait for expiration → Room automatically deleted from database
3. **Server Restart**: Restart server → Expired rooms cleaned on startup
4. **Memory Sync**: Check room history → Only active rooms shown
5. **TTL Verification**: Check MongoDB → Expired documents automatically removed

### Database Verification

You can verify the auto-deletion system by checking the MongoDB collection:

```javascript
// In MongoDB shell
use shareup
db.rooms.find() // See active rooms
db.rooms.getIndexes() // Verify TTL index on expiresAt field
```

The system provides clear differentiation between anonymous and registered users while maintaining core functionality for both user types. **All room data is now properly managed in MongoDB with automatic cleanup.**
