# Ungroup Selected Feature - Guide

## ✅ How It Works

The "✂️ Ungroup Selected" button removes selected images from their product groups, making them individual items again.

---

## Use Cases

### Use Case 1: Remove One Photo from a Group

**Scenario:** You have a 4-image product group, but one photo doesn't belong.

**Steps:**
```
1. You have: [Group: 4 images]
2. Click the wrong photo in the group
3. Click "✂️ Ungroup Selected"
4. Result: [Group: 3 images] + [Single: 1 image]
```

### Use Case 2: Split a Group in Half

**Scenario:** You accidentally grouped two different products together.

**Steps:**
```
1. You have: [Group: 6 images] (actually 2 products)
2. Click first 3 images (Shift+Click)
3. Click "✂️ Ungroup Selected"
4. Result: [3 individual images] + [Group: 3 images]
5. Select the first 3 again
6. Click "🔗 Group Selected"
7. Result: [Group: 3 images] + [Group: 3 images]
```

### Use Case 3: Break Up Entire Group

**Scenario:** You want to completely dissolve a product group.

**Steps:**
```
1. You have: [Group: 5 images]
2. Click all 5 images in the group (Shift+Click)
3. Click "✂️ Ungroup Selected"
4. Result: [5 individual images]
```

### Use Case 4: Remove Multiple Photos

**Scenario:** Product group has too many photos, remove several at once.

**Steps:**
```
1. You have: [Group: 8 images]
2. Shift+Click 3 photos you don't want
3. Click "✂️ Ungroup Selected"
4. Result: [Group: 5 images] + [3 individual images]
```

---

## How It Works Technically

### Code Logic:
```typescript
const ungroupSelected = () => {
  const updated = groupedItems.map(item =>
    selectedItems.has(item.id)
      ? { ...item, productGroup: item.id, category: undefined }
      : item
  );
  // Each selected item gets its own productGroup ID
  // This makes them "individual items"
};
```

### What Happens:
1. **Selected images** → Each gets `productGroup = item.id` (becomes individual)
2. **Unselected images** → Keep their current `productGroup` (stay grouped)
3. **Category cleared** → Ungrouped items lose their category (must recategorize)

---

## Visual Example

### Before Ungrouping:
```
Product Groups:
┌─────────────────────────────┐
│ Group: 4 images             │
│ [IMG1] [IMG2] [IMG3] [IMG4] │ ← All in group-123
│                             │
└─────────────────────────────┘
```

### Select 2 Images:
```
Product Groups:
┌─────────────────────────────┐
│ Group: 4 images             │
│ [IMG1] [✓IMG2] [IMG3] [✓IMG4] │ ← 2 selected
│                             │
└─────────────────────────────┘
```

### After Ungroup Selected:
```
Individual Items:
┌─────┐ ┌─────┐
│IMG2 │ │IMG4 │ ← Now individual (productGroup = own ID)
└─────┘ └─────┘

Product Groups:
┌─────────────────┐
│ Group: 2 images │
│ [IMG1] [IMG3]   │ ← Remaining group (still group-123)
└─────────────────┘
```

---

## Button States

### Enabled:
```
✂️ Ungroup Selected
↑
When 1+ images are selected
```

### Disabled:
```
✂️ Ungroup Selected (grayed out)
↑
When 0 images are selected
```

### With Counter:
```
Header shows: ✓ 3 Selected
Button shows: ✂️ Ungroup Selected
```

---

## Workflow Examples

### Example 1: Fix Grouping Mistake

**Problem:** Grouped wrong images together

```
1. Upload 10 photos
2. Accidentally select and group photos 1-5
3. Realize photos 4-5 belong to different product
4. Click photos 4-5 in the group
5. Click "✂️ Ungroup Selected"
6. Photos 4-5 now individual
7. Select photos 4-5 again
8. Group them separately
```

### Example 2: Quality Control

**Problem:** One photo in group is blurry

```
1. Have group of 6 photos
2. Notice one is out of focus
3. Click the blurry photo
4. Click "✂️ Ungroup Selected"
5. Blurry photo now individual
6. Click × on it to delete
7. Group remains with 5 good photos
```

### Example 3: Reorganize Groups

**Problem:** Need to move photos between groups

```
1. Have Group A (4 photos) and Group B (3 photos)
2. Want to move 1 photo from A to B
3. Click the photo in Group A
4. Click "✂️ Ungroup Selected"
5. Photo becomes individual
6. Select it + Group B photos
7. Click "🔗 Group Selected"
8. Now all in Group B
```

---

## Important Notes

### Category is Cleared
When you ungroup images, their category assignment is removed:
```
Before: Group → "Sweatshirts" category
After ungroup: Individual items → No category
You must recategorize in Step 3
```

### Selection Auto-Clears
After ungrouping, selection is automatically cleared:
```
Before: 3 selected ✓✓✓
Click ungroup
After: 0 selected (auto-cleared)
```

### Group Updates Immediately
The change is instant in the UI:
```
No page refresh needed
Group count updates
Individual items section updates
```

---

## Tips

### Tip 1: Preview Before Ungrouping
Check selection counter to confirm you selected the right photos:
```
Header: ✓ 2 Selected
↑
Make sure this matches what you want to ungroup
```

### Tip 2: Use Shift+Click
Select multiple photos to ungroup at once:
```
Click photo 1
Shift+Click photo 2
Shift+Click photo 3
Ungroup all 3 together
```

### Tip 3: Don't Need to Ungroup Everything
You can leave some photos in the group:
```
Group of 5 photos
Select 2 to remove
Other 3 stay grouped ✅
```

### Tip 4: Regroup Immediately
After ungrouping, you can immediately regroup:
```
1. Ungroup 3 photos from Group A
2. Select those 3 ungrouped photos
3. Group them into new Group B
```

---

## Troubleshooting

### Button Disabled?
**Problem:** Can't click "Ungroup Selected"
**Solution:** Select at least 1 image first (green checkmark)

### Nothing Happens?
**Problem:** Clicked ungroup but group looks the same
**Solution:** 
- Check if you actually had items selected
- Look in "Individual Items" section - ungrouped photos appear there

### Lost Category?
**Problem:** Ungrouped items lost their category tag
**Solution:** This is expected behavior - recategorize them in Step 3

### Group Disappeared?
**Problem:** Entire group vanished
**Solution:** If you ungrouped all photos in a group, they all become individual items (check Individual Items section)

---

## Comparison with Other Actions

| Action | What It Does | When to Use |
|--------|--------------|-------------|
| **Group Selected** | Combines selected images into 1 group | Creating a multi-image product |
| **Ungroup Selected** | Removes selected images from groups | Fixing grouping mistakes |
| **Drag & Drop** | Moves images between existing groups | Reorganizing within groups |
| **Delete (×)** | Permanently removes image | Removing unwanted photos |
| **Clear Selection** | Deselects all images | Starting fresh |

---

## Summary

✅ **Select photos in a group** → Click them (checkmarks appear)
✅ **Click "✂️ Ungroup Selected"** → Removes them from group
✅ **Photos become individual** → Each gets its own productGroup ID
✅ **Original group remains** → Other photos stay grouped
✅ **Category cleared** → Must recategorize ungrouped items
✅ **Selection auto-clears** → Ready for next action

**Status:** ✅ Working perfectly!

---

## Test It Now

1. **Upload 4 photos**
2. **Select all 4** (Shift+Click)
3. **Click "Group Selected"** → Creates 1 group
4. **Click 2 photos in the group** → Select them
5. **Click "✂️ Ungroup Selected"** → Removes those 2
6. **Result:** 1 group (2 photos) + 2 individual items

🎉 Ungroup feature working as expected!
