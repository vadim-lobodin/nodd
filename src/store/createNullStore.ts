import type { CommentStore } from './createCommentStore';
import type { MemberCache, PageSnapshot, Thread } from './types';

/**
 * A `CommentStore` with no backend behind it: every page is empty and settled,
 * every mutation refuses. Used when the provider runs with comments off — no
 * Supabase credentials were given, or the backend turned out to be unreachable
 * (see `provider/backend.ts`).
 *
 * The point is that `OverlayRenderer` keeps one code path. The variants panel,
 * `<NoddState>` and view state are client-side features that owe nothing to the
 * network, so they stay live while the comment chrome hides itself; without a
 * stand-in store every `store.*` call site would need its own null check, and
 * the one that got missed would throw inside a prototype.
 *
 * Mutations reject rather than resolving quietly — nothing should be able to
 * call them (the chrome that would is unmounted), and a silent success would be
 * a comment the author believes was saved.
 */
export function createNullStore(): CommentStore {
  const empty = (urlPath: string): PageSnapshot => ({
    urlPath,
    threads: [],
    loading: false,
    error: null,
  });

  const refuse = (mutation: string) => (): Promise<never> =>
    Promise.reject(new Error(`nodd: ${mutation} is unavailable while comments are off`));

  return {
    subscribe(urlPath, listener) {
      listener(empty(urlPath));
      return () => {};
    },
    addThread: refuse('addThread'),
    replyToThread: refuse('replyToThread'),
    resolveThread: refuse('resolveThread'),
    reopenThread: refuse('reopenThread'),
    deleteThread: refuse('deleteThread'),
    deleteComment: refuse('deleteComment'),
    getMembers(): MemberCache | null {
      return null;
    },
    async fetchResolved(): Promise<Thread[]> {
      return [];
    },
    async fetchPrototypeThreads(): Promise<Thread[]> {
      return [];
    },
    dispose() {},
  };
}
