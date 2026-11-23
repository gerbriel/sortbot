import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { ComprehensiveProductForm } from './ComprehensiveProductForm';
import { mount, cleanup, one, all } from './ui/testUtils';
import type { ClothingItem } from '../App';

function makeItem(over: Record<string, unknown> = {}): ClothingItem {
  return {
    id: 'a', productGroup: 'a', preview: '', imageUrls: [],
    brand: 'Nike', size: 'L', color: 'Black', price: 40,
    measurements: { width: '22' },
    _presetData: { displayName: 'Tees', measurementTemplate: { width: true, length: true } },
    ...over,
  } as unknown as ClothingItem;
}

function render(item = makeItem()) {
  const setProcessedItems = vi.fn();
  const onBrandEdited = vi.fn();
  const m = mount(
    <ComprehensiveProductForm
      currentItem={item}
      currentGroup={[item]}
      processedItems={[item]}
      setProcessedItems={setProcessedItems}
      onBrandEdited={onBrandEdited}
      brandExtra={<div data-k="brand-extra">spelling</div>}
    />,
  );
  return { ...m, item, setProcessedItems, onBrandEdited };
}

/** A label's own text, without the required asterisk and its hidden words. */
function labelText(label: Element): string {
  const copy = label.cloneNode(true) as Element;
  copy.querySelectorAll('.field-required-star, .ui-sr-only').forEach(n => n.remove());
  return copy.textContent ?? '';
}

/** The control a visible label points at. */
function controlFor(container: HTMLElement, text: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const label = all(container, 'label').find(l => labelText(l) === text);
  if (!label) throw new Error(`no label "${text}"`);
  const id = label.getAttribute('for');
  if (!id) throw new Error(`label "${text}" has no for`);
  const el = document.getElementById(id);
  if (!el) throw new Error(`label "${text}" points at nothing`);
  return el as HTMLInputElement;
}

/** Changes a controlled control the way React sees it. */
function change(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function blur(el: HTMLElement) {
  act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

// Label -> [the field path updateGroupField writes, a value to enter, what lands].
// The paths are the ones the form wrote before the labelled-cell restyle.
const FIELDS: Array<[string, string, string, unknown]> = [
  ['Price ($)', 'price', '49.99', 49.99],
  ['Compare-at price ($)', 'compareAtPrice', '60', 60],
  ['Cost per item ($)', 'costPerItem', '5', 5],
  ['Brand', 'brand', 'Adidas', 'Adidas'],
  ['Size', 'size', 'M', 'M'],
  ['Condition', 'condition', 'Good', 'Good'],
  ['Color', 'color', 'Blue', 'Blue'],
  ['Secondary color', 'secondaryColor', 'White', 'White'],
  ['Material', 'material', 'Cotton', 'Cotton'],
  ['Era or vibe', 'era', '90s', '90s'],
  ['Style', 'style', 'Streetwear', 'Streetwear'],
  ['Gender', 'gender', 'Women', 'Women'],
  ['Type (garment)', 'productType', 'Hoodie', 'Hoodie'],
  ['Model name', 'modelName', '501', '501'],
  ['Flaws (if any)', 'flaws', 'pilling', 'pilling'],
  ['Tags (comma-separated)', 'tags', 'a, b', ['a', 'b']],
  ['SEO title', 'seoTitle', 'Vintage tee', 'Vintage tee'],
  ['Care instructions', 'care', 'Cold wash', 'Cold wash'],
  ['Width', 'measurements.width', '23', '23'],
  ['Length', 'measurements.length', '28', '28'],
  ['Sleeve', 'measurements.sleeve', '24', '24'],
  ['Shoulder', 'measurements.shoulder', '18', '18'],
  ['Waist', 'measurements.waist', '32', '32'],
  ['Inseam', 'measurements.inseam', '30', '30'],
  ['Rise', 'measurements.rise', '11', '11'],
  ['SKU', 'sku', 'SKU-1', 'SKU-1'],
  ['Inventory quantity', 'inventoryQuantity', '3', 3],
  ['Weight (grams)', 'weightValue', '350', '350'],
  ['Ships from', 'shipsFrom', 'Fresno', 'Fresno'],
  ['Parcel size', 'parcelSize', 'Small', 'Small'],
  ['Package dimensions', 'packageDimensions', '14 x 10 x 1 in', '14 x 10 x 1 in'],
  ['Requires shipping', 'requiresShipping', 'false', false],
  ['Status', 'status', 'Draft', 'Draft'],
  ['Published', 'published', 'false', false],
  ['Age group', 'ageGroup', 'Adult', 'Adult'],
  ['SEO description', 'seoDescription', 'Meta words', 'Meta words'],
  ['Size type', 'sizeType', 'Petite', 'Petite'],
];

function read(item: ClothingItem, path: string): unknown {
  const [a, b] = path.split('.');
  const top = (item as unknown as Record<string, unknown>)[a];
  return b ? (top as Record<string, unknown> | undefined)?.[b] : top;
}

describe('ComprehensiveProductForm layout', () => {
  afterEach(() => cleanup());

  it('renders five labelled-cell groups with sentence-case captions and no icons', () => {
    const { container } = render();
    expect(all(container, '.ui-fieldgroup__caption').map(c => c.textContent)).toEqual([
      'Pricing', 'Core details', 'Measurements (inches)', 'Inventory and shipping', 'Status and SEO',
    ]);
    for (const caption of all(container, '.ui-fieldgroup__caption')) {
      expect(caption.querySelector('svg')).toBeNull();
    }
    expect(container.querySelector('h3, .form-section-flat, .fields-row, .info-item, .info-input')).toBeNull();
  });

  it('every label reaches a control inside its own cell', () => {
    const { container } = render();
    const labels = all(container, 'label.ui-fieldcell__label');
    expect(labels.map(labelText)).toEqual(FIELDS.map(f => f[0]));
    for (const label of labels) {
      const control = controlFor(container, labelText(label));
      expect(control.classList.contains('ui-fieldcell__control')).toBe(true);
      expect(label.closest('.ui-fieldcell')?.contains(control)).toBe(true);
    }
  });

  it('SEO description spans two tracks', () => {
    const { container } = render();
    expect(controlFor(container, 'SEO description').closest('.ui-fieldcell')?.classList.contains('ui-fieldcell--span2')).toBe(true);
  });

  it('shows the preset and measurement-needed badges in the meta slot, and brandExtra under Brand', () => {
    const { container } = render();
    const brandCell = controlFor(container, 'Brand').closest('.ui-fieldcell') as HTMLElement;
    expect(one(brandCell, '.ui-fieldcell__meta .ui-badge').textContent).toContain('Preset');
    expect(one(brandCell, '.ui-fieldcell__footer [data-k="brand-extra"]').textContent).toBe('spelling');
    // Width is filled, Length is flagged by the preset and empty (Needed),
    // Sleeve is empty and not flagged (no meta at all: the asterisk and the
    // rule carry it).
    const meta = (label: string) => controlFor(container, label).closest('.ui-fieldcell')?.querySelector('.ui-fieldcell__meta');
    expect(meta('Width')).toBeNull();
    expect(meta('Length')?.textContent).toBe('Needed');
    expect(meta('Sleeve')).toBeNull();
  });

  it('marks every required field with a red asterisk and words for screen readers, filled or not', () => {
    const { container } = render(makeItem({ brand: '' }));
    const required = new Set(['Price ($)', 'Brand', 'Size', 'Condition', 'Color', 'Material', 'Era or vibe', 'Style',
      'Gender', 'Type (garment)', 'Model name', 'Flaws (if any)', 'Tags (comma-separated)', 'SEO title',
      'Care instructions', 'Width', 'Length', 'Sleeve', 'Shoulder', 'Waist', 'Inseam', 'Rise', 'SKU',
      'Weight (grams)', 'Ships from', 'Parcel size', 'Package dimensions', 'Age group', 'SEO description']);
    for (const [label] of FIELDS) {
      const el = all(container, 'label.ui-fieldcell__label').find(l => labelText(l) === label) as HTMLElement;
      const star = el.querySelector('.field-required-star');
      const control = controlFor(container, label);
      if (required.has(label)) {
        expect(star?.textContent).toBe('*');
        expect(star?.getAttribute('aria-hidden')).toBe('true');
        expect(el.querySelector('.ui-sr-only')?.textContent).toBe(' (required)');
        expect(control.getAttribute('aria-required')).toBe('true');
      } else {
        expect(star).toBeNull();
        expect(control.hasAttribute('aria-required')).toBe(false);
      }
    }
    // Filled (Color) and empty (Brand) required fields both carry the star.
    expect(controlFor(container, 'Color').closest('.ui-fieldcell')?.querySelector('.field-required-star')).not.toBeNull();
    expect(controlFor(container, 'Brand').closest('.ui-fieldcell')?.querySelector('.field-required-star')).not.toBeNull();
  });

  it('marks an empty required field with the class on its control and no "Required" word', () => {
    const { container } = render(makeItem({ brand: '', material: '' }));
    const brand = controlFor(container, 'Brand');
    expect(brand.classList.contains('field-required-empty')).toBe(true);
    expect(container.querySelector('.field-required-note')).toBeNull();
    expect(container.textContent).not.toContain('Required');
    // A filled field does not carry the empty class.
    expect(controlFor(container, 'Color').classList.contains('field-required-empty')).toBe(false);
    // A field outside the required set never carries it, even empty.
    expect(controlFor(container, 'Compare-at price ($)').classList.contains('field-required-empty')).toBe(false);
    // A preset badge needs a value, so an empty preset field has no meta.
    const material = controlFor(container, 'Material').closest('.ui-fieldcell') as HTMLElement;
    expect(material.querySelector('.ui-fieldcell__meta')).toBeNull();
  });
});

describe('ComprehensiveProductForm writes', () => {
  afterEach(() => cleanup());

  it.each(FIELDS)('%s writes %s', (label, path, value, expected) => {
    const { container, item, setProcessedItems } = render(makeItem({ requiresShipping: true, published: true }));
    change(controlFor(container, label), value);
    expect(setProcessedItems).toHaveBeenCalledTimes(1);
    const written = setProcessedItems.mock.calls[0][0] as ClothingItem[];
    expect(written[0].id).toBe(item.id);
    expect(read(written[0], path)).toEqual(expected);
  });

  it('normalises the size on blur', () => {
    const { container, setProcessedItems } = render(makeItem({ size: 'large' }));
    blur(controlFor(container, 'Size'));
    expect(setProcessedItems).toHaveBeenCalledTimes(1);
    expect((setProcessedItems.mock.calls[0][0] as ClothingItem[])[0].size).toBe('L');
  });

  it('leaves an already-normal size alone on blur', () => {
    const { container, setProcessedItems } = render(makeItem({ size: 'L' }));
    blur(controlFor(container, 'Size'));
    expect(setProcessedItems).not.toHaveBeenCalled();
  });

  it('reports a brand edit on blur', () => {
    const { container, onBrandEdited } = render();
    blur(controlFor(container, 'Brand'));
    expect(onBrandEdited).toHaveBeenCalledWith('Nike');
  });
});

describe('ComprehensiveProductForm SKU Generate', () => {
  function renderWith(item: ClothingItem, onGenerateSku?: () => void) {
    return mount(
      <ComprehensiveProductForm
        currentItem={item}
        currentGroup={[item]}
        processedItems={[item]}
        setProcessedItems={vi.fn()}
        onGenerateSku={onGenerateSku}
      />,
    );
  }
  const generate = (root: HTMLElement) => all(root, '.cpf-generate-sku');

  it('shows Generate in the SKU cell while the SKU is empty, and calls back', () => {
    const onGenerateSku = vi.fn();
    const { container } = renderWith(makeItem({ sku: '' }), onGenerateSku);
    const [btn] = generate(container);
    expect(btn.textContent).toBe('Generate');
    act(() => { btn.click(); });
    expect(onGenerateSku).toHaveBeenCalledTimes(1);
  });

  it('hides it once a SKU is present, and without a callback', () => {
    expect(generate(renderWith(makeItem({ sku: 'ACD-7K3Q9M' }), vi.fn()).container)).toHaveLength(0);
    cleanup();
    expect(generate(renderWith(makeItem({ sku: '' })).container)).toHaveLength(0);
  });
});
