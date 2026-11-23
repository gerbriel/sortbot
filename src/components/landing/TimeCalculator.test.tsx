import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import TimeCalculator from './TimeCalculator';
import { mount, cleanup, all, one } from '../ui/testUtils';

/** Sets a value the way React's onChange sees it (the native setter + an input event). */
function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function blur(el: HTMLInputElement) {
  act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

const out = (c: HTMLElement, id: string) => one(c, `[data-testid="${id}"]`).textContent;

describe('TimeCalculator', () => {
  afterEach(() => cleanup());

  it('shows the defaults', () => {
    const { container } = mount(<TimeCalculator />);
    expect(out(container, 'ltc-today')).toBe('34.7');
    expect(out(container, 'ltc-sqrl')).toBe('8.7');
    expect(out(container, 'ltc-reclaimed')).toBe('26.0');
    expect(out(container, 'ltc-extra')).toBe('520');
    expect(container.textContent).toContain('Estimates from your own numbers. Nothing here is measured from other shops.');
    expect(container.textContent).toContain('Your estimate; dictating a listing takes most people a few minutes.');
    expect(container.textContent).not.toMatch(/\$|\bAI\b|\u2014/);
    // The page owns the section heading.
    expect(container.querySelector('h1, h2')).toBeNull();
    expect(container.textContent).not.toContain('What the typing costs you');
  });

  it('binds each slider to its number field, both ways', () => {
    const { container } = mount(<TimeCalculator />);
    const [listingsRange, minutesRange] = all(container, 'input[type="range"]') as HTMLInputElement[];
    const [listingsField, minutesField, sqrlField] = all(container, 'input[type="number"]') as HTMLInputElement[];

    type(listingsRange, '100');
    expect(listingsField.value).toBe('100');
    expect(out(container, 'ltc-today')).toBe('86.7'); // 100 * 52/12 * 12 / 60

    type(minutesField, '20');
    expect(minutesRange.value).toBe('20');

    type(sqrlField, '5');
    // 100 a week, 20 today, 5 with: 433.33 listings, 6500 reclaimed minutes
    expect(out(container, 'ltc-reclaimed')).toBe('108.3');
    expect(out(container, 'ltc-extra')).toBe('1,300');
  });

  it('lets a field be typed through an out-of-range value and clamps it on blur', () => {
    const { container } = mount(<TimeCalculator />);
    const listingsField = all(container, 'input[type="number"]')[0] as HTMLInputElement;
    const listingsRange = all(container, 'input[type="range"]')[0] as HTMLInputElement;
    type(listingsField, '');
    expect(listingsField.value).toBe('');
    expect(out(container, 'ltc-today')).toBe('34.7'); // unchanged while empty
    type(listingsField, '900');
    blur(listingsField);
    expect(listingsField.value).toBe('300');
    expect(listingsRange.value).toBe('300');
  });
});
