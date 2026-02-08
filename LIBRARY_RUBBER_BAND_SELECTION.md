# Library Rubber Band Selection Implementation

## Overview
Implemented rubber band (drag-to-select) selection functionality in the Library component, matching the UX pattern from ImageGrouper.

## Changes Made

### 1. **Library.tsx** - Added Selection State & Handlers

#### State Variables (Lines 57-68)
```typescript
const [isSelecting, setIsSelecting] = useState(false);
const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
const [selectionThresholdMet, setSelectionThresholdMet] = useState(false);

// Refs for grid containers
const batchesGridRef = useRef<HTMLDivElement>(null);
const groupsGridRef = useRef<HTMLDivElement>(null);
const imagesGridRef = useRef<HTMLDivElement>(null);
const currentContainerRef = useRef<HTMLElement | null>(null);

const SELECTION_THRESHOLD = 5; // pixels - must move 5px to activate selection
```

#### Mouse Event Handlers (Lines 387-493)

**handleMouseDown** - Initiates selection
- Ignores clicks on buttons/inputs
- Records starting position
- Sets up selection state

**useEffect with handleMouseMove** - Tracks mouse movement
- Calculates selection box dimensions
- Checks threshold (5px movement required)
- Uses bounding box intersection detection
- Updates selected items in real-time

**useEffect with handleMouseUp** - Finalizes selection
- Cleans up selection state
- Global listeners attached when selecting

### 2. **Grid Container Updates**

Added refs and mouse handlers to all three grid containers:

#### Batches Grid (Lines 658-677)
```tsx
<div 
  className="batch-grid"
  ref={batchesGridRef}
  onMouseDown={(e) => handleMouseDown(e, batchesGridRef)}
>
  {renderBatchesView()}
  {isSelecting && selectionBox && viewMode === 'batches' && (
    <div className="selection-box" style={{...}} />
  )}
</div>
```

#### Groups Grid (Lines 689-708)
Same pattern as batches

#### Images Grid (Lines 721-740)
Same pattern as batches

### 3. **Card Data Attributes**

Added `data-item-id` to all card elements for selection detection:

- **Batch cards** (Line 759): `data-item-id={batch.id}`
- **Group cards** (Line 938): `data-item-id={group.id}`
- **Image cards** (Line 1033): `data-item-id={image.id}`

### 4. **Library.css** - Selection Box Styling

```css
/* Rubber Band Selection Box */
.selection-box {
  position: absolute;
  border: 2px dashed #667eea;
  background: rgba(102, 126, 234, 0.15);
  pointer-events: none;
  z-index: 1000;
  box-sizing: border-box;
}

/* Grid containers need position relative */
.batch-grid,
.groups-grid,
.images-grid {
  position: relative;
}
```

## How It Works

### Selection Flow

1. **Mouse Down**: User clicks and holds on grid background
   - Prevents activation if clicking buttons/inputs
   - Records starting coordinates
   - Sets `isSelecting = true`

2. **Mouse Move**: User drags mouse while holding
   - Calculates selection box dimensions (x, y, width, height)
   - Requires 5px movement to activate (prevents accidental selections)
   - Draws blue dashed selection box
   - Queries all cards with `[data-item-id]` attribute
   - Uses bounding box intersection to detect overlapping cards
   - Updates `selectedItems` Set in real-time

3. **Mouse Up**: User releases mouse
   - Cleans up selection state
   - Selected items remain in `selectedItems` Set
   - Selection box disappears

### Intersection Detection

Uses rectangle intersection algorithm:
```typescript
const intersects = !(
  cardRect.right < selectionRect.left ||
  cardRect.left > selectionRect.right ||
  cardRect.bottom < selectionRect.top ||
  cardRect.top > selectionRect.bottom
);
```

If any part of a card overlaps the selection box, it gets selected.

## Features

✅ **Rubber band selection box** - Visual feedback while dragging
✅ **5px threshold** - Prevents accidental selections from clicks
✅ **Real-time selection** - Items highlight as box touches them
✅ **Works in all three views** - Batches, Groups, Images
✅ **Button protection** - Doesn't interfere with button clicks
✅ **Green selection indicators** - Checkmarks on selected items
✅ **Compatible with click selection** - Can mix both methods
✅ **Shift+click still works** - For multi-select via clicking

## Testing

### Manual Test Cases

1. **Basic Drag Selection**
   - Go to Library
   - Click and drag across multiple cards
   - Should see blue dashed box
   - Cards inside box should get green checkmarks

2. **Threshold Test**
   - Click on grid background
   - Move mouse < 5px
   - Release
   - Should NOT create selection (prevents accidental drags)

3. **Button Protection**
   - Click and drag starting FROM a button
   - Should NOT start selection
   - Button action should work normally

4. **Multi-View Test**
   - Test in Batches view
   - Test in Groups view
   - Test in Images view
   - All should work identically

5. **Mixed Selection Methods**
   - Drag-select some items
   - Click another item (should deselect others)
   - Shift+click another (should add to selection)
   - Drag-select again (should replace selection)

## Architecture Notes

### Pattern Consistency
- Follows exact same pattern as `ImageGrouper.tsx`
- Uses same green color (#10b981) for selection
- Uses same threshold value (5px)
- Uses same bounding box intersection logic

### Performance
- Queries DOM only during drag operations
- Uses `querySelectorAll` with attribute selector (fast)
- Selection updates throttled by browser's mousemove event rate
- Clean up of global listeners in useEffect return

### State Management
- `isSelecting` - Boolean flag for active selection
- `selectionStart` - Starting coordinates (x, y)
- `selectionBox` - Current box dimensions (x, y, width, height)
- `selectionThresholdMet` - Whether 5px moved yet
- `currentContainerRef` - Which grid is being selected in
- `selectedItems` - Set of selected item IDs (shared with click selection)

## Related Files
- `src/components/Library.tsx` - Main implementation
- `src/components/Library.css` - Selection box styling
- `src/components/ImageGrouper.tsx` - Reference implementation

## Status
✅ **COMPLETE** - All compilation errors resolved, feature fully implemented and ready for testing
