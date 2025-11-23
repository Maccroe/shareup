// Test script to trigger Discord notifications
require('dotenv').config();
const discordLogger = require('./utils/discord');

async function testDiscordNotifications() {
  console.log('🧪 Testing Discord webhook notifications...\n');

  try {
    // Test 1: Rate limit reached
    console.log('1️⃣ Testing Rate Limit Reached notification...');
    const result1 = await discordLogger.logRateLimit(
      'test_fingerprint_123',
      '192.168.1.100',
      'Windows 10',
      'Chrome',
      5,
      5,
      'network_abc123',
      2
    );
    console.log(`   Result: ${result1 ? '✅ Sent' : '❌ Failed'}\n`);

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: Approaching limit
    console.log('2️⃣ Testing Approaching Limit notification...');
    const result2 = await discordLogger.logApproachingLimit(
      'test_fingerprint_456',
      'Windows 10',
      'Edge',
      4,
      5,
      1,
      ['Chrome', 'Edge']
    );
    console.log(`   Result: ${result2 ? '✅ Sent' : '❌ Failed'}\n`);

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 3: Browser switch
    console.log('3️⃣ Testing Browser Switch notification...');
    const result3 = await discordLogger.logBrowserSwitch(
      'test_fingerprint_789',
      '192.168.1.100',
      'Windows 10',
      'Chrome',
      'Edge',
      3,
      5
    );
    console.log(`   Result: ${result3 ? '✅ Sent' : '❌ Failed'}\n`);

    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 4: Device unblocked
    console.log('4️⃣ Testing Device Unblocked notification...');
    const result4 = await discordLogger.logDeviceUnblocked(
      'test_fingerprint_xyz',
      'Windows 10',
      'Chrome'
    );
    console.log(`   Result: ${result4 ? '✅ Sent' : '❌ Failed'}\n`);

    console.log('🎉 All tests completed! Check your Discord channel for messages.');

  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

testDiscordNotifications();