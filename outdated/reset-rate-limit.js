const mongoose = require('mongoose');
const AnonymousLimit = require('./models/AnonymousLimit');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => {
    console.log('Connected to MongoDB');
    resetRateLimit();
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });

async function resetRateLimit() {
  try {
    const today = new Date().toDateString();

    // Clear all rate limiting data for today
    const result = await AnonymousLimit.deleteMany({ date: today });

    console.log(`✅ Cleared ${result.deletedCount} rate limit records for today (${today})`);
    console.log('All devices can now create rooms again with fresh daily limits.');

  } catch (error) {
    console.error('Error resetting rate limits:', error);
  }

  process.exit(0);
}