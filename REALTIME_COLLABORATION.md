# Real-Time Collaboration Feature 🎯

## Overview
The app now includes **real-time collaboration** where multiple users can see each other's cursor movements and workflow progress - like a screen share experience!

## Features ✨

### 1. **Live Cursor Tracking**
- See other users' mouse cursors moving in real-time
- Each user has a unique color-coded cursor (8 colors)
- Cursor labels show the user's email
- Smooth animations with 100ms throttling (no lag!)

### 2. **Activity Panel** (Top Right)
- Shows all users currently active in the workspace
- Displays each user's current workflow step (1-5)
- Shows their last action (e.g., "Uploaded 3 images")
- Pulsing green dot indicates active users
- Responsive design (moves to bottom on mobile)

### 3. **Workflow Step Tracking**
The system automatically detects what step each user is on:
- **Step 1**: Upload Images
- **Step 2**: Group Images  
- **Step 3**: Categorize Items
- **Step 4**: Generate Descriptions
- **Step 5**: Save & Export

### 4. **Action Broadcasting**
Users see real-time notifications when others:
- Upload images
- Create product groups
- Categorize items
- Generate descriptions
- Save products to library

## Technical Implementation 🔧

### Architecture
```
useUserPresence Hook (Supabase Realtime)
    ↓
Presence Channel (WebSocket)
    ↓
RemoteCursors Component (Visual Display)
```

### Key Files

#### 1. **src/hooks/useUserPresence.ts**
Custom React hook that manages real-time presence:
- Creates Supabase Realtime channel
- Tracks cursor position (throttled to 100ms)
- Broadcasts user actions
- Heartbeat system (5 second intervals)
- Handles user join/leave events

```typescript
const { otherUsers, broadcastAction } = useUserPresence({
  currentStep: getCurrentStep(),
  currentView: 'workflow',
  userId: user.id,
  enabled: true,
});
```

#### 2. **src/components/RemoteCursors.tsx**
Visual component that renders:
- SVG cursors for each remote user
- Activity panel showing user statuses
- Color-coded labels and indicators

#### 3. **src/components/RemoteCursors.css**
Styling for:
- Fixed cursor positioning (z-index: 10000)
- Smooth transitions (0.1s linear)
- Activity panel layout
- Pulsing dot animation
- Mobile responsive design

### Integration in App.tsx

```typescript
// 1. Step inference helper
const getCurrentStep = (): number => {
  if (processedItems.length > 0) return 5;
  if (groupedImages.length > 0) return 4;
  if (sortedImages.length > 0) return 3;
  if (uploadedImages.length > 0) return 2;
  return 1;
};

// 2. Use presence hook
const { otherUsers, broadcastAction } = useUserPresence({
  currentStep: getCurrentStep(),
  currentView: showLibrary ? 'library' : 'workflow',
  userId: user?.id || '',
  enabled: !!user,
});

// 3. Render cursors
<RemoteCursors users={otherUsers} />

// 4. Broadcast actions
broadcastAction(`Uploaded ${items.length} images`);
```

## How to Test 🧪

### Multi-User Testing
1. **Open in two browsers** (e.g., Chrome & Firefox) or use incognito mode
2. **Sign in as different users** in each browser
3. **Move your mouse** - you'll see the other user's cursor!
4. **Perform actions** (upload, categorize, etc.) and watch the activity panel update

### What You'll See
- ✅ Remote cursors following other users' mouse movements
- ✅ Activity panel showing current steps
- ✅ Real-time action notifications
- ✅ Smooth cursor animations (no lag)
- ✅ Users automatically appear/disappear on join/leave

## Performance ⚡

### Optimization Features
- **Cursor Throttling**: Mouse position updates limited to 100ms intervals
- **Heartbeat System**: Presence updates every 5 seconds (not every mouse move)
- **Efficient State Management**: Uses Map for O(1) user lookups
- **Cleanup on Unmount**: Proper channel unsubscription prevents memory leaks

### Browser Compatibility
- ✅ Chrome/Edge (Chromium)
- ✅ Firefox
- ✅ Safari
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## Supabase Realtime Setup 📡

The feature uses **Supabase Realtime Presence API**:

```typescript
const channel = supabase.channel('workspace-presence', {
  config: {
    presence: {
      key: userId, // Unique user identifier
    },
  },
});
```

### Channel Events
- `presence.sync` - When presence state updates (user joins/leaves)
- `broadcast` - For cursor position updates (throttled)
- `broadcast.action` - For user action notifications

### Presence Data Structure
```typescript
interface UserPresence {
  userId: string;
  email: string;
  currentStep: number;
  currentView: string;
  lastAction?: string;
  cursorX?: number;
  cursorY?: number;
  timestamp: number;
}
```

## Database Requirements 📊

⚠️ **Important**: You need to run the database migration for full collaboration!

The migration file `RUN_DATABASE_MIGRATION.md` includes:
- RLS policies for shared data access
- Permissions for all users to view/edit categories and presets
- Workflow batch sharing across users

Without this migration:
- ✅ Real-time cursors and activity panel will work
- ❌ Users won't see each other's saved products
- ❌ Categories and presets remain user-isolated

## Privacy Considerations 🔒

### What's Shared
- Cursor position (x, y coordinates)
- Current workflow step (1-5)
- Current view (workflow, library, presets, categories)
- Last action performed
- User email (for identification)

### What's NOT Shared
- Image previews
- Product descriptions
- Personal data beyond email
- Authentication tokens

### Presence Timeout
- Users automatically marked as "left" after 30 seconds of inactivity
- Heartbeat system keeps presence alive during active use
- Clean disconnect on browser close/refresh

## Troubleshooting 🔍

### "Not seeing other users"
1. ✅ Check both users are signed in
2. ✅ Check browser console for errors
3. ✅ Verify internet connection (Supabase Realtime needs WebSocket)
4. ✅ Check Supabase project status (dashboard.supabase.com)

### "Cursors are laggy"
- Normal behavior: Throttled to 100ms for performance
- If too slow: Check network connection
- If too fast: May need to increase throttle in `useUserPresence.ts`

### "Activity panel not updating"
1. ✅ Check if `broadcastAction()` is called in event handlers
2. ✅ Verify presence channel is connected (console logs)
3. ✅ Check for TypeScript errors: `npm run build`

## Future Enhancements 🚀

Potential features to add:
- [ ] Voice chat integration
- [ ] Screen sharing mode (view another user's exact view)
- [ ] Click indicators (show where users click)
- [ ] Collaborative drag-and-drop
- [ ] User avatars instead of just labels
- [ ] "Follow user" mode (camera follows another user's cursor)
- [ ] Presence in Library view
- [ ] Annotation tools (draw on screen together)

## Related Files 📁

```
src/
├── hooks/
│   └── useUserPresence.ts          # Core presence logic
├── components/
│   ├── RemoteCursors.tsx           # Visual display
│   ├── RemoteCursors.css           # Styling
│   └── LiveWorkspaceSelector.tsx   # User filtering
└── App.tsx                         # Integration
```

## Support 💬

If you encounter issues:
1. Check browser console for errors
2. Verify Supabase Realtime is enabled in your project
3. Ensure both users are on the same workspace
4. Check network tab for WebSocket connection

---

**Built with ❤️ using Supabase Realtime Presence API**
