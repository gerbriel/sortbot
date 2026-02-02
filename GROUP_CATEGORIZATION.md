# Smart Group Categorization

## Feature Overview

The categorization step now intelligently handles both grouped and individual items:

- **Grouped Items** → Categorize the entire group at once (category applies to all items in the group)
- **Individual Items** → Categorize each item separately

## How It Works

### Visual Indicators

**Grouped Products:**
- Shows ONE card per group (not individual cards for each image)
- Displays the first image as representative
- Shows a badge: **"📦 Group of X"** in the top-right corner
- Label says: "Group Category:"
- Selecting a category applies it to ALL images in that group

**Individual Products:**
- Shows one card per item
- No badge shown
- Label says: "Category:"
- Selecting a category applies to that single item only

### Example Scenario

**You have:**
- 5 photos of a blue shirt (grouped together)
- 3 photos of black pants (grouped together)
- 1 photo of a hat (not grouped)
- 1 photo of a belt (not grouped)

**What you see:**
```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  ┌─────────────┐
│     [Image]     │  │     [Image]     │  │   [Image]   │  │   [Image]   │
│  📦 Group of 5  │  │  📦 Group of 3  │  │             │  │             │
│                 │  │                 │  │             │  │             │
│ Group Category: │  │ Group Category: │  │ Category:   │  │ Category:   │
│ [Tees      ▾]   │  │ [Bottoms   ▾]   │  │ [Hats   ▾]  │  │ [Access.▾]  │
└─────────────────┘  └─────────────────┘  └─────────────┘  └─────────────┘
    Blue Shirt           Black Pants           Hat              Belt
```

**Result:**
- Select "Tees" for shirt group → All 5 shirt photos get "Tees" category
- Select "Bottoms" for pants group → All 3 pants photos get "Bottoms" category  
- Select "Hats" for hat → Single hat photo gets "Hats" category
- Select "Accessories" for belt → Single belt photo gets "Accessories" category

**Total categorizations needed:** 4 (not 10!)

## Implementation Details

### Grouping Logic

```typescript
const itemGroups = useMemo(() => {
  const groups: Record<string, ClothingItem[]> = {};
  
  sortedItems.forEach(item => {
    // Use productGroup if exists, otherwise use item.id (individual item)
    const groupId = item.productGroup || item.id;
    if (!groups[groupId]) {
      groups[groupId] = [];
    }
    groups[groupId].push(item);
  });
  
  return Object.values(groups);
}, [sortedItems]);
```

**Key Points:**
- Items with the same `productGroup` are grouped together
- Items without `productGroup` (or unique `productGroup`) are treated as individual
- Each group is represented by one card showing the first image

### Category Assignment

```typescript
const handleCategorySelect = (groupId: string, category: string) => {
  const updated = sortedItems.map(item => {
    const itemGroupId = item.productGroup || item.id;
    // If item belongs to this group, apply the category
    return itemGroupId === groupId ? { ...item, category } : item;
  });
  setSortedItems(updated);
};
```

**Key Points:**
- When you select a category for a group, it finds ALL items with that `groupId`
- Updates ALL items in the group with the same category
- Individual items are updated independently

### UI Display

```typescript
{itemGroups.map((group) => {
  const representativeItem = group[0];
  const groupId = representativeItem.productGroup || representativeItem.id;
  const isGroup = group.length > 1;
  
  return (
    <div key={groupId} className="item-card">
      <img src={representativeItem.preview} />
      {isGroup && (
        <div className="group-badge">📦 Group of {group.length}</div>
      )}
      <label>{isGroup ? 'Group Category:' : 'Category:'}</label>
      <select onChange={(e) => handleCategorySelect(groupId, e.target.value)}>
        {/* categories */}
      </select>
    </div>
  );
})}
```

## Benefits

### Efficiency
- **Before:** 50 photos = 50 categorizations
- **After:** 50 photos in 10 groups = 10 categorizations! 🎉

### Consistency
- All images of the same product automatically get the same category
- No risk of accidentally categorizing product photos differently

### Clear Visual Feedback
- Badge shows how many images are in each group
- Different label text for groups vs individuals
- Info banner shows total groups and images

### Flexibility
- Grouped items → batch categorize
- Individual items → still get individual treatment
- Best of both worlds!

## User Workflow

1. **Upload Images**
   - Drop 50+ photos

2. **Group Products** (Step 2)
   - Group images of the same product together
   - Example: 5 photos of blue shirt → 1 group
   - Example: 1 photo of unique hat → stays individual

3. **Categorize** (Step 3)
   - See cards for each group/individual item
   - Grouped items show "📦 Group of X" badge
   - Select category for group → applies to all in group
   - Select category for individual → applies to that one only
   - Much faster than categorizing every single photo!

4. **Describe** (Step 4)
   - Voice describe each product group once
   - Description applies to all images in group

5. **Export** (Step 5)
   - All images exported with correct categories

## Visual Design

### Group Badge
- Position: Top-right corner of image
- Background: Purple gradient with transparency
- Text: "📦 Group of X"
- Shadow for depth
- Clearly visible on all images

### Info Banner
- Background: Light blue
- Border: Blue
- Shows: "📦 Showing X product group(s) to categorize (Y total images)"
- Helps user understand what they're categorizing

### Card Hover
- Lifts up slightly
- Adds shadow
- Smooth transition
- Good visual feedback

## Categories Available

1. Sweatshirts
2. Outerwear
3. Tees
4. Bottoms
5. Femme
6. Hats
7. Mystery Boxes
8. Accessories
9. Activewear
10. Other

## Success Criteria

✅ Grouped items show as ONE card with badge  
✅ Individual items show as separate cards  
✅ Categorizing a group applies to ALL items in group  
✅ Categorizing individual item applies to that item only  
✅ Visual distinction between groups and individuals  
✅ Info banner shows accurate counts  
✅ All items must be categorized before proceeding  

## Testing

1. Upload 10+ images
2. Group some images together (e.g., 3 photos of a shirt)
3. Leave some images individual
4. Go to Step 3: Categorize
5. **Verify:**
   - Grouped images show as ONE card with "📦 Group of 3" badge
   - Individual images show as separate cards without badge
   - Selecting category for group updates ALL images in that group
   - Info banner shows correct counts

Perfect for batch processing clothing inventory! 📦✨
