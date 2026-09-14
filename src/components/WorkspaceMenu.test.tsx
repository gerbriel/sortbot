import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { mount, cleanup, keyDown, one, all } from './ui/testUtils';
import WorkspaceMenu, { type WorkspaceNavItem } from './WorkspaceMenu';

afterEach(cleanup);

const items: WorkspaceNavItem[] = [
  { id: 'library', label: 'Library', icon: null, title: 'l', group: 'work' },
  { id: 'messages', label: 'Inbox', icon: null, title: 'm', group: 'work', badge: 3 },
  { id: 'categories', label: 'Manage Categories', icon: null, title: 'c', group: 'setup' },
  { id: 'crm', label: 'CRM', icon: null, title: 'x', group: 'founder' },
];

function Harness(p: { activeView?: string; onSelect?: (id: string, o: HTMLElement | null) => void; back?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <WorkspaceMenu
      orgName="Founding Workspace" role="owner" email="a@b.c"
      items={items} activeView={p.activeView ?? 'workflow'}
      unreadCount={3} showBackToWorkflow={p.back ?? false}
      onSelect={p.onSelect ?? (() => {})} onSignOut={() => {}}
      open={open} onOpenChange={setOpen}
    />
  );
}

/** click with an explicit `detail`: 1 = pointer, 0 = keyboard-activated. */
function press(el: Element, detail: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
  });
}
const pop = () => document.querySelector('.wsmenu-pop');
const menuitems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
const focused = () => document.activeElement?.textContent ?? '';
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 25)); });

describe('WorkspaceMenu', () => {
  it('trigger carries menu semantics and the unread badge', () => {
    const { container } = mount(<Harness />);
    const t = one(container, '.wsmenu-trigger');
    expect(t.getAttribute('aria-haspopup')).toBe('menu');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(one(t, '.nav-badge').textContent).toBe('3');
  });

  it('pointer open does not move focus; keyboard open focuses the first item', async () => {
    const a = mount(<Harness />);
    press(one(a.container, '.wsmenu-trigger'), 1);
    expect(pop()).toBeTruthy();
    await settle();
    expect(menuitems().includes(document.activeElement as HTMLElement)).toBe(false);
    a.unmount();

    const b = mount(<Harness />);
    press(one(b.container, '.wsmenu-trigger'), 0);
    await settle();
    expect(focused()).toContain('Library');
  });

  it('ArrowDown/Up wrap, Home/End jump', async () => {
    const { container } = mount(<Harness />);
    press(one(container, '.wsmenu-trigger'), 0);
    await settle();
    const menu = one(document, '.wsmenu-pop');
    expect(focused()).toContain('Library');
    keyDown('ArrowDown', menu);
    expect(focused()).toContain('Inbox');
    keyDown('End', menu);
    expect(focused()).toContain('Sign out');
    keyDown('ArrowDown', menu);                    // wraps to the top
    expect(focused()).toContain('Library');
    keyDown('ArrowUp', menu);                      // wraps to the bottom
    expect(focused()).toContain('Sign out');
    keyDown('Home', menu);
    expect(focused()).toContain('Library');
  });

  it('Escape closes and restores focus to the trigger', async () => {
    const { container } = mount(<Harness />);
    const t = one(container, '.wsmenu-trigger');
    press(t, 0);
    await settle();
    keyDown('Escape', document.body);
    await settle();
    expect(pop()).toBeNull();
    expect(document.activeElement).toBe(t);
  });

  it('selecting closes and reports the id; picking the active view only closes', () => {
    const onSelect = vi.fn();
    const { container } = mount(<Harness activeView="crm" onSelect={onSelect} />);
    const t = one(container, '.wsmenu-trigger');
    press(t, 1);
    press(menuitems().find(m => m.textContent?.includes('Manage Categories'))!, 1);
    expect(onSelect).toHaveBeenCalledWith('categories', expect.anything());
    expect(pop()).toBeNull();

    onSelect.mockClear();
    press(t, 1);
    press(menuitems().find(m => m.textContent?.includes('CRM'))!, 1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(pop()).toBeNull();
  });

  it('groups, separators, active marking, Back and the Escape park are present', () => {
    const { container } = mount(<Harness activeView="crm" back />);
    press(one(container, '.wsmenu-trigger'), 1);
    const labels = all(document.body, '[role="group"]').map(g => g.getAttribute('aria-label'));
    expect(labels).toEqual(['Work', 'Setup', 'Founder']);
    expect(all(document.body, '[role="separator"]').length).toBeGreaterThanOrEqual(4);
    expect(menuitems().find(m => m.textContent?.includes('CRM'))!.getAttribute('aria-current')).toBe('page');
    expect(menuitems()[0].textContent).toContain('Back to workflow');
    expect(document.querySelector('[data-tv-modal]')).toBeTruthy();
    expect(one(document, '.wsmenu-badge').textContent).toBe('3');
    // every item is reachable by the roving keys
    expect(menuitems().every(m => m.getAttribute('tabindex') === '-1')).toBe(true);
  });

  it('a press outside closes it, and so does Tab', () => {
    const { container } = mount(<Harness />);
    const t = one(container, '.wsmenu-trigger');
    press(t, 1);
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(pop()).toBeNull();

    press(t, 1);
    keyDown('Tab', document.body);
    expect(pop()).toBeNull();
  });
});
