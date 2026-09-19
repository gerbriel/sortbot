# 22 — Founder console

**Founder's brief:** *"The founding workspace dashboard should have a way to manage
other orgs, approve new orgs, set permissions etc. and onboard beta workspaces."*

**Date:** 19 Sept 2026 · **Nothing committed** · **No SQL run against Supabase.**

| Gate | Result |
|---|---|
| `npx vitest run` | **1696 passed / 79 files** (baseline 1670 / 77 → +26 tests, +2 files) |
| `npm run build` | clean; the `supabase.ts is dynamically imported by …` warning is pre-existing |
| `npx eslint .` | **252 problems** — exactly the recorded baseline |
| SQL | 33 scenarios on a throwaway Postgres 14, both migration orders (§4) |
| Screenshots | 1280 + 390, `docs/reviews/img-22/` (§5) |

---

## 1. What was actually wrong

Three of the founder's four asks already existed — and all three were buried inside
the **Workspace dashboard**, a page that is otherwise entirely about the workspace
you are signed in to: its members, its invites, its Shopify connection, its
description format, its marketplaces. Two audiences, one page:

| Section | Was | Is |
|---|---|---|
| Beta requests (approve / deny / reopen / delete) | OrgPanel tab `beta` | Founder console → **Requests** |
| Beta workspaces directory (aggregate counts) | OrgPanel tab `beta`, second section | Founder console → **Workspaces** |
| Cross-workspace users (add / role / remove / move) | OrgPanel tab `users` | Founder console → **Users** |

The fourth ask — **onboard a beta workspace** — did not exist at all, and neither did
"set permissions" in the sense of *set a workspace's plan*, rename one, or invite
into one. All five are impossible from the client for the same reason the membership
writes already were: **a founding admin is not a member of a tenant workspace**, so
`organizations` and `org_invites` RLS (`is_org_admin(org_id)`) hides those rows
completely. They are RPCs, gated on `is_beta_admin()`, and audited — the shape
`founding_user_admin.sql` established.

---

## 2. The migration — `supabase/migrations/founder_console.sql`

**Written, NOT run.** Additive, idempotent, rollback at the bottom. **No new table,
no new column, no policy change, no trigger.**

Five functions, each born in the shape §18 #45 asks for rather than in the shape the
hardening files would later have to fix:

```
app_private.<fn>   SECURITY DEFINER,  perform public.assert_founding_admin() first
public.<fn>        SECURITY INVOKER wrapper, IDENTICAL signature
```

| Function | Returns | Does |
|---|---|---|
| `founding_create_workspace(p_name, p_plan, p_owner_email)` | `uuid` | Creates the org and attaches the owner |
| `founding_set_org_plan(p_org, p_plan)` | `void` | Moves a workspace between plans |
| `founding_rename_org(p_org, p_name)` | `void` | Renames any workspace |
| `founding_invite_member(p_org, p_email, p_role)` | `uuid` | Invites into any workspace |
| `founding_org_detail(p_org)` | `jsonb` | One workspace's roster, invites, counts |

Four decisions are worth keeping.

**(a) An invite still may never mint an OWNER.** `security_invites_hardening.sql`
closed invitee → owner self-promotion, and that rule stands. So
`founding_create_workspace` branches on whether the email already has an account:
a known account gets an **owner** membership written directly by the SECURITY
DEFINER body (a trusted founder write, not an invitee's), and an unknown email gets
an **admin invite** that `ensureOrganization` accepts on their first sign-in — the
founder promotes them afterwards. Verified both ways (S6, S7).

**(b) The plan vocabulary lives in ONE place per side.**
`app_private.org_plan_list()` is the nine plans `finance.sql` seeds
`finance_plan_prices` with, and `ORG_PLANS` in `foundingAdminService.ts` mirrors it.
A plan outside that set prices at nothing and silently drops out of projected MRR,
which is why both halves reject one rather than one of them trusting the other.

**(c) `founding_org_detail` keeps `beta_org_directory`'s boundary.** Membership,
open invites and **counts** — never a batch, product or image row. S32 asserts the
payload does not contain a product title that is sitting in the same workspace.
`org_marketplaces` is read through `to_regclass` + dynamic SQL (the `finance_summary`
pattern), so a database that never ran `marketplaces.sql` gets `[]`, not an error.

**(d) It does not seed categories.** The default list has exactly one home
(`src/lib/categories.ts` → `categoriesService.initializeDefaultCategories`), so a
workspace created here is seeded by the CLIENT on its owner's first sign-in — see §3.

One hazard is written into the header: `create schema if not exists app_private`
means `security_function_hardening.sql`'s rollback (`drop schema app_private
restrict`) will refuse while these five bodies live there. Roll this file back first,
exactly as `security_rpc_wrappers.sql` documents for its own nine. Confirmed in S33.

`founding_admin_audit.action` is plain `text` with no CHECK, so the four new verbs
(`create_workspace`, `set_plan`, `rename_org`, `invite_member`) needed no `ALTER`.

---

## 3. The client

### `src/lib/foundingAdminService.ts` (appended; nothing existing changed)

`createWorkspace` / `setOrgPlan` / `renameOrg` / `inviteMember` / `fetchOrgDetail`,
plus `ORG_PLANS` / `isOrgPlan`. **Three failures are distinguished**, because the UI
does something different with each: `42501` → `'forbidden'` (a permission line),
`42883` / `PGRST202` → `'unavailable'` (a setup hint naming the migration), anything
else → `'error'` **and the database's own sentence is shown as-is** — these functions
write their messages in plain English on purpose (*"There is already an invite for
that address in this workspace."*).

The email is lower-cased and trimmed in the client as well as in SQL: the function
looks the account up with `lower(email)`, so a client that sent mixed case would
silently take the invite branch for a user who already exists.

### `src/lib/orgService.ts` — `seedWorkspaceIfEmpty`

A founder-created workspace exists before its owner ever signs in, so it has **no
categories**: Step 2 would open with nothing to drag onto and the preset buttons
would do nothing. The seed now runs on **every branch of `ensureOrganization` that
resolves a workspace**, not only on the branch that creates one — which also heals
any workspace that ended up empty for another reason.

The important branch is the INVITE one, not the membership one: an unknown email is
given an admin invite, so the first time that workspace is ever opened it is opened
through invite acceptance.

`initializeDefaultCategories()` **is** the cheap check (it reads one category row,
RLS-scoped, and returns immediately when the workspace has some); a module-level
`Set` keeps that to at most one read per workspace per session. On the resolving
branches it is deliberately **not awaited** — for every existing workspace it is a
no-op read, and a sign-in must not wait behind a repair. 5 tests.

### `src/components/FounderConsole.tsx` + `.css`, `FoundingUsersTab.tsx`

`activeView === 'founder'`, inside `<ToolView wide>`, founding owner/admin only —
the same `isFoundingAdmin` gate every other founder view uses. Five tabs: Overview
(four `StatTile`s + the last 10 audit rows as sentences), Requests, Workspaces,
Onboard, Users.

**Second real adopter of `src/components/ui/`** after HomeDashboard: `Tabs` /
`TabList` / `Tab` / `TabPanel`, `Button`, `ConfirmAction`, `EmptyState`, `Badge`,
`StatTile` / `StatGrid`, `Skeleton`, `TextField`, `SelectField`. No primitive was
edited.

**One deliberate deviation from the brief:** the tabs are rendered **inside the
console's own body**, not through `ToolView`'s `tabs` slot. That slot's wrapper is
`<div className="tool-view-tabs" role="tablist">`, and `TabList` renders its own
`role="tablist"` — nesting them is an invalid ARIA structure, and `ToolView.tsx` was
not mine to change. Visually the row sits in the same place. (The existing
Analytics/Errors pair uses that slot with plain buttons; it predates the primitive.)

Other decisions:

- **A plan change is two steps.** The `<select>` only stages a `planDraft`; an
  **Apply** button commits, and `free` — the one plan change that silently stops
  billing a shop — commits through `ConfirmAction`. Picking alone writes nothing,
  asserted in the test.
- **"Create workspace now"** on a pending or approved request prefills the Onboard
  form with that shop's name and email and switches tabs. It does **not** double-create
  alongside approval: `ensureOrganization` resolves a membership first, then a pending
  invite, and only creates a workspace when it finds neither — so a founder-created
  workspace always wins and the approved-request branch never runs for that person.
  That is stated in the component header, because it looks like a bug and is not.
- **Availability is probed with a real read**, not guessed: after the directory loads,
  one `fetchOrgDetail` on the first workspace answers "has `founder_console.sql` been
  run?" — and the answer is kept as that workspace's detail, so expanding its row is
  free. A database with no workspaces at all leaves the status unknown and the Onboard
  tab simply tries; the RPC's own error is then what the founder sees.
- **The load is one effect with a cancel flag and an async IIFE.** `react-hooks`
  v7 (`set-state-in-effect`) rejects a synchronous `setState` reachable from an effect
  body, which is what a `reload()` starting with `setLoading(true)` is. `loading`
  starts `true`, the mount load clears it, and every later refresh is silent — which
  is also the better behaviour: a refresh after a write must not blank the page the
  founder is reading. `Date.now()` moved out of a `useMemo` for the same family of
  reasons (`react-hooks/purity`); "active in the last 7 days" is now counted at load
  time, which is also the truer statement.

### `OrgPanel.tsx`

The two tabs and their ~15,700 characters of JSX, ~6,500 characters of handlers and
all the founder state are **deleted, not duplicated**. In their place, for founding
admins on the Members tab, one line: *"Beta requests, every workspace and every
account are managed in the Founder console"* + a button. `fetchBetaSignups()` stays —
for one thing only, the member-detail expand that shows a member's own beta
application, which is per-workspace context.

**The `.beta-*` / `.org-dir-*` / `.fa-*` CSS stays in `OrgPanel.css`**, which the
console imports exactly as `AnalyticsPanel`, `CrmPanel` and `ErrorsPanel` already do.
Moving it would have broken the `.tool-view`-scoped page-scale overrides further down
that key off the same class names, and OrgPanel still renders `.beta-status-*`.

### `HomeDashboard.tsx`, `App.tsx`

The founder pulse widget gains a *"N pending requests · M workspaces"* line and an
**Open Founder console** primary action (both reads fail quiet — zero, never an error
wall, on the first screen after sign-in). `'founder'` is added to the Tools grid's
explicit `ORDER` array. App gets the view, the lazy chunk, the `navItems` row and one
`useEventCallback` opener shared by OrgPanel and Home.

---

## 4. SQL verification — 33 scenarios, two orders

Throwaway Postgres 14 (`initdb` + `pg_ctl`, port 55701), the stub `auth`/`storage`
schema, then `multi_org_tenancy.sql` → `beta_signups.sql` →
`beta_admin_directory.sql` → `founding_user_admin.sql` →
`security_invites_hardening.sql`. Callers impersonated with
`set local role authenticated; set local "request.jwt.claims" = '{…}'`.

**Order A — `founder_console.sql` on a database with no hardening yet:**

| # | Scenario | Result |
|---|---|---|
| S1–S5 | Non-founder calls each of the five | `42501 Not authorized — Founding Workspace admins only.` ×5 |
| S5b | A tenant workspace's OWNER calls `founding_org_detail` | 42501 — being an org owner is not being a founder |
| S6 | Create for an EXISTING account (`  OWNER@ShopA.test `) | org created, `created_by` = the founder, `slug` NULL, membership `owner` / `owner@shopa.test`, **0 invites** |
| S7 | Create for an UNKNOWN email | org created, **0 members**, one invite `new@shop.test:admin` |
| S8 | Blank name | rejected, nothing created |
| S9 | Plan `platinum` | `Unknown plan: platinum` |
| S10 | Malformed email | rejected |
| S10b | 61-character name | rejected |
| S11 | `set_org_plan('platinum')` | rejected |
| S12 | `set_org_plan('PRO ')` | accepted; Shop A is on `pro` (trimmed + folded) |
| S13 | `set_org_plan` on a missing workspace | `No such workspace.` |
| S14 | Rename | applied |
| S15 | Rename to blank | rejected |
| S16 | Invite `New.Person@Shop.test` as member | invite row, lower-cased, open |
| S17 | Duplicate invite | `There is already an invite for that address in this workspace.` (23505, not the index name) |
| S18 | Invite as OWNER | `An invite can only be member or admin. Add them, then promote.` |
| S19 | Invite someone already a member | `They are already in that workspace.` |
| S20 | Invite into a missing workspace | `No such workspace.` |
| S21 | `founding_org_detail` | org + 2 members + 1 invite + counts `{batches 2, products 1, images 2}` + `last_active`; `member@shopa.test` resolved from `auth.users` because its `org_members.email` is NULL |
| S22 | Audit trail | exactly 5 rows — one per SUCCESSFUL mutation, none for any refusal |
| S23 / S23b | Audit readable by the founder / a non-founder | 5 rows / 0 rows |
| S24 | With `marketplaces.sql` applied and 3 rows (one disabled) | `["ebay", "poshmark"]` — enabled only, sorted |
| S25 | Re-apply `founder_console.sql` | clean, still works |
| S26 | Placement | 5 definer bodies in `app_private`, 5 invoker wrappers in `public` |
| S27 | Linter 0028/0029 | none of the five is reachable by `anon`/`authenticated` as a definer |
| S27b | `app_private.org_plan_list()` | `anon` f, `authenticated` f — internal guard, as intended |
| S29 | `security_function_hardening.sql` + `security_rpc_wrappers.sql` run AFTER | the five still answer; placement identical to order B |
| S32 | Leak check on `founding_org_detail` | `clean — counts only` (a `SECRET-TENANT-TITLE` product in that workspace does not appear) |
| S33 | `drop schema app_private restrict` | refuses, as the header says it will |

**Order B — the hardening files applied BEFORE `founder_console.sql`:** the file
applies cleanly, a founder can create a workspace, a non-founder still gets 42501,
and **0028/0029 is completely clear across the whole `public` schema**. Both orders
converge on an identical placement table.

**S30 / S31 — rollback then re-apply:** the block removes all five plus
`org_plan_list()` and nothing else; the four pre-existing `founding_*` RPCs, the
audit history and every workspace created before the rollback survive; re-applying
restores the five and they work.

---

## 5. Screenshots (`docs/reviews/img-22/`)

Rendered by mounting the real component in the vitest/happy-dom harness, dumping its
HTML, and injecting that plus the real CSS bundle into the running dev page (the
lazy stylesheets fetched from Vite with `?direct`).

| File | What |
|---|---|
| `overview-1280.png` | KPI row + the audit sentences |
| `requests-1280.png` / `requests-390.png` | Pending / approved / denied rows |
| `workspaces-1280.png` / `workspaces-390.png` | One row expanded: plan, rename, members, invites, invite form |
| `onboard-1280.png` / `onboard-390.png` | The three-field form |
| `users-390.png` | Cross-workspace users on a phone |

Measured at 390: `documentElement.scrollWidth === clientWidth` on all five tabs, every
form control at **16px**, and **zero sub-44px targets** — except three inline
`mailto:` links inside a sentence on Requests, which WCAG 2.5.8 exempts (the same
exemption the Sept mobile pass recorded for the landing page's photo credits).

**Three real defects the screenshots found, all fixed:**

1. **Every `<select>` rendered on its first option** — `pro` showed as `free`, a
   member showed as `Owner`. A FIXTURE artifact, not a product bug (`innerHTML` does
   not serialise a select's value, which React sets as a DOM property), but it would
   have made the screenshots lie, so the dump now stamps `selected` before writing.
2. **The explanatory paragraphs ran the full 1780px of the window.** `wide` drops
   ToolView's 1400px measure for the grids, which is right, and left the prose
   unreadable. `.fc-view .shopify-conn-help` is capped at 90rem.
3. **The bare `<select>`s in `.fa-add-row` stayed at 11px on a phone** — measured, and
   exactly the mobile-Safari zoom trigger `--fs-md` exists to avoid.
   `OrgPanel.css`'s ≤640px block lists its page roots as
   `:is(.org-page, .fin-view, .ft-card)`; `.fc-view` was not among them, so the
   console inherited none of the 16px/44px restatements. Added, with the reason.

The tab strip scrolls sideways at 390 rather than wrapping — that is `Tabs.css`'s own
`@media (max-width: 640px)` rule (`flex-wrap: nowrap; overflow-x: auto`), the house
pattern for filter rows, and `scrollWidth === clientWidth` on the document confirms it
is contained.

---

## 6. Owed / not done

- **Nothing is verified in a signed-in browser.** Same standing limitation as every
  pass since the mobile work: no agent can sign in. The React wiring is covered by
  tests, the cascade by screenshots; the two have not been seen together.
- **`founder_console.sql` has not been run anywhere**, including the throwaway
  cluster's production equivalent. Until it is, the console's Requests, Workspaces
  and Users tabs work exactly as the OrgPanel tabs did and the five new capabilities
  show one setup line.
- **Deleting a workspace is not offered.** It would have to cascade batches, products,
  images and storage objects across a tenant, and `deleteWorkflowBatch`'s ordering
  rules (§11) are per-batch. Removing every member is the reversible half and is
  already possible.
- **No `auth.users` row is ever created.** That needs the service_role key, and an
  Edge Function holding it is a much larger blast radius than anything in this file.
  An unknown email gets an invite and signs up normally.
- **`security_abuse_limits.sql` is untouched**, so its quotas are unchanged by this
  pass.
