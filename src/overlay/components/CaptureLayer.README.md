# CaptureLayer

> Implements click-to-pin capture for Nodd. Renders a transparent, full-viewport interceptor that, on the next user click, hit-tests the **host** DOM (not the overlay), normalises the click into a `Pin`, and emits `pin.created` — without forwarding the click to the host.

Related: [OverlayRenderer](../README.md) · [DOM Anchoring](../anchoring/README.md) · [Architecture Design — §6 Overlay Z-Index & Pointer-Events](../../../DESIGN_DOC.md#6-overlay-z-index--pointer-events-strategy)

## 1. Purpose

When a signed-in commenter presses `C`, Nodd must capture the **next** click on the host page and convert it into a pin attached to the underlying host element. Opening the comments list does not start capture mode, so read-only guests can browse it and use its inline login section without a modal. This is non-trivial because the Nodd overlay sits on top of the host DOM at `z-index: 2147483000` — naïvely calling `document.elementFromPoint(x, y)` returns the overlay itself, never the host element the user actually clicked.

`CaptureLayer` solves this with a **single-frame visibility toggle + `requestAnimationFrame` + `elementFromPoint`** trick. It also owns the visual affordances of capture mode (crosshair cursor, faint backdrop) and its exit path (`Esc` → `onCancel`).

> **Superseded by the sticky comment mode.** Comment mode is now the resting state of an open comments panel (see the parent README §7), not a one-shot armed by `C`. Two rules below no longer hold: a click on an empty area is a **no-op that stays armed** rather than a cancel, and `onCancel` fires only for `Esc`. A click landing on an existing pin is forwarded to that pin (`pinEl.click()`) instead of placing a second one, which costs a first `elementFromPoint` pass with the pin container still visible.

It exists as a dedicated sub-module because the algorithm is **non-obvious enough that a future engineer reading the parent `OverlayRenderer` spec will want a focused reference**, and because every step (visibility flag, rAF wait, hit-test, restore, pin construction) has subtle correctness and performance constraints that deserve dedicated documentation.

## 2. Why It Exists (Rationale)

**Complex algorithm.** The hit-test trick is the only mechanism that lets a non-shadow-DOM overlay coexist with reliable click-to-pin on the host. Getting it wrong produces three failure modes:

1. **Hits the overlay** — pin gets attached to the Nodd portal instead of a host element.
2. **Reflow flicker** — using `display:none` instead of `visibility:hidden` triggers a relayout pass on every capture click.
3. **Click leaks** — the original click reaches the host page, navigating away or activating buttons unexpectedly.

A dedicated spec ensures each of these is enforced explicitly rather than rediscovered.

## 3. Algorithm

```
state: { isCapturing: false, onResolve: null }

beginCapture(onResolve):
  state.isCapturing = true
  state.onResolve   = onResolve
  set portalRoot.style.cursor = 'crosshair'
  set portalRoot.dataset.noddCapture = 'true'   // CSS hook for backdrop + pointer-events:auto
  add document keydown listener (Esc)
  add document click listener (capture phase, once)

onClick(ev):
  ev.preventDefault()
  ev.stopImmediatePropagation()
  const { clientX, clientY } = ev
  try:
    portalRoot.style.visibility = 'hidden'
    await new Promise(r => requestAnimationFrame(r))
    const target = document.elementFromPoint(clientX, clientY)
    if (target == null || target === document.body || target === document.documentElement):
      cancelCapture(reason: 'empty-area')
      return
    const pin = DOMAnchor.create(target, clientX, clientY)
    state.onResolve({ kind: 'pin.created', pin })
  finally:
    portalRoot.style.visibility = ''            // restore even on throw
    teardown()

onKeydown(ev):
  if (ev.key === 'Escape'):
    ev.preventDefault()
    cancelCapture(reason: 'esc')

cancelCapture(reason):
  state.onResolve?.({ kind: 'pin.dismissed', reason })
  teardown()

teardown():
  state.isCapturing = false
  state.onResolve   = null
  remove keydown + click listeners
  reset portalRoot.style.cursor
  delete portalRoot.dataset.noddCapture
```

### 3.1 Why each step

| Step | Reason |
|------|--------|
| `pointer-events: auto` on portal during capture (via `[data-nodd-capture] [data-nodd-root]` CSS) | The overlay must intercept the click. Without this the click would pass through to the host and the host would react before we hit-test. |
| `addEventListener('click', ..., { capture: true, once: true })` | Capture phase guarantees we receive the event before any host handler. `once:true` auto-cleans the listener if the click resolves; otherwise `teardown()` removes it. |
| `preventDefault()` + `stopImmediatePropagation()` | `stopImmediatePropagation` (not just `stopPropagation`) ensures any other capture-phase listeners on `document` also do not fire. |
| `visibility: hidden` (not `display: none`) | Preserves layout — no reflow, no flicker. The browser's hit-testing uses the most recent paint, which we trigger by waiting one frame. |
| `await rAF` | Forces the browser to commit a paint that omits the (now-invisible) overlay before we hit-test. One frame is sufficient because `visibility:hidden` does not invalidate layout. |
| `elementFromPoint(clientX, clientY)` | Now returns the host element under the cursor. |
| Restore in `finally` | If `DOMAnchor.create` throws (e.g., shadow DOM in host — see OverlayRenderer §17), the overlay must not stay invisible. |
| `target === body \|\| documentElement` ⇒ dismiss | Clicks on bare body have no meaningful anchor. Treat as "user cancelled by clicking empty area". |

### 3.2 Frame timeline

```
T0   : user clicks
T0+ε : capture-phase click handler runs
       → preventDefault + stopImmediatePropagation
       → set visibility:hidden
       → schedule rAF callback
T1   : browser composites/paints frame without overlay
T1+ε : rAF callback runs
       → elementFromPoint → host element
       → DOMAnchor.create
       → emit pin.created
       → restore visibility
T2   : next paint shows overlay + new pin marker
```

Total user-perceived latency: 1 frame (~16 ms at 60 Hz). Imperceptible.

## 4. Public Interface

`CaptureLayer` is rendered unconditionally inside the portal but is **inert** unless `isCapturing` is true. The hook contract:

```ts
type CaptureResult =
  | { kind: 'pin.created';   pin: Pin }
  | { kind: 'pin.dismissed'; reason: 'empty-area' | 'esc' | 'toolbar-toggle' };

export function useCaptureMode(): {
  isCapturing: boolean;
  beginCapture(onResolve: (r: CaptureResult) => void): void;
  cancelCapture(reason?: 'esc' | 'toolbar-toggle'): void;
};
```

Internal callers (toolbar / sidebar) call `beginCapture(handleResult)` and receive exactly one resolution callback per session. `OverlayRenderer` wires `pin.created` into `CommentStore.createThread(...)` and `pin.dismissed` into a no-op + UX feedback (see parent §11 for popover spawn on success).

`<CaptureLayer />` itself takes no props — it reads/writes context via `useCaptureMode()`.

## 5. Output Contract

| Output | Guarantee |
|--------|-----------|
| `pin.created` event | Exactly one per successful capture; carries a fully-formed `Pin` (`selector`, `offsetX`, `offsetY`, `fingerprint`, `viewportWidth`). |
| `pin.dismissed` event | Exactly one per cancelled capture; carries reason. |
| Original click | **Never** reaches host page handlers (capture-phase + `stopImmediatePropagation` + `preventDefault`). |
| Visibility toggle | Always restored before `pin.created`/`pin.dismissed` is emitted, even on exceptions. |
| Listeners | Removed on resolution, cancellation, or component unmount. No leaks. |

## 6. State

`CaptureLayer` owns minimal local state, kept in a React context (`CaptureContext`) so the toolbar (rendered elsewhere in the overlay tree) can read `isCapturing` and call `beginCapture` / `cancelCapture`:

| Field | Type | Purpose |
|-------|------|---------|
| `isCapturing` | `boolean` | Drives CSS classes (`crosshair`, backdrop) and gates listener attachment. |
| `pendingResolve` | `((r: CaptureResult) => void) \|null` | The single callback to invoke on resolution. Cleared in `teardown()`. |

No refs to live DOM elements are stored beyond the portal root, which is read from context.

## 7. Visual Feedback (Capture-Mode UX)

Per the design decision (§9 below), capture mode shows:

1. **Crosshair cursor** on the entire viewport via `[data-nodd-capture] [data-nodd-root] { cursor: crosshair !important; }` and on the host body too via a top-level `cursor: crosshair` on `<html>` while capturing — this avoids the cursor flickering between crosshair and default as the user moves between overlay-capture-area and host elements.
2. **Faint backdrop** (`background: rgba(0,0,0,0.04)`) on the portal root while `[data-nodd-capture]` is set — signals "you're commenting" without obscuring page content. Disabled when `prefers-reduced-motion: reduce` (no fade transition).
3. **Top toast** with text `"Click anywhere to leave a comment — press Esc or C to exit comment mode"` appearing in the top-center of the viewport. Anchored to the portal root, `pointer-events: none`. Slide-in 120 ms; respects reduced motion.

## 8. File Layout

```
src/overlay/components/
├── CaptureLayer.README.md    ← this document
├── CaptureLayer.tsx          ← React component + useCaptureMode hook (~120 lines)
└── __tests__/
    └── CaptureLayer.test.tsx ← jsdom + Playwright (real browser for hit-test)
```

`CaptureLayer.tsx` exports:
- Default React component `<CaptureLayer />` (renders backdrop + toast; attaches listeners while capturing).
- Named hook `useCaptureMode()` (consumed by toolbar / sidebar).
- Named context `CaptureContext` (internal to overlay package).

## 9. Design Decisions

| Decision | Rationale |
|----------|-----------|
| **`visibility: hidden` + 1-frame rAF wait, not `display: none`** | Performance: `display:none` would reflow the entire host page (overlay is `position:fixed`, but body's `min-height` etc. can still be affected). `visibility:hidden` keeps the box but suppresses paint and hit-testing. One frame is enough because hit-testing uses the most recent paint. |
| **Capture-phase listener with `stopImmediatePropagation`** | Correctness: prevents host handlers and any other capture-phase listeners from running. Bubble-phase would race host handlers attached during capture phase. |
| **Single-shot `{ once: true }` listener** | Simplicity: removes the listener after the first click without manual bookkeeping; `teardown()` still removes it explicitly when cancelled before any click. |
| **Esc + click-on-empty cancel paths** | UX: matches user expectations from common cancel idioms; both are cheap (single keydown listener, fall-through in click handler). Right-click was rejected to keep the host's contextmenu unaffected. |
| **Crosshair cursor + faint backdrop** | UX: backdrop signals "you are in a special mode" without competing visually with the hover-highlight (which uses an outline). Cursor confirms the affordance. Both vanish in `teardown()`. |
| **Backdrop opacity 4 %** | Just enough to perceive without obscuring page content for inspection-heavy workflows (the user is *commenting on* the page; they need to see it). |
| **No keyboard target selection in v1** | Out of scope (see OverlayRenderer §17). Keyboard-only pin creation is a v1.1 follow-up; current spec covers mouse/touch. |
| **`finally`-block visibility restore** | Robustness: if `DOMAnchor.create` throws (host shadow DOM, exotic targets), the overlay must not stay invisible. The `finally` makes this explicit and unconditional. |

## 10. Edge Cases

| Case | Behaviour |
|------|-----------|
| Click during a CSS animation on host | Hit-test runs against the post-rAF paint, which already reflects the animated state. Pin attaches to the element under the cursor at click time. |
| Click on `<iframe>` | `elementFromPoint` returns the `<iframe>` element itself (cross-origin) or whatever is at that point in same-origin frames. v1 attaches to the `<iframe>` element; users cannot pin inside cross-origin iframes (documented limitation, OverlayRenderer §17). |
| Click on host shadow DOM | `elementFromPoint` returns the shadow host. `DOMAnchor.create` may throw or produce a tier-3-only pin; capture treats this as `pin.created` and surfaces the result to the store, which logs a warning. |
| User scrolls mid-capture | No special handling needed — the click event carries `clientX/clientY` relative to the viewport at click time, which is what we want. |
| Devtools/host JS calls `.click()` programmatically | Treated as a real click. Tests should cover this. |
| Multiple `beginCapture` calls | The second call cancels the first (`pendingResolve` invoked with `pin.dismissed { reason: 'toolbar-toggle' }`) before installing new listeners. |
| Component unmounts mid-capture | `useEffect` cleanup runs `teardown()`; `pendingResolve` is invoked with `pin.dismissed { reason: 'toolbar-toggle' }` so the caller never hangs. |
| `requestAnimationFrame` never fires (tab backgrounded) | Browsers throttle rAF to ≥1 Hz when backgrounded. Acceptable: the click was almost certainly synthetic in this case. A 250 ms `setTimeout` fallback wraps the rAF wait to guarantee resolution. |

## 11. Performance Budget

| Operation | Target |
|-----------|--------|
| `beginCapture` → cursor change visible | < 16 ms (next frame) |
| Click → `pin.created` emitted | < 32 ms (≤ 2 frames: visibility-hidden frame + paint+hit-test frame) |
| Listener footprint while idle (`isCapturing=false`) | Zero document-level listeners. Only React effects. |

## 12. Testing Strategy

Unit (jsdom):
- `beginCapture` installs listeners; `cancelCapture` removes them.
- `Esc` triggers `pin.dismissed { reason: 'esc' }`.
- `pendingResolve` is called exactly once per session.
- Multiple `beginCapture` calls cancel the prior session.
- Component unmount mid-capture invokes `pin.dismissed` with reason `toolbar-toggle`.

Integration (Playwright, real browser — required because `elementFromPoint` semantics differ from jsdom):
- Click on host element with overlay visible → host element is identified, host click handler does **not** fire.
- Click on body / empty area → `pin.dismissed { reason: 'empty-area' }`.
- Visibility-hidden round-trip is invisible to the user (frame-by-frame screenshot diff).
- `prefers-reduced-motion` disables backdrop fade.

## 13. Links

- **Parent module:** [OverlayRenderer](../README.md)
- **Sibling sub-modules:** [DOM Anchoring](../anchoring/README.md) (consumed via `DOMAnchor.create`), [MentionPicker](./MentionPicker.README.md) (sibling component)
- **Architecture references:** [DESIGN_DOC §6 Overlay Z-Index & Pointer-Events](../../../DESIGN_DOC.md#6-overlay-z-index--pointer-events-strategy), [§5 DOM Anchoring](../../../DESIGN_DOC.md#5-dom-anchoring-strategy)
