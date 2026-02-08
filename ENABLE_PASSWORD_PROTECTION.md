# Enable Leaked Password Protection

## Issue
**Warning:** Leaked Password Protection Disabled

Supabase Auth can prevent users from using compromised passwords by checking against the HaveIBeenPwned.org database. This feature is currently disabled.

## How to Enable

### Option 1: Via Supabase Dashboard (Recommended)
1. Go to your Supabase project dashboard
2. Navigate to **Authentication** → **Policies** (or **Settings** → **Auth**)
3. Find **"Password Protection"** or **"Leaked Password Protection"**
4. Toggle it **ON**

### Option 2: Via Supabase CLI
```bash
# Update auth config
supabase secrets set AUTH_PASSWORD_PWNED_ENABLED=true
```

### Option 3: Via API (if using self-hosted)
```sql
-- Enable leaked password protection in auth.config
UPDATE auth.config 
SET password_pwned_check_enabled = true
WHERE name = 'default';
```

## What This Does

When enabled:
- ✅ Checks new passwords against **+10 billion** compromised passwords from HaveIBeenPwned
- ✅ Prevents users from setting passwords like "password123" that have been leaked in breaches
- ✅ Enhances security without impacting user experience
- ✅ Privacy-preserving: Only sends partial hash to HaveIBeenPwned (k-anonymity model)

When a user tries to set a compromised password:
```
❌ Error: "This password has been found in a data breach. 
Please choose a different password."
```

## Impact
- **Security:** High - Prevents use of known compromised passwords
- **Performance:** Negligible - Only checks during password creation/change
- **Privacy:** Protected - Uses k-anonymity model (partial hash only)

## Verification

After enabling, test with a known compromised password:
```bash
# This should be rejected
curl -X POST https://your-project.supabase.co/auth/v1/signup \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'

# Expected response:
# {
#   "error": "Password found in breach database",
#   "error_description": "This password has been found in a data breach..."
# }
```

## References
- [Supabase Password Security Docs](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [HaveIBeenPwned API](https://haveibeenpwned.com/API/v3)
- [k-Anonymity Model](https://blog.cloudflare.com/validating-leaked-passwords-with-k-anonymity/)
