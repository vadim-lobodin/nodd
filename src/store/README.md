# CommentStore — Module Design

> Owns all comment & thread data for the current page. Provides an in-memory store, an IndexedDB cache, optimistic CRUD, and a Realtime subscription against Supabase. Sole consumer of the Supabase data plane (REST + Realtime).

Related: [Architecture](../../DESIGN_DOC.md) · §8 *Sub-200ms Comment Load Strategy* defines the latency budget this module is built to satisfy.

## 1. Purpose

`CommentStore` is the single source of truth for thread and comment data inside the running Nodd overlay. Its responsibilities:

1. Render-fast, page-scoped reads (threads + comments for the current `url_path`).
2. Optimistic create / reply / resolve / reopen with rollback on failure.
3. Realtime convergence with the Supabase backend so multiple viewers stay in sync.
4. Offline-tolerant first paint via an IndexedDB cache keyed by `(projectId, urlPath)`.

Everything else in Nodd (`OverlayRenderer`, `useNodd`) reads from this store; nothing else talks to the `threads` / `comments` tables.

## 2. Internal Architecture

Single-responsibility, event-driven internally — three coordinated sub-components feed one in-memory state, which is observed by the UI layer.

```
+----------------------+         subscribe()         +-------------------+
|  OverlayRenderer /   | <-------------------------- |   In-memory       |
|  useNodd consumers  |     state snapshots         |   state (per      |
+----------------------+ --------------------------> |   url_path)       |
        ^   ^   ^                                    +---------+---------+
        |   |   |                                              |
        |   |   +--- optimistic mutations (addThread, ...)     | hydrate / persist
        |   |                                                  v
        |   |                                         +-------------------+
        |   |                                         |  IndexedDB cache  |
        |   |                                         |  (idb-keyval)     |
        |   |                                         +-------------------+
        |   |
        |   +--- REST: GET /threads?... (PostgREST embed of comments)
        |
        +--- Realtime: channel("threads:project_id=eq.{id}") + comments channel
```

See the architecture diagram in the session UI (`module-arch-store`) for the fully labelled view.

## 3. Public API

The module exports a single factory `createCommentStore(deps)` returning a `CommentStore`. The provider creates one instance per `NoddProvider` mount and disposes it on unmount.

```ts
type CommentStore = {
  /** Subscribe to state changes for a given page. Returns unsubscribe.
   *  Triggers a hydrate-from-cache → reconcile-from-network on first call per urlPath. */
  subscribe(
    urlPath: string,
    listener: (snapshot: PageSnapshot) => void,
  ): () => void;

  /** Optimistically create a new thread + first comment. Returns the temp thread id. */
  addThread(input: {
    urlPath: string;
    pin: Pin;
    body: string;
    mentions?: UserId[];
  }): Promise<ThreadId>;

  /** Optimistically append a reply to an existing thread. */
  replyToThread(input: {
    threadId: ThreadId;
    body: string;
    mentions?: UserId[];
  }): Promise<CommentId>;

  /** Mark a thread resolved (optimistic, with rollback). */
  resolveThread(threadId: ThreadId): Promise<void>;

  /** Reopen a previously resolved thread. */
  reopenThread(threadId: ThreadId): Promise<void>;

  /** Tear down realtime channels, flush pending writes, close cache handle. */
  dispose(): void;
};
```

| Method | Returns | Optimistic | Rolls back on |
|---|---|---|---|
| `subscribe` | `() => void` (unsubscribe) | n/a | n/a |
| `addThread` | `ThreadId` (temp uuid) | yes | network error, RLS denial |
| `replyToThread` | `CommentId` (temp uuid) | yes | network error, RLS denial |
| `resolveThread` | `void` | yes | network error, RLS denial |
| `reopenThread` | `void` | yes | network error, RLS denial |
| `dispose` | `void` | n/a | n/a |

## 4. State Shape

State is keyed by `urlPath` so the overlay only ever reads what's relevant to the current page.

```ts
type Pin = {
  selector: string;
  offsetX: number;
  offsetY: number;
  fingerprint: string;
  viewportWidth: number;
};

type Comment = {
  id: CommentId;            // server uuid OR `temp-${nanoid}` while pending
  threadId: ThreadId;
  authorId: UserId;
  body: string;
  mentions: UserId[];
  createdAt: string;        // ISO
  editedAt: string | null;
  pending?: boolean;        // true until server ack
  failed?: boolean;         // true after rollback
};

type Thread = {
  id: ThreadId;
  projectId: ProjectId;
  urlPath: string;
  pin: Pin;
  resolved: boolean;
  resolvedBy: UserId | null;
  resolvedAt: string | null;
  createdBy: UserId;
  createdAt: string;
  comments: Comment[];      // ordered by createdAt asc
  pending?: boolean;
  failed?: boolean;
};

type PageSnapshot = {
  urlPath: string;
  threads: Thread[];        // ordered by createdAt asc; resolved excluded by default
  loading: boolean;         // true while first network fetch is in flight
  error: StoreError | null;
};

// Internally, the store holds:
type StoreState = {
  byPath: Map<UrlPath, PageSnapshot>;
  threadIndex: Map<ThreadId, UrlPath>;   // for delta routing
  pending: Map<TempId, PendingMutation>; // for rollback
};
```

The store exposes immutable snapshots — listeners receive a fresh `PageSnapshot` reference on every change, so React consumers can use referential equality.

## 5. IndexedDB Cache

### Schema (single object store)
- **Database:** `nodd-cache`
- **Object store:** `pages`
- **Key:** `${projectId}::${urlPath}`
- **Value:**
  ```ts
  {
    projectId: string;
    urlPath: string;
    threads: Thread[];      // resolved=false only
    cachedAt: number;       // epoch ms
    schemaVersion: 1;
  }
  ```

A second store `meta` holds `{ key: 'lastFlush', value: epoch }` for diagnostics.

We use [`idb-keyval`](https://www.npmjs.com/package/idb-keyval) (≈600 B gzipped) — no need for a full IndexedDB ORM.

### Reconciliation Flow

1. **Hydrate (sync, ≤30 ms):** on first `subscribe(urlPath)`, read cache key `(projectId, urlPath)`. If hit, populate `byPath[urlPath]` with `loading: true` and emit a snapshot immediately so the overlay paints with cached pins.
2. **Fetch (async, ≤120 ms target):** issue the page-scoped query (§6). On response:
   - Replace the in-memory thread list for that `urlPath` with the server result.
   - **Preserve pending optimistic mutations**: any thread/comment with `pending: true` whose temp id is not yet known to the server is re-merged on top of the server snapshot.
   - Write the merged result back to IndexedDB.
   - Emit a snapshot with `loading: false`.
3. **Network failure with cache hit:** keep the cached state, set `error: { kind: 'network-stale', cachedAt }`. Realtime + retry will reconcile when connectivity returns.
4. **Network failure without cache:** `loading: false, threads: [], error: { kind: 'fetch-failed' }`.
5. **Schema version bump:** if `schemaVersion` differs, drop the cache entry and treat as cold load.

## 6. Page-Scoped Query

A single PostgREST request per `urlPath`, side-loading comments via embedded select:

```http
GET /rest/v1/threads
  ?project_id=eq.{projectId}
  &url_path=eq.{urlPath}
  &resolved=eq.false
  &select=*,comments(*)
  &order=created_at.asc
```

```ts
const { data, error } = await supabase
  .from('threads')
  .select('*, comments(*)')
  .eq('project_id', projectId)
  .eq('url_path', urlPath)
  .eq('resolved', false)
  .order('created_at', { ascending: true });
```

This relies on the composite index `threads(project_id, url_path) where resolved = false` defined in `DESIGN_DOC.md` §3, keeping the cold-load latency inside the §8 budget table:

| Stage | Target |
|---|---|
| IndexedDB cache hit + render | < 30 ms |
| Network query (cold) | < 120 ms |
| Pin layout pass | < 20 ms |
| **Total cold** | **< 200 ms** |

Resolved threads are fetched lazily by the sidebar's "Resolved" tab — out of scope for this module's default subscription, but exposed via an internal `fetchResolved(urlPath)` helper consumed by `OverlayRenderer`.

## 7. Optimistic Update + Rollback

Every mutating method follows the same five-phase contract:

1. **Generate temp id** (`temp-${nanoid()}`).
2. **Apply locally**: update in-memory state with `pending: true`, emit snapshot.
3. **Persist optimistic state** to IndexedDB (so a hard reload mid-flight still shows the user's pin).
4. **Send to Supabase** via the matching REST call.
5. On **success**: replace temp id with server id, clear `pending`, re-emit. On **failure**: remove the optimistic entry (or restore prior `resolved` state), set `failed: true` for one snapshot tick so the UI can toast, then drop after 5 s.

```ts
type PendingMutation =
  | { kind: 'addThread'; tempId: ThreadId; urlPath: string; prevSnapshot: Thread[] }
  | { kind: 'reply'; tempId: CommentId; threadId: ThreadId; prevComments: Comment[] }
  | { kind: 'resolve'; threadId: ThreadId; prevResolved: boolean }
  | { kind: 'reopen'; threadId: ThreadId; prevResolved: boolean };
```

Rollback restores `prevSnapshot` / `prevComments` / `prevResolved` exactly — no diffing, no merging. This keeps rollback deterministic even if a Realtime delta arrived in the meantime (the delta will still apply on top of the rolled-back state).

## 8. Realtime Subscription

One Supabase Realtime channel per `NoddProvider` mount, scoped to the project:

```ts
const channel = supabase
  .channel(`align:project:${projectId}`)
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'threads',
        filter: `project_id=eq.${projectId}` },
      onThreadChange)
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'comments',
        filter: `project_id=eq.${projectId}` }, // via FK fan-out; see below
      onCommentChange)
  .subscribe();
```

### Two-stage filter: server-side `project_id`, client-side `url_path`
Realtime supports a single equality filter per subscription. We use `project_id=eq.{id}` server-side so clients **never** receive events for other projects (privacy + bandwidth). The narrower `url_path` filter is applied **client-side** inside `onThreadChange` / `onCommentChange`:

```ts
function onThreadChange(payload) {
  const urlPath = payload.new?.url_path ?? payload.old?.url_path;
  if (!state.byPath.has(urlPath)) return;   // not currently rendered → drop
  applyThreadDelta(payload);
}
```

This keeps subscription topology simple (one channel per project, regardless of how many tabs/routes the user opens) while still scoping render work to the active page. Threads on inactive pages are dropped — they will be picked up on the next `subscribe(urlPath)` via cache + page-scoped fetch.

Because `comments` has no `project_id` column, the comments filter is implemented as a server-side view `comments_with_project` (defined in `supabase/migrations/`) that joins `threads.project_id`. Channel filtering for `project_id` is server-side — clients never receive events for other projects.

### Delta Handling

| Event | Table | Action |
|---|---|---|
| `INSERT` | `threads` | If `urlPath` is currently subscribed, append; otherwise ignore (will arrive via cache on next `subscribe`). |
| `UPDATE` | `threads` | Patch in place using `threadIndex` to locate the urlPath. If `resolved` flipped to `true`, remove from default snapshot. |
| `DELETE` | `threads` | Remove from snapshot and `threadIndex`. |
| `INSERT` | `comments` | Append to `thread.comments` if the parent thread is in memory. **Suppress if `id` matches an active pending mutation** (echo of our own write). |
| `UPDATE` | `comments` | Patch in place (e.g. edited body). |
| `DELETE` | `comments` | Remove from `thread.comments`. |

Echo suppression: when our `addThread` / `replyToThread` succeeds, we record the returned server id in a short-lived `recentlyWritten` set (TTL 5 s). Realtime inserts whose id is in that set are ignored, preventing duplicate rendering between the REST 201 response and the Realtime echo.

### Reconnection
On `channel.subscribe` callbacks `CHANNEL_ERROR` or `TIMED_OUT`:
- Mark all subscribed pages as `error.kind = 'realtime-disconnected'` (non-blocking — UI shows a small badge).
- Retry with exponential backoff (1 s, 2 s, 4 s, ..., capped at 30 s).
- On successful reconnect, re-run the page-scoped query for every active `urlPath` to catch missed deltas.

## 9. Member & Profile Prefetch

Per DESIGN_DOC §8 point 5, comment rendering must **never** block on user lookups. The store therefore prefetches the `project_members ⨝ profiles` set once per `NoddProvider` mount and caches it in memory for the lifetime of the session.

### Fetch
On factory init (before the first `subscribe(urlPath)`), the store issues:

```ts
const { data } = await supabase
  .from('project_members')
  .select('user_id, role, profile:profiles(id, email, display_name, avatar_url)')
  .eq('project_id', projectId);
```

Result is keyed into a `Map<UserId, MemberProfile>`:

```ts
type MemberProfile = {
  userId: UserId;
  role: 'member' | 'admin';
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type MemberCache = {
  byId: Map<UserId, MemberProfile>;
  list: MemberProfile[];        // for @mention autocomplete; stable order
  fetchedAt: number;
};
```

### Lifecycle
- **Single fetch per session.** No periodic refresh — membership churn during a session is rare. A manual `refreshMembers()` is exposed for admin flows (out of v1 UI but trivial to wire later).
- **Realtime patch.** The same `align:project:${projectId}` channel listens for `postgres_changes` on `project_members`; INSERT/DELETE patches `byId` and `list` in place, so a freshly invited collaborator can be `@`-mentioned without a reload.
- **Profile edits** (display name, avatar) are picked up via a `profiles` table delta on the same channel, scoped to the union of member ids.
- **Disposed** alongside the rest of the store on `dispose()`.

### Consumption
- `Comment.authorId` and `Comment.mentions[]` are rendered against `MemberCache.byId` synchronously — never a network call from the render path.
- The mention autocomplete in `OverlayRenderer` reads `MemberCache.list` directly (the store exposes a `getMembers()` accessor on the same factory return; not part of the §3 mutating API surface).
- Avatars use the cached `avatarUrl` if present; otherwise the colour-from-name fallback (DESIGN_DOC §8 point 6) renders without any network roundtrip.

This pre-warm runs **in parallel** with the first page-scoped query, so it does not enter the §8 cold-load critical path:

```
t=0   ├─ fetch members ──────────────────────────────► (cached for session)
      └─ fetch threads + comments (page-scoped) ─────► render
```

If the member fetch fails, the store still emits page snapshots; mentions render with the raw `userId` as a fallback and a `kind: 'members-stale'` warning is surfaced (non-fatal).

## 10. Error States

Surfaced via `PageSnapshot.error`:

```ts
type StoreError =
  | { kind: 'fetch-failed'; retryAt: number }
  | { kind: 'network-stale'; cachedAt: number }      // cache shown, fetch failed
  | { kind: 'realtime-disconnected'; since: number }
  | { kind: 'mutation-failed'; mutation: PendingMutation['kind']; message: string }
  | { kind: 'members-stale'; fetchedAt: number | null } // §9 prefetch failed; mentions render with raw ids
  | { kind: 'unauthorised' };                         // RLS denial / session expired
```

Behaviour:
- `unauthorised` → store stops mutating and emits a one-shot snapshot; `AuthClient` is notified to prompt re-auth.
- `mutation-failed` is transient — set on the affected thread/comment for 5 s then cleared.
- `network-stale` and `realtime-disconnected` coexist; both clear automatically when the next successful fetch / reconnect lands.

## 11. Internal File Organisation

| File | Responsibility |
|---|---|
| `src/store/index.ts` | Public exports (`createCommentStore`, types). |
| `src/store/createCommentStore.ts` | Top-level factory; wires sub-modules; owns dispose. |
| `src/store/state.ts` | Pure reducers over `StoreState`; no IO. |
| `src/store/cache.ts` | IndexedDB read / write / version handling (idb-keyval wrapper). |
| `src/store/query.ts` | PostgREST page-scoped query + resolved-tab helper. |
| `src/store/realtime.ts` | Channel lifecycle, delta routing, reconnection backoff, client-side `url_path` filter. |
| `src/store/mutations.ts` | Optimistic apply + rollback for the four mutating verbs. |
| `src/store/members.ts` | `project_members ⨝ profiles` prefetch, in-memory `MemberCache`, realtime patching. |
| `src/store/types.ts` | Shared types (`Thread`, `Comment`, `Pin`, `MemberProfile`, `StoreError`, …). |
| `src/store/__tests__/` | Unit tests for reducers, mutation rollback, echo suppression. |

No file imports from `src/overlay/`, `src/provider/`, or `src/auth/`. Auth dependency is injected as a `getSession()` function so the store stays decoupled from `AuthClient`.

## 12. Design Decisions

| Decision | Rationale |
|---|---|
| Page-scoped query (not global) | Hard requirement from DESIGN_DOC §8 budget table — full project fetch would blow the 120 ms cold-network target on busy projects. |
| PostgREST embed (`select=*,comments(*)`) | One round-trip vs. two; keeps total cold load < 200 ms without server changes. |
| IndexedDB via `idb-keyval` | Tiny dependency, async, works offline. A full ORM is overkill for one object store. |
| Optimistic mutations | Sub-200 ms budget excludes network RTT for user actions; perceived instant feedback is a UX requirement implied by GOAL §"Reduce feedback loop". |
| Echo suppression by id | Cheaper and simpler than diffing two near-identical snapshots. 5 s TTL is comfortably above realtime delivery latency. |
| Single channel per project | Supabase recommends ≤ 1 channel per logical scope; per-page channels would multiply costs and complicate reconnection. |
| Comments filter via DB view | Avoids denormalising `project_id` into `comments`; keeps the schema in DESIGN_DOC §3 unchanged. |
| Rollback restores prior snapshot wholesale | Deterministic and trivially correct; mutations are small enough that the memory cost is negligible. |
| Members prefetched once per session | DESIGN_DOC §8 point 5 — comment render must never block on user lookup. Membership is small (≲ 100 rows) and rarely churns mid-session. |
| Server-side `project_id`, client-side `url_path` filter | Realtime supports one filter; `project_id` is the privacy boundary so it must be enforced server-side. `url_path` is just a render scoping hint and is cheap to drop on the client. |

## 13. Known Limitations

- **No multi-tab coordination.** Two tabs of the same prototype each maintain their own in-memory store; they converge via Realtime but cache writes can race. Acceptable for v1; a `BroadcastChannel` coordinator is a follow-up.
- **No edit / delete API.** Only `addThread`, `replyToThread`, `resolveThread`, `reopenThread` are exposed in v1, matching the GOAL document's MVP scope.
- **Fingerprint-only orphan detection.** The store stores pins verbatim; *resolving* anchors against the live DOM is `OverlayRenderer`'s job. The store has no concept of "orphaned".
- **No pagination.** A single `urlPath` is assumed to hold ≲ 200 unresolved threads. Beyond that, the §8 latency budget will fail and pagination becomes necessary.
- **Resolved threads not realtime.** Once a thread is resolved it leaves the default snapshot; if it's later reopened by another user, our subscriber sees an UPDATE delta and re-adds it. But while a user has the "Resolved" tab open, that list does not auto-update — refresh is manual.
- **No retry queue for mutations.** A failed `addThread` is rolled back and surfaced; the user must re-submit. A persistent outbox is a follow-up.

## 14. Links

- **Parent:** [Architecture — DESIGN_DOC.md](../../DESIGN_DOC.md) — see §8 *Sub-200ms Comment Load Strategy* for the latency budget this module implements.
- **Sibling modules:** `src/provider/README.md`, `src/overlay/README.md`, `src/auth/README.md`, `supabase/README.md` (to be created).
- **Schema source of truth:** `supabase/migrations/` (table & view definitions referenced in §3, §8).
