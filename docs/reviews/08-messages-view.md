# 08 — Messages: a full page beside the floating widget

Implemented against the working tree at commit `c60e437` (branch `main`, tree
already dirty from passes 01–07 and a concurrent Finance module in new files).
Nothing was committed. No dependency added, no `sortbot_*` key renamed, no
`confirm()`/`prompt()` introduced, no `CLAUDE.md` / `README.md` / `CHANGELOG.md`
edit.

**The request, verbatim:** *"i like the inbox window but also want new messages
view i can access"*

So the floating widget is untouched in behaviour, and messaging gains a tenth
`activeView`. The interesting part was not the page — it was that two front ends
onto the same conversations must not become two Realtime channels, two poll
timers and two thread lists that disagree the moment one of them writes.

---

## 1. What was built

### 1.1 `src/lib/supportStore.ts` — one list, one channel, one timer

A dependency-free store on React's own `useSyncExternalStore`, mirroring
`workflowStore.ts` (CLAUDE.md §8). It holds the thread list and the availability
flag, and **owns the subscription**:

```ts
subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) start();      // fetch + Realtime channel + 45 s poll
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();     // unsubscribe + clearInterval
  };
}
```

Mount the widget alone, the Messages page alone, or both — one channel and one
timer either way. `SUPPORT_POLL_MS` (45 s) moved here from `SupportWidget`.

**Messages are deliberately NOT in the store.** A conversation's messages belong
to whoever is reading it, and the widget and the page can be looking at
different threads. Instead the state carries a `revision` counter that ticks
once per *completed* server refetch; each consumer reloads its own open
conversation on `[activeId, revision]`. That one dependency covers opening a
thread, a reply arriving over Realtime, the poll, and a send reconciling —
replacing the widget's old hand-rolled `refresh()` closure entirely.

Write actions are optimistic first, reconciled after:

| Action | Optimistic | Then |
|---|---|---|
| `markRead(id, role)` | stamps my read column locally | `markThreadRead` (fire and forget) |
| `openThread(id, role)` | marks read | returns the messages |
| `send(id, body, role)` | `applySentMessage` | `refresh()` |
| `startThread(input)` | prepends the new thread | `refresh()` |
| `setStatus(id, status)` | only if the UPDATE succeeded | `refresh()` |

`applySentMessage` is a deliberate mirror of the `support_after_message` trigger
in `support_messaging.sql` — `last_message_at`, `left(body, 140)`,
`last_sender_role`, **reopen the thread**, and stamp the sender's own read
marker. Copying the trigger is what makes the list settle instantly instead of
one round-trip later; the test asserts each of those five facts against the SQL.

Two decisions worth arguing with:

- **`available === false` does NOT stop the poll.** `fetchThreads` reports
  `'unavailable'` for a transient network failure exactly as it does for a
  missing table. Stopping would hide messaging until a full page reload, so the
  timer keeps running and the flag recovers on the next tick.
- **`refresh()` dedupes concurrent callers** into one in-flight promise. A
  Realtime burst (three `postgres_changes` events for one send) and the poll
  would otherwise stampede the same query.

`filterThreads(threads, { query, status })` lives here too rather than in the
component: it is list logic, it is pure, and it is the one piece of the view
worth locking down with tests.

### 1.2 `SupportWidget` refactored — behaviour unchanged

Deleted from the component: `available`/`threads` state, `loadThreads`,
`loadMessages`, `markReadIfNeeded`, `activeIdRef`, the `subscribeToSupport` call,
the `setInterval`, and the `userId` prop (its only job was re-running that
effect; sign-out now calls `supportStore.reset()` in App). What is left is
genuinely panel-local: open/closed, which thread, that thread's messages, the
draft, the busy flag, the Open/Closed filter.

Everything a user can see is the same — the badge, the one-conversation
auto-open, the founder chips, Enter-to-send, close/reopen, the hidden-when-
unavailable rule.

### 1.3 `MessagesView.tsx` + `MessagesView.css`

Rendered inside `ToolView` (App supplies the title, so it is **"Inbox"** for
founders and **"Messages"** for everyone else, each with its own one-line
description), `wide`, spacing from the shell's scale — `2rem` panel padding,
`1.2rem` list rows, `1.5rem` minimum gap, no literal hex, lucide only.

```
┌ 34rem ─────────────┐┌ 1fr ───────────────────────────┐
│ search             ││ who · workspace · status  [Close]│
│ [Open 3][Closed][All]│                                 │
│ ● ana@shop.com  2h ││  messages, oldest → newest       │
│   Rack City · the… ││  (closed notice when closed)     │
│ …                  ││  ───────────────────────────     │
│ [+ New conversation]││  composer · Enter sends          │
└────────────────────┘└─────────────────────────────────┘
```

- **Search** covers email / workspace / subject / preview (`filterThreads`).
- **Founder chips** Open / Closed / All with live counts; ordering is
  `sortThreads` — open before closed, **unread first**, then newest.
- **Unread dot** is an element, not a `::before`, so the flex row still
  truncates the label; a visually-hidden "(unread)" carries the same fact to a
  screen reader.
- **Keyboard:** Up/Down walk the list while focus is inside it — the handler
  sits on the list container, reads the focused row's `data-thread-id`, selects
  the neighbour and moves focus to it.
- **Selecting a thread marks it read for my role**, same rule as the widget
  (`supportActions.markRead`, a no-op when already read).
- **Composer:** Enter sends, Shift+Enter newlines, with the hint spelled out.
  A user starting a conversation also gets an optional Subject field — the API
  always supported `subject`, nothing surfaced it.
- **Empty states** use the `EmptyState` primitive: no threads, nothing matching
  a search, nothing selected, and "messaging isn't available" when the tables
  are missing. Loading is a plain `.mv-loading` line.
- **≤ 1024px** the grid collapses to one column and `data-open` (set on every
  viewport, consulted only inside the media query) shows the list *or* the
  conversation, with the `.mv-back` "All conversations" control appearing.

### 1.4 App wiring

- `'messages'` added to the exported `ActiveView` union.
- `MessagesNavButton` — a small module-scope component in `App.tsx`, **not** an
  inline branch. Mounting `useSupportThreads` is what starts the channel and the
  poll, and App's header only renders for a signed-in user; putting the hook in
  App's body instead would have queried `support_threads` from the logged-out
  landing page and left `available` false for up to 45 s after sign-in.
- Lazy-loaded like the other tool views (`MessagesView`, 12.6 kB / 4.4 kB gz).
- `.app-header .nav-badge` in `App.css` — the nav is the one inverted surface
  (CLAUDE.md §1), so it sets its own literal `#ffffff` on `var(--danger)` and
  reads correctly both outlined-on-black and filled-white-when-active.
- `handleSignOut` calls `supportStore.reset()` so the next person on the machine
  never sees a flash of the previous account's conversations.

**The waitlist branch has no header** — it is `WaitlistGate` + `SupportWidget`
only — so there was nothing to add a button to. Waitlisted users keep the
floating widget exactly as before.

---

## 2. Tests

`src/lib/supportStore.test.ts` — 15 tests, `vi.mock('./supabase')` with the
existing `createSupabaseMock` pattern.

| Group | Locks in |
|---|---|
| pure transitions | read stamp on the right column + same-array return on a no-op; `applySentMessage` matching the SQL trigger field by field; the 140-char preview truncation; `applyStatus`; `filterThreads` across all four searched fields and the status chip |
| ref-counting | first subscriber opens ONE channel, three subscribers still one, only the last unsubscribe removes it, re-subscribing opens a fresh one; the initial fetch happens once |
| lifecycle | `available: false` on a missing table **with the poll still running**; concurrent `refresh()` collapsing to one query |
| optimistic + reconcile | `markRead` clearing unread before the DB write and no-opping twice; `send` patching the row while the SELECT still serves the stale one, then the refetch putting the server row back; a failed insert leaving the list identical; `setStatus` applying only on success; `startThread` not duplicating after its refetch; `reset` clearing and stopping |

`src/lib/testing/supabaseMock.ts` gained a Realtime stub (`channel()` /
`removeChannel()` plus `channels` / `removedChannels` counters) — additive,
test-only, no existing test touched.

| Gate | Before | After |
|---|---|---|
| `npm test` | 513 / 36 files | **528 / 37 files** from this pass (562 / 38 with the concurrent Finance module in the tree) |
| `npm run build` | clean | **clean** |
| `npx eslint .` | 254 problems | **254 problems** — unchanged, and **zero findings on any file this pass added or edited** |

react-hooks v7: no synchronous `setState` in an effect anywhere (the obvious
"clear the selection when a search filters it out" effect was deliberately not
written — see the comment in `MessagesView.tsx`), and no ref writes during
render.

---

## 3. What I could not verify

**Nothing was verified visually or against a live database.** This environment
cannot sign in to Supabase, there is no headless browser, and adding one breaks
the no-new-dependencies rule. The dev server on :5173 was left alone. Specifically
unverified:

- Whether `calc(100vh - 34rem)` is the right page height. The number is
  arithmetic: ~26rem of header + ToolView title block, 6rem of ToolView bottom
  padding, and 2rem so the Send button clears the floating FAB (which is fixed
  at `bottom: 1.75rem` and ~40px tall, and deliberately still there on this
  page because the brief said keep the widget as-is). If the composer and the
  FAB still touch, that one number is the fix.
- Whether `34rem` is the right thread-column width, and whether the ≤1024px
  stack reads well on a real phone.
- Realtime was exercised only through the mock: `subscribeToSupport` is called
  once and removed once, but no `postgres_changes` payload was ever delivered.
- The unread badge on the black nav was reasoned about from the tokens, not seen.

---

## 4. CLAUDE.md lines for the orchestrator to add

**§5 (folder structure), under `components/`:**

```
│   ├── MessagesView.tsx       # 'messages' view. Full-page Messages (users) / Inbox (founders):
│   │                          # searchable thread list + conversation, Up/Down keyboard nav,
│   │                          # founder Open/Closed/All chips, unread-first, stacks ≤1024px.
│   │                          # Reads supportStore — no fetching of its own.
│   ├── MessagesView.css
```

**§5, under `lib/`:**

```
│   ├── supportStore.ts        # Dependency-free shared store (useSyncExternalStore, mirrors
│   │                          # workflowStore). SOURCE OF TRUTH for the support thread list, and
│   │                          # OWNER of the single Realtime subscription + single 45 s poll —
│   │                          # started by the first subscriber, stopped by the last. SupportWidget
│   │                          # and MessagesView both consume it via useSupportThreads(role).
│   │                          # Optimistic writes (send/markRead/setStatus/startThread) mirror the
│   │                          # support_after_message trigger, then refetch. Tested.
```

**§6 (route map), new row:**

| Messages / Inbox | `activeView === 'messages'` | `<MessagesView />` inside `<ToolView>` |

**§9 (external integrations → Supabase), append to the Realtime line:**

> Support messaging's `postgres_changes` subscription is owned by
> `src/lib/supportStore.ts` and reference-counted: however many front ends are
> mounted (the floating widget, the Messages view, the header badge), there is
> exactly ONE channel and ONE 45 s poll timer. Do not call `subscribeToSupport`
> from a component.

**§15 (What's done), new bullet:**

> ✅ **Full-page Messages view + shared support store** (Sept 2026) — the
> founder asked for "a messages view i can access" alongside the floating
> widget, so messaging became a tenth `activeView`: `MessagesView.tsx` (searchable
> thread list beside a full-height conversation; founder Open/Closed/All chips
> with unread-first ordering and an unread dot; Up/Down keyboard navigation;
> Enter-to-send composer with an optional subject on a new conversation; stacks
> to one column with a Back-to-list control ≤1024px), reached from a header
> **Messages/Inbox** button available to every signed-in user with a
> `.nav-badge` unread count. The widget is unchanged in behaviour but no longer
> owns its data: `src/lib/supportStore.ts` holds the thread list and
> reference-counts ONE Realtime channel + ONE 45 s poll across all consumers,
> with optimistic writes that mirror the `support_after_message` trigger and a
> `revision` counter each consumer reloads its own messages from. `handleSignOut`
> resets the store. 15 tests (`supportStore.test.ts`); `supabaseMock` gained a
> Realtime stub.

**§18 (Do Not), candidate new entry:**

> **Do not call `subscribeToSupport` or start a poll from a support UI
> component.** `supportStore` owns both, reference-counted; a second channel
> means two thread lists that drift apart the moment one of them writes, and the
> optimistic-write reconciliation stops being observable.

---

## 5. Summary

1. `src/lib/supportStore.ts` (new) — dependency-free `useSyncExternalStore` store
   holding the thread list + availability, owning ONE Realtime channel and ONE
   45 s poll, started by the first subscriber and stopped by the last.
2. `SupportWidget.tsx` consumes it; its own subscription, timer, thread state
   and `userId` prop are gone. Behaviour unchanged.
3. `MessagesView.tsx` + `.css` (new) — the full page inside `ToolView`: search,
   founder status chips, unread-first list with a dot, Up/Down keyboard nav,
   conversation + composer, EmptyState everywhere, stacks at ≤1024px.
4. `App.tsx` — `'messages'` in `ActiveView`, a lazy view branch, a
   `MessagesNavButton` (its own component so logged-out visitors never query),
   `supportStore.reset()` on sign-out; `.app-header .nav-badge` in `App.css`.
5. 15 new tests in `supportStore.test.ts`; `supabaseMock` gained a Realtime stub.
6. Gates: **562 tests pass**, `npm run build` clean, eslint **254 = baseline**,
   zero findings on touched files.
7. Not verified: anything visual, and Realtime beyond the mock.
