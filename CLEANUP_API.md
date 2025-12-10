# Auto-Cleanup API Reference

## Internal Service APIs

### `initializeCleanupService(logger)`

Initializes and starts the cleanup scheduler on server startup.

**Parameters:**

- `logger` (Object) - Logger instance from server

**Returns:** void

**Usage:**

```javascript
const { initializeCleanupService } = require("./utils/cleanup");

initializeCleanupService(logger);
```

**Called in:** `server.js` (line 478) - runs on MongoDB connection

**Example Log Output:**

```
⏰ Initializing auto-cleanup service...
✅ Auto-cleanup service initialized. Schedule: 0 2 * * *
ℹ️  Accounts deactivated for 90+ days will be permanently deleted
```

---

### `stopCleanupService(logger)`

Stops the cleanup scheduler gracefully.

**Parameters:**

- `logger` (Object) - Logger instance from server

**Returns:** void

**Usage:**

```javascript
const { stopCleanupService } = require("./utils/cleanup");

stopCleanupService(logger);
```

**Called in:** `server.js` (graceful shutdown)

**Example Log Output:**

```
✅ Cleanup service stopped
```

---

### `runCleanup(logger)`

Executes the cleanup process immediately.

**Parameters:**

- `logger` (Object) - Logger instance from server

**Returns:** Promise<void>

**Usage:**

```javascript
const { runCleanup } = require("./utils/cleanup");

await runCleanup(logger);
```

**Cleanup Steps:**

1. Find deactivated accounts (90+ days)
2. For each account:
   - Delete avatar from Cloudinary
   - Delete user's rooms
   - Remove user from room participant lists
   - Delete user account
3. Log summary

**Example Log Output:**

```
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

---

### `triggerCleanupManually(logger)`

Manually trigger cleanup for testing/debugging.

**Parameters:**

- `logger` (Object) - Logger instance from server

**Returns:** Promise<void>

**Usage:**

```javascript
const { triggerCleanupManually } = require("./utils/cleanup");

// In a route:
app.get("/admin/cleanup", async (req, res) => {
  await triggerCleanupManually(logger);
  res.json({ message: "Cleanup triggered" });
});

// Or call directly:
await triggerCleanupManually(logger);
```

**Example Log Output:**

```
🔧 Manually triggering cleanup...
🧹 Starting account cleanup process...
...
✅ Cleanup completed in 0.45s
📊 Summary: 1 account deleted, 0 failures
```

---

### `getCleanupStatus()`

Get current cleanup service status.

**Parameters:** none

**Returns:**

```javascript
{
  isRunning: Boolean,      // Is cleanup currently executing?
  schedule: String,        // Cron schedule (e.g., "0 2 * * *")
  deactivationPeriodDays: Number,  // Days before deletion (e.g., 90)
  lastRun: Date|null       // Last execution time (can be enhanced)
}
```

**Usage:**

```javascript
const { getCleanupStatus } = require("./utils/cleanup");

const status = getCleanupStatus();
console.log(status);
// {
//   isRunning: false,
//   schedule: '0 2 * * *',
//   deactivationPeriodDays: 90,
//   lastRun: null
// }
```

---

## REST API Endpoints

### DELETE `/api/auth/account`

Delete user account (soft delete with deactivation timestamp).

**Authentication:** Required (Bearer token)

**Request Body:**

```json
{
  "password": "user_password"
}
```

**Response (Success - 200):**

```json
{
  "success": true,
  "message": "Account deleted successfully"
}
```

**Response (Missing Password - 400):**

```json
{
  "error": "Password is required to delete account"
}
```

**Response (Wrong Password - 401):**

```json
{
  "error": "Password is incorrect"
}
```

**Response (Server Error - 500):**

```json
{
  "error": "Internal server error during account deletion"
}
```

**Example cURL:**

```bash
curl -X DELETE http://localhost:3000/api/auth/account \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGc..." \
  -d '{"password":"userpassword"}'
```

**Example JavaScript:**

```javascript
const response = await fetch("/api/auth/account", {
  method: "DELETE",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  },
  body: JSON.stringify({ password: "userpassword" }),
});

const data = await response.json();
if (response.ok) {
  console.log("Account deleted:", data.message);
} else {
  console.error("Error:", data.error);
}
```

**Database Changes:**

- Sets `isActive` to `false`
- Sets `deactivatedAt` to current timestamp
- Saves user document

**Timeline:**

- **Day 0**: Account deactivated
- **Days 1-89**: Grace period (data preserved)
- **Day 90+**: Auto-cleanup deletes account permanently

---

## Configuration API

### Settings in `utils/cleanup.js`

```javascript
// Line 6: Deactivation period (days before permanent deletion)
const DEACTIVATION_PERIOD_DAYS = 90;

// Line 7: Cron schedule for cleanup job
const CLEANUP_SCHEDULE = "0 2 * * *"; // Daily at 2 AM

// Line 8: Check interval for development/testing
const CLEANUP_CHECK_INTERVAL = 3600000; // 1 hour (not currently used)
```

### Cron Schedule Syntax

`minute hour day month dayOfWeek`

**Examples:**

```javascript
"0 2 * * *"; // Daily at 2:00 AM
"0 0 * * *"; // Daily at midnight
"0 */6 * * *"; // Every 6 hours
"0 0 * * 0"; // Every Sunday at midnight
"30 2 1 * *"; // 1st of each month at 2:30 AM
"0 3 * * 1-5"; // Weekdays at 3:00 AM
```

### Environment Variables

```bash
# Required for cleanup
MONGODB_URI=mongodb://localhost:27017/shareup
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Optional
LOG_LEVEL=normal  # 'minimal', 'normal', or 'verbose'
TIMEZONE=UTC      # Server timezone for schedule
```

---

## Database Query Reference

### Find Deactivated Accounts

```javascript
// MongoDB query
db.users.find({
  isActive: false,
  deactivatedAt: { $exists: true, $ne: null },
});

// Mongoose query
User.find({
  isActive: false,
  deactivatedAt: { $ne: null },
});
```

### Find Accounts Eligible for Cleanup

```javascript
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - 90);

// MongoDB query
db.users.find({
  isActive: false,
  deactivatedAt: { $lt: ISODate("2025-09-11T00:00:00Z") },
});

// Mongoose query
User.find({
  isActive: false,
  deactivatedAt: { $lt: cutoffDate },
});
```

### Calculate Days Until Cleanup

```javascript
const user = await User.findById(userId);

if (!user.isActive && user.deactivatedAt) {
  const daysSinceDeactivation = Math.floor(
    (Date.now() - user.deactivatedAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  const daysUntilCleanup = 90 - daysSinceDeactivation;
  console.log(`Days until cleanup: ${daysUntilCleanup}`);
}
```

---

## Error Handling

### Common Errors

**Error: node-cron not installed**

```
Cannot find module 'node-cron'
```

**Solution:** Run `npm install node-cron`

**Error: Cleanup fails to delete avatar**

```
⚠️  Could not delete avatar from Cloudinary: [error]
```

**Solution:**

- Verify Cloudinary credentials
- Check network connectivity
- Account deletion continues anyway (non-blocking)

**Error: Cleanup already running**

```
⚠️  Cleanup already running, skipping this cycle
```

**Solution:** Normal race condition prevention. Next cycle will retry.

**Error: MongoDB connection lost**

```
❌ Cleanup process failed: [error message]
```

**Solution:** Check MongoDB connection status

---

## Monitoring & Logs

### Key Log Messages

**Startup:**

```
⏰ Initializing auto-cleanup service...
✅ Auto-cleanup service initialized. Schedule: 0 2 * * *
ℹ️  Accounts deactivated for 90+ days will be permanently deleted
```

**During Cleanup:**

```
🧹 Starting account cleanup process...
📅 Cleanup cutoff date: 2025-09-11T02:00:00.000Z
📊 Found X accounts eligible for cleanup
🗑️  Cleaning up user: username
✅ Cleanup completed in Xs
📊 Summary: X accounts deleted, X failures
```

**Shutdown:**

```
Shutting down gracefully...
✅ Cleanup service stopped
Server closed
```

### Log Levels

```
LOG_LEVEL=minimal   // Only essential messages and errors
LOG_LEVEL=normal    // Essential + info messages (default)
LOG_LEVEL=verbose   // All messages including verbose logs
```

---

## Performance Considerations

### Database Queries

- Uses indexed query: `{ isActive: 1, deactivatedAt: 1 }`
- Recommended index: `db.users.createIndex({ isActive: 1, deactivatedAt: 1 })`

### Cleanup Performance

- Single thread execution (isCleanupRunning flag prevents race conditions)
- Serial deletion (one account at a time)
- Typical performance: 1-2 seconds per account
- Average cleanup time: 10-30 seconds per cycle (depending on account count)

### Resource Usage

- Memory: Minimal (streams results from MongoDB)
- CPU: Moderate during cleanup
- Network: Cloudinary API calls for avatar deletion
- Storage: Removes data from database

---

## Testing Checklist

- [ ] `npm install node-cron` completes successfully
- [ ] Server starts with cleanup initialization message
- [ ] Create test user and delete account
- [ ] Verify `deactivatedAt` is set in database
- [ ] Manually set `deactivatedAt` to 91+ days ago
- [ ] Call `triggerCleanupManually()` or wait for scheduled time
- [ ] Verify account is permanently deleted
- [ ] Check logs for cleanup messages
- [ ] Verify avatar is deleted from Cloudinary
- [ ] Verify rooms are deleted from database

---

## Deployment Notes

### Pre-Deployment

- [ ] Test cleanup with realistic account data
- [ ] Verify Cloudinary credentials configured
- [ ] Review LOG_LEVEL setting
- [ ] Set correct TIMEZONE for cleanup schedule
- [ ] Backup database before first deployment

### Post-Deployment

- [ ] Monitor logs for cleanup execution
- [ ] Verify cleanup runs at scheduled time
- [ ] Check for errors in cleanup logs
- [ ] Set up alerting for cleanup failures
- [ ] Document cleanup schedule in runbook

### Rollback

If cleanup causes issues:

1. Stop server
2. Revert to previous code
3. Set `isActive: false` accounts back to `true` (if needed)
4. Clear `deactivatedAt` field
5. Restart server

---

## Migration Guide (If Updating)

If you're adding cleanup to existing system:

```javascript
// Backfill deactivatedAt for existing deactivated accounts
db.users.updateMany(
  {
    isActive: false,
    deactivatedAt: null,
  },
  {
    $set: {
      deactivatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    },
  }
);
```

This sets deletion date to 90 days ago, making accounts eligible for immediate cleanup.
