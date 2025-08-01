# 🚀 Google Photos Integration - Setup Guide

## You're 3 steps away from Google Photos integration!

### Step 1: Get Google API Credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the "Photos Library API"
4. Go to "Credentials" → "Create Credentials" → "API Key"
5. Copy your API Key
6. Create "OAuth 2.0 Client ID" for web application
7. Copy your Client ID

### Step 2: Update the Config File
Open `src/app/services/google-photos-config.ts` and replace:
```typescript
export const GOOGLE_PHOTOS_CONFIG: GooglePhotosConfig = {
  clientId: 'YOUR_ACTUAL_CLIENT_ID_HERE',
  apiKey: 'YOUR_ACTUAL_API_KEY_HERE',
  albumId: 'OPTIONAL_ALBUM_ID_HERE' // Leave empty for all photos
};
```

### Step 3: Run the App
```bash
npm start
```

Click "Sync Google Photos" button and you're done! 🎉

## Optional: Use Specific Album
If you want to use a specific album:
1. Create an album in Google Photos
2. Get the album ID from the URL
3. Put it in the `albumId` field in the config

## That's It!
The integration handles everything else automatically:
- Authentication
- Photo loading
- Error handling
- Fallback to mock data

## Troubleshooting
- Make sure your domain is added to authorized origins in Google Console
- Check browser console for any errors
- Photos API might take a moment to activate after enabling