# GitHub Actions Deployment Guide

## Overview

Your app is now configured to automatically deploy to **GitHub Pages** whenever you push to the `main` branch!

## 🚀 How It Works

1. **Push code** to `main` branch
2. **GitHub Actions** automatically runs
3. **Builds** your React app
4. **Deploys** to GitHub Pages
5. **Live site** at: `https://gerbriel.github.io/sortbot/`

---

## ⚙️ Setup Steps

### Step 1: Enable GitHub Pages

1. Go to your repository: `https://github.com/gerbriel/sortbot`
2. Click **Settings** → **Pages** (in left sidebar)
3. Under **Source**, select:
   - Source: **GitHub Actions** (not "Deploy from branch")
4. Click **Save**

### Step 2: Add Environment Secrets

Your app needs API keys to work. Add them as GitHub Secrets:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** for each:

**Required Secrets:**

| Secret Name | Value | Description |
|------------|-------|-------------|
| `VITE_APP_PASSWORD` | Your app password | Password to access the app |
| `VITE_DISABLE_AUTH` | `false` | Keep auth enabled for production |
| `VITE_OPENAI_API_KEY` | `sk-proj-...` | Your OpenAI API key |
| `VITE_GOOGLE_CLIENT_ID` | `...apps.googleusercontent.com` | Google OAuth client ID |
| `VITE_GOOGLE_API_KEY` | `AIza...` | Google API key |
| `VITE_GOOGLE_VISION_API_KEY` | `AIza...` | Google Vision API key (optional) |

**How to add a secret:**
1. Click "New repository secret"
2. Name: `VITE_APP_PASSWORD`
3. Secret: Paste your actual password from your `.env` file
4. Click "Add secret"
5. Repeat for all secrets above

### Step 3: Trigger Deployment

**Option A: Push a commit**
```bash
# Make any change (or empty commit)
git commit --allow-empty -m "Trigger deployment"
git push origin main
```

**Option B: Manual trigger**
1. Go to **Actions** tab
2. Click **Deploy to GitHub Pages** workflow
3. Click **Run workflow** → **Run workflow**

---

## 📊 Monitor Deployment

### Watch the Build

1. Go to **Actions** tab in your repository
2. You'll see a workflow running: "Deploy to GitHub Pages"
3. Click on it to see progress:
   - ✅ Build (installs deps, builds app)
   - ✅ Deploy (uploads to GitHub Pages)

**Expected time:** 2-3 minutes

### Check Deployment Status

**Workflow steps:**
```
1. Checkout code         ✓ 10s
2. Setup Node.js         ✓ 5s
3. Install dependencies  ✓ 30s
4. Build                 ✓ 45s
5. Upload artifact       ✓ 15s
6. Deploy to Pages       ✓ 20s
```

---

## 🌐 Access Your Live Site

### Production URL

After successful deployment, your app will be live at:

```
https://gerbriel.github.io/sortbot/
```

### Custom Domain (Optional)

To use a custom domain like `sortbot.yoursite.com`:

1. **Settings** → **Pages**
2. Enter your custom domain
3. Follow DNS configuration instructions
4. GitHub will generate SSL certificate automatically

---

## 🔄 Automatic Deployments

### When Deployments Trigger

**Automatically:**
- Every push to `main` branch
- Every merge of a pull request to `main`

**Manually:**
- Click "Run workflow" in Actions tab

### Workflow File Location

The deployment configuration is in:
```
.github/workflows/deploy.yml
```

**Key features:**
- ✅ Runs on push to main
- ✅ Can be triggered manually
- ✅ Uses GitHub Secrets for env variables
- ✅ Builds with Vite
- ✅ Deploys to GitHub Pages
- ✅ Only one deployment at a time

---

## 🔧 Configuration Details

### Vite Config (`vite.config.ts`)

**Base URL configuration:**
```typescript
base: process.env.GITHUB_ACTIONS ? '/sortbot/' : '/'
```

**What this does:**
- When deployed: Uses `/sortbot/` (your repo name)
- When local: Uses `/` (root)
- Ensures assets load correctly on GitHub Pages

### Build Settings

```typescript
build: {
  outDir: 'dist',        // Output directory
  assetsDir: 'assets',   // Assets subdirectory
  sourcemap: false,      // No source maps (smaller size)
}
```

---

## 🐛 Troubleshooting

### Issue 1: Build Fails - Missing Dependencies

**Error:**
```
npm ERR! missing: react@^19.2.0
```

**Solution:**
The workflow uses `npm ci` which installs from `package-lock.json`.
Make sure your `package-lock.json` is committed:
```bash
git add package-lock.json
git commit -m "Add package-lock.json"
git push
```

---

### Issue 2: Blank Page After Deploy

**Symptom:** Site loads but shows blank white page

**Cause:** Base URL misconfiguration

**Solution:**
1. Check browser console for 404 errors
2. Verify `vite.config.ts` has correct base path:
   ```typescript
   base: '/sortbot/'  // Must match your repo name
   ```
3. Rebuild and redeploy

---

### Issue 3: Environment Variables Not Working

**Symptom:** API calls fail, features don't work

**Cause:** GitHub Secrets not set

**Solution:**
1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Verify ALL secrets are added:
   - VITE_APP_PASSWORD ✓
   - VITE_OPENAI_API_KEY ✓
   - VITE_GOOGLE_API_KEY ✓
   - etc.
3. Re-run the workflow

---

### Issue 4: 404 Page Not Found

**Symptom:** `https://gerbriel.github.io/sortbot/` shows 404

**Cause:** GitHub Pages not enabled or wrong source

**Solution:**
1. **Settings** → **Pages**
2. Source: Must be **GitHub Actions** (not "Deploy from branch")
3. Wait 1-2 minutes after changing
4. Re-run workflow if needed

---

### Issue 5: Deployment Works But Features Break

**Symptom:** App loads but Google Drive/Sheets/AI features don't work

**Cause:** API keys in secrets might be incorrect

**Solution:**
1. Check that secrets match your local `.env` values
2. Test API keys locally first
3. Update secrets in GitHub
4. Re-run deployment

---

## 📈 Deployment Best Practices

### Before Each Push

```bash
# 1. Test locally
npm run dev

# 2. Test build
npm run build
npm run preview

# 3. Commit and push
git add .
git commit -m "Description of changes"
git push
```

### Environment-Specific Settings

**Local (`.env`):**
```bash
VITE_DISABLE_AUTH=true  # Easier for dev
```

**Production (GitHub Secrets):**
```bash
VITE_DISABLE_AUTH=false  # Require password
```

### Branch Strategy

**Recommended:**
1. Create feature branches: `git checkout -b feature/new-feature`
2. Test changes locally
3. Push feature branch: `git push origin feature/new-feature`
4. Create Pull Request to `main`
5. Merge PR → automatic deployment!

---

## 🔐 Security Notes

### Secrets Are Safe

- ✅ GitHub Secrets are encrypted
- ✅ Never shown in logs
- ✅ Only available during build
- ✅ Not visible in built files (with proper usage)

### What's Exposed

⚠️ **Client-side variables ARE exposed** in the built JavaScript:
- `VITE_GOOGLE_API_KEY` - Visible in browser
- `VITE_OPENAI_API_KEY` - Visible in browser

**Mitigation:**
1. Use **API key restrictions** in Google Cloud Console:
   - Restrict to specific domains (gerbriel.github.io)
   - Restrict to specific APIs
2. Use **rate limiting** on OpenAI
3. Consider adding a backend API for sensitive operations

### What's Protected

✅ **Your local `.env` file** is never uploaded (in .gitignore)

---

## 📊 Monitoring & Analytics

### View Deployment History

1. **Actions** tab → **Deploy to GitHub Pages**
2. See all past deployments
3. Click any run to see logs

### Check Build Logs

If deployment fails:
1. Go to failed workflow
2. Click on "build" or "deploy" job
3. Expand steps to see error messages
4. Fix issue and push again

### Deployment Stats

**Typical metrics:**
- Build time: 1-2 minutes
- Deploy time: 30 seconds
- Total time: 2-3 minutes
- Artifact size: ~2-5 MB

---

## 🚀 Advanced Options

### Deploy to Other Platforms

Instead of GitHub Pages, you can deploy to:

**Vercel** (recommended for commercial):
```bash
npm i -g vercel
vercel
```

**Netlify:**
```bash
npm i -g netlify-cli
netlify deploy
```

**Cloudflare Pages:**
- Connect repo in Cloudflare dashboard
- Build command: `npm run build`
- Output directory: `dist`

### Add Build Badge

Show build status in README:

```markdown
[![Deploy Status](https://github.com/gerbriel/sortbot/actions/workflows/deploy.yml/badge.svg)](https://github.com/gerbriel/sortbot/actions/workflows/deploy.yml)
```

### Preview Deployments

Add this to deploy PRs to preview URLs:

```yaml
# .github/workflows/preview.yml
on:
  pull_request:
    branches: [ main ]
# ... deploy to preview URL
```

---

## 📋 Checklist

### Initial Setup
- [x] Created `.github/workflows/deploy.yml`
- [x] Updated `vite.config.ts` with base path
- [ ] Enabled GitHub Pages in Settings
- [ ] Set Source to "GitHub Actions"
- [ ] Added all GitHub Secrets
- [ ] Pushed changes to trigger deployment
- [ ] Verified site is live

### For Each Deployment
- [ ] Test locally with `npm run dev`
- [ ] Test build with `npm run build && npm run preview`
- [ ] Commit changes
- [ ] Push to main
- [ ] Monitor deployment in Actions tab
- [ ] Test live site
- [ ] Verify all features work

---

## 🎯 Quick Commands Reference

```bash
# Local development
npm run dev

# Test production build
npm run build
npm run preview

# Deploy (automatic on push to main)
git add .
git commit -m "Update: description"
git push origin main

# Force rebuild without changes
git commit --allow-empty -m "Trigger rebuild"
git push

# View logs
# Go to: https://github.com/gerbriel/sortbot/actions
```

---

## 📚 Additional Resources

- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [GitHub Pages Docs](https://docs.github.com/en/pages)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

---

## 🎉 Success!

Your app now deploys automatically! 

**Next steps:**
1. ✅ Enable GitHub Pages in Settings
2. ✅ Add your API keys as GitHub Secrets
3. ✅ Push a commit to trigger deployment
4. ✅ Visit `https://gerbriel.github.io/sortbot/`
5. ✅ Share your live app!

---

**Live URL (after setup):** https://gerbriel.github.io/sortbot/

**Monitor deployments:** https://github.com/gerbriel/sortbot/actions

**Happy deploying! 🚀**
