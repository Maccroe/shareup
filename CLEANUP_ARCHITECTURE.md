# Auto-Cleanup System Architecture

## System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER DELETES ACCOUNT                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │  Frontend: deleteAccount() triggered  │
        │  - User enters password              │
        │  - Sends DELETE /api/auth/account    │
        └──────────────────┬───────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │  Backend: DELETE /api/auth/account   │
        │  - Verify password                   │
        │  - Set isActive = false              │
        │  - Set deactivatedAt = NOW()         │
        │  - Save to database                  │
        └──────────────────┬───────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │  Frontend: User logged out           │
        │  - Clear auth token                  │
        │  - Disconnect socket                 │
        │  - Redirect to home                  │
        └──────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
    ┌──────────────────┐    ┌──────────────────────┐
    │  DATABASE STATE  │    │  GRACE PERIOD STARTS │
    │  isActive: false │    │  Duration: 90 days   │
    │  deactivatedAt:  │    │                      │
    │  2024-12-10...   │    │  • Data preserved    │
    └──────────────────┘    │  • No login allowed  │
                            │  • Support can help  │
                            └──────────────────────┘


                    DAILY AT 2:00 AM
                          │
    ┌─────────────────────┴──────────────────────┐
    │    CLEANUP SERVICE RUNS (node-cron)        │
    └─────────────────────┬──────────────────────┘
                          │
                          ▼
    ┌────────────────────────────────────────────┐
    │  Query Database                            │
    │  Find users where:                         │
    │  - isActive = false                        │
    │  - deactivatedAt < 90 days ago             │
    └─────────────────────┬──────────────────────┘
                          │
                  ┌───────┴───────┐
                  │               │
            YES ──▼──         NO──▼──
        ┌──────────────┐  ┌──────────────┐
        │ Users Found? │  │ Log: "No     │
        └──────────────┘  │ accounts to  │
                          │ cleanup"     │
          │               │              │
          ▼               └──────────────┘
    ┌───────────────────────────────────────┐
    │ For Each Deactivated Account:         │
    │                                       │
    │ 1. Delete avatar from Cloudinary      │
    │    └─ Remove CDN reference            │
    │                                       │
    │ 2. Delete user's rooms                │
    │    └─ Clean up room documents         │
    │                                       │
    │ 3. Remove user from room lists        │
    │    └─ Clean up participant refs       │
    │                                       │
    │ 4. Delete user account                │
    │    └─ Remove user document            │
    │                                       │
    │ 5. Log cleanup result                 │
    │    └─ Success or failure              │
    └───────────────────┬───────────────────┘
                        │
                        ▼
    ┌──────────────────────────────────────┐
    │  CLEANUP COMPLETE                    │
    │  - Summary logged                    │
    │  - Account permanently deleted       │
    │  - No recovery possible              │
    │  - User can register new account     │
    └──────────────────────────────────────┘
```

## Server Initialization Flow

```
┌─────────────────────────────────┐
│  Server Starts (server.js)      │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Connect to MongoDB              │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Clean up old anonymous limits   │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Clean up expired rooms          │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Initialize Cleanup Service      │
│ (utils/cleanup.js)              │
│                                 │
│ - Import node-cron              │
│ - Schedule: "0 2 * * *"         │
│ - Period: 90 days               │
│ - Log initialization message    │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Server Ready                    │
│ Listening on port 3000          │
│ Cleanup job waiting...          │
└─────────────────────────────────┘
```

## Graceful Shutdown Flow

```
┌──────────────────────────────┐
│ SIGINT/SIGTERM Received      │
│ (Ctrl+C or Docker stop)      │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│ Stop Cleanup Service         │
│ - Cancel cron schedule       │
│ - Prevent in-flight cleanup  │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│ Close Server                 │
│ - Stop accepting connections │
│ - Close open sockets         │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│ Close MongoDB Connection     │
│ - Graceful disconnect        │
│ - Flush pending operations   │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│ Exit Process (code 0)        │
│ Clean shutdown complete ✅   │
└──────────────────────────────┘
```

## Data Lifecycle

```
Timeline: User Account

Day 0:  Account Active
        ├─ isActive: true
        ├─ deactivatedAt: null
        └─ Status: ACTIVE ✅

         User Deletes Account
        ┌─ DELETE request sent
        ├─ Password verified
        └─ Soft delete initiated

         Account Deactivated
        ├─ isActive: false
        ├─ deactivatedAt: 2024-12-10T10:30:00Z
        └─ Status: DEACTIVATING 🔄

Days 1-89: Grace Period
        ├─ Data preserved in database
        ├─ User cannot login
        ├─ Rooms still in database
        └─ Status: GRACE_PERIOD ⏳

Day 90: Cleanup Job Runs
        ├─ Query finds eligible accounts
        ├─ Start deletion process
        ├─ Delete avatar
        ├─ Delete rooms
        ├─ Delete account
        └─ Status: DELETING 🗑️

After Day 90: Account Gone
        ├─ User record deleted
        ├─ Rooms deleted
        ├─ Avatar deleted
        ├─ No recovery possible
        └─ Status: DELETED ✓
```

## Database Schema Changes

```
User Collection:
─────────────────────────────────────
{
  _id: ObjectId,
  username: String,
  email: String,
  password: String (hashed),
  isActive: Boolean,

  // NEW FIELD
  ┌─ deactivatedAt: Date | null ──┐
  │                                │
  │ Set when account deleted       │
  │ Used for cleanup calculation   │
  │ null = account is active       │
  │ date = account deactivated     │
  └────────────────────────────────┘

  avatar: String,
  avatarPublicId: String,
  subscription: {
    plan: String,
    status: String,
    startDate: Date,
    endDate: Date
  },
  rooms: Array,
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date
}

Index for Performance:
──────────────────────
db.users.createIndex({
  "isActive": 1,
  "deactivatedAt": 1
})
```

## Environment Configuration

```
.env
────────────────────────────────────
# Existing variables
MONGODB_URI=mongodb://...
PORT=3000
LOG_LEVEL=normal
TIMEZONE=UTC

# Cleanup configuration (in code, modify cleanup.js)
DEACTIVATION_PERIOD_DAYS=90    # Set in cleanup.js
CLEANUP_SCHEDULE='0 2 * * *'   # Set in cleanup.js

# Required for cleanup to work
CLOUDINARY_CLOUD_NAME=...      # For avatar deletion
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

## Monitoring & Alerts

```
Log Monitoring:
───────────────
✅ Service initialized
   ↓
🧹 Cleanup process started
   ↓
📅 Cutoff date calculated
   ↓
📊 Eligible accounts found
   ↓
🗑️  Cleaning up user
   ↓
✓ Account deleted
   ↓
✅ Cleanup completed
   ↓
📊 Summary logged

Alert Conditions:
─────────────────
⚠️  Cleanup already running (race condition)
❌ Account deletion failed (logged)
❌ Avatar deletion failed (non-blocking)
❌ Cleanup process crashed (catch error)
```

## File Structure

```
shareup/
├── utils/
│   └── cleanup.js                    ← NEW cleanup service
│       ├── initializeCleanupService()
│       ├── runCleanup()
│       ├── stopCleanupService()
│       ├── triggerCleanupManually()
│       └── getCleanupStatus()
│
├── models/
│   └── User.js                      ← MODIFIED (added deactivatedAt)
│
├── routes/
│   └── auth.js                      ← MODIFIED (set deactivatedAt)
│
├── server.js                         ← MODIFIED (init cleanup, graceful shutdown)
│
├── package.json                      ← MODIFIED (added node-cron)
│
├── AUTO_CLEANUP.md                   ← NEW comprehensive documentation
│
└── CLEANUP_IMPLEMENTATION.md         ← NEW implementation summary
```
