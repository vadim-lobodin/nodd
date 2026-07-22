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

Both feed a module-level **activator registry** (`activator.ts`). `activateState(stack)` walks the stack, entering each segment that isn't already mounted (click/call), then waits (up to 2000 ms, `MutationObserver`) for the state element to appear. It **fails closed**: if a segment has no activator/trigger and isn't already present, restoration stops and the caller shows a hint instead of guessing.

## 4. Auto-detected states — `autoState.ts`

Instrumenting every overlay with `<NoddState>` is friction, and skipping it is the common case that causes the bleed described in §1. `autoState.ts` removes that first burden for **standard ARIA overlays** — no host code required.

- `detectAutoSegment(el)` returns `auto:<role>[:<name>]` for an ancestor that is an open overlay container: `role` in `dialog | alertdialog | menu | listbox`, and (when the widget exposes one) `data-state="open"`. The `<name>` is a **stable accessible name** — `aria-label` → `aria-labelledby` text → first heading — never a generated id, so the key survives reloads.
- `getStateStackForElement` folds these segments in alongside explicit ones, so an un-instrumented modal still scopes its comments (and hides them when it closes).
- `findAutoTrigger(segment)` locates the reopen trigger by the ARIA link a trigger advertises (`aria-haspopup` + `aria-expanded="false"`), matched to the role. It returns a trigger **only when exactly one closed candidate exists** — ambiguity fails closed. `activateState` clicks it to restore an auto-state.
- `describeAutoSegment(segment)` renders a human label for the sidebar breadcrumb (`auto:dialog:settings` → "Settings").

Philosophy mirrors the anchoring resolver: rely on web standards (not framework internals), key on something stable, and never guess when uncertain. Radix primitives (and anything ARIA-correct) satisfy this out of the box — see `src/stories/AutoState.stories.tsx` for a live harness.

## 5. Reopening a thread — `revealThread`

The single entry point for opening a thread that may live in another screen or state is `OverlayRenderer.revealThread(threadId, urlPath?)`. It:

1. routes to another screen first if `urlPath` differs (deep-link `#nodd-thread=<id>` + `onNavigate`); otherwise
2. `await activateState(keyToStack(thread.stateKey))` to bring the captured state back (a no-op per already-mounted segment), yields a frame so the re-anchor loop runs, then
3. re-resolves the pin, and if it now matches the state, positions + opens + scrolls it into view; otherwise
4. shows a dismissible hint ("left in a state we couldn't reopen automatically…") instead of a dead click.

Every entry point — a sidebar item, the prototype inbox, a deep link — goes through this one path, so state restoration is uniform.

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
└── autoState.ts         ← ARIA overlay auto-detection
```

## 7. Known limitations

- **Auto-restore is heuristic.** It reopens an auto-state only when exactly one closed candidate trigger of the matching role exists — the typical single-modal prototype. Ambiguity (two closed dialogs) fails closed → hint.
- **Standard ARIA only.** A custom overlay that doesn't set `role`/`data-state`/`aria-haspopup` won't be auto-detected; wrap it in `<NoddState>` + an activator instead.
- **2 s restore budget.** A state that takes longer than 2000 ms to mount after its trigger fires is treated as unrestorable.
