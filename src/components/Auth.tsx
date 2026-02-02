import { useState, useEffect } from 'react';
import './Auth.css';

interface AuthProps {
  onAuthenticated: () => void;
}

const Auth: React.FC<AuthProps> = ({ onAuthenticated }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    // Check if already authenticated
    const authToken = sessionStorage.getItem('auth_token');
    const authTime = sessionStorage.getItem('auth_time');
    
    if (authToken && authTime) {
      const elapsed = Date.now() - parseInt(authTime);
      // Session expires after 8 hours
      if (elapsed < 8 * 60 * 60 * 1000) {
        onAuthenticated();
      } else {
        sessionStorage.removeItem('auth_token');
        sessionStorage.removeItem('auth_time');
      }
    }
  }, [onAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isLocked) {
      setError('Too many failed attempts. Please try again later.');
      return;
    }

    // In production, this should hash the password and compare with environment variable
    const correctPassword = import.meta.env.VITE_APP_PASSWORD || 'changeme123';
    
    if (password === correctPassword) {
      // Generate simple auth token
      const token = btoa(`auth:${Date.now()}:${Math.random()}`);
      sessionStorage.setItem('auth_token', token);
      sessionStorage.setItem('auth_time', Date.now().toString());
      onAuthenticated();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setError(`Incorrect password. ${3 - newAttempts} attempts remaining.`);
      
      if (newAttempts >= 3) {
        setIsLocked(true);
        setError('Too many failed attempts. Please try again in 15 minutes.');
        setTimeout(() => {
          setIsLocked(false);
          setAttempts(0);
        }, 15 * 60 * 1000); // 15 minutes
      }
      
      setPassword('');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>🔒 Secure Access</h1>
          <p>AI Clothing Sorting App</p>
        </div>
        
        <div className="auth-warning">
          <strong>⚠️ Private Application</strong>
          <p>This app contains sensitive business data and API connections. Unauthorized access is prohibited.</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={isLocked}
              autoFocus
              required
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button 
            type="submit" 
            className="auth-button"
            disabled={isLocked || !password}
          >
            {isLocked ? '🔒 Locked' : '🔓 Unlock App'}
          </button>
        </form>

        <div className="auth-footer">
          <p>Session expires after 8 hours of inactivity</p>
          <p className="auth-hint">
            💡 Set your password in <code>.env</code> file:<br />
            <code>VITE_APP_PASSWORD=your_secure_password</code>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
