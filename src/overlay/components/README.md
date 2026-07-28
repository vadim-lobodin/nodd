# Overlay Components

> The visible UI of Nodd: pin markers, hover highlight, comment thread popover, slide-out sidebar, the @mention picker, and the click-to-pin capture layer. This document specifies the **component-level contract** — props, state, and interaction sequences — for every React component rendered into the `[data-nodd-root]` portal.

Parent: [OverlayRenderer](../README.md) · Architecture: [Nodd — Architecture Design](../../../DESIGN_DOC.md)

## 1. Purpose & Why This Exists

The parent [`OverlayRenderer`](../README.md) document describes the *system-level* view of the overlay (portal, z-index, anchoring, ResizeObserver loop, etc.). It deliberately stops short of the **per-component contract**: the props each component takes, the state it owns, the keyboard/mouse interaction sequences, and the placement/animation algorithms.

This sub-module README fills that gap. It exists for three reasons:

1. **Reusable presentational layer.** All six components are pure(-ish) React; they consume context from `OverlayRenderer` but render independently. Documenting their props in one place lets the orchestrator and tests share a single source of truth.
2. **Non-trivial UI algorithms.** Two components — `ThreadPopover`'s placement fallback chain and `Sidebar`'s tab-driven lazy loading + drawer animation — contain enough logic to deserve dedicated docs.
3. **Cross-component interaction sequences.** Several behaviours span multiple components (e.g. *click pin → open popover → type `@` → open MentionPicker → select → close picker*). These are easier to specify once, here, than to scatter across individual files.

The two algorithmically-deepest components — `MentionPicker` and `CaptureLayer` — already have standalone specs ([MentionPicker.README.md](MentionPicker.README.md), [CaptureLayer.README.md](CaptureLayer.README.md)). This document gives an integration view and is the canonical place for `PinMarker`, `HoverHighlight`, `Sidebar`, and `ThreadPopover`.

## 2. Component Map

```mermaid
graph TD
  OR[OverlayRenderer] -->|renders| Pins[PinMarker xN]
  OR -->|renders| Hover[HoverHighlight]
  OR -->|renders| Side[Sidebar]
  OR -->|renders, when capturing| Cap[CaptureLayer]
  Pins -->|click| Pop[ThreadPopover]
  Side -->|click item| Pop
  Pop -->|@ trigger in textarea| Mention[MentionPicker]
  Side -.hover.- Hover
  Pins -.hover.- Hover
```

Every component reads from `useNoddContext()` (store, auth, route) and emits via injected callbacks. None talks directly to Supabase or to other components — `OverlayRenderer` is the bus.

## 3. File Layout

| File | Responsibility | Owns |
|------|----------------|------|
| `PinMarker.tsx` | Numbered, clickable marker for one thread on the page | local hover state |
| `HoverHighlight.tsx` | Single shared element-outline rect, follows the currently-hovered pin | imperative ref API |
| `Sidebar.tsx` | Slide-out drawer with Open/Resolved tabs and the thread list | active tab, resolved-fetch state |
| `ThreadPopover.tsx` | Anchored popover with comments, reply box, resolve toggle | placement, draft text, submit state |
| `MentionPicker.tsx` | Listbox triggered by `@` in a textarea | spec'd separately — see [MentionPicker.README.md](MentionPicker.README.md) |
| `CaptureLayer.tsx` | Full-viewport click interceptor for capture mode | spec'd separately — see [CaptureLayer.README.md](CaptureLayer.README.md) |
| `FormControls.tsx` | Stateless grayscale `NoddInput` and `NoddButton` primitives for Nodd-owned forms | native input/button state |
| `VariantSelector.tsx` | Controlled grayscale radiogroup for selecting a prototype variant | selected option |
| `index.ts` | Barrel; re-exports the overlay components and UI primitives above | — |

## 4. PinMarker

A small numbered circle anchored to a host element. One per non-orphan thread on the current `url_path`.

### 4.1 Props

```ts
type PinMarkerProps = {
  threadId: string;
  index: number;             // 1-based, matches sidebar order
  x: number;                 // computed by OverlayRenderer (translate)
  y: number;
  state: 'idle' | 'unread' | 'active';
  authorAvatarUrl?: string;  // shown as small badge on the pin
  onOpen: (threadId: string) => void;
  onHoverChange: (threadId: string | null) => void;
};
```

### 4.2 Local state

- `hovered: boolean` — drives the slight scale-up and the call to `onHoverChange`.
- That is all. Position, number, and identity are props.

### 4.3 Visual states

| State | Trigger | Style |
|-------|---------|-------|
| `idle` | default | filled accent, white digit |
| `unread` | thread has comments newer than `last_read_at` | accent + 2px halo + small dot |
| `active` | popover for this thread is open | elevated z-index within portal, slight shadow |

### 4.4 Interaction sequence

```
mouseenter → setHovered(true) → onHoverChange(threadId)   // HoverHighlight follows
mouseleave → setHovered(false) → onHoverChange(null)
click      → onOpen(threadId)                              // OverlayRenderer mounts ThreadPopover
keydown Enter (when focused) → same as click
```

A pin is keyboard-focusable (`tabIndex=0`) and announces `aria-label="Comment {index} by {author}, {n} replies"`.

## 5. HoverHighlight

A single absolutely-positioned rectangle reused across all hover sources. Owned and mutated *imperatively* by `OverlayRenderer` via a ref to avoid re-rendering on every hover-move.

### 5.1 Imperative API (ref)

```ts
type HoverHighlightHandle = {
  show(rect: DOMRect): void;   // updates transform + width/height; sets display:block
  hide(): void;                // display:none
  refresh(): void;             // re-reads cached anchor element's rect (for ResizeObserver loop)
};
```

### 5.2 Props

```ts
type HoverHighlightProps = {
  // none — purely imperative.
};
```

### 5.3 Why imperative?

Hover events fire many times per second. Pushing a `rect` through React state on every move would re-render the parent. The handle pattern keeps state inside a single DOM node and lets `OverlayRenderer` rAF-coalesce updates (per parent §9 and §14).

### 5.4 Style

```css
[data-nodd-root] .nodd-hover-highlight {
  position: absolute;
  pointer-events: none;
  outline: 2px solid var(--nodd-accent);
  border-radius: 4px;
  box-shadow: 0 0 0 6px rgba(79, 70, 229, 0.12);
  display: none;
  transition: transform 80ms linear, width 80ms linear, height 80ms linear;
}
@media (prefers-reduced-motion: reduce) {
  [data-nodd-root] .nodd-hover-highlight { transition: none; }
}
```

## 6. Sidebar

Slide-out drawer pinned to the right edge of the viewport. Lists every thread on the current page and lets users navigate, filter Open / Resolved, and triage.

### 6.1 Props

```ts
type SidebarProps = {
  open: boolean;                                // controlled by NoddProvider
  onClose: () => void;
  urlPath: string;
  threadsOpen: ThreadSummary[];                 // from CommentStore (live)
  fetchResolved: () => Promise<ThreadSummary[]>;// lazy
  onItemOpen: (threadId: string) => void;       // → opens ThreadPopover
  onItemHover: (threadId: string | null) => void;
};

type ThreadSummary = {
  id: string;
  index: number;
  authorName: string;
  authorAvatarUrl?: string;
  snippet: string;          // first comment, trimmed to ~80 chars
  createdAt: string;        // ISO
  replyCount: number;
  resolved: boolean;
  unread: boolean;
};
```

### 6.2 Local state

```ts
{
  activeTab: 'open' | 'resolved';
  resolvedItems: ThreadSummary[] | null;        // null = not fetched yet
  resolvedStatus: 'idle' | 'loading' | 'error';
  search: string;                               // simple substring filter on snippet+author
}
```

### 6.3 Tab semantics

- **Open tab (default).** Renders `threadsOpen` directly. Live-updated by `CommentStore` realtime.
- **Resolved tab.** First click triggers `fetchResolved()`; result is cached for the session in `resolvedItems`. Re-entering the tab does *not* refetch unless the session is invalidated (route change with `purgeResolvedCache=true` is set by `OverlayRenderer` if the user resolves a new thread).
- **Switching tabs** does not animate the drawer; only the list cross-fades over 120 ms.
- **Empty states.** Open: "No comments on this page yet — add the first one." Resolved: "Nothing here yet." Loading: skeleton rows.

### 6.4 Drawer animation

```
Mount: render with transform: translateX(100%); opacity: 0
       next frame → transform: translateX(0);  opacity: 1
       transition: 180ms cubic-bezier(0.2, 0, 0, 1)

Unmount: reverse, then remove from DOM after onTransitionEnd.
```

The animation runs on the GPU (`transform` + `opacity` only). Backdrop is *not* dimmed — the host page must remain fully visible. `prefers-reduced-motion: reduce` collapses the duration to 0 and uses a fade only.

### 6.5 Item interaction

```
hover item   → onItemHover(threadId)   // HoverHighlight follows the pin's anchor
click item   → resolve pin's anchor → scrollIntoView({ block: 'center', behavior: 'smooth' })
              → onItemOpen(threadId)   // OverlayRenderer opens ThreadPopover anchored to the pin
              → Sidebar stays open on desktop; auto-closes when viewport < 640px wide.
```

### 6.6 Keyboard

- `Esc` while focus is inside sidebar → `onClose()`.
- `↑/↓` cycle list items; `Enter` is the same as click.
- `Tab` order: tabs → search → list → close button. Focus is trapped in the drawer when open on small viewports.

## 7. ThreadPopover

The most behaviour-rich component: anchored placement, optimistic submit, mention-picker hosting, dismissal rules.

### 7.1 Props

```ts
type ThreadPopoverProps = {
  threadId: string;
  anchorEl: Element;              // typically the PinMarker DOM node
  comments: Comment[];            // from CommentStore (live)
  currentUser: { id: string; displayName: string; avatarUrl?: string };
  isProjectMember: boolean;
  resolved: boolean;
  onSubmitReply: (body: string, mentions: string[]) => Promise<void>;
  onEditComment:  (id: string, body: string, mentions: string[]) => Promise<void>;
  onDeleteComment:(id: string) => Promise<void>;
  onToggleResolved: () => Promise<void>;
  onClose: () => void;
};
```

### 7.2 Placement strategy — Floating-UI-style fallback chain

The popover is positioned with a hand-rolled placement engine modelled on Floating UI's `flip` middleware. We do not depend on Floating UI itself to keep the bundle ≤ 35 kB gz (per `GOAL&REQUIREMENTS`).

Algorithm:

```
1. Read viewport: { vw, vh } and anchor rect: a = anchorEl.getBoundingClientRect().
2. Read the popover's measured size by rendering it once into a hidden measurement
   layer (visibility:hidden; pointer-events:none; transform:translate(-99999px,0)),
   reading offsetWidth/offsetHeight, then translating to the real position.
   (Done once per open; re-measured on internal layout changes via ResizeObserver.)
3. Candidate placements, in priority order:
       right-start, left-start, bottom-start, top-start
4. For each candidate, compute the popover rect (px, py, pw, ph) using:
       right-start  : px = a.right + GAP,           py = a.top
       left-start   : px = a.left  - GAP - pw,      py = a.top
       bottom-start : px = a.left,                  py = a.bottom + GAP
       top-start    : px = a.left,                  py = a.top - GAP - ph
   GAP = 8.
5. A candidate fits if px ≥ MARGIN && py ≥ MARGIN
                  && px + pw ≤ vw - MARGIN
                  && py + ph ≤ vh - MARGIN.
   MARGIN = 8.
6. First fitting candidate wins. If none fits, pick the candidate with the
   largest visible-area intersection with the viewport (largest min-overflow),
   then clamp px,py into [MARGIN, viewport - MARGIN - size].
7. If max-height would exceed (vh - 2·MARGIN), shrink the popover's max-height
   to that value and let internal scroll handle overflow.
```

The chosen placement is exposed as a CSS data-attribute (`data-placement="right-start"`) so the arrow/pointer can flip side. Re-runs on:
- viewport resize (debounced via the parent's rAF loop),
- anchor element resize/move (own ResizeObserver on `anchorEl`),
- popover content size change (own ResizeObserver on the popover root).

### 7.3 Local state

```ts
{
  placement: 'right-start' | 'left-start' | 'bottom-start' | 'top-start';
  pos: { x: number; y: number; maxHeight: number };
  draft: string;                              // textarea value
  draftMentions: string[];                    // user IDs
  submitting: boolean;
  optimisticReplies: { tempId: string; body: string; mentions: string[] }[];
  editingId: string | null;
  mentionPickerOpen: boolean;
  caretRect: DOMRect | null;                  // passed to MentionPicker for positioning
}
```

### 7.4 Optimistic submit / reconciliation

```
onSubmit():
  tempId = crypto.randomUUID()
  push optimistic { tempId, body, mentions } into optimisticReplies → render with "sending..."
  setSubmitting(true); setDraft(""); setDraftMentions([])
  try:
    await onSubmitReply(body, mentions)        // CommentStore inserts + emits realtime
    // The realtime event will add the canonical Comment to `comments` prop.
    // We remove the optimistic entry once a comment with matching (author, body, createdAt±2s) appears,
    // OR after a 5s timeout (whichever first), at which point we fall back to a hard refetch.
  catch (err):
    mark the optimistic entry { error: true, retry: () => onSubmit() } and keep it visible.
  finally:
    setSubmitting(false)
```

Edits and deletes use the same pattern via `onEditComment` / `onDeleteComment`.

### 7.5 Mention integration

The reply textarea is a plain `<textarea>` (not contenteditable — see `MentionPicker.README.md` §4 for why). On every `input`/`keyup`/`click`/`select` event:

```
1. Compute caret position (selectionStart) in the textarea.
2. Walk back from caret until whitespace or string start; capture token = chars after the last '@'.
3. If token matches /^@[\w.\-]*$/ and the char before '@' is whitespace or string start:
     compute caretRect via the textarea-mirror trick (see MentionPicker §3),
     setMentionPickerOpen(true), setCaretRect(rect), pass token as `query` prop.
   else:
     setMentionPickerOpen(false).
4. On MentionPicker.onSelect(member):
     replace the @-token with `@${member.displayName} ` in the draft,
     append member.id to draftMentions (deduped),
     setMentionPickerOpen(false), refocus textarea.
```

ArrowUp/Down/Enter/Tab/Esc events are forwarded to the picker via a callback ref while it is open, then `preventDefault()` so the textarea does not move the caret.

### 7.6 Dismissal rules

The popover closes (calls `onClose()`) when **any** of:

- `Esc` is pressed (and `mentionPickerOpen` is false — Esc closes the picker first).
- An outside `mousedown` lands on a node that is **neither** inside the popover **nor** the source `anchorEl` (the pin). The pin is excluded so clicking it does not immediately re-open.
- The user successfully resolves the thread (after the optimistic toggle is reconciled).
- The route changes (`url_path` changes — the popover's thread may not belong to the new page).

The popover does **not** close on:
- Clicks inside `MentionPicker` (it is a portal child of the popover for outside-click purposes).
- Window blur (e.g. user opens DevTools).

### 7.7 Visual

- 320 px wide; `max-height: min(60vh, 480px)` after placement clamp.
- Header: thread index (`#3`), author, timestamp, "Resolve" toggle (member-only), close (✕).
- Body: comment list, scrollable. Mention chips are inline `<span class="nodd-mention">` rendered from `body` + `mentions[]`.
- Footer: avatar + textarea + Send button. Send disabled while `submitting` or `draft.trim() === ''`.

### 7.8 Accessibility

- `role="dialog"`, `aria-labelledby` points to the header thread index, `aria-modal="false"` (host page must remain interactive).
- Focus moves to the textarea on open; on close it returns to the source pin.
- Each comment's edit menu is a `<button aria-haspopup="menu">`.

## 8. MentionPicker (integration summary)

Full details: [MentionPicker.README.md](MentionPicker.README.md). Integration contract from `ThreadPopover`:

### 8.1 Props passed in

```ts
type MentionPickerProps = {
  open: boolean;
  query: string;                                  // text after '@'
  caretRect: DOMRect | null;                      // anchors the listbox
  members: ProjectMember[];                       // from CommentStore session cache
  recentCollaborators: string[];                  // user IDs, used for ranking
  onSelect: (member: ProjectMember) => void;
  onCancel: () => void;
  onKeyboardRef: (handler: (e: KeyboardEvent) => boolean) => void; // for ↑/↓/Enter/Esc forwarding
};
```

### 8.2 Caret tracking (summary)

The picker is positioned **above** the caret if there is < 200 px of space below it, otherwise below. The caret rect is computed by `ThreadPopover` using the textarea-mirror technique:

```
1. Maintain a hidden <div> ("mirror") with identical font, padding, border, width
   and white-space rules to the textarea.
2. On compute: set mirror.textContent = textarea.value.slice(0, caretIndex);
   append a <span id="caret"></span>; copy textarea.scrollTop.
3. caretRect = mirror.querySelector('#caret').getBoundingClientRect()
              translated by textarea.getBoundingClientRect() − mirror's origin.
```

This avoids contenteditable's accessibility and IME complexity (see MentionPicker spec §6).

### 8.3 Ranking (summary)

`MentionPicker` ranks `members` filtered by case-insensitive substring of `displayName`. There is no email matching — migration `0007` dropped `email` from the `profiles` view, and `display_name` already falls back to the address' local part server-side, so an `@alice` query still resolves.

```
score(m) = (startsWith(displayName, query) ? 100 : 0)
        + (recentCollaborators.indexOf(m.id) === -1 ? 0 : (10 - min(9, idx)))
        − (containsAt(displayName, query) ? 0 : 1)   // tiebreak against pure substring
```

Top 8 are shown. See MentionPicker spec §7 for the full scoring spec.

## 9. CaptureLayer (integration summary)

Full details: [CaptureLayer.README.md](CaptureLayer.README.md). Integration contract:

### 9.1 Mount conditions

`OverlayRenderer` mounts `<CaptureLayer />` **only** while `useCaptureMode().isCapturing === true`. When unmounted, the layer leaves no listeners behind. While mounted, the portal root flips `pointer-events: auto` and the cursor becomes a crosshair.

### 9.2 visibility:hidden hit-test (recap)

Capture-mode click flow, repeated here for component-level clarity:

```
on document.click (capture phase):
  ev.preventDefault(); ev.stopPropagation();
  const { clientX, clientY } = ev;
  portalRoot.style.visibility = 'hidden';
  await new Promise(r => requestAnimationFrame(r));
  let target: Element | null;
  try {
    target = document.elementFromPoint(clientX, clientY);
  } finally {
    portalRoot.style.visibility = 'visible';
  }
  if (!target || target === document.body) {
    onCancel();                     // emit pin.dismissed
  } else {
    const pin = DOMAnchor.create(target, clientX, clientY);
    onCreate(pin);                  // emit pin.created
  }
```

Why `visibility:hidden` and not `display:none`: `display:none` triggers reflow on every capture click and can flicker the host page; `visibility:hidden` removes Nodd from hit-testing on the next paint while preserving layout. One `rAF` is sufficient because the browser's hit-tester uses the most recently committed paint.

### 9.3 Props

```ts
type CaptureLayerProps = {
  onCreate: (pin: Pin) => void;
  onCancel: () => void;            // also called on Esc and on click of empty area
  portalRootRef: React.RefObject<HTMLElement>;
};
```

### 9.4 Cancel paths

- `Esc` keypress.
- Click hits `document.body` or null (per algorithm above).
- The "Cancel" affordance in the toolbar (sets `isCapturing = false` upstream → unmounts the layer).

### 9.5 Visual

A subtle 10 % black overlay outside the cursor's element, plus a crosshair cursor and a small floating tooltip near the cursor: "Click any element to comment · Esc to cancel". The overlay is *not* a backdrop — it's a transparent layer with `cursor: crosshair` set on the portal root.

## 10. Cross-Component Interaction Sequences

The most common end-to-end flows, listed for test design and engineering hand-off.

### 10.1 Create a comment

```
Signed-in viewer presses "C"
  → useCaptureMode().beginCapture()
  → CaptureLayer mounts; portal pointer-events:auto; crosshair cursor
User clicks a paragraph
  → CaptureLayer hit-test (visibility:hidden + rAF + elementFromPoint)
  → DOMAnchor.create(target, x, y) → Pin
  → onCreate(pin) → OverlayRenderer creates a placeholder ThreadPopover
                    anchored to (x, y) with empty thread
User types message, optionally @mentions someone
  → MentionPicker opens/closes per §7.5
User clicks Send
  → optimistic comment appears; CommentStore.create(thread + comment) called
  → realtime echoes back; optimistic entry reconciled
  → CaptureLayer unmounts; ThreadPopover stays open
```

### 10.2 Open an existing thread from a pin

```
Hover pin → HoverHighlight.show(anchorEl.getBoundingClientRect())
Click pin → onOpen(threadId)
         → OverlayRenderer mounts ThreadPopover with anchorEl=pinEl
         → ThreadPopover.placement runs fallback chain
Type reply, send
         → optimistic + reconcile (§7.4)
Click outside or press Esc
         → ThreadPopover.onClose; HoverHighlight.hide()
```

### 10.3 Triage from sidebar

```
Open sidebar (toolbar or hotkey)
  → Sidebar slides in (§6.4)
Hover item
  → onItemHover → HoverHighlight follows the pin's anchor
Click item
  → resolve pin → scrollIntoView → onItemOpen → ThreadPopover opens (§10.2)
Switch to Resolved tab
  → first time: fetchResolved() → loading skeleton → list cross-fade
  → subsequent: instant cached render
Resolve a thread from the popover
  → optimistic toggle → on reconcile, thread leaves Open list and joins Resolved cache
```

## 11. Data Structures (component-local types)

| Type | Owner | Purpose |
|------|-------|---------|
| `PinMarkerProps` | `PinMarker.tsx` | Props from `OverlayRenderer` (position pre-computed) |
| `HoverHighlightHandle` | `HoverHighlight.tsx` | Imperative ref API (no React state) |
| `SidebarProps`, `ThreadSummary` | `Sidebar.tsx` | Drawer + list contract |
| `ThreadPopoverProps`, `Placement` | `ThreadPopover.tsx` | Popover contract + 4-way placement enum |
| `MentionPickerProps`, `ProjectMember` | `MentionPicker.tsx` | See MentionPicker spec |
| `CaptureLayerProps` | `CaptureLayer.tsx` | See CaptureLayer spec |
| `Pin` | re-exported from `../anchoring/DOMAnchor` | Anchor descriptor used by capture flow |

`Comment` and `Thread` are owned by [`CommentStore`](../../store/README.md) and consumed verbatim.

## 12. Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Hand-rolled Floating-UI-style placement** instead of pulling in `@floating-ui/dom` | Bundle budget. The four-candidate fallback chain plus single-axis clamp is < 1 kB of code; Floating UI adds ~12 kB gz even with tree-shaking. We do not need middlewares like `shift` or `arrow`-collision; a single arrow that flips per `data-placement` is sufficient. |
| **Imperative ref API for `HoverHighlight`** | Hover-move events fire many times per second. Re-rendering the React tree on each move would be wasteful and can cause jank in large sidebars. A single mutable DOM node updated via ref keeps cost O(1) and lets the parent rAF-coalesce updates. |
| **Plain `<textarea>` for the reply box** (not contenteditable) | Contenteditable has well-known pain (IME, accessibility, paste sanitisation, undo stack). The textarea-mirror caret trick is < 50 lines of code and works in every browser. Mention chips are visual-only on render; the underlying text uses `@displayName` plus a `mentions[]` array. |
| **Optimistic submit with realtime reconciliation** (not pessimistic) | Sub-200 ms perceived response is a hard requirement (per `GOAL&REQUIREMENTS`). Network round-trips to Supabase routinely exceed 200 ms on 4G. Reconciling on the realtime echo gives correctness; matching by `(author, body, createdAt±2s)` avoids duplicates without server-assigned client-IDs. |
| **`visibility:hidden` for capture hit-test** | `display:none` triggers reflow on every capture click and can flicker host content. `visibility:hidden` preserves layout; one `rAF` is sufficient because hit-testing uses the most recent paint. (Repeated from parent §7 for component-level completeness.) |
| **Sidebar drawer slides on `transform` only, no backdrop dim** | Per `GOAL&REQUIREMENTS`: "zero impact when off, minimal impact when on". A dimmed backdrop would visually obscure the host page and break the spirit of an in-context overlay. `transform` + `opacity` keep the animation on the GPU and respect `prefers-reduced-motion`. |
| **Lazy-load resolved tab once per session** | Resolved threads are read-only history; refetching every tab switch is wasteful. We invalidate only when the user resolves a new thread, so the cache cannot drift unobserved. |
| **MentionPicker is a child of the popover for outside-click purposes** | The picker is rendered into the same portal as the popover, but `ThreadPopover`'s outside-click guard treats descendants of either node as "inside". This avoids the popover closing when the user clicks the picker. |

## 13. Testing Strategy

- **Snapshot tests (Playwright)** for visual placements: pin near each viewport corner, sidebar drawer open/closed, popover at all four placements.
- **jsdom unit tests** for placement math, mention tokenisation, optimistic-reconciliation matching, sidebar tab caching invariants.
- **Interaction integration tests (Playwright)** for the three sequences in §10.
- **A11y audit** with `axe-core` on each component in isolation: focus order, ARIA roles, contrast.

## 14. Known Limitations

- **Popover near anchor edges with no fitting placement** falls back to clamping; in very narrow viewports the popover may visibly overlap the anchor pin. v1 accepts this.
- **MentionPicker over a textarea inside an iframe** is not supported. The textarea-mirror requires same-document layout.
- **Sidebar focus trap on mobile** uses CSS `inert` polyfill behaviour; very old browsers without `inert` will still let Tab escape into the host page.
- **Animations under `prefers-reduced-motion`** collapse durations to zero but do not provide alternative cues. Acceptable for v1.
- **Capture mode + iframes**: see parent §17.

## 15. Links

- **Parent module:** [OverlayRenderer](../README.md)
- **Sibling sub-modules:** [DOM Anchoring](../anchoring/README.md), [MentionPicker](MentionPicker.README.md), [CaptureLayer](CaptureLayer.README.md)
- **References:** Architecture §5 (DOM anchoring), §6 (z-index), §8 (sub-200ms strategy); `GOAL&REQUIREMENTS` (bundle budget, zero-impact-when-off)
