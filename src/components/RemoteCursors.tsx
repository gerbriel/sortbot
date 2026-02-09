import type { UserPresence } from '../hooks/useUserPresence';
import './RemoteCursors.css';

interface RemoteCursorsProps {
  users: UserPresence[];
}

const STEP_NAMES: Record<number, string> = {
  1: 'Upload Images',
  2: 'Group Images',
  3: 'Categorize',
  4: 'Add Descriptions',
  5: 'Save & Export',
};

const USER_COLORS = [
  '#667eea', // Purple
  '#f093fb', // Pink
  '#4facfe', // Blue
  '#43e97b', // Green
  '#fa709a', // Rose
  '#30cfd0', // Cyan
  '#764ba2', // Deep Purple
  '#feca57', // Yellow
];

export default function RemoteCursors({ users }: RemoteCursorsProps) {
  console.log('🖼️ RemoteCursors rendering with users:', users);
  
  const getUserColor = (userId: string): string => {
    // Generate consistent color based on user ID
    const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return USER_COLORS[hash % USER_COLORS.length];
  };

  return (
    <>
      {/* Remote Cursors */}
      {users.map((user) => (
        <div
          key={user.userId}
          className="remote-cursor"
          style={{
            left: `${user.cursorX}px`,
            top: `${user.cursorY}px`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              filter: `drop-shadow(0 2px 4px ${getUserColor(user.userId)}40)`,
            }}
          >
            <path
              d="M5 3L19 12L12 13L9 19L5 3Z"
              fill={getUserColor(user.userId)}
              stroke="white"
              strokeWidth="1.5"
            />
          </svg>
          <div 
            className="cursor-label"
            style={{ 
              backgroundColor: getUserColor(user.userId),
              color: 'white',
            }}
          >
            {user.email}
          </div>
        </div>
      ))}

      {/* User Activity Panel */}
      {users.length > 0 && (
        <div className="user-activity-panel">
          <div className="activity-header">
            <span className="activity-icon">👥</span>
            <span className="activity-title">Live Activity</span>
            <span className="activity-count">{users.length}</span>
          </div>
          
          <div className="activity-list">
            {users.map((user) => (
              <div 
                key={user.userId} 
                className="activity-item"
                style={{ borderLeftColor: getUserColor(user.userId) }}
              >
                <div className="activity-user">
                  <span 
                    className="user-dot"
                    style={{ backgroundColor: getUserColor(user.userId) }}
                  />
                  <span className="user-name">{user.email}</span>
                </div>
                <div className="activity-details">
                  <span className="activity-step">
                    Step {user.currentStep}: {STEP_NAMES[user.currentStep]}
                  </span>
                  {user.lastAction && (
                    <span className="activity-action">
                      {user.lastAction}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
