# Quick Start Guide

Get your AI Clothing Sorting app up and running in 5 minutes!

## 🚀 Quick Setup

### 1. Prerequisites Check
```bash
node --version  # Should be v18 or higher
npm --version   # Should be v9 or higher
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Server
```bash
npm run dev
```

Your app is now running at **http://localhost:5173** 🎉

## 📋 Basic Usage (No API Keys Required)

The app works out of the box with mock data! Try it now:

1. **Upload Images** 
   - Drag and drop clothing photos or click to browse
   - Supports JPG, PNG, WEBP formats

2. **AI Sorting**
   - Click "Auto-Sort with AI" (uses mock sorting)
   - Or manually select categories

3. **Add Descriptions**
   - Click "Start Recording" (simulates voice input)
   - Click "Generate Product Info" (uses mock AI)
   - Edit any details

4. **Export**
   - Download Shopify CSV immediately
   - Google Sheets requires API setup (see below)

## 🔑 Enable Real AI Features (Optional)

### OpenAI Integration (5 minutes)

1. Get API key from https://platform.openai.com/
2. Create `.env` file in project root:
   ```env
   VITE_OPENAI_API_KEY=sk-your-key-here
   ```
3. Restart dev server

### Google Sheets Export (10 minutes)

1. Go to https://console.cloud.google.com/
2. Create project → Enable Google Sheets API
3. Create API Key and OAuth Client ID
4. Add to `.env`:
   ```env
   VITE_GOOGLE_API_KEY=your-api-key
   VITE_GOOGLE_CLIENT_ID=your-client-id
   ```
5. Add `http://localhost:5173` to authorized origins
6. Restart dev server

> See [API_SETUP.md](./API_SETUP.md) for detailed instructions

## 🎯 Usage Tips

### Best Practices

- **Image Quality**: Use clear, well-lit photos
- **File Size**: Keep images under 5MB for better performance
- **Batch Size**: Process 10-20 items at a time for efficiency
- **Categories**: Choose specific categories for better results

### Workflow

1. **Organize First**: Sort similar items together before uploading
2. **Batch Process**: Upload, sort, then do all descriptions
3. **Review**: Always review AI-generated content before exporting
4. **Export**: Download CSV as backup even if using Google Sheets

### Keyboard Shortcuts

- **Tab**: Navigate between fields
- **Enter**: Submit/confirm in most dialogs
- **Esc**: Close modals (when available)

## 🛠️ Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run type-check

# Lint code
npm run lint
```

## 📱 Browser Support

Works best in modern browsers:
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

**Speech Recognition** requires:
- Chrome or Edge (best support)
- HTTPS in production

## 🐛 Common Issues

### Port Already in Use
```bash
# Kill process on port 5173
npx kill-port 5173
# Or change port in vite.config.ts
```

### Images Not Showing
- Check file format (JPG, PNG, WEBP only)
- Verify file isn't corrupted
- Check browser console for errors

### Build Fails
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

## 📚 Next Steps

1. ✅ Test basic functionality without APIs
2. 📖 Read [API_SETUP.md](./API_SETUP.md) to enable AI features
3. 🚀 Review [DEPLOYMENT.md](./DEPLOYMENT.md) when ready to deploy
4. 💡 Check [README.md](./README.md) for full documentation

## 🎨 Customization Ideas

### Change Color Scheme
Edit `src/App.css`:
```css
body {
  background: linear-gradient(135deg, #YOUR_COLOR1 0%, #YOUR_COLOR2 100%);
}
```

### Add More Categories
Edit `src/components/ImageSorter.tsx`:
```typescript
const CATEGORIES = [
  'Your Category 1',
  'Your Category 2',
  // ... add more
];
```

### Modify Export Format
Edit `src/components/GoogleSheetExporter.tsx`:
```typescript
const headers = [
  'Your Column 1',
  'Your Column 2',
  // ... customize
];
```

## 💬 Need Help?

- 📖 Check the README.md
- 🔍 Search issues on GitHub
- 💡 Open a new issue with details

## 🎉 You're All Set!

Start uploading clothing images and watch the AI work its magic!

**Pro Tip**: Bookmark http://localhost:5173 while developing.

---

Made with ❤️ using React + TypeScript + Vite
