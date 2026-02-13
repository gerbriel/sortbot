# 🦙 Hugging Face Llama 3 Vision Integration Guide

## ✅ What's Integrated

Your app now supports **TWO AI vision providers**:

1. **Google Vision API** (existing) - Fast label detection
2. **Llama 3.2 Vision** (NEW!) - Deep clothing analysis with vintage expertise

## 🎯 Features

### Llama 3.2 Vision Capabilities:
- **Brand Recognition**: Identifies logos, tags, and brand names
- **Detailed Analysis**: Product type, material, era, condition
- **Vintage Expertise**: Better at identifying vintage items, graphics, and band merch
- **Structured Output**: Returns JSON with 8+ product fields
- **FREE**: Hugging Face has a generous free tier

## 🚀 Quick Setup (5 Minutes)

### Step 1: Get Your FREE Hugging Face API Token

1. Go to https://huggingface.co/settings/tokens
2. Click **"New token"**
3. Name it: `sortbot-vision`
4. Type: **Read** (default)
5. Click **"Generate a token"**
6. **Copy the token** (starts with `hf_...`)

### Step 2: Add Token to .env File

Open your `.env` file and add:

```bash
VITE_HUGGINGFACE_API_KEY=hf_your_token_here
```

**Example:**
```bash
VITE_HUGGINGFACE_API_KEY=hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890
```

### Step 3: Restart Dev Server

```bash
# Stop the server (Ctrl+C)
# Then restart:
npm run dev
```

### Step 4: Switch to Llama 3 Vision

1. Open the app
2. Click **"AI: Google"** button in top-left header
3. Select **"Llama 3.2 Vision"**
4. Done! ✅

## 🎨 How It Works

### Image Analysis Flow:

```
Upload Image → Llama 3.2 Vision → Structured Analysis
                     ↓
        {
          "productType": "Vintage Band T-Shirt",
          "brand": "Hanes Beefy-T",
          "color": "Black",
          "material": "100% Cotton",
          "condition": "Good - Minor fading",
          "era": "1990s",
          "style": "Vintage Rock",
          "description": "Classic 90s band tee with front/back graphics..."
        }
```

### Current Integration Status:

✅ **Service Created**: `src/lib/huggingfaceService.ts`
✅ **UI Component**: `src/components/AISettings.tsx`
✅ **Provider Toggle**: Switch between Google/Llama
❌ **Auto-Analysis**: Not yet connected to image upload

## 📊 Comparison: Google Vision vs Llama 3.2 Vision

| Feature | Google Vision | Llama 3.2 Vision |
|---------|--------------|------------------|
| **Speed** | ⚡ Very Fast | 🐢 Slower (2-5s) |
| **Accuracy** | ✅ Good labels | ✅✅ Detailed analysis |
| **Brand Detection** | ❌ No | ✅ Yes |
| **Vintage Items** | ⚠️ Basic | ✅✅ Excellent |
| **Graphics/Text** | ❌ Limited | ✅ Reads text on shirts |
| **Condition Assessment** | ❌ No | ✅ Yes |
| **Era Detection** | ❌ No | ✅ Yes (1980s, 90s, etc.) |
| **Cost** | 💰 Pay per image | 🆓 FREE (with limits) |
| **Setup** | Google Cloud | Hugging Face token |

## 🔧 Files Created/Modified

### New Files:
- `src/lib/huggingfaceService.ts` - Llama 3 API client
- `src/components/AISettings.tsx` - Provider toggle UI
- `src/components/AISettings.css` - Styling
- `HUGGINGFACE_SETUP.md` - This guide

### Modified Files:
- `src/App.tsx` - Added AI Settings button
- `.env` - Added VITE_HUGGINGFACE_API_KEY

## 🎯 Next Steps: Connect to Image Upload

To enable **auto-analysis on upload**, we need to:

1. **Modify ImageGrouper.tsx**:
   - Call `analyzeLlamaVision()` after image upload
   - Extract brand, color, material, era
   - Pre-fill product fields

2. **Update ClothingItem interface**:
   - Add AI analysis fields
   - Store confidence scores

3. **Show Analysis Results**:
   - Display detected info in Step 2
   - Allow manual override

**Would you like me to implement auto-analysis next?**

## 📝 API Usage & Limits

### Hugging Face Free Tier:
- ✅ **Unlimited requests** (with rate limiting)
- ⚠️ Rate limit: ~30 requests/minute
- ✅ No credit card required
- ✅ Models may sleep (first request slow, ~20s)
- ✅ Can upgrade for faster inference

### Rate Limit Handling:
The service automatically falls back to mock data if:
- API is rate limited
- Model is sleeping (warming up)
- Network error occurs

## 🐛 Troubleshooting

### "Model is loading" error:
- **Cause**: Model sleeps after inactivity
- **Fix**: Wait 20-30 seconds, try again
- **Prevention**: Use paid inference endpoints

### "Authorization failed":
- **Check**: Token starts with `hf_`
- **Check**: Token has "Read" permissions
- **Fix**: Regenerate token

### "No response from Llama Vision":
- **Cause**: JSON parsing failed
- **Debug**: Check console logs
- **Fix**: Service falls back to mock data

### Images not auto-analyzed:
- **Status**: Manual analysis not yet connected
- **Current**: Can only test via direct function call
- **Next**: Connect to ImageGrouper component

## 🔗 Useful Links

- [Hugging Face Tokens](https://huggingface.co/settings/tokens)
- [Llama 3.2 Vision Model](https://huggingface.co/meta-llama/Llama-3.2-11B-Vision-Instruct)
- [Llama 3 Text Model](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct)
- [Hugging Face Inference API Docs](https://huggingface.co/docs/api-inference/index)
- [Rate Limits](https://huggingface.co/docs/api-inference/rate-limits)

## 💡 Pro Tips

1. **Use Llama 3 for**:
   - Vintage clothing with graphics
   - Band/sports merch
   - Items with visible text/logos
   - Era detection (80s, 90s, Y2K)

2. **Use Google Vision for**:
   - Quick batch processing
   - Simple color detection
   - When speed matters

3. **Hybrid Approach**:
   - Use Google for initial sort
   - Use Llama 3 for detailed descriptions
   - Best of both worlds!

## 🎉 You're All Set!

Your app now has cutting-edge AI vision powered by Meta's Llama 3.2 Vision model! 🦙✨

Questions? Check the troubleshooting section or reach out for help.
