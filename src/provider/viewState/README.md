# `src/provider/viewState/` — host view state

## 1. The one thing the DOM doesn't record

Everything in `src/provider/state/` works by reading the DOM: a `role`, a layout, an ARIA link. That covers overlays, menus, tabs and accordions — but not this:

```tsx
const [page, setPage] = useState(1);            // comment left on page 4
const [demoState, setDemoState] = useState('0'); // comment left in scenario "problems"
```

A comment anchored to a row on page 4 vanishes when the list returns to page 1. The anchor isn't hidden and it isn't stale — **it does not exist**, because the host is rendering a different slice of the same UI. There is nothing in the document that says "a function called `setPage` exists, and passing it `4` would bring this row back."

Two shortcuts were considered and rejected:

- **Put view state in the URL.** That is a host-architecture mandate, and Nodd is an npm library consumed by arbitrary React apps. Plenty of consumers can't: state in Redux or Zustand, virtualised lists, third-party components, a router that owns the URL.
- **Replay whichever control was pressed last.** This is precisely the press-the-wrong-thing failure `DOMAnchor.resolveRef` exists to prevent — "the 4th pagination button" on a re-sorted list is a different button.

## 2. The contract

One line, at the site of the state itself. No lifting, no store, no provider prop:

```tsx
const [page, setPage] = useState(1);
useNoddViewState('page', page, setPage);
```

That's the whole API. At capture time the registered values are snapshotted onto `pin.viewState`; at reveal time they're passed back to `restore` before the anchor is re-resolved. **Nodd never interprets the value** — it is an opaque blob owned by the host, which is what lets a URL-based app, a Redux app and a `useState` app each satisfy the same contract without Nodd knowing which is which.

Deliberately *not* a provider-level `captureViewState` / `restoreViewState` pair. That reads as "one line per app", but a `useState` inside a leaf component is not reachable from `<NoddProvider>`, so in practice it would mean lifting state throughout the app. Per-site registration is one line per slice, added incrementally, only where someone cares.

## 3. Rules

| Rule | Why |
|---|---|
| Values must be plain JSON — `null`, finite numbers, strings, booleans, arrays, plain objects | A `Map`, `Date` or class instance *does* survive `JSON.stringify` but comes back as something else (`{}`, a string). Handing that to `restore` as if it were real is worse than declining, so it is skipped silently. Cycles and `NaN` are likewise skipped. |
| Keys are per screen | A thread is only revealed on the `urlPath` it was written on, so two screens may both use `'page'`. |
| Registration is module-level, keyed by the box not the value | Restoring re-renders and remounts the very component that registered — the registry has to survive that and still read the current setter. |
| A missing key is reported, never thrown | A pin written by an older build can name a slice that no longer exists. Reveal must degrade. |
| A `restore` that throws is contained to its key | The other slices still apply; the caller learns the truth by re-resolving the anchor, not from a success flag. |
| Values that already match are skipped | Revealing a comment on the screen you're already looking at must not churn host state. |
| `restore` may be async and is awaited | Returning once the new content has rendered gives the best results; there is an anchor settle budget either way. |

## 4. Where it runs in reveal

`OverlayRenderer.revealThread` applies view state **first**, before `activateState`:

```
route to screen → applyViewState → activateState (overlays) → discloseAncestors (tabs/sections) → re-anchor → open
```

Ordering matters: a dialog opened from a row on page 4 needs page 4 to exist before there is a row to open it from. The step is skipped entirely when the anchor already resolves and is rendered, so the common case costs one `DOMAnchor.resolve`.

## 5. What happens without it

Nothing breaks, and no consumer is required to adopt it. A comment in an unregistered slice still opens — at the nearest surviving container, dashed, labelled *"Showing this nearby — 'Robert Fox' isn't on this screen right now"* (see `overlay/anchoring/README.md` §5.3.1). It simply can't be put back exactly.

That is the honest division of labour: degraded anchoring is universal and automatic; exact restoration of host view state is opt-in, because only the host knows how.

## 6. Files

```
src/provider/viewState/
├── README.md              ← this document
├── index.ts               ← public re-exports
├── registry.ts            ← module-level registry, capture + apply
├── useNoddViewState.ts    ← the hook hosts call
└── __tests__/             ← contract coverage
```
