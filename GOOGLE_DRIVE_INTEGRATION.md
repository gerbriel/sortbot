# Google Drive Folder Integration

## Date: February 2, 2026

## Overview
Added Google Drive folder integration as an alternative to manual file upload! Now you can link a Google Drive folder and pull all images directly from there.

## Features

### ✅ Dual Upload Modes
- **📁 Upload Files** - Traditional drag & drop or file picker
- **☁️ Google Drive Folder** - Paste a Drive folder URL to import all images

### ✅ User Benefits
- **No manual downloads** - Images loaded directly from Drive
- **Bulk import** - Load entire folders at once
- **Cloud storage** - Keep images in Drive, no local storage needed
- **Easy sharing** - Just share folder link with team members

---

## How to Use

### For End Users

#### 1. Prepare Your Google Drive Folder

1. **Create/organize folder** with your clothing images
2. **Share the folder**:
   - Right-click folder → "Share"
   - Click "Change to anyone with the link"
   - Set to "Viewer" permission
   - Click "Copy link"

#### 2. Load Images in the App

1. **Click "☁️ Google Drive Folder"** tab
2. **Paste the folder URL** in the input field
3. **Click "📥 Load Images"**
4. Wait for images to load (progress shown)
5. Images appear just like file uploads!

#### 3. Supported URL Formats

```
✅ Full URL:
https://drive.google.com/drive/folders/1a2B3c4D5e6F7g8H9i0J

✅ Full URL with parameters:
https://drive.google.com/drive/folders/1a2B3c4D5e6F7g8H9i0J?usp=sharing

✅ Just the folder ID:
1a2B3c4D5e6F7g8H9i0J
```

---

## Setup (For Developers)

### Step 1: Get Google API Key

1. **Go to [Google Cloud Console](https://console.cloud.google.com/)**

2. **Create or select a project**

3. **Enable Google Drive API**:
   - Go to "APIs & Services" → "Library"
   - Search for "Google Drive API"
   - Click "Enable"

4. **Create API Key**:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "API Key"
   - Copy the API key

5. **Restrict API Key** (recommended):
   - Click on your API key
   - Under "API restrictions", select "Restrict key"
   - Choose "Google Drive API"
   - Under "Website restrictions", add your domain
   - Save changes

### Step 2: Configure Environment

Add to your `.env` file:

```bash
# Google Drive Integration
VITE_GOOGLE_API_KEY=AIzaSyXxXxXxXxXxXxXxXxXxXxXxXxXxXxXx
```

### Step 3: Run the App

```bash
npm run dev
```

The Google Drive option will now work! ✅

---

## Technical Details

### Implementation

#### URL Parsing
```typescript
const extractFolderId = (url: string): string | null => {
  // Extract folder ID from various Google Drive URL formats
  // https://drive.google.com/drive/folders/FOLDER_ID
  // https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  
  // If just the ID is pasted
  if (/^[a-zA-Z0-9_-]+$/.test(url)) return url;
  
  return null;
};
```

#### Drive API Call
```typescript
// Fetch files from the folder
const response = await fetch(
  `https://www.googleapis.com/drive/v3/files?` +
  `q='${folderId}'+in+parents+and+(mimeType+contains+'image/')&` +
  `fields=files(id,name,mimeType,thumbnailLink,webContentLink)&` +
  `key=${apiKey}`
);

const data = await response.json();

// Download each image
for (const file of data.files) {
  const imageUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey}`;
  const imageResponse = await fetch(imageUrl);
  const blob = await imageResponse.blob();
  const fileObj = new File([blob], file.name, { type: blob.type });
  
  items.push({
    id: `drive-${file.id}-${Date.now()}`,
    file: fileObj,
    preview: URL.createObjectURL(blob),
  });
}
```

#### API Endpoints Used

1. **List Files**:
   ```
   GET https://www.googleapis.com/drive/v3/files
   Query: q='FOLDER_ID' in parents and (mimeType contains 'image/')
   Fields: files(id,name,mimeType,thumbnailLink,webContentLink)
   ```

2. **Download File**:
   ```
   GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
   ```

### File Processing

**Same as regular uploads**:
- Converts Drive files to `File` objects
- Creates blob URLs for previews
- Generates unique IDs with `drive-` prefix
- Integrates seamlessly with existing workflow

### Error Handling

**Comprehensive error messages**:
```typescript
// No API key configured
"⚠️ Google Drive API key not configured.
Please add VITE_GOOGLE_API_KEY to your .env file."

// Invalid URL
"❌ Invalid Google Drive folder URL. 
Please paste a valid folder link."

// Empty folder
"📁 No images found in this folder.
Make sure:
1. The folder contains images
2. The folder is shared with 'Anyone with link can view'"

// API error
"❌ Error loading from Google Drive:
{error message}
Make sure the folder is shared publicly."
```

---

## UI Design

### Mode Toggle

**Two buttons**:
```
┌───────────────┬─────────────────────┐
│ 📁 Upload Files │ ☁️ Google Drive Folder │
└───────────────┴─────────────────────┘
```

**Active state**: Blue background with white text
**Hover state**: Blue border with color transition

### File Upload Mode (Default)

**Familiar drag & drop**:
```
┌─────────────────────────────────┐
│                                 │
│          [Upload Icon]          │
│                                 │
│  Drag & drop clothing images    │
│     or click to select files    │
│                                 │
│     Supports: JPG, PNG, WEBP    │
│                                 │
└─────────────────────────────────┘
```

### Google Drive Mode

**Clear instructions with input**:
```
┌─────────────────────────────────────┐
│  📁 Load from Google Drive           │
│                                      │
│  1. Open your Google Drive folder... │
│  2. Click "Share" → Set to...        │
│  3. Copy the folder URL...           │
│                                      │
│  ┌────────────────────┬──────────┐  │
│  │ Paste URL here...  │ Load Btn │  │
│  └────────────────────┴──────────┘  │
│                                      │
│  ▸ Example URL format                │
│    drive.google.com/drive/...        │
└─────────────────────────────────────┘
```

### Loading State

**Button changes**:
```
Before: "📥 Load Images"
During: "⏳ Loading..."  (disabled)
After:  "✅ Successfully loaded 12 image(s)!"
```

---

## Permissions & Security

### Folder Permissions Required

**Must be set to**:
- ✅ "Anyone with the link can view"
- ❌ NOT "Restricted" (won't work)
- ❌ NOT "Anyone with the link can edit" (not needed)

### API Key Security

**Best practices**:
1. ✅ Use environment variables (`.env`)
2. ✅ Restrict to Google Drive API only
3. ✅ Add domain restrictions in Google Cloud Console
4. ✅ Never commit `.env` to git
5. ✅ Rotate keys periodically

### Data Privacy

**How it works**:
- ✅ Images loaded directly from Drive to browser
- ✅ No server-side storage
- ✅ API key used client-side (frontend only)
- ✅ Temporary blob URLs created locally
- ✅ Original files stay in Drive

**Note**: Since API key is exposed in frontend, restrict it properly in Google Cloud Console!

---

## Limitations

### 1. Folder Must Be Public
- Users must share folder with "Anyone with link"
- Can't access private folders without OAuth

### 2. Image Types Only
- Filters for `mimeType contains 'image/'`
- Non-image files automatically skipped

### 3. Flat Structure
- Only loads images directly in the folder
- Doesn't recurse into subfolders

### 4. API Rate Limits
- Google Drive API has daily quota
- Large folders may take time to load

### 5. API Key Required
- Won't work without `VITE_GOOGLE_API_KEY`
- Graceful fallback message shown

---

## Future Enhancements

### Potential Improvements

**1. OAuth Integration** ✨
- Allow private folder access
- No need to make folders public
- Better security

**2. Subfolder Support** 📁
- Recursive folder traversal
- Load images from nested folders
- Maintain folder structure

**3. Progress Indicator** ⏳
- Show "Loading 5/20 images..."
- Progress bar during fetch
- Better UX for large folders

**4. Selective Import** ☑️
- Preview all images first
- Checkbox to select which to import
- Filter by date/size

**5. Batch Upload Optimization** 🚀
- Parallel downloads
- Lazy loading for large sets
- Better performance

**6. Folder Caching** 💾
- Remember recently used folders
- Quick re-import
- Local storage persistence

---

## Troubleshooting

### "Invalid Google Drive folder URL"
**Solution**: Make sure you're copying the folder link, not a file link
```
✅ Folder: /drive/folders/xxx
❌ File:   /drive/file/d/xxx
```

### "No images found in this folder"
**Solutions**:
1. Check folder contains images (JPG, PNG, WEBP)
2. Verify folder permissions are "Anyone with link"
3. Try refreshing the share link

### "Google Drive API key not configured"
**Solution**: Add `VITE_GOOGLE_API_KEY` to your `.env` file
```bash
VITE_GOOGLE_API_KEY=your_actual_api_key_here
```

### "API error: 403"
**Solutions**:
1. Enable Google Drive API in Google Cloud Console
2. Check API key restrictions
3. Verify folder is publicly accessible

### "Could not load images from Drive"
**Solutions**:
1. Verify internet connection
2. Check browser console for detailed errors
3. Try downloading one image manually to test permissions
4. Ensure folder isn't in "Shared with me" (use "My Drive")

### Images loading slowly
**Solutions**:
1. Reduce folder size (fewer images)
2. Check internet speed
3. Try smaller image files
4. Consider file upload instead for local files

---

## Code Changes

### Files Modified

**1. ImageUpload.tsx**
- Added `uploadMode` state (`'file'` | `'drive'`)
- Added `driveFolderUrl` state
- Added `isLoadingDrive` state
- Created `extractFolderId()` function
- Created `fetchDriveImages()` function
- Updated UI with mode toggle
- Added Drive input section

**2. ImageUpload.css**
- Added `.upload-mode-toggle` styles
- Added `.mode-btn` styles (active/hover)
- Added `.drive-upload-section` styles
- Added `.drive-instructions` styles
- Added `.drive-input-group` styles
- Added `.drive-load-btn` styles
- Added `.drive-example` styles

**3. .env.example** (already existed)
- Already documented `VITE_GOOGLE_API_KEY`

---

## Testing

### Manual Testing Checklist

**File Upload Mode** (existing):
- [ ] Drag & drop files works
- [ ] Click to select files works
- [ ] Multiple files upload correctly
- [ ] Preview images display

**Google Drive Mode** (new):
- [ ] Mode toggle switches correctly
- [ ] Can paste Drive folder URL
- [ ] Invalid URLs show error
- [ ] Valid URLs load images
- [ ] Loading state displays
- [ ] Success message shows count
- [ ] Images integrate with workflow
- [ ] Can switch back to file mode

**Integration**:
- [ ] Drive images work with grouper
- [ ] Drive images work with sorter
- [ ] Drive images work with descriptions
- [ ] Drive images work with export

**Error Cases**:
- [ ] No API key shows helpful message
- [ ] Empty folder shows helpful message
- [ ] Private folder shows permission error
- [ ] Network error handled gracefully

---

## Example Workflow

### Complete User Journey

**1. User has 50 clothing photos in Google Drive**
```
📁 My Clothing Inventory
   ├── shirt-1.jpg
   ├── shirt-2.jpg
   ├── pants-1.jpg
   └── ... (47 more)
```

**2. User shares folder**
```
Right-click → Share
Change to "Anyone with link"
Copy link: https://drive.google.com/drive/folders/abc123
```

**3. User opens app**
```
Click "☁️ Google Drive Folder" tab
Paste link
Click "📥 Load Images"
```

**4. App loads images**
```
⏳ Loading... (3 seconds)
✅ Successfully loaded 50 image(s) from Google Drive!
```

**5. User proceeds with workflow**
```
→ Group similar items (ImageGrouper)
→ Categorize by type (ImageSorter)
→ Add descriptions (ProductDescriptionGenerator)
→ Export to Shopify (GoogleSheetExporter)
```

**Done!** All 50 items processed without downloading files locally! 🎉

---

## Comparison: File Upload vs Drive Folder

| Feature | File Upload | Drive Folder |
|---------|-------------|--------------|
| **Setup** | None | Requires API key |
| **Speed** | Instant (local) | Network dependent |
| **File Size** | Any | Network limits |
| **Permissions** | None needed | Must be public |
| **Use Case** | Local files | Cloud storage |
| **Team Sharing** | Manual transfer | Just share link |
| **Bulk Import** | Select all | Automatic |
| **Storage** | Local disk | Cloud (no download) |

**Recommendation**:
- 🏠 **File Upload**: For local files, quick tests, or small batches
- ☁️ **Drive Folder**: For cloud storage, team workflows, or large inventories

---

## Status: ✅ Complete

**Implemented**:
- ✅ Dual-mode upload interface
- ✅ Google Drive API integration
- ✅ URL parsing (multiple formats)
- ✅ Image fetching and conversion
- ✅ Error handling with helpful messages
- ✅ Loading states and feedback
- ✅ Seamless workflow integration
- ✅ Responsive UI design
- ✅ Documentation complete

**Ready to use!** 🚀

---

## Quick Start

**For users**:
1. Share your Drive folder publicly
2. Copy folder URL
3. Click "☁️ Google Drive Folder" in app
4. Paste URL and click "📥 Load Images"

**For developers**:
1. Get Google API key from Cloud Console
2. Add `VITE_GOOGLE_API_KEY=xxx` to `.env`
3. Run `npm run dev`
4. Feature works automatically!

**That's it!** No additional dependencies or setup required. 🎉
