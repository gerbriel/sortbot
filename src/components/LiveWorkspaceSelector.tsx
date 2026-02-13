import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import './LiveWorkspaceSelector.css';

export interface WorkspaceUser {
  id: string;
  email: string;
  isActive: boolean;
  lastActive: Date;
  currentBatch?: string;
  currentView?: string;
  currentStep?: number;
}

interface LiveWorkspaceSelectorProps {
  onWorkspaceChange: (userId: string | null) => void;
  currentUserId: string;
}

interface PresenceState {
  userId: string;
  email: string;
  currentStep: number;
  currentView: string;
  lastAction?: string;
  timestamp: number;
}

export default function LiveWorkspaceSelector({ 
  onWorkspaceChange, 
  currentUserId 
}: LiveWorkspaceSelectorProps) {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Subscribe to presence channel for real-time active users
  useEffect(() => {
    
    let channel: RealtimeChannel | null = null;

    const setupPresence = async () => {
      // Get current user's email
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;


      // Subscribe to the same presence channel
      channel = supabase.channel('workspace-presence');

      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel!.presenceState();

          // Convert presence state to users list
          const usersList: WorkspaceUser[] = [];
          
          // The KEY is the userId in Supabase presence
          Object.entries(state).forEach(([presenceUserId, presences]) => {
            const presenceArray = presences as Array<{ presence_ref: string } & PresenceState>;
            const presence = presenceArray[0]; // Get first presence for this user
            
            
            if (presence) {
              usersList.push({
                id: presenceUserId, // Use the key as userId
                email: presence.email || `User ${presenceUserId.slice(0, 8)}`,
                isActive: true,
                lastActive: new Date(presence.timestamp || Date.now()),
                currentStep: presence.currentStep,
                currentView: presence.currentView,
              });
            }
          });

          // Sort: current user first, then alphabetically
          usersList.sort((a, b) => {
            if (a.id === currentUserId) return -1;
            if (b.id === currentUserId) return 1;
            return a.email.localeCompare(b.email);
          });


          setUsers(usersList);
        })
        .subscribe();
    };

    setupPresence();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [currentUserId]);

  const handleSelectUser = (userId: string | null) => {
    setSelectedUserId(userId);
    onWorkspaceChange(userId);
    setIsOpen(false);
  };

  const getSelectedUserLabel = () => {
    if (selectedUserId === null) {
      return '🌐 All Users (Collaborative)';
    }
    
    const user = users.find(u => u.id === selectedUserId);
    if (!user) return 'Select User';
    
    const activeIndicator = user.isActive ? '🟢' : '⚪️';
    return `${activeIndicator} ${user.email}`;
  };

  const formatLastActive = (date: Date) => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="live-workspace-selector">
      <label className="workspace-label">
        👁️ Live Workspace:
      </label>
      
      <div className="workspace-dropdown">
        <button 
          className="workspace-toggle"
          onClick={() => setIsOpen(!isOpen)}
          title="Switch between user workspaces or view all"
        >
          {getSelectedUserLabel()}
          <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
        </button>

        {isOpen && (
          <div className="workspace-menu">
            <div 
              className={`workspace-option ${selectedUserId === null ? 'selected' : ''}`}
              onClick={() => handleSelectUser(null)}
            >
              <span className="option-icon">🌐</span>
              <div className="option-content">
                <div className="option-name">All Users (Collaborative)</div>
                <div className="option-description">See all products from everyone</div>
              </div>
            </div>

            <div className="workspace-divider">Individual Workspaces</div>

            {users.map(user => (
              <div
                key={user.id}
                className={`workspace-option ${selectedUserId === user.id ? 'selected' : ''}`}
                onClick={() => handleSelectUser(user.id)}
              >
                <span className="option-icon">
                  {user.isActive ? '🟢' : '⚪️'}
                </span>
                <div className="option-content">
                  <div className="option-name">
                    {user.email}
                    {user.id === currentUserId && ' (You)'}
                  </div>
                  <div className="option-description">
                    {user.currentStep ? `Step ${user.currentStep}` : 'Active'} • {formatLastActive(user.lastActive)}
                  </div>
                </div>
              </div>
            ))}

            {users.length === 0 && (
              <div className="workspace-option disabled">
                <span className="option-icon">ℹ️</span>
                <div className="option-content">
                  <div className="option-description">
                    No other users are currently online. When others join, they'll appear here in real-time!
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedUserId && selectedUserId !== currentUserId && (
        <div className="live-indicator">
          <span className="pulse-dot"></span>
          <span>Viewing live workspace</span>
        </div>
      )}
    </div>
  );
}
