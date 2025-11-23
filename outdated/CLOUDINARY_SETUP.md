# Cloudinary Avatar Upload Setup

## Quick Setup Guide

### 1. Create Cloudinary Account

1. Go to [cloudinary.com](https://cloudinary.com) and sign up for a free account
2. After registration, go to your Dashboard
3. Copy the credentials from the "Account Details" section

### 2. Configure Environment Variables

Update your `.env` file with your Cloudinary credentials:

```env
CLOUDINARY_CLOUD_NAME=your_actual_cloud_name
CLOUDINARY_API_KEY=your_actual_api_key
CLOUDINARY_API_SECRET=your_actual_api_secret
```

Replace the placeholder values with your actual Cloudinary credentials.

### 3. Features Added

**Backend:**

- `/POST /api/auth/avatar` - Upload avatar endpoint
- Automatic image resizing to 200x200px
- Old avatar deletion when new one is uploaded
- 5MB file size limit
- Only image files accepted

**Frontend:**

- "Change Avatar" button in user profile
- Upload progress indicator
- Automatic UI updates across the app
- Image display in header and profile

**Database:**

- Added `avatarPublicId` field to User model for Cloudinary management

### 4. How It Works

1. User clicks "Change Avatar" in their profile
2. File picker opens (images only)
3. Image is uploaded to Cloudinary
4. Cloudinary automatically resizes to 200x200px
5. User's avatar URL is saved to database
6. All UI elements update automatically
7. Old avatar is deleted from Cloudinary

### 5. Usage

1. Login to your account
2. Open your profile (click username in header)
3. Click "Change Avatar"
4. Select an image file (JPG, PNG, etc.)
5. Wait for upload to complete
6. Your new avatar appears everywhere in the app

The system handles:

- Image optimization
- Storage management
- UI updates
- Error handling
- File validation

### 6. Free Tier Limits

Cloudinary free tier includes:

- 25GB storage
- 25GB bandwidth per month
- Image and video transformations

This is more than enough for a personal file sharing app.
