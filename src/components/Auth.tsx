import { useState } from 'react';
import { supabase } from '../lib/supabase';
import './Auth.css';

interface AuthProps {
  onAuthenticated: () => void;
}

const Auth: React.FC<AuthProps> = ({ onAuthenticated }) => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (isSignUp) {
        // Sign up
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        if (data.user) {
          setMessage('Account created! Please check your email to verify your account.');
        }
      } else {
        // Sign in
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        if (data.session) {
          onAuthenticated();
        }
      }
    } catch (error: any) {
      setError(error.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>🛍️ Sortbot</h1>
          <p>AI-Powered Product Listing Generator</p>
        </div>

        <form onSubmit={handleAuth} className="auth-form">
          <h2>{isSignUp ? 'Create Account' : 'Sign In'}</h2>

          {error && (
            <div className="auth-error">
              ⚠️ {error}
            </div>
          )}

          {message && (
            <div className="auth-message">
              ✓ {message}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              minLength={6}
            />
            {isSignUp && (
              <small>Minimum 6 characters</small>
            )}
          </div>

          <button
            type="submit"
            className="auth-button"
            disabled={loading}
          >
            {loading ? (
              <span className="loading">
                <span className="spinner"></span>
                {isSignUp ? 'Creating account...' : 'Signing in...'}
              </span>
            ) : (
              isSignUp ? 'Create Account' : 'Sign In'
            )}
          </button>

          <div className="auth-toggle">
            {isSignUp ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(false);
                    setError(null);
                    setMessage(null);
                  }}
                  disabled={loading}
                >
                  Sign In
                </button>
              </>
            ) : (
              <>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(true);
                    setError(null);
                    setMessage(null);
                  }}
                  disabled={loading}
                >
                  Sign Up
                </button>
              </>
            )}
          </div>
        </form>

        <div className="auth-footer">
          <p>🔒 Secure authentication powered by Supabase</p>
          <p>Your data is private and isolated to your account</p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
