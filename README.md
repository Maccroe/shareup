# P2P File Share

A peer-to-peer file sharing web application that allows users to send videos, photos, documents, and files between phones across different locations without losing original quality.

## ✨ Features

- **🌍 Global Transfer**: Send files between devices worldwide, no same WiFi required
- **🔒 Direct Transfer**: Files sent directly between devices via WebRTC, no server storage
- **📱 Mobile Optimized**: Perfect experience on phones and tablets
- **📄 All File Types**: Support for videos, photos, documents, and any file type
- **🎯 Original Quality**: No compression or quality loss during transfer
- **⚡ Real-time Progress**: Live transfer progress and speed indicators
- **🏠 Room-based**: Simple room codes for secure file sharing
- **💾 PWA Support**: Install as an app on mobile devices

## 🚀 Quick Start

### Prerequisites

- Node.js (version 14 or higher)
- npm (comes with Node.js)

### Installation

1. **Clone or download this repository**
2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Start the server:**

   ```bash
   npm start
   ```

4. **Open your browser:**
   Navigate to `http://localhost:3000`

## 🔧 Development

For development with auto-restart:

```bash
npm run dev
```

## 📱 How to Use

### Creating a Room

1. Click "Create Room"
2. Share the generated room code with your friend
3. Wait for them to join

### Joining a Room

1. Click "Join Room"
2. Enter the 8-character room code
3. Wait for connection to establish

### Sharing Files

1. Once connected, drag & drop files or click the file area
2. Files will automatically start transferring
3. Recipient can download files immediately

## 🌐 Technology Stack

- **Backend**: Node.js + Express.js
- **Real-time Communication**: Socket.io for signaling
- **P2P Transfer**: WebRTC for direct file transfer
- **Frontend**: Vanilla JavaScript (no frameworks)
- **Mobile**: Progressive Web App (PWA)
- **Styling**: Modern CSS with responsive design

## 🔧 Configuration

### STUN Servers

The app uses Google's public STUN servers for NAT traversal. For production, consider:

- Adding TURN servers for better connectivity
- Using your own STUN/TURN infrastructure

### File Size Limits

- Current limit: 500MB per file
- Modify in `public/js/app.js` if needed

### Port Configuration

- Default port: 3000
- Set `PORT` environment variable to change

## 🌍 Deployment

### Heroku

1. Create a new Heroku app
2. Set buildpack to Node.js
3. Deploy from Git repository

### Other Platforms

The app works on any platform supporting Node.js:

- Vercel
- Railway
- DigitalOcean App Platform
- AWS Elastic Beanstalk

## 🔒 Security Features

- Room codes are randomly generated and expire after 24 hours
- Direct P2P transfer means no files stored on servers
- WebRTC provides encrypted communication
- Rooms are automatically cleaned up when empty

## 📊 Browser Support

- Chrome/Chromium (recommended)
- Firefox
- Safari (iOS 11+)
- Edge

**Note**: WebRTC support required for file transfer functionality.

## 🛠️ Customization

### Styling

- Edit `public/css/style.css` for visual changes
- Colors, fonts, and layouts are easily customizable

### Features

- Modify chunk size in `webrtc.js` for different network conditions
- Add file type restrictions in `app.js`
- Customize room code format in `server.js`

## 🐛 Troubleshooting

### Connection Issues

- Ensure both devices have internet access
- Try refreshing the page
- Check browser console for errors

### Large Files

- Use stable internet connection
- Consider splitting very large files
- Monitor browser memory usage

### Mobile Issues

- Use Chrome or Safari for best compatibility
- Ensure sufficient storage space
- Close other browser tabs if needed

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

For issues and questions:

- Check the browser console for error messages
- Ensure WebRTC is supported in your browser
- Try using a different network connection

---

**Made with ❤️ for seamless file sharing across the globe**
