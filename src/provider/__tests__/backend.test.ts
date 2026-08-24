// The reachability guard: what a prototype's console looks like when the
// comment backend isn't there. The failure mode being pinned down is a *stream*
// of network errors — so these assertions are about counts, not just messages.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGuardedFetch, isBackendOffline, subscribeBackend } from '../backend';

const URL_A = 'http://127.0.0.1:54321';

function freshRegistry(): void {
  // The registry is a global singleton (it must survive HMR), so each test
  // needs its own url to start from a known state.
  delete (globalThis as any).__nodd_backend_registry__;
}

let warn: ReturnType<typeof vi.spyOn>;
let realFetch: typeof fetch;

beforeEach(() => {
  freshRegistry();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  realFetch = globalThis.fetch;
});

afterEach(() => {
  warn.mockRestore();
  globalThis.fetch = realFetch;
  freshRegistry();
});

describe('createGuardedFetch', () => {
  it('passes a healthy request straight through', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const res = await createGuardedFetch(URL_A)(`${URL_A}/rest/v1/threads`);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(isBackendOffline(URL_A)).toBe(false);
  });

  it('turns a network failure into one warning and a 503, then stops calling fetch', async () => {
    const spy = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    const guarded = createGuardedFetch(URL_A);

    const first = await guarded(`${URL_A}/auth/v1/token`);
    expect(first.status).toBe(503);
    expect(await first.json()).toMatchObject({ code: 'nodd_backend_offline' });

    // Everything after the first failure short-circuits: no second attempt, no
    // second log line. This is the whole point — supabase-js retries auth,
    // queries and member prefetches independently.
    for (let i = 0; i < 25; i++) {
      const res = await guarded(`${URL_A}/rest/v1/threads`);
      expect(res.status).toBe(503);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(URL_A);
    expect(isBackendOffline(URL_A)).toBe(true);
  });

  it('lets an abort propagate — a cancelled request says nothing about the backend', async () => {
    globalThis.fetch = (async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }) as unknown as typeof fetch;

    await expect(createGuardedFetch(URL_A)(`${URL_A}/rest/v1/threads`)).rejects.toThrow(
      /aborted/i,
    );
    expect(isBackendOffline(URL_A)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('notifies subscribers when the backend goes offline', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const seen: boolean[] = [];
    const unsubscribe = subscribeBackend(URL_A, () => seen.push(isBackendOffline(URL_A)));

    await createGuardedFetch(URL_A)(`${URL_A}/rest/v1/threads`);

    expect(seen).toEqual([true]);
    unsubscribe();
  });
});
