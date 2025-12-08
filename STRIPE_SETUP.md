# Stripe Payment Integration Setup Guide

This guide will help you set up Stripe payment processing for premium subscriptions.

## Prerequisites

- A Stripe account (sign up at https://stripe.com)
- Node.js and npm installed
- Your ShareUp application running

## Step 1: Get Stripe API Keys

1. Go to https://dashboard.stripe.com
2. Sign in or create a new account
3. Navigate to **Developers** → **API keys**
4. Copy your **Publishable key** and **Secret key**
5. For testing, use the **Test mode** keys (they start with `pk_test_` and `sk_test_`)

## Step 2: Configure Environment Variables

Add the following to your `.env` file:

```env
# Stripe Payment Configuration
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
CLIENT_URL=http://localhost:3000
```

**Important:**

- Never commit your `.env` file to version control
- Use test keys during development
- Switch to live keys only in production

## Step 3: Set Up Stripe Webhook

Webhooks are required to receive real-time updates about subscription events.

### Local Development (using Stripe CLI)

1. Install Stripe CLI:

   ```bash
   # Windows (using Scoop)
   scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
   scoop install stripe

   # macOS (using Homebrew)
   brew install stripe/stripe-cli/stripe

   # Linux
   # Download from https://github.com/stripe/stripe-cli/releases
   ```

2. Login to Stripe CLI:

   ```bash
   stripe login
   ```

3. Forward webhooks to your local server:

   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

4. Copy the webhook signing secret that appears (starts with `whsec_`) and add it to your `.env` file

5. Keep the Stripe CLI running while testing locally

### Production Deployment

1. Go to https://dashboard.stripe.com/webhooks
2. Click **Add endpoint**
3. Enter your webhook URL: `https://yourdomain.com/api/stripe/webhook`
4. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the **Signing secret** and add it to your production environment variables

## Step 4: Test the Integration

### Test in Development Mode

1. Start your application:

   ```bash
   npm start
   ```

2. In another terminal, start Stripe webhook forwarding:

   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

3. Log in to your application
4. Click **Upgrade to Premium**
5. Use Stripe test card numbers:
   - **Success:** `4242 4242 4242 4242`
   - **Requires authentication:** `4000 0025 0000 3155`
   - **Declined:** `4000 0000 0000 9995`
   - **Expiry:** Any future date (e.g., `12/34`)
   - **CVC:** Any 3 digits (e.g., `123`)
   - **ZIP:** Any 5 digits (e.g., `12345`)

### Verify Payment Flow

1. After successful payment, you should:

   - Be redirected back to the app
   - See a success notification
   - Have premium status activated
   - Be able to upload 10GB files

2. Check the Stripe dashboard to verify:

   - Customer was created
   - Subscription is active
   - Payment succeeded

3. Check your server logs for webhook events:
   ```
   ✅ Premium activated for user: username (email)
   💰 Payment succeeded for user: username - Amount: $9.99
   ```

## Step 5: Webhook Events Handled

The application automatically handles these Stripe events:

| Event                           | Action                                            |
| ------------------------------- | ------------------------------------------------- |
| `checkout.session.completed`    | Activates premium subscription                    |
| `customer.subscription.updated` | Updates subscription status and end date          |
| `customer.subscription.deleted` | Cancels premium and reverts to free               |
| `invoice.payment_succeeded`     | Confirms successful payment                       |
| `invoice.payment_failed`        | Logs payment failure (can add email notification) |

## Step 6: Production Deployment

### Update Environment Variables

On your production server (e.g., Render, Heroku):

1. Switch to **Live mode** in Stripe dashboard
2. Get your live API keys
3. Update environment variables:
   ```env
   STRIPE_SECRET_KEY=sk_live_your_live_secret_key
   STRIPE_PUBLISHABLE_KEY=pk_live_your_live_publishable_key
   STRIPE_WEBHOOK_SECRET=whsec_your_production_webhook_secret
   CLIENT_URL=https://yourdomain.com
   ```

### Configure Webhook Endpoint

1. Add webhook endpoint in Stripe dashboard
2. Point to: `https://yourdomain.com/api/stripe/webhook`
3. Select the same events as in testing
4. Save the webhook secret to your production environment

## Subscription Management

### User Features

- **Upgrade:** Click "Upgrade to Premium" → Complete Stripe checkout
- **Active Status:** Shown in user menu with crown icon 👑
- **File Limits:** Automatically increased to 10GB
- **Transfer Speed:** High-speed transfers enabled

### Cancel Subscription

Users can cancel via the API endpoint:

```javascript
POST /api/stripe/cancel-subscription
Authorization: Bearer {token}
```

The subscription remains active until the end of the billing period.

## Pricing Configuration

Current pricing: **$9.99/month**

To change pricing, update in `routes/stripe.js`:

```javascript
unit_amount: 999, // Amount in cents ($9.99)
```

## Security Best Practices

1. ✅ Never expose secret keys in client-side code
2. ✅ Always verify webhook signatures
3. ✅ Use HTTPS in production
4. ✅ Regularly rotate API keys
5. ✅ Monitor for suspicious activity in Stripe dashboard
6. ✅ Set up fraud detection rules in Stripe

## Testing Checklist

- [ ] Test successful payment with test card
- [ ] Test declined payment
- [ ] Test 3D Secure authentication
- [ ] Verify webhook events are received
- [ ] Check premium features are activated
- [ ] Test subscription cancellation
- [ ] Verify payment failure handling
- [ ] Test redirect URLs (success/cancel)

## Troubleshooting

### Webhook not receiving events

1. Check Stripe CLI is running: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
2. Verify webhook secret in `.env` matches CLI output
3. Check server logs for webhook errors
4. Ensure `/api/stripe/webhook` endpoint is accessible

### Payment not activating premium

1. Check webhook was received successfully
2. Verify `checkout.session.completed` event was processed
3. Check MongoDB for user subscription status
4. Look for errors in server logs

### "Invalid API key" error

1. Verify `STRIPE_SECRET_KEY` is set correctly in `.env`
2. Check you're using the correct mode (test vs live)
3. Ensure key starts with `sk_test_` or `sk_live_`

## Support

- **Stripe Documentation:** https://stripe.com/docs
- **Stripe API Reference:** https://stripe.com/docs/api
- **Test Cards:** https://stripe.com/docs/testing
- **Webhook Testing:** https://stripe.com/docs/webhooks/test

## Next Steps

After basic integration works:

1. Add email notifications for payment events
2. Implement subscription management dashboard
3. Add coupon/promo code support
4. Set up billing portal for users
5. Configure tax collection if required
6. Add analytics for subscription metrics

## Production Checklist

Before going live:

- [ ] Switch to live API keys
- [ ] Configure production webhook endpoint
- [ ] Test full payment flow in live mode
- [ ] Set up SSL certificate (HTTPS)
- [ ] Configure Stripe radar for fraud prevention
- [ ] Set up email notifications
- [ ] Add terms of service and privacy policy
- [ ] Enable Stripe billing portal
- [ ] Set up invoice email templates
- [ ] Test subscription cancellation flow
- [ ] Monitor webhook delivery and errors

---

🎉 **You're all set!** Users can now upgrade to premium with Stripe payment processing.
