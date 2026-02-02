# Deployment Guide

This guide covers deploying your AI Clothing Sorting app to production.

## Deployment Options

### Option 1: Vercel (Recommended)

Vercel is optimized for Vite/React apps and offers:
- Free tier with generous limits
- Automatic HTTPS
- Serverless functions support
- Easy environment variable management

**Steps**:

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Deploy:
```bash
vercel
```

4. Add environment variables in Vercel dashboard:
   - Go to your project → Settings → Environment Variables
   - Add all variables from `.env` file

5. Redeploy with production env vars:
```bash
vercel --prod
```

**Custom Domain**:
- Go to Settings → Domains
- Add your custom domain
- Update DNS records as instructed

### Option 2: Netlify

Similar to Vercel with drag-and-drop deployment:

1. Build your app:
```bash
npm run build
```

2. Go to [Netlify](https://www.netlify.com/)
3. Drag and drop the `dist` folder
4. Configure environment variables in Site settings

### Option 3: AWS Amplify

For integration with other AWS services:

1. Install Amplify CLI:
```bash
npm install -g @aws-amplify/cli
```

2. Initialize:
```bash
amplify init
```

3. Add hosting:
```bash
amplify add hosting
```

4. Deploy:
```bash
amplify publish
```

### Option 4: Traditional Hosting (cPanel, etc.)

1. Build the app:
```bash
npm run build
```

2. Upload the contents of `dist` folder to your web server

3. Configure `.htaccess` for React Router (if using):
```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteCond %{REQUEST_FILENAME} !-l
  RewriteRule . /index.html [L]
</IfModule>
```

## Environment Variables for Production

Create these environment variables in your hosting platform:

```env
VITE_OPENAI_API_KEY=sk-proj-...
VITE_GOOGLE_API_KEY=AIza...
VITE_GOOGLE_CLIENT_ID=123456789-....apps.googleusercontent.com
VITE_GOOGLE_VISION_API_KEY=AIza...
```

**Important**: 
- Never commit `.env` to version control
- Use different API keys for production
- Restrict API keys to your production domain

## Pre-Deployment Checklist

- [ ] Test all features locally
- [ ] Build successfully (`npm run build`)
- [ ] No console errors in production build
- [ ] All API keys configured
- [ ] Google OAuth redirect URIs updated with production URL
- [ ] API usage limits reviewed
- [ ] CORS settings configured for APIs
- [ ] Error tracking set up (e.g., Sentry)
- [ ] Analytics added (optional)

## Post-Deployment Steps

### 1. Update Google Cloud Console

Add your production URL to:
- Authorized JavaScript origins
- Authorized redirect URIs

### 2. Test API Integration

- Upload test images
- Verify AI sorting works
- Test voice recording
- Try Google Sheets export
- Download Shopify CSV

### 3. Monitor Performance

**Recommended tools**:
- Google Analytics for user tracking
- Sentry for error tracking
- Vercel Analytics (if using Vercel)

### 4. Set Up API Monitoring

Monitor API usage to avoid unexpected costs:
- OpenAI: https://platform.openai.com/usage
- Google Cloud: https://console.cloud.google.com/billing

## Performance Optimization

### Image Optimization

Add image compression before upload:

```bash
npm install browser-image-compression
```

In `ImageUpload.tsx`:
```typescript
import imageCompression from 'browser-image-compression';

const compressImage = async (file: File) => {
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true
  };
  return await imageCompression(file, options);
};
```

### Lazy Loading

Add lazy loading for better initial load:

```typescript
import { lazy, Suspense } from 'react';

const ImageSorter = lazy(() => import('./components/ImageSorter'));
const ProductDescriptionGenerator = lazy(() => import('./components/ProductDescriptionGenerator'));
const GoogleSheetExporter = lazy(() => import('./components/GoogleSheetExporter'));

// Wrap components in Suspense
<Suspense fallback={<div>Loading...</div>}>
  <ImageSorter />
</Suspense>
```

### API Caching

Cache API responses to reduce costs:

```typescript
const cacheKey = `product-${itemId}`;
const cached = localStorage.getItem(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

// Fetch from API and cache
const result = await generateProductDetails(...);
localStorage.setItem(cacheKey, JSON.stringify(result));
```

## Security Best Practices

1. **API Key Security**:
   - Use environment variables
   - Never expose keys in client code
   - Rotate keys regularly

2. **Rate Limiting**:
   - Implement client-side rate limiting
   - Add backend API layer for sensitive operations

3. **Input Validation**:
   - Validate file types and sizes
   - Sanitize user inputs
   - Limit upload quantities

4. **HTTPS Only**:
   - Enforce HTTPS in production
   - Set security headers

## Scaling Considerations

### For High Traffic

1. **Add Backend API**:
   - Move API calls to server-side
   - Implement proper authentication
   - Add rate limiting

2. **Use CDN**:
   - Serve static assets via CDN
   - Cache images and CSS

3. **Database Integration**:
   - Store processed products in database
   - Enable user accounts
   - Track processing history

### Cost Management

**OpenAI API**:
- Set monthly spending limits
- Use cheaper models for simple tasks (gpt-3.5-turbo)
- Cache common results

**Google APIs**:
- Monitor quota usage
- Implement exponential backoff
- Use batch operations when possible

## Troubleshooting Production Issues

### API Not Working

1. Check environment variables are set correctly
2. Verify domain is whitelisted in API settings
3. Check browser console for CORS errors
4. Review API usage limits

### Images Not Loading

1. Check CORS headers on image URLs
2. Verify image sizes aren't too large
3. Ensure proper content-type headers

### Performance Issues

1. Enable production mode in React
2. Minify and compress assets
3. Use code splitting
4. Implement lazy loading

## Monitoring and Maintenance

### Set Up Alerts

1. **Uptime Monitoring**: Use services like UptimeRobot
2. **Error Tracking**: Implement Sentry or similar
3. **API Usage Alerts**: Set up billing alerts in Google Cloud and OpenAI

### Regular Maintenance

- Update dependencies monthly
- Review API costs weekly
- Check error logs daily
- Test critical paths after updates

## Support and Resources

- Vite Documentation: https://vitejs.dev/
- React Documentation: https://react.dev/
- Vercel Documentation: https://vercel.com/docs
- OpenAI API: https://platform.openai.com/docs
- Google Cloud: https://cloud.google.com/docs

## Rollback Plan

If deployment fails:

1. Revert to previous deployment (Vercel/Netlify have built-in rollback)
2. Check error logs
3. Fix issues locally
4. Test thoroughly
5. Redeploy

## Success Metrics

Track these KPIs:
- Images processed per day
- Average processing time per item
- API error rate
- User conversion rate (upload → export)
- Cost per processed item
