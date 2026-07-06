# Variants — Implementation Plan

Status: approved design, ready to implement.
Scope: new feature for the `nodd` library. No database migration, no store changes, no CLI changes (see "Why no backend changes" below).

## 1. What we're building

Prototypes often contain several versions of the same screen or component (two hero designs, single-page vs wizard checkout). **Variants** lets the prototype author declare those versions in code, and lets reviewers switch between them from the Nodd overlay:

- A new **Variants button** appears in the bottom-right toolbar shown in comment mode (pressing `C`).
- Clicking it (or pressing `V`) opens a **Variants panel** — same visual shell as the comments sidebar — with two sections: **Global** (app-wide, feature-flag-like) and **This page**.
- Each variant shows its options as a segmented pill control; clicking an option switches the live prototype instantly.

### Product decisions (agreed with the user — do not re-litigate)

1. **Per-viewer switching.** Flipping a variant changes only the current viewer's browser (persisted in `localStorage`). No sync of the selection between viewers. Shared/broadcast selection is explicitly out of scope for v1.
2. **Comments are variant-aware: tag + hide mismatches.** A comment placed while `hero=bold` was on screen records that; its pin is hidden when the viewer looks at `hero=minimal`, and the comment is still reachable from the sidebar with variant context shown. *(This falls out of the existing `state_key` machinery for free — see §3.)*
3. **API shape: hook + wrapper component.** `useVariant()` for logic/flag-style use, `<Variant>` for swapping whole JSX blocks.
4. **Scoping is automatic.** A variant mounted on one page is "This page"; mounted on 2+ pages (or declared `scope: 'global'`) it's "Global".

## 2. Public API

Exported from `src/index.ts` (new exports, alongside `NoddProvider`, `useNodd`, `NoddState`, …):

```tsx
// Hook — feature-flag style. Returns the active option (default: first).
// Safe without <NoddProvider>: returns options[0], never throws.
const layout = useVariant('checkout-layout', ['single-page', 'wizard'], {
  label: 'Checkout layout',   // optional, panel display name
  scope: 'global',            // optional, forces the Global section
});

// Component — swap whole blocks. Options derived from object keys.
<Variant
  name="hero"
  label="Hero style"
  options={{
    minimal: <HeroMinimal />,
    bold: <HeroBold />,
  }}
/>
```

`Variant` is sugar over `useVariant` **plus** it wraps the active child in the existing `<NoddState name={`${name}:${active}`}>` wrapper — that one line is what makes comments variant-aware (§3).

Types to export: `VariantScope = 'global' | 'page'`, `UseVariantOptions`, `VariantProps`.

## 3. Why no backend changes — reuse of the state system

Nodd already ships **state-aware comments** (see `DESIGN_DOC.md:285` and `src/provider/state/`):

- `<NoddState name>` (`src/provider/state/NoddState.tsx:13`) renders a `display: contents` div with `data-nodd-state`, and nests via `NoddStateContext`.
- New threads record a slash-joined breadcrumb of the `data-nodd-state` ancestry of the click target into `threads.state_key` (`OverlayRenderer.tsx:183-198`). The column exists in the frozen baseline `0001_nodd_init.sql:31`.
- Pin gating: `resolveAllPins` (`OverlayRenderer.tsx:94-115`) computes `isStateMatch(thread.stateKey, domStack)`; mismatched pins are hidden from the page and surfaced in the Sidebar under the "Other states · N" pill.
- The reanchor loop's MutationObserver (`OverlayRenderer.tsx:138`, `onDOMMutation → domVersion++`) already re-runs resolution whenever the host DOM changes — which is exactly what a variant switch is.
- The **activator registry** (`src/provider/state/activator.ts`) lets "Show me" on an off-screen comment programmatically bring its state on screen via `activateState(stack)`.

Therefore, by expressing the active variant as a state segment `"{name}:{option}"`:

| Requirement | How it's satisfied |
|---|---|
| Comment records the active variant | Existing capture walks `data-nodd-state` ancestry → `state_key` gets e.g. `hero:bold` |
| Pin hidden when the other option is shown | Existing `isStateMatch`: current stack is `['hero:minimal']`, thread key `hero:bold` → mismatch |
| Mismatched comments still reachable | Existing Sidebar "Other states · N" pill with breadcrumb (`hero:bold`) |
| Clicking such a comment switches the variant | Register an **activator** named `hero:bold` that calls `setSelection('hero','bold')`; existing `activateState` calls it and waits for the DOM |
| Pins re-resolve after a switch | Existing MutationObserver in the reanchor loop |
| Persistence of the tag across viewers | Existing `state_key` column — no migration |

**Limitation (document it):** hook-only variants have no DOM wrapper, so comments placed in hook-controlled regions are not tagged. That's acceptable — hook use is for flags/styling where "which variant is this comment about" is inherently fuzzy. The README must tell authors to prefer `<Variant>` when they want variant-aware comments.

## 4. New module: `src/provider/variants/`

Lives next to `src/provider/state/` (same layering: provider-level, usable from the host tree, no overlay imports — the host renders variants even when the overlay is hidden). Files:

### 4.1 `registry.ts`

A per-provider registry, created once in `NoddProvider` (same Strict-Mode-safe ref pattern as the store, `NoddProvider.tsx:33-63`), exposed through `NoddContext`.

```ts
export type VariantScope = 'global' | 'page';

export type VariantDefinition = {
  key: string;
  options: string[];        // first registration wins; warn on mismatch in dev
  label?: string;
  declaredScope?: VariantScope;
  paths: Set<string>;       // every urlPath this key was mounted on this session
  mountCount: number;       // ref count of currently mounted hooks
};

export type VariantRegistry = {
  register(def: {...}, urlPath: string): () => void;  // returns unregister
  getDefinitions(): VariantDefinition[];
  getValue(key: string): string;                       // selection ?? options[0]
  setSelection(key: string, option: string): void;     // validates, persists, notifies
  resolveScope(key: string): VariantScope;             // declaredScope ?? (paths.size > 1 ? 'global' : 'page')
  subscribe(cb: () => void): () => void;
  hydrate(): void;                                     // load localStorage (call from an effect)
  dispose(): void;
};

export function createVariantRegistry(opts: { projectId: string }): VariantRegistry;
```

Behavior:

- **Definitions persist for the whole session** even after the registering component unmounts (`mountCount` drops to 0) — mirrors the module-level rationale in `activator.ts:1-3`. The panel's "This page" section shows only definitions with `mountCount > 0`; "Global" shows global-scoped ones regardless.
- **Selection persistence:** `localStorage` key `nodd:variants:${projectId}`, value `{ [key]: option }`. All reads/writes wrapped in `try/catch` (private-mode Safari) and guarded by `isBrowser()` from `src/provider/ssr.ts`. A stored option no longer present in `options` (author renamed it) is ignored → default.
- **SSR + hydration safety:** the registry starts with *no* selections; `hydrate()` is called from a `useEffect` in `NoddProvider`. So server render and first client render both show `options[0]`, then stored selections apply in an effect — no hydration mismatch, standard pattern.
- **Activators:** on first registration of a key, `registerActivator(`${key}:${option}`, () => setSelection(key, option))` for every option (import from `../state/activator`). Keep them for the session; `dispose()` unregisters all. This is what makes "Show me" flip variants. Note `registerActivator`'s cleanup is identity-checked (`activator.ts:17-22`), so Strict Mode double-registration is safe as long as the registry keeps one stable fn per name.
- **Name sanitation:** variant keys and options must not contain `/` (breaks `stackToKey`) or `:` (our separator). Sanitize with `.replace(/[/:]/g, '-')` — same spirit as `NoddState.tsx:9-11`. Duplicate key with different options: first registration wins, `console.warn` in dev.

### 4.2 `useVariant.ts`

```ts
export function useVariant(key: string, options: string[], opts?: UseVariantOptions): string;
```

- Reads the registry from `NoddContext` via `useContext` directly (like `useNodd`, `NoddContext.ts:29` — must not throw without a provider; fall back to `options[0]`).
- Registers on mount (with `ctx.urlPath`), unregisters on unmount. Re-register when `urlPath` changes so `paths` accumulates.
- Subscribes with `useSyncExternalStore` (registry `subscribe` + `getValue(key)` snapshot; server snapshot = `options[0]`). This is the cleanest React-18-safe reactivity and avoids tearing.

### 4.3 `Variant.tsx`

```tsx
export function Variant({ name, options, label, scope }: VariantProps) {
  const keys = Object.keys(options);
  const active = useVariant(name, keys, { label, scope });
  return <NoddState name={`${name}:${active}`}>{options[active] ?? options[keys[0]]}</NoddState>;
}
```

`display: contents` on the `NoddState` wrapper means zero layout impact on the host — already the established pattern.

### 4.4 `index.ts` + `README.md`

Barrel export; README follows the per-module README convention (see `src/store/README.md`) covering: API, the `state_key` reuse story, the hook-only limitation, sanitation rules.

## 5. Wiring changes (existing files)

| File | Change |
|---|---|
| `src/provider/NoddProvider.tsx` | Create registry in a ref beside auth/store (lazy, once); call `registry.hydrate()` in a `useEffect`; `dispose()` on unmount; add `variants: registry` to `ctxValue`. |
| `src/provider/NoddContext.ts` | Add `variants: VariantRegistry` to `NoddContextValue`. Do **not** add variant fields to the public `useNodd()` return — keep that surface as-is. |
| `src/provider/index.ts` | Re-export `useVariant`, `Variant` and types. |
| `src/index.ts` | Public exports: `useVariant`, `Variant`, `VariantProps`, `UseVariantOptions`, `VariantScope`. |
| `src/overlay/OverlayRenderer.tsx` | Toolbar button + `V` shortcut + panel open state + render `<VariantsPanel>` (§6). |
| `src/overlay/styles/overlay.css` | Styles for the panel internals (§6). Scoped under `[data-nodd-root]` only. |

## 6. Overlay UI

### 6.1 Toolbar button

In the toolbar block (`OverlayRenderer.tsx:383-393`), add a second button before the menu button:

- Icon from `@carbon/icons-react` (already a dep; the toolbar uses `Menu`). Use `Layers` if available in the installed version, otherwise pick a close equivalent (`Choices`, `Compare`) — verify against `node_modules/@carbon/icons-react`.
- `aria-label="Variants"`, class `nodd-btn nodd-btn--variants`, reuse existing `nodd-btn` styles unchanged.
- **Only render the button when `registry.getDefinitions().length > 0`** — prototypes without variants must see zero UI change. Subscribe to the registry (same pattern as `subscribeActivators` → `activatorVersion`, `OverlayRenderer.tsx:90-92`) so the button appears when the first variant mounts.

### 6.2 Panel open/close behavior

- New state `variantsOpen` in `OverlayRenderer`, sibling of `sidebarOpen`.
- Keyboard: extend the existing handler (`OverlayRenderer.tsx:142-167`) — `v` toggles the panel (same guards: signed-in, no modifiers, not typing). Mirror the `m` behavior.
- **Mutual exclusion:** opening the variants panel closes the comments sidebar and vice versa; entering comment mode (`C`) closes both. They occupy the same right-side region.
- Body push: the comments sidebar pushes host layout via `body.style.marginRight` (`OverlayRenderer.tsx:53-61`). Generalize that effect to fire when *either* panel is open (`sidebarOpen || variantsOpen`) rather than duplicating it.
- Esc closes the panel (Radix Dialog gives this for free if the same `Dialog.Root modal={false}` shell is used — do that).

### 6.3 `src/overlay/components/VariantsPanel.tsx` (new)

Clone the structural skeleton of `Sidebar.tsx` (Radix `Dialog.Root modal={false}` + `Dialog.Portal container` + `ScrollArea`), reusing the **same CSS classes** where the look is identical: `nodd-sidebar` (shell), `nodd-sidebar-header`, `nodd-sidebar-title` ("Variants"), close button. Content area:

- Two labeled sections: **Global** then **This page** (each rendered only if non-empty). Section header style: reuse the sidebar's existing muted-label styling; add `.nodd-variants-section-title` if none fits.
- One card per variant (`.nodd-variant-card`): label (fall back to the key) + a segmented control of its options. Build the segmented control from the existing pill-tab styling (`.nodd-sidebar-tab`, `overlay.css:~970`) — either reuse the class or extract the shared rules into a `.nodd-pill` group; do not invent a new visual language.
- Clicking an option → `registry.setSelection(key, option)`. The active option gets the same "active tab" treatment as the sidebar tabs.
- Section placement logic: `resolveScope(key) === 'global'` → Global; else This page (only when `mountCount > 0`). A page-scoped definition from another page with `mountCount === 0` is not shown.
- Empty state (panel opened via `V` with no variants — possible if the button is hidden but shortcut used; or all unmounted): reuse the sidebar's empty-state styling, text like *"No variants here. Declare them in code with `<Variant>` or `useVariant()`."*
- Props: `{ open, onClose, container, registry, urlPath }` — follow `SidebarProps` conventions (`Sidebar.tsx:44`).

### 6.4 What needs **no** work (verify, don't build)

- Pin hide/show on switch: MutationObserver → `domVersion` → `resolveAllPins` (`OverlayRenderer.tsx:117-139`). Verify the observer fires on variant DOM swaps (it observes host DOM for reanchoring — confirm scope covers the swapped subtree).
- Sidebar "Other states · N" pill listing comments from the non-active option, with `hero:bold` breadcrumb (`OverlayRenderer.tsx:265-289`).
- "Show me" activation flipping the variant: `hasActivatorOrTrigger('hero:bold')` is true because the registry registered the activator; `activateState(['hero:bold'])` calls it and `waitForState` sees the mounted `data-nodd-state` (`activator.ts:84-109`).

## 7. Invariants checklist (from CLAUDE.md — must hold after this change)

- **Zero host impact when overlay is off**: `useVariant`/`Variant` run in the host tree by design (the prototype must render the chosen option even with the overlay hidden) — but they must not import anything from `src/overlay/` and add no DOM beyond the existing `display: contents` wrapper. No new CSS outside `[data-nodd-root]`.
- **Strict-Mode-safe singletons**: registry in a ref, created lazily once, disposed on unmount — copy the store's pattern exactly.
- **SSR-safe**: all `localStorage`/`document` access behind `isBrowser()` or inside effects; `useSyncExternalStore` server snapshot returns the default option.
- **Don't move re-anchoring out of the AnimationFrame batch** — we add nothing to that loop; variant switches ride the existing mutation path.
- **External peers / bundle**: no new dependencies. `@carbon/icons-react` and Radix primitives are already there.
- **Frozen migrations**: untouched — this feature adds no SQL.

## 8. Edge cases

- Same `key` mounted twice with different option lists → first wins, dev warning.
- Stored selection references a removed option → ignore, use default.
- Variant switch while a thread popover is open on a pin inside the disappearing option → the anchor element is removed; existing anchoring handles orphaning, but verify the popover closes or repositions gracefully rather than floating.
- `localStorage` unavailable (private mode) → selections work in-memory for the session, silently not persisted.
- Signed-out viewers: variants still render defaults; the panel is part of the toolbar, which requires sign-in (comment mode gates on `user`) — acceptable for v1.
- Nested `<Variant>` inside another `<Variant>` or `<NoddState>`: works naturally — state stacks nest; `isStateMatch` prefix logic already handles it.

## 9. Implementation order (each step compiles + typechecks)

1. **Core** — `src/provider/variants/` (registry, hook, component, barrel), NoddProvider/NoddContext wiring, public exports. Verify: `npm run typecheck`; a scratch story in `src/stories/` with a two-option `<Variant>` renders and `useVariant` flips via a manual `registry.setSelection` call.
2. **Panel UI** — toolbar button, `V` shortcut, `VariantsPanel`, styles, mutual exclusion, body push. Verify in Storybook (`npm run storybook`): switch flips the prototype live, persists across reload, button hidden when no variants.
3. **Comments integration verification** (no new code expected) — place a comment inside `hero:bold`; switch to `minimal`; confirm the pin hides, the sidebar shows it under "Other states" with the `hero:bold` breadcrumb, and "Show me" flips the variant back and reveals the pin. Fix gaps only if this flow breaks.
4. **Docs** — `src/provider/variants/README.md`; add a Variants row to the module table + a short section in the repo `CLAUDE.md` and `DESIGN_DOC.md`; add a story demonstrating global + page variants.

## 10. Out of scope (v1)

- Syncing/broadcasting the selection to other viewers (would need a migration + realtime; the registry API was shaped so a synced backend can be added behind `setSelection` later).
- A "share this combination" deep link (URL-encoded selections) — natural follow-up.
- Variants defined at runtime from the Nodd UI (definitions must come from code — code is what renders them).
- Screenshot/diff comparison between variants.
