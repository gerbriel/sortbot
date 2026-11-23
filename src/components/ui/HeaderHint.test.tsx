import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { HeaderHint } from './HeaderHint';
import { mount, cleanup, click, keyDown, one, focusElement } from './testUtils';

/**
 * HeaderHint is the column-header explanation: label text, an info button and
 * a tooltip. Locked here: the ARIA wiring, the three ways it opens (hover,
 * focus, click or tap) and the ways it closes (a second click, Escape, blur).
 */

afterEach(cleanup);

function setup(align?: 'start' | 'end') {
  return mount(
    <table>
      <thead>
        <tr>
          <th scope="col">
            <HeaderHint label="What Order means" hint="Lowest first." align={align}>Order</HeaderHint>
          </th>
          <th scope="col"><button type="button">Elsewhere</button></th>
        </tr>
      </thead>
    </table>,
  );
}

const btn = (c: HTMLElement) => one(c, 'button[aria-label="What Order means"]');
const tip = (c: HTMLElement) => one(c, '[role="tooltip"]');

const hover = (el: HTMLElement, type: 'mouseover' | 'mouseout', related: Element | null = null) => {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: related }));
  });
};

describe('HeaderHint', () => {
  it('renders the header text, then a labelled info button', () => {
    const { container } = setup();
    const root = one(container, '.ui-header-hint');
    expect(one(root, '.ui-header-hint__text').textContent).toBe('Order');
    const b = btn(container);
    expect(b.getAttribute('type')).toBe('button');
    expect(b.querySelector('svg')).not.toBeNull();
    // No native title: the tooltip is the one explanation on hover.
    expect(b.getAttribute('title')).toBe('');
  });

  it('wires the tooltip to the button with aria-describedby, hidden until asked', () => {
    const { container } = setup();
    const t = tip(container);
    expect(t.id).not.toBe('');
    expect(btn(container).getAttribute('aria-describedby')).toBe(t.id);
    expect(t.textContent).toBe('Lowest first.');
    expect(t.hidden).toBe(true);
  });

  it('opens on hover and closes when the pointer leaves', () => {
    const { container } = setup();
    const root = one(container, '.ui-header-hint');
    hover(root, 'mouseover', document.body);
    expect(tip(container).hidden).toBe(false);
    hover(root, 'mouseout', document.body);
    expect(tip(container).hidden).toBe(true);
  });

  it('opens on focus and closes on blur', () => {
    const { container } = setup();
    focusElement(btn(container));
    expect(tip(container).hidden).toBe(false);
    const other = one(container, 'button:not([aria-label])');
    focusElement(other);
    expect(tip(container).hidden).toBe(true);
  });

  it('a click or tap toggles it, and a pinned tooltip survives the pointer leaving', () => {
    const { container } = setup();
    const root = one(container, '.ui-header-hint');
    click(btn(container));
    expect(tip(container).hidden).toBe(false);
    hover(root, 'mouseout', document.body);
    expect(tip(container).hidden).toBe(false);
    click(btn(container));
    expect(tip(container).hidden).toBe(true);
  });

  it('Escape closes it and does not reach a page-level Escape listener', () => {
    const { container } = setup();
    const onPageKey = vi.fn();
    document.addEventListener('keydown', onPageKey);
    try {
      click(btn(container));
      expect(tip(container).hidden).toBe(false);
      keyDown('Escape', btn(container));
      expect(tip(container).hidden).toBe(true);
      expect(onPageKey).not.toHaveBeenCalled();
      // A closed hint lets Escape through to the page again.
      keyDown('Escape', btn(container));
      expect(onPageKey).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', onPageKey);
    }
  });

  it('align="end" hangs the tooltip from the right edge', () => {
    const { container } = setup('end');
    expect(tip(container).className).toContain('ui-header-hint__tip--end');
    cleanup();
    const again = setup();
    expect(tip(again.container).className).toContain('ui-header-hint__tip--start');
  });
});
