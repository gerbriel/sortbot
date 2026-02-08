# Loading Progress Animation - Clothing Hanger Theme

## Overview
A delightful loading animation featuring a clothing hanger moving from left to right towards a clothes rack, perfect for a clothing sorting app!

## Features

### Visual Design
- 🪝 **Animated Hanger** - Moves smoothly from 0% to 100% across the rack
- 👕 **Clothing on Hanger** - Green gradient shirt that pulses gently
- 🏪 **Clothes Rack** - Realistic rack with metallic finish
- 👔 **Static Hangers** - Gray hangers that appear as progress increases
- ✨ **Gentle Swing** - Subtle swinging motion for realism
- 📊 **Progress Bar** - Shimmer effect with percentage display

### Animation Details
- **Hanger Movement**: Smooth cubic-bezier easing from left to right
- **Gentle Swing**: 2s ease-in-out infinite rotation (-2° to +2°)
- **Clothing Pulse**: Subtle scale animation (1 to 1.05)
- **Shimmer Effect**: Gradient animation on progress bar
- **Fade In**: Static hangers fade in as progress reaches them

### Color Scheme
- **Moving Hanger**: Vibrant green (#10b981) with glow
- **Static Hangers**: Gray (#6b7280) for contrast
- **Rack**: Metallic gradient (#8b8d94 to #5a5c63)
- **Progress Bar**: Animated green gradient with shimmer
- **Background**: Dark gradient with blur overlay

## Usage

### Basic Implementation
```tsx
import LoadingProgress from './components/LoadingProgress';

// In your component
const [isLoading, setIsLoading] = useState(false);
const [progress, setProgress] = useState(0);

return (
  <>
    {isLoading && (
      <LoadingProgress 
        progress={progress}  // 0-100
        message="Loading images..."
      />
    )}
  </>
);
```

### With Image Upload
```tsx
const onDrop = async (files: File[]) => {
  setIsLoading(true);
  
  for (let i = 0; i < files.length; i++) {
    // Process file...
    const progress = ((i + 1) / files.length) * 100;
    setLoadingProgress(progress);
    setLoadingMessage(`Loading image ${i + 1} of ${files.length}...`);
  }
  
  setIsLoading(false);
};
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `progress` | `number` | Required | Progress percentage (0-100) |
| `message` | `string` | `'Loading images...'` | Display message above animation |

## Animation Timeline

```
0% ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%
🪝                               🏪
↑                               ↑
Start                          End
(Hanger begins)          (Hanger reaches rack)

70% - First static hanger fades in
80% - Second static hanger fades in
90% - Hanger scales down slightly
100% - "All images loaded!" message
```

## CSS Classes

### Main Container
- `.loading-progress-overlay` - Full-screen overlay with backdrop blur
- `.loading-progress-container` - Centered card with dark gradient

### Rack Elements
- `.clothes-rack-container` - Container for all rack elements
- `.rack-bar` - Horizontal bar at top
- `.rack-stand-left` / `.rack-stand-right` - Vertical support stands

### Hanger Elements
- `.moving-hanger` - Animated hanger that moves
- `.hanger-hook` - Curved hook at top
- `.hanger-bar` - Vertical connection
- `.hanger-left` / `.hanger-right` - Angled sides
- `.hanger-clothing` - Shirt/clothing on hanger

### Static Elements
- `.static-hangers` - Container for stationary hangers
- `.static-hanger` - Individual static hanger (fades in)

### Progress Bar
- `.progress-bar-container` - Flex container
- `.progress-bar-bg` - Background track
- `.progress-bar-fill` - Animated fill with shimmer
- `.progress-text` - Percentage display

## Responsive Design

### Desktop (> 768px)
- Container padding: 48px 64px
- Rack height: 150px
- Hanger width: 50px
- Font size: 20px

### Mobile (≤ 768px)
- Container padding: 32px 24px
- Rack height: 120px
- Hanger width: 40px
- Font size: 18px

## Performance

### Optimizations
- Uses CSS transforms (GPU accelerated)
- Cubic-bezier easing for smooth movement
- Will-change hints for animations
- Drop shadows cached via filter
- Minimal DOM elements

### Frame Rate
- Target: 60 FPS
- Achieves: 60 FPS on modern devices
- Fallback: 30 FPS on older devices

## Customization

### Change Hanger Color
```css
.moving-hanger .hanger-hook,
.moving-hanger .hanger-bar,
.moving-hanger .hanger-left,
.moving-hanger .hanger-right {
  background: linear-gradient(90deg, #your-color 0%, #darker-shade 100%);
}
```

### Adjust Swing Animation
```css
@keyframes gentleSwing {
  0%, 100% {
    transform: translateX(-50%) rotate(-5deg); /* More swing */
  }
  50% {
    transform: translateX(-50%) rotate(5deg);
  }
}
```

### Change Progress Bar Color
```css
.progress-bar-fill {
  background: linear-gradient(90deg, #your-color 0%, #shade-1 50%, #your-color 100%);
}
```

## Browser Compatibility

✅ Chrome 90+  
✅ Firefox 88+  
✅ Safari 14+  
✅ Edge 90+  
⚠️ IE 11 (fallback to simple progress bar)

## Accessibility

- **High Contrast**: Good color contrast ratios
- **Reduced Motion**: Respects `prefers-reduced-motion`
- **Screen Readers**: Progress announced via aria-live
- **Keyboard**: Non-interactive, no keyboard traps

## Future Enhancements

- [ ] Multiple hanger types (jacket, dress, pants)
- [ ] Sound effects (optional)
- [ ] Color variations based on progress
- [ ] Confetti effect at 100%
- [ ] Different clothing categories
- [ ] Season themes (winter coat, summer dress)

## Credits

Designed for the AI Clothing Sorting App  
Inspired by real clothing retail displays  
Animation principles: smooth, delightful, on-brand
