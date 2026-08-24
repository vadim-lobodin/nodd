# Interactive states (`src/provider/state/`)

> Scopes a comment to the interactive state it was left in (a modal, a menu, an expanded step) and brings that state back when the comment is reopened.

Parent: [`src/provider/README.md`](../README.md) · Consumers: [`src/overlay/`](../../overlay/README.md) (`OverlayRenderer.revealThread`)

## 1. Problem

A pin is anchored to a DOM element ([`src/overlay/anchoring/`](../../overlay/anchoring/README.md)). But a prototype's DOM is *modal*: a comment dropped inside an open dialog anchors to an element that only exists while that dialog is open. Without a notion of "which state was this comment left in", two things break:

- the pin **bleeds** onto the base screen (the anchor's selector may still match something, or the pin floats), and
- reopening the comment from the sidebar/inbox lands you on a screen where the target isn't mounted — a dead click.

This module gives every thread a **state key** and a way to **restore** that state on demand.

## 2. The state key

A thread stores a `stateKey` — the `/`-joined stack of state **segments** from the page root down to the element the pin anchors to.

- `''` (empty) — base screen. Matches every state (a base-screen pin is always shown).
- `settings` — inside one explicit `<NoddState name="settings">`.
- `settings/advanced` — nested states.
- `auto:dialog:settings` — an **auto-detected** state (see §4).

Helpers (`useNoddState.ts`): `stackToKey(stack)` / `keyToStack(key)` convert between the array and the stored string. `isStateMatch(threadKey, domStack)` decides whether a thread belongs in the current DOM state — exact match, or a submatch (`domStack` is deeper than, and prefixed by, `threadKey`). Empty key matches all.

The stack for any element is computed by `getStateStackForElement(el)` (`NoddState.tsx`): it walks ancestors, unshifting an explicit `data-nodd-state` segment when present, otherwise an auto-detected segment.

## 3. Explicit states — `<NoddState>` + activators

```tsx
<NoddState name="settings">
  <SettingsPanel />
</NoddState>
```

`<NoddState>` renders a `display: contents` wrapper carrying `data-nodd-state="settings"` (zero layout impact). Nesting composes into a deeper stack.

To let Nodd **reopen** a state, the host registers how to enter it — either declaratively or imperatively:

- `[data-nodd-open-state="settings"]` on the trigger element — Nodd clicks it.
- `useNoddActivator("settings", () => setOpen(true))` — Nodd calls the function.

Both feed a module-level **activator registry** (`activator.ts`). `activateState(stack)` walks the stack, entering each segment that isn't already mounted (press/call), then waits (up to 2000 ms, `MutationObserver`) for the state element to appear.

> **Entering a state means `pressTrigger`, never `.click()`.** Radix menu, select and popover triggers toggle on `pointerdown` and ignore `click`, so `el.click()` on one does nothing at all — the state never reopens and we blame the host for a timeout. Dialog triggers *do* use click, which is exactly why this survived: every dialog test passed. `pressTrigger` dispatches the full press sequence, so pointer-driven and click-driven widgets both respond, and one that handles both still sees a single press. It **fails closed**: if a segment has no activator/trigger and isn't already present, restoration stops and returns `{ ok: false, failedSegment }` so the caller can name the state it got stuck on instead of guessing.

## 4. Auto-detected states — `autoState.ts`

Instrumenting every overlay with `<NoddState>` is friction, and skipping it is the common case that causes the bleed described in §1. `autoState.ts` removes that first burden for **standard ARIA overlays** — no host code required.

- `detectAutoSegment(el)` returns `auto:<role>[:<name>]` for an ancestor that is an open overlay container: `role` in `dialog | alertdialog | menu | listbox`, and (when the widget exposes one) `data-state="open"`. The `<name>` is a **stable accessible name** — `aria-label` → `aria-labelledby` text → first heading — never a generated id, so the key survives reloads.
- `getStateStackForElement` folds these segments in alongside explicit ones, so an un-instrumented modal still scopes its comments (and hides them when it closes).
- `findAutoTrigger(segment)` locates a reopen trigger by the ARIA link a trigger advertises (`aria-haspopup` / `aria-controls` + `aria-expanded="false"`), matched to the role and narrowed by the state's name. Ambiguity fails closed. This is the **fallback**: `activateState` prefers the trigger recorded at capture time (§4a) and only hunts when there isn't one. Either way it activates via `pressTrigger`, never `.click()` — see §3.
- `describeAutoSegment(segment)` renders a human label for the sidebar breadcrumb (`auto:dialog:settings` → "Settings").

Philosophy mirrors the anchoring resolver: rely on web standards (not framework internals), key on something stable, and never guess when uncertain. Radix primitives (and anything ARIA-correct) satisfy this out of the box — see `src/stories/AutoState.stories.tsx` for a live harness.

## 4a. Recorded triggers — `reopen.ts`

`findAutoTrigger`'s closed-trigger hunt has a hard ceiling: it runs long after the fact, when the only thing left to go on is "which closed control on this page looks like it opens a `<role>`". On a real prototype that is routinely unanswerable — a task list renders twenty identical `aria-label="More"` buttons, and a controlled dialog (`open` supplied by a parent) has no trigger in the DOM at all. Both fail closed, which is safe but useless.

`reopen.ts` closes most of that gap by asking the question at the *other* end. When a comment is placed, the states it sits in are still open, so the browser still holds the trigger→content link. `findOpeningTrigger(segment)` reads it, in three tiers:

1. **`aria-controls`** pointing into the open overlay — the only tier that isn't a guess. Catches Radix Dialog/DropdownMenu/Select and downshift comboboxes, including the identical-row-menus case.
2. **`[aria-expanded="true"][aria-haspopup]`** matching the role, when exactly one exists outside the overlay.
3. **A focusable `[data-state="open"]` control**, when exactly one exists — restricted to `listbox`/`menu` segments, the custom-select shape. Excluded for dialogs, where a lone `data-state="open"` button elsewhere on the page is more likely unrelated than the opener.

Explicit `<NoddState>` segments are skipped entirely: they're host-instrumented by definition, and a `display: contents` wrapper exposes no ARIA relationship to read.

The overlay stores the result as a selector + fingerprint pair in `pin.stateTriggers[segment]` (`src/overlay/stateTriggers.ts`), and `activateState` re-resolves and clicks *that* control, preferring it over the hunt. Re-resolution goes through the same strict anchoring resolver as a pin, so a control that has since been rewritten resolves to nothing and we fall back to the hunt rather than clicking something unrelated. A wrong click is still caught downstream: `activateState` only reports success once the expected state element actually appears.

**Warning at capture time.** `hasReopenPath(segment)` answers "can we get back in here once it closes?" — for a derived segment, that means "did we record a trigger". When the answer is no, the composer says so while the author can still act on it, and dev builds log the `<NoddState>` + `useNoddActivator` remedy. Previously this failed silently and only surfaced days later, on someone else's dead click.

**Fallback for threads with no recording.** `findAutoTrigger` still handles pins written before triggers were recorded, and now tries harder before giving up: it narrows several candidates using the state's *name* (libraries commonly point the overlay's `aria-labelledby` at its trigger, so an exact match is the norm), accepts the combobox shape (`aria-controls` with no `aria-haspopup` — Radix `Select`), and scopes the search to the already-open parent state before widening to the document. Every pass still returns a single candidate or declines.

## 4b. Overlays with no ARIA — `floatingState.ts`

`autoState.ts` needs a `role`, and plenty of real overlays don't have one: popover panels in most libraries, and every hand-rolled `{open && <div className="fixed inset-0" />}` menu. A comment inside one is captured with an empty key, which matches every state — so it never hides, and it can never be reopened. Worse, the failure is invisible: §4a's warning can't fire for a state nobody detected.

`detectFloatingSegment` adds a structural last resort, keyed on layout rather than semantics. Two specific shapes qualify:

1. **A portal layer** — a child of `<body>` that isn't the app root (the app mounts in the first body child; landmark content is a second tell). Every major library appends overlay content here.
2. **A scrimmed panel** — a positioned element immediately preceded by a full-viewport `position: fixed` backdrop with no text. This is the hand-rolled modal shape, which renders inline and so escapes tier 1.

Because this reads layout, it is gated three ways:

- **It only runs when the ARIA/explicit walk found nothing.** That is what makes it safe to add: a thread that already resolved to some stack still resolves to exactly that stack, and a thread whose key is empty matches every state regardless. No existing comment changes behaviour — only new ones gain a scope they previously went without.
- **It requires one of those two structures**, not "looks floaty". A sticky header, a fixed toolbar, and a full-bleed background all fail both.
- **The author sees the verdict** in the composer ("Scoped to 'Steps menu'") and can drop it with one click, which stores the thread exactly as it would have been before this signal existed.

Naming follows the same stability rule as §4: accessible name → the name of the panel *inside* the layer (a portal root is shared by every overlay in the app, so its own id would make them indistinguishable) → `data-testid` → a non-generated id → finally the first control's text. That last source is the weak one and is documented as such in §7.

A float segment has no ARIA, so §4a can rarely record a trigger for it and `findAutoTrigger` has no role to hunt with. Comments in one are therefore usually scoped but not reopenable — which is an honest improvement over bleeding, and says so in the composer.

## 4c. Content named by its control — `controlledState.ts`

§4b reads layout, so it only fires for surfaces that *look* like layers. Two very common shapes look like nothing at all:

- **Popover content** in Radix and Headless UI — no `role`, and (unless the host portals or positions it) no floating structure either.
- **Disclosure / accordion regions** whose collapsed content is *unmounted*, which puts them out of reach of `disclose.ts` too — there is no hidden element left to reveal.

Both carry the disclosure half of ARIA: a control with `aria-expanded="true"` and `aria-controls="<content id>"`. That is a host-authored relationship rather than a layout guess, and it is bidirectional — the same link that identifies the state is the thing to press to get it back. Unlike a portalled dialog there is never a question of *what opened this*.

`detectControlledSegment` keys the segment on the **control's** accessible name (`ctl:more-options`), not the content's. This kind of content usually has no name, and its id is generated (`radix-:r5:`, React `useId`) and so differs between reloads; a button labelled "Advanced" keys `ctl:advanced` for as long as it says "Advanced".

Gating, in the same spirit as §4b:

- **Runs only when explicit, ARIA-role *and* structural all found nothing**, and specifically *after* §4b — not because structure is the better signal, but because `float:` shipped first and every `float:` thread in the wild must keep deriving `float:`. On a portalled popover both fire; the older one wins.
- **Exactly one expanded control** may claim the content, and it must have a name. Two controls, or an unnamed one, declines.
- **`role="tabpanel"` is excluded.** A tab panel is a persistent region, not a transient surface; scoping comments to it would hide each tab's comments behind the others. `disclose.ts` reopens those instead, and correct tab markup uses `aria-selected` anyway.

Reopening is a lookup rather than a hunt: `findControlledTrigger` searches `[aria-expanded="false"][aria-controls]` for the control whose name slug *is* the segment key. That's why `hasReopenPath` returns true for a `ctl:` segment without needing a recorded trigger — the segment is named after its own opener. Ambiguity (two buttons labelled "More") still declines.

## 4d. Anchors that are present but not shown — `disclose.ts`

A closed tab panel, a collapsed accordion, a `<details>`: the commented element is still in the document and still matches its selector and fingerprint. Resolution therefore reported *success*, and then `getBoundingClientRect()` returned zeros and the pin rendered in the page's top-left corner — silently wrong, which is worse than orphaned.

This is not a state in the §2 sense. The comment belongs to the base screen and its key matches; nothing in the state stack refers to the closed section, so there is no captured segment to key off. All we have is the anchor and the DOM above it.

`isRendered` therefore reads **declared** hiding — `hidden`, `aria-hidden="true"`, `display: none`, `visibility: hidden`, a closed `<details>` — rather than measuring layout. A zero-size rect is also what an element reports before first paint, inside a `display: contents` wrapper, and mid-animation; treating those as hidden would suppress pins that are about to be fine. Resolution now requires the anchor to be rendered, which is what stops the corner pins.

`discloseAncestors` then opens what's hiding it, outermost first, recomputing the chain after each press (opening a tab re-renders its contents, so the inner accordion may be a different element by then). It finds the control three ways:

1. a `<details>`'s own `<summary>`;
2. the single `[aria-controls="<id>"]` control outside the container that isn't already expanded;
3. for `role="tabpanel"`, the `aria-labelledby` target when it is a `role="tab"`.

Ambiguity declines, as everywhere else, and reveal then names the closed container (`describeContainer`) and rings it instead.

`DiscloseResult` reports `revealed`, `blocked` **and `changed`**, and the third is load-bearing. The usual React answer to "open this panel" is to unmount the closed one and mount an open one — which succeeds while destroying the element being tracked, so the outcome cannot be observed on it. `revealed` is necessarily false there and `blocked` is null, and reading that pair as failure sent every controlled tab and accordion to a degraded anchor whose exact one was sitting in the new DOM. `changed` says a control was pressed and the DOM moved; a caller **must** re-resolve the pin whenever it is set. Reveal runs the disclose-and-re-resolve step up to twice, because a freshly mounted subtree can have its own collapsed section inside it.

## 5. Reopening a thread — `revealThread`

The single entry point for opening a thread that may live in another screen or state is `OverlayRenderer.revealThread(threadId, urlPath?)`. It:

1. routes to another screen first if `urlPath` differs (deep-link `#nodd-thread=<id>` + `onNavigate`); otherwise
2. `await activateState(stack, { recordedTrigger })` to bring the captured state back (a no-op per already-mounted segment), yields a frame so the re-anchor loop runs, then
3. re-resolves the pin, and if it now matches the state, positions + opens + scrolls it into view; otherwise
4. **degrades instead of dead-ending.** Which of the two failures happened is now distinguished, because that's what the viewer needs to know:
   - *the state wouldn't reopen* — name it from the breadcrumb ("This comment is inside “Assign to policy”"), and if its recorded opening control is on the page, scroll to it and ring it (`.nodd-reveal-highlight`) so the next click is the viewer's to make;
   - *the anchor is present but shut inside a tab or section* — open it (§4d), and if that can't be done unambiguously, name and ring the closed container;
   - *the state came back but the anchor didn't* — the host is showing a different slice of the same UI, which no library can restore on its own; fall back to the nearest surviving container so the thread is at least readable (see `anchoring/README.md` §5.3.1).

Every entry point — a sidebar item, the prototype inbox, a deep link — goes through this one path, so state restoration is uniform.

Covered end to end by `overlay/__tests__/reveal.test.tsx`, which drives this sequence through the deep-link entry. The helpers each had unit coverage while the sequencing between them was wrong, so assertions here are about the *outcome the viewer gets* — exact placement and no notice, or a degraded pin with the right words in it.

## 6. Files

```
src/provider/state/
├── README.md            ← this document
├── index.ts             ← public re-exports
├── NoddState.tsx        ← <NoddState>, getStateStackForElement
├── NoddStateContext.ts  ← nesting context
├── useNoddState.ts      ← stackToKey / keyToStack / isStateMatch
├── useNoddActivator.ts  ← useNoddActivator / useCanActivate
├── activator.ts         ← activator registry + activateState (explicit + auto)
├── reopen.ts            ← segment→element lookup + capture-time trigger discovery
├── floatingState.ts     ← structural fallback for overlays with no ARIA
├── controlledState.ts   ← disclosure fallback: content named by an expanded control
├── disclose.ts          ← opening the tab/section an anchor is hidden inside
├── describe.ts          ← one human label for any kind of segment
├── autoState.ts         ← ARIA overlay auto-detection
└── __tests__/           ← unit coverage + the library compatibility matrix
```

## 7. Known limitations

- **Auto-restore is still heuristic** where no trigger was recorded — narrowing by name helps, but genuinely identical candidates (twenty `aria-label="More"` buttons) still fail closed → hint.
- **A hand-rolled overlay that is neither portalled, scrimmed, nor `aria-expanded`-linked is invisible.** §4b needs one of its two structures and §4c needs the disclosure link; an inline `position: absolute` panel with no backdrop and no ARIA matches none of them, so a comment inside it is captured unscoped and bleeds. Nothing downstream can warn about a state nobody detected. Fix it in the host with two attributes: `data-nodd-state` on the panel and `data-nodd-open-state` on its trigger — no import or wrapper needed, and it also makes the state reopenable.
- **Float segment names can be unstable.** When a layer has no accessible name, no `data-testid` and no usable id, the name falls back to its first control's text; if that text changes, existing comments in that layer stop matching and disappear. Giving the panel an `aria-label` (or a heading) fixes it permanently.
- **No faithful reopen exists for some interactions**, recorded trigger or not: hover-opened menus (a click on the anchor does nothing), right-click context menus (the trigger is a transient element at the cursor), and keyboard-only palettes. These get the named hint.
- **`ctl:` segment names inherit their control's label.** Rename the button and existing comments in that surface stop matching — the same trade-off as float names (§4b), and fixed the same way, by giving the control a stable `aria-label`.
- **2 s restore budget**, per segment. A state that takes longer than 2000 ms to mount after its trigger fires is treated as unrestorable.
- **400 ms anchor settle budget.** After activation succeeds, reveal retries the anchor each frame for `ANCHOR_SETTLE_MS`; content that lazy-mounts past that still misses.

## 8. Testing

`npm test` runs the suite. Two kinds live in `__tests__/`:

- **Unit coverage** of each signal, written as much around what it must *decline* to claim as what it detects — that's where the fail-closed contract actually lives.
- **`overlay-compat.test.tsx`** — the compatibility matrix. Every row renders the real library and asserts what Nodd sees, then prints a table. Libraries are rendered rather than reproduced as HTML fixtures on purpose: a fixture written from memory is still a guess, just an executable one.

To cover another library: `npm i -D <library>`, add a `describe` block that renders its dialog/menu/select/popover with `id="probe"` on an element inside, and call `probe()`. Currently covered: **Radix** (and so shadcn/ui, which wraps it) and **Headless UI**. Not yet verified: MUI, Chakra, Mantine, Ant Design, React Aria.
