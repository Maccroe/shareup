const mongoose = require('mongoose');
const AnonymousLimit = require('./models/AnonymousLimit');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });

async function showDeviceData() {
  try {
    const today = new Date().toDateString();

    console.log('\n📊 Current Device & Network Tracking Data');
    console.log('='.repeat(50));

    // Get all entries for today
    const allEntries = await AnonymousLimit.find({ date: today });

    if (allEntries.length === 0) {
      console.log('No data found for today. Create some rooms to see tracking in action!');
      return;
    }

    const deviceEntries = allEntries.filter(entry => entry.type === 'device');
    const networkEntries = allEntries.filter(entry => entry.type === 'network');

    console.log(`\n🔍 DEVICE TRACKING (${deviceEntries.length} unique devices)`);
    console.log('-'.repeat(30));

    deviceEntries.forEach(device => {
      const status = device.count >= 5 ? '🚫 BLOCKED' : '✅ ACTIVE';
      console.log(`${status} Device: ${device.deviceInfo?.deviceName || 'Unknown'}`);
      console.log(`   OS: ${device.deviceInfo?.os || 'Unknown'} ${device.deviceInfo?.osVersion || ''}`);
      console.log(`   Browser: ${device.deviceInfo?.browser || 'Unknown'} ${device.deviceInfo?.browserVersion || ''}`);
      console.log(`   Usage: ${device.count}/5 rooms created`);
      console.log(`   Device ID: ${device.fingerprint}`);
      console.log(`   Current IP: ${device.deviceInfo?.networkIp || 'Unknown'}`);
      console.log(`   All IPs: [${device.ips.join(', ')}]`);
      console.log(`   Last Seen: ${new Date(device.deviceInfo?.lastSeen || device.updatedAt).toLocaleString()}`);
      console.log('');
    });

    console.log(`\n🌐 NETWORK TRACKING (${networkEntries.length} unique networks)`);
    console.log('-'.repeat(30));

    networkEntries.forEach(network => {
      const status = network.count >= 5 ? '🚫 BLOCKED' : '✅ ACTIVE';
      console.log(`${status} Network IP: ${network.deviceInfo?.networkIp || 'Unknown'}`);
      console.log(`   Usage: ${network.count}/5 rooms created`);
      console.log(`   Network ID: ${network.fingerprint}`);
      console.log(`   Used by: ${network.deviceInfo?.deviceName || 'Unknown'} (${network.deviceInfo?.os || 'Unknown'})`);
      console.log(`   Last Activity: ${new Date(network.deviceInfo?.lastSeen || network.updatedAt).toLocaleString()}`);
      console.log('');
    });

    // Summary statistics
    const blockedDevices = deviceEntries.filter(d => d.count >= 5).length;
    const blockedNetworks = networkEntries.filter(n => n.count >= 5).length;
    const totalRoomsCreated = allEntries.reduce((sum, entry) => sum + entry.count, 0) / 2; // Divide by 2 since each room is counted twice

    console.log(`\n📈 SUMMARY STATISTICS`);
    console.log('-'.repeat(20));
    console.log(`Total Unique Devices: ${deviceEntries.length}`);
    console.log(`Total Unique Networks: ${networkEntries.length}`);
    console.log(`Blocked Devices: ${blockedDevices}`);
    console.log(`Blocked Networks: ${blockedNetworks}`);
    console.log(`Total Rooms Created Today: ${totalRoomsCreated}`);

  } catch (error) {
    console.error('Error fetching device data:', error);
  }

  process.exit(0);
}

showDeviceData();