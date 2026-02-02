# Dynamic Google Sheets URL Input

## Date: February 2, 2026

## Overview
Changed from hardcoded Google Sheets URL to a user-provided input field. Users can now paste their own Google Sheets URL for one-time or recurring use.

## Problem
Before: The Google Sheets URL was hardcoded in the app:
```typescript
const sheetUrl = 'https://docs.google.com/spreadsheets/d/1dr5an9GjbXnGFTKCNGmQATAuIQDzAGgqtSgp9ta4flM/edit';
```

This meant:
- ❌ Only one person could use the sheet
- ❌ Hard to change without modifying code
- ❌ Not flexible for different users/projects

## Solution
Added a user-friendly input section where anyone can paste their Google Sheets URL.

## How It Works

### User Flow:

1. **Get Your Google Sheets URL**
   - Open Google Drive
   - Create a new Google Sheet OR open existing one
   - Copy the URL from browser address bar
   - Example: `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`

2. **Paste URL in App**
   - Navigate to Step 5 (Export)
   - Find "Google Sheets Configuration" section
   - Paste URL in input field
   - Click "Save URL"

3. **Confirmation**
   - Green checkmark appears: ✓ Connected to: [your sheet URL]
   - Clickable link to verify correct sheet

4. **Export**
   - Click "Export to Google Sheets"
   - Data will be prepared for your specific sheet
   - (In production: actual API call to write data)

5. **Download CSV Alternative**
   - Don't have a Google Sheet? No problem!
   - Click "Download Shopify CSV" instead
   - Import manually to Google Sheets or Shopify

## UI Features

### Input Section

```
┌─────────────────────────────────────────────────────┐
│ Google Sheets Configuration                         │
│ Paste your Google Sheets URL to export directly     │
│                                                      │
│ [Input Field: https://docs.google.com/...] [Save]   │
│                                                      │
│ ✓ Connected to: https://docs.google.com/spread...   │
│                                                      │
│ How to get your Google Sheets URL:                  │
│ 1. Open or create a Google Sheet                    │
│ 2. Copy the URL from your browser                   │
│ 3. Paste it in the field above                      │
│ 4. Click "Save URL"                                  │
└─────────────────────────────────────────────────────┘
```

### Visual Elements

**Input Field**:
- Monospace font (easier to read long URLs)
- Placeholder shows example format
- Blue focus state
- Full width for long URLs

**Save Button**:
- Secondary button style
- Disabled if input is empty
- Validates URL format

**Success Banner** (after saving):
- Green background with checkmark
- Shows truncated URL (first 60 chars)
- Clickable link to open sheet in new tab

**Help Section**:
- Light background
- Step-by-step instructions
- Always visible for reference

## Validation

### URL Format Check
```typescript
if (!tempSheetUrl.includes('docs.google.com/spreadsheets')) {
  alert('Please enter a valid Google Sheets URL');
  return;
}
```

**Valid URLs**:
✅ `https://docs.google.com/spreadsheets/d/ABC123/edit`  
✅ `https://docs.google.com/spreadsheets/d/ABC123/edit?gid=0`  
✅ `https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0`

**Invalid URLs**:
❌ `https://google.com`  
❌ `https://drive.google.com/file/d/123`  
❌ `not a url`

### Export Validation
```typescript
if (!sheetUrl || sheetUrl.trim() === '') {
  alert('Please enter a Google Sheets URL first');
  return;
}
```

Won't let you export without saving a URL first!

## Technical Implementation

### State Management
```typescript
const [sheetUrl, setSheetUrl] = useState('');        // Saved URL
const [tempSheetUrl, setTempSheetUrl] = useState(''); // Input field value
```

**Why two states?**
- `tempSheetUrl`: What user is typing (can be invalid)
- `sheetUrl`: Validated, saved URL (only valid URLs)

### Save Process
```typescript
<button
  onClick={() => {
    if (tempSheetUrl.includes('docs.google.com/spreadsheets')) {
      setSheetUrl(tempSheetUrl);
      alert('✓ Google Sheets URL saved!');
    } else {
      alert('Please enter a valid Google Sheets URL');
    }
  }}
>
  Save URL
</button>
```

### Export Process
```typescript
const handleExportToGoogleSheets = async () => {
  // Validate URL exists
  if (!sheetUrl || sheetUrl.trim() === '') {
    alert('Please enter a Google Sheets URL first');
    return;
  }
  
  // Validate URL format
  if (!sheetUrl.includes('docs.google.com/spreadsheets')) {
    alert('Please enter a valid Google Sheets URL');
    return;
  }
  
  // Prepare data for the user's specific sheet
  const sheetData = products.map(product => ({
    // ... product data
  }));
  
  console.log('Ready to export to:', sheetUrl);
  console.log('Data:', sheetData);
  
  // In production: Make API call to Google Sheets
  // await writeToGoogleSheet(sheetUrl, sheetData);
};
```

## User Scenarios

### Scenario 1: First Time User

**Steps**:
1. Complete all product processing
2. Reach Step 5 (Export)
3. See empty input field
4. Open Google Sheets, create new sheet
5. Copy URL: `https://docs.google.com/spreadsheets/d/ABC123/edit`
6. Paste into app
7. Click "Save URL"
8. See green confirmation
9. Click "Export to Google Sheets"
10. Data prepared for export

### Scenario 2: Returning User

**Steps**:
1. Complete product processing
2. Reach Step 5
3. Input field empty (state not persisted across sessions)
4. Paste previously used URL
5. Click "Save URL"
6. Export

**Note**: URL is not saved permanently (by design). Prevents accidentally exporting to wrong sheet.

### Scenario 3: Multiple Projects

**Steps**:
1. **Project A**: Paste Sheet A URL, export
2. **Project B**: Paste Sheet B URL, export
3. Each project goes to correct sheet

**Benefit**: Flexible for different clients/projects!

### Scenario 4: No Google Sheets

**Steps**:
1. Don't have Google Sheets? No problem!
2. Skip the URL input section
3. Click "Download Shopify CSV" instead
4. Upload CSV to:
   - Google Sheets manually
   - Shopify directly
   - Excel for editing

## Future Enhancements

### Persistence (Optional)
Save URL in localStorage for convenience:
```typescript
// On save
localStorage.setItem('lastGoogleSheetUrl', sheetUrl);

// On component mount
useEffect(() => {
  const savedUrl = localStorage.getItem('lastGoogleSheetUrl');
  if (savedUrl) {
    setTempSheetUrl(savedUrl);
  }
}, []);
```

### Google Sheets API Integration
When implementing real export:
```typescript
import { google } from 'googleapis';

const handleExportToGoogleSheets = async () => {
  // 1. Authenticate user with OAuth
  const auth = await authenticateWithGoogle();
  
  // 2. Extract sheet ID from URL
  const sheetId = extractSheetId(sheetUrl);
  
  // 3. Format data
  const values = [
    ['Title', 'Handle', 'Category', ...],
    ...products.map(p => [p.seoTitle, p.handle, ...])
  ];
  
  // 4. Write to sheet
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    resource: { values }
  });
  
  setExportStatus('success');
};
```

### Sheet Selection
If user has multiple sheets in one workbook:
```typescript
<select>
  <option>Sheet1</option>
  <option>Products</option>
  <option>Inventory</option>
</select>
```

### Recent URLs
Show list of recently used URLs:
```typescript
<div className="recent-urls">
  <h4>Recent Sheets:</h4>
  {recentUrls.map(url => (
    <button onClick={() => setTempSheetUrl(url)}>
      {url.substring(0, 50)}...
    </button>
  ))}
</div>
```

## Files Modified

1. **GoogleSheetExporter.tsx**
   - Changed hardcoded `sheetUrl` to state variable
   - Added `tempSheetUrl` for input field
   - Added URL validation before export
   - Added input UI section with instructions
   - Added success banner with clickable link

2. **GoogleSheetExporter.css**
   - Added `.google-sheets-input-section` styling
   - Added `.sheet-url-input-group` flexbox layout
   - Added `.sheet-url-input` with monospace font
   - Added `.sheet-url-saved` success banner (green)
   - Added `.sheet-url-help` instruction box
   - Focus states and transitions

## Benefits

### For Users:
✅ **Flexible** - Use any Google Sheet you own  
✅ **No coding** - Just paste URL  
✅ **Validated** - Can't enter invalid URLs  
✅ **Confirmed** - See what sheet you're connected to  
✅ **Safe** - URL not permanently stored (privacy)  

### For Different Use Cases:
✅ **Personal use** - Your own inventory sheets  
✅ **Client work** - Different sheet per client  
✅ **Multiple projects** - Switch between sheets easily  
✅ **Testing** - Use test sheet without affecting production  

### For Development:
✅ **No hardcoding** - Clean, maintainable code  
✅ **Easy to extend** - Can add localStorage, API, etc.  
✅ **User-friendly** - Clear instructions  
✅ **Validated** - Prevents common errors  

## Example URLs

### Personal Inventory
```
https://docs.google.com/spreadsheets/d/1abc123xyz/edit
```

### Client Project
```
https://docs.google.com/spreadsheets/d/1clientABC/edit?gid=0
```

### Test Sheet
```
https://docs.google.com/spreadsheets/d/1testSheet123/edit#gid=0
```

All formats work! Just needs `docs.google.com/spreadsheets` in the URL.

## Status: ✅ Complete

Users can now paste their own Google Sheets URL instead of using a hardcoded one!
