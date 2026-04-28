import { get, set, del, createStore } from 'idb-keyval';
import type { Thread } from './types';

const SCHEMA_VERSION = 1;

type CacheEntry = {
  projectId: string;
  urlPath: string;
  threads: Thread[];
  cachedAt: number;
  schemaVersion: number;
};

let store: ReturnType<typeof createStore> | null = null;

function getStore() {
  if (!store) {
    store = createStore('align-cache', 'pages');
  }
  return store;
}

function cacheKey(projectId: string, urlPath: string): string {
  return `${projectId}::${urlPath}`;
}

export async function readCache(
  projectId: string,
  urlPath: string,
): Promise<Thread[] | null> {
  try {
    const entry = await get<CacheEntry>(cacheKey(projectId, urlPath), getStore());
    if (!entry) return null;
    if (entry.schemaVersion !== SCHEMA_VERSION) {
      await del(cacheKey(projectId, urlPath), getStore());
      return null;
    }
    return entry.threads;
  } catch {
    return null;
  }
}

export async function writeCache(
  projectId: string,
  urlPath: string,
  threads: Thread[],
): Promise<void> {
  try {
    const entry: CacheEntry = {
      projectId,
      urlPath,
      threads,
      cachedAt: Date.now(),
      schemaVersion: SCHEMA_VERSION,
    };
    await set(cacheKey(projectId, urlPath), entry, getStore());
  } catch {
    // Silent fail — cache is best-effort
  }
}
