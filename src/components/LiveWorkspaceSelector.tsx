import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import './LiveWorkspaceSelector.css';

export interface WorkspaceUser {
  id: string;
  email: string;
  isActive: boolean;
  lastActive: Date;
  currentBatch?: string;
  currentView?: string;
}

interface LiveWorkspaceSelectorProps {
  onWorkspaceChange: (userId: string | null) => void;
  currentUserId: string;
}

export default function LiveWorkspaceSelector({ 
  onWorkspaceChange, 
  currentUserId 
}: LiveWorkspaceSelectorProps) {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Fetch all users and their activity status
  useEffect(() => {
    fetchActiveUsers();
    
    // Refresh every 10 seconds to update active status
    const interval = setInterval(fetchActiveUsers, 10000);
    
    return () => clearInterval(interval);
  }, []);

  const fetchActiveUsers = async () => {
    try {
      console.log('🔍 Fetching active users...');
      
      // Get all users who have created products, workflow batches, or images
      const userMap = new Map<string, { lastActive: Date }>();
      
      // Check products table
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('user_id, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(100);

      if (!productsError && products) {
        products.forEach(item => {
          const existing = userMap.get(item.user_id);
          const itemDate = new Date(item.updated_at || item.created_at);
          
          if (!existing || itemDate > existing.lastActive) {
            userMap.set(item.user_id, { lastActive: itemDate });
          }
        });
      }

      // Check workflow_batches table
      const { data: batches, error: batchesError } = await supabase
        .from('workflow_batches')
        .select('user_id, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(100);

      if (!batchesError && batches) {
        batches.forEach(item => {
          const existing = userMap.get(item.user_id);
          const itemDate = new Date(item.updated_at || item.created_at);
          
          if (!existing || itemDate > existing.lastActive) {
            userMap.set(item.user_id, { lastActive: itemDate });
          }
        });
      }

      console.log(`📊 Found ${userMap.size} unique users with activity`);

      // Build user list
      const usersList: WorkspaceUser[] = Array.from(userMap.entries()).map(([userId, data]) => {
        const isActive = (Date.now() - data.lastActive.getTime()) < 5 * 60 * 1000; // Active in last 5 minutes
        
        return {
          id: userId,
          email: userId === currentUserId ? 'You' : `User ${userId.slice(0, 8)}`,
          isActive,
          lastActive: data.lastActive,
        };
      });

      // Always include current user even if no activity yet
      if (!usersList.find(u => u.id === currentUserId)) {
        console.log('👤 Adding current user to list');
        usersList.push({
          id: currentUserId,
          email: 'You',
          isActive: true,
          lastActive: new Date(),
        });
      }

      // Sort: current user first, then by last active
      usersList.sort((a, b) => {
        if (a.id === currentUserId) return -1;
        if (b.id === currentUserId) return 1;
        return b.lastActive.getTime() - a.lastActive.getTime();
      });

      console.log(`✅ Active users:`, usersList.map(u => ({ 
        id: u.id.slice(0, 8), 
        email: u.email, 
        isActive: u.isActive 
      })));
      setUsers(usersList);
    } catch (error) {
      console.error('Error fetching active users:', error);
    }
  };

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
                    Last active: {formatLastActive(user.lastActive)}
                  </div>
                </div>
              </div>
            ))}

            {users.length === 1 && users[0].id === currentUserId && (
              <div className="workspace-option disabled">
                <span className="option-icon">ℹ️</span>
                <div className="option-content">
                  <div className="option-description">
                    No other users have activity yet. When others use the app, they'll appear here!
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
