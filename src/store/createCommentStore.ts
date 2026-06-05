import { SupabaseClient } from '@supabase/supabase-js';
import type {
  Thread, Comment, Pin, UserId, ThreadId, CommentId,
  PageSnapshot, MemberCache, StoreState, UrlPath,
} from './types';
import {
  createInitialState, getOrCreatePage, setPageThreads,
  addThreadToPage, updateThread, addCommentToThread,
  replaceThreadId, replaceCommentId, removeThread,
} from './state';
import { readCache, writeCache } from './cache';
import { fetchPageThreads, fetchResolvedThreads } from './query';
import { fetchMembers } from './members';
import { createRealtimeChannel } from './realtime';
import { insertThread, insertComment, updateThreadResolved, deleteThread, deleteComment } from './mutations';

export type CommentStore = {
  subscribe(urlPath: string, listener: (snapshot: PageSnapshot) => void): () => void;
  addThread(input: { urlPath: string; pin: Pin; stateKey?: string; body: string; mentions?: UserId[] }): Promise<ThreadId>;
  replyToThread(input: { threadId: ThreadId; body: string; mentions?: UserId[] }): Promise<CommentId>;
  resolveThread(threadId: ThreadId): Promise<void>;
  reopenThread(threadId: ThreadId): Promise<void>;
  deleteThread(threadId: ThreadId): Promise<void>;
  deleteComment(input: { threadId: ThreadId; commentId: CommentId }): Promise<void>;
  getMembers(): MemberCache | null;
  fetchResolved(urlPath: string): Promise<Thread[]>;
  dispose(): void;
};

function tempId(): string {
  return `temp-${crypto.randomUUID()}`;
}

export function createCommentStore(deps: {
  supabase: SupabaseClient;
  projectId: string;
  getCurrentUserId: () => string | null;
}): CommentStore {
  const { supabase, projectId, getCurrentUserId } = deps;
  const state: StoreState = createInitialState();
  const listeners = new Map<UrlPath, Set<(snapshot: PageSnapshot) => void>>();
  const recentlyWritten = new Set<string>();
  let memberCache: MemberCache | null = null;
  let disposed = false;

  // Prefetch members, retrying transient failures. Without a retry a single
  // failed fetch would leave every author rendered as "Unknown" for the whole
  // session. notifyAll() on success re-renders subscribed pages so names that
  // arrive after the first paint fill in.
  let memberFetchAttempts = 0;
  function loadMembers() {
    fetchMembers(supabase, projectId)
      .then(cache => {
        if (disposed) return;
        memberCache = cache;
        notifyAll();
      })
      .catch(() => {
        if (disposed || memberFetchAttempts >= 3) return;
        memberFetchAttempts++;
        setTimeout(loadMembers, 1000 * memberFetchAttempts);
      });
  }
  loadMembers();

  function notify(urlPath: UrlPath) {
    const page = state.byPath.get(urlPath);
    if (!page) return;
    const subs = listeners.get(urlPath);
    if (!subs) return;
    for (const cb of subs) cb(page);
  }

  function notifyAll() {
    for (const urlPath of listeners.keys()) {
      notify(urlPath);
    }
  }

  // Realtime
  const channel = createRealtimeChannel(supabase, projectId, {
    onThreadChange(payload) {
      if (disposed) return;
      const urlPath = (payload.new?.url_path ?? payload.old?.url_path) as string;
      if (!state.byPath.has(urlPath)) return;

      if (payload.eventType === 'INSERT') {
        if (recentlyWritten.has(payload.new.id)) return;
        const thread: Thread = {
          id: payload.new.id,
          projectId: payload.new.project_id,
          urlPath: payload.new.url_path,
          pin: payload.new.pin,
          stateKey: payload.new.state_key ?? '',
          resolved: payload.new.resolved,
          resolvedBy: payload.new.resolved_by,
          resolvedAt: payload.new.resolved_at,
          createdBy: payload.new.created_by,
          createdAt: payload.new.created_at,
          comments: [],
        };
        addThreadToPage(state, thread);
        notify(urlPath);
      } else if (payload.eventType === 'UPDATE') {
        updateThread(state, payload.new.id, t => ({
          ...t,
          resolved: payload.new.resolved,
          resolvedBy: payload.new.resolved_by,
          resolvedAt: payload.new.resolved_at,
        }));
        // If resolved, remove from default snapshot
        if (payload.new.resolved) {
          removeThread(state, payload.new.id);
        }
        notify(urlPath);
      } else if (payload.eventType === 'DELETE') {
        removeThread(state, payload.old.id);
        notify(urlPath);
      }
    },
    onCommentChange(payload) {
      if (disposed) return;
      if (payload.eventType === 'INSERT') {
        if (recentlyWritten.has(payload.new.id)) return;
        const threadId = payload.new.thread_id;
        const comment: Comment = {
          id: payload.new.id,
          threadId,
          authorId: payload.new.author_id,
          body: payload.new.body,
          mentions: payload.new.mentions ?? [],
          createdAt: payload.new.created_at,
          editedAt: payload.new.edited_at,
        };
        const result = addCommentToThread(state, threadId, comment);
        if (result) notify(result.urlPath);
      } else if (payload.eventType === 'UPDATE') {
        const threadId = payload.new.thread_id;
        const urlPath = state.threadIndex.get(threadId);
        if (!urlPath) return;
        updateThread(state, threadId, t => ({
          ...t,
          comments: t.comments.map(c =>
            c.id === payload.new.id
              ? { ...c, body: payload.new.body, editedAt: payload.new.edited_at }
              : c,
          ),
        }));
        notify(urlPath);
      } else if (payload.eventType === 'DELETE') {
        const threadId = payload.old.thread_id;
        const urlPath = state.threadIndex.get(threadId);
        if (!urlPath) return;
        updateThread(state, threadId, t => ({
          ...t,
          comments: t.comments.filter(c => c.id !== payload.old.id),
        }));
        notify(urlPath);
      }
    },
    onError() {
      if (disposed) return;
      for (const [urlPath, page] of state.byPath) {
        state.byPath.set(urlPath, {
          ...page,
          error: { kind: 'realtime-disconnected', since: Date.now() },
        });
      }
      notifyAll();
    },
  });

  function markRecentlyWritten(id: string) {
    recentlyWritten.add(id);
    setTimeout(() => recentlyWritten.delete(id), 5000);
  }

  const store: CommentStore = {
    subscribe(urlPath, listener) {
      if (!listeners.has(urlPath)) {
        listeners.set(urlPath, new Set());
      }
      listeners.get(urlPath)!.add(listener);

      // Hydrate from cache, then fetch
      const page = getOrCreatePage(state, urlPath);
      listener(page);

      (async () => {
        // Try cache first
        const cached = await readCache(projectId, urlPath);
        if (cached) {
          setPageThreads(state, urlPath, cached, true, null);
          notify(urlPath);
        }

        // Fetch from network
        try {
          const threads = await fetchPageThreads(supabase, projectId, urlPath);
          // Preserve pending optimistic mutations
          const pendingThreads = (state.byPath.get(urlPath)?.threads ?? []).filter(t => t.pending);
          const merged = [...threads, ...pendingThreads];
          setPageThreads(state, urlPath, merged, false, null);
          notify(urlPath);
          void writeCache(projectId, urlPath, threads);
        } catch {
          const existing = state.byPath.get(urlPath);
          if (existing && existing.threads.length > 0) {
            setPageThreads(state, urlPath, existing.threads, false, {
              kind: 'network-stale',
              cachedAt: Date.now(),
            });
          } else {
            setPageThreads(state, urlPath, [], false, {
              kind: 'fetch-failed',
              retryAt: Date.now() + 5000,
            });
          }
          notify(urlPath);
        }
      })();

      return () => {
        listeners.get(urlPath)?.delete(listener);
        if (listeners.get(urlPath)?.size === 0) {
          listeners.delete(urlPath);
        }
      };
    },

    async addThread(input) {
      const userId = getCurrentUserId();
      if (!userId) throw new Error('Not authenticated');

      const tid = tempId();
      const cid = tempId();
      const now = new Date().toISOString();

      const stateKey = input.stateKey ?? '';
      const thread: Thread = {
        id: tid,
        projectId,
        urlPath: input.urlPath,
        pin: input.pin,
        stateKey,
        resolved: false,
        resolvedBy: null,
        resolvedAt: null,
        createdBy: userId,
        createdAt: now,
        comments: [{
          id: cid,
          threadId: tid,
          authorId: userId,
          body: input.body,
          mentions: input.mentions ?? [],
          createdAt: now,
          editedAt: null,
          pending: true,
        }],
        pending: true,
      };

      addThreadToPage(state, thread);
      notify(input.urlPath);

      try {
        const result = await insertThread(supabase, {
          projectId,
          urlPath: input.urlPath,
          pin: input.pin,
          stateKey,
          body: input.body,
          mentions: input.mentions ?? [],
          createdBy: userId,
        });
        markRecentlyWritten(result.threadId);
        markRecentlyWritten(result.commentId);
        replaceThreadId(state, tid, result.threadId);
        replaceCommentId(state, result.threadId, cid, result.commentId);
        notify(input.urlPath);
        return result.threadId;
      } catch (err) {
        removeThread(state, tid);
        notify(input.urlPath);
        throw err;
      }
    },

    async replyToThread(input) {
      const userId = getCurrentUserId();
      if (!userId) throw new Error('Not authenticated');

      const cid = tempId();
      const now = new Date().toISOString();

      const comment: Comment = {
        id: cid,
        threadId: input.threadId,
        authorId: userId,
        body: input.body,
        mentions: input.mentions ?? [],
        createdAt: now,
        editedAt: null,
        pending: true,
      };

      addCommentToThread(state, input.threadId, comment);
      const urlPath = state.threadIndex.get(input.threadId);
      if (urlPath) notify(urlPath);

      try {
        const serverId = await insertComment(supabase, {
          threadId: input.threadId,
          body: input.body,
          mentions: input.mentions ?? [],
          authorId: userId,
        });
        markRecentlyWritten(serverId);
        replaceCommentId(state, input.threadId, cid, serverId);
        if (urlPath) notify(urlPath);
        return serverId;
      } catch (err) {
        // Rollback: remove the optimistic comment
        updateThread(state, input.threadId, t => ({
          ...t,
          comments: t.comments.filter(c => c.id !== cid),
        }));
        if (urlPath) notify(urlPath);
        throw err;
      }
    },

    async resolveThread(threadId) {
      const userId = getCurrentUserId();
      if (!userId) throw new Error('Not authenticated');
      const urlPath = state.threadIndex.get(threadId);

      updateThread(state, threadId, t => ({
        ...t,
        resolved: true,
        resolvedBy: userId,
        resolvedAt: new Date().toISOString(),
      }));
      if (urlPath) notify(urlPath);

      try {
        await updateThreadResolved(supabase, threadId, true, userId);
        // Remove from default snapshot (resolved threads)
        removeThread(state, threadId);
        if (urlPath) notify(urlPath);
      } catch {
        updateThread(state, threadId, t => ({
          ...t,
          resolved: false,
          resolvedBy: null,
          resolvedAt: null,
        }));
        if (urlPath) notify(urlPath);
      }
    },

    async reopenThread(threadId) {
      const userId = getCurrentUserId();
      if (!userId) throw new Error('Not authenticated');
      const urlPath = state.threadIndex.get(threadId);

      updateThread(state, threadId, t => ({
        ...t,
        resolved: false,
        resolvedBy: null,
        resolvedAt: null,
      }));
      if (urlPath) notify(urlPath);

      try {
        await updateThreadResolved(supabase, threadId, false, userId);
      } catch {
        updateThread(state, threadId, t => ({
          ...t,
          resolved: true,
          resolvedBy: userId,
          resolvedAt: new Date().toISOString(),
        }));
        if (urlPath) notify(urlPath);
      }
    },

    async deleteThread(threadId) {
      const userId = getCurrentUserId();
      if (!userId) throw new Error('Not authenticated');
      const urlPath = state.threadIndex.get(threadId);
      // Snapshot for rollback before the optimistic removal.
      const removed = urlPath
        ? state.byPath.get(urlPath)?.threads.find(t => t.id === threadId) ?? null
        : null;

      removeThread(state, threadId);
      if (urlPath) notify(urlPath);

      // Optimistic-only for temp threads not yet persisted server-side.
      if (threadId.startsWith('temp-')) return;

      try {
        await deleteThread(supabase, threadId);
      } catch (err) {
        if (removed) {
          addThreadToPage(state, removed);
          if (urlPath) notify(urlPath);
        }
        throw err;
      }
    },

    async deleteComment(input) {
      const userId = getCurrentUserId();
      if (!userId) throw new Error('Not authenticated');
      const { threadId, commentId } = input;
      const urlPath = state.threadIndex.get(threadId);
      const thread = urlPath
        ? state.byPath.get(urlPath)?.threads.find(t => t.id === threadId) ?? null
        : null;

      // The root comment is the thread — deleting it deletes the whole thread.
      if (thread && thread.comments[0]?.id === commentId) {
        await store.deleteThread(threadId);
        return;
      }

      const removed = thread?.comments.find(c => c.id === commentId) ?? null;
      updateThread(state, threadId, t => ({
        ...t,
        comments: t.comments.filter(c => c.id !== commentId),
      }));
      if (urlPath) notify(urlPath);

      if (commentId.startsWith('temp-')) return;

      try {
        await deleteComment(supabase, commentId);
      } catch (err) {
        // Restore the comment at its original position.
        if (removed && thread) {
          const index = thread.comments.findIndex(c => c.id === commentId);
          updateThread(state, threadId, t => {
            const comments = t.comments.slice();
            comments.splice(Math.max(0, index), 0, removed);
            return { ...t, comments };
          });
          if (urlPath) notify(urlPath);
        }
        throw err;
      }
    },

    getMembers() {
      return memberCache;
    },

    async fetchResolved(urlPath) {
      return fetchResolvedThreads(supabase, projectId, urlPath);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      supabase.removeChannel(channel);
      listeners.clear();
    },
  };

  return store;
}
