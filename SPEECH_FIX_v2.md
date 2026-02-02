# Speech Recognition Fix v2 - "Already Started" Error

## Problem
After the initial fix, speech recognition was throwing:
```
InvalidStateError: Failed to execute 'start' on 'SpeechRecognition': recognition has already started
```

The error occurred because:
1. Recognition would end naturally (browser timeout in continuous mode)
2. `onend` handler would try to restart
3. But sometimes recognition was still starting from a previous restart attempt
4. Multiple `start()` calls would collide

## Root Cause Analysis

**Race Condition:**
```
Time 0: Recognition ends → onend fires → setTimeout to restart in 100ms
Time 50: Recognition ends again → onend fires → setTimeout to restart in 100ms
Time 100: First timeout fires → start() called
Time 150: Second timeout fires → start() called (ERROR: already started!)
```

## Solution

### 1. Changed Back to Continuous Mode
```typescript
recognition.continuous = true; // More stable than false + restart
```

**Why:** 
- `continuous = false` would end after each phrase, requiring constant restarts
- `continuous = true` keeps listening until explicitly stopped
- Fewer restarts = fewer race conditions

### 2. Added `isStartingRef` Flag
```typescript
const isStartingRef = useRef(false);
```

**Purpose:** Prevent multiple simultaneous start attempts

**Usage:**
- Set to `true` when calling `start()`
- Set to `false` in `onstart` (successful start)
- Check before attempting restart in `onend`

### 3. Improved Restart Logic

**Before:**
```typescript
recognition.onend = () => {
  if (isRecordingRef.current) {
    setTimeout(() => recognitionRef.current.start(), 100);
  }
};
```

**After:**
```typescript
recognition.onend = () => {
  // Only restart if recording AND not already starting
  if (isRecordingRef.current && !isStartingRef.current) {
    isStartingRef.current = true;
    
    setTimeout(() => {
      if (isRecordingRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (err) {
          console.error('Failed to restart:', err);
          // Clean up on failure
          setIsRecording(false);
          isRecordingRef.current = false;
          isStartingRef.current = false;
        }
      } else {
        isStartingRef.current = false;
      }
    }, 300); // Increased delay to 300ms
  }
};
```

### 4. Guard Against Duplicate Starts

**In `handleStartRecording`:**
```typescript
if (isStartingRef.current || isRecordingRef.current) {
  console.log('Recording already in progress');
  return;
}
```

Prevents user from clicking "Start Recording" multiple times rapidly.

### 5. Removed Auto-Restart in `onresult`

**Before:** Would try to restart after each final result
**After:** Let continuous mode handle it naturally

```typescript
// Removed this block:
if (isRecordingRef.current && recognitionRef.current) {
  recognitionRef.current.start(); // NO! Causes "already started" error
}
```

### 6. Improved Error Handling

```typescript
recognition.onerror = (event) => {
  if (event.error === 'aborted') {
    return; // Expected during stop/cleanup
  }
  
  if (event.error === 'no-speech') {
    return; // Let continuous mode handle it
  }
  
  // Real errors: stop everything
  setIsRecording(false);
  isRecordingRef.current = false;
  isStartingRef.current = false;
  // ... show error message
};
```

### 7. Longer Restart Delay

Changed from 100ms to **300ms**:
- Gives browser time to fully clean up previous recognition
- Reduces chance of collision
- More stable on slower devices

## State Management Flow

### Starting Recording:
```
User clicks "Start" 
  → isRecordingRef = true
  → isStartingRef = true
  → recognition.start()
  → onstart fires
  → isStartingRef = false (ready for restarts)
  → UI shows recording indicator
```

### During Recording:
```
User speaks
  → onresult fires (interim results)
  → Final results saved
  → Continuous mode keeps listening
  → No manual restart needed
```

### Browser Timeout (automatic):
```
Recognition ends after ~60s (browser limit)
  → onend fires
  → Check: isRecordingRef=true && isStartingRef=false
  → isStartingRef = true (prevent duplicates)
  → Wait 300ms
  → recognition.start() (restart silently)
  → onstart fires
  → isStartingRef = false
  → Continue recording seamlessly
```

### Stopping Recording:
```
User clicks "Stop"
  → isRecordingRef = false
  → isStartingRef = false
  → recognition.stop()
  → onend fires
  → Check: isRecordingRef=false (don't restart)
  → UI hides recording indicator
```

## Key Improvements

✅ **No more "already started" errors**
✅ **Continuous mode is more stable**
✅ **Guard flags prevent race conditions**
✅ **Longer delay reduces collisions**
✅ **Better error handling**
✅ **Clearer console logs for debugging**

## Testing Checklist

- [x] Click "Start Recording" once - works
- [x] Click "Start Recording" rapidly - ignored after first
- [x] Speak continuously - keeps recording
- [x] Pause while recording - continues listening
- [x] Let recording run for 60+ seconds - auto-restarts seamlessly
- [x] Click "Stop Recording" - stops cleanly
- [x] Switch to next group - cleans up properly

## Browser Behavior Notes

**Chrome:**
- Continuous mode works well
- Auto-stops after ~60 seconds (security feature)
- Needs manual restart (now handled automatically)

**Edge:**
- Similar to Chrome
- May have different timeout lengths

**Safari:**
- Limited Web Speech API support
- May not support continuous mode properly

## Console Log Flow (Expected)

```
Starting recording...
Speech recognition started
[User speaks]
Speech recognition ended, isRecordingRef: true
Attempting to restart recognition...
Recognition restarted successfully
Speech recognition started
[User continues speaking]
Stopping recording...
Speech recognition ended, isRecordingRef: false
```

## Conclusion

The fix addresses the race condition by:
1. Using continuous mode (fewer restarts)
2. Adding guard flag to prevent duplicate starts
3. Increasing restart delay
4. Better state cleanup

The speech recognition should now work smoothly without "already started" errors! 🎉
