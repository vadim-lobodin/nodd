# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Nodd** (`nodd`) — a drop-in React library that overlays Figma-like spatial comments on live React prototypes. Distributed as an npm package; backend is the consumer's own Supabase project (no Nodd-hosted server). See `DESIGN_DOC.md` and `GOAL&REQUIREMENTS.md` for full spec.

## Commands

```bash
npm run build       # tsup: ESM + CJS + .d.ts into dist/, copies overlay.css → dist/style.css
npm run dev         # tsup --watch
npm run typecheck   # tsc --noEmit
npm test            # vitest run (jsdom) — src/**/*.test.ts(x)
npm run test:watch  # vitest
```

`engines.node` is the *consumer* contract (`>=18`). Development and release need **Node 20+**, which is what `vite` already requires; keep dev dependencies within that floor — `jsdom` is pinned to `^26` for this reason, since `jsdom@30` demands Node 22+ and `npm test` now runs in `prepublishOnly`. Note jsdom ships no `CSS` object, so never call `CSS.escape` unguarded (see `anchoring/selectorBuilder.ts` — older WebViews lack it too).

Tests live beside the code they cover (`src/provider/state/__tests__/`). `overlay-compat.test.tsx` renders real overlay libraries (Radix, Headless UI) and prints a matrix of what Nodd detects — see `src/provider/state/README.md` §8 before adding a library.

**CLI** (`bin/nodd.mjs`, exposed via `package.json#bin` as `nodd`): consumer-facing onboarding tool. `init` creates a Supabase project via the Management API, applies the migrations, configures auth redirects, writes `.env.local` + `.nodd/config.json`, and prints an `<NoddProvider>` snippet. `add-origin <url>` patches the redirect allowlist after deploy. Reads `SUPABASE_ACCESS_TOKEN` from env (never persisted). ESM, no extra deps — uses built-in `fetch`, `readline`, `crypto`. Don't add npm deps here without a strong reason; the CLI runs via `npx` and bloating it slows cold starts.

Database (against the local or linked Supabase project):
```bash
supabase start          # local stack on ports 54321 (api), 54322 (db), 54323 (studio), 54324 (inbucket)
supabase db push        # apply migrations in supabase/migrations/ (forward-only, never edit existing files)
supabase db reset       # nuke + replay migrations + seed.sql
```

## Architecture

Five modules, one-way dependency graph: `provider → {auth, store, overlay} → supabase-js`. The public surface is intentionally tiny — one component + one hook from `src/index.ts`:

```ts
<NoddProvider projectId supabaseUrl supabaseAnonKey theme? gateToPrototypes? onNavigate?> ...
const { user, signIn, signOut, toggleOverlay, isVisible, ... } = useNodd();

// Optional, per screen: let a comment be reopened in the view state it was left in.
useNoddViewState('page', page, setPage);
```

`onNavigate?: (path: string) => void` lets the host route in-app (e.g. `router.push`) instead of a full reload — used by the sidebar inbox to jump between screens of a prototype. When omitted, cross-screen jumps fall back to `window.location.assign`. `gateToPrototypes` restricts where comments can be created (see `src/provider/variants/` and the consumer's `<NoddPrototype>` scope).

| Module | Role |
|---|---|
| `src/provider/` | `NoddProvider` boots singletons, owns runtime state (user, urlPath, visibility, theme), creates two body-attached portals, exposes `NoddContext`. Contains `state/` (`<NoddState>` + activator registry), `variants/` (`useVariant`/`<Variant>` + per-viewer variant registry) and `viewState/` (`useNoddViewState` — host view-state snapshot/restore). |
| `src/auth/` | `AuthClient` wraps Supabase magic-link sign-in + session restore. |
| `src/store/` | `CommentStore` — page-scoped fetch, IndexedDB cache, optimistic CRUD with temp IDs, Realtime subscription. Files are split by concern (`query`, `mutations`, `realtime`, `cache`, `state`, `members`). |
| `src/overlay/` | React UI rendered via portal: `OverlayRenderer`, `Sidebar`, `VariantsPanel`, `ThreadPopover`, `PinMarker`, `CaptureLayer`, `MentionPicker`, plus `anchoring/` (selector + fingerprint + resolver + ResizeObserver re-anchor loop). |
| `supabase/` | SQL migrations, RLS policies, indexes. Bundled in the npm package via `package.json` `files` so consumers can apply them after `npm i`. |

Each module has its own `README.md` with detailed design notes; consult them before deeper changes.

### Hard invariants — do not break

- **Zero host impact when overlay is off.** When `isVisible` is false the entire portal is unmounted (`NoddProvider.tsx:159`). All overlay CSS is scoped under `[data-nodd-root]` / `[data-nodd-pin-container]`; never add unscoped global selectors to `src/overlay/styles/overlay.css`.
- **Two portals, not one.** `nodd-pins` is `position: absolute` so pins scroll with the document; `nodd-root` is `position: fixed` for toolbar/sidebar/popover/capture. Both are appended directly to `document.body` and carry a `data-nodd-theme` attribute.
- **Strict Mode-safe singletons.** `supabase`, `AuthClient`, and `CommentStore` are stored in refs and lazily constructed once (see `NoddProvider.tsx:33-63`). The store is created in `useEffect` (not during render) to avoid double Realtime subscriptions; it is `dispose()`-ed on unmount.
- **SSR-safe.** Anything touching `window`/`document` must go through `isBrowser()` (`src/provider/ssr.ts`) or live inside `useEffect`.
- **External peers.** `react`, `react-dom`, `react/jsx-runtime`, `@supabase/supabase-js`, `@radix-ui/*`, and `boring-avatars` are marked external in `tsup.config.ts`. When adding a runtime dep, decide whether to bundle it or externalize it and update both `tsup.config.ts` and `package.json` peer/deps accordingly. `sideEffects: ["**/*.css"]` is required for consumer tree-shaking.

### Sync model (store ↔ Supabase)

- Page-scoped query: `threads where project_id = $1 and url_path = $2 and resolved = false`, served by the partial index `threads_project_path_idx`. The 200 ms budget assumes this index exists — don't drop it.
- IndexedDB cache (`src/store/cache.ts`, via `idb-keyval`) keyed by `(projectId, urlPath)` is read first on subscribe, then reconciled with the network response.
- Optimistic mutations create `temp-<uuid>` IDs and reconcile via `replaceThreadId` / `replaceCommentId` once the server responds. A `recentlyWritten` set (5 s TTL) suppresses Realtime echoes of our own writes — see `createCommentStore.ts:152-155`. If you add new mutations, they must round-trip through `markRecentlyWritten` for both the row id and any child comment id, otherwise the UI will flash duplicates.
- Realtime channel filters server-side by `project_id`; per-page `url_path` filtering is local. Add tables to `supabase_realtime` publication in a new migration if you create more.
- **Prototype inbox (Phase 2).** A thread carries a nullable `threads.prototype_id` (a roll-up key *layered on top of* `url_path`, not a replacement — see `0006_prototype_scope.sql`). The sidebar's "This prototype" view calls `fetchPrototypeThreads` (`store/query.ts`), a bounded `project_id + prototype_id + resolved = false` query served by the partial index `threads_project_prototype_idx` — don't drop it. Threads with `prototype_id = null` (pre-scoping, or created outside a `gateToPrototypes` scope) are page-only and never appear in the inbox. The write path stamps `prototype_id` via the `nodd_create_thread` RPC's optional `_prototype_id` arg (only sent when non-null, so unscoped writes still match the pre-0006 8-arg signature). Cross-screen open uses a `#nodd-thread=<id>` fragment + `onNavigate`.
- **Resolved visibility.** The live page query filters `resolved = false`, so resolved threads leave the snapshot on resolve. They are *hidden by default*, shown only when the viewer flips "Show resolved comments" in the panel settings menu — no sidebar tabs. When on, `OverlayRenderer` fetches them (`fetchResolved`, bounded) and merges into a single `allThreads` used by every derived view (pins, sidebar, popover); resolved pins render at 60% opacity, list/popover dim the text to 80% and show "Resolved" for the timestamp. Reopening can't be folded back by the store (the thread was already dropped), so it forces a fresh subscribe via a `refreshKey` bump.

### DOM anchoring (`src/overlay/anchoring/`)

Pins are stored as `{ selector, offsetX, offsetY, fingerprint, viewportWidth }` JSON in `threads.pin`. Resolution is three-tier: exact selector → fingerprint match among candidates → "orphaned" (sidebar only, not rendered on page). Position re-renders on resize via a single `ResizeObserver`; selector resolution only re-runs on route change. Don't move re-anchoring out of the AnimationFrame batch — it's hot.

**Host view state (`src/provider/viewState/`, see its README).** The one thing the DOM cannot record: a comment on row 3 of *page 4*, or on a screen in the "problems" demo scenario, has an anchor that doesn't exist rather than one that's hidden — nothing in the document says a `setPage` exists. Hosts opt in one line at a time, at the site of the state (`useNoddViewState('page', page, setPage)`); the value is snapshotted onto `pin.viewState` and replayed by `revealThread` **before** `activateState`, because a dialog opened from a row on page 4 needs page 4 to exist first. Nodd never interprets the blob — that's what lets a URL-based, Redux and `useState` app all satisfy one contract. Deliberately not a provider-level capture/restore pair: a `useState` in a leaf component isn't reachable from `<NoddProvider>`, so that shape would mean lifting state app-wide. Only plain JSON is recorded (a `Map`/`Date` survives `JSON.stringify` but comes back as something else); missing keys and throwing restores degrade per key and never break reveal.

**Degraded anchoring (`anchoring/approximate.ts`).** An anchor usually goes missing not because it was deleted but because the host is showing a different slice of the same UI — page 4 of a list, another filter, another demo scenario. That view state lives in the host's own React state and a library cannot mandate where consumers keep it, so Nodd can't restore it. What it can do is not dead-end. The pin additionally records `ancestors` (a `buildSelector` chain, nearest-first, ending at `body`) and a short `label` (only when the element has a name of its own — a container that just holds named things is left unlabelled, so reveal says "the element this was left on" rather than quoting a row's columns); when reveal finds no anchor, `resolveApproximateAnchor` returns the nearest ancestor that matches **exactly one** rendered element and the thread opens *there*, dashed (`.nodd-pin--approximate`) and labelled, so the conversation is at least readable. Ambiguous levels are skipped, never guessed. The chain is capped at 8 and records the *nearest* levels — the ones most likely to die with the anchor — so capture appends `body` as a floor; `isPageLevelContainer` is why reveal then says "at the top of the page" rather than "nearby", since a pin in the page's corner is worth opening but not worth describing as near anything. The notice is shown to read-only viewers too (a dashed pin doesn't explain itself; only `noticeAction` is a permission). `resolveAllPins` also **upgrades** a degraded pin back to exact when the anchor returns, and a degraded pin never survives the reveal that asked for it. This is deliberately **reveal-only** — `resolvePin` stays strict, because a page of pins silently sliding up to their containers is worse than pins that don't render. Both fields are optional; pre-existing pins simply get the old toast. `overlay/__tests__/reveal.test.tsx` covers the whole sequence end to end.

### Interactive states (`src/provider/state/`, see its README)

**Detection has four tiers, tried in that order:** explicit `<NoddState>` / bare `data-nodd-state` attribute → ARIA role (`autoState.ts`) → structural (`floatingState.ts`: a non-app-root child of `<body>`, or a positioned panel preceded by a full-viewport fixed scrim) → disclosure (`controlledState.ts`: content that a single `[aria-expanded="true"][aria-controls]` control names, keyed `ctl:<control-name-slug>`). The last two run **only when the earlier ones found nothing**, which is what makes them non-breaking — a thread that already resolved to a stack still does, and an empty key matches everything anyway. Never widen either to run alongside the others, and never move `controlledState` ahead of `floatingState`: `float:` shipped first, so on a portalled popover (where both fire) the older key must keep winning or existing threads stop matching. The structural verdict is shown in the composer with a one-click opt-out, because it reads layout rather than semantics; the disclosure tier reads a host-authored ARIA relationship, so it isn't second-guessed. `ctl:` is the tier that catches Radix/Headless UI **Popover** (no role) and accordions whose collapsed content is unmounted; because the segment is named after its own opener, reopening it is a lookup rather than a hunt.

**A hidden anchor is not an orphan (`state/disclose.ts`).** An element inside a closed tab panel, a collapsed accordion or a `<details>` still matches its selector and fingerprint, so resolution "succeeded" and then a zero rect put the pin in the page's top-left corner. `isRendered` now gates resolution, and reveal calls `discloseAncestors` to open what's hiding the anchor (`<summary>`, the `aria-controls` link, a tabpanel's `aria-labelledby` tab). `isRendered` reads **declared** hiding only — `hidden`, `aria-hidden`, `display`, `visibility`, closed `<details>` — never layout: a zero-size rect is also what an element reports pre-paint, inside `display: contents`, and mid-animation, so measuring would suppress good pins. `DiscloseResult.changed` must be honoured alongside `revealed`: React's usual way to open a panel is to replace the closed subtree, which succeeds while destroying the element being tracked, so a caller that only checks `revealed` degrades every controlled tab and accordion whose exact anchor is right there in the new DOM. Whenever `changed` is set, re-resolve the pin.

A thread carries a `stateKey` — the `/`-joined stack of interactive-state segments its anchor lives under — so a comment left inside a modal/menu is scoped to that state instead of bleeding onto the base screen. `isStateMatch` (empty key matches all; deeper submatch allowed) decides whether a pin renders on the current DOM. Two sources feed the stack (`getStateStackForElement`): explicit `<NoddState name>` wrappers (with `useNoddActivator` / `[data-nodd-open-state]` to reopen), and **auto-detection** of standard ARIA overlays (`autoState.ts`: `role=dialog|alertdialog|menu|listbox` + `data-state="open"`, keyed on a stable accessible name → `auto:<role>:<name>`). Auto-detection needs no host instrumentation but only catches ARIA-correct overlays — Radix `Popover.Content` emits no `role` and is *not* caught; a custom overlay must be wrapped in `<NoddState>`.

**Comment mode must swallow the whole press, not just the click.** `CaptureLayer` binds `pointerdown/mousedown/pointerup/mouseup/contextmenu/dblclick` on `window` in the **capture phase** and `stopImmediatePropagation()`s anything that isn't Nodd chrome. This is load-bearing: modal overlays dismiss on an outside *pointerdown* (Radix does `document.addEventListener('pointerdown', …)`), and the capture layer covers the viewport — so intercepting only `click` meant every attempt to comment inside a dialog closed that dialog and destroyed the anchor. `window` + capture is required because the overlay always mounts before comment mode starts, so we cannot win on registration order at `document`. Covered by `overlay/__tests__/capture.test.tsx`, which drives a real Radix dialog (note Radix registers that listener in a `setTimeout(0)`, so the test must let a macrotask run or it silently passes).

**Nodd's surfaces are exempt from the host's focus model.** `OverlayRenderer` shields `focusin`/`focusout` on `window` (capture phase) whenever the event's `target` *or* `relatedTarget` is inside a Nodd container. Focus traps — Radix's `FocusScope` — listen for these on `document` and drag focus back into themselves the moment it lands elsewhere, which made every Nodd input rendered over an open menu take focus for one frame and lose it. `focusout` must be matched on `relatedTarget`: its `target` is the host element losing focus, and the destination is what makes the event ours. Note the two press/focus shields are separate concerns — the press shield only exists during comment mode, this one for as long as the overlay is mounted.

**Pressing a trigger is not `.click()`.** Radix menu/select/popover triggers toggle on `pointerdown` and ignore `click` entirely, so `el.click()` on one is a silent no-op (dialogs *do* use click, which is why this hid for so long). Always go through `pressTrigger` (`state/reopen.ts`), which dispatches the full pointerdown → mousedown → pointerup → mouseup → click sequence. Covered by `__tests__/trigger-click.test.tsx`, which reopens real Radix components — asserting that we *find* the right trigger is not enough.

**Recorded triggers.** Because the reveal-time hunt for "the one closed ARIA trigger of this role" is unanswerable on real prototypes (twenty identical row menus; a controlled dialog with no trigger in the DOM), the opening control is captured *while the state is open* — `findOpeningTrigger` (`state/reopen.ts`, tiers: `aria-controls` → expanded `aria-haspopup` → a lone `data-state="open"` control, listbox/menu only) — and stored as an `ElementRef` in the optional `pin.stateTriggers[segment]` (`overlay/stateTriggers.ts`). `activateState` prefers it over the hunt. An `ElementRef` records **identity as well as position** (`context`: nearest-ancestor fingerprints; `tag`) — selector + own-fingerprint is *not* enough for identical row buttons, where `:nth-of-type` silently points at a different row after a sort or filter. `resolveRef` gates on the nearest ancestor matching, re-searches document-wide when the selector has drifted, and declines on any remaining ambiguity — pressing the wrong control is worse than not reopening. Explicit `<NoddState>` segments are never recorded — their activator is authoritative. When no reopen path exists for a segment, the composer warns the *author* at capture time instead of failing silently for the next reader.

Opening a thread from anywhere (pin, sidebar, prototype inbox, deep link) goes through the single `OverlayRenderer.revealThread` path: it routes cross-screen if needed, `activateState`s the captured stack (fail-closed, 2 s per segment; returns the `failedSegment`), re-anchors, opens, and scrolls in. On failure it degrades rather than dead-ends — it distinguishes "the state wouldn't reopen" (name it from the breadcrumb, and scroll to + ring its recorded opening control if present) from "the anchor is gone", because those need different things from the viewer. Never split this back into per-entry-point handlers.

### Auth

Magic link via `supabase.auth.signInWithOtp({ email })` with `emailRedirectTo: window.location.href`. Session is restored on mount; unauthenticated users see read-only pins (or nothing). The `profiles` view exposes `id, display_name, avatar_url` from `auth.users` — client code must use this view, not `auth.users` directly. It is scoped to the caller's project co-members by an `auth.uid()` predicate in the view body; since the view is owner-run (it can't be `security_invoker`), that predicate is the *only* access control — don't widen it. `email` was deliberately dropped in `0007_profiles_drop_email.sql`; `display_name` already falls back to the address' local part server-side, so don't add it back — selecting it answers `400 column profiles.email does not exist`, and the caller's own address is on the session anyway. The same migration revoked anon's inherited grant on the view, so **any query touching `profiles` (directly or as a PostgREST embed) must be gated on a session** — as `anon` it answers `401 permission denied for view profiles`. That's why the member prefetch is driven by `onAuthStateChange` instead of firing at store construction (`store/createCommentStore.ts`).

### RLS contract (every new query must respect this)

- All Nodd-owned tables have RLS enabled; `is_project_member(project_id)` (SECURITY DEFINER, defined in the baseline `0001_nodd_init.sql`) gates every member read. Reuse it — don't reimplement membership checks per policy. The one relaxation: `0004_public_reads.sql` adds permissive anon/authenticated SELECT policies on `threads`/`comments` gated by `is_public_project(project_id)` (the `projects.allow_public_reads` flag). This is **read-only** — writes still require membership. Logged-out author names come from the email-free `nodd_public_members` RPC, never the `profiles` view (which is not granted to anon).
- `threads.created_by` and `comments.author_id` must equal `auth.uid()` on insert. Comment edits are author-only.
- `0001_nodd_init.sql` is the v1 baseline — applied as one file by fresh consumers. Treat it as frozen post-release; any schema change ships as a new numbered file (`0002_*.sql`, `0003_*.sql`, …). Forward-only: never rewrite an existing migration.

### Build output

`dist/` contains `index.js` (CJS), `index.mjs` (ESM), `index.d.ts`, sourcemaps, and `style.css` (copied from `src/overlay/styles/overlay.css` by the tsup `onSuccess` hook). Consumers import `nodd` and `nodd/style.css`.
