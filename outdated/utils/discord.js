const axios = require('axios');

class DiscordLogger {
  constructor() {
    this.webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    this.enabled = process.env.DISCORD_ENABLED === 'true' && this.webhookUrl;

    if (this.enabled) {
      console.log('🤖 Discord webhook logging enabled');
    }
  }

  async sendLog(type, data) {
    if (!this.enabled) {
      console.log(`⚠️ Discord logging disabled - would send: ${type}`);
      return false;
    }

    try {
      const embed = this.createEmbed(type, data);

      await axios.post(this.webhookUrl, {
        username: 'ShareUp Monitor',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/906/906349.png',
        embeds: [embed]
      });

      console.log(`✅ Discord log sent: ${type}`);
      return true;
    } catch (error) {
      console.error(`❌ Discord webhook error (${type}):`, error.response?.data || error.message);
      return false;
    }
  } createEmbed(type, data) {
    const timestamp = new Date().toISOString();

    switch (type) {
      case 'rate_limit_reached':
        return {
          title: '🚫 Device/Network Limit Reached',
          color: 0xFF0000, // Red
          fields: [
            { name: '📱 Device', value: `${data.deviceName || 'Unknown Device'}`, inline: true },
            { name: '🔑 Fingerprint', value: `\`${data.fingerprint.substring(0, 12)}...\``, inline: true },
            { name: '🌍 IP Address', value: `\`${data.ip}\``, inline: true },
            { name: '💻 OS & Browser', value: `${data.os} \u2022 ${data.browser}`, inline: true },
            { name: '📊 Usage', value: `${data.usage}/${data.limit} rooms`, inline: true },
            { name: '🚫 Blocked By', value: `${data.relatedFingerprints}`, inline: true },
            { name: '🌐 Network ID', value: `\`${data.network.substring(0, 8)}...\``, inline: true }
          ],
          footer: {
            text: 'ShareUp Rate Limiting System'
          },
          timestamp
        };

      case 'approaching_limit':
        return {
          title: '⚠️ Approaching Rate Limit',
          color: 0xFF8C00, // Orange
          fields: [
            { name: '📱 Device', value: `${data.deviceName || 'Unknown Device'}`, inline: true },
            { name: '🔑 Fingerprint', value: `\`${data.fingerprint.substring(0, 12)}...\``, inline: true },
            { name: '💻 OS & Browser', value: `${data.os} \u2022 ${data.browser}`, inline: true },
            { name: '📊 Usage', value: `${data.usage}/${data.limit} rooms`, inline: true },
            { name: '⏳ Remaining', value: `${data.remaining} rooms left`, inline: true },
            { name: '🔄 Browser History', value: data.browserHistory ? data.browserHistory.join(' → ') : data.browser, inline: false }
          ],
          footer: {
            text: 'ShareUp Rate Limiting System'
          },
          timestamp
        };

      case 'browser_switch':
        return {
          title: '🔄 Browser Switch Detected',
          color: 0x0099FF, // Blue
          fields: [
            { name: '👤 Fingerprint', value: `\`${data.fingerprint}\``, inline: true },
            { name: '🌐 IP Address', value: `\`${data.ip}\``, inline: true },
            { name: '💻 OS', value: data.os, inline: true },
            { name: '🔄 Browser Change', value: `${data.fromBrowser} → ${data.toBrowser}`, inline: false },
            { name: '📊 Current Usage', value: `${data.usage}/${data.limit} rooms`, inline: true }
          ],
          footer: {
            text: 'ShareUp Rate Limiting System'
          },
          timestamp
        };

      case 'device_unblocked':
        return {
          title: '🔓 Device Unblocked by Admin',
          color: 0x00FF00, // Green
          fields: [
            { name: '📱 Device', value: `${data.deviceName || 'Unknown Device'}`, inline: true },
            { name: '🔑 Fingerprint', value: `\`${data.fingerprint.substring(0, 12)}...\``, inline: true },
            { name: '💻 OS & Browser', value: `${data.os} \u2022 ${data.browser}`, inline: true },
            { name: '🔄 Tracking Type', value: data.trackingType === 'device' ? '📱 Device ID Tracking' : '🌐 Network IP Tracking', inline: true },
            { name: '🛡️ Admin Action', value: 'Rate limit manually removed', inline: false }
          ],
          footer: {
            text: 'ShareUp Admin Action'
          },
          timestamp
        };

      default:
        return {
          title: '📊 ShareUp Activity',
          description: JSON.stringify(data, null, 2),
          color: 0x808080,
          timestamp
        };
    }
  }

  // Quick methods for specific log types
  async logRateLimit(fingerprint, ip, deviceName, os, browser, usage, limit, network, relatedFingerprints) {
    return await this.sendLog('rate_limit_reached', {
      fingerprint, ip, deviceName, os, browser, usage, limit, network, relatedFingerprints
    });
  }

  async logApproachingLimit(fingerprint, deviceName, os, browser, usage, limit, remaining, browserHistory) {
    return await this.sendLog('approaching_limit', {
      fingerprint, deviceName, os, browser, usage, limit, remaining, browserHistory
    });
  }

  async logBrowserSwitch(fingerprint, ip, os, fromBrowser, toBrowser, usage, limit) {
    return await this.sendLog('browser_switch', {
      fingerprint, ip, os, fromBrowser, toBrowser, usage, limit
    });
  }

  async logDeviceUnblocked(fingerprint, deviceName, os, browser, trackingType) {
    return await this.sendLog('device_unblocked', {
      fingerprint, deviceName, os, browser, trackingType
    });
  }
}

module.exports = new DiscordLogger();