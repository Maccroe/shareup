# Auto-Cleanup Deployment Checklist

## Pre-Deployment ✅

### Code Review

- [x] Cleanup service created (`utils/cleanup.js`)
- [x] Server integration added (`server.js`)
- [x] Database schema updated (`models/User.js`)
- [x] Auth routes updated (`routes/auth.js`)
- [x] Package.json updated with node-cron
- [x] Graceful shutdown handlers added
- [x] All documentation created

### Testing

- [ ] Run `npm install node-cron` locally
- [ ] Start server and verify logs
- [ ] Test account deletion flow
- [ ] Verify `deactivatedAt` set in database
- [ ] Check cleanup service initialized message
- [ ] Verify logs at INFO level
- [ ] Test with LOG_LEVEL=verbose
- [ ] Test graceful shutdown (Ctrl+C)

### Documentation Review

- [ ] Read CLEANUP_QUICKSTART.md
- [ ] Read AUTO_CLEANUP.md
- [ ] Read CLEANUP_IMPLEMENTATION.md
- [ ] Review CLEANUP_ARCHITECTURE.md
- [ ] Review CLEANUP_API.md
- [ ] Understand configuration options

### Environment Setup

- [ ] Verify MONGODB_URI configured
- [ ] Verify CLOUDINARY_CLOUD_NAME configured
- [ ] Verify CLOUDINARY_API_KEY configured
- [ ] Verify CLOUDINARY_API_SECRET configured
- [ ] Set LOG_LEVEL (minimal, normal, or verbose)
- [ ] Set TIMEZONE (UTC or other)
- [ ] Backup database

### Database Preparation

- [ ] Check MongoDB connection works
- [ ] Verify User collection exists
- [ ] Verify deactivatedAt field added
- [ ] (Optional) Create index: `{ isActive: 1, deactivatedAt: 1 }`
- [ ] Backup database before deployment

---

## Deployment Steps 🚀

### 1. Backup Database

```bash
# Backup your database
mongodump --uri="mongodb://..." --out=/backup/cleanup-deployment
```

### 2. Update Code

```bash
# Pull latest changes
git pull origin main

# Or if manual:
# - Copy updated files
# - Verify all files present
```

### 3. Install Dependencies

```bash
npm install node-cron
```

Verify:

```bash
npm list node-cron
# Should show: node-cron@3.0.3
```

### 4. Verify Configuration

```bash
# Check .env file
cat .env | grep -E "MONGODB|CLOUDINARY|LOG|TIMEZONE"
```

Should show:

```
MONGODB_URI=mongodb://...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
LOG_LEVEL=normal
TIMEZONE=UTC
```

### 5. Create Database Index (Optional but Recommended)

```javascript
// Connect to MongoDB and run:
db.users.createIndex({
  isActive: 1,
  deactivatedAt: 1,
});
```

### 6. Start Server

```bash
npm start
```

Verify logs show:

```
✅ Auto-cleanup service initialized. Schedule: 0 2 * * *
ℹ️  Accounts deactivated for 90+ days will be permanently deleted
```

### 7. Test in Production

- [ ] Test account deletion with test user
- [ ] Verify user is logged out
- [ ] Check MongoDB for `deactivatedAt` timestamp
- [ ] Verify cleanup service is running
- [ ] Check logs at random times

---

## Post-Deployment 📋

### Monitoring

- [ ] Set up log monitoring
- [ ] Monitor cleanup execution daily
- [ ] Check for errors in logs
- [ ] Monitor database size (should decrease after cleanup)
- [ ] Track number of deleted accounts

### First Cleanup Cycle

After deployment, watch the first cleanup:

- [ ] Check logs at scheduled time (2 AM)
- [ ] Verify cleanup started
- [ ] Check number of accounts processed
- [ ] Verify completion message
- [ ] Check for any errors

### User Communication

- [ ] Update privacy policy (if needed)
- [ ] Document account deletion process
- [ ] Inform users of 90-day grace period
- [ ] Document what happens to their data

### Operational Runbook

Document these in your runbook:

- [ ] Where to find cleanup logs
- [ ] How to trigger manual cleanup
- [ ] How to check cleanup status
- [ ] How to recover deleted accounts (if needed)
- [ ] Escalation procedures for failures

---

## Rollback Plan ⚠️

If issues occur:

### 1. Stop Server

```bash
# Stop the running server (Ctrl+C or kill process)
```

### 2. Revert Code

```bash
git revert HEAD
npm install  # Removes node-cron
```

### 3. Restore Database (if needed)

```bash
# If cleanup deleted accounts you wanted to keep
mongorestore /backup/cleanup-deployment
```

### 4. Reactivate Accounts (if needed)

```javascript
// If you need to reactivate deactivated accounts
db.users.updateMany(
  { isActive: false },
  { $set: { isActive: true, deactivatedAt: null } }
);
```

### 5. Restart Server

```bash
npm start
```

---

## Verification Checklist ✅

### Before Going Live

- [ ] Code changes reviewed by team
- [ ] Database backup created
- [ ] All dependencies installed
- [ ] Environment variables configured
- [ ] Logs verify cleanup service initialized
- [ ] Test account deletion works
- [ ] Graceful shutdown tested
- [ ] Rollback plan documented

### After Deployment

- [ ] Server running without errors
- [ ] Cleanup service initialized
- [ ] Logs show expected messages
- [ ] Test users can delete accounts
- [ ] Database reflects changes
- [ ] No error messages in logs
- [ ] Cleanup will run at scheduled time

### During First Cleanup (Day 1 - Time Varies)

- [ ] Cleanup starts at scheduled time
- [ ] Logs show cleanup progress
- [ ] No errors during cleanup
- [ ] Cleanup completes successfully
- [ ] Summary logged correctly

---

## Configuration Summary

### Default Settings

```
Cleanup Schedule: Daily at 2:00 AM
Deactivation Period: 90 days
Grace Period: Days 1-89
Permanent Deletion: Day 90+
Cleanup Status: ENABLED
```

### To Change Schedule

Edit `utils/cleanup.js` line 7:

```javascript
const CLEANUP_SCHEDULE = "0 2 * * *"; // Change this
```

### To Change Period

Edit `utils/cleanup.js` line 6:

```javascript
const DEACTIVATION_PERIOD_DAYS = 90; // Change this
```

---

## Support & Troubleshooting

### Common Issues

**Issue: "Cannot find module 'node-cron'"**

- [ ] Run `npm install node-cron`
- [ ] Verify with `npm list node-cron`

**Issue: "Cleanup service not initializing"**

- [ ] Check MongoDB connection
- [ ] Check server logs for errors
- [ ] Verify node-cron installed

**Issue: "Accounts not deleted after 90 days"**

- [ ] Check MongoDB for deactivatedAt field
- [ ] Verify cleanup schedule is correct
- [ ] Check server logs at cleanup time
- [ ] Manually trigger cleanup to test

**Issue: "Cloudinary avatar not deleted"**

- [ ] Verify Cloudinary credentials
- [ ] Check network connectivity
- [ ] Check logs for specific error
- [ ] Accounts still deleted (avatar deletion is non-blocking)

---

## Maintenance Tasks 🛠️

### Weekly

- [ ] Review cleanup logs
- [ ] Check for any errors
- [ ] Verify no spike in deleted accounts
- [ ] Monitor database size

### Monthly

- [ ] Review cleanup statistics
- [ ] Check deactivated account count
- [ ] Analyze cleanup performance
- [ ] Document any issues

### Quarterly

- [ ] Review and update documentation
- [ ] Update runbook if needed
- [ ] Plan for future improvements
- [ ] Analyze usage patterns

---

## Documentation Deployment

### Update Team Wiki/Docs

- [ ] Deploy AUTO_CLEANUP.md
- [ ] Deploy CLEANUP_QUICKSTART.md
- [ ] Deploy CLEANUP_API.md
- [ ] Deploy CLEANUP_ARCHITECTURE.md
- [ ] Deploy CLEANUP_IMPLEMENTATION.md
- [ ] Deploy CLEANUP_GUIDE.md

### Team Communication

- [ ] Schedule team briefing
- [ ] Walk through documentation
- [ ] Discuss operational procedures
- [ ] Document escalation path
- [ ] Share log monitoring setup

---

## Sign-Off ✍️

- [ ] Development Team: Feature tested and ready
- [ ] QA Team: Testing complete
- [ ] Ops Team: Infrastructure ready
- [ ] Product Team: Informed and approved
- [ ] Security: Reviewed for compliance

---

## Final Verification

Before marking as complete:

```bash
# 1. Verify installation
npm list node-cron

# 2. Verify code changes
grep -r "cleanup" server.js
grep -r "deactivatedAt" models/User.js
grep -r "deactivatedAt" routes/auth.js

# 3. Verify database
# Connect to MongoDB and run:
db.users.findOne() # Should show deactivatedAt field

# 4. Start server and check logs
npm start
# Look for:
# ✅ Auto-cleanup service initialized...
# ℹ️  Accounts deactivated for 90+ days...
```

---

## 🎉 Deployment Complete!

Once all checkboxes are marked and verified, your auto-cleanup feature is ready for production!

**Key Points:**

- ✅ Automatic cleanup runs daily at 2 AM
- ✅ 90-day grace period for data preservation
- ✅ Complete documentation provided
- ✅ Graceful shutdown implemented
- ✅ Full logging and monitoring ready

**Next Steps:**

1. Monitor logs daily for first week
2. Watch for first cleanup execution
3. Document any issues found
4. Share documentation with team
5. Plan for future enhancements

---

## 📞 Support

For questions or issues:

1. Check CLEANUP_QUICKSTART.md
2. Check AUTO_CLEANUP.md troubleshooting
3. Review server logs
4. Check database state
5. Contact development team

---

**Ready to deploy! 🚀**
