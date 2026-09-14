import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FormEvent } from 'react';
import { Button, LinkButton } from './Button';
import { IconButton } from './IconButton';
import { Chip, ToggleChip, RemovableChip } from './Chip';
import { Badge, CountBadge } from './Badge';
import { Toast } from './Toast';
import { mount, cleanup, click, one, buttonByText } from './testUtils';

/**
 * The small controls. Only the behaviours that a class name cannot express are
 * asserted — the ones where a wrong value is an accessibility bug rather than a
 * styling nit.
 */

afterEach(cleanup);

describe('Button', () => {
  it('defaults to type=button so it cannot accidentally submit a form', () => {
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
    const { container } = mount(
      <form onSubmit={onSubmit}><Button>Apply filter</Button></form>,
    );
    expect(one(container, 'button').getAttribute('type')).toBe('button');
    click(buttonByText(container, 'Apply filter'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('loading disables the button, sets aria-busy, and keeps the label mounted', () => {
    const onClick = vi.fn();
    const { container } = mount(<Button loading onClick={onClick}>Save batch</Button>);
    const button = one(container, 'button');

    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    // The label stays so the button cannot resize mid-action and shift its row.
    expect(button.textContent).toContain('Save batch');
    click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('marks the spinner decorative, so the busy state is announced once', () => {
    const { container } = mount(<Button loading>Save</Button>);
    // aria-busy on the button already carries it; a nested role=status would
    // announce the same thing a second time.
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(one(container, '.ui-spinner')).toBeTruthy();
  });

  it('appends caller classes instead of replacing the variant classes', () => {
    const { container } = mount(<Button variant="primary" className="step-cta">Go</Button>);
    const cls = one(container, 'button').className;
    expect(cls).toContain('ui-btn--primary');
    expect(cls).toContain('step-cta');
  });
});

describe('LinkButton', () => {
  it('adds noopener noreferrer to a new-tab link', () => {
    const { container } = mount(
      <LinkButton href="https://shopify.com" target="_blank">Docs</LinkButton>,
    );
    const rel = one(container, 'a').getAttribute('rel') ?? '';
    // target=_blank without noopener hands the opened page a window handle.
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
  });

  it('a disabled link drops its href but stays announced', () => {
    const { container } = mount(<LinkButton href="/x" disabled>Export</LinkButton>);
    const anchor = one(container, 'a');
    expect(anchor.hasAttribute('href')).toBe(false);
    expect(anchor.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('IconButton', () => {
  it('names itself from label and reuses it as the tooltip', () => {
    const { container } = mount(<IconButton label="Close" icon={<span>x</span>} />);
    const button = one(container, 'button');
    expect(button.getAttribute('aria-label')).toBe('Close');
    expect(button.getAttribute('title')).toBe('Close');
  });

  it('lets an explicit title override the tooltip only', () => {
    const { container } = mount(
      <IconButton label="Remove from group" title="Alt: R" icon={<span>r</span>} />,
    );
    expect(one(container, 'button').getAttribute('aria-label')).toBe('Remove from group');
    expect(one(container, 'button').getAttribute('title')).toBe('Alt: R');
  });
});

describe('ToggleChip', () => {
  it('reports state through aria-pressed and reports the NEXT value', () => {
    const onPressedChange = vi.fn();
    const view = mount(
      <ToggleChip pressed={false} onPressedChange={onPressedChange}>Pending</ToggleChip>,
    );
    expect(one(view.container, 'button').getAttribute('aria-pressed')).toBe('false');

    click(one(view.container, 'button'));
    expect(onPressedChange).toHaveBeenCalledWith(true);

    view.rerender(<ToggleChip pressed onPressedChange={onPressedChange}>Pending</ToggleChip>);
    expect(one(view.container, 'button').getAttribute('aria-pressed')).toBe('true');
    click(one(view.container, 'button'));
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
  });

  it('a plain Chip has no pressed state — it is not a toggle', () => {
    const { container } = mount(<Chip>Clear</Chip>);
    expect(one(container, 'button').hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('RemovableChip', () => {
  it('keeps the dismiss control as a SIBLING button, never nested', () => {
    const { container } = mount(
      <RemovableChip removeLabel="Remove tag vintage" onRemove={() => {}} onClick={() => {}}>
        vintage
      </RemovableChip>,
    );
    const remove = one(container, '[aria-label="Remove tag vintage"]');
    // A button inside a button is invalid HTML and the inner control becomes
    // unreachable in several screen readers.
    expect(remove.closest('button')).toBe(remove);
    expect(container.querySelectorAll('button')).toHaveLength(2);
  });

  it('renders the label as a non-interactive span when there is no onClick', () => {
    const { container } = mount(
      <RemovableChip removeLabel="Remove vintage" onRemove={() => {}}>vintage</RemovableChip>,
    );
    // One tab stop, not a disabled button pretending to be a label.
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(one(container, '.ui-chip--static').textContent).toBe('vintage');
  });

  it('onRemove fires from the dismiss control only', () => {
    const onRemove = vi.fn();
    const onClick = vi.fn();
    const { container } = mount(
      <RemovableChip removeLabel="Remove vintage" onRemove={onRemove} onClick={onClick}>
        vintage
      </RemovableChip>,
    );
    click(one(container, '[aria-label="Remove vintage"]'));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it('is inert by default — a badge that is not clickable gets no role', () => {
    const { container } = mount(<Badge tone="gold" caps>owner</Badge>);
    const badge = one(container, '.ui-badge');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.hasAttribute('role')).toBe(false);
  });

  it('CountBadge renders nothing at zero and names what it counts', () => {
    const zero = mount(<CountBadge count={0} label="unread messages" />);
    expect(zero.container.querySelector('.ui-badge')).toBeNull();
    zero.unmount();

    const some = mount(<CountBadge count={3} label="unread messages" />);
    // "3" alone tells a screen-reader user nothing.
    expect(one(some.container, '.ui-badge').getAttribute('aria-label')).toBe('3 unread messages');
  });

  it('CountBadge caps at max with a + suffix', () => {
    const { container } = mount(<CountBadge count={250} max={99} label="unread" />);
    expect(one(container, '.ui-badge').textContent).toBe('99+');
  });
});

describe('Toast', () => {
  it('auto-dismisses after its duration', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      mount(<Toast message="4 images uploaded" onDismiss={onDismiss} duration={4000} />);
      expect(onDismiss).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4000);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('duration 0 pins the toast open', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      mount(<Toast tone="danger" message="Export failed" onDismiss={onDismiss} duration={0} />);
      vi.advanceTimersByTime(60_000);
      // A danger toast reporting lost work must not disappear on a timer.
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears its timer on unmount so a closed toast cannot fire', () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      const view = mount(<Toast message="Saved" onDismiss={onDismiss} duration={4000} />);
      view.unmount();
      vi.advanceTimersByTime(8000);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits the dismiss button when there is no onDismiss', () => {
    const { container } = mount(<Toast message="Working…" duration={0} />);
    expect(container.querySelector('[aria-label="Dismiss notification"]')).toBeNull();
  });
});
