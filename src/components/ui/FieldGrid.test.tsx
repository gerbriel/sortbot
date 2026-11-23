import { describe, it, expect, afterEach } from 'vitest';
import { FieldCell, FieldGrid, FieldGroup } from './FieldGrid';
import { mount, cleanup, click, one, all } from './testUtils';

describe('FieldGroup', () => {
  afterEach(() => cleanup());

  it('renders a caption over a frame and labels the section with it', () => {
    const { container } = mount(
      <FieldGroup caption="Pricing" data-section="pricing">
        <FieldGrid><FieldCell label="Price">{(c) => <input {...c} />}</FieldCell></FieldGrid>
      </FieldGroup>,
    );
    const section = one(container, 'section.ui-fieldgroup');
    const caption = one(section, '.ui-fieldgroup__caption');
    expect(caption.textContent).toBe('Pricing');
    expect(section.getAttribute('aria-labelledby')).toBe(caption.id);
    expect(section.dataset.section).toBe('pricing');
    expect(one(section, '.ui-fieldgroup__frame > .ui-fieldgrid')).toBeTruthy();
  });

  it('renders no caption and no aria-labelledby when captionless', () => {
    const { container } = mount(
      <FieldGroup><FieldGrid full><FieldCell label="Title">{(c) => <input {...c} />}</FieldCell></FieldGrid></FieldGroup>,
    );
    const section = one(container, 'section.ui-fieldgroup');
    expect(section.querySelector('.ui-fieldgroup__caption')).toBeNull();
    expect(section.hasAttribute('aria-labelledby')).toBe(false);
    expect(one(section, '.ui-fieldgrid').classList.contains('ui-fieldgrid--full')).toBe(true);
  });
});

describe('FieldGrid', () => {
  afterEach(() => cleanup());

  it('passes a columns hint as a custom property, and ignores it when full', () => {
    const { container } = mount(
      <>
        <FieldGrid columns={3} data-k="capped"><span /></FieldGrid>
        <FieldGrid columns={3} full data-k="full"><span /></FieldGrid>
        <FieldGrid data-k="plain"><span /></FieldGrid>
      </>,
    );
    const capped = one(container, '[data-k="capped"]');
    expect(capped.classList.contains('ui-fieldgrid--capped')).toBe(true);
    expect(capped.style.getPropertyValue('--ui-fieldgrid-cols')).toBe('3');
    expect(one(container, '[data-k="full"]').classList.contains('ui-fieldgrid--capped')).toBe(false);
    expect(one(container, '[data-k="plain"]').className).toBe('ui-fieldgrid');
  });
});

describe('FieldCell', () => {
  afterEach(() => cleanup());

  it('wires the label to the control with a generated id and hands out the control class', () => {
    const { container } = mount(<FieldCell label="Brand">{(c) => <input {...c} />}</FieldCell>);
    const label = one(container, 'label.ui-fieldcell__label');
    const input = one(container, 'input') as HTMLInputElement;
    expect(input.id).not.toBe('');
    expect(label.getAttribute('for')).toBe(input.id);
    expect(input.classList.contains('ui-fieldcell__control')).toBe(true);
    // No meta: the label sits directly in the cell, with no head row.
    expect(container.querySelector('.ui-fieldcell__head')).toBeNull();
  });

  it('uses a caller-supplied controlId and extra label classes', () => {
    const { container } = mount(
      <FieldCell label="Size" controlId="vct-size" labelClassName="vct-header">{(c) => <input {...c} />}</FieldCell>,
    );
    const label = one(container, 'label.vct-header.ui-fieldcell__label');
    expect(label.getAttribute('for')).toBe('vct-size');
    expect(one(container, '#vct-size').tagName).toBe('INPUT');
  });

  it('puts meta in the label row, after the label', () => {
    const { container } = mount(
      <FieldCell label="Title" meta={<span data-k="counter">12 / 60</span>}>{(c) => <input {...c} />}</FieldCell>,
    );
    const head = one(container, '.ui-fieldcell__head');
    expect(head.children[0].tagName).toBe('LABEL');
    expect(one(head, '.ui-fieldcell__meta [data-k="counter"]').textContent).toBe('12 / 60');
    // Head first, control after it.
    const cell = one(container, '.ui-fieldcell');
    expect(cell.children[0]).toBe(head);
    expect(cell.children[1].tagName).toBe('INPUT');
  });

  it('wires a hint with aria-describedby and renders a footer under the control', () => {
    const { container } = mount(
      <FieldCell label="Brand" hint="Helper words" footer={<div data-k="extra">extra</div>}>
        {(c) => <input {...c} />}
      </FieldCell>,
    );
    const input = one(container, 'input');
    const hint = one(container, '.ui-fieldcell__hint');
    expect(hint.textContent).toBe('Helper words');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(one(container, '.ui-fieldcell__footer [data-k="extra"]')).toBeTruthy();
  });

  it('maps span to the span2 and full modifiers', () => {
    const { container } = mount(
      <>
        <FieldCell label="A" span={2} data-k="a">{(c) => <input {...c} />}</FieldCell>
        <FieldCell label="B" span="full" data-k="b">{(c) => <input {...c} />}</FieldCell>
        <FieldCell label="C" data-k="c">{(c) => <input {...c} />}</FieldCell>
      </>,
    );
    expect(one(container, '[data-k="a"]').classList.contains('ui-fieldcell--span2')).toBe(true);
    expect(one(container, '[data-k="b"]').classList.contains('ui-fieldcell--full')).toBe(true);
    const c = one(container, '[data-k="c"]');
    expect(c.classList.contains('ui-fieldcell--span2') || c.classList.contains('ui-fieldcell--full')).toBe(false);
  });

  it('a click on the cell focuses the control, a click on a meta button does not', () => {
    const { container } = mount(
      <FieldCell label="Description" meta={<button type="button">Generate</button>}>
        {(c) => <textarea {...c} />}
      </FieldCell>,
    );
    click(one(container, 'button'));
    expect(document.activeElement).not.toBe(one(container, 'textarea'));
    click(one(container, '.ui-fieldcell'));
    expect(document.activeElement).toBe(one(container, 'textarea'));
  });

  it('supports the checkbox anatomy: the control beside a short value text', () => {
    const { container } = mount(
      <FieldCell label="Published">
        {(c) => (
          <span className="ui-fieldcell__check">
            <input {...c} type="checkbox" defaultChecked />
            <span>Yes</span>
          </span>
        )}
      </FieldCell>,
    );
    const box = one(container, 'input[type="checkbox"]');
    expect(one(container, 'label').getAttribute('for')).toBe(box.id);
    expect(all(container, '.ui-fieldcell__check > *').length).toBe(2);
  });
});
