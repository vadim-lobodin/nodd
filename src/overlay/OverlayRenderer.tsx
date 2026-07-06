import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Menu } from '@carbon/icons-react';
import { useNoddContext } from '../provider/NoddContext';
import { PinMarker } from './components/PinMarker';
import { CaptureLayer } from './components/CaptureLayer';
import { ThreadPopover } from './components/ThreadPopover';
import { Sidebar, type ThreadSummary } from './components/Sidebar';
import { DOMAnchor, type Pin } from './anchoring/DOMAnchor';
import { startReanchorLoop } from './anchoring/reanchorLoop';
import { getStateStackForElement, isStateMatch, stackToKey, keyToStack, hasActivatorOrTrigger, activateState, subscribeActivators } from '../provider/state';
import type { Thread, PageSnapshot } from '../store/types';

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function OverlayRenderer() {
  const ctx = useNoddContext();
  const { user, urlPath, store, signIn, signOut, theme, pinContainer } = ctx;
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pinPositions, setPinPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const pinPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const portalRootRef = useRef<HTMLElement | null>(null);
  const anchorCache = useRef<Map<string, Element>>(new Map());
  const [authEmail, setAuthEmail] = useState('');
  const [authSent, setAuthSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSending, setAuthSending] = useState(false);
  const [onboardName, setOnboardName] = useState('');

  // Resolve effective theme
  const effectiveTheme = theme === 'system' ? resolveSystemTheme() : theme;

  // Get portal root and set theme attribute
  useEffect(() => {
    const el = document.getElementById('nodd-root');
    portalRootRef.current = el;
    if (el) {
      el.setAttribute('data-nodd-theme', effectiveTheme);
    }
  }, [effectiveTheme]);

  // Push host layout when the sidebar is open, instead of overlaying.
  // Uses inline style to avoid leaking unscoped CSS into the host (see CLAUDE.md).
  // Must clear the sidebar's full footprint: right gap (16) + width (300) +
  // a left breathing gap (16) = 332px, otherwise it overlaps host content.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const prevMargin = body.style.marginRight;
    body.style.marginRight = sidebarOpen ? 'min(332px, 90vw)' : prevMargin || '';
    return () => {
      body.style.marginRight = prevMargin;
    };
  }, [sidebarOpen]);

  // Listen for system theme changes when theme='system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const el = portalRootRef.current;
      if (el) {
        el.setAttribute('data-nodd-theme', mq.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Subscribe to store — only after auth has resolved, otherwise the fetch
  // fires anonymously and RLS returns an empty page that never re-fetches.
  useEffect(() => {
    if (!store || !user) return;
    return store.subscribe(urlPath, setSnapshot);
  }, [store, urlPath, user]);

  const [stateMatch, setStateMatch] = useState<Map<string, boolean>>(new Map());
  const [domVersion, setDomVersion] = useState(0);
  const [activatorVersion, setActivatorVersion] = useState(0);

  // Re-render when activator registry changes so the Show me button can
  // appear/disappear as host state mounts/unmounts new activators.
  useEffect(() => {
    return subscribeActivators(() => setActivatorVersion(v => v + 1));
  }, []);

  const resolveAllPins = useCallback(() => {
    if (!snapshot) return;
    const cache = new Map<string, Element>();
    const positions = new Map<string, { x: number; y: number }>();
    const matches = new Map<string, boolean>();
    for (const thread of snapshot.threads) {
      const result = DOMAnchor.resolve(thread.pin);
      if (result) {
        cache.set(thread.id, result.element);
        const pos = DOMAnchor.reposition(thread.pin, result.element);
        positions.set(thread.id, pos);
        const domStack = getStateStackForElement(result.element);
        matches.set(thread.id, isStateMatch(thread.stateKey, domStack));
      } else {
        matches.set(thread.id, isStateMatch(thread.stateKey, []));
      }
    }
    anchorCache.current = cache;
    pinPositionsRef.current = positions;
    setPinPositions(positions);
    setStateMatch(matches);
  }, [snapshot]);

  // Resolve pins on route change, snapshot change, or DOM mutation
  useEffect(() => {
    resolveAllPins();
  }, [resolveAllPins, urlPath, domVersion]);

  // Reanchor loop — uses imperative DOM updates for performance
  useEffect(() => {
    if (!snapshot) return;
    return startReanchorLoop({
      getPins: () =>
        snapshot.threads
          .filter(t => anchorCache.current.has(t.id))
          .map(t => ({ id: t.id, pin: t.pin })),
      getElement: (id) => anchorCache.current.get(id) ?? null,
      setPinPosition: (id, x, y) => {
        // Update ref for popover positioning
        pinPositionsRef.current.set(id, { x, y });
        // Imperative DOM update — no React re-render
        const el = document.querySelector(`[data-nodd-pin-id="${id}"]`) as HTMLElement | null;
        if (el) el.style.transform = `translate(${x}px, ${y}px)`;
      },
      onDOMMutation: () => setDomVersion(v => v + 1),
    });
  }, [snapshot]);

  // Keyboard shortcuts (Figma-style): "C" toggles comment mode, "M" toggles
  // the comments sidebar. Ignored while typing in a field or with a modifier
  // held, so host-app and browser shortcuts keep working.
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const handler = (ev: KeyboardEvent) => {
      if (!user || ev.metaKey || ev.ctrlKey || ev.altKey || isEditable(ev.target)) return;
      const key = ev.key.toLowerCase();
      if (key === 'c') {
        ev.preventDefault();
        setIsCapturing(v => {
          if (!v) setSidebarOpen(false); // entering comment mode closes the sidebar
          return !v;
        });
      } else if (key === 'm' && !isCapturing) {
        ev.preventDefault();
        setSidebarOpen(v => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [user, isCapturing]);

  const handlePinOpen = useCallback((threadId: string) => {
    setOpenThreadId(prev => (prev === threadId ? null : threadId));
  }, []);

  const handlePinHover = useCallback((_threadId: string | null) => {}, []);

  const handleCaptureCreate = useCallback(
    async (pin: Pin) => {
      setIsCapturing(false);
      if (!store || !user) return;
      // Open a new thread popover at the pin location
      const result = DOMAnchor.resolve(pin);
      if (result) {
        const pos = DOMAnchor.reposition(pin, result.element);
        const stateKey = stackToKey(getStateStackForElement(result.element));
        setPendingPin({ pin, x: pos.x, y: pos.y, stateKey });
      }
    },
    [store, user],
  );

  const [pendingPin, setPendingPin] = useState<{ pin: Pin; x: number; y: number; stateKey: string } | null>(null);

  const handleNewThreadSubmit = useCallback(
    async (body: string, mentions: string[]) => {
      if (!store || !pendingPin) return;
      await store.addThread({
        urlPath,
        pin: pendingPin.pin,
        stateKey: pendingPin.stateKey,
        body,
        mentions,
      });
      setPendingPin(null);
    },
    [store, urlPath, pendingPin],
  );

  const handleReply = useCallback(
    async (body: string, mentions: string[]) => {
      if (!store || !openThreadId) return;
      await store.replyToThread({ threadId: openThreadId, body, mentions });
    },
    [store, openThreadId],
  );

  const handleResolve = useCallback(async () => {
    if (!store || !openThreadId) return;
    const thread = snapshot?.threads.find(t => t.id === openThreadId);
    if (!thread) return;
    if (thread.resolved) {
      await store.reopenThread(openThreadId);
    } else {
      await store.resolveThread(openThreadId);
      setOpenThreadId(null);
    }
  }, [store, openThreadId, snapshot]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    if (!store || !openThreadId) return;
    const thread = snapshot?.threads.find(t => t.id === openThreadId);
    // Deleting the root comment removes the whole thread (store handles this);
    // close the popover since there's nothing left to show.
    const isRoot = thread?.comments[0]?.id === commentId;
    const threadId = openThreadId;
    if (isRoot) setOpenThreadId(null);
    try {
      await store.deleteComment({ threadId, commentId });
    } catch {
      // The store rolls the comment/thread back into state on failure; reopen
      // the popover so the restored content is visible instead of vanishing.
      if (isRoot) setOpenThreadId(threadId);
    }
  }, [store, openThreadId, snapshot]);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    if (!store) return;
    const wasOpen = openThreadId === threadId;
    if (wasOpen) setOpenThreadId(null);
    try {
      await store.deleteThread(threadId);
    } catch {
      // Store rolls the thread back; reopen it so it isn't silently lost.
      if (wasOpen) setOpenThreadId(threadId);
    }
  }, [store, openThreadId]);

  const members = store?.getMembers();
  const memberList = members?.list ?? [];

  const { onPageSummaries, otherStateSummaries } = useMemo(() => {
    const onPage: ThreadSummary[] = [];
    const other: ThreadSummary[] = [];
    if (!snapshot) return { onPageSummaries: onPage, otherStateSummaries: other };
    snapshot.threads.forEach((t, i) => {
      const member = members?.byId.get(t.createdBy);
      const stack = keyToStack(t.stateKey);
      const summary: ThreadSummary = {
        id: t.id,
        authorName: member?.displayName ?? member?.email ?? 'Unknown',
        authorAvatarUrl: member?.avatarUrl ?? undefined,
        snippet: t.comments[0]?.body.slice(0, 80) ?? '',
        createdAt: t.createdAt,
        replyCount: Math.max(0, t.comments.length - 1),
        resolved: t.resolved,
        unread: false,
        breadcrumb: t.stateKey ? stack.join(' · ') : undefined,
        stateStack: stack,
        canActivate: stack.length > 0 && stack.every(s => hasActivatorOrTrigger(s)),
        canDelete: t.createdBy === user?.id,
      };
      if (stateMatch.get(t.id) ?? true) onPage.push(summary);
      else other.push(summary);
    });
    return { onPageSummaries: onPage, otherStateSummaries: other };
  }, [snapshot, members, stateMatch, activatorVersion, domVersion]);

  const handleItemActivate = useCallback(async (threadId: string) => {
    const thread = snapshot?.threads.find(t => t.id === threadId);
    if (!thread) return;
    const stack = keyToStack(thread.stateKey);
    const ok = await activateState(stack);
    if (!ok) return;
    // Wait one frame so the MutationObserver-driven resolveAllPins has run.
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    setOpenThreadId(threadId);
  }, [snapshot]);

  const handleSignIn = useCallback(async () => {
    if (!authEmail.trim() || authSending) return;
    setAuthError(null);
    setAuthSending(true);
    try {
      await signIn(authEmail);
      setAuthSent(true);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Could not send the magic link. Please try again.',
      );
    } finally {
      setAuthSending(false);
    }
  }, [authEmail, authSending, signIn]);

  const handleSetName = useCallback(async () => {
    const name = onboardName.trim();
    if (!name) return;
    await ctx.auth.setDisplayName(name);
  }, [onboardName, ctx.auth]);

  // Auth gate — email only
  if (!user) {
    return (
      <div className="nodd-auth-gate">
        {authSent ? (
          <div className="nodd-auth-sent">
            <p>Check your email for a sign-in link.</p>
            <button className="nodd-btn" onClick={() => setAuthSent(false)}>Try again</button>
          </div>
        ) : (
          <div className="nodd-auth-form">
            <p>Sign in to leave comments</p>
            <input
              className="nodd-auth-input"
              type="email"
              placeholder="you@example.com"
              value={authEmail}
              onChange={e => { setAuthEmail(e.target.value); setAuthError(null); }}
              onKeyDown={e => e.key === 'Enter' && handleSignIn()}
            />
            <button
              className="nodd-btn nodd-btn--primary"
              onClick={handleSignIn}
              disabled={authSending}
            >
              {authSending ? 'Sending…' : 'Send magic link'}
            </button>
            {authError && <p className="nodd-auth-error" role="alert">{authError}</p>}
          </div>
        )}
      </div>
    );
  }

  // First-time name prompt
  if (ctx.auth.needsDisplayName) {
    return (
      <div className="nodd-auth-gate">
        <div className="nodd-auth-form">
          <p>Welcome! What should we call you?</p>
          <input
            className="nodd-auth-input"
            type="text"
            placeholder="Your name"
            value={onboardName}
            onChange={e => setOnboardName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetName()}
            autoFocus
          />
          <button className="nodd-btn nodd-btn--primary" onClick={handleSetName}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  const openThread = openThreadId ? snapshot?.threads.find(t => t.id === openThreadId) : null;
  const openPos = openThreadId ? (pinPositionsRef.current.get(openThreadId) ?? pinPositions.get(openThreadId)) : null;

  return (
    <Tooltip.Provider delayDuration={400}>
      {/* Panel — only visible while in comment mode (entered via "C"). The menu
          opens the sidebar; exit comment mode via Esc or pressing "C" again. */}
      {isCapturing && (
        <div className="nodd-toolbar">
          <button
            className="nodd-btn nodd-btn--sidebar"
            onClick={() => { setIsCapturing(false); setSidebarOpen(true); }}
            aria-label="Open comments"
          >
            <Menu size={20} />
          </button>
        </div>
      )}

      {/* Pins render into the separate absolute-positioned container so they scroll with the page */}
      {pinContainer && createPortal(
        <>
          {snapshot?.threads.map((thread, i) => {
            const pos = pinPositions.get(thread.id);
            if (!pos) return null;
            if (!(stateMatch.get(thread.id) ?? true)) return null;
            const author = members?.byId.get(thread.createdBy);
            return (
              <PinMarker
                key={thread.id}
                threadId={thread.id}
                x={pos.x}
                y={pos.y}
                state={openThreadId === thread.id ? 'active' : 'idle'}
                authorName={author?.displayName ?? author?.email?.split('@')[0]}
                authorAvatarUrl={author?.avatarUrl ?? undefined}
                snippet={thread.comments[0]?.body.slice(0, 120)}
                tooltipContainer={portalRootRef.current}
                onOpen={handlePinOpen}
              />
            );
          })}
        </>,
        pinContainer,
      )}

      {/* Capture layer */}
      {isCapturing && (
        <CaptureLayer
          onCreate={handleCaptureCreate}
          onCancel={() => setIsCapturing(false)}
          portalRootRef={portalRootRef}
        />
      )}

      {/* Thread popover — portals into the absolute pin container so it
          scrolls with the page, anchored to the pin */}
      {pinContainer && openThread && openPos && createPortal(
        <ThreadPopover
          threadId={openThread.id}
          anchorX={openPos.x}
          anchorY={openPos.y}
          comments={openThread.comments}
          currentUserId={user.id}
          resolved={openThread.resolved}
          members={memberList}
          onSubmitReply={handleReply}
          onToggleResolved={handleResolve}
          onDeleteComment={handleDeleteComment}
          onClose={() => setOpenThreadId(null)}
        />,
        pinContainer,
      )}

      {/* New thread popover */}
      {pinContainer && pendingPin && createPortal(
        <ThreadPopover
          threadId="new"
          anchorX={pendingPin.x}
          anchorY={pendingPin.y}
          comments={[]}
          currentUserId={user.id}
          resolved={false}
          members={memberList}
          onSubmitReply={handleNewThreadSubmit}
          onToggleResolved={async () => {}}
          onDeleteComment={async () => {}}
          onClose={() => setPendingPin(null)}
        />,
        pinContainer,
      )}

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        threadsOpen={onPageSummaries}
        threadsOtherState={otherStateSummaries}
        onItemActivate={handleItemActivate}
        onItemDelete={handleDeleteThread}
        userName={user.displayName ?? user.email.split('@')[0]}
        onSignOut={() => void signOut()}
        fetchResolved={async () => {
          if (!store) return [];
          const resolved = await store.fetchResolved(urlPath);
          return resolved.map((t, i) => {
            const member = members?.byId.get(t.createdBy);
            return {
              id: t.id,
              authorName: member?.displayName ?? member?.email ?? 'Unknown',
              authorAvatarUrl: member?.avatarUrl ?? undefined,
              snippet: t.comments[0]?.body.slice(0, 80) ?? '',
              createdAt: t.createdAt,
              replyCount: Math.max(0, t.comments.length - 1),
              resolved: true,
              unread: false,
              canDelete: t.createdBy === user?.id,
            };
          });
        }}
        onItemOpen={handlePinOpen}
        onItemHover={() => {}}
        container={portalRootRef.current}
      />
    </Tooltip.Provider>
  );
}
