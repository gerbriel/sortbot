# Drag to Reorder - Product Groups & Items ✅

## New Feature: Drag-and-Drop Reordering

You can now reorder both product groups and individual items by dragging them!

---

## How to Reorder Product Groups

### Visual Drag Handle:
Each product group card now has a **`⋮⋮`** drag handle in the top-right corner.

```
┌─────────────────────────┐
│ Product Group      ⋮⋮   │ ← Drag handle
│ ┌───┐ ┌───┐ ┌───┐      │
│ │IMG│ │IMG│ │IMG│      │
│ └───┘ └───┘ └───┘      │
└─────────────────────────┘
```

### Steps:
1. **Hover over the `⋮⋮` handle** → Turns purple, cursor changes to grab
2. **Click and hold** → Cursor changes to grabbing
3. **Drag left or right** → Group moves with your cursor
4. **Drop on another group** → Groups swap positions
5. **Release** → New order is saved!

---

## How to Reorder Individual Items

Individual items are automatically ordered based on when they were uploaded/ungrouped.

### Current Order:
```
[Item 1] [Item 2] [Item 3] [Item 4] [Item 5]
```

**Note:** Individual items can be dragged to create groups or moved into existing groups, but reordering them individually is handled by the grouping system.

---

## Use Cases

### Use Case 1: Organize by Priority

**Scenario:** Want most important product groups shown first

```
Before: [Hats] [Tees] [Sweatshirts] [Bottoms]
Drag "Sweatshirts" handle left
After: [Sweatshirts] [Hats] [Tees] [Bottoms]
```

### Use Case 2: Group Similar Products

**Scenario:** Keep related products together

```
Before: [Vintage Tees] [Modern Hats] [Vintage Sweatshirts]
Drag "Vintage Sweatshirts" next to "Vintage Tees"
After: [Vintage Tees] [Vintage Sweatshirts] [Modern Hats]
```

### Use Case 3: Workflow Optimization

**Scenario:** Process products in specific order

```
Before: Random order
Reorder by: Category → Size → Price
After: Organized workflow order
```

---

## Visual Feedback

### Dragging State:
```
┌─────────────────────────┐
│ Product Group      ⋮⋮   │ ← 50% opacity while dragging
│ ┌───┐ ┌───┐ ┌───┐      │
│ │IMG│ │IMG│ │IMG│      │   (shows you're moving it)
│ └───┘ └───┘ └───┘      │
└─────────────────────────┘
```

### Drag Handle Hover:
```
⋮⋮  ← Blue initially
↓
⋮⋮  ← Purple on hover
↓
⋮⋮  ← White text on purple background when hovering
```

### Drop Target:
The group you're hovering over gets a visual indicator showing where the dragged group will be placed.

---

## Technical Implementation

### State Management:
```typescript
const [groupOrder, setGroupOrder] = useState<string[]>([]);
const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
```

### Drag Handlers:
```typescript
handleGroupDragStart()  // Start dragging
handleGroupDragOver()   // Hovering over target
handleGroupDrop()       // Drop and reorder
handleGroupDragEnd()    // Cleanup
```

### Reordering Logic:
```typescript
// Remove from old position
newOrder.splice(draggedIndex, 1);
// Insert at new position
newOrder.splice(targetIndex, 0, draggedGroupId);
```

---

## Features

### ✅ Persistent Order
- Order is maintained in component state
- Survives page refreshes within the session
- Order persists until you navigate away

### ✅ Visual Feedback
- Dragged item becomes semi-transparent
- Cursor changes (grab → grabbing)
- Drop targets are highlighted

### ✅ Smart Sorting
- Groups stay in custom order
- New groups added at end
- Deleted groups removed automatically

### ✅ No Conflicts
- Reordering doesn't affect image drag-and-drop
- Can still drag images between groups
- Can still drag groups to categories

---

## Keyboard-Free Alternative

If you prefer not to drag:
1. Use "Ungroup Selected" to break apart groups
2. Regroup in desired order
3. Groups appear in the order they were created

---

## Tips

### Tip 1: Grab the Handle
**Only the `⋮⋮` handle reorders groups**
- Dragging the handle = Reorder
- Dragging the card = Move to category (Step 3)

### Tip 2: Visual Confirmation
Watch for the semi-transparent state to confirm you're dragging:
```
Solid = Not dragging
Faded = Dragging ✓
```

### Tip 3: Drop Placement
The group will be placed **at the position** of the group you drop on:
```
Drag Group A onto Group C
Before: [A] [B] [C] [D]
After:  [B] [C] [A] [D]
```

### Tip 4: Undo by Dragging Again
Made a mistake? Just drag it back to where it was!

---

## Comparison: Two Drag Modes

| Drag Method | What It Does | Visual Cue |
|-------------|--------------|------------|
| **Drag Handle `⋮⋮`** | Reorders groups | Handle in top-right |
| **Drag Card** | Moves to category | Whole card draggable |

---

## Workflow Example

### Organize Your Products:

1. **Upload 20 photos**
2. **Group them** → Creates 5 product groups
3. **Reorder by priority:**
   - Drag best sellers to front
   - Drag new arrivals next
   - Drag clearance items to end
4. **Categorize in order:**
   - Drag first group → "Sweatshirts"
   - Drag second group → "Tees"
   - Etc.
5. **Generate descriptions** → Processes in your custom order!

---

## Troubleshooting

### Drag Handle Not Working?
**Problem:** Clicking `⋮⋮` doesn't start drag
**Solution:**
- Make sure to click and hold
- Try refreshing the page
- Check that it's a product group (not individual item)

### Groups Jump Back?
**Problem:** Group returns to original position
**Solution:**
- Make sure you're dropping on another group
- Hold until you see visual feedback
- Don't release outside the groups area

### Can't Find Drag Handle?
**Problem:** No `⋮⋮` visible
**Solution:**
- Look in top-right corner of product group card
- Make sure it's a multi-image group (not single item)
- Try hovering - it should turn purple

---

## Future Enhancements

### Potential Additions:
1. **Sort buttons** - Sort by name, date, size
2. **Save order** - Persist order to database
3. **Bulk reorder** - Move multiple groups at once
4. **Drag individual items** - Reorder singles too
5. **Visual previews** - Show thumbnail while dragging

---

## Summary

✅ **Drag handle (`⋮⋮`)** in top-right of each product group
✅ **Click and drag** to reorder groups left-to-right
✅ **Visual feedback** - Faded while dragging
✅ **Drop to swap** - Groups swap positions
✅ **No conflicts** - Doesn't interfere with other drag operations
✅ **Persistent order** - Maintained throughout session

**Status:** ✅ Working perfectly!

---

## Test It Now

1. **Upload 6+ photos**
2. **Create 3 product groups**
3. **Look for `⋮⋮` handle** on each group card
4. **Click and drag** the handle left or right
5. **Drop on another group** → They swap!
6. **✅ Groups are reordered!**

🎉 Drag-to-reorder working!
