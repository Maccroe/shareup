# Auto-Cleanup Quick Start Guide

## ⚡ 5-Minute Setup

### Step 1: Install Dependency

```bash
cd e:\shareup
npm install node-cron
```

### Step 2: Start Server

```bash
npm start
```

You should see:

```
✅ Auto-cleanup service initialized. Schedule: 0 2 * * *
ℹ️  Accounts deactivated for 90+ days will be permanently deleted
```

**That's it!** ✅ Auto-cleanup is now active.

---

## 🔍 Verify Installation

### Check Logs

Look for these messages when server starts:

```
⏰ Initializing auto-cleanup service...
✅ Auto-cleanup service initialized. Schedule: 0 2 * * *
ℹ️  Accounts deactivated for 90+ days will be permanently deleted
```

### Test Delete Account

1. Register a new test account
2. Go to Profile → Delete Account
3. Enter password and confirm
4. Account is now deactivated ✅

---

## ⏰ When Does Cleanup Happen?

- **Default**: Daily at 2:00 AM (server timezone)
- **Deleted**: Accounts inactive for 90+ days
- **Automatic**: No manual intervention needed

### Example Timeline

```
Mon 12:00 - User deletes account
   → isActive = false, deactivatedAt = Mon 12:00

Tue 2:00 AM - Cleanup runs
   → Checks for accounts > 90 days old
   → None deleted (only 1 day)

90 days later (Sat 2:00 AM)
   → Cleanup runs
   → Account found (90+ days old)
   → Account PERMANENTLY DELETED ✅
```

---

## 🎛️ Customize Settings

### Change Cleanup Time

Edit `utils/cleanup.js` line 7:

```javascript
// Change from "0 2 * * *" (2 AM) to "0 0 * * *" (midnight)
const CLEANUP_SCHEDULE = "0 0 * * *";
```

### Change Deactivation Period

Edit `utils/cleanup.js` line 6:

```javascript
// Change from 90 to 30 days
const DEACTIVATION_PERIOD_DAYS = 30;
```

Restart server for changes to take effect.

---

## 📊 What Gets Deleted?

When cleanup runs for a user:

- ✅ User account record
- ✅ Avatar from Cloudinary
- ✅ All rooms created by user
- ✅ User from room participant lists

---

## 🧪 Test Cleanup (Development)

Want to test without waiting 90 days? Manually change the database:

1. **Open MongoDB**

   ```bash
   # Using MongoDB CLI or Compass
   ```

2. **Find a test user** (must have `isActive: false`)

   ```javascript
   db.users.findOne({ username: "testuser" });
   ```

3. **Set deactivatedAt to 91 days ago**

   ```javascript
   db.users.updateOne(
     { username: "testuser" },
     {
       $set: { deactivatedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
     }
   );
   ```

4. **Manually trigger cleanup**

   - Edit `server.js` and temporarily add endpoint:

   ```javascript
   app.get("/test/cleanup", async (req, res) => {
     const { triggerCleanupManually } = require("./utils/cleanup");
     await triggerCleanupManually(logger);
     res.json({ message: "Cleanup triggered" });
   });
   ```

   - Visit: `http://localhost:3000/test/cleanup`
   - Check logs for cleanup process
   - Remove this endpoint before deploying!

---

## ⚠️ Important Notes

### Grace Period (90 days)

- User cannot login
- Data is preserved
- Support can manually restore if needed
- **No automatic recovery after period expires**

### After 90 Days

- Account is **PERMANENTLY DELETED**
- No recovery possible (except database backups)
- User can create new account with same email

### Prerequisites

- MongoDB connected
- Cloudinary credentials configured (for avatar deletion)
- node-cron package installed

---

## 📋 Checklist

- [ ] Run `npm install node-cron`
- [ ] Start server with `npm start`
- [ ] See initialization messages in logs
- [ ] Test account deletion with test user
- [ ] Verify deactivatedAt is set in database
- [ ] Review AUTO_CLEANUP.md for full documentation
- [ ] Deploy to production

---

## 🚨 Troubleshooting

### Cleanup Not Running

**Problem**: Cleanup job never executes
**Solution**:

1. Check server logs for initialization error
2. Verify `npm list node-cron` shows installed
3. Check server timezone is correct
4. Verify MongoDB is connected

### Accounts Not Deleted After 90 Days

**Problem**: Account still in database after 90+ days
**Solution**:

1. Verify `deactivatedAt` is set in database
2. Check `DEACTIVATION_PERIOD_DAYS` setting (default 90)
3. Check server logs - cleanup might be failing
4. Manually check cutoff date calculation

### Avatar Not Deleted

**Problem**: Avatar remains in Cloudinary
**Solution**:

1. Check Cloudinary API credentials in .env
2. Check logs for Cloudinary error (non-blocking)
3. Account will still be deleted even if avatar fails
4. Manually delete from Cloudinary if needed

---

## 📞 Support

For issues:

1. Check server logs for error messages
2. Review `AUTO_CLEANUP.md` troubleshooting section
3. Check database for account status
4. Verify all dependencies installed

---

## 📚 Full Documentation

See these files for complete details:

- **AUTO_CLEANUP.md** - Comprehensive documentation
- **CLEANUP_ARCHITECTURE.md** - System diagrams and architecture
- **CLEANUP_IMPLEMENTATION.md** - Implementation details and changes

---

## ✨ That's It!

Your auto-cleanup system is now:

- ✅ Installed
- ✅ Configured
- ✅ Running
- ✅ Automated
- ✅ Documented

Accounts will be automatically deleted after 90 days of deactivation.
