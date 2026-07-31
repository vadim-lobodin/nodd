# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Nodd** (`nodd`) — a drop-in React library that overlays Figma-like spatial comments on live React prototypes. Distributed as an npm package; backend is the consumer's own Supabase project (no Nodd-hosted server). See `DESIGN_DOC.md` and `GOAL&REQUIREMENTS.md` for full spec.

## Commands

```bash
npm run build       # tsup: ESM + CJS + .d.ts into dist/, copies overlay.css → dist/style.css
npm run dev         # tsup --watch
npm run typecheck   # tsc --noEmit (no test runner configured)
```

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
```

`onNavigate?: (path: string) => void` lets the host route in-app (e.g. `router.push`) instead of a full reload — used by the sidebar inbox to jump between screens of a prototype. When omitted, cross-screen jumps fall back to `window.location.assign`. `gateToPrototypes` restricts where comments can be created (see `src/provider/variants/` and the consumer's `<NoddPrototype>` scope).

| Module | Role |
|---|---|
| `src/provider/` | `NoddProvider` boots singletons, owns runtime state (user, urlPath, visibility, theme), creates two body-attached portals, exposes `NoddContext`. Contains `state/` (`<NoddState>` + activator registry) and `variants/` (`useVariant`/`<Variant>` + per-viewer variant registry). |
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

### Interactive states (`src/provider/state/`, see its README)

A thread carries a `stateKey` — the `/`-joined stack of interactive-state segments its anchor lives under — so a comment left inside a modal/menu is scoped to that state instead of bleeding onto the base screen. `isStateMatch` (empty key matches all; deeper submatch allowed) decides whether a pin renders on the current DOM. Two sources feed the stack (`getStateStackForElement`): explicit `<NoddState name>` wrappers (with `useNoddActivator` / `[data-nodd-open-state]` to reopen), and **auto-detection** of standard ARIA overlays (`autoState.ts`: `role=dialog|alertdialog|menu|listbox` + `data-state="open"`, keyed on a stable accessible name → `auto:<role>:<name>`). Auto-detection needs no host instrumentation but only catches ARIA-correct overlays — Radix `Popover.Content` emits no `role` and is *not* caught; a custom overlay must be wrapped in `<NoddState>`.

Opening a thread from anywhere (pin, sidebar, prototype inbox, deep link) goes through the single `OverlayRenderer.revealThread` path: it routes cross-screen if needed, `activateState`s the captured stack (fail-closed — clicks the unambiguous ARIA trigger for auto-states, or the registered activator; 2 s budget), re-anchors, opens, and scrolls in — or shows a dismissible hint if the state can't be reopened. Never split this back into per-entry-point handlers.

### Auth

Magic link via `supabase.auth.signInWithOtp({ email })` with `emailRedirectTo: window.location.href`. Session is restored on mount; unauthenticated users see read-only pins (or nothing). The `profiles` view exposes `id, display_name, avatar_url` from `auth.users` — client code must use this view, not `auth.users` directly. It is scoped to the caller's project co-members by an `auth.uid()` predicate in the view body; since the view is owner-run (it can't be `security_invoker`), that predicate is the *only* access control — don't widen it. `email` was deliberately dropped in `0007_profiles_drop_email.sql`; `display_name` already falls back to the address' local part server-side, so don't add it back — selecting it answers `400 column profiles.email does not exist`, and the caller's own address is on the session anyway. The same migration revoked anon's inherited grant on the view, so **any query touching `profiles` (directly or as a PostgREST embed) must be gated on a session** — as `anon` it answers `401 permission denied for view profiles`. That's why the member prefetch is driven by `onAuthStateChange` instead of firing at store construction (`store/createCommentStore.ts`).

### RLS contract (every new query must respect this)

- All Nodd-owned tables have RLS enabled; `is_project_member(project_id)` (SECURITY DEFINER, defined in the baseline `0001_nodd_init.sql`) gates every member read. Reuse it — don't reimplement membership checks per policy. The one relaxation: `0004_public_reads.sql` adds permissive anon/authenticated SELECT policies on `threads`/`comments` gated by `is_public_project(project_id)` (the `projects.allow_public_reads` flag). This is **read-only** — writes still require membership. Logged-out author names come from the email-free `nodd_public_members` RPC, never the `profiles` view (which is not granted to anon).
- `threads.created_by` and `comments.author_id` must equal `auth.uid()` on insert. Comment edits are author-only.
- `0001_nodd_init.sql` is the v1 baseline — applied as one file by fresh consumers. Treat it as frozen post-release; any schema change ships as a new numbered file (`0002_*.sql`, `0003_*.sql`, …). Forward-only: never rewrite an existing migration.

### Build output

`dist/` contains `index.js` (CJS), `index.mjs` (ESM), `index.d.ts`, sourcemaps, and `style.css` (copied from `src/overlay/styles/overlay.css` by the tsup `onSuccess` hook). Consumers import `nodd` and `nodd/style.css`.
