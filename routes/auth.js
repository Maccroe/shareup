const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, requireAuth, optionalAuth } = require('../middleware/auth');
const Room = require('../models/Room');
const { upload, uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        error: 'Username, email, and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.trim() }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        error: existingUser.email === email.toLowerCase() ?
          'Email already registered' :
          'Username already taken'
      });
    }

    // Create new user
    const user = new User({
      username: username.trim(),
      email: email.toLowerCase(),
      password
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Internal server error during registration'
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    // Validate input
    if (!login || !password) {
      return res.status(400).json({
        error: 'Username/email and password are required'
      });
    }

    // Find user by username or email
    const user = await User.findOne({
      $or: [
        { email: login.toLowerCase() },
        { username: login.trim() }
      ]
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Internal server error during login'
    });
  }
});

// Get current user profile
router.get('/profile', requireAuth, async (req, res) => {
  try {
    // Fetch recent rooms directly from Room collection
    const rooms = await Room.getUserRoomHistory(req.user._id);

    // Map to profile-friendly shape
    const mapped = rooms.map((room) => {
      const isCreator = room.creator && room.creator.toString() === req.user._id.toString();
      // Find joinedAt from participantHistory for this user if present
      const joined = (room.participantHistory || []).find(
        (p) => p.user && p.user.toString() === req.user._id.toString()
      );

      // Collect participant usernames (active participants known to server)
      const participantNames = (room.participants || [])
        .map((p) => p.user && p.user.username)
        .filter(Boolean);

      return {
        roomId: room.roomId,
        role: isCreator ? 'creator' : 'participant',
        joinedAt: joined?.joinedAt || room.createdAt,
        expiresAt: room.expiresAt,
        creator: room.creator && room.creator.username ? {
          id: room.creator._id || room.creator,
          username: room.creator.username
        } : {
          id: room.creator || null,
          username: 'Unknown'
        },
        participants: participantNames,
        participantsCount: participantNames.length
      };
    });

    res.json({
      success: true,
      user: req.user.getPublicProfile(),
      rooms: mapped
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Update user profile
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { username, avatar } = req.body;
    const updateFields = {};

    if (username && username.trim() !== req.user.username) {
      // Check if username is taken
      const existingUser = await User.findOne({
        username: username.trim(),
        _id: { $ne: req.user._id }
      });

      if (existingUser) {
        return res.status(400).json({
          error: 'Username already taken'
        });
      }

      updateFields.username = username.trim();
    }

    if (avatar !== undefined) {
      updateFields.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { new: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      error: 'Internal server error during profile update'
    });
  }
});

// Change password
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'New password must be at least 6 characters long'
      });
    }

    // Verify current password
    const isMatch = await req.user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Current password is incorrect'
      });
    }

    // Update password
    req.user.password = newPassword;
    await req.user.save();

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      error: 'Internal server error during password change'
    });
  }
});

// Logout (client-side token removal, but we can track it)
router.post('/logout', optionalAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Internal server error during logout'
    });
  }
});

// Upload avatar image
router.post('/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided'
      });
    }

    // Delete old avatar from Cloudinary if it exists
    if (req.user.avatar && req.user.avatarPublicId) {
      try {
        await deleteFromCloudinary(req.user.avatarPublicId);
      } catch (deleteError) {
        console.warn('Could not delete old avatar:', deleteError);
      }
    }

    // Upload new avatar to Cloudinary
    const result = await uploadToCloudinary(req.file.buffer, {
      public_id: `avatar_${req.user._id}_${Date.now()}`
    });

    // Update user with new avatar URL and public_id
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        avatar: result.secure_url,
        avatarPublicId: result.public_id
      },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Avatar updated successfully',
      avatar: result.secure_url,
      user: updatedUser.getPublicProfile()
    });

  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({
      error: 'Failed to upload avatar. Please try again.'
    });
  }
});

// Delete account
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        error: 'Password is required to delete account'
      });
    }

    // Verify password
    const isMatch = await req.user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        error: 'Password is incorrect'
      });
    }

    // Soft delete - just deactivate the account
    req.user.isActive = false;
    await req.user.save();

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({
      error: 'Internal server error during account deletion'
    });
  }
});

// Verify token (for client-side auth checks)
router.get('/verify', optionalAuth, async (req, res) => {
  try {
    if (req.user) {
      res.json({
        success: true,
        authenticated: true,
        user: req.user.getPublicProfile()
      });
    } else {
      res.json({
        success: true,
        authenticated: false,
        user: null
      });
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      error: 'Internal server error during token verification'
    });
  }
});

// Get user subscription info
router.get('/subscription', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      subscription: user.subscription,
      isPremium: user.isPremium(),
      fileSizeLimit: user.getFileSizeLimit(),
      transferSpeedTier: user.getTransferSpeedTier()
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upgrade to premium (for now just a toggle - payment integration can be added later)
router.post('/subscription/upgrade', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isPremium()) {
      return res.status(400).json({ error: 'Already a premium user' });
    }

    // Set premium subscription (valid for 30 days)
    user.subscription = {
      plan: 'premium',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      status: 'active'
    };

    await user.save();

    res.json({
      success: true,
      message: 'Upgraded to premium successfully',
      subscription: user.subscription,
      isPremium: user.isPremium()
    });
  } catch (error) {
    console.error('Upgrade subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel premium subscription
router.post('/subscription/cancel', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.isPremium()) {
      return res.status(400).json({ error: 'Not a premium user' });
    }

    user.subscription.status = 'cancelled';
    await user.save();

    res.json({
      success: true,
      message: 'Premium subscription cancelled',
      subscription: user.subscription
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;