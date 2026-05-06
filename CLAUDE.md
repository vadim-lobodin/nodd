# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Align** (`@align/react`) — a drop-in React library that overlays Figma-like spatial comments on live React prototypes. Distributed as an npm package; backend is the consumer's own Supabase project (no Align-hosted server). See `DESIGN_DOC.md` and `GOAL&REQUIREMENTS.md` for full spec.

## Commands

```bash
npm run build       # tsup: ESM + CJS + .d.ts into dist/, copies overlay.css → dist/style.css
npm run dev         # tsup --watch
npm run typecheck   # tsc --noEmit (no test runner configured)
```

**CLI** (`bin/align.mjs`, exposed via `package.json#bin` as `align`): consumer-facing onboarding tool. `init` creates a Supabase project via the Management API, applies the migrations, configures auth redirects, writes `.env.local` + `.align/config.json`, and prints an `<AlignProvider>` snippet. `add-origin <url>` patches the redirect allowlist after deploy. Reads `SUPABASE_ACCESS_TOKEN` from env (never persisted). ESM, no extra deps — uses built-in `fetch`, `readline`, `crypto`. Don't add npm deps here without a strong reason; the CLI runs via `npx` and bloating it slows cold starts.

Database (against the local or linked Supabase project):
```bash
supabase start          # local stack on ports 54321 (api), 54322 (db), 54323 (studio), 54324 (inbucket)
supabase db push        # apply migrations in supabase/migrations/ (forward-only, never edit existing files)
supabase db reset       # nuke + replay migrations + seed.sql
```

## Architecture

Five modules, one-way dependency graph: `provider → {auth, store, overlay} → supabase-js`. The public surface is intentionally tiny — one component + one hook from `src/index.ts`:

```ts
<AlignProvider projectId supabaseUrl supabaseAnonKey theme?> ...
const { user, signIn, signOut, toggleOverlay, isVisible, ... } = useAlign();
```

| Module | Role |
|---|---|
| `src/provider/` | `AlignProvider` boots singletons, owns runtime state (user, urlPath, visibility, theme), creates two body-attached portals, exposes `AlignContext`. |
| `src/auth/` | `AuthClient` wraps Supabase magic-link sign-in + session restore. |
| `src/store/` | `CommentStore` — page-scoped fetch, IndexedDB cache, optimistic CRUD with temp IDs, Realtime subscription. Files are split by concern (`query`, `mutations`, `realtime`, `cache`, `state`, `members`). |
| `src/overlay/` | React UI rendered via portal: `OverlayRenderer`, `Sidebar`, `ThreadPopover`, `PinMarker`, `CaptureLayer`, `MentionPicker`, plus `anchoring/` (selector + fingerprint + resolver + ResizeObserver re-anchor loop). |
| `supabase/` | SQL migrations, RLS policies, indexes. Bundled in the npm package via `package.json` `files` so consumers can apply them after `npm i`. |

Each module has its own `README.md` with detailed design notes; consult them before deeper changes.

### Hard invariants — do not break

- **Zero host impact when overlay is off.** When `isVisible` is false the entire portal is unmounted (`AlignProvider.tsx:159`). All overlay CSS is scoped under `[data-align-root]` / `[data-align-pin-container]`; never add unscoped global selectors to `src/overlay/styles/overlay.css`.
- **Two portals, not one.** `align-pins` is `position: absolute` so pins scroll with the document; `align-root` is `position: fixed` for toolbar/sidebar/popover/capture. Both are appended directly to `document.body` and carry a `data-align-theme` attribute.
- **Strict Mode-safe singletons.** `supabase`, `AuthClient`, and `CommentStore` are stored in refs and lazily constructed once (see `AlignProvider.tsx:33-63`). The store is created in `useEffect` (not during render) to avoid double Realtime subscriptions; it is `dispose()`-ed on unmount.
- **SSR-safe.** Anything touching `window`/`document` must go through `isBrowser()` (`src/provider/ssr.ts`) or live inside `useEffect`.
- **External peers.** `react`, `react-dom`, `react/jsx-runtime`, `@supabase/supabase-js`, `@radix-ui/*`, and `boring-avatars` are marked external in `tsup.config.ts`. When adding a runtime dep, decide whether to bundle it or externalize it and update both `tsup.config.ts` and `package.json` peer/deps accordingly. `sideEffects: ["**/*.css"]` is required for consumer tree-shaking.

### Sync model (store ↔ Supabase)

- Page-scoped query: `threads where project_id = $1 and url_path = $2 and resolved = false`, served by the partial index `threads_project_path_idx`. The 200 ms budget assumes this index exists — don't drop it.
- IndexedDB cache (`src/store/cache.ts`, via `idb-keyval`) keyed by `(projectId, urlPath)` is read first on subscribe, then reconciled with the network response.
- Optimistic mutations create `temp-<uuid>` IDs and reconcile via `replaceThreadId` / `replaceCommentId` once the server responds. A `recentlyWritten` set (5 s TTL) suppresses Realtime echoes of our own writes — see `createCommentStore.ts:152-155`. If you add new mutations, they must round-trip through `markRecentlyWritten` for both the row id and any child comment id, otherwise the UI will flash duplicates.
- Realtime channel filters server-side by `project_id`; per-page `url_path` filtering is local. Add tables to `supabase_realtime` publication in a new migration if you create more.

### DOM anchoring (`src/overlay/anchoring/`)

Pins are stored as `{ selector, offsetX, offsetY, fingerprint, viewportWidth }` JSON in `threads.pin`. Resolution is three-tier: exact selector → fingerprint match among candidates → "orphaned" (sidebar only, not rendered on page). Position re-renders on resize via a single `ResizeObserver`; selector resolution only re-runs on route change. Don't move re-anchoring out of the AnimationFrame batch — it's hot.

### Auth

Magic link via `supabase.auth.signInWithOtp({ email })` with `emailRedirectTo: window.location.href`. Session is restored on mount; unauthenticated users see read-only pins (or nothing). The `profiles` view exposes `id, email, display_name, avatar_url` from `auth.users` — client code must use this view, not `auth.users` directly.

### RLS contract (every new query must respect this)

- All Align-owned tables have RLS enabled; `is_project_member(project_id)` (SECURITY DEFINER, defined in the baseline `0001_align_init.sql`) gates every read. Reuse it — don't reimplement membership checks per policy.
- `threads.created_by` and `comments.author_id` must equal `auth.uid()` on insert. Comment edits are author-only.
- `0001_align_init.sql` is the v1 baseline — applied as one file by fresh consumers. Treat it as frozen post-release; any schema change ships as a new numbered file (`0002_*.sql`, `0003_*.sql`, …). Forward-only: never rewrite an existing migration.

### Build output

`dist/` contains `index.js` (CJS), `index.mjs` (ESM), `index.d.ts`, sourcemaps, and `style.css` (copied from `src/overlay/styles/overlay.css` by the tsup `onSuccess` hook). Consumers import `@align/react` and `@align/react/style.css`.
