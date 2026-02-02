# API Configuration Guide

This guide will help you set up the necessary API integrations for the AI Clothing Sorting app.

## Required APIs

### 1. OpenAI API (For AI-Generated Descriptions)

**Purpose**: Generate product descriptions, titles, and tags based on voice input

**Setup Steps**:

1. Go to https://platform.openai.com/
2. Sign up or log in
3. Navigate to API Keys section
4. Click "Create new secret key"
5. Copy the key and add to `.env`:
   ```
   VITE_OPENAI_API_KEY=sk-...your-key-here
   ```

**Cost**: Pay-as-you-go, typically $0.002 per 1K tokens

### 2. Google Sheets API

**Purpose**: Export product data to Google Sheets for easy management

**Setup Steps**:

1. Go to https://console.cloud.google.com/
2. Create a new project or select existing one
3. Enable the Google Sheets API:
   - Click "Enable APIs and Services"
   - Search for "Google Sheets API"
   - Click "Enable"
4. Create credentials:
   - Go to "Credentials" → "Create Credentials"
   - Select "API Key"
   - Copy the API key
5. Create OAuth 2.0 Client ID:
   - Click "Create Credentials" → "OAuth client ID"
   - Choose "Web application"
   - Add authorized JavaScript origins:
     - `http://localhost:5173` (for development)
     - Your production URL (when deployed)
   - Add authorized redirect URIs if needed
   - Copy the Client ID
6. Add to `.env`:
   ```
   VITE_GOOGLE_API_KEY=your-api-key
   VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   ```

**Cost**: Free (quota: 500 requests per 100 seconds per project)

### 3. Google Cloud Vision API (Optional - Advanced)

**Purpose**: Enhanced AI image recognition for better clothing categorization

**Setup Steps**:

1. In Google Cloud Console, enable Cloud Vision API
2. Use the same API key from Google Sheets setup
3. Add to `.env`:
   ```
   VITE_GOOGLE_VISION_API_KEY=your-api-key
   ```

**Cost**: First 1,000 units/month free, then $1.50 per 1,000 units

## Implementation Notes

### Using OpenAI in Production

In `ProductDescriptionGenerator.tsx`, replace the mock generation with:

```typescript
const handleGenerateProductInfo = async () => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{
        role: 'user',
        content: `Generate a product listing for this clothing item: ${currentItem.voiceDescription}. Include:
        - SEO-friendly title
        - Detailed description (2-3 sentences)
        - Suggested price (USD)
        - 5 relevant tags
        Category: ${currentItem.category}`
      }]
    })
  });
  
  const data = await response.json();
  // Parse and apply the generated content
};
```

### Using Google Sheets API

In `GoogleSheetExporter.tsx`, replace the mock export with:

```typescript
const handleExportToGoogleSheets = async () => {
  // 1. Load Google API client
  await gapi.load('client:auth2');
  
  // 2. Initialize
  await gapi.client.init({
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY,
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
    scope: 'https://www.googleapis.com/auth/spreadsheets'
  });
  
  // 3. Sign in
  await gapi.auth2.getAuthInstance().signIn();
  
  // 4. Create or update spreadsheet
  const response = await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId: 'your-sheet-id',
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    resource: {
      values: formatDataForSheets(items)
    }
  });
};
```

## Environment Variables Summary

Create a `.env` file in your project root with these variables:

```env
# Required for AI features
VITE_OPENAI_API_KEY=sk-...

# Required for Google Sheets export
VITE_GOOGLE_API_KEY=AIza...
VITE_GOOGLE_CLIENT_ID=123456789-....apps.googleusercontent.com

# Optional for advanced image recognition
VITE_GOOGLE_VISION_API_KEY=AIza...
```

## Security Best Practices

1. **Never commit `.env` file**: Already in `.gitignore`
2. **Use environment-specific keys**: Different keys for dev/prod
3. **Rotate keys regularly**: Update API keys every 3-6 months
4. **Set up API restrictions**: Limit API keys to specific domains
5. **Monitor usage**: Set up billing alerts in Google Cloud

## Testing Without APIs

The app includes mock implementations for all features, so you can:
- Test the UI flow without API keys
- Demo the app to stakeholders
- Develop new features locally

Simply leave the `.env` variables empty or use placeholder values.

## Troubleshooting

### "API key not valid" error
- Check that the key is correctly copied (no extra spaces)
- Verify the API is enabled in Google Cloud Console
- Ensure billing is enabled for paid APIs

### CORS errors with Google APIs
- Add your domain to authorized JavaScript origins
- For localhost, use `http://localhost:5173` (not `127.0.0.1`)

### OpenAI rate limit errors
- Check your usage limits on OpenAI dashboard
- Add rate limiting to your requests
- Consider upgrading your plan

## Next Steps

After setting up APIs:
1. Test each feature individually
2. Monitor API usage and costs
3. Implement error handling for API failures
4. Add loading states for better UX
5. Consider caching responses to reduce API calls
