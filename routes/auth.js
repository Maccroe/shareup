const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, requireAuth, optionalAuth } = require('../middleware/auth');

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
    res.json({
      success: true,
      user: req.user.getPublicProfile(),
      rooms: req.user.rooms.slice(-10) // Last 10 rooms
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

module.exports = router;