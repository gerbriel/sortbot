import { useState } from 'react';
import {
  ShoppingBag, Target, RotateCcw, RotateCw, Trash2, Scissors, Mic, Download,
  BadgeDollarSign, MessageSquare, Users, Package, Check, Shirt, Layers, Clock,
} from 'lucide-react';
import { requestBetaAccess } from '../lib/betaService';
import { track } from '../lib/analytics';
import './Landing.css';

interface LandingProps {
  onLoginClick: () => void;
}

/* ── Photography ────────────────────────────────────────────────────────────
 * Editorial vintage-clothing imagery, hosted on the Unsplash CDN (no bytes in
 * the repo, no build step). The `w` param is sized to the largest slot the
 * image can occupy, so nothing downloads a 5000px original.
 *
 * DO NOT hand-edit these URLs beyond the documented Unsplash query params
 * (w / h / q / auto / fit) — every one below was verified 200 image/jpeg.
 * Crops are steered with CSS object-position, not by rewriting the URL.
 */
const PHOTO = {
  /** Hero band: a long rail of dark wool blazers on a real thrift floor. */
  heroRail: 'https://images.unsplash.com/photo-1675537057530-312348c6caa2?w=2400&q=75&auto=format&fit=crop',
  /** Tour 1: shop-window rail of cream and oatmeal knitwear. */
  knitRail: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=1200&q=75&auto=format&fit=crop',
  /** Tour 3: stack of folded knitwear in neutral tones. Replaced a denim macro
   *  that was electric blue — it was the one image on the page fighting the
   *  black/white/grey palette instead of sitting inside it. */
  knitStack: 'https://images.unsplash.com/photo-1760013531865-89ff324f83a6?w=1200&q=75&auto=format&fit=crop',
  /** Signup band: folded jeans on seamless white, the calmest of the set. */
  denimStack: 'https://images.unsplash.com/photo-1637069585336-827b298fe84a?w=1200&q=75&auto=format&fit=crop',
} as const;

/** Footer attribution. Unsplash does not require it; we credit anyway. */
const PHOTO_CREDITS: { name: string; href: string }[] = [
  { name: 'Anthony Sebbo', href: 'https://unsplash.com/photos/a-rack-of-shirts-in-a-clothing-store-Q-o0ILOg3kk' },
  { name: 'Hannah Morgan', href: 'https://unsplash.com/photos/assorted-color-hanging-clothes-lot-ycVFts5Ma4s' },
  { name: 'Claire Abdo', href: 'https://unsplash.com/photos/a-stack-of-jeans-sitting-on-top-of-each-other-aWLTXw6kbDw' },
  { name: 'Katya Azimova', href: 'https://unsplash.com/photos/stack-of-folded-cozy-sweaters-in-neutral-colors-05O5v_aBkO0' },
];

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
 *  volume only — every plan gets the full product. Update pricing HERE. */
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
 * Public marketing landing — rendered at the MAIN URL for logged-out visitors.
 * Logged-in users never see this (session restore takes them straight to the
 * dashboard). "Log in" → the Auth screen; the form → beta_signups (pending).
 *
 * COPY RULES (user): no emojis (lucide icons only), no "AI" wording, and no
 * dashes/hyphens/em dashes anywhere in the visible marketing text.
 *
 * The "screenshot" panels are stylized CSS mockups of the real dashboard.
 * To swap in real screenshots later: drop PNGs in public/screenshots/ and
 * replace the .shot-mock divs with <img> tags. They are KEPT alongside the
 * photography — the mocks are the only thing on the page that shows what the
 * product actually looks like, so a photo never replaces one, it sits above it.
 */
export default function Landing({ onLoginClick }: LandingProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [done, setDone] = useState(false);

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
        <span className="ld-logo"><ShoppingBag size={22} /> Acadia <span className="ld-chip">BETA</span></span>
        <span className="ld-nav-actions">
          <a href="#pricing" className="ld-nav-link">Pricing</a>
          <a href="#signup" className="ld-nav-cta">Request access</a>
          <button className="ld-nav-login" onClick={onLoginClick}>Log in</button>
        </span>
      </nav>

      {/* ── Hero ──
          The copy stays ON the light canvas and the photograph sits BELOW it as
          a full-bleed band, so no text is ever laid over the image and the black
          nav remains the page's only inverted surface. */}
      <header className="ld-hero">
        <div className="ld-hero-inner">
          <h1>Photograph the rack in the morning.<br />Listings live by lunch.</h1>
          <p>
            Acadia turns a camera roll of vintage clothing photos into listings that are
            ready for Shopify. Group the angles, <em>speak</em> the details, export the file.
            Built by resellers who list hundreds of pieces a week.
          </p>
          <div className="ld-hero-ctas">
            <a href="#signup" className="ld-btn-primary">Request beta access</a>
            <a href="#tour" className="ld-btn-ghost">See how it works</a>
          </div>
          <p className="ld-hero-note">Free during the beta · no card required · founding shops lock in 30% off for life</p>
        </div>
        <figure className="ld-photo ld-hero-media">
          <img
            src={PHOTO.heroRail}
            alt="A rack of vintage blazers and coats hanging in a thrift shop, warm afternoon light"
            width={2400}
            height={900}
            loading="eager"
            fetchPriority="high"
          />
        </figure>
      </header>

      {/* ── Stats strip ── */}
      <section className="ld-stats">
        <div><strong>1 drop</strong><span>hundreds of photos from folders, ZIPs, and phone exports</span></div>
        <div><strong>50+ fields</strong><span>filled by voice while you hold the garment</span></div>
        <div><strong>63 columns</strong><span>one CSV built exactly for Shopify import</span></div>
        <div><strong>4 steps</strong><span>camera roll to storefront in the same day</span></div>
      </section>

      {/* ── Tour: alternating feature + mock screenshot ── */}
      <section className="ld-tour" id="tour">

        {/* 1 — Grouping */}
        <div className="ld-tour-row">
          <div className="ld-tour-text">
            <h2>A pile of photos becomes products in minutes</h2>
            <p>
              Shot time ordering lines your photos up exactly as you shot them. Group
              automatically by photos per item, or flip on pick mode and fly through
              by hand. Rotate, crop, and clean up from one toolbar across hundreds of
              images at once.
            </p>
            <ul>
              <li>Turn 400 photos into 100 products in one click</li>
              <li>Uploads resume on their own when spotty internet drops mid batch</li>
              <li>Every photo action lives in one toolbar, not buried on each image</li>
            </ul>
          </div>
          <div className="ld-tour-visual">
            <figure className="ld-photo ld-tour-photo">
              <img
                src={PHOTO.knitRail}
                alt="A window rack of cream and oatmeal knitwear in a second-hand clothing store"
                width={1200}
                height={675}
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div className="ld-shot" aria-hidden="true">
              <div className="shot-bar"><i /><i /><i /><em>Acadia · Group &amp; Categorize</em></div>
              <div className="shot-mock shot-mock--grid">
                <div className="mock-toolbar">
                  <b><Target size={11} /> Pick photos</b>
                  <b><RotateCcw size={11} /> Rotate 4</b>
                  <b><RotateCw size={11} /> Rotate 4</b>
                  <b className="mk-green"><Scissors size={11} /> Copy Crop</b>
                  <b className="mk-red"><Trash2 size={11} /> Delete</b>
                </div>
                <div className="mock-grid">
                  {['#e4e4e7', '#a1a1aa', '#d4d4d8', '#71717a', '#c8c8cf', '#8d8d95', '#eaeaed', '#5c5c66'].map((c, i) => (
                    <div key={i} className={`mock-card${i === 1 || i === 4 ? ' mock-card--sel' : ''}`} style={{ background: c }}>
                      <Shirt size={22} />
                    </div>
                  ))}
                </div>
                <div className="mock-groupcard">
                  <span className="mock-grouplabel"><Check size={11} /> 4 images · tees</span>
                  <div className="mock-groupthumbs"><i style={{ background: '#e4e4e7' }} /><i style={{ background: '#a1a1aa' }} /><i style={{ background: '#d4d4d8' }} /><i style={{ background: '#71717a' }} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 2 — Presets: set up once, apply forever */}
        <div className="ld-tour-row ld-tour-row--flip">
          <div className="ld-tour-text">
            <h2>Set up your presets once. They do the typing forever.</h2>
            <p>
              Build a preset for each thing you sell: tees, hoodies, jackets, hats.
              Each preset carries the shipping weight, the price floor, the policies,
              the SEO title template, and the exact measurement fields that category
              needs. Then drag whole groups of photos onto a category and every field
              fills itself, across the entire batch at once.
            </p>
            <ul>
              <li>Drop 30 groups on the tees category and all 30 inherit shipping, SEO, and policies instantly</li>
              <li>The fields you used to retype on every single listing simply stop existing as work</li>
              <li>New teammate on the rack today? Your presets are the training manual</li>
            </ul>
          </div>
          <div className="ld-tour-visual">
            <div className="ld-shot" aria-hidden="true">
              <div className="shot-bar"><i /><i /><i /><em>Acadia · Category Presets</em></div>
              <div className="shot-mock shot-mock--presets">
                <div className="mock-preset-head"><Layers size={13} /> Tees preset</div>
                <div className="mock-preset-rows">
                  <div><label>Ships from</label><b>Los Angeles, CA</b></div>
                  <div><label>Weight</label><b>300 g</b></div>
                  <div><label>SEO template</label><b>{'{size}'} Vintage {'{brand}'} {'{era}'} Tee</b></div>
                  <div><label>Measurements</label><b>Width · Length</b></div>
                </div>
                <div className="mock-preset-apply"><Check size={12} /> Applied to 30 products in one drop</div>
              </div>
            </div>
          </div>
        </div>

        {/* 3 — Voice */}
        <div className="ld-tour-row">
          <div className="ld-tour-text">
            <h2>Talk. Don't type.</h2>
            <p>
              Hold the garment and say what you see. Acadia parses brands, sizes,
              colors, and measurements into the right fields and writes a clean,
              human listing with your measurements front and center.
            </p>
            <ul>
              <li>Say brand Nike, size large, width 18, and the fields fill themselves</li>
              <li>SEO titles built from a knowledge base of over 5,000 vintage brands and eras</li>
              <li>Measurements in every listing means fewer returns</li>
            </ul>
          </div>
          <div className="ld-tour-visual">
            <figure className="ld-photo ld-tour-photo">
              <img
                src={PHOTO.knitStack}
                alt="A stack of folded knitwear in cream, oatmeal and grey, resting on a wooden stool"
                width={1200}
                height={675}
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div className="ld-shot" aria-hidden="true">
              <div className="shot-bar"><i /><i /><i /><em>Acadia · Describe</em></div>
              <div className="shot-mock shot-mock--voice">
                <div className="mock-mic"><Mic size={13} /> Recording… <span className="mock-wave"><i /><i /><i /><i /><i /></span></div>
                <div className="mock-transcript">“brand nike period size large fits like medium period width 18 period…”</div>
                <div className="mock-fields">
                  <div><label>Brand</label><b>Nike</b></div>
                  <div><label>Size</label><b>L (fits like M)</b></div>
                  <div><label>Width</label><b>18"</b></div>
                  <div><label>Price</label><b>$45</b></div>
                </div>
                <div className="mock-desc">
                  <i style={{ width: '82%' }} /><i style={{ width: '95%' }} /><i style={{ width: '70%' }} /><i style={{ width: '88%' }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4 — Export */}
        <div className="ld-tour-row ld-tour-row--flip">
          <div className="ld-tour-text">
            <h2>One click to Shopify</h2>
            <p>
              Export a CSV with all 63 columns Shopify expects: taxonomy paths,
              metafields, every photo positioned. Titles are checked against your
              live store so imports never collide, and export blocks if any product
              is missing a price.
            </p>
            <ul>
              <li>Products land in shoot order, grouped exactly as you grouped them</li>
              <li>Titles are checked against your existing catalog before the file is built</li>
              <li>Works with your VA workflow: hand off the file and go</li>
            </ul>
          </div>
          <div className="ld-tour-visual">
            <div className="ld-shot" aria-hidden="true">
              <div className="shot-bar"><i /><i /><i /><em>Acadia · Export</em></div>
              <div className="shot-mock shot-mock--csv">
                <div className="mock-thead"><b>Handle</b><b>Title</b><b>Price</b><b>Category</b><b>Size</b></div>
                {[
                  ['vintage nike 90s tee', 'XL Vintage Y2K Nike 90s Tee', '$45.00', 'T Shirts', 'XL'],
                  ['carhartt detroit jacket', 'Carhartt Detroit Jacket', '$120.00', 'Coats & Jackets', 'L'],
                  ['levis 501 straight', "Levi's 501 Straight Denim", '$68.00', 'Jeans', '32'],
                ].map((row, i) => (
                  <div key={i} className="mock-trow">{row.map((cell, j) => <span key={j}>{cell}</span>)}</div>
                ))}
                <div className="mock-download"><Download size={13} /> Download CSV · 11 products · 42 photos</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The labor math ── */}
      <section className="ld-math">
        <h2>The math your bookkeeper will like</h2>
        <p className="ld-math-sub">
          Listing by hand takes most shops 8 to 12 minutes per piece: retyping shipping,
          policies, and SEO, measuring, writing the description. With presets doing the
          repetitive fields and voice doing the typing, the same listing takes about 3.
        </p>
        <div className="ld-math-grid">
          <div>
            <span className="ld-ic"><Clock size={22} /></span>
            <strong>8 hours back</strong>
            <p>every week for a shop listing 100 pieces, just from the minutes saved per listing</p>
          </div>
          <div>
            <span className="ld-ic"><BadgeDollarSign size={22} /></span>
            <strong>$500+ per month</strong>
            <p>in labor at typical VA rates, before you count the batches that now ship the same day</p>
          </div>
          <div>
            <span className="ld-ic"><Layers size={22} /></span>
            <strong>Zero retyping</strong>
            <p>presets carry shipping, policies, and SEO onto every future listing in that category, forever</p>
          </div>
        </div>
      </section>

      {/* ── Founding shops incentive ── */}
      <section className="ld-founding">
        <h2>Why join as a founding shop?</h2>
        <div className="ld-founding-grid">
          <div><span className="ld-ic"><BadgeDollarSign size={22} /></span><h3>Free during beta</h3><p>Full product, unlimited listings, no card. When paid plans launch, founding shops lock in 30% off any tier, for life.</p></div>
          <div><span className="ld-ic"><MessageSquare size={22} /></span><h3>A direct line to the builders</h3><p>Beta shops shape the roadmap. The last three features shipped came straight from a reseller's feedback.</p></div>
          <div><span className="ld-ic"><Users size={22} /></span><h3>Your whole team, day one</h3><p>Private workspace with email invites. Your photographer, describer, and VA all working the same rack.</p></div>
          <div><span className="ld-ic"><Package size={22} /></span><h3>Your data stays yours</h3><p>Everything exports to plain CSV any time. No contracts, nothing held hostage.</p></div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="ld-pricing" id="pricing">
        <h2>Simple pricing when we launch</h2>
        <p className="ld-pricing-sub">
          Everything is <strong>free during the beta</strong>, and founding shops lock in
          <strong> 30% off for life</strong> on any tier when paid plans launch.
        </p>
        <div className="ld-tiers ld-tiers--ladder">
          {PRICING_TIERS.map(t => (
            <div key={t.name} className={`ld-tier${t.featured ? ' ld-tier--featured' : ''}`}>
              {t.featured && <div className="ld-tier-badge">Most popular</div>}
              <h3>{t.name}</h3>
              <div className="ld-tier-price">{t.price}<span>/mo</span></div>
              <div className="ld-tier-items">{t.items} items a month</div>
              <div className="ld-tier-peritem">{t.perItem} per item</div>
              {t.founder && (
                <div className="ld-tier-founder">Founding shops: {t.founder}/mo for life</div>
              )}
            </div>
          ))}
        </div>
        <p className="ld-tier-includes">
          <Check size={14} /> Every plan includes the full product: grouping, voice
          descriptions, category presets, a shared team workspace, and CSV export
          built for Shopify.
        </p>
        <p className="ld-pricing-note">
          Planned launch pricing, subject to change before general availability.
          Listings beyond your tier bill at your tier price per item.
          Annual billing: 2 months free.
        </p>
      </section>

      {/* ── Signup ── */}
      <section className="ld-signup" id="signup">
        {/* Near-white studio background: it dissolves into the card, so the
            form needs no scrim and the heading below it stays full contrast. */}
        <figure className="ld-photo ld-signup-photo">
          <img
            src={PHOTO.denimStack}
            alt="A stack of four folded pairs of denim jeans in graduated blue washes on a plain white surface"
            width={1200}
            height={500}
            loading="lazy"
            decoding="async"
          />
        </figure>
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
          <button type="submit" disabled={busy || done}>
            {done ? 'Requested. Check your email soon' : busy ? 'Sending…' : 'Request access'}
          </button>
          {msg && <p className={`ld-form-msg ld-form-msg--${msg.kind}`} role="status">{msg.text}</p>}
        </form>
        <p className="ld-signup-login">Already approved? <button onClick={onLoginClick}>Log in</button></p>
      </section>

      <footer className="ld-footer">
        Acadia · built for vintage resellers · beta access is reviewed and approved by hand
        <p className="ld-credit">
          Photography:{' '}
          {PHOTO_CREDITS.map((c, i) => (
            <span key={c.href}>
              {i > 0 && ', '}
              <a href={c.href} target="_blank" rel="noopener noreferrer">{c.name}</a>
            </span>
          ))}
          {' '}via Unsplash
        </p>
      </footer>
    </div>
  );
}
