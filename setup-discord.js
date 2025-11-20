// Quick Discord webhook setup utility
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

function setupDiscordWebhook(webhookUrl) {
  if (!webhookUrl) {
    console.log('❌ Please provide a Discord webhook URL');
    console.log('Usage: node setup-discord.js <webhook_url>');
    console.log('');
    console.log('Get your webhook URL from:');
    console.log('Discord Server → Settings → Integrations → Webhooks → New Webhook');
    return;
  }

  try {
    // Read current .env file
    let envContent = fs.readFileSync(envPath, 'utf8');

    // Update Discord configuration
    if (envContent.includes('DISCORD_WEBHOOK_URL=')) {
      envContent = envContent.replace(/DISCORD_WEBHOOK_URL=.*/, `DISCORD_WEBHOOK_URL=${webhookUrl}`);
    } else {
      envContent += `\nDISCORD_WEBHOOK_URL=${webhookUrl}`;
    }

    if (envContent.includes('DISCORD_ENABLED=')) {
      envContent = envContent.replace(/DISCORD_ENABLED=.*/, 'DISCORD_ENABLED=true');
    } else {
      envContent += '\nDISCORD_ENABLED=true';
    }

    // Write updated .env file
    fs.writeFileSync(envPath, envContent);

    console.log('✅ Discord webhook configured successfully!');
    console.log('🔗 Webhook URL set');
    console.log('🟢 Discord logging enabled');
    console.log('');
    console.log('🚀 Restart your server to apply changes:');
    console.log('   npm run dev');
    console.log('');
    console.log('📊 Rate limiting logs will now be sent to Discord instead of terminal');

  } catch (error) {
    console.error('❌ Error setting up Discord webhook:', error.message);
  }
}

// Get webhook URL from command line argument
const webhookUrl = process.argv[2];
setupDiscordWebhook(webhookUrl);