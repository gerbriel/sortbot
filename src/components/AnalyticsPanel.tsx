import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  fetchAnalyticsSummary, buildFunnel, compactNumber, percentDelta, niceCeiling,
  type AnalyticsSummary,
} from '../lib/analytics';

type Range = 7 | 30 | 90;
const RANGES: Range[] = [7, 30, 90];

type PanelState =
  | { status: 'loading' }
  | { status: 'ok'; summary: AnalyticsSummary }
  | { status: 'unavailable' }
  | { status: 'forbidden' };

const fmtDay = (day: string, long = false) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined,
    long ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/**
 * First-party analytics dashboard (Founding admins). One RPC round-trip
 * (`analytics_summary`) feeds a KPI row, a daily pageview column chart, the
 * signup→export funnel and the top events / referrers / devices tables.
 * Everything a chart shows is also in a table, so nothing is gated on hover.
 */
export default function AnalyticsPanel() {
  const [days, setDays] = useState<Range>(30);
  const [state, setState] = useState<PanelState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchAnalyticsSummary(days).then(r => {
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

  const funnel = useMemo(() => (state.status === 'ok' ? buildFunnel(state.summary.events) : []), [state]);

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

      {state.status === 'loading' && <p className="org-panel-loading">Loading analytics…</p>}

      {state.status === 'unavailable' && (
        <p className="ft-setup">
          Analytics is not set up yet — run <code>supabase/migrations/analytics_events.sql</code> in the
          SQL Editor. Tracking starts the moment the table exists: no keys, no third-party script,
          the data stays in this project.
        </p>
      )}
      {state.status === 'forbidden' && <p className="ft-error">Founding Workspace admins only.</p>}

      {state.status === 'ok' && (
        <AnalyticsBody summary={state.summary} funnel={funnel} days={days} />
      )}
    </section>
  );
}

function AnalyticsBody({ summary, funnel, days }: { summary: AnalyticsSummary; funnel: ReturnType<typeof buildFunnel>; days: number }) {
  const t = summary.totals;
  const p = summary.previous;
  const totalSessions = summary.devices.reduce((n, d) => n + d.sessions, 0);
  const empty = t.pageviews === 0 && t.events === 0;

  return (
    <>
      <div className="an-kpis">
        <Tile label="Pageviews" value={t.pageviews} delta={percentDelta(t.pageviews, p.pageviews)} days={days} />
        <Tile label="Sessions" value={t.sessions} delta={percentDelta(t.sessions, p.sessions)} days={days} />
        <Tile label="Signed-in users" value={t.users} />
        <Tile label="Beta signups" value={t.beta_signups} />
      </div>

      {empty && (
        <p className="ft-help">
          No events in this range yet. Pageviews and funnel events are recorded from the deployed site
          (localhost is skipped, and Do Not Track is honored).
        </p>
      )}

      <h4 className="an-h">Daily pageviews</h4>
      <DailyChart daily={summary.daily} />

      <div className="an-tables">
        <div>
          <h4 className="an-h">Funnel</h4>
          <table className="an-table">
            <thead><tr><th>Step</th><th>Count</th><th>Of first</th><th>Of previous</th></tr></thead>
            <tbody>
              {funnel.map(s => (
                <tr key={s.step}>
                  <td>{s.step}</td>
                  <td className="an-num">{s.count.toLocaleString()}</td>
                  <td className="an-num">{pct(s.ofFirst)}</td>
                  <td className="an-num">{pct(s.ofPrevious)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="an-h">Events</h4>
          {summary.events.length === 0 ? <p className="ft-help">No custom events yet.</p> : (
            <table className="an-table">
              <thead><tr><th>Event</th><th>Count</th><th>Sessions</th></tr></thead>
              <tbody>
                {summary.events.map(e => (
                  <tr key={e.event}>
                    <td>{e.event}</td>
                    <td className="an-num">{e.count.toLocaleString()}</td>
                    <td className="an-num">{e.sessions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h4 className="an-h">Referrers</h4>
          {summary.referrers.length === 0 ? <p className="ft-help">Direct traffic only so far.</p> : (
            <table className="an-table">
              <thead><tr><th>Source</th><th>Sessions</th></tr></thead>
              <tbody>
                {summary.referrers.map(r => (
                  <tr key={r.referrer}>
                    <td>{r.referrer}</td>
                    <td className="an-num">{r.sessions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h4 className="an-h">Devices</h4>
          <table className="an-table">
            <thead><tr><th>Device</th><th>Sessions</th><th>Share</th></tr></thead>
            <tbody>
              {summary.devices.map(d => (
                <tr key={d.device}>
                  <td>{d.device}</td>
                  <td className="an-num">{d.sessions.toLocaleString()}</td>
                  <td>
                    <span className="an-meter" aria-hidden="true">
                      <span style={{ width: `${totalSessions ? (d.sessions / totalSessions) * 100 : 0}%` }} />
                    </span>
                    <span className="an-num an-meter-label">{totalSessions ? Math.round((d.sessions / totalSessions) * 100) : 0}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.views.length > 0 && (
            <p className="ft-help an-views">
              Pageviews by screen: {summary.views.map(v => `${v.view} ${v.pageviews.toLocaleString()}`).join(' · ')}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, delta, days }: { label: string; value: number; delta?: number | null; days?: number }) {
  const dir = delta === null || delta === undefined ? null : delta >= 0 ? 'up' : 'down';
  return (
    <div className="an-tile">
      <span className="an-tile-label">{label}</span>
      <span className="an-tile-value">{compactNumber(value)}</span>
      {delta !== undefined && (
        <span className={`an-tile-delta ${dir ? `an-tile-delta--${dir}` : ''}`}>
          {delta === null ? 'no previous period' : `${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta * 100))}% vs previous ${days} days`}
        </span>
      )}
    </div>
  );
}

/**
 * Column chart, plain HTML: ≤24 px bars, 4 px rounded caps square at the
 * baseline, a 2 px surface gap between neighbors, three hairline gridlines,
 * sparse x labels, and a per-bar hover/focus tooltip. Single series, so no legend.
 */
function DailyChart({ daily }: { daily: AnalyticsSummary['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = daily.reduce((m, d) => Math.max(m, d.pageviews), 0);
  const ceil = niceCeiling(max);
  const ticks = [ceil, ceil / 2, 0];
  const labelEvery = daily.length > 45 ? 15 : daily.length > 14 ? 7 : 1;
  const hovered = hover !== null ? daily[hover] : null;

  return (
    <div className="an-chart" onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)}>
      <div className="an-plot">
        {ticks.map(tk => (
          <div key={tk} className="an-gridline" style={{ bottom: `${(tk / ceil) * 100}%` }}>
            <span>{compactNumber(tk)}</span>
          </div>
        ))}
        <div className="an-bars" role="img" aria-label="Daily pageviews">
          {daily.map((d, i) => (
            <div
              key={d.day}
              className={`an-slot ${hover === i ? 'an-slot--hover' : ''}`}
              tabIndex={0}
              aria-label={`${fmtDay(d.day, true)}: ${d.pageviews} pageviews, ${d.sessions} sessions`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
            >
              <div className="an-bar" style={{ height: `${d.pageviews > 0 ? Math.max(2, (d.pageviews / ceil) * 100) : 0}%` }} />
            </div>
          ))}
        </div>
        {hovered && hover !== null && (
          <div className="an-tooltip" style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }}>
            <strong>{hovered.pageviews.toLocaleString()}</strong> pageviews · {hovered.sessions.toLocaleString()} sessions
            <span>{fmtDay(hovered.day, true)}</span>
          </div>
        )}
      </div>
      <div className="an-xaxis">
        {daily.map((d, i) => (
          (i % labelEvery === 0 || i === daily.length - 1) && (
            <span key={d.day} className="an-xlabel" style={{ left: `${((i + 0.5) / daily.length) * 100}%` }}>{fmtDay(d.day)}</span>
          )
        ))}
      </div>
    </div>
  );
}
