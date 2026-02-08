# Library Auto-Scroll During Selection

## Overview
Added auto-scroll functionality to the Library component so users can scroll down (or up) while doing rubber band selection by dragging near the edges.

## Implementation Details

### Auto-Scroll Logic (Library.tsx, Lines 411-467)

```typescript
const SCROLL_ZONE = 50; // pixels from edge to trigger scroll
const SCROLL_SPEED = 10; // pixels per frame
let scrollInterval: number | null = null;
```

### How It Works

1. **Edge Detection**: While dragging the selection box, the code checks the mouse position relative to the scrollable container boundaries.

2. **Scroll Activation**:
   - **Mouse above container OR within 50px of top edge**: Scrolls up at 10px per frame (~60fps)
   - **Mouse below container OR within 50px of bottom edge**: Scrolls down at 10px per frame
   - **Mouse in neutral zone**: No scrolling, clears any active scroll interval

3. **Key Improvement**: The scroll triggers even when your mouse moves **outside** the Library popup (above or below it), not just when near the edges. This makes it much easier to scroll while selecting.

4. **Interval Management**:
   - Creates a new `setInterval` when entering a scroll zone
   - Clears previous interval before creating a new one (prevents multiple simultaneous scrolls)
   - Cleans up interval on mouse up
   - Cleans up interval on component unmount

### Code Changes

#### Mouse Position Detection
```typescript
const mouseY = e.clientY;
const containerTop = rect.top;
const containerBottom = rect.bottom;
```

#### Scroll Up (Above Container or Near Top)
```typescript
if (mouseY < containerTop || (mouseY - containerTop < SCROLL_ZONE && mouseY > containerTop)) {
  // Mouse is above container or near top edge - scroll up
  scrollInterval = setInterval(() => {
    if (currentContainerRef.current) {
      currentContainerRef.current.scrollTop -= SCROLL_SPEED;
    }
  }, 16); // ~60fps
}
```

#### Scroll Down (Below Container or Near Bottom)
```typescript
else if (mouseY > containerBottom || (containerBottom - mouseY < SCROLL_ZONE && mouseY < containerBottom)) {
  // Mouse is below container or near bottom edge - scroll down
  scrollInterval = setInterval(() => {
    if (currentContainerRef.current) {
      currentContainerRef.current.scrollTop += SCROLL_SPEED;
    }
  }, 16);
}
```

#### Cleanup in handleMouseUp
```typescript
const handleMouseUp = () => {
  // Clear scroll interval
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
  // ... rest of cleanup
};
```

#### Cleanup in useEffect Return
```typescript
return () => {
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
  // Clean up scroll interval on unmount
  if (scrollInterval) {
    clearInterval(scrollInterval);
  }
};
```

## User Experience

### How to Use Auto-Scroll

1. **Start Selection**: Click and drag in the Library grid
2. **Trigger Scroll Down**: 
   - Move mouse near the bottom edge of the Library popup, OR
   - Move mouse **below** the Library popup entirely
3. **Trigger Scroll Up**:
   - Move mouse near the top edge of the Library popup, OR
   - Move mouse **above** the Library popup entirely
4. **Automatic Scrolling**: 
   - Grid automatically scrolls in the direction you're dragging
   - Selection box continues to expand as you scroll
   - Items are selected in real-time as they come into view
5. **Stop Scrolling**: Move mouse back into the neutral zone (middle area)
6. **Finish Selection**: Release mouse button (scrolling stops, selection finalized)

### Visual Feedback
- Selection box continues to draw and update during scrolling
- Selected items show green checkmarks in real-time
- Smooth 60fps scroll animation
- Scroll speed is constant and predictable

## Configuration

### Adjustable Parameters

```typescript
const SCROLL_ZONE = 50;    // Distance from edge to trigger scroll (pixels)
const SCROLL_SPEED = 10;   // Scroll distance per frame (pixels)
const FRAME_RATE = 16;     // Milliseconds between frames (~60fps)
```

**SCROLL_ZONE (50px)**:
- Larger value = easier to trigger scroll (more forgiving)
- Smaller value = requires more precision
- Current value provides good balance

**SCROLL_SPEED (10px)**:
- Higher value = faster scrolling (may feel jerky)
- Lower value = slower, more controlled
- Current value provides smooth, controlled scrolling

**FRAME_RATE (16ms)**:
- 16ms ≈ 60 frames per second
- Lower values = smoother but more CPU intensive
- Higher values = choppier but less resource usage

## Edge Cases Handled

✅ **Multiple intervals prevented**: Clears old interval before creating new one
✅ **Memory leaks prevented**: Cleanup in both mouseUp and useEffect return
✅ **Scrolls when mouse outside container**: Works even when mouse is above/below the popup
✅ **Scrolls when mouse near edges**: Also works with traditional edge-proximity scrolling
✅ **No scroll when not selecting**: Interval only created during active selection
✅ **Smooth transitions**: Clearing interval immediately when leaving scroll zone

## Testing Scenarios

### Manual Test Cases

1. **Basic Auto-Scroll Down**
   - Start selection at top of Library
   - Drag down to bottom edge
   - Should automatically scroll down
   - Selection should continue expanding

2. **Auto-Scroll Up**
   - Scroll down in Library
   - Start selection
   - Drag mouse above the Library popup (move cursor above the modal)
   - Should automatically scroll up

3. **Auto-Scroll Down by Moving Below**
   - Start selection at top of Library
   - Drag mouse below the Library popup (move cursor below the modal)
   - Should automatically scroll down
   - This is the key improvement - you don't need to stay inside the popup

4. **Stop Scrolling Mid-Drag**
   - Start selection and trigger auto-scroll
   - Move mouse away from edge (but keep holding button)
   - Scrolling should stop immediately
   - Selection should remain active

4. **Scroll and Release**
   - Trigger auto-scroll
   - Release mouse button while scrolling
   - Scrolling should stop
   - Selection should finalize

5. **All Three Views**
   - Test auto-scroll in Batches view
   - Test auto-scroll in Groups view  
   - Test auto-scroll in Images view
   - All should work identically

6. **Long Selection**
   - Create very long selection spanning entire scrollable area
   - Should be able to select from top to bottom using auto-scroll
   - All items in between should get selected

## Performance Considerations

- **60fps scroll rate**: Smooth visual experience
- **Interval cleanup**: Prevents memory leaks
- **Conditional execution**: Scroll only when needed
- **Direct DOM manipulation**: Uses `scrollTop` for efficiency
- **Ref-based access**: Avoids React re-renders during scroll

## Browser Compatibility

Works in all modern browsers:
- ✅ Chrome/Edge
- ✅ Firefox
- ✅ Safari
- ✅ Any browser supporting `setInterval` and `scrollTop`

## Related Files
- `src/components/Library.tsx` - Main implementation
- `LIBRARY_RUBBER_BAND_SELECTION.md` - Base selection feature

## Status
✅ **COMPLETE** - Auto-scroll fully implemented and ready for testing
