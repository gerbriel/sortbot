import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { ConfirmAction } from './ConfirmAction';
import { mount, cleanup, click, keyDown, one, buttonByText } from './testUtils';

/**
 * The two-step inline confirm. `window.confirm()` is banned in this codebase
 * (CLAUDE.md Do Not #12 — it blocks the event loop mid-auto-save and cannot be
 * styled or tested), so every destructive control grew its own `confirmKey`
 * state plus a copy-pasted yes/no pair. This locks the shared behaviour,
 * including the controlled form that the existing `confirmKey` maps onto.
 */

afterEach(cleanup);

describe('ConfirmAction — uncontrolled two-step', () => {
  it('shows only the trigger at rest', () => {
    const { container } = mount(<ConfirmAction label="Remove" onConfirm={() => {}} />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(buttonByText(container, 'Remove')).toBeTruthy();
  });

  it('does NOT fire onConfirm on the first click — that is the whole point', () => {
    const onConfirm = vi.fn();
    const { container } = mount(<ConfirmAction label="Remove" onConfirm={onConfirm} />);
    click(buttonByText(container, 'Remove'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('arms into a confirm/cancel pair and fires only on confirm', () => {
    const onConfirm = vi.fn();
    const { container } = mount(<ConfirmAction label="Remove" onConfirm={onConfirm} />);

    click(buttonByText(container, 'Remove'));
    expect(buttonByText(container, 'Confirm')).toBeTruthy();
    expect(buttonByText(container, 'Cancel')).toBeTruthy();

    click(buttonByText(container, 'Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Disarms itself, so a second click cannot double-delete.
    expect(buttonByText(container, 'Remove')).toBeTruthy();
  });

  it('cancel disarms without firing', () => {
    const onConfirm = vi.fn();
    const { container } = mount(<ConfirmAction label="Remove" onConfirm={onConfirm} />);

    click(buttonByText(container, 'Remove'));
    click(buttonByText(container, 'Cancel'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(buttonByText(container, 'Remove')).toBeTruthy();
  });

  it('moves focus to the commit button when armed, so Enter commits', () => {
    const onConfirm = vi.fn();
    const { container } = mount(<ConfirmAction label="Remove" onConfirm={onConfirm} />);
    click(buttonByText(container, 'Remove'));
    expect(document.activeElement).toBe(buttonByText(container, 'Confirm'));
  });

  it('Escape disarms and stops the key reaching a surrounding Dialog', () => {
    const onConfirm = vi.fn();
    const outerEscape = vi.fn();
    const { container } = mount(
      <div onKeyDown={outerEscape}>
        <ConfirmAction label="Remove" onConfirm={onConfirm} />
      </div>,
    );

    click(buttonByText(container, 'Remove'));
    keyDown('Escape', buttonByText(container, 'Confirm'));

    expect(buttonByText(container, 'Remove')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    // Without the stopPropagation, arming a confirm inside a modal and pressing
    // Escape would disarm AND close the modal in one keystroke.
    expect(outerEscape).not.toHaveBeenCalled();
  });

  it('exposes the prompt as the armed group name and via aria-describedby', () => {
    const { container } = mount(
      <ConfirmAction label="Remove" prompt="Remove this member?" onConfirm={() => {}} />,
    );
    click(buttonByText(container, 'Remove'));

    const group = one(container, '[role="group"]');
    expect(group.getAttribute('aria-label')).toBe('Remove this member?');
    const describedBy = group.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Remove this member?');
  });

  it('falls back to a named group label when no prompt is given', () => {
    const { container } = mount(<ConfirmAction label="Disconnect" onConfirm={() => {}} />);
    click(buttonByText(container, 'Disconnect'));
    // "Confirm button" alone tells a screen-reader user nothing about what.
    expect(one(container, '[role="group"]').getAttribute('aria-label')).toBe('Confirm: Disconnect');
  });

  it('disabled blocks both steps', () => {
    const onConfirm = vi.fn();
    const { container } = mount(<ConfirmAction label="Remove" disabled onConfirm={onConfirm} />);
    const trigger = buttonByText(container, 'Remove');
    expect(trigger.hasAttribute('disabled')).toBe(true);
    click(trigger);
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it('uses custom labels', () => {
    const { container } = mount(
      <ConfirmAction
        label="Disconnect" confirmLabel="Yes, disconnect" cancelLabel="Keep it"
        onConfirm={() => {}}
      />,
    );
    click(buttonByText(container, 'Disconnect'));
    expect(buttonByText(container, 'Yes, disconnect')).toBeTruthy();
    expect(buttonByText(container, 'Keep it')).toBeTruthy();
  });
});

describe('ConfirmAction — controlled (the confirmKey pattern)', () => {
  function List() {
    const [confirmKey, setConfirmKey] = useState<string | null>(null);
    return (
      <div>
        {['alice', 'bob'].map((id) => (
          <ConfirmAction
            key={id}
            label={`Remove ${id}`}
            onConfirm={() => {}}
            armed={confirmKey === `remove:${id}`}
            onArmedChange={(on) => setConfirmKey(on ? `remove:${id}` : null)}
          />
        ))}
      </div>
    );
  }

  it('arms at most one row at a time', () => {
    const { container } = mount(<List />);

    click(buttonByText(container, 'Remove alice'));
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(buttonByText(container, 'Remove bob')).toBeTruthy();

    // Arming the second row must disarm the first — the reason this state lives
    // in the parent and not in each component.
    click(buttonByText(container, 'Remove bob'));
    const groups = container.querySelectorAll('[role="group"]');
    expect(groups).toHaveLength(1);
    expect(groups[0].getAttribute('aria-label')).toBe('Confirm: Remove bob');
  });

  it('reports arming changes to the parent in both directions', () => {
    const onArmedChange = vi.fn();
    const view = mount(
      <ConfirmAction label="Remove" onConfirm={() => {}} armed={false} onArmedChange={onArmedChange} />,
    );
    click(buttonByText(view.container, 'Remove'));
    expect(onArmedChange).toHaveBeenLastCalledWith(true);

    view.rerender(
      <ConfirmAction label="Remove" onConfirm={() => {}} armed onArmedChange={onArmedChange} />,
    );
    click(buttonByText(view.container, 'Cancel'));
    expect(onArmedChange).toHaveBeenLastCalledWith(false);
  });

  it('stays armed while the parent says so, even after a confirm', () => {
    const onConfirm = vi.fn();
    const { container } = mount(
      <ConfirmAction label="Remove" onConfirm={onConfirm} armed onArmedChange={() => {}} />,
    );
    click(buttonByText(container, 'Confirm'));
    // The parent owns `armed`; the component must not fight it by self-closing.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="group"]')).not.toBeNull();
  });
});
