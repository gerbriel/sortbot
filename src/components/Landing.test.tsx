import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { mount, cleanup, all, one } from './ui/testUtils';

vi.mock('../lib/betaService', () => ({ requestBetaAccess: vi.fn() }));
vi.mock('../lib/analytics', () => ({ track: vi.fn() }));
// The two lazy sections are another module's concern (and their own tests).
// Stubbing the dynamic imports keeps this file about the page's structure.
vi.mock('./landing/LandingDemo', () => ({ default: () => <div data-stub="demo">demo stub</div> }));
vi.mock('./landing/TimeCalculator', () => ({ default: () => <div data-stub="time">calculator stub</div> }));

import Landing from './Landing';
import { requestBetaAccess } from '../lib/betaService';
import { track } from '../lib/analytics';
import { BRAND, BRAND_DESCRIPTOR, BRAND_TITLE_LANDING } from '../brand';
import { listAdapters } from '../lib/marketplaces/registry';

const LANDING_TITLE = BRAND_TITLE_LANDING;

/** Mounts the page and lets the two lazy chunks resolve. */
async function mountLoaded() {
  const view = mount(<Landing onLoginClick={() => {}} />);
  // The dashboard preview is a REAL dynamic import (not stubbed), so its first
  // load transforms a module graph; wait until every skeleton has resolved.
  for (let i = 0; i < 200 && view.container.querySelector('.ld-skeleton'); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  }
  return view;
}

/** Every string a visitor can read: text, plus alt, aria-label, placeholder
 *  and the data-label the phone pricing layout prints through CSS. */
function visibleCopy(root: HTMLElement): string {
  const attrs = all(root, '[alt],[aria-label],[placeholder],[data-label]').flatMap(el =>
    ['alt', 'aria-label', 'placeholder', 'data-label'].map(a => el.getAttribute(a) ?? ''),
  );
  return [root.textContent ?? '', ...attrs].join('\n');
}

describe('Landing structure', () => {
  afterEach(() => { cleanup(); });

  it('renders the sections in order, keeping the #pricing and #signup anchors', async () => {
    const { container } = await mountLoaded();
    const ids = all(container, 'section[id]').map(s => s.id);
    expect(ids).toEqual(['how', 'demo', 'time', 'marketplaces', 'dashboard', 'pricing', 'faq', 'signup']);
  });

  it('uses product previews, not photography, and every preview is inert and captioned', async () => {
    const { container } = await mountLoaded();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('unsplash');
    const previews = all(container, 'figure.ld-preview');
    // hero workbench + four steps + two dashboard previews
    expect(previews).toHaveLength(7);
    for (const p of previews) {
      const body = one(p, '.ld-preview-body');
      expect(body.getAttribute('aria-hidden')).toBe('true');
      expect(body.hasAttribute('inert')).toBe(true);
      expect(one(p, 'figcaption').textContent?.trim()).not.toBe('');
    }
    // The hero preview is the real Step 2 card language.
    const hero = one(container, 'header.ld-hero');
    expect(all(hero, '.product-group-card .group-stack').length).toBeGreaterThan(0);
    expect(all(hero, '.category-zone').length).toBeGreaterThan(0);
  });

  it('renders the real components in the step previews', async () => {
    const { container } = await mountLoaded();
    const how = one(container, '#how');
    expect(how.querySelector('.dropzone .dz-action--primary')?.textContent).toContain('Take photos');
    expect(how.querySelector('nav.phone-stepper [aria-current="step"]')).not.toBeNull();
    expect(all(how, '.ui-fieldcell').length).toBeGreaterThan(0);
    expect(all(how, '.kwp-applied .ui-chip-pair').length).toBe(3);
    expect(all(how, '.ui-stat').length).toBe(3);
    expect(all(how, '.mkx-check').length).toBe(3);
  });

  it('draws the dashboard previews through the app helpers with sample data', async () => {
    const { container } = await mountLoaded();
    const dash = one(container, '#dashboard');
    const rows = all(dash, '.home-usage-row');
    expect(rows.map(r => one(r, '.home-usage-label').textContent)).toEqual(['Storage', 'Listings this month', 'Members']);
    expect(dash.textContent).toContain('118 of 135');
    // The Workspace page's real PlanUsageGroup: Plan plus the three meters.
    const cells = all(dash, '.org-usage .ui-fieldcell__label').map(l => l.textContent);
    expect(cells).toEqual(['Plan', 'Storage', 'Listings this month', 'Members']);
    expect(dash.textContent).toContain('Workspace page, plan and usage (sample data)');
    // Customers never see the founder console, so the landing never shows it.
    expect(dash.querySelector('.fc-usage-table')).toBeNull();
    expect(dash.textContent).not.toMatch(/founder/i);
  });

  it('uses the ui Button for the CTAs and the submit', async () => {
    const { container } = await mountLoaded();
    expect(all(container, '.ld-hero-ctas a.ui-btn')).toHaveLength(2);
    expect(one(container, '#signup button[type="submit"]').classList.contains('ui-btn--primary')).toBe(true);
  });

  it('nav links to the four sections and to the signup form', async () => {
    const { container } = await mountLoaded();
    const nav = one(container, 'nav.ld-nav');
    const links = all(nav, 'a').map(a => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['How it works', '#how'],
      ['Demo', '#demo'],
      ['Pricing', '#pricing'],
      ['FAQ', '#faq'],
      ['Request access', '#signup'],
    ]);
  });

  it('hero keeps the headline, shows the descriptor and has the two CTAs', async () => {
    const { container } = await mountLoaded();
    const hero = one(container, 'header.ld-hero');
    expect(one(hero, 'h1').textContent).toBe('Photograph the rack in the morning.Listings live by lunch.');
    expect(one(hero, '.ld-hero-descriptor').textContent).toBe(BRAND_DESCRIPTOR);
    expect(BRAND_DESCRIPTOR).toBe('Super quick resale lister');
    const ctas = all(hero, '.ld-hero-ctas a').map(a => [a.textContent, a.getAttribute('href')]);
    expect(ctas).toEqual([['Try the demo', '#demo'], ['Request beta access', '#signup']]);
  });

  it('numbers the four how it works steps', async () => {
    const { container } = await mountLoaded();
    const steps = all(container, '#how .ld-step');
    expect(steps.map(s => one(s, '.ld-num').textContent)).toEqual(['1', '2', '3', '4']);
    expect(steps.map(s => one(s, 'h3').textContent)).toEqual([
      'Upload photos', 'Group and categorize', 'Dictate the details', 'Export everywhere',
    ]);
  });

  it('mounts the lazy demo and calculator in their sections', async () => {
    const { container } = await mountLoaded();
    expect(container.querySelector('#demo [data-stub="demo"]')).not.toBeNull();
    expect(container.querySelector('#time [data-stub="time"]')).not.toBeNull();
  });

  it('lists exactly the marketplaces the export adapters support, by their names', async () => {
    const { container } = await mountLoaded();
    const tiles = all(container, '#marketplaces .ld-market .ui-chip').map(t => t.textContent);
    expect(container.querySelector('#marketplaces button')).toBeNull();
    expect(tiles).toEqual(listAdapters().map(a => a.spec.name));
    expect(tiles).toHaveLength(10);
  });

  it('prices all eight tiers in one table with Pro featured', async () => {
    const { container } = await mountLoaded();
    const rows = all(container, '#pricing tbody tr');
    expect(rows.map(r => one(r, 'th').childNodes[0].textContent)).toEqual([
      'Free', 'Starter', 'Basic', 'Growth', 'Pro', 'Business', 'Scale', 'Enterprise',
    ]);
    const featured = all(container, '#pricing tr.is-featured');
    expect(featured).toHaveLength(1);
    expect(featured[0].textContent).toContain('Pro');
    expect(featured[0].textContent).toContain('$250');
    expect(featured[0].textContent).toContain('$175');
    expect(one(container, '#pricing').textContent).not.toMatch(/annual/i);
  });

  it('has six FAQ entries as native details', async () => {
    const { container } = await mountLoaded();
    expect(all(container, '#faq details')).toHaveLength(6);
    expect(all(container, '#faq details > summary')).toHaveLength(6);
  });

  it('footer carries the descriptor and the bottom line', async () => {
    const { container } = await mountLoaded();
    const footer = one(container, 'footer.ld-footer');
    expect(footer.textContent).toContain(BRAND_DESCRIPTOR);
    expect(footer.textContent).toContain(`© 2026 ${BRAND}. Served from arcadian.ltd.`);
    expect(all(footer, 'a[href^="#"]').map(a => a.getAttribute('href'))).toEqual(
      ['#how', '#demo', '#pricing', '#faq', '#signup'],
    );
  });
});

describe('Landing copy rules', () => {
  afterEach(() => { cleanup(); });

  it('never says AI and contains no em dash', async () => {
    const { container } = await mountLoaded();
    const copy = visibleCopy(container);
    expect(copy).not.toMatch(/\bAI\b/);
    // The em dash check is on what a visitor SEES. The real PhoneStepper in
    // the step 2 preview carries a screen reader only position string of its
    // own (app copy, visually hidden, and inside an aria-hidden preview).
    const seen = container.cloneNode(true) as HTMLElement;
    seen.querySelectorAll('.phone-stepper-sr, .ui-sr-only').forEach(el => el.remove());
    expect(visibleCopy(seen)).not.toContain('\u2014');
  });

  it('makes none of the banned claims', async () => {
    const { container } = await mountLoaded();
    const copy = visibleCopy(container).toLowerCase();
    for (const banned of ['vision', 'neural', 'scan', 'one click', '1 click', '1-click', 'delist', 'testimonial', '10x']) {
      expect(copy, banned).not.toContain(banned);
    }
  });
});

describe('Landing beta form', () => {
  afterEach(() => { cleanup(); vi.mocked(requestBetaAccess).mockReset(); vi.mocked(track).mockReset(); });

  it('submits to requestBetaAccess and tracks the signup', async () => {
    vi.mocked(requestBetaAccess).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof requestBetaAccess>>);
    const { container } = await mountLoaded();
    const form = one(container, '#signup form') as HTMLFormElement;
    (one(form, 'input[name="org_name"]') as HTMLInputElement).value = 'Rack City';
    (one(form, 'input[name="contact_name"]') as HTMLInputElement).value = 'Sam';
    (one(form, 'input[name="email"]') as HTMLInputElement).value = 'Sam@Shop.com';
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(requestBetaAccess).toHaveBeenCalledWith(expect.objectContaining({
      org_name: 'Rack City', contact_name: 'Sam', email: 'sam@shop.com',
    }));
    expect(track).toHaveBeenCalledWith('Beta Signup');
  });
});

describe('Landing document title', () => {
  afterEach(() => {
    cleanup();
    document.title = '';
  });

  it('sets a descriptive title under 60 characters on mount', () => {
    document.title = BRAND;
    mount(<Landing onLoginClick={() => {}} />);
    expect(document.title).toBe(LANDING_TITLE);
    expect(document.title.length).toBeLessThan(60);
  });

  it('restores the previous title on unmount', () => {
    document.title = BRAND;
    const view = mount(<Landing onLoginClick={() => {}} />);
    view.unmount();
    expect(document.title).toBe(BRAND);
  });
});
