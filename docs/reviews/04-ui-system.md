# 04 — UI Primitive System (`src/components/ui/`)

**Status:** built, tested, **not yet adopted.** Nothing outside `src/components/ui/`
was touched. Adoption is a separate, screen-by-screen step — see the plan at the end.

**Verification:** `npm test` 305 passed (229 pre-existing + 76 new) · `npm run build`
clean · `npx eslint .` **311 problems — exactly the documented baseline**, zero added.

---

## 1. Why this exists

The app had grown four independent definitions of `.button` (`App.css:218`,
`CategoriesManager.css:304`, `CategoryPresetsManager.css:324`,
`ComprehensiveProductForm.css:115`) with **different colours for the same class name**,
nine hand-rolled modal overlays with four different z-indexes and no shared focus
behaviour, six copy-pasted two-step confirm pairs, and a tab row (`OrgPanel.css:529`)
with no `role="tablist"`, no `aria-selected`, and no arrow keys.

Each of those is cheap to write once and expensive to write nine times — not because
of the CSS, but because **the accessibility work was only ever done zero times.** A
focus trap, a roving tabindex, and `aria-describedby` wiring do not get retro-fitted
into nine copies; they get built once into a primitive.

## 2. What the tokens buy, and the one rule

Every primitive resolves **all** colour, type, spacing, radius, and motion through
`src/index.css`. There is **no hex literal anywhere in `src/components/ui/`** except one
deliberate scrim (documented in `Dialog.css`: `rgba(0,0,0,0.55)`, because no `--*-dim`
token is opaque enough to separate a white modal from a white page, and a neutral black
alpha survives a palette swap where a brand colour would not).

That is not tidiness — it is the property that lets this app ship violet-on-dark,
bone-on-dark, and monochrome variants from one ~45-line `:root` edit. A single hardcoded
hex in a shared primitive would break that for every screen at once.

Three token conventions the primitives lean on hard:

| Convention | Where it shows up |
|---|---|
| **Solid fills set `color: var(--ink-950)`** — white today, so black fill + white label falls out free, and the pair inverts together | `.ui-btn--primary`, `.ui-btn--danger`, `.ui-icon-btn--primary` |
| **`--ink-800` (modals) is LIGHTER than `--ink-850` (cards)** — on a light theme elevation moves *toward* white | `.ui-dialog`, `.ui-toast`, `.ui-stat` |
| **`--border-control`, not `--border`, on interactive edges** — WCAG 1.4.11 wants 3:1 and the decorative border tokens do not reach it | `.ui-btn--secondary`, `.ui-input`, `.ui-chip--quiet` |

**Type is px (`--fs-*`), spacing is rem.** The root is pinned at 9px for the spacing
grid, so rem paddings alone produce unhittable controls. Every interactive primitive
therefore sets an explicit **`min-height` in rem** (24 / 32 / 40px at the three sizes)
and lets padding be cosmetic.

**Contrast bar is 4.5:1 for everything.** At a 9px root nothing in this UI qualifies for
WCAG's large-text exemption (that needs 18.66px bold / 24px regular). `--text-muted` is
reserved for genuinely non-essential meta; the sentence that tells a user what to do
next (`EmptyState` description) uses `--text-secondary`.

**One caution, inherited from the design system:** the nav (`.app-header`, `.ld-nav`) is
a deliberately inverted black bar whose children set literal light foregrounds. A
primitive dropped in there will draw black-on-black. Those bars need their own explicit
overrides at adoption time; the primitives do not carry nav-specific rules.

## 3. Architecture

```
src/components/ui/
  index.ts          barrel — COMPONENTS AND TYPES ONLY (see below)
  base.css          .ui-sr-only, the shared focus ring, the solid-fill hover wash
  Button.tsx/.css        Button, LinkButton
  IconButton.tsx/.css    IconButton                    (label required at the type level)
  Chip.tsx/.css          Chip, ToggleChip, RemovableChip
  Badge.tsx/.css         Badge, CountBadge
  Tabs.tsx/.css          Tabs, TabList, Tab, TabPanel
  Dialog.tsx/.css        Dialog, DialogFooterSpacer
  ConfirmAction.tsx/.css ConfirmAction
  Field.tsx/.css         Field, TextField, TextareaField, SelectField
  EmptyState.tsx/.css    EmptyState
  Spinner.tsx/.css       Spinner, Skeleton, SkeletonText
  Toast.tsx/.css         Toast, ToastViewport
  StatTile.tsx/.css      StatTile, StatGrid
  testUtils.tsx     mount/click/keyDown harness (createRoot + act; NOT a test file)
  *.test.tsx        Tabs (13) Dialog (17) ConfirmAction (13) Field (13) controls (20)
```

**Composition rules.**

1. **One CSS file per component, class prefix `ui-`, single-class selectors.**
   `index.css` styles the bare `button` / `input` elements; a single class (0,1,0)
   outranks an element selector (0,0,1), so **no primitive needs `!important`.** Keep
   selectors flat or that property is lost.
2. **`className` is always appended, never replaced** — so a screen can still add a
   layout class (`.batch-actions .button` style grid participation) without forking.
3. **Presentational, not stateful.** No provider, no context crossing a file boundary,
   no data fetching. `Tabs` has an internal context; it is not exported.
4. **`index.ts` exports components and types only.** `eslint-plugin-react-refresh`
   requires a module to export components exclusively, so one lowercase value export
   (a hook, a constant) there would cost a lint finding and break Fast Refresh for every
   screen importing the barrel. This is *why* `ToastViewport` is state-free rather than a
   `ToastProvider` + `useToast` pair — see §4.
5. **`forwardRef` wherever a DOM node is expected** (`Button`, `LinkButton`,
   `IconButton`, `Chip`, `ToggleChip`, `TextField`, `TextareaField`, `SelectField`).
   `ConfirmAction` needs `Button`'s ref to focus the commit control; `Dialog` needs a
   caller's ref for `initialFocusRef`.
6. **Polymorphism only where semantics genuinely differ.** No `as` / `asChild`. A control
   that navigates is an anchor with anchor semantics, so it is a separate export
   (`LinkButton`) rather than a prop that can silently produce a non-focusable `div`.

## 4. API design, per component

Common to all: `className` appended; lucide icons in `icon` slots (**never emoji** —
AGENTS.md §1); state that a screen reader must know is carried by an ARIA attribute and
**the CSS keys off that attribute**, so the visual and the announced state cannot drift.

### Button / LinkButton
`variant` `primary | secondary | ghost | danger | danger-quiet` · `size` `sm | md | lg`
· `icon` · `iconTrailing` · `loading` · `fullWidth`

- **Defaults to `secondary`**, so a forgotten prop never promotes a button to primary.
- **`type="button"` by default** — an untyped `<button>` inside a form submits it.
- `danger-quiet` is the fifth variant because it is the app's *dominant* destructive
  idiom (outline at rest, fills on hover: `.org-member-remove`, `.ptb-btn--danger`,
  `.org-icon-danger`). Modelling it as a variant avoids six one-off classes.
- `loading` keeps the label mounted (the button cannot resize mid-action and shift its
  row), sets `aria-busy`, disables, and renders a **decorative** spinner — `aria-busy`
  already carries the announcement, so a nested `role="status"` would say it twice.
- `LinkButton` forces `rel="noopener noreferrer"` on `target="_blank"`, and a disabled
  link drops `href` while keeping `aria-disabled` (anchors cannot be `disabled`).

### IconButton
`label` **(required)** · `icon` · `variant` `primary | secondary | ghost | danger` ·
`size` · `round`

`label` is required *at the type level* — the missing accessible name on a glyph-only
control is the single most common a11y regression in an icon-heavy UI, so the compiler
catches it instead of an audit. It doubles as `title` unless `title` is passed. Pass
`aria-pressed` for a toggle; the "on" look is selected by that attribute.

### Chip / ToggleChip / RemovableChip
`ToggleChip`: `pressed` + `onPressedChange(next)` → renders `aria-pressed`.
`Chip`: clickable pill with **no** persistent state. `RemovableChip`: label + dismiss.

`aria-pressed`, not `aria-selected`: these are independent filters, not one-of-N tabs.
When the options are mutually exclusive *and each swaps a panel*, use `Tabs`.
`RemovableChip` renders **two sibling buttons**, never nested — interactive content
inside a `<button>` is invalid HTML and the inner control is unreachable in several
screen readers. With no `onClick`, the label half is a plain `<span>` (one tab stop,
not a disabled button pretending to be a label).

### Badge / CountBadge
`tone` `neutral | accent | success | warning | danger | info | gold` · `size` · `caps` ·
`outline` · `icon`

A `<span>` with **no role** — a badge is never clickable; if it responds to a click it is
a `ToggleChip`. `caps` is opt-in because uppercasing user data (a plan name, a tag)
misrepresents it. `CountBadge` renders `null` at zero (so callers do not each need the
guard) and requires `label` — a bare "3" tells a screen-reader user nothing.

### Tabs (`Tabs` / `TabList` / `Tab` / `TabPanel`)
`Tabs`: `value` · `onValueChange` · `activationMode` `automatic | manual`.
`TabList`: `label` **(required)**. `Tab`: `value` · `icon` · `count` · `disabled`.
`TabPanel`: `value` · `keepMounted`.

Controlled only — the selected tab is already in the parent's state (it drives what gets
fetched), so an internal copy could only drift. **Roving tabindex:** exactly one tab is
a tab stop, so Tab reaches the set once, not once per tab. Left/Right and Up/Down move
with wrap, Home/End jump to the ends, **disabled tabs are skipped**, and the panel is
`tabIndex={0}` so Tab from the tablist lands on the content. `activationMode="manual"`
moves focus without selecting — use it when mounting a panel fires a fetch, so arrowing
past it is free. Tab order is read from the DOM rather than a registry, because the DOM
already *is* the order and a registry would need syncing with conditional tabs (the
Users tab hides pre-migration).

### Dialog
`open` · `onClose` · `title` · `titleIcon` · `description` · `size`
`sm|md|lg|xl|full` · `footer` · `initialFocusRef` · `closeOnEscape` ·
`closeOnOverlayClick` · `hideCloseButton`

- `role="dialog"` `aria-modal="true"`, labelled by its own title, described by
  `description` when given.
- **Focus:** moves in on open (or to `initialFocusRef` — point it at Cancel for a
  destructive dialog so a stray Enter cannot commit), traps Tab/Shift+Tab at the ends,
  and **restores to the invoking element on close**.
- **Escape closes only the topmost dialog** — a module-level stack, because every open
  dialog listens on `document` and without it a nested confirm and its parent both close
  on one keypress. Bubble phase, so an inner control can still `stopPropagation` to
  protect a draft (the convention already in `KanbanCardDetail`).
- **Scroll lock is reference-counted** — a per-dialog lock restores body scroll when an
  inner dialog closes, *while a modal is still up*.
- A scrim click whose press **started inside the panel** does not dismiss (text
  selection, a slider drag).
- **Portal-free on purpose.** The overlay is `position: fixed`, so it already escapes
  every ancestor's layout; staying in place keeps auth/org/toast context available
  without a provider re-mount. The one thing a portal would buy — escaping an ancestor
  `overflow: hidden` — does not apply to a fixed element.
- Z-index budget, chosen to preserve today's stacking: dialogs 1000 · support widget
  5000 · **toasts 9000 (above dialogs on purpose** — a save failure raised inside a modal
  must be visible over it) · debug toggle 9999.

### ConfirmAction
`label` · `confirmLabel` · `cancelLabel` · `prompt` · `onConfirm` · `tone`
`danger | neutral` · `size` · `disabled` · `icon` · `armed?` + `onArmedChange?`

`window.confirm()` is banned (Do Not #12 — it blocks the event loop mid-auto-save and
cannot be styled or tested), so every destructive control grew its own `confirmKey` plus
a copy-pasted yes/no pair. This is that pattern, once. Arming moves focus to the commit
button (Enter → Enter), Escape disarms **and stops propagating** (so it does not also
close the surrounding `Dialog`), and focus leaving the group disarms it. Uncontrolled by
default; the optional `armed` / `onArmedChange` pair maps **1:1 onto the existing
`confirmKey` state** for lists that allow only one armed row.

### Field / TextField / TextareaField / SelectField
`label` · `hint` · `error` · `required` · `caps` · `inline` · `counter{value,max}` ·
`labelHidden`

`Field` owns the id wiring: `<label for>` → control `id`, and `aria-describedby`
pointing at the hint and/or error. **Error id comes first** — `aria-describedby` is read
in sequence and the blocking problem should be heard before the example. `error` also
sets `aria-invalid` (which is what the red edge is selected by) and renders in a
`role="alert"` node, so a post-submit message is announced without re-focusing the
field. The `*` is `aria-hidden` because `aria-required` already carries the meaning.

Children may be a **render callback** receiving the wired props. Cloning was rejected:
`cloneElement` silently drops props through a wrapper component and cannot be
type-checked against an unknown child. The three convenience wrappers hide the callback
for the 95% case. `counter` exists for the Shopify limits in `constants/fieldLimits.ts`
(SEO title 70).

### EmptyState · Spinner / Skeleton · Toast · StatTile
- **EmptyState** — `title` (noun phrase, not an apology) · `description` · `icon` ·
  `actions` (the action that *fixes* the emptiness first) · `inline` · `error`.
  `role="status"` only when `error`; a genuinely empty list is content, not an event.
- **Spinner** — `decorative` for any spinner inside something that already announces
  busy; otherwise it renders `role="status"` + a visually-hidden `label`. **Skeleton** is
  always `aria-hidden` (it is a picture of absent content) and is deliberately *not*
  `.lazy-skeleton`, which is owned by `LazyImg` and image-shaped.
- **Toast / ToastViewport** — state-free by design. App.tsx already owns a `toasts`
  array and `addToast`, so migration is a JSX swap with no change to how toasts are
  created, and the queue policy (cap, dedupe, ordering) stays in app code where the
  product decision lives. **One** live region wraps the whole stack — a region per toast
  re-announces the entire stack on every addition. The auto-dismiss timer lives in
  `Toast` because the component that owns the unmount is the one that can clear it;
  `duration={0}` pins a toast open (always do this for a `danger` toast reporting lost
  work, and for any toast with an `action`).
- **StatTile / StatGrid** — `delta.direction` (the arrow) and `delta.sentiment` (the
  colour) are **separate props**: "up" is not always good, and a rising failed-export
  count must be able to render red while a rising listing count renders green. Tabular
  figures so a ticking counter does not jitter its own width.

## 5. Usage — real screens, rewritten

**OrgPanel member row** (`OrgPanel.tsx:605-627` → `Badge` + `SelectField` + `ConfirmAction`).
One `confirmKey` still governs the list, so only one row can be armed:

```tsx
<div className="org-member-row">
  <span className="org-member-email">{m.email}</span>

  {isAdmin ? (
    <SelectField label="Role" labelHidden inputSize="sm" value={m.role} disabled={busy}
      options={[...(isOwner ? [{ value: 'owner', label: 'Owner' }] : []),
                { value: 'admin', label: 'Admin' }, { value: 'member', label: 'Member' }]}
      onChange={(e) => handleRoleChange(m, e.target.value as OrgRole)} />
  ) : (
    <Badge tone={m.role === 'owner' ? 'gold' : m.role === 'admin' ? 'accent' : 'neutral'} caps>
      {m.role}
    </Badge>
  )}

  {isAdmin && m.user_id !== myUserId && (
    <ConfirmAction
      label="Remove" prompt={`Remove ${m.email}?`} disabled={busy}
      onConfirm={() => handleRemove(m.user_id)}
      armed={confirmKey === `remove:${m.user_id}`}
      onArmedChange={(on) => setConfirmKey(on ? `remove:${m.user_id}` : null)} />
  )}
</div>
```

**OrgPanel shell + tabs** (`OrgPanel.tsx:490`, `:529` → `Dialog` + `Tabs`). The dialog
brings the focus trap, Escape, scroll lock and focus restore that the hand-rolled
overlay never had; `Tabs` brings the tablist role and arrow keys:

```tsx
<Dialog open onClose={onClose} title={org.name} titleIcon={<Building2 />} size="md">
  <Tabs value={tab} onValueChange={setTab} activationMode="manual">
    <TabList label="Workspace sections">
      <Tab value="members" icon={<Users />}>Members</Tab>
      <Tab value="shopify" icon={<Store />}>Shopify</Tab>
      {allUsers.length > 0 && <Tab value="users" icon={<UserCog />}>Users</Tab>}
    </TabList>
    <TabPanel value="members">{/* … */}</TabPanel>
    <TabPanel value="shopify">{/* … */}</TabPanel>
    <TabPanel value="users">{/* … */}</TabPanel>
  </Tabs>
</Dialog>
```

`activationMode="manual"` matters here: the Users tab fires a cross-workspace RPC, so
arrowing past it must not trigger the fetch.

**Library `prompt()` replacement** (`Library.tsx:1815-1840`) — currently a bespoke
overlay with its own inline Escape handler:

```tsx
<Dialog open={!!promptModal} onClose={promptModal.onCancel} title={promptModal.title}
  size="sm" initialFocusRef={inputRef}
  footer={<>
    <Button onClick={promptModal.onCancel}>Cancel</Button>
    <Button variant="primary" onClick={() => promptModal.onConfirm(value)}>Rename</Button>
  </>}>
  <TextField ref={inputRef} label="Batch name" labelHidden value={value}
    hint="Shown on the batch card in Library."
    onChange={(e) => setValue(e.target.value)} />
</Dialog>
```

**Step 2 photo toolbar** (`ImageGrouper.tsx:2434-2500` → `ToggleChip` + `Button`).
`photoSelectMode` becomes a real `aria-pressed` toggle instead of a class:

```tsx
<div className="photo-toolbar">
  <ToggleChip pressed={photoSelectMode} strong icon={<Crosshair />}
    onPressedChange={setPhotoSelectMode}>Pick photos</ToggleChip>
  <Button size="sm" icon={<RotateCcw />} onClick={() => rotateSelected(-90)}
    disabled={!picked.size}>Rotate {picked.size}</Button>
  <ConfirmAction label={`Delete ${picked.size}`} prompt="Delete selected photos?"
    disabled={!picked.size} onConfirm={handleDeleteSelected} />
</div>
```

**App.tsx toast stack** (`App.tsx:3052-3060`) — App keeps owning the array:

```tsx
<ToastViewport>
  {toasts.map((t) => (
    <Toast key={t.id} tone={t.tone ?? 'info'} message={t.message}
      duration={t.tone === 'danger' ? 0 : 4000}
      onDismiss={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))} />
  ))}
</ToastViewport>
```

**Library empty state** (`Library.tsx:1965`, `:2000`, `:2035` — three copies):

```tsx
<EmptyState icon={<FolderOpen />} title="No batches yet"
  description="Upload a folder of photos in Step 1 to start your first batch."
  actions={<Button variant="primary" icon={<Upload />} onClick={onClose}>Go to upload</Button>} />
```

**Analytics KPI row** (`AnalyticsPanel.tsx:199-205`):

```tsx
<StatGrid>
  <StatTile label="Listings" value={compactNumber(products)}
    delta={{ text: '+12%', direction: 'up' }} hint="vs. last 30 days" />
  <StatTile label="Failed exports" value={failed}
    delta={{ text: '+3', direction: 'up', sentiment: 'inverse' }} />
</StatGrid>
```

## 6. Best practices

1. **Never restate a primitive's colours in a screen's CSS.** If a variant is missing,
   add the variant — a `.library-content .ui-btn { background: … }` override reintroduces
   exactly the drift this replaces.
2. **State that a user must perceive goes in an ARIA attribute, and the CSS selects off
   it.** `aria-pressed`, `aria-selected`, `aria-invalid`. Deleting the attribute then
   also deletes the highlight, which makes the bug visible instead of silent.
3. **A click handler on a non-button is a bug.** `Chip`/`ToggleChip`/`Tab` exist so a
   clickable thing is focusable.
4. **Pin destructive and actionable toasts** (`duration={0}`). A user should never race
   a timer to reach Retry.
5. **Point `initialFocusRef` at the safe control** in a destructive dialog.
6. **Prefer `ConfirmAction` over a confirm `Dialog`** for row-level destruction — it is
   in place, needs no scrim, and is the pattern users of this app already know.
7. **Announce once per region.** `decorative` on nested spinners; one live region per
   toast stack.
8. **Adopt a screen at a time and delete the old CSS in the same commit.** A half-migrated
   stylesheet is worse than either end state: `.button` keeps four definitions *and* gains
   a fifth.

## 7. Adoption plan

Ordered by payoff ÷ risk. Each row is one commit. **Rule: delete the replaced CSS in the
same commit**, and re-run `npm run lint` to confirm the 311 baseline has not moved.

| # | Existing pattern (file:line) | Primitive | Payoff | Risk | Notes |
|---|---|---|---|---|---|
| 1 | `.org-confirm-actions/-yes/-no` `OrgPanel.css:270-298`; usages `OrgPanel.tsx:618,696,865,1013,1111` | `ConfirmAction` | High | **Low** | Pure leaf swap. `confirmKey` state stays; pass `armed`/`onArmedChange`. Gains focus-on-arm + Escape. |
| 2 | `.kanban-confirm/-yes/-no` `KanbanBoard.css:325-358`; usages `KanbanBoard.tsx:431`, `KanbanCardDetail.tsx:208,295,485` | `ConfirmAction` | High | **Low** | Same shape as #1. Removes the 2nd copy of the pattern. |
| 3 | `.org-role-badge`+`-owner/-admin` `OrgPanel.css:130-143`, `.org-plan-badge` `:219`, `.crm-tag`/`.crm-source` `:765`, `.sw-badge` `SupportWidget.css:39` | `Badge`, `CountBadge` | High | **Low** | Presentational only, no behaviour to preserve. `sw-badge` → `CountBadge` (gains the accessible name). |
| 4 | `.empty-state` ×3 `Library.tsx:1965,2000,2035` + `Library.css:83-107`; `CategoriesManager.css:165`; `CategoryPresetsManager.css:77`; `.sw-empty`; `.kanban-lane-empty` | `EmptyState` | High | **Low** | Kills the `!important` font overrides on `.empty-subtitle`. |
| 5 | `.an-tile*` `OrgPanel.css:668-679`; usages `AnalyticsPanel.tsx:199-205` | `StatTile`, `StatGrid` | Med | **Low** | Add `sentiment: 'inverse'` to any "bad when rising" metric while converting. |
| 6 | `.beta-chip(--active)` `OrgPanel.css:341-357` @ `OrgPanel.tsx:815`; `.sw-chip(--on)` `SupportWidget.css:100` @ `SupportWidget.tsx:225,228` | `ToggleChip` | High | **Low** | Adds `aria-pressed` — currently these filters are invisible to a screen reader. |
| 7 | `.org-icon-btn`/`.org-icon-danger` `OrgPanel.css:230-247` (8 uses), `.sw-icon-btn`/`.sw-send`, `.org-panel-close`, `.button-close`, `.button-icon`, `.toast-dismiss` | `IconButton` | High | **Low** | Every one of these currently relies on `title` alone for its name. |
| 8 | `.toast-stack`/`.toast-item`/`.toast-dismiss` `App.css:652-697` @ `App.tsx:3052-3060` | `ToastViewport`, `Toast` | Med | **Low** | App keeps the array; JSX-only swap. Pin `danger` toasts. |
| 9 | `.org-invite-btn` `OrgPanel.css:85` @ `OrgPanel.tsx:570,730,794`; `.org-member-remove` `:146` | `Button` (`primary` / `danger-quiet`) | Med | **Low** | Do after #1 so remaining `.org-member-remove` uses are only the non-confirm ones. |
| 10 | `.ptb-btn` + 5 modifiers `ImageGrouper.css:1425-1455` @ `ImageGrouper.tsx:2434-2500` | `Button`, `ToggleChip` | High | **Med** | `photo-pick-toggle` becomes a real `ToggleChip`. Verify the sticky toolbar layout still holds. |
| 11 | `.org-tabs`/`.org-tab(--on)` `OrgPanel.css:529-556` @ `OrgPanel.tsx:529` | `Tabs` | High | **Med** | Biggest a11y win. Use `activationMode="manual"` — the Users tab fires an RPC. |
| 12 | `.view-tab` `Library.tsx:1844,1851,1858` | `Tabs` | Med | **Med** | Library's tab switch also drives scroll refs (`Library.tsx:162`); keep those. |
| 13 | `.org-invite-form input\|select` `OrgPanel.css:64-82`, `.desc-settings-field` `:487-511`, `.crm-fields` `:782-784`, `.sw-composer textarea` `SupportWidget.css:183` | `TextField`, `SelectField`, `TextareaField` | High | **Med** | These are label-by-adjacency today — real naming bug. Do panel by panel, not all at once. |
| 14 | `.prompt-modal-overlay` `Library.tsx:1815` (the `prompt()` replacement) | `Dialog` + `TextField` | Med | **Med** | Smallest modal: use it to prove the Dialog swap before the big ones. |
| 15 | `.org-panel-overlay` `OrgPanel.css:1` @ `OrgPanel.tsx:490` | `Dialog` | High | **Med** | Do after #14. Watch the `beforeunload`-adjacent unsaved-settings state — consider `closeOnOverlayClick={false}`. |
| 16 | `.vocab-overlay` `VocabDashboard.tsx:275`; `.kanban-overlay` `KanbanBoard.tsx:349`; `.categories-manager-overlay` `CategoriesManager.tsx:194,203`; `.presets-manager-overlay` + `.preset-form-overlay` `CategoryPresetsManager.tsx:599,612,651` | `Dialog` | High | **Med** | The nested preset-form-over-manager case is why Dialog stacks Escape and ref-counts the scroll lock. |
| 17 | `.button`/`-primary`/`-secondary`/`-danger` `App.css:218-277` @ `App.tsx:2575-2841` etc. | `Button` | High | **High** | **Last.** Four conflicting definitions of the same class (`App.css:218`, `CategoriesManager.css:304`, `CategoryPresetsManager.css:324`, `ComprehensiveProductForm.css:115`), and `.batch-actions .button` (`App.css:322`) sets `flex:1`/`min-width:200px` — that layout rule must move to the wrapper, not the primitive. |
| 18 | `.ai-settings-modal`, `.saved-products-modal`, `.field-modal-overlay` | `Dialog` | Low | Low | Dead/unused components. Convert only if they are revived. |
| — | `.lazy-skeleton` `index.css:359` (LazyImg) | *keep* | — | — | **Do not migrate.** Image-shaped and owned by `LazyImg`; `ui-skeleton` is the text/block placeholder. |
| — | `.app-header`, `.ld-nav` | *special* | — | — | Deliberately inverted surfaces. Any primitive placed there needs explicit light overrides first. |

**Suggested batching:** #1–#9 are all low-risk leaves and can land as one short series
with no layout review. #10–#13 want a visual pass per screen. #14–#16 are the Dialog
migration and should land together with a keyboard sweep (Escape, Tab trap, focus
restore) on each converted modal. #17 last, on its own, because it touches every screen.
