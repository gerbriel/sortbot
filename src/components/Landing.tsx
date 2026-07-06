import { useState } from 'react';
import {
  ShoppingBag, Target, RotateCcw, RotateCw, Trash2, Scissors, Mic, Download,
  BadgeDollarSign, MessageSquare, Users, Package, Check, Shirt,
} from 'lucide-react';
import { requestBetaAccess } from '../lib/betaService';
import './Landing.css';

interface LandingProps {
  onLoginClick: () => void;
}

/**
 * Public marketing landing — rendered at the MAIN URL for logged-out visitors.
 * Logged-in users never see this (session restore takes them straight to the
 * dashboard). "Log in" → the Auth screen; the form → beta_signups (pending).
 *
 * No emojis — lucide icons only (user rule). No "AI" wording (user rule).
 *
 * The three "screenshot" panels are stylized CSS mockups of the real dashboard.
 * To swap in real screenshots later: drop PNGs in public/screenshots/ and
 * replace the .shot-mock divs with <img> tags.
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
      setMsg({ text: "You're on the list! We review every request by hand and email you when your workspace is approved.", kind: 'ok' });
    } else {
      setMsg({ text: `Something went wrong (${res.error}). Please try again.`, kind: 'err' });
    }
  };

  return (
    <div className="landing">
      {/* ── Nav ── */}
      <nav className="ld-nav">
        <span className="ld-logo"><ShoppingBag size={22} /> Sortbot <span className="ld-chip">BETA</span></span>
        <span className="ld-nav-actions">
          <a href="#pricing" className="ld-nav-link">Pricing</a>
          <a href="#signup" className="ld-nav-cta">Request access</a>
          <button className="ld-nav-login" onClick={onLoginClick}>Log in</button>
        </span>
      </nav>

      {/* ── Hero ── */}
      <header className="ld-hero">
        <h1>Photograph the rack in the morning.<br />Listings live by lunch.</h1>
        <p>
          Sortbot turns a camera roll of vintage clothing photos into Shopify-ready
          listings — group the angles, <em>speak</em> the details, export the file.
          Built by resellers who list hundreds of pieces a week.
        </p>
        <div className="ld-hero-ctas">
          <a href="#signup" className="ld-btn-primary">Request beta access</a>
          <a href="#tour" className="ld-btn-ghost">See how it works</a>
        </div>
        <p className="ld-hero-note">Free during the beta · no card required · founding shops lock in 30% off for life</p>
      </header>

      {/* ── Stats strip ── */}
      <section className="ld-stats">
        <div><strong>1 drop</strong><span>hundreds of photos in — folders, ZIPs, phone exports</span></div>
        <div><strong>50+ fields</strong><span>filled by voice while you hold the garment</span></div>
        <div><strong>63 columns</strong><span>Shopify-ready CSV with taxonomy &amp; metafields</span></div>
        <div><strong>4 steps</strong><span>camera roll → storefront, same day</span></div>
      </section>

      {/* ── Tour: alternating feature + mock screenshot ── */}
      <section className="ld-tour" id="tour">

        {/* 1 — Grouping */}
        <div className="ld-tour-row">
          <div className="ld-tour-text">
            <h2>A pile of photos becomes products in minutes</h2>
            <p>
              Shot-time ordering lines your photos up exactly as you shot them.
              Auto-group by photos-per-item, or flip on pick mode and rapid-fire
              group by hand. Rotate, crop-paste, and clean up from one toolbar —
              across hundreds of images at once.
            </p>
            <ul>
              <li>Auto-group 400 photos into 100 products in one click</li>
              <li>Drag groups onto categories — presets fill shipping &amp; SEO</li>
              <li>Resumable uploads that survive bad Wi-Fi mid-batch</li>
            </ul>
          </div>
          <div className="ld-shot" aria-hidden="true">
            <div className="shot-bar"><i /><i /><i /><em>Sortbot — Group &amp; Categorize</em></div>
            <div className="shot-mock shot-mock--grid">
              <div className="mock-toolbar">
                <b><Target size={11} /> Pick photos</b>
                <b><RotateCcw size={11} /> Rotate 4</b>
                <b><RotateCw size={11} /> Rotate 4</b>
                <b className="mk-green"><Scissors size={11} /> Copy Crop</b>
                <b className="mk-red"><Trash2 size={11} /> Delete</b>
              </div>
              <div className="mock-grid">
                {['#c4b5fd', '#fca5a5', '#93c5fd', '#fcd34d', '#86efac', '#f9a8d4', '#a5b4fc', '#fdba74'].map((c, i) => (
                  <div key={i} className={`mock-card${i === 1 || i === 4 ? ' mock-card--sel' : ''}`} style={{ background: c }}>
                    <Shirt size={22} />
                  </div>
                ))}
              </div>
              <div className="mock-groupcard">
                <span className="mock-grouplabel"><Check size={11} /> 4 images · tees</span>
                <div className="mock-groupthumbs"><i style={{ background: '#c4b5fd' }} /><i style={{ background: '#a5b4fc' }} /><i style={{ background: '#93c5fd' }} /><i style={{ background: '#818cf8' }} /></div>
              </div>
            </div>
          </div>
        </div>

        {/* 2 — Voice */}
        <div className="ld-tour-row ld-tour-row--flip">
          <div className="ld-tour-text">
            <h2>Talk. Don't type.</h2>
            <p>
              Hold the garment and say what you see — Sortbot parses brands, sizes,
              colors, and measurements into the right fields and writes a clean,
              human listing with your measurements front and center.
            </p>
            <ul>
              <li>“brand Nike, size large, width 18, length 26” — done</li>
              <li>SEO titles built from a 5,000-entry vintage brand &amp; era knowledge base</li>
              <li>Measurements in every listing = fewer returns</li>
            </ul>
          </div>
          <div className="ld-shot" aria-hidden="true">
            <div className="shot-bar"><i /><i /><i /><em>Sortbot — Describe</em></div>
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

        {/* 3 — Export */}
        <div className="ld-tour-row">
          <div className="ld-tour-text">
            <h2>One click to Shopify</h2>
            <p>
              Export a 63-column CSV that matches Shopify's own format — taxonomy
              paths, metafields, every photo positioned. Titles are checked against
              your live store so imports never collide, and export blocks if any
              product is missing a price.
            </p>
            <ul>
              <li>Products land in shoot order, grouped exactly as you grouped them</li>
              <li>Duplicate-title protection against your existing catalog</li>
              <li>Works with your VA workflow — hand off the file and go</li>
            </ul>
          </div>
          <div className="ld-shot" aria-hidden="true">
            <div className="shot-bar"><i /><i /><i /><em>Sortbot — Export</em></div>
            <div className="shot-mock shot-mock--csv">
              <div className="mock-thead"><b>Handle</b><b>Title</b><b>Price</b><b>Category</b><b>Size</b></div>
              {[
                ['vintage-nike-90s-tee', 'XL - Vintage Y2K Nike 90s Tee', '$45.00', 'T-Shirts', 'XL'],
                ['carhartt-detroit-jacket', 'Carhartt Detroit Jacket', '$120.00', 'Coats & Jackets', 'L'],
                ['levis-501-straight', "Levi's 501 Straight Denim", '$68.00', 'Jeans', '32'],
              ].map((row, i) => (
                <div key={i} className="mock-trow">{row.map((cell, j) => <span key={j}>{cell}</span>)}</div>
              ))}
              <div className="mock-download"><Download size={13} /> Download CSV — 11 products, 42 photos</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Founding shops incentive ── */}
      <section className="ld-founding">
        <h2>Why join as a founding shop?</h2>
        <div className="ld-founding-grid">
          <div><span className="ld-ic"><BadgeDollarSign size={22} /></span><h3>Free during beta</h3><p>Full product, unlimited listings, no card. When paid plans launch, founding shops lock in 30% off any tier — for life.</p></div>
          <div><span className="ld-ic"><MessageSquare size={22} /></span><h3>A direct line to the builders</h3><p>Beta shops shape the roadmap. The last three features shipped came straight from a reseller's feedback.</p></div>
          <div><span className="ld-ic"><Users size={22} /></span><h3>Your whole team, day one</h3><p>Private workspace with email invites — your photographer, describer, and VA all working the same rack.</p></div>
          <div><span className="ld-ic"><Package size={22} /></span><h3>Your data stays yours</h3><p>Everything exports to plain CSV any time. No lock-in, no hostage inventory.</p></div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="ld-pricing" id="pricing">
        <h2>Simple pricing when we launch</h2>
        <p className="ld-pricing-sub">
          Everything is <strong>free during the beta</strong> — and founding shops lock in
          <strong> 30% off for life</strong> on any tier when paid plans launch.
        </p>
        <div className="ld-tiers">
          <div className="ld-tier">
            <h3>Starter</h3>
            <div className="ld-tier-price">$49<span>/mo</span></div>
            <div className="ld-tier-founder">Founding shops: $34/mo for life</div>
            <ul>
              <li><Check size={14} /> Up to 200 listings / month</li>
              <li><Check size={14} /> Full workflow: group, voice, export</li>
              <li><Check size={14} /> Shopify-ready CSV with taxonomy</li>
              <li><Check size={14} /> 2 teammates</li>
            </ul>
          </div>
          <div className="ld-tier ld-tier--featured">
            <div className="ld-tier-badge">Most popular</div>
            <h3>Pro</h3>
            <div className="ld-tier-price">$129<span>/mo</span></div>
            <div className="ld-tier-founder">Founding shops: $89/mo for life</div>
            <ul>
              <li><Check size={14} /> Up to 750 listings / month</li>
              <li><Check size={14} /> Unlimited teammates in one workspace</li>
              <li><Check size={14} /> Duplicate-title checks against your live store</li>
              <li><Check size={14} /> Priority support</li>
            </ul>
          </div>
          <div className="ld-tier">
            <h3>Studio</h3>
            <div className="ld-tier-price">$299<span>/mo</span></div>
            <div className="ld-tier-founder">Founding shops: $209/mo for life</div>
            <ul>
              <li><Check size={14} /> Up to 2,000 listings / month (fair use)</li>
              <li><Check size={14} /> Unlimited teammates</li>
              <li><Check size={14} /> Onboarding session for your team</li>
              <li><Check size={14} /> Early access to new features</li>
            </ul>
          </div>
        </div>
        <p className="ld-pricing-note">
          Planned launch pricing — subject to change before general availability.
          Listings beyond your tier: $0.20 each. Annual billing: 2 months free.
        </p>
      </section>

      {/* ── Signup ── */}
      <section className="ld-signup" id="signup">
        <h2>Request beta access</h2>
        <p className="ld-signup-sub">
          We're onboarding a small number of shops and review every request by hand —
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
                <option>25–100</option>
                <option>100–300</option>
                <option>300+</option>
              </select>
            </label>
            <label>Anything else?<input name="notes" type="text" maxLength={500} placeholder="What's slowing your listing down today?" disabled={done} /></label>
          </div>
          <button type="submit" disabled={busy || done}>
            {done ? 'Requested — check your email soon' : busy ? 'Sending…' : 'Request access'}
          </button>
          {msg && <p className={`ld-form-msg ld-form-msg--${msg.kind}`} role="status">{msg.text}</p>}
        </form>
        <p className="ld-signup-login">Already approved? <button onClick={onLoginClick}>Log in</button></p>
      </section>

      <footer className="ld-footer">
        Sortbot · built for vintage resellers · beta access is reviewed and approved by hand
      </footer>
    </div>
  );
}
