import { describe, it, expect, afterEach, vi } from 'vitest';
import ToolView from './ToolView';
import { mount, cleanup, click, keyDown, one, all, buttonByText } from './ui/testUtils';

/**
 * ToolView is the shell every header tool opens into now that none of them is a
 * modal. Only the behaviours a class name cannot express are asserted — the
 * navigation and accessibility contract that the old close buttons used to
 * carry, plus the two Escape exemptions that keep an in-progress edit safe.
 */

afterEach(cleanup);

const render = (props: Partial<React.ComponentProps<typeof ToolView>> = {}) =>
  mount(
    <ToolView icon={<span>i</span>} title="Library" onBack={() => {}} {...props}>
      <p>body</p>
    </ToolView>,
  );

describe('ToolView', () => {
  it('renders exactly one h1, and it is the view title', () => {
    const { container } = render({ description: 'Every batch in this workspace.' });
    const headings = all(container, 'h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('Library');
  });

  it('puts Back to workflow first in tab order, before the heading', () => {
    const { container } = render();
    const focusable = all(container, 'button, h1[tabindex="-1"]');
    expect(focusable[0].textContent?.trim()).toBe('Back to workflow');
  });

  it('moves focus to the title on open so the view announces itself', () => {
    const { container } = render();
    expect(document.activeElement).toBe(one(container, 'h1'));
  });

  it('Back returns to the workflow', () => {
    const onBack = vi.fn();
    const { container } = render({ onBack });
    click(buttonByText(container, 'Back to workflow'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Escape returns to the workflow', () => {
    const onBack = vi.fn();
    render({ onBack });
    keyDown('Escape', document.body);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to an editable field — inline renames cancel with it', () => {
    const onBack = vi.fn();
    const { container } = mount(
      <ToolView icon={<span>i</span>} title="Workspace" onBack={onBack}>
        <input defaultValue="Arcadian" />
      </ToolView>,
    );
    keyDown('Escape', one(container, 'input'));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('leaves Escape to an open [data-tv-modal] — a half-written preset survives it', () => {
    const onBack = vi.fn();
    mount(
      <ToolView icon={<span>i</span>} title="Category presets" onBack={onBack}>
        <div data-tv-modal>editor</div>
      </ToolView>,
    );
    keyDown('Escape', document.body);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('escapeToBack=false hands Escape to the child entirely (the Board drawer)', () => {
    const onBack = vi.fn();
    render({ onBack, escapeToBack: false });
    keyDown('Escape', document.body);
    expect(onBack).not.toHaveBeenCalled();
  });
});
