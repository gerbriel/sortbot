import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface UserPresence {
  userId: string;
  email: string;
  currentStep: number;
  currentView: string;
  cursorX: number;
  cursorY: number;
  lastAction?: string;
  isActive: boolean;
  updatedAt: Date;
}

interface UseUserPresenceOptions {
  currentStep: number;
  currentView: string;
  userId: string;
  enabled?: boolean;
}

/**
 * Track and broadcast user presence (cursor, step, actions) in real-time
 */
export function useUserPresence({ 
  currentStep, 
  currentView, 
  userId,
  enabled = true 
}: UseUserPresenceOptions) {
  const [otherUsers, setOtherUsers] = useState<Map<string, UserPresence>>(new Map());
  const [isTracking, setIsTracking] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let channel: any;
    let heartbeatInterval: number;
    let cursorThrottle: number | null = null;

    const setupPresence = async () => {
      console.log('🔴 Setting up real-time presence tracking...');
      
      // Get user email from Supabase auth
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || `User ${userId.slice(0, 8)}`;
      console.log('👤 User email for presence:', userEmail);
      
      // Create a presence channel
      channel = supabase.channel('workspace-presence', {
        config: {
          presence: {
            key: userId,
          },
        },
      });

      // Listen to presence changes
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          console.log('👥 Presence sync:', state);
          
          const users = new Map<string, UserPresence>();
          
          Object.entries(state).forEach(([_key, presences]: [string, any]) => {
            const presence = presences[0]; // Get first presence for this user
            
            if (presence && presence.userId !== userId) {
              users.set(presence.userId, {
                userId: presence.userId,
                email: presence.email || `User ${presence.userId.slice(0, 8)}`,
                currentStep: presence.currentStep || 1,
                currentView: presence.currentView || 'unknown',
                cursorX: presence.cursorX || 0,
                cursorY: presence.cursorY || 0,
                lastAction: presence.lastAction,
                isActive: true,
                updatedAt: new Date(presence.updatedAt || Date.now()),
              });
            }
          });
          
          setOtherUsers(users);
          console.log(`✅ Tracking ${users.size} other users`);
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }: any) => {
          console.log('👋 User joined:', key, newPresences);
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }: any) => {
          console.log('👋 User left:', key, leftPresences);
        })
        .subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Subscribed to presence channel');
            setIsTracking(true);
            
            // Send initial presence
            await channel.track({
              userId,
              email: userEmail,
              currentStep,
              currentView,
              cursorX: 0,
              cursorY: 0,
              updatedAt: new Date().toISOString(),
            });
          }
        });

      // Track cursor movements (throttled)
      const handleMouseMove = (e: MouseEvent) => {
        if (cursorThrottle) return;
        
        cursorThrottle = setTimeout(() => {
          if (channel && isTracking) {
            channel.track({
              userId,
              email: userEmail,
              currentStep,
              currentView,
              cursorX: e.clientX,
              cursorY: e.clientY,
              updatedAt: new Date().toISOString(),
            });
          }
          cursorThrottle = null;
        }, 100); // Throttle to 10 updates per second
      };

      window.addEventListener('mousemove', handleMouseMove);

      // Send heartbeat every 5 seconds
      heartbeatInterval = setInterval(() => {
        if (channel && isTracking) {
          channel.track({
            userId,
            email: userEmail,
            currentStep,
            currentView,
            cursorX: 0, // Don't update cursor in heartbeat
            cursorY: 0,
            updatedAt: new Date().toISOString(),
          });
        }
      }, 5000);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        if (cursorThrottle) clearTimeout(cursorThrottle);
      };
    };

    const cleanup = setupPresence();

    return () => {
      cleanup.then(fn => fn?.());
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (channel) {
        console.log('🔴 Unsubscribing from presence channel');
        channel.unsubscribe();
      }
      setIsTracking(false);
    };
  }, [enabled, userId, currentStep, currentView, isTracking]);

  // Broadcast action
  const broadcastAction = async (action: string) => {
    console.log('📢 Broadcasting action:', action);
    
    const channel = supabase.channel('workspace-actions');
    await channel.send({
      type: 'broadcast',
      event: 'user-action',
      payload: {
        userId,
        action,
        step: currentStep,
        view: currentView,
        timestamp: Date.now(),
      },
    });
  };

  return {
    otherUsers: Array.from(otherUsers.values()),
    isTracking,
    broadcastAction,
  };
}
