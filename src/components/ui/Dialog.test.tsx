import { describe, it, expect, afterEach, vi } from 'vitest';
import { useRef } from 'react';
import type { ComponentProps } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { mount, cleanup, click, keyDown, one, buttonByText } from './testUtils';

/**
 * Dialog replaces nine hand-rolled overlays, none of which trapped focus,
 * restored it on close, or locked body scroll. Those are exactly the behaviours
 * a screenshot cannot verify, so they are all locked here.
 */

afterEach(() => {
  cleanup();
  // A leaked scroll lock would silently freeze the page for every later test.
  document.body.style.overflow = '';
});

function Basic({ onClose = () => {}, ...rest }: Partial<ComponentProps<typeof Dialog>>) {
  return (
    <Dialog open title="Workspace" onClose={onClose} {...rest}>
      <button type="button">first</button>
      <button type="button">second</button>
    </Dialog>
  );
}

describe('Dialog — ARIA + rendering', () => {
  it('renders nothing when closed', () => {
    const { container } = mount(
      <Dialog open={false} title="Workspace" onClose={() => {}}>body</Dialog>,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('is a modal dialog labelled by its own title', () => {
    const { container } = mount(<Basic />);
    const dialog = one(container, '[role="dialog"]');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId ?? '')?.textContent).toContain('Workspace');
  });

  it('wires aria-describedby only when a description is given', () => {
    const withoutDesc = mount(<Basic />);
    expect(one(withoutDesc.container, '[role="dialog"]').getAttribute('aria-describedby')).toBeNull();
    withoutDesc.unmount();

    const { container } = mount(<Basic description="Members and invites." />);
    const dialog = one(container, '[role="dialog"]');
    const descId = dialog.getAttribute('aria-describedby');
    expect(document.getElementById(descId ?? '')?.textContent).toBe('Members and invites.');
  });
});

describe('Dialog — focus', () => {
  it('moves focus into the panel on open', () => {
    const { container } = mount(<Basic />);
    // Default target is the first focusable — here the header close button,
    // which is deliberate: it is always safe to activate.
    expect(one(container, '[role="dialog"]').contains(document.activeElement)).toBe(true);
  });

  it('honours initialFocusRef, so a destructive dialog can open on Cancel', () => {
    function WithInitialFocus() {
      const cancelRef = useRef<HTMLButtonElement>(null);
      return (
        <Dialog
          open
          title="Delete batch"
          onClose={() => {}}
          initialFocusRef={cancelRef}
          footer={<Button ref={cancelRef}>Cancel</Button>}
        >
          <button type="button">Delete everything</button>
        </Dialog>
      );
    }
    const { container } = mount(<WithInitialFocus />);
    expect(document.activeElement).toBe(buttonByText(container, 'Cancel'));
  });

  it('restores focus to the invoking element on close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const view = mount(<Basic />);
    expect(document.activeElement).not.toBe(opener);

    view.rerender(<Dialog open={false} title="Workspace" onClose={() => {}}>body</Dialog>);
    // Closing a modal must not dump the caret at the top of the document.
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('traps Tab at the end of the panel and Shift+Tab at the start', () => {
    const { container } = mount(<Basic hideCloseButton />);
    const first = buttonByText(container, 'first');
    const last = buttonByText(container, 'second');

    last.focus();
    keyDown('Tab', last);
    expect(document.activeElement).toBe(first);

    first.focus();
    keyDown('Tab', first, { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone in the middle of the panel, so the browser moves focus', () => {
    const { container } = mount(<Basic hideCloseButton />);
    const first = buttonByText(container, 'first');
    first.focus();
    keyDown('Tab', first);
    // Not wrapped: happy-dom has no native Tab behaviour, so "unchanged" is the
    // observable proof that the trap did NOT intervene.
    expect(document.activeElement).toBe(first);
  });
});

describe('Dialog — dismissal', () => {
  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    mount(<Basic onClose={onClose} />);
    keyDown('Escape', document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape is ignored when closeOnEscape is false', () => {
    const onClose = vi.fn();
    mount(<Basic onClose={onClose} closeOnEscape={false} />);
    keyDown('Escape', document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape closes only the topmost of two stacked dialogs', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    mount(
      <>
        <Dialog open title="Outer" onClose={outer}>outer body</Dialog>
        <Dialog open title="Inner" onClose={inner}>inner body</Dialog>
      </>,
    );

    keyDown('Escape', document.body);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('the close button calls onClose', () => {
    const onClose = vi.fn();
    const { container } = mount(<Basic onClose={onClose} />);
    click(one(container, '[aria-label="Close"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a scrim click closes, but a click inside the panel does not', () => {
    const onClose = vi.fn();
    const { container } = mount(<Basic onClose={onClose} />);

    click(buttonByText(container, 'first'));
    expect(onClose).not.toHaveBeenCalled();

    click(one(container, '.ui-dialog-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a scrim click whose press started inside the panel', () => {
    const onClose = vi.fn();
    const { container } = mount(<Basic onClose={onClose} />);
    const overlay = one(container, '.ui-dialog-overlay');
    const panel = one(container, '[role="dialog"]');

    // A drag that begins on the panel (text selection, a slider) and releases
    // over the scrim must not be read as "dismiss".
    panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on a scrim click when closeOnOverlayClick is false', () => {
    const onClose = vi.fn();
    const { container } = mount(<Basic onClose={onClose} closeOnOverlayClick={false} />);
    click(one(container, '.ui-dialog-overlay'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Dialog — body scroll lock', () => {
  it('locks while open and restores on close', () => {
    const view = mount(<Basic />);
    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(<Dialog open={false} title="Workspace" onClose={() => {}}>body</Dialog>);
    expect(document.body.style.overflow).toBe('');
  });

  it('stays locked until the LAST of two stacked dialogs closes', () => {
    const view = mount(
      <>
        <Dialog open title="Outer" onClose={() => {}}>outer</Dialog>
        <Dialog open title="Inner" onClose={() => {}}>inner</Dialog>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(
      <>
        <Dialog open title="Outer" onClose={() => {}}>outer</Dialog>
        <Dialog open={false} title="Inner" onClose={() => {}}>inner</Dialog>
      </>,
    );
    // A per-dialog lock would have restored scrolling here, behind a modal.
    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(
      <>
        <Dialog open={false} title="Outer" onClose={() => {}}>outer</Dialog>
        <Dialog open={false} title="Inner" onClose={() => {}}>inner</Dialog>
      </>,
    );
    expect(document.body.style.overflow).toBe('');
  });
});
