import { CheckCircle2, X } from 'lucide-react';
import './AccountDeletedNotice.css';

/**
 * The one line a person sees on the marketing page right after deleting their
 * account. Rendered by App over <Landing /> until dismissed; nothing about it
 * is stored, so a reload simply shows the landing page.
 */
export default function AccountDeletedNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="acct-deleted" role="status">
      <CheckCircle2 size={18} aria-hidden="true" />
      <span className="acct-deleted-text">Your account was deleted.</span>
      <button type="button" className="acct-deleted-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
