import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useRef } from 'react';
import { mount, cleanup, click } from './ui/testUtils';

// The board module imports the service layer at top level; the chips never
// call it, so a bare stub keeps Supabase out of the test.
vi.mock('../lib/kanbanService', () => ({}));

import { KanbanLaneChips } from './KanbanBoard';

const LANES = [
  { id: 'l-todo', name: 'To do', is_done: false, cards: [] },
  { id: 'l-doing', name: 'In progress', is_done: false, cards: [] },
  { id: 'l-done', name: 'Done', is_done: true, cards: [] },
];

/** Each lane is 300px wide with a 12px gap; the strip starts at x = 20. */
const STRIP_LEFT = 20;
const LANE_STEP = 312;

/** The chips plus a strip shaped like the real one (lanes carry data-lane-id). */
function Harness() {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <>
      <KanbanLaneChips lanes={LANES} scrollerRef={ref} />
      <div ref={ref} className="kanban-lanes" data-testid="strip">
        {LANES.map(l => <div key={l.id} data-lane-id={l.id} className="kanban-lane">{l.name}</div>)}
        <div className="kanban-lane kanban-lane--new">Add lane</div>
      </div>
    </>
  );
}

/** happy-dom has no layout, so give the strip and its lanes real geometry
 *  that follows `scrollLeft`, the way a browser would. */
function layOut(strip: HTMLElement) {
  strip.getBoundingClientRect = () => ({ left: STRIP_LEFT, top: 0, right: 410, bottom: 400, width: 390, height: 400, x: STRIP_LEFT, y: 0, toJSON: () => ({}) });
  strip.querySelectorAll<HTMLElement>('[data-lane-id]').forEach((el, i) => {
    el.getBoundingClientRect = () => {
      const left = STRIP_LEFT + i * LANE_STEP - strip.scrollLeft;
      return { left, top: 0, right: left + 300, bottom: 400, width: 300, height: 400, x: left, y: 0, toJSON: () => ({}) };
    };
  });
}

function chip(container: HTMLElement, name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('.kanban-lanechip'))
    .find(b => b.textContent?.startsWith(name));
  if (!found) throw new Error(`no chip ${name}`);
  return found;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('KanbanLaneChips', () => {
  it('names every lane (not the add-lane placeholder) and marks the first as in view', () => {
    const { container } = mount(<Harness />);
    const chips = container.querySelectorAll('.kanban-lanechip');
    expect(Array.from(chips).map(c => c.textContent?.replace(/\s*\d+$/, ''))).toEqual(['To do', 'In progress', 'Done']);
    expect(container.querySelector('nav.kanban-lanechips')?.getAttribute('aria-label')).toBe('Jump to lane');
    expect(chip(container, 'To do').getAttribute('aria-current')).toBe('true');
    expect(chip(container, 'Done').hasAttribute('aria-current')).toBe(false);
  });

  it('scrolls the board to the tapped lane and marks it current', () => {
    const { container } = mount(<Harness />);
    const strip = container.querySelector<HTMLElement>('[data-testid="strip"]')!;
    layOut(strip);
    const scrollTo = vi.fn();
    strip.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];

    click(chip(container, 'Done'));

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ left: 2 * LANE_STEP });
    expect(chip(container, 'Done').getAttribute('aria-current')).toBe('true');
    expect(chip(container, 'To do').hasAttribute('aria-current')).toBe(false);
  });

  it('follows a swipe: the lane nearest the left edge becomes current', async () => {
    const { container } = mount(<Harness />);
    const strip = container.querySelector<HTMLElement>('[data-testid="strip"]')!;
    layOut(strip);

    strip.scrollLeft = LANE_STEP + 10; // just past the second lane's edge
    await act(async () => {
      strip.dispatchEvent(new Event('scroll'));
      await new Promise(r => requestAnimationFrame(() => r(null)));
    });

    expect(chip(container, 'In progress').getAttribute('aria-current')).toBe('true');
  });

  it('renders nothing for a single-lane board', () => {
    function One() {
      const ref = useRef<HTMLDivElement | null>(null);
      return <KanbanLaneChips lanes={LANES.slice(0, 1)} scrollerRef={ref} />;
    }
    const { container } = mount(<One />);
    expect(container.querySelector('.kanban-lanechips')).toBeNull();
  });
});
