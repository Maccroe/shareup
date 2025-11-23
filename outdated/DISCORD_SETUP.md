# Discord Webhook Setup Guide

## 📋 **Quick Setup Steps**

### 1. Create Discord Webhook

1. **Open Discord** and navigate to your server
2. **Go to Server Settings** → Integrations → Webhooks
3. **Click "New Webhook"**
4. **Configure Webhook:**
   - Name: `ShareUp Monitor`
   - Channel: Choose your monitoring channel
   - Avatar: Optional (will auto-set to ShareUp icon)
5. **Copy Webhook URL** (looks like: `https://discord.com/api/webhooks/1234567890/abcdef123456...`)

### 2. Configure Environment Variables

Add to your `.env` file:

```env
# Discord Webhook (Optional - for rate limiting notifications)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL_HERE
DISCORD_ENABLED=true
```

### 3. Restart Your Server

```bash
npm run dev
```

## 🎯 **What Gets Logged to Discord**

### 🚫 **Rate Limit Reached**

- User fingerprint and IP address
- Device info (OS/Browser)
- Usage count (5/5 rooms)
- Network fingerprint
- Related fingerprints count

### ⚠️ **Approaching Limit**

- User approaching the daily limit
- Current usage (4/5 rooms)
- Browser history if user switched browsers
- Remaining rooms before limit

### 🔄 **Browser Switch Detection**

- When user switches from Chrome to Edge, etc.
- IP address and OS information
- Current usage status

### 🔓 **Admin Actions**

- When admin manually unblocks a device
- Device information that was unblocked

## 📺 **Sample Discord Messages**

The Discord bot will send rich embeds with color coding:

- 🔴 **Red**: Rate limit reached (critical)
- 🟠 **Orange**: Approaching limit (warning)
- 🔵 **Blue**: Browser switch detected (info)
- 🟢 **Green**: Admin unblock action (success)

## 🛠️ **Configuration Options**

### Disable Discord Logging

```env
DISCORD_ENABLED=false
```

### Terminal + Discord Logging

Keep both terminal and Discord logging by setting:

```env
DISCORD_ENABLED=true
# Terminal will show minimal logs, Discord gets detailed logs
```

## 🔧 **Troubleshooting**

### Webhook Not Working?

1. Check webhook URL format
2. Ensure Discord channel permissions
3. Verify DISCORD_ENABLED=true in .env
4. Check server console for webhook errors

### Too Many Messages?

The system only sends:

- Rate limits reached
- Users approaching limits (4/5 rooms)
- Browser switches
- Admin actions

Normal room creation (1-3/5 rooms) only shows in terminal.

## 📊 **Benefits**

- **Clean Terminal**: No more spam logs in development
- **Discord History**: All rate limiting events preserved
- **Rich Information**: Color-coded embeds with detailed data
- **Team Notifications**: Everyone in Discord channel gets notified
- **Easy Monitoring**: Visual dashboard in Discord
- **Audit Trail**: Permanent record of all rate limiting events
