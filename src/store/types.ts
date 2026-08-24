export type ProjectId = string;
export type ThreadId = string;
export type CommentId = string;
export type UserId = string;
export type UrlPath = string;
export type TempId = string;

export type ElementRef = {
  selector: string;
  fingerprint: string;
  /** Ancestor fingerprints, nearest first — tells identical controls apart. */
  context?: string[];
  /** Lower-cased tag name, for re-searching when the selector drifts. */
  tag?: string;
};

export type Pin = {
  selector: string;
  offsetX: number;
  offsetY: number;
  fingerprint: string;
  viewportWidth: number;
  /**
   * Per interactive-state segment, the control that opened it — recorded when
   * the comment was written, so reopening the thread can click that exact
   * control. Optional: pins written before this shipped simply don't have it.
   * See `src/overlay/anchoring/DOMAnchor.ts`.
   */
  stateTriggers?: Record<string, ElementRef>;
  /**
   * Absolute document coordinates for a comment left on empty space, where
   * there is no element to anchor to. Supersedes `offsetX`/`offsetY` when set.
   * See `src/overlay/anchoring/DOMAnchor.ts`.
   */
  page?: { x: number; y: number };
  /**
   * Selectors for the anchor's ancestors, nearest first. When the anchor itself
   * is gone — the host paginated, filtered or swapped the view — reveal falls
   * back to the nearest of these that still exists, so the thread can still be
   * read. See `src/overlay/anchoring/approximate.ts`.
   */
  ancestors?: string[];
  /**
   * What kind of thing was anchored — "button", "row" — to name it when it can't
   * be shown. A kind rather than the element's text, which would put page
   * content in the notice.
   */
  kind?: string;
  /**
   * Opaque snapshot of the host's own view state — which page of a list, which
   * filter, which scenario — from whatever it registered via `useNoddViewState`.
   * Replayed before reveal re-anchors. Nodd never interprets it.
   * See `src/provider/viewState/`.
   */
  viewState?: Record<string, unknown>;
};

export type Comment = {
  id: CommentId;
  threadId: ThreadId;
  authorId: UserId;
  body: string;
  mentions: UserId[];
  createdAt: string;
  editedAt: string | null;
  pending?: boolean;
  failed?: boolean;
};

export type Thread = {
  id: ThreadId;
  projectId: ProjectId;
  urlPath: string;
  /**
   * Prototype scope this thread belongs to (from `<NoddPrototype id>`), spanning
   * all of its screens/url_paths. Null for threads created before prototype
   * scoping shipped, or when the overlay is ungated — such threads are page-only
   * and never surface in the per-prototype inbox.
   */
  prototypeId: string | null;
  pin: Pin;
  stateKey: string;
  resolved: boolean;
  resolvedBy: UserId | null;
  resolvedAt: string | null;
  createdBy: UserId;
  createdAt: string;
  comments: Comment[];
  pending?: boolean;
  failed?: boolean;
};

export type PageSnapshot = {
  urlPath: string;
  threads: Thread[];
  loading: boolean;
  error: StoreError | null;
};

export type StoreError =
  | { kind: 'fetch-failed'; retryAt: number }
  | { kind: 'network-stale'; cachedAt: number }
  | { kind: 'realtime-disconnected'; since: number }
  | { kind: 'mutation-failed'; mutation: string; message: string }
  | { kind: 'members-stale'; fetchedAt: number | null }
  | { kind: 'unauthorised' };

export type MemberProfile = {
  userId: UserId;
  role: 'member' | 'admin';
  displayName: string | null;
  avatarUrl: string | null;
};

export type MemberCache = {
  byId: Map<UserId, MemberProfile>;
  list: MemberProfile[];
  fetchedAt: number;
};

export type PendingMutation =
  | { kind: 'addThread'; tempId: ThreadId; urlPath: string; prevSnapshot: Thread[] }
  | { kind: 'reply'; tempId: CommentId; threadId: ThreadId; prevComments: Comment[] }
  | { kind: 'resolve'; threadId: ThreadId; prevResolved: boolean }
  | { kind: 'reopen'; threadId: ThreadId; prevResolved: boolean };

export type StoreState = {
  byPath: Map<UrlPath, PageSnapshot>;
  threadIndex: Map<ThreadId, UrlPath>;
  pending: Map<TempId, PendingMutation>;
};
