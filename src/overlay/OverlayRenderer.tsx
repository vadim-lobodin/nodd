import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useAlignContext } from '../provider/AlignContext';
import { PinMarker } from './components/PinMarker';
import { HoverHighlight, type HoverHighlightHandle } from './components/HoverHighlight';
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
  const ctx = useAlignContext();
  const { user, urlPath, store, signIn, signOut, theme, pinContainer } = ctx;
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pinPositions, setPinPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const pinPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const highlightRef = useRef<HoverHighlightHandle>(null);
  const portalRootRef = useRef<HTMLElement | null>(null);
  const anchorCache = useRef<Map<string, Element>>(new Map());
  const [authEmail, setAuthEmail] = useState('');
  const [authSent, setAuthSent] = useState(false);
  const [onboardName, setOnboardName] = useState('');

  // Resolve effective theme
  const effectiveTheme = theme === 'system' ? resolveSystemTheme() : theme;

  // Get portal root and set theme attribute
  useEffect(() => {
    const el = document.getElementById('align-root');
    portalRootRef.current = el;
    if (el) {
      el.setAttribute('data-align-theme', effectiveTheme);
    }
  }, [effectiveTheme]);

  // Listen for system theme changes when theme='system'
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const el = portalRootRef.current;
      if (el) {
        el.setAttribute('data-align-theme', mq.matches ? 'dark' : 'light');
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
        const el = document.querySelector(`[data-align-pin-id="${id}"]`) as HTMLElement | null;
        if (el) el.style.transform = `translate(${x}px, ${y}px)`;
      },
      onRefreshHighlight: () => highlightRef.current?.refresh(),
      onDOMMutation: () => setDomVersion(v => v + 1),
    });
  }, [snapshot]);

  const handlePinHover = useCallback(
    (threadId: string | null) => {
      if (!threadId) {
        highlightRef.current?.hide();
        return;
      }
      const el = anchorCache.current.get(threadId);
      if (el) {
        highlightRef.current?.show(el.getBoundingClientRect());
      }
    },
    [],
  );

  const handlePinOpen = useCallback((threadId: string) => {
    setOpenThreadId(prev => (prev === threadId ? null : threadId));
  }, []);

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
        index: i + 1,
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
    setSidebarOpen(false);
    const ok = await activateState(stack);
    if (!ok) return;
    // Wait one frame so the MutationObserver-driven resolveAllPins has run.
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    setOpenThreadId(threadId);
  }, [snapshot]);

  const handleSignIn = useCallback(async () => {
    if (!authEmail.trim()) return;
    await signIn(authEmail);
    setAuthSent(true);
  }, [authEmail, signIn]);

  const handleSetName = useCallback(async () => {
    const name = onboardName.trim();
    if (!name) return;
    await ctx.auth.setDisplayName(name);
  }, [onboardName, ctx.auth]);

  // Auth gate — email only
  if (!user) {
    return (
      <div className="align-auth-gate">
        {authSent ? (
          <div className="align-auth-sent">
            <p>Check your email for a sign-in link.</p>
            <button className="align-btn" onClick={() => setAuthSent(false)}>Try again</button>
          </div>
        ) : (
          <div className="align-auth-form">
            <p>Sign in to leave comments</p>
            <input
              className="align-auth-input"
              type="email"
              placeholder="you@example.com"
              value={authEmail}
              onChange={e => setAuthEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSignIn()}
            />
            <button className="align-btn align-btn--primary" onClick={handleSignIn}>
              Send magic link
            </button>
          </div>
        )}
      </div>
    );
  }

  // First-time name prompt
  if (ctx.auth.needsDisplayName) {
    return (
      <div className="align-auth-gate">
        <div className="align-auth-form">
          <p>Welcome! What should we call you?</p>
          <input
            className="align-auth-input"
            type="text"
            placeholder="Your name"
            value={onboardName}
            onChange={e => setOnboardName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetName()}
            autoFocus
          />
          <button className="align-btn align-btn--primary" onClick={handleSetName}>
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
      {/* Toolbar */}
      <div className="align-toolbar">
        <div className="align-user-pill">
          <span className="align-user-pill-name">{user.displayName ?? user.email.split('@')[0]}</span>
          <button className="align-user-pill-signout" onClick={() => void signOut()} aria-label="Sign out">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
        <button
          className={`align-btn align-btn--capture${isCapturing ? ' align-btn--active' : ''}`}
          onClick={() => setIsCapturing(!isCapturing)}
        >
          +
        </button>
        <button
          className="align-btn align-btn--sidebar"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰ {snapshot?.threads.length ?? 0}
        </button>
      </div>

      {/* Hover highlight — stays viewport-fixed */}
      <HoverHighlight ref={highlightRef} />

      {/* Pins render into the separate absolute-positioned container so they scroll with the page */}
      {pinContainer && createPortal(
        <>
          {snapshot?.threads.map((thread, i) => {
            const pos = pinPositions.get(thread.id);
            if (!pos) return null;
            if (!(stateMatch.get(thread.id) ?? true)) return null;
            return (
              <PinMarker
                key={thread.id}
                threadId={thread.id}
                index={i + 1}
                x={pos.x}
                y={pos.y}
                state={openThreadId === thread.id ? 'active' : 'idle'}
                snippet={thread.comments[0]?.body.slice(0, 60)}
                onOpen={handlePinOpen}
                onHoverChange={handlePinHover}
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

      {/* Thread popover */}
      {openThread && openPos && (
        <ThreadPopover
          threadId={openThread.id}
          index={snapshot!.threads.indexOf(openThread) + 1}
          anchorX={openPos.x}
          anchorY={openPos.y}
          comments={openThread.comments}
          currentUserId={user.id}
          resolved={openThread.resolved}
          members={memberList}
          onSubmitReply={handleReply}
          onToggleResolved={handleResolve}
          onClose={() => setOpenThreadId(null)}
        />
      )}

      {/* New thread popover */}
      {pendingPin && (
        <ThreadPopover
          threadId="new"
          index={0}
          anchorX={pendingPin.x}
          anchorY={pendingPin.y}
          comments={[]}
          currentUserId={user.id}
          resolved={false}
          members={memberList}
          onSubmitReply={handleNewThreadSubmit}
          onToggleResolved={async () => {}}
          onClose={() => setPendingPin(null)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        threadsOpen={onPageSummaries}
        threadsOtherState={otherStateSummaries}
        onItemActivate={handleItemActivate}
        fetchResolved={async () => {
          if (!store) return [];
          const resolved = await store.fetchResolved(urlPath);
          return resolved.map((t, i) => {
            const member = members?.byId.get(t.createdBy);
            return {
              id: t.id,
              index: i + 1,
              authorName: member?.displayName ?? member?.email ?? 'Unknown',
              authorAvatarUrl: member?.avatarUrl ?? undefined,
              snippet: t.comments[0]?.body.slice(0, 80) ?? '',
              createdAt: t.createdAt,
              replyCount: Math.max(0, t.comments.length - 1),
              resolved: true,
              unread: false,
            };
          });
        }}
        onItemOpen={handlePinOpen}
        onItemHover={handlePinHover}
        container={portalRootRef.current}
      />
    </Tooltip.Provider>
  );
}
