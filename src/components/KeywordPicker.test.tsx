import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { KeywordPicker } from './KeywordPicker';
import type { KeywordEntry } from './KeywordPicker';
import { mount, cleanup, one, all, click, keyDown, focusElement } from './ui/testUtils';

afterEach(cleanup);

const words = (...ws: string[]): KeywordEntry[] => ws.map(w => ({ label: w, output: w }));

/** Type into a React-controlled input the way the browser does. */
function type(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const optionTexts = (c: HTMLElement) =>
  all(c, '[role="option"]').map(o => (o.querySelector('.kwp-option-label')?.textContent ?? o.textContent ?? '').trim());

/** A harness that owns a description string, like PDG does. */
function Harness({ entries, suggested = [], initial = [], spy }: {
  entries: KeywordEntry[]; suggested?: string[]; initial?: string[]; spy?: (kw: string) => void;
}) {
  const [applied, setApplied] = useState<string[]>(initial);
  return (
    <KeywordPicker
      entries={entries}
      isSuggested={e => suggested.includes(e.output)}
      isApplied={kw => applied.some(a => a.toLowerCase() === kw.toLowerCase())}
      onToggle={kw => {
        spy?.(kw);
        setApplied(prev => prev.some(a => a.toLowerCase() === kw.toLowerCase())
          ? prev.filter(a => a.toLowerCase() !== kw.toLowerCase())
          : [...prev, kw]);
      }}
    />
  );
}

function setup(props: Parameters<typeof Harness>[0]) {
  const m = mount(<Harness {...props} />);
  const input = one(m.container, 'input') as HTMLInputElement;
  return { ...m, input };
}

describe('KeywordPicker: combobox wiring', () => {
  it('is a labelled combobox that controls a listbox', () => {
    const { container, input } = setup({ entries: words('vintage', 'rare') });
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.placeholder).toBe('Add a keyword');
    const label = one(container, 'label');
    expect(label.textContent).toBe('Keywords');
    expect(label.getAttribute('for')).toBe(input.id);
    const list = one(container, '[role="listbox"]');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    focusElement(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('KeywordPicker: filtering and ordering', () => {
  it('filters case-insensitively, prefix matches before substring matches', () => {
    const { container, input } = setup({ entries: words('faded', 'Fade wash', 'deadstock', 'rare') });
    focusElement(input);
    type(input, 'FAD');
    // "deadstock" does not contain "fad"; "faded" and "Fade wash" are prefixes.
    expect(optionTexts(container)).toEqual(['faded', 'Fade wash', 'Add “FAD”']);
    type(input, 'ade');
    expect(optionTexts(container)).toEqual(['faded', 'Fade wash', 'Add “ade”']);
  });

  it('puts suggested entries first and tags them quietly', () => {
    const { container, input } = setup({
      entries: words('red tab', 'redline', 'big red'),
      suggested: ['big red'],
    });
    focusElement(input);
    type(input, 'red');
    expect(optionTexts(container).slice(0, 3)).toEqual(['big red', 'red tab', 'redline']);
    const first = all(container, '[role="option"]')[0];
    expect(one(first, '.kwp-tag').textContent).toBe('suggested');
    expect(first.querySelector('svg')).toBeNull();
  });

  it('caps results at 8', () => {
    const many = words(...Array.from({ length: 20 }, (_, i) => `blue ${i}`));
    const { container, input } = setup({ entries: many });
    focusElement(input);
    type(input, 'blue');
    expect(all(container, '.kwp-option:not(.kwp-option--custom):not(.kwp-option--browse)')).toHaveLength(8);
  });

  it('with an empty field shows the suggestions, or the first 8 when there are none', () => {
    const many = words(...Array.from({ length: 12 }, (_, i) => `kw${i}`));
    const a = setup({ entries: many, suggested: ['kw5', 'kw9'] });
    focusElement(a.input);
    expect(optionTexts(a.container)).toEqual(['kw5', 'kw9', 'Browse all (12)']);
    cleanup();

    const b = setup({ entries: many });
    focusElement(b.input);
    expect(optionTexts(b.container)).toEqual([
      'kw0', 'kw1', 'kw2', 'kw3', 'kw4', 'kw5', 'kw6', 'kw7', 'Browse all (12)',
    ]);
  });

  it('Browse all expands to the full set', () => {
    const many = words(...Array.from({ length: 12 }, (_, i) => `kw${i}`));
    const { container, input } = setup({ entries: many });
    focusElement(input);
    click(all(container, '.kwp-option--browse')[0]);
    expect(all(container, '.kwp-option')).toHaveLength(12);
    expect(container.querySelector('.kwp-option--browse')).toBeNull();
    expect(one(container, '[role="listbox"]').classList.contains('kwp-list--all')).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});

describe('KeywordPicker: applying', () => {
  it('Enter applies the highlighted entry, clears the field and keeps focus', () => {
    const spy = vi.fn();
    const { container, input } = setup({ entries: words('vintage', 'varsity'), spy });
    focusElement(input);
    type(input, 'v');
    expect(input.getAttribute('aria-activedescendant')).toBe(all(container, '[role="option"]')[0].id);
    keyDown('ArrowDown', input);
    const second = all(container, '[role="option"]')[1];
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(second.id);
    keyDown('Enter', input);
    expect(spy).toHaveBeenCalledWith('varsity');
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('ArrowUp moves the highlight back', () => {
    const spy = vi.fn();
    const { input } = setup({ entries: words('vintage', 'varsity'), spy });
    focusElement(input);
    type(input, 'v');
    keyDown('ArrowDown', input);
    keyDown('ArrowUp', input);
    keyDown('Enter', input);
    expect(spy).toHaveBeenCalledWith('vintage');
  });

  it('Enter on unmatched text applies it as a custom keyword and clears', () => {
    const spy = vi.fn();
    const { container, input } = setup({ entries: words('vintage'), spy });
    focusElement(input);
    type(input, 'chain stitch');
    keyDown('Enter', input);
    expect(spy).toHaveBeenCalledWith('chain stitch');
    expect(input.value).toBe('');
    // The custom keyword is now in the description, so it renders as a chip.
    expect(one(container, '.kwp-applied').textContent).toContain('chain stitch');
  });

  it('click applies an option', () => {
    const spy = vi.fn();
    const { container, input } = setup({ entries: words('vintage', 'rare'), spy });
    focusElement(input);
    click(all(container, '[role="option"]')[1]);
    expect(spy).toHaveBeenCalledWith('rare');
  });

  it('an applied entry shows a check, and selecting it removes it', () => {
    const spy = vi.fn();
    const { container, input } = setup({ entries: words('vintage', 'rare'), initial: ['rare'], spy });
    focusElement(input);
    const rare = all(container, '[role="option"]')[1];
    expect(rare.querySelector('.kwp-check svg')).not.toBeNull();
    click(rare);
    expect(spy).toHaveBeenCalledWith('rare');
    expect(all(container, '[role="option"]')[1].querySelector('.kwp-check svg')).toBeNull();
    expect(container.querySelector('.kwp-applied')).toBeNull();
  });
});

describe('KeywordPicker: closing', () => {
  it('Escape closes the list', () => {
    const { input } = setup({ entries: words('vintage') });
    focusElement(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    keyDown('Escape', input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('Tab closes without applying', () => {
    const spy = vi.fn();
    const { input } = setup({ entries: words('vintage'), spy });
    focusElement(input);
    type(input, 'vin');
    keyDown('Tab', input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(spy).not.toHaveBeenCalled();
  });

  it('a click outside closes the list', () => {
    const { input } = setup({ entries: words('vintage') });
    focusElement(input);
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('KeywordPicker: applied chips', () => {
  it('renders nothing but the input when none are applied', () => {
    const { container } = setup({ entries: words('vintage', 'rare') });
    expect(container.querySelector('.kwp-applied')).toBeNull();
  });

  it('renders only the applied keywords, each with a labelled remove button', () => {
    const spy = vi.fn();
    const { container } = setup({ entries: words('vintage', 'rare', 'y2k'), initial: ['vintage', 'y2k'], spy });
    const chips = one(container, '.kwp-applied');
    expect(chips.textContent).toContain('vintage');
    expect(chips.textContent).toContain('y2k');
    expect(chips.textContent).not.toContain('rare');
    const remove = one(chips, 'button[aria-label="Remove keyword y2k"]');
    click(remove);
    expect(spy).toHaveBeenCalledWith('y2k');
    expect(one(container, '.kwp-applied').textContent).not.toContain('y2k');
  });
});

describe('KeywordPicker: copy', () => {
  it('renders no em dashes', () => {
    const many = words(...Array.from({ length: 12 }, (_, i) => `kw${i}`));
    const { container, input } = setup({ entries: many, suggested: ['kw1'], initial: ['kw2'] });
    focusElement(input);
    click(one(container, '.kwp-option--browse'));
    type(input, 'zzz');
    // Written as an escape so this file contains no em dash itself.
    expect(container.innerHTML).not.toContain(String.fromCharCode(0x2014));
  });
});
