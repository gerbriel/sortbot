import { describe, it, expect, afterEach, vi } from 'vitest';
import { InfoDisclosure } from './InfoDisclosure';
import { mount, cleanup, click, keyDown, one, focusElement } from './testUtils';

/**
 * InfoDisclosure is the inline "i" help: a button that expands a panel in
 * place. Locked here: the ARIA wiring, both close paths (second click and
 * Escape from inside), and that focus always lands back on the button.
 */

afterEach(cleanup);

function setup(onOpenChange?: (open: boolean) => void) {
  return mount(
    <InfoDisclosure
      label="How it works"
      heading={<strong>Title</strong>}
      actions={<button type="button">Other</button>}
      onOpenChange={onOpenChange}
    >
      <p>Help text</p>
      <a href="#x">A link inside</a>
    </InfoDisclosure>,
  );
}

const btn = (c: HTMLElement) => one(c, 'button[aria-label="How it works"]');
const panel = (c: HTMLElement) => one(c, '[role="region"]');

describe('InfoDisclosure', () => {
  it('starts closed with a labelled button wired to the panel', () => {
    const { container } = setup();
    const b = btn(container);
    const p = panel(container);
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(b.getAttribute('aria-controls')).toBe(p.id);
    expect(p.id).not.toBe('');
    expect(p.hidden).toBe(true);
    expect(p.getAttribute('aria-label')).toBe('How it works');
    expect(b.querySelector('svg')).not.toBeNull();
  });

  it('renders the heading and actions in the header row', () => {
    const { container } = setup();
    const head = one(container, '.ui-info-disclosure__head');
    expect(head.textContent).toContain('Title');
    expect(head.textContent).toContain('Other');
  });

  it('a click opens the panel and a second click closes it', () => {
    const onOpenChange = vi.fn();
    const { container } = setup(onOpenChange);
    click(btn(container));
    expect(btn(container).getAttribute('aria-expanded')).toBe('true');
    expect(panel(container).hidden).toBe(false);
    expect(panel(container).textContent).toContain('Help text');
    click(btn(container));
    expect(btn(container).getAttribute('aria-expanded')).toBe('false');
    expect(panel(container).hidden).toBe(true);
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    expect(document.activeElement).toBe(btn(container));
  });

  it('Escape from inside the panel closes it and returns focus to the button', () => {
    const { container } = setup();
    click(btn(container));
    const link = one(container, 'a');
    focusElement(link);
    expect(document.activeElement).toBe(link);
    keyDown('Escape', link);
    expect(panel(container).hidden).toBe(true);
    expect(btn(container).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn(container));
  });

  it('Escape is not swallowed while closed', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const { container } = setup();
    keyDown('Escape', btn(container));
    expect(outer).toHaveBeenCalledTimes(1);
    click(btn(container));
    keyDown('Escape', btn(container));
    // React handles the open-state Escape and stops it at the component.
    expect(outer).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outer);
  });

  it('defaultOpen starts expanded', () => {
    const { container } = mount(
      <InfoDisclosure label="Help" heading="T" defaultOpen>body</InfoDisclosure>,
    );
    expect(one(container, 'button').getAttribute('aria-expanded')).toBe('true');
    expect(panel(container).hidden).toBe(false);
  });
});
