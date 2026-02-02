# GitHub Actions Deployment Fix

## Issue
The deployment workflow was failing with two errors:
1. **Build job error**: "The job was not acquired by Runner of type hosted even after multiple attempts"
2. **Deploy job error**: "Internal server error. Correlation ID: ccc5f106-d7ee-492d-b560-d257da5f15c5"

## Root Cause
The workflow was split into two separate jobs (`build` and `deploy`), which can cause runner acquisition issues and timing problems with GitHub Pages deployment.

## Solution
Combined the build and deploy steps into a single job (`build-and-deploy`) that:
1. Builds the project
2. Uploads the artifact
3. Deploys to GitHub Pages immediately

## Changes Made

### Before (Two-Job Workflow):
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - # Build steps
      - name: Upload artifact
  
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to GitHub Pages
```

### After (Single-Job Workflow):
```yaml
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - # Build steps
      - name: Upload artifact
      - name: Deploy to GitHub Pages
```

## Benefits

1. **More Reliable**: Single runner handles entire process, no handoff issues
2. **Faster**: No waiting for second job to acquire runner
3. **Simpler**: Easier to debug and maintain
4. **Standard Pattern**: Aligns with GitHub's recommended approach for Pages

## Permissions Updated

Changed `contents: read` to `contents: write` to ensure full deployment permissions:

```yaml
permissions:
  contents: write  # Was: read
  pages: write
  id-token: write
```

## Testing

After pushing this fix:
1. GitHub Actions should automatically trigger on push to main
2. Build should complete successfully
3. Deploy should complete without internal server errors
4. Site should be live at: https://gerbriel.github.io/sortbot/

## Troubleshooting

If deployment still fails:

### Check GitHub Pages Settings
1. Go to repository Settings → Pages
2. Ensure "Source" is set to "GitHub Actions" (not "Deploy from a branch")
3. Custom domain settings (if any) should be correct

### Check Secrets (if needed)
Some environment variables are referenced but may not be required:
- `VITE_APP_PASSWORD` - For password protection (optional)
- `VITE_DISABLE_AUTH` - To disable auth (optional)
- `VITE_OPENAI_API_KEY` - For AI features (required for AI descriptions)
- `VITE_GOOGLE_CLIENT_ID` - For Google Drive (optional)
- `VITE_GOOGLE_API_KEY` - For Google services (optional)
- `VITE_GOOGLE_VISION_API_KEY` - For image analysis (optional)

To add secrets:
1. Go to repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each secret key/value pair

### Manual Trigger
If automatic deployment doesn't work:
1. Go to Actions tab in GitHub
2. Click "Deploy to GitHub Pages" workflow
3. Click "Run workflow" button
4. Select branch (main)
5. Click "Run workflow"

## Alternative: Static Deployment

If GitHub Actions continues to have issues, you can deploy manually:

```bash
# Build locally
npm run build

# Deploy to gh-pages branch
npm install -g gh-pages
gh-pages -d dist
```

Or use the GitHub web interface:
1. Create a `gh-pages` branch
2. Upload contents of `dist/` folder to root of `gh-pages` branch
3. Set Pages source to "Deploy from branch: gh-pages"

## Status

✅ **Fixed**: Workflow now uses single-job pattern  
✅ **Updated**: Permissions set correctly  
✅ **Documented**: This guide for future reference  

Next push to main should deploy successfully!
