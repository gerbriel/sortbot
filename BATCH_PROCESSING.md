# 📦 Batch Processing Guide

This guide covers how to efficiently process large batches of clothing images.

## 🎯 Overview

The app is optimized for batch processing with these features:
- **Upload**: Handle 100+ images at once
- **Grouping**: Combine multiple images per product
- **Auto-sort**: AI categorization for all items
- **Bulk export**: Generate CSV for all products

## 📊 Recommended Batch Sizes

| Batch Size | Processing Time | Memory Usage | Recommended For |
|------------|----------------|--------------|-----------------|
| 1-10 items | < 30 seconds | Low | Quick updates |
| 11-50 items | 1-3 minutes | Medium | Regular uploads |
| 51-100 items | 3-8 minutes | Medium-High | Weekly batches |
| 100+ items | 8+ minutes | High | Monthly inventory |

## 🚀 Batch Processing Workflow

### Step 1: Organize Your Images

**Before Uploading:**
```
my-products/
├── product-1-front.jpg
├── product-1-back.jpg
├── product-1-detail.jpg
├── product-2-front.jpg
├── product-2-side.jpg
└── product-3-main.jpg
```

**Naming Convention (Recommended):**
- `product-name-angle.jpg`
- `SKU-123-front.jpg`
- `brand-item-view.jpg`

This makes grouping easier!

### Step 2: Upload in Batches

**Best Practices:**
1. **Compress images first** (optional but recommended):
   ```bash
   # Using ImageMagick (macOS)
   brew install imagemagick
   mogrify -resize 1920x1920\> -quality 85 *.jpg
   ```

2. **Upload 50-100 at a time** for optimal performance

3. **Monitor browser memory:**
   - Chrome: DevTools → Performance Monitor
   - If browser slows down, process in smaller batches

### Step 3: Auto-Sort Categories

Click "🤖 Auto-Sort with AI" to automatically categorize all items.

**Categories:**
- Tops (shirts, blouses, t-shirts)
- Bottoms (pants, skirts, shorts)
- Dresses
- Outerwear (jackets, coats)
- Shoes
- Accessories
- Activewear
- Swimwear
- Sleepwear
- Other

**Manual Override:**
You can still manually adjust any categories after auto-sorting.

### Step 4: Group Product Images

**Automatic Grouping:**
1. Click "🤖 Auto-Group Similar" to group by category
2. Algorithm groups every 3 similar items by default
3. Review and adjust as needed

**Manual Grouping:**
1. Click to select multiple images
2. Click "🔗 Group Selected"
3. Images are now one product with multiple views

**Example:**
```
Before: 6 separate items
- Shirt (front)
- Shirt (back)
- Shirt (detail)
- Pants (front)
- Pants (back)
- Pants (detail)

After: 2 product groups
- Shirt Group (3 images)
- Pants Group (3 images)
```

### Step 5: Bulk Description Generation

**Efficient Processing:**

**Option A: Quick Mode** (Recommended for large batches)
1. Use similar descriptions for similar items
2. Copy/paste and modify
3. Generate AI details in bulk

**Option B: Individual Mode** (Higher quality)
1. Voice describe each product
2. AI generates unique descriptions
3. Takes more time but more accurate

**Keyboard Shortcuts:**
- `Tab` - Next field
- `Ctrl/Cmd + Enter` - Save and next
- `Esc` - Cancel

### Step 6: Batch Export

**CSV Export:**
- Exports ALL processed items at once
- Shopify-ready format
- Can handle 1000+ products

**Google Sheets:**
- Creates one spreadsheet with all products
- Organized by category
- Easy to review and edit

## ⚡ Performance Optimization

### For 100+ Images:

1. **Split into Multiple Sessions:**
   ```
   Session 1: Items 1-50
   Session 2: Items 51-100
   Session 3: Items 101-150
   ```

2. **Use Compression:**
   - Max file size: 2MB per image
   - Recommended: 500KB per image
   - Quality: 80-85% JPEG

3. **Browser Settings:**
   - Close unnecessary tabs
   - Use Chrome or Edge (best performance)
   - Clear browser cache if slow

### Image Compression Tools:

**Online:**
- TinyPNG.com
- Squoosh.app
- Compressor.io

**Desktop:**
- ImageOptim (Mac)
- RIOT (Windows)
- GIMP (Cross-platform)

**Command Line:**
```bash
# Batch compress with ImageMagick
mogrify -strip -quality 85 -resize '1920x1920>' *.jpg

# Using jpegoptim (Linux/Mac)
jpegoptim --size=500k *.jpg
```

## 🤖 Advanced: AI-Powered Batch Features

### Auto-Group Similar Products

The app can automatically group similar images:

**How it Works:**
1. Analyzes image similarity (in production with Google Vision)
2. Groups images by visual similarity + category
3. Suggests groups for your review

**Configuration:**
```typescript
// In ImageGrouper.tsx - customize grouping logic
const similarityThreshold = 0.8; // 80% similarity
const maxImagesPerGroup = 5;     // Max 5 images per product
```

### Bulk AI Description

Generate descriptions for multiple products:

**Tips:**
- Process similar items together (e.g., all t-shirts)
- Use consistent voice descriptions
- AI learns patterns and maintains consistency

## 📋 Batch Processing Checklist

**Before Starting:**
- [ ] Images organized and named consistently
- [ ] Images compressed (< 2MB each)
- [ ] Batch size determined (50-100 recommended)
- [ ] Stable internet connection

**During Processing:**
- [ ] Monitor browser performance
- [ ] Save progress frequently (export CSVs)
- [ ] Review auto-categorization
- [ ] Check groupings are correct

**After Processing:**
- [ ] Export CSV backup
- [ ] Review in Google Sheets (optional)
- [ ] Import to Shopify
- [ ] Verify products in Shopify

## 💡 Batch Processing Tips

### 1. Use Templates

Create description templates for similar items:

```
Template: Casual T-Shirt
---
Title: [Color] [Style] T-Shirt - [Brand]
Description: Comfortable [material] t-shirt perfect for everyday wear. 
Features [details]. Available in [sizes].
Price: $[range]
Tags: tshirt, casual, [color], [style], [brand]
```

### 2. Category-Based Batching

Process by category for better consistency:
- Monday: All tops
- Tuesday: All bottoms
- Wednesday: All dresses
- etc.

### 3. Keyboard Workflow

Speed up with keyboard navigation:
1. Tab through fields
2. Use arrow keys for selects
3. Enter to confirm
4. Esc to cancel

### 4. Two-Person Workflow

For very large batches:
- Person 1: Upload and categorize
- Person 2: Descriptions and details
- Both: Review and export

## 🔍 Troubleshooting Batch Processing

### Browser Freezing
**Solution:**
- Reduce batch size to 25-50 items
- Clear browser cache
- Close other applications
- Use Chrome/Edge

### Slow Upload
**Solution:**
- Check internet speed
- Compress images more
- Upload during off-peak hours
- Use wired connection

### Memory Issues
**Solution:**
- Process in smaller batches
- Restart browser between batches
- Increase system RAM (hardware)
- Use desktop instead of laptop

### Export Fails
**Solution:**
- Try smaller subset first
- Check browser console for errors
- Ensure stable internet
- Try different browser

## 📊 Batch Processing Metrics

Track your efficiency:

**Key Metrics:**
- Images processed per hour
- Products created per session
- Average processing time per item
- Error rate (incorrect categorization)

**Sample Performance:**
```
Efficient Workflow:
- 50 images uploaded: 2 minutes
- AI sorting: 30 seconds
- Grouping (10 products): 3 minutes
- Descriptions: 15 minutes
- Export: 30 seconds
Total: ~21 minutes for 50 images (10 products)
```

## 🎯 Batch Processing Best Practices

1. **Start Small:** Begin with 10-20 items to learn the workflow
2. **Maintain Consistency:** Use same naming conventions
3. **Regular Breaks:** Take breaks every 50 items
4. **Save Frequently:** Export CSV backups regularly
5. **Quality Check:** Review 10% of items for accuracy
6. **Learn Shortcuts:** Master keyboard navigation
7. **Template Library:** Create and reuse templates
8. **Schedule Batches:** Process at consistent times

## 🚀 Scaling Up

**For 500+ Items:**

1. **Day 1:** Upload and categorize (200 items)
2. **Day 2:** Group and describe (200 items)
3. **Day 3:** Review and export (200 items)
4. **Day 4:** Upload batch 2 (200 items)
5. **Day 5:** Process batch 2
6. **Day 6:** Upload batch 3 (100 items)
7. **Day 7:** Process batch 3 and final review

**For 1000+ Items:**
Consider hiring a virtual assistant or:
- Split work across team members
- Use the app in multiple browser tabs (careful!)
- Process over 2-3 weeks

## 📈 Continuous Improvement

**Track and Optimize:**
- Note which categories take longest
- Identify repetitive descriptions
- Create more templates
- Refine auto-grouping settings
- Optimize image sizes

**Automation Ideas:**
- Pre-process images with scripts
- Use consistent file naming
- Batch similar items together
- Create category-specific templates

---

**Ready to process a batch?** Start with 20-30 items to learn the workflow, then scale up!
