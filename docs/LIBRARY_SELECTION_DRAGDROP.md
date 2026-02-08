# Library Selection and Drag-Drop Features

## Overview
The Library now supports multi-select and drag-drop reordering across all three view modes (Batches, Product Groups, and Images). **The selection UI/UX matches the workflow's ImageGrouper component** for consistency.

## Features

### Multi-Select (Matches ImageGrouper)
- **Click to Select/Deselect**: Simply click on any item to toggle its selection (just like ImageGrouper)
- **Shift + Click**: Hold Shift and click to add multiple items to selection
- **Visual Feedback**: 
  - **Green border and glow** on selected items (not blue - matches workflow)
  - **Green checkmark indicator** appears in top-right corner when selected
  - Same styling as ImageGrouper for familiar experience
- **Open Batch**: Use the "Open" button on batch cards to open a workflow batch

### Selection Toolbar
When items are selected, a **green toolbar** (matching workflow colors) appears at the top with:
- **Selection Count**: Shows how many items are selected with green checkmark icon
- **Clear Selection**: Deselects all items
- **Select All**: Selects all items in the current view
- **Delete Selected**: Bulk delete with confirmation

### Drag-Drop Reordering
- **Draggable Items**: All cards in all views can be dragged
- **Visual States**:
  - **Dragging**: Item becomes semi-transparent with reduced scale
  - **Drag Over**: Drop zone shows **green dashed border** (matches workflow)
  - **Cursor**: Changes to "grab" when hovering, "grabbing" when dragging
- **Reordering**: Drag items to rearrange their order within the current view

## UI/UX Consistency with Workflow

The Library selection system **exactly matches** the ImageGrouper component:

| Feature | ImageGrouper | Library |
|---------|--------------|---------|
| Selection Color | Green (#10b981) | Green (#10b981) ✅ |
| Selection Indicator | Green circle with checkmark | Green circle with checkmark ✅ |
| Border Style | 3px solid green | 3px solid green ✅ |
| Glow Effect | rgba(16, 185, 129, 0.2) | rgba(16, 185, 129, 0.2) ✅ |
| Drag-Over Color | Green dashed border | Green dashed border ✅ |
| Toolbar Color | Green gradient | Green gradient ✅ |
| Animation | Checkmark rotate/scale | Checkmark rotate/scale ✅ |

## Implementation Details

### State Management
```typescript
// Selection tracking using Set for O(1) lookups
const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

// Drag-drop tracking
const [draggedItem, setDraggedItem] = useState<string | null>(null);
const [dragOverItem, setDragOverItem] = useState<string | null>(null);
```

### Event Handlers

#### Selection Handler
```typescript
function handleItemClick(itemId: string, e: React.MouseEvent) {
  // Matches ImageGrouper behavior - simple toggle
  const newSelected = new Set(selectedItems);
  
  if (e.shiftKey) {
    // Shift key - keep existing selection and toggle this item
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
  } else {
    // Normal click - toggle only this item
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
  }
  
  setSelectedItems(newSelected);
}
```

#### Drag Handlers
- `handleDragStart`: Initiates drag, sets dragged item
- `handleDragOver`: Highlights drop zone, prevents default
- `handleDragLeave`: Removes highlight when dragging away
- `handleDrop`: Handles the drop action, reorders items
- `handleDragEnd`: Cleans up drag state

### CSS Classes

#### Selection States (Matches ImageGrouper)
- `.selected`: Applied to selected items (green border, shadow, scale)
- `.dragging`: Applied to item being dragged (opacity, scale)
- `.drag-over`: Applied to drop target (green dashed border, background)
- `.selection-indicator`: Green circle with checkmark (top-right corner)

#### Selection Indicator
```css
.selection-indicator {
  position: absolute;
  top: 8px;
  right: 8px;
  background: #10b981;
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  animation: selectionAppear 0.2s ease-out;
}
```

## Usage Examples

### Select Multiple Items
1. Click first item - **green border and checkmark appear**
2. Click second item - **both items now selected**
3. Shift + Click third item - **adds to selection**
4. Click first item again - **deselects it**

This matches the exact behavior of ImageGrouper in the workflow.

### Open a Batch
- Click the **"Open"** button on a batch card to open it in the workflow
- Or double-click the batch card (coming soon)

### Bulk Delete
1. Select multiple items (click or Ctrl+click)
2. **Green toolbar appears** at top
3. Click "Delete Selected" button
4. Confirm deletion

### Reorder Items
1. Click and hold on any card
2. Drag to new position - **green dashed border shows drop zone**
3. Drop to reorder

## Visual Design (Matches ImageGrouper)

### Colors
- **Selection Border**: `#10b981` (green, not blue)
- **Selection Shadow**: `rgba(16, 185, 129, 0.2)` (green glow)
- **Drag Over Border**: `#10b981` dashed (green, not blue)
- **Toolbar Background**: `linear-gradient(180deg, #d1fae5 0%, #a7f3d0 100%)` (green)
- **Selection Indicator**: `#10b981` circle background
- **Checkmark Icon**: White check inside green circle

### Animations
- **Checkmark Appear**: Rotates and scales in (0.2s ease-out)
  ```css
  @keyframes selectionAppear {
    0% { transform: scale(0) rotate(-180deg); opacity: 0; }
    50% { transform: scale(1.2) rotate(10deg); }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }
  ```
- **Toolbar**: Slides down with 0.2s ease animation
- **Selection**: Smooth 0.2s transitions on all state changes

## Technical Notes

### Event Propagation
Interactive elements (buttons, delete icons) use `e.stopPropagation()` to prevent triggering card selection.

### Data Deduplication
Items are tracked by unique IDs, preventing duplicate selections even when items appear in multiple data sources.

### Performance
- Set-based selection: O(1) add/remove/check operations
- Minimal re-renders: State updates only affected components
- CSS transitions: Hardware-accelerated transform and opacity

## Future Enhancements
- [ ] Drag multiple selected items at once
- [ ] Drag items between different views (convert type)
- [ ] Persist item order to database
- [ ] Undo/redo for reordering
- [ ] Keyboard navigation and shortcuts
- [ ] Touch/mobile support for drag-drop
- [ ] Drag-to-select box (rubber band selection like ImageGrouper)
