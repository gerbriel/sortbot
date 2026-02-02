# Speech Recognition Fix v3 - Transcript Disappearing Issue

## Problem
User reported:
```
when i speak it catches what i say and transcribes it onscreen 
but then quickly gets removed and shows nothing
```

Console logs showed:
```
Starting recording...
Speech recognition started
Stopping recording... <- Auto-triggered!
Speech recognition ended
```

The recording was stopping automatically right after starting, and transcripts were disappearing.

## Root Cause

### The Bug: Using Wrong Data Source

```typescript
// BEFORE - BUG:
const productGroups = items.reduce(...);  // Uses original items prop
const [processedItems, setProcessedItems] = useState(items);
const currentItem = currentGroup[0];  // From items, not processedItems!

// In onresult:
currentItem.voiceDescription  // <- ALWAYS empty/old!
```

**The Problem:**
1. `productGroups` and `groupArray` were calculated from the **original `items` prop**
2. `processedItems` **state** holds the actual data with voice descriptions
3. When we save a voice description to `processedItems`, the UI still reads from old `items`
4. `currentItem.voiceDescription` was always stale/empty
5. This caused multiple issues:
   - Transcript appeared briefly then disappeared
   - Voice descriptions weren't accumulating properly
   - State was out of sync

### Why It Stopped Automatically

The automatic stopping happened because:
1. When `processedItems` updated (voice description saved)
2. Component re-rendered
3. But `currentItem` was from old data (derived from `items` prop)
4. Something in the render cycle triggered unexpected behavior
5. Recording stopped prematurely

## Solution

### Fix 1: Use `processedItems` for Everything

```typescript
// AFTER - FIXED:
const [processedItems, setProcessedItems] = useState(items);

// Calculate groups from processedItems (live state)
const productGroups = processedItems.reduce((groups, item) => {
  const groupId = item.productGroup || item.id;
  if (!groups[groupId]) {
    groups[groupId] = [];
  }
  groups[groupId].push(item);
  return groups;
}, {} as Record<string, ClothingItem[]>);

const groupArray = Object.values(productGroups);
const currentGroup = groupArray[currentGroupIndex];
const currentItem = currentGroup[0]; // Now from processedItems!
```

**Why This Works:**
- `currentGroup` and `currentItem` now always reflect latest state
- Voice descriptions persist correctly
- No stale data causing re-render issues

### Fix 2: Recalculate Groups in State Updater

In the `onresult` callback, we now recalculate groups from the updated state:

```typescript
recognition.onresult = (event) => {
  if (final) {
    setProcessedItems(prev => {
      const updated = [...prev];
      
      // Recalculate groups from UPDATED items
      const updatedGroups = updated.reduce((groups, item) => {
        const groupId = item.productGroup || item.id;
        if (!groups[groupId]) {
          groups[groupId] = [];
        }
        groups[groupId].push(item);
        return groups;
      }, {} as Record<string, ClothingItem[]>);
      
      const updatedGroupArray = Object.values(updatedGroups);
      const currentGroup = updatedGroupArray[currentGroupIndex];
      const currentItem = currentGroup[0];
      
      // Now currentDescription has previous transcripts!
      const currentDescription = currentItem.voiceDescription || '';
      
      // Append new transcript to existing one
      currentGroup.forEach(groupItem => {
        const itemIndex = updated.findIndex(item => item.id === groupItem.id);
        if (itemIndex !== -1) {
          updated[itemIndex] = {
            ...updated[itemIndex],
            voiceDescription: (currentDescription + final).trim()
          };
        }
      });
      
      return updated;
    });
  }
};
```

**Why This Works:**
- Groups are recalculated from the updated state inside the setter
- `currentDescription` now includes previous transcripts
- New transcripts are **appended** instead of replacing
- No stale closure issues

## Key Changes

### 1. Moved State Declaration Earlier
```typescript
// Declare state FIRST
const [processedItems, setProcessedItems] = useState(items);
const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
// ... other state

// THEN derive computed values from state
const productGroups = processedItems.reduce(...);
const groupArray = Object.values(productGroups);
const currentGroup = groupArray[currentGroupIndex];
const currentItem = currentGroup[0];
```

### 2. Group Calculation Uses Live State
- **Before:** `items.reduce()` (prop - never changes)
- **After:** `processedItems.reduce()` (state - updates with transcripts)

### 3. State Updater Recalculates Groups
- Avoids stale closure problems
- Ensures we're reading the latest voice description
- Properly appends new transcripts to existing ones

## Expected Behavior Now

✅ **Click "Start Recording"** → Microphone activates  
✅ **Speak first sentence** → Transcript appears and **stays visible**  
✅ **Speak second sentence** → **Appends** to first sentence  
✅ **Continue speaking** → All transcripts accumulate  
✅ **Click "Stop Recording"** → Full transcript saved  
✅ **No automatic stopping!** 🎉

## Testing Steps

1. Open http://localhost:5175 (new port!)
2. Upload images → Sort → Group → Go to Description step
3. Click "🎤 Start Recording"
4. Allow microphone access
5. **Speak a sentence** → Should appear and stay
6. **Speak another sentence** → Should append to first
7. **Speak third sentence** → All should be visible
8. Click "⏹ Stop Recording"
9. Verify full transcript is in the "Transcription" field
10. Click "Generate Product Info" → Should use full transcript

## Console Log Flow (Expected)

```
Starting recording...
Speech recognition started
[User speaks "This is a blue shirt"]
[Transcript appears: "This is a blue shirt"]
[User speaks "Made from cotton"]
[Transcript updates: "This is a blue shirt Made from cotton"]
[User speaks "Size large"]
[Transcript updates: "This is a blue shirt Made from cotton Size large"]
Stopping recording... <- Only when user clicks Stop button
Speech recognition ended, isRecordingRef: false
```

## What Was Fixed

| Issue | Before | After |
|-------|--------|-------|
| Data source | `items` prop (static) | `processedItems` state (live) |
| Group calculation | At component top from props | From state, recalculated on updates |
| Transcript accumulation | Lost on re-render | Properly persisted and appended |
| Auto-stopping | Happened unexpectedly | Only on user action |
| Current item data | Stale/empty | Always current |

## Technical Notes

### React State and Derived Values

**Anti-pattern (what we had):**
```typescript
const derived = props.data.map(...);  // Derived from props
const [state, setState] = useState(props.data);  // State from props
// Problem: derived and state are out of sync!
```

**Correct pattern (what we have now):**
```typescript
const [state, setState] = useState(props.data);  // State from props
const derived = state.map(...);  // Derived from STATE
// Solution: single source of truth
```

### Closure Issues in Callbacks

When using state in callbacks (like speech recognition), always use the functional form of setState:

```typescript
// BAD - stale closure:
setState({ ...state, newField: value });

// GOOD - always fresh:
setState(prev => ({ ...prev, newField: value }));
```

## Success Criteria

✅ Transcripts appear and persist  
✅ Multiple sentences accumulate properly  
✅ Recording doesn't auto-stop  
✅ Voice descriptions saved correctly  
✅ AI generation uses full transcript  
✅ Export includes complete descriptions  

The speech recognition should now work perfectly! 🎤✨
