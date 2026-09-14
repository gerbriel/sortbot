import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { track } from '../lib/analytics';
import './Auth.css';

interface AuthProps {
  onAuthenticated: () => void;
}

/** Minimum sign-up password length. Keep in step with the Supabase dashboard's
 *  own minimum (Authentication -> Providers -> Email), which is authoritative. */
const MIN_PASSWORD_LENGTH = 10;

const Auth: React.FC<AuthProps> = ({ onAuthenticated }) => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOutageError, setIsOutageError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsOutageError(false);
    setMessage(null);

    // Security audit 05, finding #18: 6 characters was a credential-stuffing
    // invitation. The DB-side minimum and "leaked password protection" are
    // Supabase dashboard settings (Authentication -> Providers -> Email) that
    // must be enabled separately; this is the in-app half.
    if (isSignUp && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters — a short password is the easiest way into your workspace.`);
      return;
    }

    setLoading(true);
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
          track('Account Created');
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
      const msg: string = error?.message || '';
      const status: number | undefined = error?.status;
      // Detect Supabase server-side outages (504/502/503) or network failures.
      const isOutage =
        status === 504 || status === 502 || status === 503 ||
        msg.includes('504') || msg.includes('502') || msg.includes('503') ||
        msg.toLowerCase().includes('gateway') ||
        msg.toLowerCase().includes('failed to fetch') ||
        msg.toLowerCase().includes('network request failed');
      if (isOutage) {
        setIsOutageError(true);
        setError('Supabase is temporarily unreachable — this is a server-side outage or scheduled maintenance, not your credentials. Try again in a few minutes. A mobile hotspot or VPN can also bypass routing issues.');
      } else {
        setIsOutageError(false);
        setError(msg || 'An error occurred during authentication');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>Arcadian</h1>
          <p>From camera roll to Shopify-ready listings</p>
        </div>

        <form onSubmit={handleAuth} className="auth-form">
          <h2>{isSignUp ? 'Create Account' : 'Sign In'}</h2>

          {error && (
            <div className="auth-error">
              {error}{' '}
              {isOutageError && (
                <a href="https://status.supabase.com" target="_blank" rel="noreferrer" style={{ color: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Check status.supabase.com ↗
                </a>
              )}
            </div>
          )}

          {message && (
            <div className="auth-message">
              {message}
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
              minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
            />
            {isSignUp && (
              <small>Minimum {MIN_PASSWORD_LENGTH} characters</small>
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
                    setIsOutageError(false);
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
                    setIsOutageError(false);
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
          <p>Secure authentication powered by Supabase</p>
          <p>Your data is private and isolated to your account</p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
