import React, { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { OverlayRenderer } from '../overlay';
import { DOMAnchor } from '../overlay/anchoring/DOMAnchor';
import { NoddContext, type NoddContextValue } from '../provider/NoddContext';
import { createVariantRegistry, type VariantRegistry, Variant } from '../provider/variants';
import { createPrototypeRegistry, type PrototypeRegistry } from '../provider/scope';
import type { AuthClient, CurrentUser } from '../auth';
import type {
  CommentStore,
} from '../store';
import type {
  Thread, PageSnapshot, MemberCache, MemberProfile, Pin,
} from '../store/types';

/**
 * Full commenting/panel UX playground. Wires the real `OverlayRenderer` against
 * an in-memory store + mock auth — no Supabase — so the whole flow can be
 * exercised: drop pins (press "C"), reply, resolve, delete, the sidebar,
 * the variants panel, the settings menu, hide-for-session, and every auth
 * state (logged-out / legacy name prompt / signed-in). Public-reads is
 * simulated: when logged out, comments are visible+read-only only if enabled.
 */

// ---------------------------------------------------------------------------
// In-memory CommentStore — synchronous, optimistic-by-construction. Extra
// methods (setReadable / setCurrentUserId / seed) let the harness drive it.
// ---------------------------------------------------------------------------
type MemoryStore = CommentStore & {
  setReadable(v: boolean): void;
  setCurrentUserId(id: string | null): void;
  seed(input: { urlPath: string; pin: Pin; authorId: string; body: string }): void;
};

function createMemoryStore(): MemoryStore {
  let threads: Thread[] = [];
  let readable = false;
  let currentUserId: string | null = null;
  const listeners = new Map<string, Set<(s: PageSnapshot) => void>>();

  const members: MemberProfile[] = [
    { userId: 'me', role: 'admin', email: 'you@example.com', displayName: 'You', avatarUrl: null },
    { userId: 'alice', role: 'member', email: 'alice@example.com', displayName: 'Alice Chen', avatarUrl: null },
  ];
  const memberCache: MemberCache = {
    byId: new Map(members.map(m => [m.userId, m])),
    list: members,
    fetchedAt: Date.now(),
  };

  const now = () => new Date().toISOString();
  const uid = () => crypto.randomUUID();
  const snap = (urlPath: string): PageSnapshot => ({
    urlPath,
    threads: readable ? threads.filter(t => t.urlPath === urlPath && !t.resolved) : [],
    loading: false,
    error: null,
  });
  const notify = (urlPath: string) => {
    for (const cb of listeners.get(urlPath) ?? []) cb(snap(urlPath));
  };
  const notifyAll = () => { for (const p of listeners.keys()) notify(p); };

  return {
    subscribe(urlPath, listener) {
      if (!listeners.has(urlPath)) listeners.set(urlPath, new Set());
      listeners.get(urlPath)!.add(listener);
      listener(snap(urlPath));
      return () => { listeners.get(urlPath)?.delete(listener); };
    },
    async addThread(input) {
      if (!currentUserId) throw new Error('Not authenticated');
      const tid = uid(), cid = uid(), ts = now();
      threads = [...threads, {
        id: tid, projectId: 'playground', urlPath: input.urlPath, prototypeId: input.prototypeId ?? null, pin: input.pin,
        stateKey: input.stateKey ?? '', resolved: false, resolvedBy: null, resolvedAt: null,
        createdBy: currentUserId, createdAt: ts,
        comments: [{ id: cid, threadId: tid, authorId: currentUserId, body: input.body, mentions: input.mentions ?? [], createdAt: ts, editedAt: null }],
      }];
      notify(input.urlPath);
      return tid;
    },
    async replyToThread(input) {
      if (!currentUserId) throw new Error('Not authenticated');
      const cid = uid(), ts = now();
      let path = '/';
      threads = threads.map(t => {
        if (t.id !== input.threadId) return t;
        path = t.urlPath;
        return { ...t, comments: [...t.comments, { id: cid, threadId: t.id, authorId: currentUserId!, body: input.body, mentions: input.mentions ?? [], createdAt: ts, editedAt: null }] };
      });
      notify(path);
      return cid;
    },
    async resolveThread(threadId) {
      let path = '/';
      threads = threads.map(t => { if (t.id === threadId) { path = t.urlPath; return { ...t, resolved: true, resolvedBy: currentUserId, resolvedAt: now() }; } return t; });
      notify(path);
    },
    async reopenThread(threadId) {
      let path = '/';
      threads = threads.map(t => { if (t.id === threadId) { path = t.urlPath; return { ...t, resolved: false, resolvedBy: null, resolvedAt: null }; } return t; });
      notify(path);
    },
    async deleteThread(threadId) {
      const t = threads.find(x => x.id === threadId);
      threads = threads.filter(x => x.id !== threadId);
      if (t) notify(t.urlPath);
    },
    async deleteComment({ threadId, commentId }) {
      let path = '/';
      let dropThread = false;
      threads = threads.map(t => {
        if (t.id !== threadId) return t;
        path = t.urlPath;
        if (t.comments[0]?.id === commentId) { dropThread = true; return t; }
        return { ...t, comments: t.comments.filter(c => c.id !== commentId) };
      });
      if (dropThread) threads = threads.filter(t => t.id !== threadId);
      notify(path);
    },
    getMembers() { return memberCache; },
    async fetchResolved(urlPath) { return threads.filter(t => t.urlPath === urlPath && t.resolved); },
    async fetchPrototypeThreads(prototypeId, opts) {
      const resolved = opts?.resolved ?? false;
      return threads.filter(t => t.prototypeId === prototypeId && t.resolved === resolved);
    },
    dispose() { listeners.clear(); threads = []; },
    setReadable(v) { readable = v; notifyAll(); },
    setCurrentUserId(id) { currentUserId = id; },
    seed({ urlPath, pin, authorId, body }) {
      const tid = uid(), cid = uid(), ts = now();
      threads = [...threads, {
        id: tid, projectId: 'playground', urlPath, prototypeId: null, pin, stateKey: '', resolved: false,
        resolvedBy: null, resolvedAt: null, createdBy: authorId, createdAt: ts,
        comments: [{ id: cid, threadId: tid, authorId, body, mentions: [], createdAt: ts, editedAt: null }],
      }];
      notifyAll();
    },
  };
}

// ---------------------------------------------------------------------------
// Host page — normal-flow content with anchorable elements + a <Variant> block
// so the variants panel has something to switch.
// ---------------------------------------------------------------------------
function PlaygroundPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif', color: '#111' }}>
      <h1 data-pin-seed style={{ fontSize: 28, margin: '0 0 8px' }}>Checkout</h1>
      <p style={{ color: '#555', margin: '0 0 24px' }}>
        A live host page. Press <kbd>C</kbd> and click anywhere to leave a comment,
        <kbd>V</kbd> for variants, <kbd>M</kbd> for the comments sidebar (signed in).
      </p>

      <Variant
        name="Hero"
        label="Hero layout"
        options={{
          Minimal: (
            <section style={{ padding: 20, border: '1px solid #e5e5e5', borderRadius: 12, marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Minimal hero</h2>
              <p style={{ color: '#666' }}>A calm, text-first header.</p>
            </section>
          ),
          Bold: (
            <section style={{ padding: 32, background: 'linear-gradient(135deg,#6366f1,#0891b2)', color: '#fff', borderRadius: 12, marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Bold hero</h2>
              <p style={{ opacity: 0.9 }}>A punchy, colorful header.</p>
            </section>
          ),
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ padding: 20, border: '1px solid #e5e5e5', borderRadius: 12 }}>
          <h3 style={{ marginTop: 0 }}>Order summary</h3>
          <p style={{ color: '#666' }}>3 items · $128.00</p>
          <button style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#111', color: '#fff' }}>
            Pay now
          </button>
        </div>
        <div style={{ padding: 20, border: '1px solid #e5e5e5', borderRadius: 12 }}>
          <h3 data-pin-seed-own style={{ marginTop: 0 }}>Shipping</h3>
          <p style={{ color: '#666' }}>Standard · 3–5 business days</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Harness — provides a real NoddContext around the real OverlayRenderer.
// ---------------------------------------------------------------------------
type PlaygroundArgs = {
  authState: 'logged-out' | 'needs-name' | 'signed-in';
  allowPublicReads: boolean;
  theme: 'light' | 'dark' | 'system';
  seeded: boolean;
};

function userFor(state: PlaygroundArgs['authState']): CurrentUser | null {
  if (state === 'logged-out') return null;
  return { id: 'me', email: 'you@example.com', displayName: state === 'signed-in' ? 'You' : null, avatarUrl: null };
}

function Harness(args: PlaygroundArgs) {
  const projectId = 'playground';
  const [user, setUser] = useState<CurrentUser | null>(() => userFor(args.authState));
  const [hasName, setHasName] = useState(() => args.authState === 'signed-in');
  const [isVisible, setIsVisible] = useState(true);
  const [pinEl, setPinEl] = useState<HTMLElement | null>(null);

  const storeRef = useRef<MemoryStore | null>(null);
  const variantsRef = useRef<VariantRegistry | null>(null);
  const prototypesRef = useRef<PrototypeRegistry | null>(null);
  const seededRef = useRef(false);
  if (!storeRef.current) storeRef.current = createMemoryStore();
  if (!variantsRef.current) variantsRef.current = createVariantRegistry({ projectId });
  if (!prototypesRef.current) prototypesRef.current = createPrototypeRegistry();
  const store = storeRef.current;
  const variants = variantsRef.current;
  const prototypes = prototypesRef.current;

  const resolvedTheme = args.theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : args.theme;

  // Body-attached portals, mirroring NoddProvider (fixed root + absolute pins).
  useEffect(() => {
    const pins = document.createElement('div');
    pins.id = 'nodd-pins';
    pins.setAttribute('data-nodd-pin-container', '');
    pins.setAttribute('data-nodd-root', '');
    document.body.appendChild(pins);
    const root = document.createElement('div');
    root.id = 'nodd-root';
    root.setAttribute('data-nodd-root', '');
    document.body.appendChild(root);
    setPinEl(pins);
    return () => {
      document.body.removeChild(pins);
      document.body.removeChild(root);
    };
  }, []);

  useEffect(() => {
    document.getElementById('nodd-root')?.setAttribute('data-nodd-theme', resolvedTheme);
    document.getElementById('nodd-pins')?.setAttribute('data-nodd-theme', resolvedTheme);
  }, [resolvedTheme, pinEl]);

  // Re-sync auth when the Storybook control changes.
  useEffect(() => {
    const u = userFor(args.authState);
    setUser(u);
    setHasName(args.authState === 'signed-in');
    store.setCurrentUserId(u?.id ?? null);
  }, [args.authState, store]);

  // Simulated RLS: logged-out viewers read only when public reads are on.
  const readable = user != null || args.allowPublicReads;
  useEffect(() => { store.setReadable(readable); }, [readable, store]);

  // Seed comments against real elements (built via DOMAnchor so they resolve).
  // SignedIn also gets an own comment so delete UX is always testable.
  useEffect(() => {
    if (!pinEl || seededRef.current) return;
    if (!args.seeded) return;
    const el = document.querySelector('[data-pin-seed]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pin = DOMAnchor.create(el, r.left + r.width * 0.4, r.top + r.height * 0.5);
    store.seed({ urlPath: '/', pin, authorId: 'alice', body: 'Can we tighten the spacing under this heading?' });

    if (args.authState === 'signed-in') {
      const ownEl = document.querySelector('[data-pin-seed-own]');
      if (ownEl) {
        const ownRect = ownEl.getBoundingClientRect();
        const ownPin = DOMAnchor.create(
          ownEl,
          ownRect.left + ownRect.width * 0.6,
          ownRect.top + ownRect.height * 0.5,
        );
        store.seed({
          urlPath: '/',
          pin: ownPin,
          authorId: 'me',
          body: 'Can we make the delivery estimate more prominent?',
        });
      }
    }
    seededRef.current = true;
  }, [args.authState, args.seeded, pinEl, store]);

  const auth = {
    get needsDisplayName() { return user != null && !hasName; },
    get currentUser() { return user; },
    setDisplayName: async (name: string) => {
      setHasName(true);
      setUser(u => (u ? { ...u, displayName: name } : u));
    },
  } as unknown as AuthClient;

  const ctx: NoddContextValue = {
    projectId,
    user,
    signIn: async (email: string, displayName?: string) => {
      // No email round-trip in the playground: the combined form immediately
      // creates the signed-in viewer. Missing names still exercise the legacy fallback.
      const name = displayName?.trim() || null;
      setUser({ id: 'me', email, displayName: name, avatarUrl: null });
      setHasName(name !== null);
      store.setCurrentUserId('me');
    },
    signOut: async () => {
      setUser(null);
      setHasName(false);
      store.setCurrentUserId(null);
    },
    isVisible,
    toggleOverlay: () => setIsVisible(v => !v),
    setVisible: setIsVisible,
    hideForSession: () => setIsVisible(false),
    theme: args.theme,
    setTheme: () => {},
    urlPath: '/',
    auth,
    writeStatus: 'ready',
    retryOnboarding: () => {},
    store,
    variants,
    prototypes,
    activePrototype: null,
    pinContainer: pinEl,
  };

  return (
    <NoddContext.Provider value={ctx}>
      <PlaygroundPage />
      {isVisible && pinEl ? <OverlayRenderer /> : null}
      {!isVisible && (
        <button
          onClick={() => setIsVisible(true)}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 20,
            padding: '8px 16px', borderRadius: 999, border: 'none',
            background: '#111', color: '#fff', cursor: 'pointer',
          }}
        >
          Show Nodd overlay
        </button>
      )}
    </NoddContext.Provider>
  );
}

const meta: Meta<PlaygroundArgs> = {
  title: 'Nodd/Playground',
  render: args => <Harness {...args} />,
  argTypes: {
    authState: {
      control: 'inline-radio',
      options: ['logged-out', 'needs-name', 'signed-in'],
      description: 'Simulated auth state',
    },
    allowPublicReads: { control: 'boolean', description: 'Let logged-out viewers read comments (read-only)' },
    theme: { control: 'inline-radio', options: ['light', 'dark', 'system'] },
    seeded: { control: 'boolean', description: 'Start with a seeded comment' },
  },
  args: {
    authState: 'signed-in',
    allowPublicReads: false,
    theme: 'light',
    seeded: true,
  },
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<PlaygroundArgs>;

/** Signed in — full commenting: press C to drop a pin, reply, resolve, delete. */
export const SignedIn: Story = {};

/** Logged out with public reads ON — pins are visible and read-only; C prompts sign-in. */
export const LoggedOutPublicReads: Story = {
  args: { authState: 'logged-out', allowPublicReads: true },
};

/** Logged out with public reads OFF — no comments visible; C prompts sign-in. */
export const LoggedOutPrivate: Story = {
  args: { authState: 'logged-out', allowPublicReads: false },
};

/** Legacy account: signed in but still missing display-name metadata. */
export const NeedsName: Story = {
  args: { authState: 'needs-name' },
};
