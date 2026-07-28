import React, { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { OverlayRenderer } from '../overlay';
import { NoddContext, type NoddContextValue } from '../provider/NoddContext';
import { createVariantRegistry, type VariantRegistry } from '../provider/variants';
import { createPrototypeRegistry, type PrototypeRegistry } from '../provider/scope';
import type { AuthClient, CurrentUser } from '../auth';
import type { CommentStore } from '../store';
import type { Thread, PageSnapshot, MemberCache, MemberProfile } from '../store/types';

/**
 * Auto-detected interactive states — exercise `autoState.ts` end-to-end.
 *
 * The page holds a standard Radix Dialog and Dropdown Menu, neither wrapped in
 * `<NoddState>`. Steps to verify:
 *   1. Open the dialog (or menu), press "C", and drop a comment on an element
 *      inside it. The comment is scoped to a synthesized `auto:dialog:<name>`
 *      (or `auto:menu:<name>`) segment — check the sidebar breadcrumb.
 *   2. Close the overlay. The pin disappears from the base page instead of
 *      floating over it (capture-scoping — the whole point).
 *   3. Reopen the thread from the comments sidebar. `revealThread` finds the
 *      overlay's ARIA trigger (`aria-haspopup` + `aria-expanded="false"`),
 *      clicks it to reopen the overlay, re-anchors, and scrolls the pin in.
 *
 * Radix primitives emit exactly the ARIA the detector keys on: the content gets
 * `role="dialog"|"menu"` + `data-state="open"`, and the trigger advertises
 * `aria-haspopup` + `aria-expanded`. No host instrumentation required.
 */

// ---------------------------------------------------------------------------
// Minimal in-memory CommentStore (synchronous, optimistic-by-construction).
// ---------------------------------------------------------------------------
function createMemoryStore(): CommentStore {
  let threads: Thread[] = [];
  const listeners = new Map<string, Set<(s: PageSnapshot) => void>>();

  const members: MemberProfile[] = [
    { userId: 'me', role: 'admin', displayName: 'You', avatarUrl: null },
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
    threads: threads.filter(t => t.urlPath === urlPath && !t.resolved),
    loading: false,
    error: null,
  });
  const notify = (urlPath: string) => {
    for (const cb of listeners.get(urlPath) ?? []) cb(snap(urlPath));
  };

  return {
    subscribe(urlPath, listener) {
      if (!listeners.has(urlPath)) listeners.set(urlPath, new Set());
      listeners.get(urlPath)!.add(listener);
      listener(snap(urlPath));
      return () => { listeners.get(urlPath)?.delete(listener); };
    },
    async addThread(input) {
      const tid = uid(), cid = uid(), ts = now();
      threads = [...threads, {
        id: tid, projectId: 'auto', urlPath: input.urlPath, prototypeId: input.prototypeId ?? null,
        pin: input.pin, stateKey: input.stateKey ?? '', resolved: false, resolvedBy: null, resolvedAt: null,
        createdBy: 'me', createdAt: ts,
        comments: [{ id: cid, threadId: tid, authorId: 'me', body: input.body, mentions: input.mentions ?? [], createdAt: ts, editedAt: null }],
      }];
      notify(input.urlPath);
      return tid;
    },
    async replyToThread(input) {
      const cid = uid(), ts = now();
      let path = '/';
      threads = threads.map(t => {
        if (t.id !== input.threadId) return t;
        path = t.urlPath;
        return { ...t, comments: [...t.comments, { id: cid, threadId: t.id, authorId: 'me', body: input.body, mentions: input.mentions ?? [], createdAt: ts, editedAt: null }] };
      });
      notify(path);
      return cid;
    },
    async resolveThread(threadId) {
      let path = '/';
      threads = threads.map(t => { if (t.id === threadId) { path = t.urlPath; return { ...t, resolved: true, resolvedBy: 'me', resolvedAt: now() }; } return t; });
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
  };
}

// ---------------------------------------------------------------------------
// Host page — a Radix Dialog + Dropdown Menu, both un-instrumented.
// ---------------------------------------------------------------------------
function AutoStatePage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif', color: '#111' }}>
      <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>Auto-detected states</h1>
      <p style={{ color: '#555', margin: '0 0 24px' }}>
        Open an overlay, press <kbd>C</kbd>, and drop a comment on something inside
        it. Close it — the pin hides instead of bleeding onto the page. Reopen the
        thread from the sidebar (<kbd>M</kbd>) to see auto-restore reopen the overlay.
      </p>

      <div style={{ display: 'flex', gap: 12 }}>
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <button style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#111', color: '#fff' }}>
              Open Settings dialog
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
            <Dialog.Content
              style={{
                position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                width: 380, padding: 24, borderRadius: 12, background: '#fff',
                boxShadow: '0 24px 48px -12px rgba(0,0,0,0.3)',
              }}
            >
              <Dialog.Title style={{ margin: '0 0 12px', fontSize: 18 }}>Settings</Dialog.Title>
              <p style={{ color: '#555', margin: '0 0 16px' }}>
                A comment left on the field below is scoped to <code>auto:dialog:settings</code>.
              </p>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>Display name</label>
              <input
                defaultValue="Ada Lovelace"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
              />
              <div style={{ marginTop: 20, textAlign: 'right' }}>
                <Dialog.Close asChild>
                  <button style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff' }}>
                    Close
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff' }}>
              Open Actions menu
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              aria-label="Actions"
              sideOffset={6}
              style={{ minWidth: 180, padding: 6, borderRadius: 10, background: '#fff', boxShadow: '0 12px 32px -8px rgba(0,0,0,0.2)' }}
            >
              <DropdownMenu.Item style={{ padding: '8px 10px', borderRadius: 6, outline: 'none' }}>Duplicate</DropdownMenu.Item>
              <DropdownMenu.Item style={{ padding: '8px 10px', borderRadius: 6, outline: 'none' }}>Archive</DropdownMenu.Item>
              <DropdownMenu.Item style={{ padding: '8px 10px', borderRadius: 6, outline: 'none' }}>Delete</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Harness — a real NoddContext around the real OverlayRenderer, signed in.
// ---------------------------------------------------------------------------
type AutoStateArgs = { theme: 'light' | 'dark' | 'system' };

function Harness(args: AutoStateArgs) {
  const projectId = 'auto';
  const [isVisible, setIsVisible] = useState(true);
  const [pinEl, setPinEl] = useState<HTMLElement | null>(null);
  const user: CurrentUser = { id: 'me', email: 'you@example.com', displayName: 'You', avatarUrl: null };

  const storeRef = useRef<CommentStore | null>(null);
  const variantsRef = useRef<VariantRegistry | null>(null);
  const prototypesRef = useRef<PrototypeRegistry | null>(null);
  if (!storeRef.current) storeRef.current = createMemoryStore();
  if (!variantsRef.current) variantsRef.current = createVariantRegistry({ projectId });
  if (!prototypesRef.current) prototypesRef.current = createPrototypeRegistry();

  const resolvedTheme = args.theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : args.theme;

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

  const auth = {
    get needsDisplayName() { return false; },
    get currentUser() { return user; },
    setDisplayName: async () => {},
  } as unknown as AuthClient;

  const ctx: NoddContextValue = {
    projectId,
    user,
    signIn: async () => {},
    signOut: async () => {},
    isVisible,
    toggleOverlay: () => setIsVisible(v => !v),
    setVisible: setIsVisible,
    hideForDuration: () => setIsVisible(false),
    theme: args.theme,
    setTheme: () => {},
    urlPath: '/',
    auth,
    writeStatus: 'ready',
    retryOnboarding: () => {},
    store: storeRef.current,
    variants: variantsRef.current,
    prototypes: prototypesRef.current,
    activePrototype: null,
    navigate: () => {},
    pinContainer: pinEl,
  };

  return (
    <NoddContext.Provider value={ctx}>
      <AutoStatePage />
      {isVisible && pinEl ? <OverlayRenderer /> : null}
    </NoddContext.Provider>
  );
}

const meta: Meta<AutoStateArgs> = {
  title: 'Nodd/AutoState',
  render: args => <Harness {...args} />,
  argTypes: {
    theme: { control: 'inline-radio', options: ['light', 'dark', 'system'] },
  },
  args: { theme: 'light' },
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<AutoStateArgs>;

/** Signed in. Open the dialog/menu, drop a comment inside, close, reopen from the sidebar. */
export const DialogAndMenu: Story = {};
