import { describe, it, expect, afterEach, vi } from 'vitest';
import { Field, TextField, TextareaField, SelectField } from './Field';
import { mount, cleanup, one } from './testUtils';

/**
 * Field exists for one reason: the id wiring. Across the app, inputs were
 * labelled by adjacency (a `<span>` next to an `<input>`), which reads as an
 * unlabelled control to a screen reader and does not focus the input on click.
 * Every assertion here is about that wiring, because it is invisible.
 */

afterEach(cleanup);

/** Resolves aria-describedby into the text a screen reader would actually read. */
function describedText(control: HTMLElement): string {
  const ids = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' | ');
}

describe('Field — label wiring', () => {
  it('points the label at the control it labels', () => {
    const { container } = mount(
      <Field label="Store domain">{(f) => <input {...f} />}</Field>,
    );
    const label = one(container, 'label');
    const input = one(container, 'input');

    expect(input.id).toBeTruthy();
    // htmlFor is what makes a click on the label focus the input, and what
    // gives the control its accessible name.
    expect(label.getAttribute('for')).toBe(input.id);
    expect(label.textContent).toContain('Store domain');
  });

  it('generates a distinct id per instance, so two fields never collide', () => {
    const { container } = mount(
      <div>
        <TextField label="First" />
        <TextField label="Second" />
      </div>,
    );
    const [a, b] = Array.from(container.querySelectorAll('input'));
    expect(a.id).not.toBe(b.id);
    expect(container.querySelectorAll('label')[0].getAttribute('for')).toBe(a.id);
    expect(container.querySelectorAll('label')[1].getAttribute('for')).toBe(b.id);
  });

  it('labelHidden keeps the label in the accessibility tree', () => {
    const { container } = mount(<TextField label="Search" labelHidden />);
    const label = one(container, 'label');
    // .ui-sr-only, not display:none — hidden text is still an accessible name.
    expect(label.className).toContain('ui-sr-only');
    expect(label.getAttribute('for')).toBe(one(container, 'input').id);
  });
});

describe('Field — hint / error / required', () => {
  it('describes the control with its hint', () => {
    const { container } = mount(<TextField label="Domain" hint="myshop.myshopify.com" />);
    expect(describedText(one(container, 'input'))).toBe('myshop.myshopify.com');
  });

  it('marks the control invalid and describes it with the error', () => {
    const { container } = mount(<TextField label="Domain" error="Enter a .myshopify.com domain" />);
    const input = one(container, 'input');

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(input)).toBe('Enter a .myshopify.com domain');
    // role=alert so a post-submit message is announced without re-focusing.
    expect(one(container, '[role="alert"]').textContent).toBe('Enter a .myshopify.com domain');
  });

  it('describes with the error FIRST when both are present, and keeps both nodes', () => {
    const { container } = mount(
      <TextField label="Domain" hint="myshop.myshopify.com" error="Required" />,
    );
    // Order matters: aria-describedby is read in sequence, and the blocking
    // problem should be heard before the example.
    expect(describedText(one(container, 'input'))).toBe('Required | myshop.myshopify.com');
  });

  it('has no aria-describedby when there is nothing to describe', () => {
    const { container } = mount(<TextField label="Domain" />);
    expect(one(container, 'input').getAttribute('aria-describedby')).toBeNull();
  });

  it('required sets aria-required, the native attribute, and a decorative marker', () => {
    const { container } = mount(<TextField label="Email" required />);
    const input = one(container, 'input');

    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.hasAttribute('required')).toBe(true);
    // The asterisk is hidden from the tree — aria-required already says it, and
    // "star" read aloud after every label is noise.
    expect(one(container, '.ui-field__required').getAttribute('aria-hidden')).toBe('true');
  });

  it('renders a counter and flags it over the limit', () => {
    const under = mount(<TextField label="SEO title" counter={{ value: 61, max: 70 }} />);
    expect(one(under.container, '.ui-field__counter').textContent).toBe('61/70');
    expect(one(under.container, '.ui-field__counter').className).not.toContain('--over');
    under.unmount();

    // The Shopify SEO-title cap (constants/fieldLimits.ts SEO_TITLE = 70).
    const over = mount(<TextField label="SEO title" counter={{ value: 74, max: 70 }} />);
    expect(one(over.container, '.ui-field__counter').className).toContain('--over');
  });
});

describe('Field — control variants', () => {
  it('passes input props through and keeps the wired ones', () => {
    const onChange = vi.fn();
    const { container } = mount(
      <TextField label="Price" type="number" placeholder="0.00" value="45" onChange={onChange} />,
    );
    const input = one(container, 'input') as HTMLInputElement;

    expect(input.type).toBe('number');
    expect(input.placeholder).toBe('0.00');
    expect(input.value).toBe('45');
    expect(input.className).toContain('ui-input');
  });

  it('TextareaField wires the same way', () => {
    const { container } = mount(
      <TextareaField label="Notes" hint="Visible to your team" rows={4} />,
    );
    const textarea = one(container, 'textarea');

    expect(one(container, 'label').getAttribute('for')).toBe(textarea.id);
    expect(describedText(textarea)).toBe('Visible to your team');
    expect(textarea.getAttribute('rows')).toBe('4');
    expect(textarea.className).toContain('ui-input--textarea');
  });

  it('SelectField renders options, an optional placeholder, and the wiring', () => {
    const { container } = mount(
      <SelectField
        label="Role"
        placeholder="Choose a role"
        error="Pick one"
        options={[
          { value: 'admin', label: 'Admin' },
          { value: 'member', label: 'Member' },
          { value: 'owner', label: 'Owner', disabled: true },
        ]}
      />,
    );
    const select = one(container, 'select') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));

    expect(options.map((o) => o.value)).toEqual(['', 'admin', 'member', 'owner']);
    expect(options[3].disabled).toBe(true);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(one(container, 'label').getAttribute('for')).toBe(select.id);
  });

  it('accepts a plain element child for a control it cannot wire', () => {
    const { container } = mount(
      <Field label="Colour" hint="Hex or name">
        <input aria-label="Colour" />
      </Field>,
    );
    // No crash, and the hint still renders — the caller owns the naming here.
    expect(one(container, '.ui-field__hint').textContent).toBe('Hex or name');
  });
});
