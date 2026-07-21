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
  // Drop stale index entries for this path before repopulating, so threads
  // removed since the last fetch don't linger in threadIndex (which would
  // leak memory and misroute later realtime lookups).
  for (const [id, p] of state.threadIndex) {
    if (p === urlPath) state.threadIndex.delete(id);
  }
  const page: PageSnapshot = { urlPath, threads, loading, error };
  state.byPath.set(urlPath, page);
  for (const t of threads) {
    state.threadIndex.set(t.id, urlPath);
  }
  return page;
}

export function addThreadToPage(state: StoreState, thread: Thread): PageSnapshot {
  const page = getOrCreatePage(state, thread.urlPath);
  // Idempotent: a Realtime echo of our own insert (or a redelivered event)
  // must not append a second copy. recentlyWritten suppresses this within its
  // TTL; this guard covers echoes that arrive after the TTL expires.
  if (page.threads.some(t => t.id === thread.id)) return page;
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

export function findThreadByCommentId(
  state: StoreState,
  commentId: string,
): { threadId: ThreadId; urlPath: UrlPath } | null {
  // Realtime DELETE payloads carry only the row's primary key, so the owning
  // thread_id is not available — locate the thread by scanning local pages.
  for (const [urlPath, page] of state.byPath) {
    for (const thread of page.threads) {
      if (thread.comments.some(c => c.id === commentId)) {
        return { threadId: thread.id, urlPath };
      }
    }
  }
  return null;
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
  const urlPath = state.threadIndex.get(threadId);
  if (!urlPath) return null;
  const page = state.byPath.get(urlPath);
  const existing = page?.threads.find(t => t.id === threadId);
  // Idempotent: skip if this comment id is already present (Realtime echo of
  // our own write arriving after the recentlyWritten TTL).
  if (existing?.comments.some(c => c.id === comment.id)) return null;
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
  const optimistic = page.threads.find(t => t.id === tempId);
  const serverThread = page.threads.find(t => t.id === serverId);
  let threads: Thread[];
  if (optimistic && serverThread) {
    // A page fetch can observe the server row before the mutation response
    // reaches us. Collapse that response with the optimistic row rather than
    // turning the temp-id reconciliation into two identical pins.
    const commentIds = new Set(serverThread.comments.map(c => c.id));
    const comments = [
      ...serverThread.comments,
      ...optimistic.comments.filter(c => !commentIds.has(c.id)),
    ].map(c => ({ ...c, threadId: serverId }));
    threads = page.threads
      .filter(t => t.id !== tempId && t.id !== serverId)
      .concat({ ...serverThread, comments, pending: false })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } else {
    threads = page.threads.map(t =>
      t.id === tempId
        ? {
            ...t,
            id: serverId,
            pending: false,
            comments: t.comments.map(c => ({ ...c, threadId: serverId })),
          }
        : t,
    );
  }
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
    comments: t.comments.some(c => c.id === serverId)
      ? t.comments
          .filter(c => c.id !== tempId)
          .map(c => ({ ...c, threadId }))
      : t.comments.map(c =>
          c.id === tempId
            ? { ...c, id: serverId, threadId, pending: false }
            : { ...c, threadId },
        ),
  }));
}
