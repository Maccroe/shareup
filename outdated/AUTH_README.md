# MongoDB User Authentication Setup

This document explains the user authentication system added to the P2P file sharing application.

## Features Added

### 1. **Optional User Registration & Login**
- Users can create accounts with username, email, and password
- Users can login to track their room history
- **Anonymous usage still supported** - users can create and join rooms without logging in

### 2. **User Features (when logged in)**
- Room history tracking (last 10 rooms)
- User profile with avatar support
- Persistent login across browser sessions

### 3. **Security**
- Password hashing with bcrypt
- JWT token authentication
- Optional authentication (doesn't break anonymous usage)

## API Endpoints

### Authentication Routes (`/api/auth/`)
- `POST /register` - Register new user
- `POST /login` - Login user
- `GET /profile` - Get user profile (authenticated)
- `PUT /profile` - Update user profile (authenticated)
- `PUT /password` - Change password (authenticated)
- `POST /logout` - Logout user
- `DELETE /account` - Delete account (authenticated)
- `GET /verify` - Verify JWT token

## Environment Variables

Add these to your `.env` file:

```env
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
```

## Database Schema

### User Model
- `username` (unique, 3-20 characters)
- `email` (unique, validated)
- `password` (hashed)
- `avatar` (optional emoji/text)
- `rooms[]` (room history with role)
- `lastLogin`
- `isActive` (for soft deletion)

## Frontend Features

### 1. **Header Authentication**
- Login/Register buttons for anonymous users
- User menu with avatar and dropdown for logged-in users

### 2. **Modals**
- Login modal with username/email + password
- Registration modal with username, email, password confirmation
- User profile modal showing:
  - User details
  - Recent room history
  - Account management options

### 3. **Seamless Experience**
- Room creation/joining works identically for both authenticated and anonymous users
- Authenticated users get additional benefits (history tracking, profile)
- Automatic token-based authentication on page refresh

## Socket.io Integration

- Optional authentication for socket connections
- User information displayed in room for authenticated users
- Room participant list includes user details when available

## Anonymous Usage

The application maintains full functionality for anonymous users:
- Create rooms without registration
- Join rooms with room codes
- Send and receive files
- All WebRTC features work normally

Authentication is purely optional and additive - it doesn't change the core file sharing experience.

## Testing

1. Start the application: `npm start`
2. Try creating/joining rooms without logging in (should work as before)
3. Register a new account and login
4. Create rooms while logged in to see room history
5. Check user profile to see tracked rooms

The system gracefully handles both authenticated and anonymous users in the same rooms.