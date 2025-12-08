const express = require('express');
const router = express.Router();
const stripe = require('../config/stripe');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');

// Create Stripe checkout session for premium subscription
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isPremium()) {
      return res.status(400).json({ error: 'Already a premium subscriber' });
    }

    // Create or get Stripe customer
    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user._id.toString(),
          username: user.username
        }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'ShareUp Premium',
              description: '10GB file sizes, high-speed transfers, unlimited rooms',
              images: ['https://your-domain.com/premium-icon.png'], // Optional: Add your logo
            },
            unit_amount: 999, // $9.99 in cents
            recurring: {
              interval: 'month'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/?payment=cancelled`,
      metadata: {
        userId: user._id.toString()
      }
    });

    res.json({
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Stripe checkout session error:', error);
    res.status(500).json({
      error: 'Failed to create checkout session',
      message: error.message
    });
  }
});

// Confirm checkout session (fallback when webhooks aren't reachable)
router.post('/confirm-session', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Missing Stripe session ID' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription']
    });

    if (!session) {
      return res.status(404).json({ error: 'Checkout session not found' });
    }

    if (session.metadata?.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }

    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        error: 'Payment not completed yet',
        status: session.payment_status
      });
    }

    const subscription = session.subscription;
    const subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id;

    // Calculate subscription dates: 1 month from today
    const currentPeriodStart = new Date();
    const currentPeriodEnd = new Date();
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

    // If Stripe provides subscription dates, use those instead
    if (subscription?.current_period_start && subscription?.current_period_end) {
      currentPeriodStart.setTime(subscription.current_period_start * 1000);
      currentPeriodEnd.setTime(subscription.current_period_end * 1000);
    }

    // Activate premium locally
    req.user.subscription = {
      plan: 'premium',
      startDate: currentPeriodStart,
      endDate: currentPeriodEnd,
      status: 'active'
    };
    req.user.stripeSubscriptionId = subscriptionId || req.user.stripeSubscriptionId;
    req.user.stripeCustomerId = session.customer || req.user.stripeCustomerId;

    await req.user.save();

    res.json({
      success: true,
      subscription: req.user.subscription,
      user: req.user.getPublicProfile()
    });
  } catch (error) {
    console.error('Confirm session error:', error);
    res.status(500).json({ error: 'Failed to confirm payment session' });
  }
});

// Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;

      case 'customer.subscription.updated':
        const subscription = event.data.object;
        await handleSubscriptionUpdated(subscription);
        break;

      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        await handleSubscriptionDeleted(deletedSubscription);
        break;

      case 'invoice.payment_succeeded':
        const invoice = event.data.object;
        await handlePaymentSucceeded(invoice);
        break;

      case 'invoice.payment_failed':
        const failedInvoice = event.data.object;
        await handlePaymentFailed(failedInvoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// Get subscription status
router.get('/subscription-status', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let subscriptionData = null;

    if (user.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        subscriptionData = {
          id: subscription.id,
          status: subscription.status,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end
        };
      } catch (error) {
        console.error('Failed to retrieve Stripe subscription:', error);
      }
    }

    res.json({
      isPremium: user.isPremium(),
      subscription: user.subscription,
      stripeSubscription: subscriptionData
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel subscription
router.post('/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    // Cancel at period end (don't cancel immediately)
    const subscription = await stripe.subscriptions.update(
      user.stripeSubscriptionId,
      {
        cancel_at_period_end: true
      }
    );

    res.json({
      success: true,
      message: 'Subscription will be cancelled at the end of the billing period',
      subscription: {
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000)
      }
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      message: error.message
    });
  }
});

// Helper functions
async function handleCheckoutCompleted(session) {
  const userId = session.metadata.userId;
  const user = await User.findById(userId);

  if (!user) {
    console.error('User not found for checkout session:', userId);
    return;
  }

  // Get the subscription ID
  const subscriptionId = session.subscription;

  // Activate premium subscription (1 month from today)
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 1);

  user.subscription = {
    plan: 'premium',
    startDate: startDate,
    endDate: endDate,
    status: 'active'
  };
  user.stripeSubscriptionId = subscriptionId;

  await user.save();

  console.log(`✅ Premium activated for user: ${user.username} (${user.email})`);
}

async function handleSubscriptionUpdated(subscription) {
  const user = await User.findOne({ stripeSubscriptionId: subscription.id });

  if (!user) {
    console.error('User not found for subscription:', subscription.id);
    return;
  }

  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

  // Update subscription status
  if (subscription.status === 'active') {
    user.subscription = {
      plan: 'premium',
      startDate: user.subscription?.startDate || new Date(),
      endDate: currentPeriodEnd,
      status: 'active'
    };
  } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
    user.subscription.status = 'cancelled';
  }

  await user.save();

  console.log(`📝 Subscription updated for user: ${user.username} - Status: ${subscription.status}`);
}

async function handleSubscriptionDeleted(subscription) {
  const user = await User.findOne({ stripeSubscriptionId: subscription.id });

  if (!user) {
    console.error('User not found for subscription:', subscription.id);
    return;
  }

  // Deactivate premium
  user.subscription.status = 'cancelled';
  user.stripeSubscriptionId = null;

  await user.save();

  console.log(`❌ Premium cancelled for user: ${user.username}`);
}

async function handlePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) return;

  const user = await User.findOne({ stripeSubscriptionId: subscriptionId });

  if (!user) {
    console.error('User not found for invoice:', invoice.id);
    return;
  }

  // Ensure subscription is active
  if (user.subscription.status !== 'active') {
    user.subscription.status = 'active';
    await user.save();
  }

  console.log(`💰 Payment succeeded for user: ${user.username} - Amount: $${invoice.amount_paid / 100}`);
}

async function handlePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;

  if (!subscriptionId) return;

  const user = await User.findOne({ stripeSubscriptionId: subscriptionId });

  if (!user) {
    console.error('User not found for failed invoice:', invoice.id);
    return;
  }

  console.error(`⚠️ Payment failed for user: ${user.username} - Amount: $${invoice.amount_due / 100}`);

  // You might want to send an email notification here
}

module.exports = router;
