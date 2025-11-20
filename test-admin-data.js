// Test script to generate sample blocked devices for admin dashboard testing
const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Import the AnonymousLimit model
const AnonymousLimit = require('./models/AnonymousLimit');

async function generateTestData() {
  try {
    const today = new Date().toDateString();

    // Create sample blocked devices
    const testDevices = [
      {
        fingerprint: 'test_device_1_blocked',
        count: 5,
        date: today,
        ips: ['192.168.1.100', '192.168.1.101'],
        metadata: {
          network: 'test_network_1',
          device: 'test_device_windows',
          os: 'Windows 10',
          browser: 'Chrome 120',
          language: 'en-US',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          relatedFingerprints: ['test_device_1_blocked']
        }
      },
      {
        fingerprint: 'test_device_2_blocked',
        count: 5,
        date: today,
        ips: ['10.0.0.50'],
        metadata: {
          network: 'test_network_2',
          device: 'test_device_iphone',
          os: 'iOS 17',
          browser: 'Safari 17',
          language: 'en-US',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          relatedFingerprints: ['test_device_2_blocked', 'test_device_2_alt']
        }
      },
      {
        fingerprint: 'test_device_3_approaching',
        count: 4,
        date: today,
        ips: ['203.0.113.45', '203.0.113.46', '203.0.113.47'],
        metadata: {
          network: 'test_network_3',
          device: 'test_device_android',
          os: 'Android 14',
          browser: 'Chrome Mobile 120',
          language: 'es-ES',
          userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          relatedFingerprints: ['test_device_3_approaching']
        }
      }
    ];

    // Remove existing test data
    await AnonymousLimit.deleteMany({ fingerprint: { $regex: '^test_device_' } });
    console.log('Removed existing test data');

    // Insert new test data
    await AnonymousLimit.insertMany(testDevices);
    console.log('✅ Generated test data with 3 devices:');
    console.log('   - 2 blocked devices (reached 5/5 limit)');
    console.log('   - 1 approaching limit (4/5 used)');
    console.log('');
    console.log('🌐 Visit http://localhost:3000/admin to view the admin dashboard');
    console.log('');
    console.log('📊 Test data includes:');
    console.log('   - Different device types (Windows, iPhone, Android)');
    console.log('   - Multiple IP addresses per device');
    console.log('   - Various browser and OS combinations');
    console.log('   - Related fingerprints for bypass detection');

  } catch (error) {
    console.error('Error generating test data:', error);
  } finally {
    mongoose.disconnect();
  }
}

async function cleanTestData() {
  try {
    const result = await AnonymousLimit.deleteMany({ fingerprint: { $regex: '^test_device_' } });
    console.log(`🧹 Cleaned ${result.deletedCount} test device records`);
  } catch (error) {
    console.error('Error cleaning test data:', error);
  } finally {
    mongoose.disconnect();
  }
}

// Check command line argument
const action = process.argv[2];

if (action === 'clean') {
  console.log('🧹 Cleaning test data...');
  cleanTestData();
} else {
  console.log('🔧 Generating test data for admin dashboard...');
  generateTestData();
}