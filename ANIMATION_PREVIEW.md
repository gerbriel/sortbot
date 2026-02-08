# Loading Animation Preview

## Visual Representation

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│                    Loading 10 images...                    │
│                                                            │
│    ┌──────────────────────────────────────────────────┐   │
│    │                     🏪 Rack Bar                   │   │
│    │                                                   │   │
│    │        🪝                           👔    👔      │   │
│    │        ├─┤                         ├─┤  ├─┤      │   │
│    │       ╱   ╲                       ╱ ╲  ╱ ╲       │   │
│    │      👕                           👔  👔         │   │
│    │   (Moving)                    (Static Hangers)   │   │
│    │       ↓                                          │   │
│    │   Progress: 45%                                  │   │
│    │                                                   │   │
│    │  │                                               │   │
│    │  │                                               │   │
│    └──────────────────────────────────────────────────┘   │
│                                                            │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░  45%       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Animation Stages

### Stage 1: Start (0-25%)
```
🪝 ────────────────────────────────── 🏪
↑                                     
Hanger begins journey
Green glow active
Gentle swing animation
```

### Stage 2: Mid-Progress (25-70%)
```
          🪝 ──────────────────────── 🏪
          ↑                           
Hanger moving smoothly
Clothing pulse effect
Progress bar shimmer
```

### Stage 3: Approaching Rack (70-90%)
```
                    🪝 ──────── 🏪
                    ↑       👔    
First static hanger appears
Hanger continues moving
Almost there!
```

### Stage 4: Complete (90-100%)
```
                           🪝🏪
                           ↑ 👔  👔
Hanger reaches destination
Both static hangers visible
Slight scale down
Success state!
```

## Color Scheme

### Moving Elements (Active)
- **Hanger**: `#10b981` (Emerald Green)
- **Glow**: `rgba(16, 185, 129, 0.4)`
- **Clothing**: Gradient `#10b981 → #059669`
- **Effect**: Shimmer, pulse, glow

### Static Elements (Completed)
- **Hangers**: `#6b7280` (Gray)
- **Clothing**: Gradient `#6b7280 → #4b5563`
- **Effect**: Fade in, no animation

### Background
- **Overlay**: `rgba(0, 0, 0, 0.85)` with blur
- **Container**: Dark gradient `#2a2d3a → #1e2028`
- **Border**: `rgba(255, 255, 255, 0.1)`

### Progress Bar
- **Track**: `rgba(255, 255, 255, 0.1)`
- **Fill**: Animated gradient
- **Text**: `#10b981` with glow

## UX Flow

1. **User drops/selects images**
   ```
   → Loading overlay appears (fade in 0.3s)
   → Message: "Loading 10 images..."
   → Hanger starts at 0%
   ```

2. **Processing images (per image)**
   ```
   → Hanger moves smoothly
   → Progress: "Loading image 1 of 10..."
   → Bar fills incrementally
   → Hanger swings gently
   ```

3. **Completion**
   ```
   → Hanger reaches 100%
   → Message: "All images loaded!"
   → Brief pause (300ms)
   → Overlay fades out
   → Main app continues
   ```

## Timing

- **Per Image**: ~50ms processing + animation
- **10 Images**: ~500ms + 300ms completion = ~800ms total
- **50 Images**: ~2.5s + 300ms = ~2.8s total
- **100 Images**: ~5s + 300ms = ~5.3s total

## Responsive Behavior

### Desktop (1920x1080)
```
┌───────────────────────────────────────────┐
│         Large container (600px)           │
│         Full animation details            │
│         All visual effects                │
└───────────────────────────────────────────┘
```

### Tablet (768x1024)
```
┌─────────────────────────────────┐
│   Medium container (90% width)  │
│   Scaled animations             │
│   All effects preserved         │
└─────────────────────────────────┘
```

### Mobile (375x667)
```
┌───────────────────────────┐
│   Small container         │
│   Compact animations      │
│   Reduced sizes           │
│   Same smooth feel        │
└───────────────────────────┘
```

## Performance Metrics

```
Frame Rate:     60 FPS (target)
GPU Usage:      Low (CSS transforms)
Memory:         < 5 MB
CPU:            < 5% single core
Paint Time:     < 8ms per frame
Load Time:      Instant (no external assets)
```

## Accessibility

```
Screen Reader Announcement:
"Loading images. 45 percent complete. Loading image 5 of 10."

Reduced Motion:
- Disables swing animation
- Reduces pulse effect
- Maintains progress indication
```

## Implementation Example

```tsx
// Example: Upload 50 images with smooth progress
const handleUpload = async (files: File[]) => {
  setIsLoading(true);
  
  for (let i = 0; i < files.length; i++) {
    // Process file
    await processFile(files[i]);
    
    // Update progress
    const percent = ((i + 1) / files.length) * 100;
    setProgress(percent);
    setMessage(`Loading image ${i + 1} of ${files.length}...`);
    
    // Watch the hanger move! 🪝→🏪
  }
  
  // Show completion
  setMessage('All images loaded!');
  await sleep(300);
  setIsLoading(false);
};
```

## Success Criteria

✅ Feels smooth and responsive  
✅ Provides clear progress feedback  
✅ On-brand for clothing app  
✅ Delightful animation details  
✅ No performance impact  
✅ Accessible to all users  
✅ Works on all devices  
✅ Professional polish  

The clothing hanger animation turns a boring loading screen into a delightful brand experience! 🎉
