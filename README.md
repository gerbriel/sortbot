# AI Clothing Sorting & Export App

A React-based web application for automatically sorting, categorizing, and exporting clothing product images to Google Sheets and Shopify.

## Features

✨ **Batch Image Upload** - Process 100+ images at once with drag-and-drop
☁️ **Google Drive Integration** - Load images directly from Drive folders (no downloads!)
🤖 **AI-Powered Sorting** - Automatic categorization into 10 clothing types
📦 **Product Grouping** - Combine multiple images of the same product
🎤 **Voice Descriptions** - Text-to-speech for product descriptions
📝 **Smart Product Generation** - Template-based system auto-generates SEO-friendly descriptions, titles, tags, and pricing (no API required!)
📊 **Google Sheets Export** - Direct export to Google Sheets
🛍️ **Shopify Ready** - CSV export in Shopify-compatible format
🔒 **Password Protection** - Built-in authentication for security

## Tech Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: CSS3 with modern features
- **File Upload**: react-dropzone
- **Product Intelligence**: Template-based with 600+ brand database (works offline!)
- **Google Sheets**: Google Sheets API
- **Speech Recognition**: Web Speech API / react-speech-recognition

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Google Cloud Project (for Google Sheets API)
- A secure password for app access

### Installation

1. Clone the repository
```bash
git clone <your-repo-url>
cd sortingapp
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
# Security - App Password
VITE_APP_PASSWORD=your_secure_password_here
VITE_DISABLE_AUTH=false  # Set to true only for local dev

# Google Cloud (for Google Sheets integration)
VITE_GOOGLE_CLIENT_ID=your_google_client_id
VITE_GOOGLE_API_KEY=your_google_api_key

# Optional: OpenAI API (NOT required - template system works without it)
VITE_OPENAI_API_KEY=your_openai_api_key_here

# Optional: Google Vision API (for advanced image recognition)
VITE_GOOGLE_VISION_API_KEY=your_vision_api_key
```

**Note**: The product description generation uses an intelligent template-based system that works **without any AI API keys**. See [TEMPLATE_BASED_AI_SYSTEM.md](TEMPLATE_BASED_AI_SYSTEM.md) for details.

### Development

Run the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

The production-ready files will be in the `dist` directory.

## Usage

### Authentication
- On first visit, enter your password (set in `.env`)
- Session lasts 8 hours
- For development, set `VITE_DISABLE_AUTH=true` to skip login

### Step 1: Upload Images

**Option A: File Upload**
- Drag and drop or click to select multiple clothing images
- Supports JPG, PNG, and WEBP formats
- **Batch processing**: Upload 100+ images at once

**Option B: Google Drive Folder** ☁️ NEW!
- Click "☁️ Google Drive Folder" tab
- Share your Drive folder with "Anyone with link can view"
- Paste the folder URL
- Click "📥 Load Images" to import all images directly
- No need to download files locally!

See [GOOGLE_DRIVE_INTEGRATION.md](./GOOGLE_DRIVE_INTEGRATION.md) for detailed setup instructions.

### Step 2: AI Sorting
- Click "Auto-Sort with AI" to automatically categorize images
- Or manually select categories for each item
- Categories: Tops, Bottoms, Dresses, Outerwear, Shoes, Accessories, etc.

### Step 3: Group Products
- **NEW**: Combine multiple images of the same product
- Click images to select, then "Group Selected"
- Or use "Auto-Group Similar" for automatic grouping
- Each group becomes one product with multiple images

### Step 4: Add Descriptions
- For each item, click "Start Recording" to add a voice description
- **Real speech recognition** - your browser will request microphone access
- Speak naturally: "black rolling stones shirt, 80s, rock, excellent condition, $50"
- Click "Stop Recording" when done
- System transcribes in real-time with live preview
- Click "Generate Product Info with AI" to create:
  - **Natural reconstruction**: Extracts keywords and rebuilds professionally
    - Input: "black rolling stones shirt. rock at 80's"
    - Output: "80s Rolling Stones black t-shirts featuring graphic details"
  - **Deep knowledge expansion**: Adds 300+ contextual snippets
    - Brand heritage (Supreme NYC roots, Levi's 1873 invention)
    - Subcultures (punk DIY, grunge thrift aesthetic)
    - Materials (selvage denim, Gore-Tex membrane)
    - Era context (90s quality manufacturing, 80s maximalism)
  - SEO-friendly product title
  - Pricing suggestion
  - Relevant tags
- Edit any generated content as needed
- See [VOICE_RECONSTRUCTION_EXAMPLES.md](./VOICE_RECONSTRUCTION_EXAMPLES.md) for before/after examples

### Step 5: Export
- **Google Sheets**: Direct export to a new or existing spreadsheet
- **Shopify CSV**: Download a CSV file formatted for Shopify import
  - Go to Shopify Admin → Products → Import
  - Upload the downloaded CSV file

## API Integration Setup

### Google Sheets API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google Sheets API
4. Create credentials (API Key + OAuth 2.0 Client ID)
5. Add authorized JavaScript origins (e.g., `http://localhost:5173`)
6. Copy credentials to `.env` file

### OpenAI API

1. Sign up at [OpenAI Platform](https://platform.openai.com/)
2. Generate an API key
3. Add to `.env` file as `VITE_OPENAI_API_KEY`

### Google Vision API (Optional)

For advanced image recognition:
1. Enable Cloud Vision API in Google Cloud Console
2. Create API credentials
3. Add to `.env` file

## Project Structure

```
sortingapp/
├── src/
│   ├── components/
│   │   ├── Auth.tsx                  # Password authentication
│   │   ├── ImageUpload.tsx           # Drag & drop upload
│   │   ├── ImageSorter.tsx           # AI categorization
│   │   ├── ImageGrouper.tsx          # Product grouping (NEW)
│   │   ├── ProductDescriptionGenerator.tsx  # Voice + AI
│   │   └── GoogleSheetExporter.tsx   # Export functionality
│   ├── services/
│   │   └── api.ts                    # API integration helpers
│   ├── App.tsx                       # Main application
│   ├── App.css                       # Global styles
│   └── main.tsx                      # Entry point
├── .github/
│   └── copilot-instructions.md       # Project tracking
├── README.md                         # This file
├── QUICKSTART.md                     # 5-minute setup guide
├── API_SETUP.md                      # Detailed API configuration
├── DEPLOYMENT.md                     # Production deployment guide
├── SECURITY.md                       # Security best practices (NEW)
├── BATCH_PROCESSING.md               # Batch processing guide (NEW)
├── .env.example                      # Environment template
└── package.json                      # Dependencies
```

## 🎤 Speech Recognition

Real-time voice-to-text powered by Web Speech API:

### How it Works
1. Click "🎤 Start Recording"
2. Allow microphone access (browser prompt)
3. Speak your product description
4. See real-time transcription
5. Click "⏹ Stop Recording"

### Browser Support
- ✅ Chrome (Desktop & Mobile) - Best
- ✅ Edge (Desktop & Mobile) - Best  
- ✅ Safari (macOS & iOS 14.5+) - Good
- ❌ Firefox - Not supported yet

**📖 See SPEECH_GUIDE.md for detailed usage tips**

## 🔒 Security for Personal Use

This app is designed for safe deployment on your personal GitHub account:

### Built-in Security Features
- ✅ **Password Protection** - Requires login on first visit
- ✅ **Session Management** - Expires after 8 hours
- ✅ **Rate Limiting** - Prevents brute force attacks
- ✅ **Environment Variables** - API keys never in code

### Recommended Setup
1. Set strong password in `.env`
2. Restrict Google API keys to your domain
3. Set OpenAI usage limits
4. Consider making GitHub repo private
5. Use Vercel's password protection feature

**📖 See SECURITY.md for complete security guide**

## 📦 Batch Processing

Process 100+ images efficiently:

### Features
- Upload multiple images at once
- Auto-group similar products
- Bulk AI description generation
- Export all items in one CSV

### Best Practices
- Process 50-100 items per batch
- Compress images before upload (< 2MB)
- Use consistent naming conventions
- Group images of same product together

**📖 See BATCH_PROCESSING.md for detailed guide**

## Shopify CSV Format

The exported CSV includes these columns:
- Title
- Handle (URL-friendly title)
- Category
- Description
- Price
- Tags (comma-separated)
- Image URL (supports multiple images per product)
- Status (draft/active)

## Troubleshooting

### Images not uploading
- Check file formats (JPG, PNG, WEBP only)
- Ensure files are not corrupted

### AI features not working
- Verify API keys in `.env` file
- Check API quota limits
- Ensure internet connection

### Google Sheets export failing
- Verify Google API credentials
- Check OAuth consent screen configuration
- Ensure proper redirect URIs are set
- Review domain restrictions on API keys

### Security concerns
- Always use password protection in production
- Keep `.env` file secure and never commit to Git
- Restrict API keys to specific domains
- Monitor API usage regularly

## 📚 Complete Documentation

| Document | Purpose |
|----------|---------|
| **README.md** | Overview and getting started (this file) |
| **QUICKSTART.md** | Get running in 5 minutes |
| **SPEECH_GUIDE.md** | Voice recognition tips & troubleshooting |
| **SECURITY.md** | Security guide for GitHub deployment |
| **BATCH_PROCESSING.md** | Process 100+ images efficiently |
| **API_SETUP.md** | Configure OpenAI, Google APIs |
| **DEPLOYMENT.md** | Deploy to production |
| **PROJECT_COMPLETE.md** | Project overview and checklist |
| **QUICK_REFERENCE.md** | Quick commands reference |

## Future Enhancements

- [ ] Batch processing for large image sets
- [ ] Multiple image variants per product
- [ ] Advanced AI categorization with Google Vision
- [ ] Direct Shopify API integration
- [ ] Support for video uploads
- [ ] Multi-language support
- [ ] Image editing tools (crop, rotate, filters)
- [ ] Product variant management (size, color)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for your needs.

## Support

For questions or issues, please open an issue on GitHub.
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
