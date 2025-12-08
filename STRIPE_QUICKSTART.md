# Stripe Payment Integration - Quick Start Guide

## ✅ What's Been Implemented

I've implemented a complete Stripe payment integration for your premium subscription feature. Here's what's now working:

### Backend Changes

- ✅ Installed Stripe SDK (`npm install stripe`)
- ✅ Created Stripe configuration (`config/stripe.js`)
- ✅ Created Stripe routes (`routes/stripe.js`) with:
  - Checkout session creation
  - Webhook handler for subscription events
  - Subscription status endpoint
  - Cancellation endpoint
- ✅ Updated User model with Stripe fields (`stripeCustomerId`, `stripeSubscriptionId`)
- ✅ Integrated Stripe routes into main server

### Frontend Changes

- ✅ Added Stripe.js library to `index.html`
- ✅ Updated premium upgrade button to redirect to Stripe Checkout
- ✅ Added payment success/cancel handling
- ✅ Updated modal text to show real payment information

### Webhook Events Handled

- `checkout.session.completed` - Activates premium subscription
- `customer.subscription.updated` - Updates subscription details
- `customer.subscription.deleted` - Cancels premium
- `invoice.payment_succeeded` - Confirms payment
- `invoice.payment_failed` - Logs failed payments

## 🚀 How to Set Up Stripe (Required Steps)

### 1. Get Stripe API Keys

1. Go to https://dashboard.stripe.com
2. Sign up or log in
3. Click **Developers** → **API keys**
4. Copy your **Secret key** (starts with `sk_test_` for test mode)

### 2. Update .env File

Open your `.env` file and replace the placeholder values:

```env
# Stripe Payment Configuration
STRIPE_SECRET_KEY=sk_test_paste_your_actual_key_here
STRIPE_WEBHOOK_SECRET=whsec_will_get_this_from_stripe_cli
CLIENT_URL=http://localhost:3000
```

### 3. Install Stripe CLI (for local testing)

**Windows:**

```bash
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe
```

Or download from: https://github.com/stripe/stripe-cli/releases

### 4. Forward Webhooks Locally

Open a new terminal and run:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the webhook signing secret (starts with `whsec_`) and add it to your `.env` file.

**Keep this terminal running while testing!**

### 5. Test the Payment Flow

1. Start your server: `node server.js`
2. Open http://localhost:3000
3. Log in to your account
4. Click your avatar → **"👑 Upgrade to Premium"**
5. Click **"Subscribe Now"**
6. You'll be redirected to Stripe Checkout
7. Use test card: **4242 4242 4242 4242**
   - Expiry: Any future date (12/34)
   - CVC: Any 3 digits (123)
   - ZIP: Any 5 digits (12345)
8. Complete payment
9. You'll be redirected back with success message
10. Your account is now premium! 🎉

## 📋 Test Checklist

Run through these tests:

- [ ] Click "Upgrade to Premium" button
- [ ] Redirected to Stripe Checkout page
- [ ] Enter test card 4242 4242 4242 4242
- [ ] Complete payment successfully
- [ ] Redirected back to app with success message
- [ ] Premium status shows in user menu
- [ ] Can now upload 10GB files (vs 500MB before)
- [ ] "Upgrade to Premium" button disappears after upgrade

## 🔧 Troubleshooting

### "Nothing happens" when clicking upgrade button

**Check browser console for errors:**

- Open browser DevTools (F12)
- Go to Console tab
- Look for error messages

**Common issues:**

1. Server not running - Start with `node server.js`
2. Stripe keys not set - Update .env file with real keys
3. Network error - Check internet connection

### Payment completes but premium not activated

**Check webhook forwarding:**

1. Is Stripe CLI running? `stripe listen --forward-to localhost:3000/api/stripe/webhook`
2. Check terminal for webhook events
3. Look for: `✅ Premium activated for user: username`

**Check server logs:**

- Look for webhook errors
- Verify MongoDB connection is working

### Test the configuration:

```bash
node test-stripe.js
```

This will verify your Stripe keys are configured correctly.

## 📊 What Happens During Payment

1. **User clicks "Subscribe Now"**

   - Frontend calls `/api/stripe/create-checkout-session`
   - Backend creates Stripe customer (if new)
   - Backend creates checkout session
   - Returns Stripe Checkout URL

2. **User redirected to Stripe Checkout**

   - Secure Stripe-hosted payment page
   - User enters card details
   - Payment processed by Stripe

3. **Payment succeeds**

   - Stripe sends webhook to your server
   - Webhook handler activates premium subscription
   - User redirected back to your app
   - Success message displayed

4. **Premium activated**
   - User.subscription.plan = 'premium'
   - User.subscription.status = 'active'
   - File size limit increased to 10GB
   - High-speed transfers enabled

## 💰 Pricing

Current setup: **$9.99/month recurring subscription**

To change pricing, edit `routes/stripe.js` line ~25:

```javascript
unit_amount: 999, // Amount in cents
```

## 🌐 Production Deployment

When deploying to production (Render, Heroku, etc.):

1. Switch to **Live mode** in Stripe dashboard
2. Get live API keys (start with `sk_live_`)
3. Set environment variables on your hosting platform:
   ```
   STRIPE_SECRET_KEY=sk_live_your_live_key
   STRIPE_WEBHOOK_SECRET=whsec_from_stripe_dashboard
   CLIENT_URL=https://yourdomain.com
   ```
4. Set up webhook endpoint in Stripe dashboard:
   - URL: `https://yourdomain.com/api/stripe/webhook`
   - Events: checkout.session.completed, customer.subscription._, invoice._

## 📚 Documentation

Full setup guide: `STRIPE_SETUP.md`

Stripe documentation:

- Dashboard: https://dashboard.stripe.com
- Docs: https://stripe.com/docs
- Test cards: https://stripe.com/docs/testing

## ⚡ Quick Commands

```bash
# Test Stripe configuration
node test-stripe.js

# Start webhook forwarding
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Start server
node server.js
```

## 🎯 Next Steps

1. Get your Stripe API keys from dashboard
2. Update .env file with real keys
3. Install and run Stripe CLI
4. Test the payment flow
5. Deploy to production with live keys

---

**Need help?** Check STRIPE_SETUP.md for detailed troubleshooting and advanced configuration.
