# AuthClient — Module Design

> Thin wrapper around Supabase Auth that owns Nodd's identity surface: magic-link sign-in, sign-out, session restoration from `localStorage`, and a single observable of the current user. It is the only module that talks to `supabase.auth`; every other module in Nodd consumes identity exclusively through this client.

Parent: [Architecture Design](../../DESIGN_DOC.md) · Sibling modules: [`src/provider/`](../provider/README.md), [`src/store/`](../store/README.md), [`src/overlay/`](../overlay/README.md)

## 1. Purpose

Nodd uses **passwordless magic-link auth via Supabase** (architecture doc §4). `AuthClient` exists so the rest of the library never imports `supabase.auth` directly. It encapsulates four concerns:

1. Triggering a magic-link email for a given address and optional display name (`signIn`).
2. Tearing down the active session (`signOut`).
3. Rehydrating a session from `localStorage` on app boot (`restoreSession`).
4. Notifying the runtime when the auth state changes (`onAuthChange`).

The module is intentionally tiny — it owns no UI, no routing, and no business rules. Its single responsibility is to expose the *current user* as a synchronously-readable, change-observable value, and to drive Supabase Auth on the host's behalf.

## 2. Public Interface

The module exports one class and one user shape. No React, no hooks — those live in `NoddProvider`.

```ts
export type CurrentUser = {
  id: string;              // auth.users.id (uuid)
  email: string;           // primary identifier; always present for magic-link users
  displayName: string | null;
  avatarUrl: string | null;
};

export class AuthClient {
  constructor(supabase: SupabaseClient);

  signIn(email: string, displayName?: string): Promise<void>;
  signOut(): Promise<void>;
  restoreSession(): Promise<CurrentUser | null>;
  onAuthChange(callback: (user: CurrentUser | null) => void): () => void;

  // Synchronously-readable current value (mirrors the latest onAuthChange emission).
  readonly currentUser: CurrentUser | null;
}
```

### Method contracts

| Method | Description |
|--------|-------------|
| `signIn(email, displayName?)` | Calls `supabase.auth.signInWithOtp`, passing a non-empty display name as `options.data.display_name`. Resolves once Supabase has accepted the request and dispatched the email; **does not** wait for the user to click the link. Rejects with the Supabase error on rate-limit, malformed email, or network failure. The provider/UI is responsible for showing a "check your inbox" state until `onAuthChange` later emits a non-null user. |
| `signOut()` | Calls `supabase.auth.signOut()`. Clears the Supabase-managed session in `localStorage`, then emits `null` through `onAuthChange`. Idempotent — safe to call when already signed out. |
| `restoreSession()` | Reads any persisted session from the Supabase client (which itself reads `localStorage` via its built-in storage adapter), validates it server-side via `supabase.auth.getSession()` (refreshing the access token if needed), and returns the resolved `CurrentUser` or `null`. Emits the same value through `onAuthChange`. Safe to call multiple times; the second call is a no-op if the session has not changed. |
| `onAuthChange(cb)` | Subscribes to `supabase.auth.onAuthStateChange` under the hood. Fires on `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, and `USER_UPDATED`. Returns an unsubscribe function. Emits the *current* value synchronously on subscribe so consumers don't need a separate `getInitialUser()` call. |
| `currentUser` | Cached snapshot of the latest emitted value, refreshed before every `onAuthChange` notification. Lets the provider render synchronously without dropping a frame on first paint. |

### CurrentUser shape

`CurrentUser` is **derived** from `auth.users` plus the `profiles` view (DESIGN_DOC §3). On every emission, `AuthClient` joins the Supabase-supplied `User` with cached profile fields (`display_name`, `avatar_url`) it fetched once from `profiles` at first sign-in. If the profile lookup has not yet completed, `displayName` and `avatarUrl` are `null` — the overlay falls back to email + colour-from-name avatar (architecture §8).

`CurrentUser.email` comes from the **session**, never from the view: `0007_profiles_drop_email.sql` dropped `profiles.email`, so selecting it answers `400 column profiles.email does not exist` — which used to fail the whole lookup and leave `displayName`/`avatarUrl` permanently null. `fetchProfile` selects `id, display_name, avatar_url` only; don't add `email` back.

## 3. Supabase `signInWithOtp` Configuration

Magic-link is configured with the redirect target and, for the combined onboarding form, display-name metadata.

```ts
await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: window.location.origin + window.location.pathname + window.location.search,
    data: { display_name: displayName },
  },
});
```

| Option | Value | Reason |
|--------|-------|--------|
| `emailRedirectTo` | Current origin + path + query (read at call time) | The user must land back on the *exact* page they were viewing when they triggered sign-in — Nodd is a pin-on-a-prototype tool, and bouncing the user to `/` would break the flow. Reading at call time (not at module construction) means programmatic navigations after import are reflected. |
| `data.display_name` | Trimmed non-empty name; omitted when absent | New users get their display name in `raw_user_meta_data` during account creation, so name and email are collected in one step. Existing accounts without metadata still use the legacy `setDisplayName` fallback. |
| `shouldCreateUser` | (default `true`) | Magic-link is the only sign-up path in v1; first-time users are auto-provisioned in `auth.users`. The `project_members` row is created out-of-band by an invite flow (architecture §11, future work). |
| OTP token | not used | Nodd does not present a "type the 6-digit code" UI; the email link is the sole credential. |

The redirect URL must be present in the Supabase project's **Allowed Redirect URLs** list — this is a host-app deployment concern, documented in `supabase/README.md`, not enforced by this module.

## 4. Session Persistence (Supabase localStorage adapter)

`AuthClient` does not manage persistence itself. Persistence is delegated entirely to the `@supabase/supabase-js` client and its built-in `localStorage` adapter. `NoddProvider` configures the storage key as `nodd-auth:<supabase-host>` so switching a consumer to another Supabase project cannot restore and send a JWT issued by the previous project.

| Concern | Handled by | Notes |
|---------|------------|-------|
| Writing the session on sign-in | Supabase client | Fires automatically when `signInWithOtp`'s callback completes the OTP exchange. |
| Reading the session on boot | Supabase client | `getSession()` is the public API; it transparently reads from `localStorage`. |
| Refreshing the access token | Supabase client | `autoRefreshToken: true` (default) keeps the JWT valid; `TOKEN_REFRESHED` events flow through `onAuthStateChange` and we re-emit through `onAuthChange`. |
| Clearing on sign-out | Supabase client | `signOut()` removes the storage entry. |

`AuthClient`'s job is therefore to **observe and surface** what the Supabase client persists, not to duplicate that persistence. We deliberately do not write our own `localStorage` keys — adding a parallel cache would create a consistency hazard with the Supabase-managed token and is unnecessary for the user shape we expose (which is fully derivable from `getSession()` + `profiles`).

### SSR safety

The Supabase client touches `localStorage` lazily — only when its auth methods are invoked. `AuthClient` consumers (specifically `NoddProvider`) only call `restoreSession` from inside `useEffect` (provider §4 lifecycle), so the module is SSR-safe by composition: no method on `AuthClient` is reachable during server render.

## 5. Magic-Link Round-Trip

```mermaid
sequenceDiagram
  participant User
  participant App as Host App<br/>(NoddProvider)
  participant Auth as AuthClient
  participant SB as Supabase Auth
  participant LS as localStorage
  participant Mail as Email

  User->>App: opens overlay, enters name + email
  App->>Auth: signIn("alice@example.com", "Alice")
  Auth->>SB: signInWithOtp({ email, data: { display_name: "Alice" } })
  SB-->>Mail: dispatches magic-link email
  SB-->>Auth: ack (Promise resolves)
  Auth-->>App: resolved → render "check your inbox"
  Note over User,Mail: User leaves to email client

  User->>Mail: clicks magic link
  Mail->>SB: GET/auth/v1/verify?token=...
  SB-->>User: 302 → emailRedirectTo (same prototype URL,<br/>with #access_token=... in fragment)
  User->>App: page reloads at original URL
  App->>Auth: new instance constructed in useEffect
  Auth->>SB: onAuthStateChange subscribe
  SB->>SB: parses URL fragment, exchanges for session
  SB->>LS: writes nodd-auth:&lt;supabase-host&gt;
  SB-->>Auth: SIGNED_IN event with session
  Auth->>SB: select id, email, display_name, avatar_url<br/>from profiles where id = auth.uid()
  SB-->>Auth: profile row
  Auth-->>App: onAuthChange(CurrentUser)
App->>App: re-render overlay as authenticated
```

Key properties:

- The round-trip survives a **full page reload** because the session is persisted before the user even returns. The Supabase client picks up the URL fragment on next mount and emits `SIGNED_IN`, which `AuthClient` forwards.
- `signIn` resolving does **not** mean the user is signed in — it means the email request was accepted. UI state ("check your inbox") and authenticated state ("user is here") are decoupled.
- The redirect target is captured from the current origin, path, and query at `signIn` time, so a user who triggers sign-in on `/checkout/step-2` returns to that exact page with their context intact.
- Profile hydration is a separate, fast query against the `profiles` view; the user is considered authenticated as soon as Supabase emits `SIGNED_IN`, and `displayName` / `avatarUrl` fill in shortly after.

## 6. Unauthenticated State Exposure

`AuthClient` represents "no user" as `null`, exposed identically through every surface:

| Surface | Unauthenticated value |
|---------|-----------------------|
| `currentUser` | `null` |
| `onAuthChange` callback | invoked with `null` |
| `restoreSession()` resolution | resolves to `null` |

There is **no separate `isLoading` flag** on this module. The provider treats "have we called `restoreSession` yet?" as its own concern — `AuthClient` only reports a stable, point-in-time fact. This keeps the contract trivially testable and matches the architecture's "explicit over implicit" principle (§9).

### What unauthenticated users can see

Unauthenticated state composition (with other modules) follows architecture §4:

- **Read-only pins** if the project is marked `public_read` (out of v1, listed as future work). Until then, `CommentStore` will refuse to subscribe and `OverlayRenderer` shows the sign-in prompt.
- **No mutations** — `signIn`/`signOut` are the only calls a `null` user can make. The provider's `useNodd()` hook is unaffected; all other operations route through `OverlayRenderer`'s gated UI.
- **No realtime channel** — `CommentStore` waits for a non-null user before opening its Supabase channel, so we do not consume Realtime quota for anonymous viewers.

The provider observes `onAuthChange` and stores the result in React state; rendering "signed in" vs "signed out" UI is therefore a pure function of the latest emitted value.

## 7. File Organisation

```
src/auth/
├── README.md              ← this document
├── index.ts               ← re-exports AuthClient, CurrentUser
├── AuthClient.ts          ← class implementation, onAuthChange wiring
└── profile.ts             ← profile fetch + cache (id, email, display_name, avatar_url)
```

## 8. Design Decisions

| Decision | Rationale |
|----------|-----------|
| Wrap Supabase Auth in a class, not export the client directly | Keeps the dependency direction clean (architecture §2) — only `AuthClient` knows about `supabase.auth`. The rest of Nodd can be unit-tested with a fake `AuthClient`. |
| Redirect to the current origin + path + query | Magic-link must return the user to the exact prototype URL where they triggered sign-in; otherwise the pin context is lost. The auth hash is intentionally excluded, and the location is read at call time so SPA navigations are honoured. |
| Put `display_name` in OTP signup metadata | Collects name and email in one form for new users while preserving `signIn(email)` compatibility and the name prompt fallback for legacy accounts. |
| Delegate persistence to the Supabase client's localStorage adapter | Avoids dual writes and the consistency bugs they cause. The provider scopes Supabase's key by backend host so sessions cannot leak across consumer backend changes. |
| Single `CurrentUser` shape, `null` for signed-out | Trivial to consume and trivial to test. No `Result`/`Either` ergonomics needed — magic-link errors all surface through promise rejections on `signIn`. |
| `onAuthChange` emits synchronously on subscribe | Spares every consumer from writing the same "what's the initial value?" boilerplate; matches React's `useSyncExternalStore` mental model. |
| No `isLoading` flag inside `AuthClient` | "Have we tried to restore yet?" is the provider's lifecycle concern, not auth's. Keeping `AuthClient` stateless beyond the user value makes it composable. |
| Profile data fetched separately from the session | The `auth.users` row alone doesn't have `display_name` / `avatar_url`; those live in the `profiles` view. Splitting the fetch lets us emit "signed in" immediately and fill richer data a beat later, supporting the sub-200ms paint budget (architecture §8). |

## 9. Known Limitations

- **No retry/back-off on `signIn` rate limits.** Supabase's magic-link endpoint rate-limits per-email; we surface the error and let the UI throttle. A future enhancement could expose `nextAttemptAt` from the error.
- **No multi-tab session sync beyond what Supabase provides.** The Supabase client broadcasts `localStorage` changes across tabs, which we forward — but if a host app uses an alternative storage adapter, multi-tab behaviour is whatever that adapter supplies.
- **No offline sign-in.** Magic-link requires a live email round-trip; there is no offline grace path. Cached sessions continue to work offline (the access token is read locally), but a fully expired session cannot be refreshed without network.
- **`profiles` view assumed to exist.** The module reads from `profiles` at sign-in. If the host hasn't applied the schema migrations from `supabase/`, the join silently produces `null` profile fields and the overlay falls back to email-only display. This is documented but not enforced at runtime.
- **Invite-only project membership is out of scope.** `AuthClient` only proves *who* the user is; whether that user is a member of `projects.id` is enforced by RLS at query time (architecture §3) and is not this module's concern.

## 10. Related

- Architecture doc §4 (Auth Flow), §3 (Data Model — `auth.users`, `profiles`), §8 (Sub-200ms Load — profile prefetch), §9 (Design Principles).
- [`src/provider/README.md`](../provider/README.md) — owns the `AuthClient` instance, calls `restoreSession`, subscribes to `onAuthChange`, surfaces `signIn`/`signOut` through `useNodd()`.
- [`src/store/README.md`](../store/README.md) — receives the resolved `CurrentUser` from the provider and stamps `author_id` on optimistic mutations.
- [`src/overlay/README.md`](../overlay/README.md) — renders the sign-in form, the "check your inbox" state, and the avatar strip; never imports `AuthClient` directly.
- [`supabase/README.md`](../../supabase/README.md) — owns the `profiles` view, RLS policies, and the Allowed Redirect URLs configuration that magic-link depends on.
