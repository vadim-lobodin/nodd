import type { StoreState, PageSnapshot, Thread, Comment, ThreadId, UrlPath, StoreError } from './types';

export function createInitialState(): StoreState {
  return {
    byPath: new Map(),
    threadIndex: new Map(),
    pending: new Map(),
  };
}

export function getOrCreatePage(state: StoreState, urlPath: UrlPath): PageSnapshot {
  let page = state.byPath.get(urlPath);
  if (!page) {
    page = { urlPath, threads: [], loading: true, error: null };
    state.byPath.set(urlPath, page);
  }
  return page;
}

export function setPageThreads(
  state: StoreState,
  urlPath: UrlPath,
  threads: Thread[],
  loading: boolean,
  error: StoreError | null,
): PageSnapshot {
  const page: PageSnapshot = { urlPath, threads, loading, error };
  state.byPath.set(urlPath, page);
  for (const t of threads) {
    state.threadIndex.set(t.id, urlPath);
  }
  return page;
}

export function addThreadToPage(state: StoreState, thread: Thread): PageSnapshot {
  const page = getOrCreatePage(state, thread.urlPath);
  const threads = [...page.threads, thread];
  const updated = { ...page, threads };
  state.byPath.set(thread.urlPath, updated);
  state.threadIndex.set(thread.id, thread.urlPath);
  return updated;
}

export function removeThread(state: StoreState, threadId: ThreadId): PageSnapshot | null {
  const urlPath = state.threadIndex.get(threadId);
  if (!urlPath) return null;
  const page = state.byPath.get(urlPath);
  if (!page) return null;
  const threads = page.threads.filter(t => t.id !== threadId);
  const updated = { ...page, threads };
  state.byPath.set(urlPath, updated);
  state.threadIndex.delete(threadId);
  return updated;
}

export function updateThread(
  state: StoreState,
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
): PageSnapshot | null {
  const urlPath = state.threadIndex.get(threadId);
  if (!urlPath) return null;
  const page = state.byPath.get(urlPath);
  if (!page) return null;
  const threads = page.threads.map(t => (t.id === threadId ? updater(t) : t));
  const updated = { ...page, threads };
  state.byPath.set(urlPath, updated);
  return updated;
}

export function addCommentToThread(
  state: StoreState,
  threadId: ThreadId,
  comment: Comment,
): PageSnapshot | null {
  return updateThread(state, threadId, t => ({
    ...t,
    comments: [...t.comments, comment],
  }));
}

export function replaceThreadId(
  state: StoreState,
  tempId: ThreadId,
  serverId: ThreadId,
): void {
  const urlPath = state.threadIndex.get(tempId);
  if (!urlPath) return;
  state.threadIndex.delete(tempId);
  state.threadIndex.set(serverId, urlPath);
  const page = state.byPath.get(urlPath);
  if (!page) return;
  const threads = page.threads.map(t =>
    t.id === tempId ? { ...t, id: serverId, pending: false } : t,
  );
  state.byPath.set(urlPath, { ...page, threads });
}

export function replaceCommentId(
  state: StoreState,
  threadId: ThreadId,
  tempId: string,
  serverId: string,
): void {
  updateThread(state, threadId, t => ({
    ...t,
    comments: t.comments.map(c =>
      c.id === tempId ? { ...c, id: serverId, pending: false } : c,
    ),
  }));
}
