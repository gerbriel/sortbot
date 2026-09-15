import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { mount, cleanup, keyDown, one, all } from './ui/testUtils';
import WorkspaceMenu, { type WorkspaceNavItem, type WorkspaceStorage } from './WorkspaceMenu';

afterEach(cleanup);

const items: WorkspaceNavItem[] = [
  { id: 'library', label: 'Library', icon: null, title: 'l', group: 'work' },
  { id: 'messages', label: 'Inbox', icon: null, title: 'm', group: 'work', badge: 3 },
  { id: 'categories', label: 'Manage Categories', icon: null, title: 'c', group: 'setup' },
  { id: 'crm', label: 'CRM', icon: null, title: 'x', group: 'founder' },
];

function Harness(p: {
  activeView?: string;
  onSelect?: (id: string, o: HTMLElement | null) => void;
  back?: boolean;
  storage?: WorkspaceStorage | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <WorkspaceMenu
      orgName="Founding Workspace" role="owner" email="a@b.c"
      items={items} activeView={p.activeView ?? 'workflow'}
      unreadCount={3} showBackToWorkflow={p.back ?? false}
      onSelect={p.onSelect ?? (() => {})} onSignOut={() => {}}
      open={open} onOpenChange={setOpen}
      storage={p.storage ?? null}
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

  /* The storage meter used to be a bar under the header; it is a row here now.
     The whole row is the Refresh action, it is FIRST in the roving order, and
     its accessible name says everything the aria-hidden figures show. */
  describe('storage row', () => {
    const GB = 1024 ** 3;
    const base: WorkspaceStorage = {
      usedBytes: 3.23 * GB, fileCount: 8546, loading: false, limitGb: 100, onRefresh: () => {},
    };

    it('is absent without the prop and first in the menu with it', () => {
      const a = mount(<Harness back />);
      press(one(a.container, '.wsmenu-trigger'), 1);
      expect(document.querySelector('.wsmenu-storage')).toBeNull();
      a.unmount();

      const b = mount(<Harness back storage={base} />);
      press(one(b.container, '.wsmenu-trigger'), 1);
      const row = one(document, '.wsmenu-storage');
      expect(menuitems()[0]).toBe(row);
      expect(menuitems()[1].textContent).toContain('Back to workflow');
      expect(row.getAttribute('aria-label')).toBe('Storage: 3.23 GB of 100 GB used (3%), 8,546 files. Refresh');
      expect(row.className).toContain('wsmenu-storage--success');
      expect(one(row, '.wsmenu-storage-fill').getAttribute('style')).toContain('width: 3.2%');
      expect(row.textContent).toContain('8,546 files');
      expect(row.textContent).not.toContain('Almost full');
    });

    it('clicking refreshes and keeps the menu open; a read in flight is not re-fired', () => {
      const onRefresh = vi.fn();
      const a = mount(<Harness storage={{ ...base, onRefresh }} />);
      press(one(a.container, '.wsmenu-trigger'), 1);
      press(one(document, '.wsmenu-storage'), 1);
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(pop()).toBeTruthy();
      a.unmount();

      const again = vi.fn();
      const b = mount(<Harness storage={{ ...base, loading: true, onRefresh: again }} />);
      press(one(b.container, '.wsmenu-trigger'), 1);
      const row = one(document, '.wsmenu-storage');
      expect(row.getAttribute('aria-busy')).toBe('true');
      expect(row.className).toContain('wsmenu-storage--busy');
      // Figures are kept while it re-reads — no "Calculating…" flash.
      expect(row.getAttribute('aria-label')).toContain('3.23 GB of 100 GB');
      press(row, 1);
      expect(again).not.toHaveBeenCalled();
    });

    it('states calculating on the first read and flags almost-full past 85%', () => {
      const a = mount(<Harness storage={{ ...base, usedBytes: 0, fileCount: 0, loading: true }} />);
      press(one(a.container, '.wsmenu-trigger'), 1);
      let row = one(document, '.wsmenu-storage');
      expect(row.getAttribute('aria-label')).toBe('Storage: calculating. Refresh');
      expect(row.textContent).toContain('Calculating…');
      expect(row.textContent).not.toContain('files');
      a.unmount();

      const b = mount(<Harness storage={{ ...base, usedBytes: 91 * GB }} />);
      press(one(b.container, '.wsmenu-trigger'), 1);
      row = one(document, '.wsmenu-storage');
      expect(row.className).toContain('wsmenu-storage--danger');
      expect(row.textContent).toContain('Almost full');
      expect(row.getAttribute('aria-label')).toContain('(91%), 8,546 files, almost full');
      expect(one(row, '.wsmenu-storage-fill').getAttribute('style')).toContain('width: 91.0%');
    });
  });
});
