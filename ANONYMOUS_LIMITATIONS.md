# Anonymous User Limitations

## Overview

Anonymous users now have multiple restrictions to encourage registration while still providing a functional experience. These limitations create a progressive upgrade path that incentivizes users to create accounts.

## Daily Room Limits

### Anonymous Users

- **Maximum rooms per day**: 5 rooms (create + join combined)
- **Tracking method**: Multi-factor fingerprinting to prevent easy bypass
- **Reset time**: Daily at midnight (server time)
- **Error message**: Shows remaining rooms and login benefits
- **Bypass prevention**: Uses IP + User Agent + Accept-Language hash

### Logged-in Users

- **Unlimited rooms**: No daily restrictions
- **Room history**: All rooms tracked in user profile
- **No expiration**: Rooms don't expire automatically

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

- **Full functionality**: No restrictions
- **Better experience**: Faster transfers, unlimited sizes
- **Clear benefits**: Sees value of their account

### For the App

- **Encourages registration**: Clear incentive to sign up
- **Resource management**: Prevents abuse of anonymous access
- **Conversion funnel**: Natural upgrade path

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

The system provides clear differentiation between anonymous and registered users while maintaining core functionality for both user types.
