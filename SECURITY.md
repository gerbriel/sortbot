# 🔒 Security Guide for Personal GitHub Deployment

This guide ensures your app, Google Sheets, and Shopify data remain secure when deployed to your personal GitHub account.

## 🚨 Critical Security Measures

### 1. Password Protection (Built-in)

The app includes password authentication to prevent unauthorized access.

**Setup:**
```env
VITE_APP_PASSWORD=YourStrongPassword123!
VITE_DISABLE_AUTH=false
```

**Features:**
- ✅ Password required on first visit
- ✅ Session expires after 8 hours
- ✅ Rate limiting (3 failed attempts = 15 min lockout)
- ✅ Session stored in browser only (not persistent)

**For Development Only:**
```env
VITE_DISABLE_AUTH=true  # Bypass password during development
```

### 2. Environment Variable Security

**NEVER commit these to GitHub:**
```env
VITE_APP_PASSWORD=***
VITE_OPENAI_API_KEY=***
VITE_GOOGLE_API_KEY=***
VITE_GOOGLE_CLIENT_ID=***
```

**✅ Already Protected:**
- `.env` is in `.gitignore`
- `.env.example` contains NO real keys

**Deployment Setup (Vercel/Netlify):**
1. Add environment variables in hosting dashboard
2. NEVER add them to GitHub
3. Use different keys for production vs. development

### 3. Google API Security

**Restrict Your API Keys:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. For each API key, click Edit
3. Under "Application restrictions":
   - Select "HTTP referrers (web sites)"
   - Add your domain: `https://your-app.vercel.app/*`
   - Add localhost for dev: `http://localhost:5173/*`

4. Under "API restrictions":
   - Select "Restrict key"
   - Only enable: Google Sheets API, Google Vision API

**OAuth 2.0 Client ID:**
1. Edit your OAuth client
2. Under "Authorized JavaScript origins":
   - `https://your-app.vercel.app`
   - `http://localhost:5173` (for development)
3. Under "Authorized redirect URIs":
   - `https://your-app.vercel.app`
   - `http://localhost:5173`

### 4. OpenAI API Security

**Protect Your OpenAI Key:**

1. Go to [OpenAI Platform](https://platform.openai.com/account/api-keys)
2. Set usage limits:
   - Monthly budget limit (e.g., $50/month)
   - Request rate limits
3. Monitor usage regularly
4. Rotate keys monthly

**Best Practice:**
Create a separate key for production with strict limits.

### 5. GitHub Repository Security

**Public Repository Checklist:**
- ✅ `.env` in `.gitignore`
- ✅ No API keys in code
- ✅ No credentials in commit history
- ✅ Vercel environment variables NOT in GitHub

**Before Pushing to GitHub:**
```bash
# Check for secrets
git log -p | grep -i "api_key\|password\|secret"

# If found, you need to clean history:
# https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
```

**Consider Making Repository Private:**
Even better - keep your repo private on GitHub:
- Settings → Danger Zone → Change visibility → Private

### 6. Deployment Security (Vercel)

**Secure Deployment Steps:**

1. **Deploy via Vercel Dashboard (not CLI):**
   - Import from GitHub
   - Connect your repository
   - Add environment variables in Vercel dashboard

2. **Environment Variables in Vercel:**
   - Go to Settings → Environment Variables
   - Add all variables from `.env`
   - Set to "Production" only (not Preview/Development)

3. **Enable Vercel Authentication (Optional but Recommended):**
   ```bash
   # In your Vercel project settings:
   Settings → General → Password Protection → Enable
   ```

4. **Custom Domain with HTTPS:**
   - Always use HTTPS in production
   - Vercel provides free SSL

### 7. Google Sheets Protection

**Sharing Settings:**
1. Your Google Sheet should be private by default
2. The app uses OAuth to access YOUR Google account
3. Other users will authenticate with THEIR Google accounts
4. Each user only sees their own sheets

**Best Practice:**
- Don't share the Google Sheet link publicly
- Review access permissions regularly
- Use separate Google accounts for business vs. personal

### 8. Shopify Data Protection

**CSV Export Security:**
- CSV files are generated client-side
- No data is sent to external servers
- Files are downloaded directly to your computer
- Delete CSV files after importing to Shopify

**Shopify Import Best Practices:**
- Always review data before importing
- Use Shopify's "draft" status initially
- Test with a few products first

## 🛡️ Security Layers Summary

| Layer | Protection | Status |
|-------|-----------|---------|
| App Access | Password + Session | ✅ Built-in |
| API Keys | Environment Variables | ✅ Setup Required |
| Google APIs | Domain Restrictions | ⚠️ Configure |
| OpenAI | Usage Limits | ⚠️ Configure |
| GitHub | Private Repo Option | ⚠️ Optional |
| Deployment | Vercel Auth | ⚠️ Optional |

## 🔐 Recommended Security Setup

### Minimum (Required):
1. ✅ Set `VITE_APP_PASSWORD` in environment variables
2. ✅ Keep `.env` out of Git
3. ✅ Restrict Google API keys to your domain

### Recommended (Better):
4. ✅ Make GitHub repository private
5. ✅ Set OpenAI usage limits
6. ✅ Use separate API keys for prod/dev

### Maximum (Best):
7. ✅ Enable Vercel password protection
8. ✅ Set up monitoring/alerts for API usage
9. ✅ Rotate API keys monthly
10. ✅ Use IP restrictions (if possible)

## 🚀 Quick Security Setup

### Step 1: Set Your Password
```bash
# In your .env file:
VITE_APP_PASSWORD=MySecurePassword123!
```

### Step 2: Restrict Google APIs
1. Google Cloud Console → Credentials
2. Edit each API key
3. Add HTTP referrer restrictions
4. Limit to Sheets + Vision APIs only

### Step 3: Deploy Securely
```bash
# Push to GitHub (ensure .env is not included)
git add .
git commit -m "Initial commit"
git push origin main

# Deploy to Vercel
vercel --prod

# Add environment variables in Vercel dashboard
```

### Step 4: Test Security
1. Visit your deployed app
2. Verify password prompt appears
3. Test API functionality after authentication
4. Check that Google Sheets only shows your data

## 🔍 Security Monitoring

**Regular Checks:**
- [ ] Weekly: Review API usage on OpenAI dashboard
- [ ] Weekly: Check Google Cloud billing
- [ ] Monthly: Rotate API keys
- [ ] Monthly: Review access logs

**Set Up Alerts:**

**OpenAI:**
- Platform → Usage → Set up email alerts
- Alert at 80% of monthly budget

**Google Cloud:**
- Billing → Budgets & Alerts
- Set alert at 80% of expected usage

## 🐛 Security Issues & Fixes

### Issue: "Unauthorized" Error in Production
**Fix:** Add your production URL to Google OAuth authorized origins

### Issue: API Key Exposed in GitHub
**Fix:** 
1. Immediately rotate the key
2. Remove from GitHub history
3. Add to `.gitignore` and redeploy

### Issue: Too Many API Requests
**Fix:**
1. Implement client-side rate limiting
2. Add caching for repeated requests
3. Review usage patterns

## 📱 Additional Security Features (Future)

Consider adding these for production:
- [ ] Two-factor authentication (2FA)
- [ ] Email verification
- [ ] Audit logging
- [ ] IP whitelisting
- [ ] API request signing
- [ ] End-to-end encryption for stored data

## 🤝 Sharing with Team Members

If you need to share with colleagues:

**Option 1: Individual Authentication**
- Each user sets their own password
- Each connects their own Google account
- Each has their own API keys

**Option 2: Shared Access (Less Secure)**
- Share the app password (change regularly)
- Use a shared Google account for sheets
- Monitor usage closely

## 📋 Security Checklist Before Going Live

- [ ] App password set and tested
- [ ] Google APIs restricted to your domain
- [ ] OpenAI usage limits configured
- [ ] All API keys in Vercel environment variables (not GitHub)
- [ ] `.env` NOT in Git repository
- [ ] GitHub repository visibility set (private recommended)
- [ ] HTTPS enabled on custom domain
- [ ] Tested authentication flow in production
- [ ] Monitoring and alerts configured
- [ ] Backup plan for API key rotation

## 🆘 Emergency Response

**If You Suspect a Security Breach:**

1. **Immediately:**
   - Rotate ALL API keys
   - Change app password
   - Clear all user sessions

2. **Investigate:**
   - Check Google Cloud logs
   - Review OpenAI usage
   - Check Vercel access logs

3. **Prevent:**
   - Enable additional authentication
   - Make repository private
   - Review and tighten API restrictions

## 📚 Resources

- [Vercel Security Best Practices](https://vercel.com/docs/security/secure-compute)
- [Google Cloud Security](https://cloud.google.com/security/best-practices)
- [OpenAI Safety Best Practices](https://platform.openai.com/docs/guides/safety-best-practices)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

**Remember:** Security is a process, not a one-time setup. Review and update regularly!
