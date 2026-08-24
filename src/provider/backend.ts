/**
 * Reachability guard for the consumer's Supabase project.
 *
 * A prototype is often run with no backend in reach — the local stack isn't
 * started, the laptop is offline, the project was deleted. Left alone,
 * supabase-js turns that into an unbounded stream of `TypeError: Failed to
 * fetch` / `AuthRetryableFetchError` in the console (auth refresh, store
 * queries and member prefetches all retry independently), which buries the
 * host's own logs and says nothing actionable.
 *
 * So every Supabase request goes through `createGuardedFetch`: the first
 * network failure logs one line that names the URL and what still works, and
 * from then on requests short-circuit to a synthetic 503 instead of hitting
 * the network. The provider subscribes to the same record and drops comments
 * to off, which also disposes the store (and with it the Realtime socket,
 * whose retries never pass through `fetch` at all).
 *
 * Offline is sticky for the session: recovering means starting the backend and
 * reloading, which is what the log says. Nothing here retries in the
 * background — a prototype with no comments must not keep a timer alive.
 */

type BackendRecord = {
  offline: boolean;
  warned: boolean;
  listeners: Set<() => void>;
};

const REGISTRY_KEY = '__nodd_backend_registry__' as const;

function registry(): Map<string, BackendRecord> {
  const g = globalThis as any;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map<string, BackendRecord>();
  return g[REGISTRY_KEY] as Map<string, BackendRecord>;
}

function record(supabaseUrl: string): BackendRecord {
  const map = registry();
  let rec = map.get(supabaseUrl);
  if (!rec) {
    rec = { offline: false, warned: false, listeners: new Set() };
    map.set(supabaseUrl, rec);
  }
  return rec;
}

export function isBackendOffline(supabaseUrl: string): boolean {
  return record(supabaseUrl).offline;
}

export function subscribeBackend(supabaseUrl: string, listener: () => void): () => void {
  const rec = record(supabaseUrl);
  rec.listeners.add(listener);
  return () => {
    rec.listeners.delete(listener);
  };
}

/**
 * A network failure — the request never reached the server. `fetch` rejects
 * with a plain `TypeError` for DNS/connection/CORS-preflight failures, while an
 * abort (our own 15 s onboarding timeout, a cancelled query) rejects with an
 * `AbortError` that must keep propagating: it says nothing about the backend.
 */
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  if (err instanceof Error && err.name === 'AbortError') return false;
  return err instanceof TypeError;
}

function markOffline(supabaseUrl: string): void {
  const rec = record(supabaseUrl);
  const firstTime = !rec.warned;
  rec.offline = true;
  rec.warned = true;
  if (firstTime) {
    console.warn(
      `[nodd] Comment backend at ${supabaseUrl} is unreachable — comments are ` +
        'off for this session. Variants, prototype scopes and view state still ' +
        'work. Start the backend and reload to bring comments back.',
    );
  }
  for (const listener of rec.listeners) listener();
}

/**
 * The answer given in place of a request we didn't send. A 503 with a JSON body
 * is what supabase-js and gotrue-js already know how to fold into their normal
 * `{ error }` result, so callers report a failed request rather than throwing
 * past them.
 */
function offlineResponse(supabaseUrl: string): Response {
  return new Response(
    JSON.stringify({
      message: `nodd: comment backend at ${supabaseUrl} is unreachable`,
      code: 'nodd_backend_offline',
    }),
    { status: 503, statusText: 'Service Unavailable', headers: { 'content-type': 'application/json' } },
  );
}

export function createGuardedFetch(supabaseUrl: string): typeof fetch {
  return async function guardedFetch(input: any, init?: any): Promise<Response> {
    if (isBackendOffline(supabaseUrl)) return offlineResponse(supabaseUrl);
    try {
      return await fetch(input, init);
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
      markOffline(supabaseUrl);
      return offlineResponse(supabaseUrl);
    }
  } as typeof fetch;
}
