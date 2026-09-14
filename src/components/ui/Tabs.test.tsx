import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { Tabs, TabList, Tab, TabPanel } from './Tabs';
import { mount, cleanup, click, keyDown, all, one } from './testUtils';

/**
 * Tabs is the primitive that replaces `.org-tabs` — a row of plain buttons with
 * no tablist role, no aria-selected, no arrow keys, and one tab stop per tab.
 * These tests lock the keyboard contract, because that is the part a visual
 * regression cannot catch.
 */

afterEach(cleanup);

function Harness({
  initial = 'members',
  activationMode = 'automatic' as 'automatic' | 'manual',
  onChange,
  disabledSecond = false,
}: {
  initial?: string;
  activationMode?: 'automatic' | 'manual';
  onChange?: (v: string) => void;
  disabledSecond?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Tabs
      value={value}
      activationMode={activationMode}
      onValueChange={(v) => { setValue(v); onChange?.(v); }}
    >
      <TabList label="Workspace sections">
        <Tab value="members">Members</Tab>
        <Tab value="billing" disabled={disabledSecond}>Billing</Tab>
        <Tab value="shopify" count={3}>Shopify</Tab>
      </TabList>
      <TabPanel value="members">Members panel</TabPanel>
      <TabPanel value="billing">Billing panel</TabPanel>
      <TabPanel value="shopify">Shopify panel</TabPanel>
    </Tabs>
  );
}

describe('Tabs — ARIA structure', () => {
  it('renders a labelled tablist whose tabs point at their panels', () => {
    const { container } = mount(<Harness />);

    const list = one(container, '[role="tablist"]');
    expect(list.getAttribute('aria-label')).toBe('Workspace sections');

    const tabs = all(container, '[role="tab"]');
    expect(tabs).toHaveLength(3);

    const panel = one(container, '[role="tabpanel"]');
    // The selected tab owns the panel, and the panel names itself from the tab.
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
  });

  it('marks exactly one tab selected and keeps only that one in the tab order', () => {
    const { container } = mount(<Harness />);
    const tabs = all(container, '[role="tab"]');

    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    // Roving tabindex: Tab reaches the set once, not once per tab.
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('unmounts unselected panels by default', () => {
    const { container } = mount(<Harness />);
    expect(all(container, '[role="tabpanel"]')).toHaveLength(1);
    expect(container.textContent).toContain('Members panel');
    expect(container.textContent).not.toContain('Billing panel');
  });
});

describe('Tabs — keyboard', () => {
  it('ArrowRight moves and (in automatic mode) selects the next tab', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness onChange={onChange} />);
    const tabs = all(container, '[role="tab"]');

    tabs[0].focus();
    keyDown('ArrowRight', tabs[0]);

    expect(onChange).toHaveBeenCalledWith('billing');
    expect(document.activeElement).toBe(all(container, '[role="tab"]')[1]);
    expect(container.textContent).toContain('Billing panel');
  });

  it('ArrowLeft from the first tab wraps to the last', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness onChange={onChange} />);
    const tabs = all(container, '[role="tab"]');

    tabs[0].focus();
    keyDown('ArrowLeft', tabs[0]);

    expect(onChange).toHaveBeenCalledWith('shopify');
  });

  it('ArrowDown/ArrowUp behave as Right/Left', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness onChange={onChange} />);
    const tabs = all(container, '[role="tab"]');

    tabs[0].focus();
    keyDown('ArrowDown', tabs[0]);
    expect(onChange).toHaveBeenLastCalledWith('billing');

    keyDown('ArrowUp', all(container, '[role="tab"]')[1]);
    expect(onChange).toHaveBeenLastCalledWith('members');
  });

  it('Home and End jump to the ends', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness onChange={onChange} />);

    keyDown('End', all(container, '[role="tab"]')[0]);
    expect(onChange).toHaveBeenLastCalledWith('shopify');

    keyDown('Home', all(container, '[role="tab"]')[2]);
    expect(onChange).toHaveBeenLastCalledWith('members');
  });

  it('skips disabled tabs when arrowing', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness onChange={onChange} disabledSecond />);

    keyDown('ArrowRight', all(container, '[role="tab"]')[0]);
    // Billing is disabled, so the next reachable tab is Shopify.
    expect(onChange).toHaveBeenCalledWith('shopify');
  });

  it('manual activation moves focus without selecting until Enter', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness activationMode="manual" onChange={onChange} />);
    const tabs = all(container, '[role="tab"]');

    tabs[0].focus();
    keyDown('ArrowRight', tabs[0]);

    // Focus moved, selection did not — the point of manual mode for an
    // expensive panel (arrowing past a tab must not fire its fetch).
    expect(document.activeElement).toBe(tabs[1]);
    expect(onChange).not.toHaveBeenCalled();

    keyDown('Enter', tabs[1]);
    expect(onChange).toHaveBeenCalledWith('billing');
  });

  it('ignores unrelated keys so typing in a panel is unaffected', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness onChange={onChange} />);
    keyDown('a', all(container, '[role="tab"]')[0]);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Tabs — pointer', () => {
  it('clicking a tab selects it', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness onChange={onChange} />);
    click(all(container, '[role="tab"]')[2]);

    expect(onChange).toHaveBeenCalledWith('shopify');
    expect(container.textContent).toContain('Shopify panel');
  });

  it('clicking the already-selected tab does not re-fire onValueChange', () => {
    const onChange = vi.fn();
    const { container } = mount(<Harness onChange={onChange} />);
    click(all(container, '[role="tab"]')[0]);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Tabs — misuse', () => {
  it('throws a named error when a Tab is rendered outside Tabs', () => {
    // Rendering errors surface through React's error path; the message has to
    // name the offending component or the stack is useless in a 3,000-line file.
    expect(() => mount(<Tab value="x">Orphan</Tab>)).toThrow(/must be rendered inside <Tabs>/);
  });
});
