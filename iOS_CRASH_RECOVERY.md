# iOS Browser Crash Recovery for Large Files

## Problem

When transferring large files (100MB+) from PC to iOS, if the browser crashes or reloads before download is initiated, the received file data is lost because it's stored only in memory.

**Example:** 566.9 MB file transfer → Browser crashes → File data lost

## Solution Implemented

We've added **IndexedDB persistence** to automatically save received files to persistent storage. This allows recovery even if:

- Browser crashes during or after transfer
- User accidentally closes the tab
- Device runs out of memory
- Network connection drops after completion

## How It Works

### 1. **Automatic File Persistence**

When a file transfer completes:

- The file blob is automatically saved to IndexedDB (browser's persistent database)
- This happens on both iOS Safari and Android Chrome
- Files are stored with timestamp metadata

### 2. **Crash Recovery on Page Load**

When you return to the app:

- App checks IndexedDB for any persisted files
- Any recovered files are automatically displayed in the "Received" tab
- You get a notification showing how many files were recovered
- You can download them normally

### 3. **Automatic Cleanup**

After downloading:

- File is automatically deleted from IndexedDB
- Storage is freed up for new transfers

## What Changed

### Code Updates

**`public/js/webrtc.js`**

- Modified `handleFileComplete()` to persist files to IndexedDB

**`public/js/app.js`**

- Added IndexedDB initialization and persistence functions
- Added `restoreReceivedFilesFromDB()` called on page load
- Enhanced `downloadFile()` with automatic cleanup
- New functions:
  - `persistReceivedFile()` - Save file to IndexedDB
  - `getReceivedFileFromDB()` - Retrieve single file
  - `getAllReceivedFilesFromDB()` - Get all persisted files
  - `deleteReceivedFileFromDB()` - Delete after download

## What You Should Do

### iOS Users

1. **After transfer completes:** Do NOT refresh/close the browser
2. **Click download** immediately while file is in memory
3. **If browser crashes:** Reopen the app → Check "Received" tab → Your files will be there!

### Why Android Works Fine

Android Chrome has better memory management for large files and crashes less frequently during transfers. The added IndexedDB persistence benefits both iOS and Android equally.

## Storage Limits

- **IndexedDB storage:** Typically 50MB-1GB per origin (depends on browser)
- **For files >100MB:** IndexedDB may fail → Falls back to in-memory storage (original behavior)
- **Recommendation:** Download files as soon as possible

## Browser Support

✅ iOS Safari 11+
✅ Android Chrome
✅ Firefox
✅ Edge

## Troubleshooting

### Files not showing after browser crash?

1. Check browser console (Safari: Settings > Advanced > Web Inspector)
2. Verify you have enough storage space
3. Try clearing browser cache and retrying

### Still losing files?

1. Download immediately after transfer completes
2. Use a larger device with more RAM for huge transfers
3. Consider splitting very large files into multiple transfers

## Technical Details

### IndexedDB Configuration

- Database: `shareup_files_db`
- Store: `received_files`
- Key: `timestamp-filename` format

### Performance Impact

- Minimal: File persistence runs asynchronously after transfer complete
- No slowdown to actual transfer speeds
- Download remains instant

## Future Improvements

- Add manual file management UI (delete specific files)
- Add storage quota display
- Add pause/resume for transfers (reduces crash likelihood)
- Auto-cleanup old files (>7 days)
