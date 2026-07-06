# Variants — Module Design

> Lets a prototype author declare alternative versions of a screen or component in code, and lets reviewers switch between them from the Nodd overlay. Comments are variant-aware for free by riding the existing `state_key` machinery — **no database migration, no store changes**.

Related: [Architecture](../../../DESIGN_DOC.md) · sibling of [`../state/`](../state/), which this module builds on.

## 1. Purpose

Prototypes often contain several versions of the same thing (two hero designs, single-page vs wizard checkout). Variants gives authors two ways to express that:

```tsx
// Hook — feature-flag style. Returns the active option (default: first).
// Safe without <NoddProvider>: returns options[0], never throws.
const layout = useVariant('checkout-layout', ['single-page', 'wizard'], {
  label: 'Checkout layout',
  scope: 'global',
});

// Component — swap whole blocks. Options derived from object keys.
<Variant
  name="hero"
  label="Hero style"
  options={{ minimal: <HeroMinimal />, bold: <HeroBold /> }}
/>
```

Reviewers flip variants from the **Variants panel** (toolbar button, or press `V`). Switching is **per-viewer** — persisted to `localStorage`, never synced between viewers.

## 2. Files

| File | Role |
|---|---|
| `registry.ts` | `createVariantRegistry` — per-provider store of variant *definitions* + the viewer's *selections*. Persists selections to `localStorage`, exposes `subscribe`/`getValue`/`setSelection`, and registers a "Show me" activator per option. |
| `useVariant.ts` | Hook. Reads the registry from `NoddContext` (never throws without a provider), registers on mount, subscribes via `useSyncExternalStore`. |
| `Variant.tsx` | Component. Sugar over `useVariant` **plus** a `<NoddState name={`${name}:${active}`}>` wrapper — that one line is what makes comments variant-aware. |
| `index.ts` | Barrel. |

## 3. Why comments are variant-aware for free

Nodd already ships state-aware comments (`../state/`). By expressing the active variant as a state segment `"{name}:{option}"`:

| Requirement | How it's satisfied |
|---|---|
| Comment records the active variant | Existing capture walks `data-nodd-state` ancestry → `threads.state_key` gets e.g. `hero:bold` |
| Pin hidden when the other option is shown | Existing `isStateMatch`: current stack `['hero:minimal']`, thread key `hero:bold` → mismatch |
| Mismatched comments still reachable | Existing Sidebar "Other states" grouping with the `hero:bold` breadcrumb |
| Clicking such a comment switches the variant | The registry registers an activator named `hero:bold` → `setSelection('hero','bold')`; existing `activateState` calls it |
| Pins re-resolve after a switch | Existing reanchor-loop `MutationObserver` |
| Persistence of the tag | Existing `state_key` column — no migration |

**Limitation:** hook-only variants have no DOM wrapper, so comments placed in hook-controlled regions are **not** tagged with the active option. Prefer `<Variant>` when you want variant-aware comments; use `useVariant` for flags/styling where "which variant is this comment about" is inherently fuzzy.

## 4. Rules & edge cases

- **First registration wins.** The same `key` re-declared with different options keeps the first list and `console.warn`s in dev.
- **Sanitation.** Keys and options must not contain `/` (breaks `stackToKey`) or `:` (our separator); both are replaced with `-` via `sanitizeVariantSegment`. Feature-flag comparisons still work for normal names (sanitize is identity for them).
- **Scope.** `declaredScope` wins; otherwise a key mounted on 2+ paths is `global`, else `page`. The panel's "This page" section shows only definitions with `mountCount > 0`; "Global" shows global-scoped ones regardless.
- **Persistence.** `localStorage` key `nodd:variants:${projectId}`. All access is wrapped in `try/catch` (private-mode Safari) and guarded by `isBrowser()`. A stored option no longer present in `options` is ignored → default.
- **SSR / hydration.** The registry starts with no selections; `hydrate()` runs from a `useEffect` in `NoddProvider`. Server render and first client render both show `options[0]`, then stored selections apply — no hydration mismatch (`useSyncExternalStore` server snapshot returns the default).
- **Strict-Mode-safe.** The registry is created once beside the store in `NoddProvider`, disposed on unmount. Activators use identity-checked cleanup, so double-registration is safe.

## 5. Out of scope (v1)

Syncing/broadcasting a selection to other viewers, share-a-combination deep links, runtime-defined variants, and screenshot diffing. The `setSelection` API was shaped so a synced backend can be added behind it later.
