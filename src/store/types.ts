export type ProjectId = string;
export type ThreadId = string;
export type CommentId = string;
export type UserId = string;
export type UrlPath = string;
export type TempId = string;

export type Pin = {
  selector: string;
  offsetX: number;
  offsetY: number;
  fingerprint: string;
  viewportWidth: number;
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
  email: string;
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
