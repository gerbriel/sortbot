import { Boxes } from 'lucide-react';
import { Badge } from './ui/Badge';
import { planUsageMeters } from '../lib/home';
import { planDisplayName, type OrgUsage } from '../lib/usageService';
import { PlanUsageGroup } from './OrgPanel';
import { PreviewFrame } from './LandingPreviews';
/* Neither stylesheet is in the main bundle (HomeDashboard and OrgPanel are
 * lazy in App), which is why this whole section is a lazy chunk of its own on
 * the landing page. Neither declares an element or :root rule, so loading them
 * on the marketing page leaks nothing. OrgPanel.tsx imports OrgPanel.css
 * itself; importing the module also brings its JS (the OrgPanel chunk, about
 * 43 kB), accepted so the Workspace preview is the REAL PlanUsageGroup. */
import './HomeDashboard.css';

/* ════════════════════════════════════════════════════════════════════════════
   "Your dashboard" on the landing page: the two places every member of a
   workspace sees its plan usage. The Home "Plan usage" card is drawn with the
   widget's own markup through the SAME pure helper (planUsageMeters); the
   Workspace page's "Plan and usage" group is the real exported component
   (PlanUsageGroup). Both get one fixture workspace. Nothing here calls
   Supabase; every number is sample data and the captions say so. The founder
   console is deliberately NOT shown: customers never see it.
   ════════════════════════════════════════════════════════════════════════════ */

const GB = 1024 ** 3;

/** One workspace on the Growth plan (135 listings a month, as priced). */
const HOME_FIXTURE: OrgUsage = {
  org_id: 'sample',
  plan: 'growth',
  limits: { listings_per_month: 135, storage_gb: 25, seats: 5 },
  usage: { storage_bytes: 6.4 * GB, files: 1820, listings_this_month: 118, members: 3, month_start: '2026-11-01' },
  listing_basis: 'created',
};

function PlanUsageCard() {
  const meters = planUsageMeters(HOME_FIXTURE);
  return (
    <section className="home-card">
      <div className="home-card-head">
        <h2 className="home-card-title">
          <span className="home-card-icon"><Boxes size={16} /></span>
          Plan usage
        </h2>
        <Badge tone="neutral">{planDisplayName(HOME_FIXTURE.plan)}</Badge>
      </div>
      <ul className="home-usage">
        {meters.map(m => (
          <li key={m.key} className={`home-usage-row home-usage-row--${m.readout.tone}`}>
            <div className="home-usage-line">
              <span className="home-usage-label">{m.label}</span>
              <span className="home-usage-value">{m.readout.text}</span>
            </div>
            {!m.readout.unlimited && (
              <div className="home-usage-track">
                <div className="home-usage-fill" style={{ width: `${m.readout.percent}%` }} />
              </div>
            )}
            {m.hint && <span className="home-usage-hint">{m.hint}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LandingDashboardPreview() {
  return (
    <div className="ld-dash">
      <PreviewFrame caption="Home, plan usage (sample data)">
        <PlanUsageCard />
      </PreviewFrame>
      <PreviewFrame caption="Workspace page, plan and usage (sample data)">
        <PlanUsageGroup usage={HOME_FIXTURE} />
      </PreviewFrame>
    </div>
  );
}
