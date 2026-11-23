import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import type { ComponentProps } from 'react';
import VoiceCommandTable from './VoiceCommandTable';
import { mount, cleanup, click, keyDown, focusElement, one, all } from './ui/testUtils';
import type { ClothingItem } from '../App';

const item = {
  id: 'a', productGroup: 'a', preview: '', imageUrls: [],
  brand: 'Nike', size: 'L', measurements: { chest: '22', leg_opening: '9' },
} as unknown as ClothingItem;

function render(props: Partial<ComponentProps<typeof VoiceCommandTable>> = {}) {
  const onChange = vi.fn();
  const m = mount(
    <VoiceCommandTable
      currentItem={item}
      isRecording={false}
      activeField={null}
      interimValue=""
      onChange={onChange}
      {...props}
    />,
  );
  return { ...m, onChange };
}

/** Types into a controlled input the way React sees it. */
function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function blur(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.blur();
  });
}

describe('VoiceCommandTable layout', () => {
  afterEach(() => cleanup());

  it('renders quiet sentence-case group captions, with no caption over Title and Description', () => {
    const { container } = render();
    const captions = all(container, '.vct-row-label').map(el => el.textContent);
    expect(captions).toEqual(['Core info', 'Style and details', 'Measurements']);
    const lead = one(container, '[data-group="lead"]');
    expect(lead.querySelector('.vct-row-label')).toBeNull();
    expect(lead.querySelector('.vct-grid--full')).not.toBeNull();
    expect(all(lead, '.vct-header').map(l => l.textContent)).toEqual(['Title', 'Description']);
  });

  it('merges the measurements into one group, top of the garment to the bottom, keys unchanged', () => {
    const { container } = render();
    const group = one(container, '[data-group="measurements"]');
    expect(all(group, '.vct-header').map(l => l.textContent)).toEqual([
      'Chest', 'Width', 'Length', 'Sleeve', 'Shoulder', 'Waist', 'Hip', 'Rise', 'Inseam', 'Outseam', 'Leg opening',
    ]);
    expect(all(group, '.vct-col').map(c => c.dataset.field)).toEqual([
      'meas_chest', 'meas_width', 'meas_length', 'meas_sleeve', 'meas_shoulder',
      'meas_waist', 'meas_hip', 'meas_rise', 'meas_inseam', 'meas_outseam', 'meas_leg',
    ]);
    expect((one(group, '#vct-meas_leg') as HTMLInputElement).value).toBe('9');
  });

  it('keeps every field: one labelled cell each, the label tied to its input', () => {
    const { container } = render();
    const keys = [
      'seoTitle', 'customDescription',
      'brand', 'size', 'color', 'secondaryColor', 'condition', 'price',
      'era', 'style', 'gender', 'material', 'tags', 'flaws', 'care',
      'meas_chest', 'meas_width', 'meas_length', 'meas_sleeve', 'meas_shoulder',
      'meas_waist', 'meas_hip', 'meas_rise', 'meas_inseam', 'meas_outseam', 'meas_leg',
    ];
    expect(all(container, '.vct-col').map(c => c.dataset.field)).toEqual(keys);
    for (const key of keys) {
      const cell = one(container, `.vct-col[data-field="${key}"]`);
      const label = one(cell, 'label.vct-header');
      const input = one(cell, 'input.vct-cell') as HTMLInputElement;
      expect(label.getAttribute('for')).toBe(input.id);
    }
    const empty = one(container, '#vct-color') as HTMLInputElement;
    expect(empty.value).toBe('');
    expect(empty.placeholder).toBe('Blue');
  });
});

describe('VoiceCommandTable editing', () => {
  afterEach(() => cleanup());

  it('does not write while typing; Enter commits once', () => {
    const { container, onChange } = render();
    const input = one(container, '#vct-brand') as HTMLInputElement;
    focusElement(input);
    type(input, 'Adidas');
    expect(input.value).toBe('Adidas');
    expect(onChange).not.toHaveBeenCalled();
    keyDown('Enter', input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('brand', 'Adidas');
  });

  it('Escape reverts the draft and writes nothing, even after leaving the cell', () => {
    const { container, onChange } = render();
    const input = one(container, '#vct-size') as HTMLInputElement;
    focusElement(input);
    type(input, 'XXL');
    keyDown('Escape', input);
    expect(input.value).toBe('L');
    blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('leaving a cell (Tab or a click elsewhere) commits the draft', () => {
    const { container, onChange } = render();
    const input = one(container, '#vct-era') as HTMLInputElement;
    focusElement(input);
    type(input, '90s');
    blur(input);
    expect(onChange).toHaveBeenCalledWith('era', '90s');
  });

  it('an unchanged cell commits nothing', () => {
    const { container, onChange } = render();
    const input = one(container, '#vct-brand') as HTMLInputElement;
    focusElement(input);
    keyDown('Enter', input);
    blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clicking anywhere in a cell focuses its input', () => {
    const { container } = render();
    const cell = one(container, '.vct-col[data-field="price"]');
    click(cell);
    expect(document.activeElement).toBe(one(cell, 'input'));
  });

  it('key events never bubble out of a cell', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const { container } = render();
    keyDown('.', one(container, '#vct-brand'));
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });
});

describe('VoiceCommandTable drafts without a blur', () => {
  afterEach(() => cleanup());

  it('unmounting with a dirty draft writes it once', () => {
    const onChange = vi.fn();
    const m = mount(
      <VoiceCommandTable currentItem={item} isRecording={false} activeField={null} interimValue="" onChange={onChange} />,
    );
    const input = one(m.container, '#vct-brand') as HTMLInputElement;
    focusElement(input);
    type(input, 'Adidas');
    m.unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('brand', 'Adidas');
  });

  it('unmounting with a clean draft writes nothing', () => {
    const onChange = vi.fn();
    const m = mount(
      <VoiceCommandTable currentItem={item} isRecording={false} activeField={null} interimValue="" onChange={onChange} />,
    );
    focusElement(one(m.container, '#vct-brand'));
    m.unmount();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a new item id with a dirty draft writes once, through the OLD item, and never to the new one', () => {
    // Each render gets its own onChange, standing in for PDG's handler that
    // closes over the listing it was rendered for.
    const writesA = vi.fn();
    const writesB = vi.fn();
    const itemB = { ...item, id: 'b', productGroup: 'b', brand: 'Levi' } as unknown as ClothingItem;
    const m = mount(
      <VoiceCommandTable currentItem={item} isRecording={false} activeField={null} interimValue="" onChange={writesA} />,
    );
    const input = one(m.container, '#vct-brand') as HTMLInputElement;
    focusElement(input);
    type(input, 'Adidas');
    m.rerender(
      <VoiceCommandTable currentItem={itemB} isRecording={false} activeField={null} interimValue="" onChange={writesB} />,
    );
    expect(writesA).toHaveBeenCalledTimes(1);
    expect(writesA).toHaveBeenCalledWith('brand', 'Adidas');
    expect(writesB).not.toHaveBeenCalled();
    // The new listing's own value shows, and leaving the cell writes nothing more.
    expect((one(m.container, '#vct-brand') as HTMLInputElement).value).toBe('Levi');
    blur(input);
    m.unmount();
    expect(writesA).toHaveBeenCalledTimes(1);
    expect(writesB).not.toHaveBeenCalled();
  });
});

describe('VoiceCommandTable dictation', () => {
  afterEach(() => cleanup());

  it('marks only the active cell while recording and shows the interim words in its value slot', () => {
    const { container } = render({ isRecording: true, activeField: 'color', interimValue: 'forest gr' });
    const active = all(container, '.vct-col--active');
    expect(active.map(c => c.dataset.field)).toEqual(['color']);
    const input = one(active[0], 'input') as HTMLInputElement;
    expect(input.value).toBe('forest gr');
    expect(input.classList.contains('vct-cell--listening')).toBe(true);
    expect(one(container, '.vct-status').textContent).toContain('Listening for color');
  });

  it('is not marked when not recording', () => {
    const { container } = render({ isRecording: false, activeField: 'color', interimValue: 'forest' });
    expect(container.querySelector('.vct-col--active')).toBeNull();
    expect((one(container, '#vct-color') as HTMLInputElement).value).toBe('');
  });

  it("a user's draft in the active cell wins over the interim words", () => {
    const { container } = render({ isRecording: true, activeField: 'brand', interimValue: 'nik' });
    const input = one(container, '#vct-brand') as HTMLInputElement;
    focusElement(input);
    type(input, 'Nike SB');
    expect(input.value).toBe('Nike SB');
  });
});
