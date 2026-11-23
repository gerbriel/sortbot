import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import LandingDemo from './LandingDemo';
import { DEMO_SAMPLES, STEP_DELAY_MS } from './demoPipeline';
import { mount, cleanup, click, all, one, buttonByText } from '../ui/testUtils';

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => ({
      matches: reduce && q.includes('prefers-reduced-motion'),
      media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
}

/** Lets runDemo's promise resolve and React commit the result. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

const visibleSteps = (c: HTMLElement) => all(c, '.ldd-step[data-visible="true"]').length;

describe('LandingDemo', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('reveals the four steps 250 ms apart, and disables Replay until done', async () => {
    setReducedMotion(false);
    const { container } = mount(<LandingDemo />);
    expect(visibleSteps(container)).toBe(0);
    await settle();
    expect(visibleSteps(container)).toBe(1);
    expect((buttonByText(container, 'Replay') as HTMLButtonElement).disabled).toBe(true);
    for (let n = 2; n <= 4; n++) {
      act(() => { vi.advanceTimersByTime(STEP_DELAY_MS); });
      expect(visibleSteps(container)).toBe(n);
    }
    expect((buttonByText(container, 'Replay') as HTMLButtonElement).disabled).toBe(false);

    click(buttonByText(container, 'Replay'));
    await settle();
    expect(visibleSteps(container)).toBe(1);
  });

  it('shows everything at once under prefers-reduced-motion', async () => {
    setReducedMotion(true);
    const { container } = mount(<LandingDemo />);
    await settle();
    expect(visibleSteps(container)).toBe(4);
  });

  it('starts at the controls: the page owns the section heading', () => {
    setReducedMotion(true);
    const { container } = mount(<LandingDemo />);
    expect(container.querySelector('h1, h2')).toBeNull();
    expect(container.textContent).not.toContain('See a listing come together');
    expect((container.firstElementChild as HTMLElement).firstElementChild?.className).toBe('ldd-controls');
  });

  it('renders a real title and description for every sample, with no "AI" and no em dash', async () => {
    setReducedMotion(true);
    const { container } = mount(<LandingDemo />);
    await settle();
    for (const s of DEMO_SAMPLES) {
      click(buttonByText(container, s.name));
      await settle();
      const chip = buttonByText(container, s.name);
      expect(chip.getAttribute('aria-pressed')).toBe('true');
      expect(one(container, '[data-testid="ldd-title"]').textContent?.trim().length).toBeGreaterThan(10);
      expect(one(container, '[data-testid="ldd-description"]').textContent?.trim().length).toBeGreaterThan(40);
      expect(all(container, '.ldd-kw').length).toBeGreaterThan(3);
      expect(all(container, '.ui-fieldcell input[readonly]').length).toBeGreaterThan(3);
      expect(one(container, '[data-testid="ldd-csv"]').textContent).toContain('Variant Price');

      const text = container.textContent ?? '';
      expect(text).not.toMatch(/\bAI\b/);
      expect(text).not.toMatch(/\b(vision|neural|scan|scanning)\b/i);
      expect(text).not.toContain('\u2014');
      const values = all(container, 'input').map((i) => (i as HTMLInputElement).value).join(' ');
      expect(values).not.toContain('\u2014');
    }
    expect(container.textContent).toContain('Same input, same listing, every time. There is no model guessing.');
  });
});
