# Speech Recognition Fix - Immediate Abort Issue

## Problem
Speech recognition was aborting immediately upon clicking "Start Recording" - users couldn't actually record anything.

## Root Cause
The issue was caused by a **React useEffect dependency problem**:

1. `useEffect` had `isRecording` in its dependency array: `[currentGroupIndex, isRecording]`
2. When user clicks "Start Recording", it sets `isRecording = true`
3. This triggers the `useEffect` to re-run
4. The cleanup function runs: `recognition.abort()`
5. A new recognition instance is created
6. Result: Immediate abort before any recording happens

## Solution

### Changed to `useRef` for Recording State
Instead of relying on state in the useEffect dependencies, we now use a `useRef`:

```typescript
const isRecordingRef = useRef(false);
```

**Why this works:**
- `useRef` doesn't cause re-renders when updated
- useEffect only depends on `currentGroupIndex` now: `[currentGroupIndex]`
- Speech recognition instance stays stable during recording
- No abort/recreate cycle

### Key Changes

1. **Added `isRecordingRef`**:
   ```typescript
   const isRecordingRef = useRef(false);
   ```

2. **Removed `isRecording` from useEffect dependencies**:
   ```typescript
   }, [currentGroupIndex]); // Only recreate when switching groups
   ```

3. **Updated all recording checks to use the ref**:
   ```typescript
   // In onstart
   isRecordingRef.current = true;
   
   // In onend
   if (isRecordingRef.current) { ... }
   
   // In onerror
   if (isRecordingRef.current && recognitionRef.current) { ... }
   ```

4. **Updated handlers**:
   ```typescript
   const handleStartRecording = () => {
     isRecordingRef.current = true;
     recognitionRef.current.start();
   };
   
   const handleStopRecording = () => {
     isRecordingRef.current = false;
     setIsRecording(false);
     recognitionRef.current.stop();
   };
   ```

5. **Improved state updates in onresult**:
   - Used `setProcessedItems(prev => ...)` to avoid stale closure issues
   - Recalculates `currentGroup` and `currentItem` inside the callback

### Additional Improvements

1. **Better error handling**:
   - Separated "no-speech" from "aborted" errors
   - "aborted" errors are now logged but ignored (they're expected during cleanup)
   - "no-speech" errors trigger a restart

2. **Added console logs** for debugging:
   - "Starting recording..."
   - "Stopping recording..."
   - "Speech recognition ended, isRecordingRef: [value]"

3. **Timeout delays for restarts**:
   - Added 100ms delay before restarting after errors/ends
   - Prevents rapid restart loops

## Testing

✅ **Fixed Issues:**
- Speech recognition no longer aborts immediately
- Users can now click "Start Recording" and actually record
- Microphone stays active until "Stop Recording" is clicked
- Auto-restart works when speech recognition naturally ends

✅ **Expected Behavior:**
1. Click "Start Recording" → Microphone activates
2. Browser shows microphone permission prompt (first time)
3. Recording indicator appears with pulse animation
4. Speak → Interim results show in real-time
5. Pause → Final transcript is saved
6. Recognition auto-restarts to keep listening
7. Click "Stop Recording" → Microphone deactivates cleanly

## Browser Compatibility

✅ **Tested/Supported:**
- Chrome (recommended)
- Edge

⚠️ **Limited Support:**
- Safari (may have issues with continuous mode)

❌ **Not Supported:**
- Firefox (no Web Speech API support)

## How to Test

1. Refresh the page at http://localhost:5174
2. Upload images and proceed to the Description step
3. Click "🎤 Start Recording"
4. Allow microphone access when prompted
5. Speak clearly - you should see interim text appear
6. When you finish a sentence, it should be saved and recognition should continue
7. Click "⏹ Stop Recording" when done
8. Verify the transcription is saved to the voice description field

## Technical Notes

- **useRef vs useState**: useRef persists between renders without causing re-renders
- **Closure Issues**: Using `setProcessedItems(prev => ...)` avoids stale closure problems
- **Lifecycle**: Speech recognition instance is only recreated when switching product groups
- **Cleanup**: Properly sets `isRecordingRef.current = false` before aborting in cleanup
