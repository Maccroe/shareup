# Auto-Cleanup Service Documentation

## Overview

The auto-cleanup service automatically deletes user accounts that have been deactivated for 90 days. This feature ensures your database stays clean while giving users a grace period to reactivate their accounts if they change their mind.

## How It Works

### Timeline

1. **User Deletes Account**: Account is marked as `isActive: false` and `deactivatedAt` is set to current timestamp
2. **Deactivation Period**: Account remains in the database for 90 days (configurable)
3. **Auto-Cleanup**: After 90 days, the account and all associated data are permanently deleted

### What Gets Deleted

When an account is permanently deleted:

- ✅ User account record
- ✅ Avatar from Cloudinary (if exists)
- ✅ All rooms created by the user
- ✅ User removed from all room participant lists
- ✅ All authentication tokens and sessions cleared

### Configuration

The cleanup service is configured in `utils/cleanup.js`:

```javascript
// Delete accounts deactivated for 90 days
const DEACTIVATION_PERIOD_DAYS = 90;

// Run daily at 2 AM
const CLEANUP_SCHEDULE = "0 2 * * *";
```

To modify the cleanup period, edit `DEACTIVATION_PERIOD_DAYS` in `utils/cleanup.js`:

```javascript
const DEACTIVATION_PERIOD_DAYS = 30; // Delete after 30 days instead
```

## Implementation Details

### Frontend Changes

**File**: `public/js/app.js`

The `deleteAccount()` function:

- Prompts user for password confirmation
- Sends DELETE request to `/api/auth/account`
- Clears authentication data
- Logs user out automatically
- Records deactivation timestamp

### Backend Changes

#### Database Schema

**File**: `models/User.js`

Added new field to track deactivation:

```javascript
deactivatedAt: {
  type: Date,
  default: null
}
```

#### Account Deletion Endpoint

**File**: `routes/auth.js`

Updated DELETE `/api/auth/account` endpoint:

```javascript
// Soft delete - deactivate the account and record deactivation timestamp
req.user.isActive = false;
req.user.deactivatedAt = new Date();
await req.user.save();
```

#### Cleanup Service

**File**: `utils/cleanup.js`

Provides:

- `initializeCleanupService(logger)` - Starts the cleanup scheduler
- `runCleanup(logger)` - Executes cleanup process
- `stopCleanupService(logger)` - Stops the scheduler
- `triggerCleanupManually(logger)` - Manual cleanup trigger (testing)
- `getCleanupStatus()` - Returns cleanup status

#### Server Integration

**File**: `server.js`

Changes:

- Imports cleanup service
- Initializes cleanup service on startup
- Graceful shutdown handling (stops cleanup job on server shutdown)

### Cleanup Process

The cleanup runs daily at 2 AM (configurable via `CLEANUP_SCHEDULE`):

1. **Find Eligible Accounts**

   ```javascript
   const cutoffDate = new Date();
   cutoffDate.setDate(cutoffDate.getDate() - 90);

   const deactivatedUsers = await User.find({
     isActive: false,
     deactivatedAt: { $lt: cutoffDate },
   });
   ```

2. **Delete Each Account**

   - Delete avatar from Cloudinary
   - Delete all rooms created by user
   - Remove user from room participant lists
   - Delete user account

3. **Log Summary**
   - Records number of deleted accounts
   - Logs any failures
   - Reports total execution time

## Logging

The cleanup service uses the server's logging system. Log messages include:

```
✅ Auto-cleanup service initialized. Schedule: 0 2 * * *
ℹ️  Accounts deactivated for 90+ days will be permanently deleted
🧹 Starting account cleanup process...
📅 Cleanup cutoff date: 2025-09-11T02:00:00.000Z
📊 Found 3 accounts eligible for cleanup
🗑️  Cleaning up user: john_doe (ID: 507f1f77bcf86cd799439011)
  ✓ Deleted avatar from Cloudinary
  ✓ Deleted 2 rooms created by user
  ✓ Removed user from participant lists
  ✓ Deleted user account
✅ Cleanup completed in 1.23s
📊 Summary: 3 accounts deleted, 0 failures
```

## User Experience

### After Account Deletion

1. User receives confirmation: "Account deleted successfully. Redirecting..."
2. User is automatically logged out
3. User is redirected to home screen
4. User can create a new account after 90 days if previous account was deleted

### Grace Period

During the 90-day grace period:

- ❌ User cannot login
- ❌ User cannot access rooms
- ✅ Account data is preserved
- ✅ Data can be recovered if user contacts support (manual admin intervention)

### After 90 Days

- ✅ Account permanently deleted
- ✅ All data removed
- ⚠️ No recovery possible (except from backups)
- ✅ User can register new account with same email/username

## Security Considerations

1. **Password Required**: Account deletion requires password confirmation
2. **Soft Delete**: Initial deletion is non-destructive (data preserved)
3. **Grace Period**: 90-day window allows for manual recovery
4. **Cloudinary Cleanup**: Avatars removed from CDN
5. **Associated Data**: All related rooms and relationships cleaned up

## Database Indexes

The cleanup queries use these indexes for performance:

- `{ isActive: 1, deactivatedAt: 1 }`

Consider adding this index to your database for optimal performance:

```javascript
userSchema.index({ isActive: 1, deactivatedAt: 1 });
```

## Dependencies

- **node-cron**: ^3.0.3 - For scheduling cleanup tasks
- **mongoose**: ^8.20.0 - Already in project
- **cloudinary**: ^2.8.0 - Already in project

## Testing/Manual Cleanup

To manually trigger cleanup (for testing):

```javascript
const { triggerCleanupManually } = require("./utils/cleanup");

// In your route or endpoint:
await triggerCleanupManually(logger);
```

## Graceful Shutdown

The server handles graceful shutdown:

```javascript
process.on("SIGINT", () => {
  stopCleanupService(logger); // Stops cleanup scheduler
  server.close(); // Closes server
  process.exit(0);
});
```

## Monitoring

Monitor cleanup performance:

- Check logs for cleanup start/end times
- Monitor database for account deletion patterns
- Set alerts for cleanup failures
- Track number of accounts deleted per cycle

## Future Enhancements

Potential improvements:

1. Email notification before deletion (30 days before)
2. Account reactivation endpoint
3. Cleanup customization per account (admin panel)
4. Cleanup history/audit log
5. Batch deletion with rate limiting
6. Account recovery API (within grace period)

## Troubleshooting

### Cleanup Not Running

- Check server logs for initialization errors
- Verify `node-cron` is installed: `npm list node-cron`
- Check server timezone settings
- Verify MongoDB connection is active

### Cleanup Fails

- Check MongoDB connection status
- Verify Cloudinary credentials if avatar deletion fails
- Check logs for specific error messages
- Ensure sufficient disk space

### Account Not Deleted After 90 Days

- Check if `deactivatedAt` is set in database
- Verify `DEACTIVATION_PERIOD_DAYS` setting
- Check if cleanup job is running (check logs)
- Manually verify cutoff date calculation

## Support

For issues with the auto-cleanup service:

1. Check the server logs for error messages
2. Verify MongoDB connectivity
3. Check database for account status
4. Contact system administrator if needed
