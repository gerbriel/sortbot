# Fix: Library Selection Box Scroll Limit & Reset Issue

## Problem 1: Selection Box Maxing Out
The rubber band selection box was stopping at approximately 9 sections and wouldn't extend further when scrolling. The selection was "maxing out" even though there were more items below.

## Problem 2: Selection Count Resetting During Scroll
When scrolling during selection, the selected item count would reset back down instead of accumulating. Items would get deselected as the container scrolled.

## Root Causes

### Issue 1: Viewport-Only Coordinates
## Root Causes

### Issue 1: Viewport-Only Coordinates
The selection box coordinates were calculated relative to the **viewport** (visible area) only, without accounting for the scroll position. When the user scrolled down:
- The `currentY` position was calculated as `e.clientY - rect.top`
- This gave the position relative to the **visible top** of the container
- But the selection box needed coordinates relative to the **content**, not the viewport
- As the container scrolled, the selection box couldn't extend beyond what was visible in the viewport

### Issue 2: Coordinate System Mismatch
The intersection detection was comparing coordinates from two different coordinate systems:
- **Selection box**: Used scroll-adjusted coordinates (relative to content)
- **Card positions**: Used `getBoundingClientRect()` which returns viewport coordinates
- When scrolling, these two systems were out of sync, causing items to incorrectly drop out of selection

## Solution
Updated the coordinate system to account for scroll position in both the selection start and selection tracking:

### 1. **Track Scroll-Adjusted Coordinates in State**

The `selectionStart` and `selectionBox` state now store coordinates relative to the **scrolled content**, not the viewport.

#### handleMouseDown (Lines 387-408)
```typescript
const scrollTop = containerRef.current?.scrollTop || 0;
const startX = e.clientX - rect.left;
const startY = e.clientY - rect.top + scrollTop; // Add scroll offset
```

#### handleMouseMove (Lines 418-427)
```typescript
const scrollTop = currentContainerRef.current.scrollTop;

// Calculate position relative to container, accounting for scroll
let currentX = e.clientX - rect.left;
let currentY = e.clientY - rect.top + scrollTop; // Add scroll offset
```

### 2. **Convert Back to Viewport Coordinates for Rendering**

Created helper function `getViewportSelectionBox()` (Lines 274-283):
```typescript
const getViewportSelectionBox = () => {
  if (!selectionBox || !currentContainerRef.current) return null;
  
  const scrollTop = currentContainerRef.current.scrollTop;
  return {
    x: selectionBox.x,
    y: selectionBox.y - scrollTop, // Subtract scroll to get viewport position
    width: selectionBox.width,
    height: selectionBox.height
  };
};
```

### 3. **Updated Rendering in All Three Grids**

Changed from:
```tsx
{isSelecting && selectionBox && viewMode === 'batches' && (
  <div
    className="selection-box"
    style={{
      left: `${selectionBox.x}px`,
      top: `${selectionBox.y}px`,
      width: `${selectionBox.width}px`,
      height: `${selectionBox.height}px`,
    }}
  />
)}
```

To:
```tsx
{isSelecting && selectionBox && viewMode === 'batches' && (() => {
  const viewportBox = getViewportSelectionBox();
  return viewportBox ? (
    <div
      className="selection-box"
      style={{
        left: `${viewportBox.x}px`,
        top: `${viewportBox.y}px`,
        width: `${viewportBox.width}px`,
        height: `${viewportBox.height}px`,
      }}
    />
  ) : null;
})()}
```

### 4. **Fixed Intersection Detection to Use Consistent Coordinates**

The critical fix for the reset issue - convert card positions to scroll-adjusted coordinates:

```typescript
// Calculate which items are selected
if (selectionThresholdMet) {
  // Selection box in scroll-adjusted coordinates
  const selectionMinX = Math.min(selectionStart.x, currentX);
  const selectionMaxX = Math.max(selectionStart.x, currentX);
  const selectionMinY = Math.min(selectionStart.y, currentY);
  const selectionMaxY = Math.max(selectionStart.y, currentY);

  const cards = currentContainerRef.current.querySelectorAll('[data-item-id]');
  const newSelected = new Set<string>();

  cards.forEach((card) => {
    const cardRect = card.getBoundingClientRect();
    const itemId = card.getAttribute('data-item-id');
    
    if (!itemId) return;

    // Convert card position to scroll-adjusted coordinates
    const cardScrollTop = cardRect.top - rect.top + scrollTop;
    const cardScrollBottom = cardRect.bottom - rect.top + scrollTop;
    const cardScrollLeft = cardRect.left - rect.left;
    const cardScrollRight = cardRect.right - rect.left;

    // Check intersection using same coordinate system
    const intersects = !(
      cardScrollRight < selectionMinX ||
      cardScrollLeft > selectionMaxX ||
      cardScrollBottom < selectionMinY ||
      cardScrollTop > selectionMaxY
    );

    if (intersects) {
      newSelected.add(itemId);
    }
  });

  setSelectedItems(newSelected);
}
```

This ensures both the selection box and card positions are in the **same coordinate system** (scroll-adjusted), so intersection detection remains accurate during scrolling.

## How It Works Now

### Coordinate System
- **Internal State (selectionStart, selectionBox)**: Stores scroll-adjusted coordinates relative to the entire scrollable content
- **Rendering (selection-box div)**: Uses viewport-relative coordinates for CSS positioning

### Selection Flow
1. **Mouse Down**: Record starting position + current scroll offset
2. **Mouse Move**: Calculate current position + current scroll offset
3. **Selection Box State**: Store the scroll-adjusted coordinates (can be thousands of pixels)
4. **Auto-Scroll**: Changes scroll position dynamically
5. **Rendering**: Convert scroll-adjusted coordinates back to viewport coordinates
6. **Intersection Detection**: Uses scroll-adjusted coordinates to find selected items

### Example
- Container scrollTop: 1000px
- Mouse at viewport position: 200px from top
- Stored Y coordinate: 200 + 1000 = 1200px (scroll-adjusted)
- Rendered Y coordinate: 1200 - 1000 = 200px (viewport-relative)

## Benefits

✅ **Unlimited Selection Range**: Can now select from top to bottom of any length of content
✅ **Accurate During Scroll**: Selection box stays in correct position while auto-scrolling
✅ **Proper Intersection Detection**: Items are correctly detected as they scroll into/out of selection
✅ **No Selection Reset**: Selected items stay selected during scrolling - count only increases
✅ **Visual Consistency**: Selection box always appears in the correct viewport position
✅ **Consistent Coordinate System**: All calculations use scroll-adjusted coordinates internally

## Testing

### Manual Test Cases

1. **Long Selection with Scroll**
   - Create a batch list with 50+ items
   - Start selection at top
   - Drag mouse below Library popup
   - Auto-scroll should engage
   - Selection should continue expanding past 9, 10, 20, 30+ items
   - All items touched by selection box should be selected

2. **Start from Scrolled Position**
   - Scroll down halfway in Library
   - Start selection
   - Drag up and down
   - Selection should work correctly from any scroll position

3. **Selection While Scrolling**
   - Start selection
   - Trigger auto-scroll
   - Watch selection box stay visually correct
   - **Check that selected count only increases, never decreases**
   - Verify items stay selected as they scroll out of view
   - Items that scroll into selection should get selected

4. **All Three Views**
   - Test in Batches view (longer items)
   - Test in Groups view (medium items)
   - Test in Images view (compact items)
   - All should handle unlimited selection

## Technical Details

### Before (Broken)

**Problem 1: Limited by Viewport**
```
viewportTop = 0px
selectionStart.y = 100px (viewport relative)
mouseY after scroll = 900px (still viewport relative, max ~container height)
selectionBox.height = 900 - 100 = 800px (limited by viewport height)
```

**Problem 2: Coordinate Mismatch During Scroll**
```
selectionBox.y = 500px (scroll-adjusted)
cardRect.top = 200px (viewport coordinate from getBoundingClientRect)
// Comparing apples to oranges!
intersects = !(200 < 500) // Wrong! Different coordinate systems
// As scroll changes, cards incorrectly drop out of selection
```

### After (Fixed)

**Solution 1: Scroll-Adjusted Storage**
```
viewportTop = 0px, scrollTop = 0px
selectionStart.y = 100px (scroll-adjusted: 100 + 0 = 100px)

[User scrolls, scrollTop becomes 2000px]

mouseY viewport position = 500px
mouseY scroll-adjusted = 500 + 2000 = 2500px
selectionBox.height = 2500 - 100 = 2400px (unlimited!)
viewportBox.y = 2500 - 2000 = 500px (correct viewport position for CSS)
```

**Solution 2: Consistent Coordinate System**
```
// Selection box coordinates
selectionMinY = 100px (scroll-adjusted)
selectionMaxY = 2500px (scroll-adjusted)

// Card coordinates - CONVERT to scroll-adjusted
cardRect.top = 200px (viewport)
scrollTop = 2000px
cardScrollTop = 200 - 0 + 2000 = 2200px (scroll-adjusted)
cardScrollBottom = 300 - 0 + 2000 = 2300px (scroll-adjusted)

// Now comparing same coordinate system!
intersects = !(2300 < 100 || 2200 > 2500) // Correct!
// Card stays selected as long as it's in the selection box range
```

## Related Files
- `src/components/Library.tsx` - Main implementation
- `LIBRARY_RUBBER_BAND_SELECTION.md` - Original selection feature
- `LIBRARY_AUTO_SCROLL_SELECTION.md` - Auto-scroll feature

## Status
✅ **FIXED** - Both issues resolved:
1. Selection box no longer limited by viewport, can select unlimited items with scrolling
2. Selection count no longer resets during scroll - items stay selected correctly
