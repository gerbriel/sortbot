import { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useBrand, landingTitleFor } from '../lib/brandStore';
import { Check } from 'lucide-react';
import { requestBetaAccess } from '../lib/betaService';
import type { MarketplaceKey } from '../lib/marketplaces/types';
import Wordmark from './Wordmark';
import { Button, LinkButton } from './ui/Button';
import { WorkbenchPreview, StepPreview } from './LandingPreviews';
import { track } from '../lib/analytics';
import './ui/Chip.css';
import './Landing.css';

/* The interactive pieces and the dashboard preview carry the page's heavy
 * code (and, for the dashboard, HomeDashboard.css, OrgPanel.css and
 * FounderConsole.css, none of which the main bundle has), so they are split
 * out of the first paint and load behind a quiet skeleton. Landing itself,
 * the hero workbench and the four step previews stay eager: they draw on
 * stylesheets App already ships (AGENTS.md §8). */
const LandingDemo = lazy(() => import('./landing/LandingDemo'));
const TimeCalculator = lazy(() => import('./landing/TimeCalculator'));
const LandingDashboardPreview = lazy(() => import('./LandingDashboardPreview'));

interface LandingProps {
  onLoginClick: () => void;
}

/* ── No photography (Nov 2026) ──────────────────────────────────────────────
 * The page used Unsplash stock photos (and credited them in the footer) until
 * the owner asked for the product itself to be the picture: every visual is
 * now a preview built from the app's own components (LandingPreviews.tsx,
 * LandingDashboardPreview.tsx). Nothing on the page loads from
 * images.unsplash.com any more, and that origin left the CSP img-src too. */

/** The page's own sections, in order. The nav (desktop) and the footer's
 *  Navigation column both read this, so a section is renamed in one place. */
const SECTION_LINKS: { href: string; label: string }[] = [
  { href: '#how', label: 'How it works' },
  { href: '#demo', label: 'Demo' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

/** How it works. Every sentence describes what the app does today (§10). */
const STEPS: { title: string; body: string }[] = [
  {
    title: 'Upload photos',
    body: 'Drop in a phone export, a folder or a ZIP. Capture time keeps every shot in the order you took it.',
  },
  {
    title: 'Group and categorize',
    body: 'Drag the angles of one piece into a single listing, then drop it onto a category. The preset fills shipping, policies and the title template.',
  },
  {
    title: 'Dictate the details',
    body: 'Say the field name, then the value. The grammar fills size, brand, measurements and flaws while you hold the garment.',
  },
  {
    title: 'Export everywhere',
    body: 'A Shopify CSV built for import, plus a feed or a copy pack for each marketplace you sell on.',
  },
];

/** Display names of the ten export targets. Typed against MarketplaceKey (a
 *  type only import, so no adapter code reaches the first paint), which makes
 *  a missing or extra marketplace a compile error. Names match each adapter's
 *  `spec.name` in src/lib/marketplaces/. */
const MARKETPLACE_NAMES: Record<MarketplaceKey, string> = {
  shopify: 'Shopify',
  ebay: 'eBay',
  etsy: 'Etsy',
  poshmark: 'Poshmark',
  mercari: 'Mercari',
  grailed: 'Grailed',
  depop: 'Depop',
  facebook: 'Facebook',
  vinted: 'Vinted',
  whatnot: 'Whatnot',
};

/** Six real questions. Answers say only what the product does. A function of
 *  the runtime name, which the founder can change without a deploy. */
const faqsFor = (name: string): { q: string; a: string }[] => [
  {
    q: `Which marketplaces does ${name} export to?`,
    a: `Shopify, eBay, Etsy, Poshmark, Mercari, Grailed, Depop, Facebook, Vinted and Whatnot. Shopify gets a CSV built for its product import. The others get a feed file or a copy pack per listing that you paste into the marketplace's own app.`,
  },
  {
    q: `Does ${name} guess at my listings?`,
    a: 'No. Every field comes from your category preset, your dictation or a title and description template you control. Dictation is read by a grammar, field name then value, so the same input gives the same listing every time. Nothing is invented, and you can always see why a field says what it says.',
  },
  {
    q: `How is ${name} related to arcadian.ltd?`,
    a: `arcadian.ltd is the domain ${name} is served from. Same product, same account.`,
  },
  {
    q: 'Can I try it without a card?',
    a: 'Yes. The beta is free, and the Free plan covers 5 listings a month after launch. No card is asked for at any point during the beta.',
  },
  {
    q: 'Where do my photos live?',
    a: 'In your own workspace in our Supabase project, private to your team. You can export your listings and photos at any time.',
  },
  {
    q: 'Does my team get access?',
    a: 'Yes. Each shop gets a private workspace with roles: an owner, admins and members, invited by email.',
  },
];

/** If a lazy chunk fails to load (offline, a stale deploy), the section shows
 *  one quiet line instead of taking the whole marketing page down with it. */
class LazySlot extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <p className="ld-slot-failed">The {this.props.label} could not load. Refresh the page to try again.</p>;
    }
    return (
      <Suspense fallback={<div className="ld-skeleton" role="status" aria-label={`Loading the ${this.props.label}`} />}>
        {this.props.children}
      </Suspense>
    );
  }
}

/** One row of the launch pricing ladder. Prices are preformatted strings so
 *  the $1,200 comma and the $0.00 per item cell render exactly as speced. */
interface PricingTier {
  name: string;
  items: string;
  price: string;
  perItem: string;
  /** Founding shop monthly price (30% off, locked for life). Null on Free. */
  founder: string | null;
  featured?: boolean;
}

/** Revised launch pricing (July 2026): eight tiers that differ by monthly item
 *  volume only; every plan gets the full product. Update pricing HERE. */
const PRICING_TIERS: PricingTier[] = [
  { name: 'Free',       items: '5',     price: '$0',     perItem: '$0.00', founder: null },
  { name: 'Starter',    items: '25',    price: '$50',    perItem: '$2.00', founder: '$35' },
  { name: 'Basic',      items: '60',    price: '$90',    perItem: '$1.50', founder: '$63' },
  { name: 'Growth',     items: '135',   price: '$150',   perItem: '$1.11', founder: '$105' },
  { name: 'Pro',        items: '300',   price: '$250',   perItem: '$0.83', founder: '$175', featured: true },
  { name: 'Business',   items: '550',   price: '$350',   perItem: '$0.64', founder: '$245' },
  { name: 'Scale',      items: '2,000', price: '$700',   perItem: '$0.35', founder: '$490' },
  { name: 'Enterprise', items: '6,000', price: '$1,200', perItem: '$0.20', founder: '$840' },
];

/**
 * Public marketing landing, rendered at the MAIN URL for logged-out visitors.
 * Logged-in users never see this (session restore takes them straight to the
 * dashboard). "Log in" → the Auth screen; the form → beta_signups (pending).
 *
 * COPY RULES (user): no emojis (lucide icons only), no "AI" wording, and no
 * dashes/hyphens/em dashes anywhere in the visible marketing text. The product
 * is rule based (presets, a dictation grammar, templates, export feeds), so
 * the page never says AI, vision, neural or scan, never claims one click
 * publishing, delisting or API connectors, and carries no invented numbers:
 * the only figures are the pricing table and the visitor's own calculator
 * inputs. No testimonials until real ones exist. Landing.test.tsx enforces it.
 *
 * Section order (Nov 2026): nav, hero, #how, #demo, #time, #marketplaces,
 * #dashboard, #pricing, #faq, #signup, footer. The app links to #pricing and
 * #signup; keep both ids.
 *
 * ONE LOOK WITH THE APP: controls are the ui primitives (LinkButton, Button,
 * the chip classes) and every visual is a preview built from the app's own
 * components and stylesheets, never stock photography or a drawn mock.
 */
export default function Landing({ onLoginClick }: LandingProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [done, setDone] = useState(false);

  // The static <title> in index.html stays the bare brand name (CI and the
  // uptime probe assert it, and it is right for the signed-in app). Only the
  // marketing page gets the descriptive tab/search title, and it hands the
  // previous one back when the visitor signs in and Landing unmounts.
  const brand = useBrand();
  const faqs = useMemo(() => faqsFor(brand.name), [brand.name]);
  useEffect(() => {
    const previous = document.title;
    document.title = landingTitleFor(brand.name);
    return () => { document.title = previous; };
  }, [brand.name]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || done) return;
    const data = new FormData(e.currentTarget);
    const email = String(data.get('email') || '').trim().toLowerCase();
    const orgName = String(data.get('org_name') || '').trim();
    const contactName = String(data.get('contact_name') || '').trim();
    if (!orgName || !contactName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMsg({ text: 'Please fill in your shop name, your name, and a valid email.', kind: 'err' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await requestBetaAccess({
      org_name: orgName,
      contact_name: contactName,
      email,
      store_url: String(data.get('store_url') || ''),
      volume: String(data.get('volume') || ''),
      notes: String(data.get('notes') || ''),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      track('Beta Signup');
      setMsg({ text: 'You are on the list! We review every request by hand and email you when your workspace is approved.', kind: 'ok' });
    } else {
      setMsg({ text: `Something went wrong (${res.error}). Please try again.`, kind: 'err' });
    }
  };

  return (
    <div className="landing">
      {/* ── Nav ── */}
      <nav className="ld-nav">
        <span className="ld-logo"><Wordmark /> <span className="ld-chip">BETA</span></span>
        <span className="ld-nav-actions">
          {SECTION_LINKS.map(l => (
            <a key={l.href} href={l.href} className="ld-nav-link">{l.label}</a>
          ))}
          <a href="#signup" className="ld-nav-cta">Request access</a>
          <button className="ld-nav-login" onClick={onLoginClick}>Log in</button>
        </span>
      </nav>

      {/* ── Hero ──
          The copy stays ON the light canvas and the product preview (a slice
          of the Step 2 workbench) sits BELOW it, so the black nav remains the
          page's only inverted surface. */}
      <header className="ld-hero">
        <div className="ld-hero-inner">
          <h1>Photograph the rack in the morning.<br />Listings live by lunch.</h1>
          <p className="ld-hero-descriptor">{brand.descriptor}</p>
          <p className="ld-hero-sub">
            Upload a batch of photos, group the angles of each piece, pick a category
            preset, dictate the details, and export to Shopify and the marketplaces
            you sell on.
          </p>
          <div className="ld-hero-ctas">
            <LinkButton href="#demo" variant="primary" size="lg">Try the demo</LinkButton>
            <LinkButton href="#signup" variant="secondary" size="lg">Request beta access</LinkButton>
          </div>
          <p className="ld-hero-note">Free during the beta · no card required · founding shops lock in 30% off for life</p>
        </div>
        <div className="ld-hero-media">
          <WorkbenchPreview />
        </div>
      </header>

      {/* ── How it works ── */}
      <section className="ld-section" id="how" aria-labelledby="ld-how-h">
        <div className="ld-section-head">
          <h2 id="ld-how-h">How it works</h2>
          <p>Four steps, the same four the app walks you through.</p>
        </div>
        <ol className="ld-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="ld-card ld-step">
              <div className="ld-step-text">
                <span className="ld-num" aria-hidden="true">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
              <StepPreview index={i} />
            </li>
          ))}
        </ol>
      </section>

      {/* ── Demo (lazy) ── */}
      <section className="ld-section" id="demo" aria-labelledby="ld-demo-h">
        <div className="ld-section-head">
          <h2 id="ld-demo-h">See a listing come together</h2>
          <p>One piece, from a pile of photos to a finished listing, in the same steps the app uses.</p>
        </div>
        <LazySlot label="demo">
          <LandingDemo />
        </LazySlot>
      </section>

      {/* ── Time calculator (lazy) ── */}
      <section className="ld-section" id="time" aria-labelledby="ld-time-h">
        <div className="ld-section-head">
          <h2 id="ld-time-h">What the typing costs you</h2>
          <p>Put in your own numbers and see the hours a week that go into retyping listings.</p>
        </div>
        <LazySlot label="calculator">
          <TimeCalculator />
        </LazySlot>
      </section>

      {/* ── Marketplaces ── */}
      <section className="ld-section" id="marketplaces" aria-labelledby="ld-mkt-h">
        <div className="ld-section-head">
          <h2 id="ld-mkt-h">Export to where you sell</h2>
          <p>Shopify imports the CSV directly. The others get a ready feed or a copy pack per listing.</p>
        </div>
        {/* The app's chip language (ui/Chip.css) on a plain span: these are
            labels, not controls, so they must not be buttons. */}
        <ul className="ld-markets ui-chip-group">
          {Object.entries(MARKETPLACE_NAMES).map(([key, name]) => (
            <li key={key} className="ld-market"><span className="ui-chip">{name}</span></li>
          ))}
        </ul>
      </section>

      {/* ── Your dashboard (lazy: it carries three app stylesheets) ── */}
      <section className="ld-section" id="dashboard" aria-labelledby="ld-dash-h">
        <div className="ld-section-head">
          <h2 id="ld-dash-h">Your dashboard</h2>
          <p>Plan usage sits on Home and on the Workspace page, for every member, so you always know where the month stands. Shown with sample data.</p>
        </div>
        <LazySlot label="dashboard preview">
          <LandingDashboardPreview />
        </LazySlot>
      </section>

      {/* ── Pricing ──
          One table at desktop (plan, listings, price, per listing, founding
          price; Pro is the featured row). At phone width the same rows restack
          in the FieldGrid cell language with CSS alone: the plan name as a
          caption over a framed two column grid, each cell labelled from its
          data-label. */}
      <section className="ld-section ld-pricing" id="pricing" aria-labelledby="ld-pricing-h">
        <div className="ld-section-head">
          <h2 id="ld-pricing-h">Pricing</h2>
          <p>
            Free during the beta, founding priced for life. When paid plans launch,
            founding shops lock in 30% off any tier, for life.
          </p>
        </div>
        <table className="ld-price-table">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Listings per month</th>
              <th scope="col">Price</th>
              <th scope="col">Per listing</th>
              <th scope="col">Founding price</th>
            </tr>
          </thead>
          <tbody>
            {PRICING_TIERS.map(t => (
              <tr key={t.name} className={t.featured ? 'is-featured' : undefined}>
                <th scope="row" data-label="Plan">
                  {t.name}
                  {t.featured && <span className="ld-featured-tag">Most popular</span>}
                </th>
                {/* Each value is ONE span so the phone layout (label left,
                    value right) has exactly two flex items per cell. */}
                <td data-label="Listings per month"><span>{t.items}</span></td>
                <td data-label="Price"><span>{t.price}<span className="ld-per">/mo</span></span></td>
                <td data-label="Per listing"><span>{t.perItem}</span></td>
                <td data-label="Founding price">
                  {t.founder
                    ? <span>{t.founder}<span className="ld-per">/mo</span></span>
                    : <span className="ld-muted">Free</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ld-tier-includes">
          <Check size={14} /> Every plan includes the full product: grouping, dictation,
          category presets, a shared team workspace, and every export. Plans differ by
          listings per month only.
        </p>
        <p className="ld-pricing-note">
          Planned launch pricing, subject to change before general availability.
          Listings beyond your tier bill at your tier price per listing.
        </p>
      </section>

      {/* ── FAQ ── */}
      <section className="ld-section" id="faq" aria-labelledby="ld-faq-h">
        <div className="ld-section-head">
          <h2 id="ld-faq-h">Questions</h2>
        </div>
        <div className="ld-faq">
          {faqs.map(f => (
            <details key={f.q} className="ld-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Signup ── */}
      <section className="ld-signup" id="signup">
        <h2>Request beta access</h2>
        <p className="ld-signup-sub">
          We are onboarding a small number of shops and review every request by hand,
          usually within a day or two.
        </p>
        <form onSubmit={submit} noValidate>
          <div className="ld-form-row">
            <label>Shop / organization name *<input name="org_name" type="text" required maxLength={120} placeholder="Rack City Vintage" disabled={done} /></label>
            <label>Your name *<input name="contact_name" type="text" required maxLength={120} placeholder="Sam Reseller" disabled={done} /></label>
          </div>
          <div className="ld-form-row">
            <label>Email *<input name="email" type="email" required maxLength={200} placeholder="you@shop.com" disabled={done} /></label>
            <label>Shopify store / website<input name="store_url" type="text" maxLength={300} placeholder="rackcity.myshopify.com" disabled={done} /></label>
          </div>
          <div className="ld-form-row">
            <label>Listings per week
              <select name="volume" disabled={done}>
                <option value="">Select…</option>
                <option>Under 25</option>
                <option>25 to 100</option>
                <option>100 to 300</option>
                <option>300+</option>
              </select>
            </label>
            <label>Anything else?<input name="notes" type="text" maxLength={500} placeholder="What is slowing your listing down today?" disabled={done} /></label>
          </div>
          <Button type="submit" variant="primary" size="lg" fullWidth className="ld-submit" disabled={busy || done}>
            {done ? 'Requested. Check your email soon' : busy ? 'Sending…' : 'Request access'}
          </Button>
          {msg && <p className={`ld-form-msg ld-form-msg--${msg.kind}`} role="status">{msg.text}</p>}
        </form>
        <p className="ld-signup-login">Already approved? <button onClick={onLoginClick}>Log in</button></p>
      </section>

      <footer className="ld-footer">
        <div className="ld-footer-cols">
          <div className="ld-footer-brand">
            <Wordmark />
            <p className="ld-footer-descriptor">{brand.descriptor}</p>
            <p>Built for vintage resellers. Beta access is reviewed and approved by hand.</p>
          </div>
          <nav className="ld-footer-col" aria-label="Page sections">
            <h3>Navigation</h3>
            <ul>
              {SECTION_LINKS.map(l => (
                <li key={l.href}><a href={l.href}>{l.label}</a></li>
              ))}
            </ul>
          </nav>
          <div className="ld-footer-col">
            <h3>Company</h3>
            <ul>
              <li><a href="#signup">Request access</a></li>
              <li><button type="button" onClick={onLoginClick}>Log in</button></li>
            </ul>
          </div>
        </div>
        <p className="ld-footer-bottom">© 2026 {brand.name}. Served from arcadian.ltd.</p>
      </footer>
    </div>
  );
}
