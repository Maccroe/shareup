# ShareUp Premium Plan

## Overview

ShareUp now offers a Premium subscription plan that provides enhanced features for power users who need to transfer large files at high speeds.

## Plan Comparison

### Anonymous Users

- ❌ 5 rooms per day limit
- ❌ 2-minute room expiration
- ❌ 30MB file size limit
- ❌ Very limited transfer speed (0.03 MB/s)
- ❌ No transfer controls
- ❌ No room history

### Free Account Users

- ✅ Unlimited rooms per day
- ✅ 24-hour room persistence
- ✅ 500MB file size limit
- ✅ Full speed transfers
- ✅ Transfer controls (pause/resume/cancel)
- ✅ Room history & rejoin
- ✅ Custom avatar
- ✅ Secure JWT authentication

### Premium Users 👑

- ✅ **Everything in Free Account, PLUS:**
- 🚀 **10GB file size limit** (20x larger than free)
- ⚡ **High-speed transfers** (unlimited bandwidth priority)
- ⭐ **Priority support**
- 🎯 **Enhanced reliability**

## Technical Implementation

### Database Schema

```javascript
subscription: {
  plan: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free'
  },
  startDate: Date,
  endDate: Date,
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled'],
    default: 'active'
  }
}
```

### User Model Methods

- `isPremium()` - Check if user has active premium subscription
- `getFileSizeLimit()` - Returns 10GB for premium, 500MB for free
- `getTransferSpeedTier()` - Returns 'high' for premium, 'standard' for free

### API Endpoints

#### Get Subscription Info

```
GET /api/auth/subscription
Authorization: Bearer <token>
```

Response:

```json
{
  "success": true,
  "subscription": {
    "plan": "premium",
    "startDate": "2025-11-24T00:00:00.000Z",
    "endDate": "2025-12-24T00:00:00.000Z",
    "status": "active"
  },
  "isPremium": true,
  "fileSizeLimit": 10737418240,
  "transferSpeedTier": "high"
}
```

#### Upgrade to Premium

```
POST /api/auth/subscription/upgrade
Authorization: Bearer <token>
```

Response:

```json
{
  "success": true,
  "message": "Upgraded to premium successfully",
  "subscription": {...},
  "isPremium": true
}
```

#### Cancel Premium

```
POST /api/auth/subscription/cancel
Authorization: Bearer <token>
```

## Frontend Integration

### File Size Validation

```javascript
const isPremium =
  currentUser?.subscription?.plan === "premium" &&
  currentUser?.subscription?.status === "active";
const maxFileSize = isPremium
  ? 10 * 1024 * 1024 * 1024
  : currentUser
  ? 500 * 1024 * 1024
  : 30 * 1024 * 1024;
```

### UI Indicators

- Premium badge in file limit info bar
- Gold gradient styling for premium users
- Enhanced comparison page with 3-tier layout

## Future Enhancements

### Payment Integration

- Stripe/PayPal integration for subscription payments
- Automatic renewal handling
- Invoice generation

### Advanced Features

- Custom branding options
- Advanced analytics
- API access
- Webhook notifications
- Team/organization plans

### Pricing Model (To Be Implemented)

- Monthly: $9.99/month
- Annual: $99.99/year (save 17%)
- Lifetime: $299.99 (one-time payment)

## Testing

### Manually Upgrade User to Premium

```javascript
// In MongoDB or via admin panel
db.users.updateOne(
  { username: "testuser" },
  {
    $set: {
      "subscription.plan": "premium",
      "subscription.startDate": new Date(),
      "subscription.endDate": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      "subscription.status": "active",
    },
  }
);
```

### Test API Endpoints

```bash
# Get subscription
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/auth/subscription

# Upgrade to premium
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/auth/subscription/upgrade

# Cancel premium
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/auth/subscription/cancel
```

## Files Modified

### Models

- `models/User.js` - Added subscription schema and methods

### Routes

- `routes/auth.js` - Added subscription management endpoints

### Frontend

- `public/comparison.html` - Updated to show 3-tier comparison
- `public/js/app.js` - Added premium file size checks
- `public/css/style.css` - Added premium styling

### Documentation

- `PREMIUM_PLAN.md` - This file

## Notes

- Payment integration is not yet implemented - use API to manually upgrade users
- Premium status is checked client-side and server-side for security
- File size limits are enforced during file selection
- Transfer speed prioritization can be implemented at WebRTC level or server routing
