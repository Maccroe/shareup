require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function testStripeConfig() {
  console.log('\n🔍 Testing Stripe Configuration...\n');

  // Check if Stripe keys are set
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY not found in .env file');
    console.log('Please add your Stripe secret key to .env file:');
    console.log('STRIPE_SECRET_KEY=sk_test_your_key_here\n');
    return;
  }

  if (process.env.STRIPE_SECRET_KEY === 'your_stripe_secret_key_here') {
    console.error('❌ STRIPE_SECRET_KEY is using placeholder value');
    console.log('Please replace with your actual Stripe secret key from:');
    console.log('https://dashboard.stripe.com/apikeys\n');
    return;
  }

  try {
    // Test API connection
    const balance = await stripe.balance.retrieve();
    console.log('✅ Stripe API connection successful!');
    console.log(`   Mode: ${process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'TEST' : 'LIVE'}`);
    console.log(`   Currency: ${balance.available[0]?.currency.toUpperCase() || 'USD'}`);

    // Check webhook secret
    if (!process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET === 'your_stripe_webhook_secret_here') {
      console.log('\n⚠️  STRIPE_WEBHOOK_SECRET not configured');
      console.log('   For local testing, run: stripe listen --forward-to localhost:3000/api/stripe/webhook');
      console.log('   Then copy the webhook signing secret to .env file\n');
    } else {
      console.log('✅ Webhook secret configured');
    }

    // Check client URL
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    console.log(`✅ Client URL: ${clientUrl}`);

    console.log('\n📝 Next Steps:');
    console.log('1. Make sure your .env file has all required Stripe keys');
    console.log('2. Start Stripe webhook forwarding: stripe listen --forward-to localhost:3000/api/stripe/webhook');
    console.log('3. Log in to your app and click "Upgrade to Premium"');
    console.log('4. Use test card: 4242 4242 4242 4242');
    console.log('5. Check webhook events in your terminal\n');

  } catch (error) {
    console.error('❌ Stripe API Error:', error.message);
    console.log('\nPlease check:');
    console.log('1. Your STRIPE_SECRET_KEY is correct');
    console.log('2. You have internet connection');
    console.log('3. Your Stripe account is active\n');
  }
}

testStripeConfig();
