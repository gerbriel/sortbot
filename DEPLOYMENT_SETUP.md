# GitHub Actions Deployment - Quick Setup

## ⚡ 5-Minute Setup Guide

### Step 1: Enable GitHub Pages (30 seconds)

1. Go to: `https://github.com/gerbriel/sortbot/settings/pages`
2. Under **Source**, select: **GitHub Actions**
3. Click **Save**

✅ Done!

---

### Step 2: Add API Keys as Secrets (3 minutes)

1. Go to: `https://github.com/gerbriel/sortbot/settings/secrets/actions`
2. Click **New repository secret** for each one below

**Copy from your local `.env` file:**

```bash
# Open your .env file and copy each value
cat .env
```

**Add these secrets (one by one):**

1. **VITE_APP_PASSWORD**
   - Your app password

2. **VITE_DISABLE_AUTH** 
   - Set to: `false`

3. **VITE_OPENAI_API_KEY**
   - Your OpenAI key (starts with `sk-proj-...`)

4. **VITE_GOOGLE_CLIENT_ID**
   - Your Google client ID (ends with `.apps.googleusercontent.com`)

5. **VITE_GOOGLE_API_KEY**
   - Your Google API key (starts with `AIza...`)

6. **VITE_GOOGLE_VISION_API_KEY** (optional)
   - Your Google Vision key

✅ All secrets added!

---

### Step 3: Push Changes (1 minute)

```bash
cd /Users/gabrielrios/Desktop/sortingapp

# Stage the new files
git add .github/workflows/deploy.yml
git add vite.config.ts
git add GITHUB_ACTIONS_DEPLOYMENT.md
git add DEPLOYMENT_SETUP.md

# Commit
git commit -m "Add GitHub Actions deployment workflow"

# Push
git push origin main
```

✅ Deployment triggered!

---

### Step 4: Watch It Deploy (2 minutes)

1. Go to: `https://github.com/gerbriel/sortbot/actions`
2. You'll see **"Add GitHub Actions deployment workflow"** running
3. Click on it to watch progress
4. Wait for ✅ green checkmark (2-3 minutes)

---

### Step 5: Visit Your Live Site! 🎉

Your app is now live at:

```
https://gerbriel.github.io/sortbot/
```

🎊 **Congratulations! Your app is deployed!**

---

## ⚙️ What Happens Now

### Automatic Deployments

Every time you push to `main`:
1. GitHub Actions runs automatically
2. Builds your app
3. Deploys to GitHub Pages
4. Your live site updates!

### Workflow

```
Push to main
    ↓
GitHub Actions triggers
    ↓
Install dependencies
    ↓
Build app (npm run build)
    ↓
Deploy to GitHub Pages
    ↓
Live site updated! ✨
```

---

## 🐛 Troubleshooting

### "Deployment failed" ❌

**Check:**
1. Did you add ALL the secrets?
2. Are the secrets spelled correctly? (exact case)
3. Are the secret values correct? (copy from `.env`)

**Fix:**
- Go to Settings → Secrets → Actions
- Verify all 6 secrets are there
- Re-run the workflow

---

### "Blank page" after deploy

**Fix:**
1. Wait 2-3 minutes (Pages takes time)
2. Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
3. Check browser console for errors

---

### "404 Not Found"

**Fix:**
1. Settings → Pages → Source must be "GitHub Actions"
2. Wait 2 minutes after setting this
3. Re-run deployment from Actions tab

---

## 📋 Verification Checklist

After setup, verify:

- [ ] GitHub Pages enabled (Source: GitHub Actions)
- [ ] All 6 secrets added
- [ ] Deployment workflow completed ✅
- [ ] Site loads at `https://gerbriel.github.io/sortbot/`
- [ ] App password works
- [ ] Image upload works
- [ ] Google Drive integration works
- [ ] AI features work

---

## 🔄 Future Updates

**To deploy changes:**
```bash
# 1. Make your changes
# 2. Commit and push
git add .
git commit -m "Your changes"
git push origin main

# 3. Automatic deployment happens!
# 4. Check Actions tab for progress
# 5. Site updates in ~2 minutes
```

---

## 🎯 Quick Links

- **Live Site:** https://gerbriel.github.io/sortbot/
- **Deployments:** https://github.com/gerbriel/sortbot/actions
- **Settings:** https://github.com/gerbriel/sortbot/settings
- **Secrets:** https://github.com/gerbriel/sortbot/settings/secrets/actions
- **Pages:** https://github.com/gerbriel/sortbot/settings/pages

---

## 💡 Pro Tips

### Faster Deployments

**Skip deployments for docs:**
```bash
git commit -m "Update README [skip ci]"
```

### Manual Deploy

**Trigger without pushing:**
1. Actions tab
2. "Deploy to GitHub Pages"
3. "Run workflow"
4. Click "Run workflow"

### Check Build Locally

**Before pushing:**
```bash
npm run build
npm run preview
# Test at http://localhost:4173
```

---

## 🆘 Need Help?

**Full documentation:** See `GITHUB_ACTIONS_DEPLOYMENT.md`

**Common issues solved there:**
- Environment variables not working
- Build errors
- Deployment failures
- Security configuration
- Custom domains

---

## ✅ Setup Complete!

You now have:
- ✅ Automatic deployments on every push
- ✅ Live site at GitHub Pages
- ✅ No manual deployment needed
- ✅ Free hosting forever!

**Push changes → Watch them go live! 🚀**
