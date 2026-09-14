import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  /**
   * What is missing, as a short noun phrase — `'No batches yet'`. Not a
   * sentence, and never an apology.
   */
  title: string;
  /** One or two lines telling the user how to get out of the empty state. */
  description?: ReactNode;
  /** Glyph above the title. A lucide icon; never an emoji. */
  icon?: ReactNode;
  /** Buttons — put the action that FIXES the emptiness first. */
  actions?: ReactNode;
  /** Compact padding, for an empty lane or a panel section. */
  inline?: boolean;
  /**
   * Flags a failure rather than a genuine empty set: tints the glyph danger and
   * announces the message via `role="status"`, since it appears after an action.
   */
  error?: boolean;
  className?: string;
}

/**
 * The "there is nothing here" panel.
 *
 * ```tsx
 * <EmptyState
 *   icon={<FolderOpen />}
 *   title="No batches yet"
 *   description="Upload a folder of photos to start your first batch."
 *   actions={<Button variant="primary" onClick={pickFolder}>Import folder</Button>}
 * />
 * ```
 */
export function EmptyState({
  title, description, icon, actions, inline = false, error = false, className,
}: EmptyStateProps) {
  return (
    <div
      // A failure appeared in response to something the user did, so it is
      // announced. A genuinely empty list is just content and needs no role.
      role={error ? 'status' : undefined}
      className={[
        'ui-empty',
        inline ? 'ui-empty--inline' : '',
        error ? 'ui-empty--error' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon && <span aria-hidden="true" className="ui-empty__icon">{icon}</span>}
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__description">{description}</p>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </div>
  );
}
