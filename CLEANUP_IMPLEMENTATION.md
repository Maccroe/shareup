# Auto-Cleanup Implementation Summary

## ⏰ Feature: Automatic Account Deletion After 90 Days of Inactivity

Deleted accounts are now automatically purged from the system after 90 days of deactivation, keeping your database clean while preserving data during a grace period.

---

## 📋 Files Created

### 1. `utils/cleanup.js`

- **Purpose**: Core cleanup service with scheduled job
- **Functions**:

  - `initializeCleanupService(logger)` - Start cleanup scheduler on server startup
  - `runCleanup(logger)` - Execute cleanup process
  - `stopCleanupService(logger)` - Graceful shutdown of cleanup job
  - `triggerCleanupManually(logger)` - Manual cleanup for testing
  - `getCleanupStatus()` - Get cleanup status information

- **Schedule**: Daily at 2 AM (configurable via `CLEANUP_SCHEDULE`)
- **Deactivation Period**: 90 days (configurable via `DEACTIVATION_PERIOD_DAYS`)

---

## 📝 Files Modified

### 2. `package.json`

**Change**: Added `node-cron` dependency

```json
"node-cron": "^3.0.3"
```

**Action Required**: Run `npm install node-cron`

### 3. `server.js`

**Changes**:

1. Added cleanup service import:

   ```javascript
   const {
     initializeCleanupService,
     stopCleanupService,
   } = require("./utils/cleanup");
   ```

2. Initialize cleanup service on startup (after MongoDB connection):

   ```javascript
   try {
     initializeCleanupService(logger);
   } catch (error) {
     console.error("Error initializing cleanup service:", error);
   }
   ```

3. Added graceful shutdown handlers:

   ```javascript
   process.on('SIGINT', () => {
     stopCleanupService(logger);
     server.close(() => { ... });
   });

   process.on('SIGTERM', () => {
     stopCleanupService(logger);
     server.close(() => { ... });
   });
   ```

### 4. `models/User.js`

**Change**: Added `deactivatedAt` field to track when account was deactivated

```javascript
deactivatedAt: {
  type: Date,
  default: null
}
```

### 5. `routes/auth.js`

**Change**: Updated DELETE `/api/auth/account` endpoint to set deactivation timestamp

```javascript
// Before
req.user.isActive = false;
await req.user.save();

// After
req.user.isActive = false;
req.user.deactivatedAt = new Date();
await req.user.save();
```

---

## 🔄 How It Works

### Timeline

```
Day 0: User deletes account
       → isActive = false
       → deactivatedAt = current timestamp

Day 1-89: Grace period
          → Account data preserved
          → User cannot login
          → Support can manually restore if needed

Day 90+: Cleanup job runs (daily at 2 AM)
         → Finds accounts deactivated 90+ days ago
         → Deletes user account
         → Deletes user's rooms
         → Deletes avatar from Cloudinary
         → Removes user from all room participant lists
```

### Cleanup Execution Steps

1. Find all users with `isActive=false` and `deactivatedAt < 90 days ago`
2. For each user:
   - Delete avatar from Cloudinary (if exists)
   - Delete all rooms created by the user
   - Remove user from room participant lists
   - Delete user account from database
3. Log summary (deleted count, failures, execution time)

---

## ✅ Installation Steps

### 1. Install Dependencies

```bash
cd e:\shareup
npm install node-cron
```

### 2. No Migration Needed

- Existing deactivated accounts need `deactivatedAt` field manually set
- New deactivations will automatically record the timestamp
- Cleanup service will only process accounts with both `isActive=false` AND `deactivatedAt` set

### 3. Start Server

```bash
npm start
# or for development
npm run dev
```

You should see:

```
✅ Auto-cleanup service initialized. Schedule: 0 2 * * *
ℹ️  Accounts deactivated for 90+ days will be permanently deleted
```

---

## 🔧 Configuration

### Change Deactivation Period

Edit `utils/cleanup.js`:

```javascript
const DEACTIVATION_PERIOD_DAYS = 30; // Change from 90 to 30 days
```

### Change Cleanup Schedule

Edit `utils/cleanup.js`:

```javascript
const CLEANUP_SCHEDULE = "0 3 * * *"; // Change to 3 AM instead of 2 AM
```

Cron syntax: `minute hour day month dayOfWeek`

- `0 2 * * *` = Every day at 2:00 AM
- `0 */6 * * *` = Every 6 hours
- `0 0 * * 0` = Every Sunday at midnight

---

## 📊 Logging Output

### On Server Startup

```
⏰ Initializing auto-cleanup service...
✅ Auto-cleanup service initialized. Schedule: 0 2 * * *
ℹ️  Accounts deactivated for 90+ days will be permanently deleted
```

### During Cleanup (Daily at 2 AM)

```
🧹 Starting account cleanup process...
📅 Cleanup cutoff date: 2025-09-11T02:00:00.000Z
📊 Found 3 accounts eligible for cleanup
🗑️  Cleaning up user: john_doe (ID: 507f1f77bcf86cd799439011)
  ✓ Deleted avatar from Cloudinary
  ✓ Deleted 2 rooms created by user
  ✓ Removed user from participant lists
  ✓ Deleted user account
🗑️  Cleaning up user: jane_smith (ID: 507f1f77bcf86cd799439012)
  ✓ Deleted avatar from Cloudinary
  ✓ Deleted 1 room created by user
  ✓ Removed user from participant lists
  ✓ Deleted user account
✅ Cleanup completed in 1.23s
📊 Summary: 3 accounts deleted, 0 failures
```

---

## 🧪 Testing

### Manual Cleanup Trigger

You can manually trigger cleanup for testing:

```javascript
// In your route or test script
const { triggerCleanupManually } = require("./utils/cleanup");

app.get("/test/cleanup", async (req, res) => {
  await triggerCleanupManually(logger);
  res.json({ message: "Cleanup triggered" });
});
```

### Test Account Deletion

1. Create a test account
2. Delete the account (now sets `deactivatedAt`)
3. Manually change `deactivatedAt` in database to 91+ days ago
4. Call `/test/cleanup` endpoint
5. Account should be deleted

---

## 📌 Important Notes

### Data Loss Warning ⚠️

After 90 days of deactivation:

- Account is **permanently deleted** from database
- No recovery possible (except from database backups)
- Users cannot recover deleted data

### Existing Deactivated Accounts

For accounts already deactivated before this update:

- They need `deactivatedAt` field set manually
- Run this migration if needed:
  ```javascript
  // In MongoDB
  db.users.updateMany(
    { isActive: false, deactivatedAt: null },
    { $set: { deactivatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }
  );
  ```

### Cloudinary Integration

- Cleanup service requires Cloudinary credentials in `.env`
- If avatar deletion fails, account is still deleted
- Check logs for Cloudinary errors

---

## 🔐 Security

- ✅ Password required to delete account
- ✅ Soft delete initially (90-day grace period)
- ✅ Complete data cleanup after grace period
- ✅ Cloudinary integration for avatar removal
- ✅ Graceful shutdown preserves data integrity

---

## 📚 Documentation

See `AUTO_CLEANUP.md` for comprehensive documentation including:

- Detailed workflow explanation
- Configuration options
- Logging details
- Troubleshooting guide
- Future enhancements

---

## ✨ Summary of Features

| Feature               | Details                                      |
| --------------------- | -------------------------------------------- |
| **Deactivation**      | Soft delete marks account inactive           |
| **Grace Period**      | 90 days to recover if needed                 |
| **Cleanup**           | Automatic deletion after grace period        |
| **Schedule**          | Daily at 2 AM (configurable)                 |
| **Data Cleanup**      | Accounts, rooms, avatars, relationships      |
| **Logging**           | Detailed logs for monitoring                 |
| **Graceful Shutdown** | Cleanup job stops cleanly on server shutdown |
| **Testing**           | Manual trigger available for development     |

---

## 🚀 Ready to Deploy!

The auto-cleanup feature is now fully implemented and ready:

1. ✅ Core cleanup service created
2. ✅ Database schema updated
3. ✅ Backend integration complete
4. ✅ Server startup/shutdown hooks added
5. ✅ Logging integrated
6. ✅ Documentation provided

**Next Steps**:

1. Run `npm install node-cron`
2. Review `AUTO_CLEANUP.md` for details
3. Configure deactivation period if needed
4. Deploy to production
5. Monitor logs for cleanup execution
