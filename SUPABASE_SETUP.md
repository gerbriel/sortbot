# Supabase Setup Guide

## 🎯 Overview
This app now uses Supabase for:
- User authentication (login/signup)
- Product data storage
- Image hosting with permanent URLs
- Isolated user data (each user sees only their products)

## 📋 Step 1: Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Fill in:
   - **Project name**: sortbot
   - **Database password**: (choose a strong password, save it!)
   - **Region**: Choose closest to you
5. Click "Create new project" (takes ~2 minutes)

## 🗄️ Step 2: Run Database Schema

1. In your Supabase dashboard, click "SQL Editor" in the left sidebar
2. Click "New query"
3. Copy the entire contents of `supabase/schema.sql`
4. Paste into the query editor
5. Click "Run" or press Cmd/Ctrl + Enter
6. You should see "Success. No rows returned"

This creates:
- ✅ `products` table (all product data)
- ✅ `product_images` table (image URLs and metadata)
- ✅ `user_profiles` table (user info)
- ✅ Row Level Security policies (data isolation)
- ✅ Automatic timestamps and triggers

## 📦 Step 3: Create Storage Bucket

1. Click "Storage" in the left sidebar
2. Click "New bucket"
3. Fill in:
   - **Name**: `product-images`
   - **Public bucket**: ✅ YES (check this box)
   - **File size limit**: 10 MB
   - **Allowed MIME types**: `image/*`
4. Click "Create bucket"

### Configure Storage Policies

1. Click on the `product-images` bucket
2. Click "Policies" tab
3. Click "New policy" and create these 3 policies:

**Policy 1: Allow Authenticated Uploads**
```sql
-- Name: Allow authenticated users to upload
-- Operation: INSERT
-- Policy definition:
(bucket_id = 'product-images'::text AND auth.role() = 'authenticated'::text)
```

**Policy 2: Public Read Access**
```sql
-- Name: Allow public to read images
-- Operation: SELECT
-- Policy definition:
(bucket_id = 'product-images'::text)
```

**Policy 3: Users Can Delete Own Images**
```sql
-- Name: Users can delete own images
-- Operation: DELETE
-- Policy definition:
(bucket_id = 'product-images'::text AND auth.uid()::text = (storage.foldername(name))[1])
```

## 🔑 Step 4: Get API Credentials

1. Click "Settings" (gear icon) in the left sidebar
2. Click "API" under Project Settings
3. Copy these two values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbG...` (long string)

## 🛠️ Step 5: Update Local Environment

1. Open `/Users/gabrielrios/Desktop/sortingapp/.env`
2. Replace with your actual values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOi...
```

3. Save the file

## 🚀 Step 6: Add GitHub Secrets (for deployment)

1. Go to your GitHub repo: `https://github.com/gerbriel/sortbot`
2. Click "Settings" tab
3. Click "Secrets and variables" > "Actions" in the left sidebar
4. Click "New repository secret" and add these two:

**Secret 1:**
- Name: `VITE_SUPABASE_URL`
- Value: `https://your-project.supabase.co`

**Secret 2:**
- Name: `VITE_SUPABASE_ANON_KEY`
- Value: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (your anon key)

## ✅ Step 7: Test Locally

1. Start the dev server:
```bash
cd /Users/gabrielrios/Desktop/sortingapp
npm run dev
```

2. Open http://localhost:5173
3. You should see the login screen
4. Try signing up with an email
5. Check your email for verification link
6. Log in and test the app!

## 📊 Step 8: Verify Database

After signing up and using the app:

1. Go to Supabase dashboard
2. Click "Table Editor"
3. Check these tables have data:
   - `user_profiles` - Your user profile
   - `products` - Any products you created
   - `product_images` - Image URLs

4. Click "Storage" > `product-images`
5. You should see uploaded images organized by user ID

## 🎉 You're Done!

Your app now has:
- ✅ Secure user authentication
- ✅ Persistent product storage
- ✅ Permanent image URLs (for Shopify CSV)
- ✅ Isolated user data
- ✅ Database backups (automatic)
- ✅ Scalable infrastructure

## 🔒 Security Features

- **Row Level Security (RLS)**: Users can only see/edit their own data
- **Email verification**: Required before login (can be disabled in Supabase settings)
- **Secure tokens**: Automatic JWT token refresh
- **HTTPS only**: All API calls encrypted
- **No API keys in code**: Environment variables only

## 📝 Next Steps

1. **Enable email auth**: Supabase dashboard > Authentication > Providers > Email (should be on by default)
2. **Customize email templates**: Authentication > Email Templates
3. **Add OAuth providers** (optional): Google, GitHub, etc.
4. **Set up database backups**: Database > Backups
5. **Monitor usage**: Go to "Reports" to see API usage

## 🆘 Troubleshooting

**"Missing Supabase environment variables"**
- Check `.env` file has correct URL and key
- Restart dev server after changing `.env`

**"Invalid API key"**
- Copy the **anon public** key, not the service_role key
- Make sure you copied the entire key

**"Row Level Security policy violation"**
- Check you're logged in
- Verify policies were created correctly in Step 2

**Images not uploading:**
- Check storage bucket is public
- Verify storage policies are correct
- Check browser console for errors

**Email not arriving:**
- Check spam folder
- Disable email confirmation in Supabase settings (for testing)
- Use a real email address (not temp email services)

## 💡 Tips

- **Development**: Set email confirmation to "off" in Supabase for faster testing
- **Production**: Enable email confirmation and add your domain to allowed URLs
- **Backup**: Supabase free tier includes automatic backups
- **Scaling**: Free tier includes 50MB database, 1GB file storage, 50k monthly active users

## 📚 Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Auth Guide](https://supabase.com/docs/guides/auth)
- [Supabase Storage Guide](https://supabase.com/docs/guides/storage)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
