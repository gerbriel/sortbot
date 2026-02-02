# 🚀 Quick Reference Card

## Essential Commands

```bash
# Start development
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Default Credentials

**App Password:** `changeme123` (change in `.env`)

## Environment Variables

```env
# Required for security
VITE_APP_PASSWORD=your_password

# For development only
VITE_DISABLE_AUTH=true

# Optional: AI features
VITE_OPENAI_API_KEY=sk-...
VITE_GOOGLE_API_KEY=AIza...
VITE_GOOGLE_CLIENT_ID=123...
```

## Workflow Steps

1. **🔒 Login** - Enter password
2. **📤 Upload** - Drag 100+ images
3. **🤖 Sort** - AI categorize
4. **📦 Group** - Combine similar images
5. **🎤 Describe** - Voice + AI
6. **📊 Export** - CSV or Sheets

## Batch Processing

**Recommended:** 50-100 images per batch

**Upload Tips:**
- Compress images < 2MB
- Use consistent naming
- Group similar items

**Grouping:**
- Select images → "Group Selected"
- Or "Auto-Group Similar"
- Each group = 1 product with multiple images

## Security Checklist

- [ ] Strong password in `.env`
- [ ] `.env` NOT in Git
- [ ] Google APIs restricted to your domain
- [ ] OpenAI usage limits set
- [ ] GitHub repo private (optional)

## Quick Fixes

**Port in use:**
```bash
npx kill-port 5173
```

**Build errors:**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Reset authentication:**
Open browser DevTools → Application → Session Storage → Clear

## File Locations

```
Config: .env
Docs: README.md, SECURITY.md, BATCH_PROCESSING.md
Components: src/components/
API: src/services/api.ts
```

## Key Features

✅ Batch upload (100+ images)
✅ Product grouping (multiple images per product)
✅ AI sorting & descriptions
✅ Password protection
✅ Google Sheets export
✅ Shopify CSV export

## Documentation

| Need | Read |
|------|------|
| Quick setup | QUICKSTART.md |
| Security | SECURITY.md |
| Batch processing | BATCH_PROCESSING.md |
| API setup | API_SETUP.md |
| Deployment | DEPLOYMENT.md |
| Complete guide | README.md |

## Support

- Check docs in project root
- Review browser console for errors
- Verify `.env` variables are set
- Test with small batch first

## Performance

**Optimal:**
- 50-100 images per batch
- < 2MB per image
- Chrome or Edge browser
- Stable internet connection

## Keyboard Shortcuts

- `Tab` - Navigate fields
- `Ctrl/Cmd+Enter` - Submit
- `Esc` - Cancel/Close

---

**Default Password:** changeme123 (⚠️ Change this!)
**App URL:** http://localhost:5173
**Session:** Expires after 8 hours

---

📖 Full docs in README.md
🔒 Security guide in SECURITY.md
📦 Batch guide in BATCH_PROCESSING.md
