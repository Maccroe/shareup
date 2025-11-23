// Test script to automatically create rooms and trigger rate limiting
const io = require('socket.io-client');

async function triggerRateLimitTest() {
  console.log('🧪 Starting automatic rate limit test...');
  console.log('Will create 6 rooms to trigger rate limiting and Discord notifications\n');

  for (let i = 1; i <= 6; i++) {
    try {
      console.log(`📡 Creating room ${i}/6...`);

      // Create a new socket connection
      const socket = io('http://localhost:3000');

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);

        socket.on('connect', () => {
          console.log(`   Socket ${i} connected: ${socket.id}`);

          // Create room
          socket.emit('create-room');

          socket.on('room-created', (data) => {
            console.log(`   ✅ Room ${i} created: ${data.roomCode}`);
            clearTimeout(timeout);

            // Disconnect after a short delay
            setTimeout(() => {
              socket.disconnect();
              resolve();
            }, 1000);
          });

          socket.on('error', (error) => {
            console.log(`   ❌ Room ${i} failed: ${error}`);
            clearTimeout(timeout);
            socket.disconnect();
            resolve(); // Continue even if one fails
          });
        });

        socket.on('connect_error', (error) => {
          console.log(`   ❌ Connection ${i} failed: ${error.message}`);
          clearTimeout(timeout);
          resolve();
        });
      });

      // Wait 2 seconds between room creations
      if (i < 6) {
        console.log('   ⏳ Waiting 2 seconds...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } catch (error) {
      console.log(`   ❌ Error creating room ${i}: ${error.message}\n`);
    }
  }

  console.log('\n🎉 Rate limit test completed!');
  console.log('📊 Check your Discord channel for rate limiting notifications');
  console.log('📈 Check the admin dashboard at http://localhost:3000/admin');
}

triggerRateLimitTest().catch(console.error);