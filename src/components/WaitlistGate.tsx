import { useState } from 'react';
import { requestBetaAccess } from '../lib/betaService';
import './WaitlistGate.css';

interface WaitlistGateProps {
  status: 'none' | 'pending' | 'denied';
  email: string;
  onSignOut: () => void;
  onRequested: () => void; // flips the screen to 'pending' after a successful request
}

/**
 * Private-beta gate — shown to signed-in users who have no workspace and whose
 * beta request isn't approved yet. RLS already hides all data from them; this
 * screen is the friendly explanation (and lets them request access in-app).
 */
export default function WaitlistGate({ status, email, onSignOut, onRequested }: WaitlistGateProps) {
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!orgName.trim() || !contactName.trim()) {
      setError('Please fill in your shop name and your name.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await requestBetaAccess({ org_name: orgName, contact_name: contactName, email });
    setBusy(false);
    if (res.ok) onRequested();
    else setError(res.error || 'Something went wrong — please try again.');
  };

  return (
    <div className="waitlist-gate">
      <div className="waitlist-card">
        <div className="waitlist-brand">🛍️ Sortbot <span className="waitlist-chip">BETA</span></div>

        {status === 'pending' && (
          <>
            <h1>You're on the list ✓</h1>
            <p>
              Your beta request is in review. We approve shops by hand and will email
              <strong> {email}</strong> as soon as your workspace is ready.
            </p>
          </>
        )}

        {status === 'denied' && (
          <>
            <h1>We're at capacity right now</h1>
            <p>
              We couldn't onboard your shop in this round of the beta. We'll reach out
              at <strong>{email}</strong> as more spots open up.
            </p>
          </>
        )}

        {status === 'none' && (
          <>
            <h1>Sortbot is in private beta</h1>
            <p>Tell us about your shop and we'll review your request — usually within a day or two.</p>
            <div className="waitlist-form">
              <input
                type="text"
                placeholder="Shop / organization name"
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                maxLength={120}
              />
              <input
                type="text"
                placeholder="Your name"
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                maxLength={120}
              />
              <button disabled={busy} onClick={submit}>
                {busy ? 'Sending…' : 'Request beta access'}
              </button>
              {error && <p className="waitlist-error">{error}</p>}
            </div>
          </>
        )}

        <p className="waitlist-footnote">
          Free during the beta · founding shops get preferred pricing when paid plans launch
        </p>
        <button className="waitlist-signout" onClick={onSignOut}>Sign out ({email})</button>
      </div>
    </div>
  );
}
