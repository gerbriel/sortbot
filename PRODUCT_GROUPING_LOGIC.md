# Product Grouping Logic - Export Clarification

## Understanding Photos vs Products

### Core Concept
**Photos ≠ Products**

- **Photos**: Individual image files you upload
- **Groups**: Collections of photos representing ONE product
- **Products**: What you export (groups are products)

### The Logic

```
Upload 8 Photos
    ↓
Group them into products
    ↓
Photo 1, 2, 3, 4 → Group A (1 product with 4 photos)
Photo 5, 6 → Group B (1 product with 2 photos)
Photo 7 → Group C (1 product with 1 photo - ungrouped becomes its own product)
Photo 8 → Group D (1 product with 1 photo)
    ↓
Export = 4 Products (not 8!)
```

### How It Works in the App

#### Step 1: Upload
You upload any number of photos (8, 20, 100+)

#### Step 2: Group Photos
- Click "Group Similar Items" for AI auto-grouping
- OR manually drag photos together
- Photos in a group = different angles/views of THE SAME product

#### Step 3: Categorize
- If grouped: Categorizing the group applies to ALL photos in it
- If alone: That photo becomes its own product

#### Step 4: Describe
- If grouped: ONE description for the entire group (all photos)
- If alone: ONE description for that single photo product

#### Step 5: Export
- Each GROUP becomes ONE product row in Shopify/Google Sheets
- All photos in a group become multiple image columns (Image 1, Image 2, etc.)

## Export Example

### Scenario:
Upload 8 photos of clothing, create 3 groups:

**Group 1: Rolling Stones Shirt (4 photos)**
- Front view
- Back view
- Tag close-up
- Flat lay

**Group 2: Nike Jacket (2 photos)**
- Front view
- Back view

**Group 3: Vintage Hat (1 photo)**
- Single photo (not grouped)

**Group 4: Adidas Pants (1 photo)**
- Single photo (not grouped)

### Export Result:

**Total Products: 4** (not 8!)

#### Product 1:
- Title: "Black Tees - Black Rolling Stones vintage"
- Price: $32
- Image 1: rolling-stones-front.jpg
- Image 2: rolling-stones-back.jpg
- Image 3: rolling-stones-tag.jpg
- Image 4: rolling-stones-flat.jpg

#### Product 2:
- Title: "Blue Outerwear - Nike jacket"
- Price: $90
- Image 1: nike-jacket-front.jpg
- Image 2: nike-jacket-back.jpg
- Image 3: (empty)
- Image 4: (empty)

#### Product 3:
- Title: "Vintage Hats - Red vintage"
- Price: $26
- Image 1: vintage-hat.jpg
- Image 2: (empty)
- Image 3: (empty)
- Image 4: (empty)

#### Product 4:
- Title: "Black Bottoms - Adidas pants"
- Price: $60
- Image 1: adidas-pants.jpg
- Image 2: (empty)
- Image 3: (empty)
- Image 4: (empty)

## Export Format

### Shopify CSV Columns:
```csv
Title, Handle, Category, Description, Price, Tags, Image URL, Image 2 URL, Image 3 URL, Image 4 URL, Status
```

### Key Points:
1. **One row per GROUP** (not per photo)
2. **Multiple image columns** for all photos in the group
3. **Single description/price/tags** applies to all photos in the group
4. **Ungrouped photos** become individual products (Group of 1)

## Google Sheets Integration

Your test sheet:
```
https://docs.google.com/spreadsheets/d/1dr5an9GjbXnGFTKCNGmQATAuIQDzAGgqtSgp9ta4flM/edit
```

When you click "Export to Google Sheets":
- The app will write ONE row per product group
- Each row includes all images from that group
- Makes it easy to review and import to Shopify

## Why This Matters

### For Shopify:
- One product listing can have multiple photos
- Customers see all angles/views of the same item
- Better product presentation = more sales

### For You:
- Efficiently process batches of photos
- Group photos of the same item together
- Write description once per product (not per photo)
- Export fewer, better-organized products

## Summary

| Concept | What It Is | Example |
|---------|-----------|---------|
| **Photos** | Individual image files | 8 JPG files uploaded |
| **Groups** | Photos of the same product | 4 photos grouped = 1 product |
| **Products** | What you export | 3 groups = 3 Shopify products |
| **Ungrouped** | Solo photos | 1 photo alone = 1 product |

**Remember**: The number of products you export = the number of groups you create, NOT the number of photos you upload!
