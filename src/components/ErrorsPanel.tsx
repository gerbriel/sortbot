import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  fetchErrorSummary, relativeTime, type ErrorSummary, type ErrorGroup,
} from '../lib/errorReporter';
import { compactNumber } from '../lib/analytics';
// These three were tabs inside OrgPanel; as top-level views they must pull
// the shared org/ft/an class styles in themselves.
import './OrgPanel.css';

type Range = 7 | 30 | 90;
const RANGES: Range[] = [7, 30, 90];

type PanelState =
  | { status: 'loading' }
  | { status: 'ok'; summary: ErrorSummary }
  | { status: 'unavailable' }
  | { status: 'forbidden' };

const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** A stack-frame-free, one-line label for the issue row. */
const shortMessage = (m: string, max = 90) => (m.length > max ? `${m.slice(0, max)}…` : m);

/**
 * First-party error dashboard (Founding admins). One RPC round-trip
 * (`app_errors_summary`) feeds the KPI row, the grouped-issue table (one row per
 * fingerprint, worst first), a daily count table and a per-screen breakdown.
 *
 * Deliberately table-only: an error list is read for its text, and the founder
 * needs to copy a message into a fix, not hover a chart. Everything here comes
 * from our own `app_errors` table — no Sentry, nothing leaves this project.
 */
export default function ErrorsPanel() {
  const [days, setDays] = useState<Range>(7);
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchErrorSummary(days).then(r => {
      if (cancelled) return;
      setState(r.status === 'ok' ? { status: 'ok', summary: r.summary } : { status: r.status });
    });
    return () => { cancelled = true; };
  }, [days, reloadKey]);

  const changeRange = (d: Range) => {
    if (d === days) return;
    setState({ status: 'loading' });
    setDays(d);
  };
  const reload = () => {
    setState({ status: 'loading' });
    setReloadKey(k => k + 1);
  };

  return (
    <section className="ft-card">
      <div className="ft-toolbar">
        <div className="ft-chips">
          {RANGES.map(r => (
            <button key={r} className={`beta-chip ${days === r ? 'beta-chip--active' : ''}`} onClick={() => changeRange(r)}>
              {r} days
            </button>
          ))}
        </div>
        <button className="org-icon-btn" title="Refresh" onClick={reload} disabled={state.status === 'loading'}>
          <RefreshCw size={13} className={state.status === 'loading' ? 'ft-spin' : ''} />
        </button>
      </div>

      {state.status === 'loading' && <p className="org-panel-loading">Loading errors…</p>}

      {state.status === 'unavailable' && (
        <p className="ft-setup">
          Error tracking is not set up yet — run <code>supabase/migrations/app_errors.sql</code> in the
          SQL Editor. Reporting starts the moment the table exists: uncaught errors, rejected promises
          and caught render errors, with no keys and no third-party service. Messages are scrubbed of
          emails and ids in the browser, and localhost is skipped.
        </p>
      )}
      {state.status === 'forbidden' && <p className="ft-error">Founding Workspace admins only.</p>}

      {state.status === 'ok' && <ErrorsBody summary={state.summary} days={days} />}
    </section>
  );
}

function ErrorsBody({ summary, days }: { summary: ErrorSummary; days: number }) {
  const t = summary.totals;

  return (
    <>
      <div className="an-kpis">
        <Tile label="Errors" value={t.errors} />
        <Tile label="Unique issues" value={t.fingerprints} />
        <Tile label="Affected sessions" value={t.sessions} />
        <Tile label="Signed-in users hit" value={t.users} />
      </div>

      {t.errors === 0 ? (
        <p className="ft-help">
          No errors reported in the last {days} days. Reports come from the deployed site only
          (localhost is skipped), and each session is capped so a crash loop cannot flood the table.
        </p>
      ) : (
        <p className="ft-help">
          Last error {relativeTime(t.last_seen)}. One row per issue below — same message and same top
          stack frame means one fingerprint, and a fingerprint survives a redeploy.
        </p>
      )}

      {summary.groups.length > 0 && (
        <>
          <h4 className="an-h">Top issues</h4>
          <table className="an-table">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Where</th>
                <th className="an-num">Count</th>
                <th className="an-num">Sessions</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {summary.groups.map(g => <IssueRow key={g.fingerprint} group={g} />)}
            </tbody>
          </table>
        </>
      )}

      <div className="an-tables">
        <div>
          <h4 className="an-h">Daily</h4>
          <table className="an-table">
            <thead><tr><th>Day</th><th className="an-num">Errors</th><th className="an-num">Issues</th></tr></thead>
            <tbody>
              {summary.daily.map(d => (
                <tr key={d.day}>
                  <td>{fmtDay(d.day)}</td>
                  <td className="an-num">{d.errors.toLocaleString()}</td>
                  <td className="an-num">{d.fingerprints.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="an-h">By screen</h4>
          {summary.views.length === 0 ? <p className="ft-help">Nothing to break down yet.</p> : (
            <table className="an-table">
              <thead><tr><th>Screen</th><th className="an-num">Errors</th><th className="an-num">Sessions</th></tr></thead>
              <tbody>
                {summary.views.map(v => (
                  <tr key={v.view}>
                    <td>{v.view}</td>
                    <td className="an-num">{v.errors.toLocaleString()}</td>
                    <td className="an-num">{v.sessions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

/** One grouped issue. `title` carries the untruncated message for copy/paste. */
function IssueRow({ group }: { group: ErrorGroup }) {
  const where = [group.component, group.view].filter(Boolean).join(' · ') || group.source;
  return (
    <tr>
      <td title={group.message}>{shortMessage(group.message)}</td>
      <td title={`source: ${group.source}${group.app_version ? ` · build ${group.app_version}` : ''}`}>{where}</td>
      <td className="an-num">{group.count.toLocaleString()}</td>
      <td className="an-num">{group.sessions.toLocaleString()}</td>
      <td title={group.last_seen}>{relativeTime(group.last_seen)}</td>
    </tr>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="an-tile">
      <span className="an-tile-label">{label}</span>
      <span className="an-tile-value">{compactNumber(value)}</span>
    </div>
  );
}
