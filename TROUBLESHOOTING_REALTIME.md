# Real-Time Collaboration Troubleshooting Guide

## Current Issue: Not Seeing Users in Dropdown

### What I Just Fixed ✅

1. **LiveWorkspaceSelector now uses Supabase Realtime**
   - Changed from database polling → real-time presence subscription
   - Now listens to the same `workspace-presence` channel as cursors
   - Shows truly live users (currently online)

2. **User emails now display correctly**
   - Fixed hardcoded `'You'` → actual user email from Supabase auth
   - Both users will see each other's real email addresses

### How to Test 🧪

**With 2 users currently online:**

1. **Open browser console** (F12) in both browser windows
2. **Look for these console messages:**
   ```
   🔴 Setting up real-time presence tracking...
   👤 User email for presence: your-email@example.com
   ✅ Subscribed to presence channel
   👥 Presence sync: {userId: {...}}
   ```

3. **Check the dropdown:**
   - Click "👁️ Live Workspace" button in the header
   - You should see:
     - 🌐 All Users (Collaborative)
     - 🟢 user1@email.com (You)
     - 🟢 user2@email.com • Step 1

4. **Verify cursor tracking:**
   - Move your mouse
   - Other user should see your cursor with your email label
   - Check the activity panel (top-right)

### Common Issues & Solutions

#### Issue 1: "Still not seeing other user in dropdown"

**Possible causes:**
- Both users on same browser tab (use different browsers/incognito)
- Supabase Realtime not enabled in project
- WebSocket connection failed

**Check:**
```javascript
// In browser console
supabase.channel('test').subscribe((status) => {
  console.log('Channel status:', status);
});
```

**Expected:** `Channel status: SUBSCRIBED`
**If error:** Check Supabase project settings → Realtime

#### Issue 2: "Console shows 'Presence sync: {}'"

This means the presence channel is empty.

**Check:**
1. Is `userId` being passed to `useUserPresence`?
2. Is `enabled={!!user}` true?
3. Look for error messages about `.track()` failing

**Debug in App.tsx:**
```typescript
console.log('User ID:', user?.id);
console.log('Presence enabled:', !!user);
```

#### Issue 3: "Seeing user but email is wrong"

**Check:**
- `await supabase.auth.getUser()` returning correct user
- Look for console log: `👤 User email for presence: ...`

#### Issue 4: "Dropdown shows users but can't toggle"

**Check:**
- Is `onWorkspaceChange` prop working?
- Look for: `handleSelectUser` being called
- Check if filter is being applied in parent component

### Debugging Commands 🔍

**In browser console:**

```javascript
// 1. Check current auth user
const { data: { user } } = await supabase.auth.getUser();
console.log('Current user:', user);

// 2. Check presence channel state
const channel = supabase.channel('workspace-presence');
await channel.subscribe();
setTimeout(() => {
  console.log('Presence state:', channel.presenceState());
}, 2000);

// 3. Manually track presence
await channel.track({
  userId: 'test-123',
  email: 'test@test.com',
  currentStep: 1,
  currentView: 'workflow',
});
```

### What Should Be Visible Now ✅

With 2 users online, you should see:

**User 1 Screen:**
- Own cursor (no visual, but tracked)
- User 2's cursor (colored SVG with email label)
- Activity panel showing:
  - 🟢 user1@email.com • Step 1 • Just now
  - 🟢 user2@email.com • Step 1 • Just now
- Dropdown showing both users

**User 2 Screen:**
- Own cursor (tracked)
- User 1's cursor (colored SVG)
- Same activity panel (reversed)
- Same dropdown options

### Network Tab Check 🌐

1. Open **Network tab** in DevTools
2. Filter by **WS** (WebSocket)
3. Look for connection to Supabase Realtime
4. Should show:
   - Status: **101 Switching Protocols**
   - Messages being sent/received
   - Presence join/leave events

### If Still Not Working 🆘

**Last resort checks:**

1. **Hard refresh both browsers** (Ctrl+Shift+R / Cmd+Shift+R)
2. **Clear application cache:**
   - DevTools → Application → Clear Storage
3. **Check Supabase dashboard:**
   - Logs → Realtime → See if connections are established
4. **Verify environment:**
   - `.env` file has correct `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   - Dev server is running (`npm run dev`)

### Expected Console Output 📋

**When working correctly:**
```
🔴 Setting up real-time presence tracking...
👤 User email for presence: user@example.com
✅ Subscribed to presence channel
👥 Presence sync: { userId1: [{...}], userId2: [{...}] }
✅ Tracking 1 other users
🔌 LiveWorkspaceSelector: Subscribing to presence channel
👥 Presence sync in selector: { userId1: [{...}], userId2: [{...}] }
✅ Live users from presence: [
  { email: 'user1@example.com', step: 1, view: 'workflow' },
  { email: 'user2@example.com', step: 1, view: 'workflow' }
]
```

### Files Changed 📁

Today's fixes:
1. `src/components/LiveWorkspaceSelector.tsx` - Uses Realtime presence
2. `src/hooks/useUserPresence.ts` - Tracks real email addresses
3. `src/App.tsx` - Integrated presence tracking
4. `src/components/RemoteCursors.tsx` - Visual display

### Next Steps if Working ✨

Once you see both users:
1. Click on a user in dropdown → filter to their workspace only
2. Move mouse → see cursors following
3. Upload image → see action broadcast
4. Check activity panel updates in real-time

---

**Need more help?** Check browser console for specific error messages and share them!
