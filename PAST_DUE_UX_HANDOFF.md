# Handoff: past-due / deferred item navigation and display

**Status:** historical diagnosis, retained for context. The fixes and browser verification are documented in `UI_UX_VERIFICATION.md`.
**Scope:** `mcat-tracker/` — the Today past-due card, the `#plan/past-due` route, and how
`deferred` ("skipped") days are represented.
**Repro environment:** static server from `mcat-tracker/`, `?today=YYYY-MM-DD` query param to
fake the date, `js/sync-config.js` blanked to bypass the PIN gate.

Everything below was reproduced in a real browser, not inferred from reading code.

---

## The user's report

> "I click the pending items on the main page, it takes me to the plan page, but then I can't
> see the full plan (pending *and* today's stuff)."

That report is accurate and there are **five** separate defects behind it. They compound: the
first one causes the confusion, the second makes it permanent, the third hides the evidence,
the fourth strands the user visually, and the fifth erases a decision they made on purpose.

---

## Defect 1 — `#plan/past-due` replaces the plan instead of focusing it

**File:** `js/views/plan.js:105`

```js
if (route.detail === "past-due") Object.assign(filters, { phase: "all", resource: "all", status: "past-due", dayType: "all", currentWeekOnly: false });
```

`View all` on the Today past-due card links to `#plan/past-due`. That route sets the shared
status filter to `past-due`, so `rowMatches()` drops every non-past-due row, and `weekCard()`
returns `""` for any week with no surviving rows.

**Measured, `?today=2026-09-20`, 18 past-due days:**

| | before | after `View all` |
|---|---|---|
| week cards rendered | 20 | 3 |
| day cards rendered | 145 | 18 |
| today's row visible | yes | **no** |

The header still reads `145 dated rows · 20 Tuesday-Monday weeks` and the intro still says
"Expand the week or day you need" — both describing a plan that is no longer on screen. The
only signal that a filter is active is the `Status` select reading "Past due", roughly 700px
down the page on a phone.

The user asked to *see* their backlog in context. The route answers by deleting the context.

**Worst case:** with zero past-due rows (e.g. `?today=2026-08-25`, before the plan starts) the
route renders `No days match these filters` — a completely empty Plan tab — under a header
still claiming 145 rows. `Jump to week 1` is also silently dead here, because
`bindPlan`'s `container.querySelector("#week-1")` returns null and the handler `return`s with
no feedback (`js/views/plan.js:130`).

## Defect 2 — the filter is a module singleton and never resets

**File:** `js/views/plan.js:6-12` — `const filters = { ... }` lives at module scope.

`renderPlan` only writes to it when `route.detail === "past-due"`. Nothing ever writes it back.
So once you have visited `#plan/past-due`, **every later visit to Plan is still filtered**,
for the life of the page. Tapping `Plan` in the bottom nav does not clear it.

**Measured:** after `View all`, clicking bottom-nav `Plan` (`#plan`) →
`status: "past-due"`, 1 week card, 2 day cards. This is almost certainly the exact moment the
user formed the impression that the Plan page is broken.

It also breaks unrelated deep links. `#plan/2026-09-20` while the stuck filter is active:
`dayRendered: false` — the day the URL names is not in the DOM at all.

A hard page reload is the only way out other than manually finding the Status select or
`Reset filters`.

## Defect 3 — the landing scroll silently does nothing

**Files:** `js/app.js:349` and `js/views/plan.js:141-146`

`bindPlan` intends to land the user on the filtered results:

```js
if (isRouteChange && window.location.hash === "#plan/past-due") {
  container.querySelector(".filter-panel")?.scrollIntoView({ block: "start" });
}
```

It does not happen. `renderCurrent` runs first:

```js
if (!sameRoute) window.scrollTo({ left: 0, top: 0, behavior: "auto" });
```

`css/styles.css:41` sets `html { scroll-behavior: smooth }`. Per spec `behavior: "auto"`
resolves to the CSS value, so that call starts a **smooth animation to the top** which is still
running when `scrollIntoView` fires, and it wins.

**Measured (1280x900 viewport, in-app `View all`):** `scrollY: 0`,
`filterPanelTop: 570` — the user lands on the Plan title, ~570px above anything that changed.
The same race kills the `#plan/<date>` deep-link scroll (`scrollY: 0` with the target at
`top: 5525`, day correctly `open: true` but far off screen).

Note `js/view-state.js` already knows about this trap and defends against it — it stashes
`documentElement.style.scrollBehavior`, forces `"auto"`, scrolls, then restores. `renderCurrent`
does not do the same.

Secondary: there is no `scroll-margin-top` anywhere in `css/styles.css`, so even once the scroll
works, targets land underneath the 70px sticky `.topbar`.

## Defect 4 — the Today past-due list is a cramped nested scroller

**File:** `css/styles.css:219`

```css
.catchup-list { max-height: clamp(96px, calc(100dvh - 680px), 180px); overflow-y: auto; }
```

Rows are `min-height: 76px` (`css/styles.css:222`). So the visible window holds:

- iPhone SE (667px tall): `100dvh - 680` is negative → clamps to **96px** → 1.26 rows
- iPhone 14/15 (812–852px): 132–172px → 1.7–2.2 rows

At every size the last visible row is cut through its text. The hint reads
`Oldest first · Scroll for all 18 items` — asking for an inner scroll gesture inside a page that
also scrolls, on a target one-and-a-bit rows tall. That is why `View all` gets tapped, which is
what walks the user into Defects 1–3.

## Defect 5 — `deferred` ("skipped") is invisible everywhere

**Files:** `js/data.js:78-81`, `js/views/today.js:50-58`, `js/views/shared.js:5-12`,
`js/views/plan.js:60`

`statusLabel()` supports `deferred`. `isPastDue()` deliberately counts it as past due
("Deferred means later, not done"). But nothing ever *renders* the distinction:

- `workRow()` on Today prints `Past due · N days ago` and a `Mark complete` button, with no
  status badge — identical to a day never touched.
- In Plan, `dayCard()` shows the status badge only for non-study rows:
  `isStudyRow(row) ? completionButton(...) : statusBadge`. Study days therefore never show
  `Deferred` either. The summary just says `Past due`.
- The Plan `Status` filter offers `all / past-due / complete / incomplete` — no `deferred`.
- The only way to set it is Status → Deferred → Save day, buried in the assignment dialog's
  inline editor.

**Measured:** set `2026-09-01` to `deferred`, saved. Today's card still reads
`Past due 5`; the row reads `Mark complete · Tue, Sep 1 · Past due · 5 days ago`. Plan summary
reads `Tue Sep 1 Past due`. The user's explicit decision to skip that day produced no visible
change anywhere.

## Also worth noting — two different mental models for one card

Within the same past-due card:

- tapping a **row title** (`data-open-assignment`) opens a **modal** (`js/views/today.js:212`)
- tapping **View all** does a **route change** into a filtered Plan

Same card, two navigation paradigms, no visual cue which is which. The modal also has no
`Mark complete` button — completion there means either ticking every checklist step or
Status → Complete → `Save day`.

---

## Suggested fix approach

Ordered by value per unit of risk. 1–3 are the actual bug; 4–6 are the UX.

### Fix 1 — make past-due a *focus*, not a filter (highest value)

Replace the `#plan/past-due` filter hijack with a dedicated **Past due section pinned to the top
of the Plan view**, above the phase map, rendered from `pendingRows(data, state, today)` — with
the full 20-week schedule left completely intact underneath.

- Delete `js/views/plan.js:105` entirely.
- Add a `pastDueSection(context, today)` that mirrors the existing `.plan-days` markup so day
  cards, check-offs and `bindAssignmentDetail` all keep working unchanged.
- Render it whenever `pendingRows` is non-empty, not only on the `/past-due` route. It is
  useful on every Plan visit.
- Keep `#plan/past-due` as a route that only *scrolls to* that section (see Fix 3).

This directly answers "I can't see the full plan (pending and today's stuff)" — both are on one
screen, with no hidden mode.

Also add a `Today` marker to the current date's day card so it is findable in a 145-row list.

*Alternative if a full-page section is too invasive:* keep the filter but render a dismissible
**filter chip bar directly under the `Plan` heading** (`Past due only ×`) and make the header
eyebrow reflect what is actually shown (`18 of 145 rows · filtered`). Less good — it still hides
today's work behind a mode.

### Fix 2 — stop the filter from leaking across visits

Whichever route shape survives Fix 1, `filters` must not silently persist:

- Reset `filters` to defaults at the top of `renderPlan` on any route change *into* Plan from
  another view, then apply route-derived overrides; **or**
- move `filters` into the URL (`#plan?status=past-due`) so state is visible, shareable, and
  cleared by tapping `Plan`; **or** (smallest change)
- reset to defaults whenever `route.detail !== "past-due"` and the previous render was
  `past-due`.

Whatever the mechanism, the invariant to hold is: **tapping `Plan` in the nav always shows the
whole plan.** Worth an assertion in `tests/`.

Also make `Jump to week N` honest — if the target week is not in the DOM, clear the filters and
retry rather than `return`ing silently (`js/views/plan.js:130`).

### Fix 3 — fix the scroll race once, centrally

In `js/app.js:349`, wrap the reset-to-top the way `js/view-state.js` already does:

```js
if (!sameRoute) {
  const de = document.documentElement;
  const prev = de.style.scrollBehavior;
  de.style.scrollBehavior = "auto";
  window.scrollTo(0, 0);
  de.style.scrollBehavior = prev;
}
```

This makes the reset instantaneous, so the binder's `scrollIntoView` is the only animation in
flight and actually lands. Fixes `#plan/past-due`, `#plan/<date>`, and the `#guide/<id>` /
`#log/<panel>` deep links in one place — check the other view binders for the same pattern
while you are there.

Then add `scroll-margin-top: 84px` to `.week-card`, `.plan-day`, `.filter-panel` and guide
section targets so nothing lands under the 70px sticky topbar.

Consider extracting a small `scrollToTarget(el)` helper rather than repeating the
save/force/restore dance in each binder.

### Fix 4 — give the Today past-due list room to breathe

`css/styles.css:219` — the `- 680px` budget assumes a taller phone than most users have.

- Show 3 full rows minimum: raise the floor to ~`228px`, i.e.
  `clamp(228px, calc(100dvh - 420px), 380px)`, and re-measure on a 667px viewport.
- Or drop the nested scroller: render up to 3 rows inline and let
  `View all N past due` carry the rest. A nested scroll region inside a scrolling page is worth
  avoiding on touch regardless.
- If the scroller stays, add a bottom fade/shadow so a clipped row reads as "more below"
  rather than as a rendering glitch.

Also make the whole `View all` control unambiguous about where it goes — `View all 18 in Plan`.

### Fix 5 — make `deferred` a first-class state

- Render a `Deferred` badge in `workRow()` (`js/views/today.js:50`) and in `dayCard()`'s
  summary for study rows (`js/views/plan.js:60`) — the badge and the completion button can
  coexist.
- Split the Today card headline: `Past due 12 · Skipped 3`, or give deferred rows their own
  muted grouping under the past-due rows so the active backlog number means something.
- Add `deferred` to the Plan `Status` filter options (`js/views/plan.js:~120`).
- Add a one-tap **Skip / Defer** action to the past-due row itself (a small secondary control
  next to `Mark complete`) so skipping does not require opening a modal and using a `<select>`.
- Decide and document the intended semantics: does a deferred day still count against the
  backlog forever? A "deferred to <date>" field would make it a real reschedule instead of a
  cosmetic label. That is a product decision — confirm with the user before building it.

### Fix 6 — unify the two navigation paradigms in the card

Pick one and apply it consistently:

- **(recommended)** row title → modal, `View all` → Plan section. Keep it, but make the modal
  visibly modal-ish (it already is) and give it a `Mark complete` primary button so the fast
  path is the obvious one.
- Or: row title → `#plan/<date>` deep link, so *everything* in the card goes to Plan and the
  modal disappears. Simpler model, more taps.

---

## Verification checklist for whoever implements this

Reproduce with a blanked `js/sync-config.js` and `?today=2026-09-20` (18 past-due days):

1. Today → `View all` → the full 20-week plan is present *and* the past-due set is on screen.
2. From there, bottom-nav `Plan` → still the full plan, no residual filter.
3. `#plan/2026-09-20` after step 1 → that day is rendered, open, and scrolled into view below
   the sticky topbar.
4. `?today=2026-08-25` (no past-due rows) → Plan is never empty and never contradicts its own
   header.
5. Mark a day `deferred` → it is visually distinct from an untouched past-due day on both Today
   and Plan, and countable in the Plan status filter.
6. 375x667 viewport → the past-due list shows at least 3 complete rows, no row cut mid-text.
7. `Jump to week N` either works or explains why it cannot.
8. Add regression coverage in `tests/` for the invariant in Fix 2.
