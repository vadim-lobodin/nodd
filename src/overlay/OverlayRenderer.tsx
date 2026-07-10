import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Chat, Layers } from '@carbon/icons-react';
import { useNoddContext } from '../provider/NoddContext';
import { PinMarker } from './components/PinMarker';
import { CaptureLayer } from './components/CaptureLayer';
import { ThreadPopover } from './components/ThreadPopover';
import { Sidebar, type ThreadSummary } from './components/Sidebar';
import { VariantsPanel } from './components/VariantsPanel';
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
  const { user, urlPath, store, variants, signIn, signOut, hideForSession, theme, pinContainer } = ctx;
  // A viewer who can create/edit comments: signed in with a display name set.
  // Everyone else (logged out, or mid-onboarding) gets read-only comments.
  const canComment = !!user && !ctx.auth.needsDisplayName;
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
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

  // Push host layout when either right-side panel is open, instead of
  // overlaying. Uses inline style to avoid leaking unscoped CSS into the host
  // (see CLAUDE.md). Must clear the panel's full footprint: right gap (16) +
  // width (300) + a left breathing gap (16) = 332px, otherwise it overlaps
  // host content. The two panels are mutually exclusive so they share the gap.
  const panelOpen = sidebarOpen || variantsOpen;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const prevMargin = body.style.marginRight;
    body.style.marginRight = panelOpen ? 'min(332px, 90vw)' : prevMargin || '';
    return () => {
      body.style.marginRight = prevMargin;
    };
  }, [panelOpen]);

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

  // Subscribe to the page's threads. Re-subscribes when `user` changes so the
  // fetch re-runs after sign-in: a logged-out fetch returns the public-reads
  // rows (empty unless the project opted in), then the authed fetch replaces
  // them with the member view. `user` in deps is what makes that re-fetch fire.
  useEffect(() => {
    if (!store) return;
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

  // Re-render when the variant registry changes so the toolbar's Variants
  // button appears the moment the first variant is declared in the host tree.
  const [, forceVariants] = useState(0);
  useEffect(() => variants.subscribe(() => forceVariants(v => v + 1)), [variants]);
  const hasVariants = variants.getDefinitions().length > 0;

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
      if (ev.metaKey || ev.ctrlKey || ev.altKey || isEditable(ev.target)) return;
      const key = ev.key.toLowerCase();
      if (key === 'escape') {
        if (isCapturing) { ev.preventDefault(); setIsCapturing(false); }
        return;
      }
      // "C" works even when signed out — it surfaces the centered sign-in
      // prompt (the overlay is otherwise hidden by default for guests).
      if (key === 'c') {
        ev.preventDefault();
        setIsCapturing(v => {
          const next = !v;
          setVariantsOpen(false);             // variants panel never coexists with comment mode
          setSidebarOpen(next && canComment); // comment mode opens the comments panel alongside it (signed-in only)
          return next;
        });
        return;
      }
      // Variants are a client-side, per-viewer feature — independent of auth
      // and comment mode — so "V" works for signed-out viewers too.
      if (key === 'v' && !isCapturing) {
        ev.preventDefault();
        setVariantsOpen(v => {
          if (!v) setSidebarOpen(false); // panels are mutually exclusive
          return !v;
        });
        return;
      }
      // The comments sidebar is a signed-in convenience. Logged-out viewers
      // read by clicking the visible pins (read-only popover); the universal
      // entry to *commenting* is "C", which surfaces the sign-in prompt.
      if (!user) return;
      if (key === 'm' && !isCapturing) {
        ev.preventDefault();
        setSidebarOpen(v => {
          if (!v) setVariantsOpen(false); // panels are mutually exclusive
          return !v;
        });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [user, isCapturing]);

  const handlePinOpen = useCallback((threadId: string) => {
    setOpenThreadId(prev => (prev === threadId ? null : threadId));
  }, []);

  // When a thread opens (e.g. picked from the sidebar) scroll its anchor into
  // view if it's off-screen, so the pin and popover are actually visible.
  // A directly-clicked pin is already on-screen, so the guard makes this a no-op.
  const scrollThreadIntoView = useCallback((threadId: string) => {
    const el = anchorCache.current.get(threadId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fullyVisible =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;
    if (!fullyVisible) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
  }, []);

  useEffect(() => {
    if (openThreadId) scrollThreadIntoView(openThreadId);
  }, [openThreadId, scrollThreadIntoView]);

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

  // Variants chrome (toolbar button + panel) is independent of auth and comment
  // mode — a signed-out viewer with the overlay on can still switch variants.
  // The button is always present in the toolbar; it's disabled when the page
  // registers no variants (global or local). Clicking toggles the panel.
  const variantsButton = (
    <button
      className={`nodd-btn nodd-btn--sidebar nodd-btn--variants${variantsOpen ? ' nodd-btn--active' : ''}`}
      onClick={() => setVariantsOpen(o => {
        const next = !o;
        if (next) { setIsCapturing(false); setSidebarOpen(false); } // panel is exclusive with comment mode + comments panel
        return next;
      })}
      disabled={!hasVariants}
      aria-label={hasVariants ? 'Variants' : 'No variants on this page'}
      title={hasVariants ? 'Variants' : 'No variants on this page'}
    >
      <Layers size={20} />
    </button>
  );

  const variantsPanel = (
    <VariantsPanel
      open={variantsOpen}
      onClose={() => setVariantsOpen(false)}
      registry={variants}
      container={portalRootRef.current}
      onHideForSession={hideForSession}
      onSignOut={user ? () => void signOut() : undefined}
    />
  );

  // The overlay now renders for everyone (see subscribe effect): commenters get
  // the full flow; logged-out / mid-onboarding viewers get read-only comments by
  // clicking the visible pins. The sign-in / name prompt is a modal surfaced only
  // when a read-only viewer tries to comment (presses "C" → isCapturing), not an
  // early return that would hide pins and the variants panel.
  const authGate = !canComment && isCapturing ? (
    <div className="nodd-auth-backdrop" onClick={() => setIsCapturing(false)}>
      <div className="nodd-auth-gate nodd-auth-gate--center" onClick={e => e.stopPropagation()}>
        {!user ? (
          authSent ? (
            <div className="nodd-auth-sent">
              <p>Check your email for a sign-in link.</p>
              <button className="nodd-btn" onClick={() => setAuthSent(false)}>Try again</button>
            </div>
          ) : (
            <div className="nodd-auth-form">
              <h2 className="nodd-auth-title">Log in to leave comments</h2>
              <input
                className="nodd-auth-input"
                type="email"
                placeholder="you@example.com"
                value={authEmail}
                onChange={e => { setAuthEmail(e.target.value); setAuthError(null); }}
                onKeyDown={e => e.key === 'Enter' && handleSignIn()}
                autoFocus
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
          )
        ) : (
          <div className="nodd-auth-form">
            <h2 className="nodd-auth-title">Welcome! What should we call you?</h2>
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
        )}
      </div>
    </div>
  ) : null;

  const openThread = openThreadId ? snapshot?.threads.find(t => t.id === openThreadId) : null;
  const openPos = openThreadId ? (pinPositionsRef.current.get(openThreadId) ?? pinPositions.get(openThreadId)) : null;

  return (
    <Tooltip.Provider delayDuration={400}>
      {/* Toolbar — always visible, with both entry points. Variants (disabled
          when the page has none) toggles the variants panel. Comments enters
          comment mode and opens the comments panel together; clicking again
          (or Esc / "C") exits. */}
      <div className={`nodd-toolbar${panelOpen ? ' nodd-toolbar--shifted' : ''}`}>
        {variantsButton}
        <button
          className={`nodd-btn nodd-btn--sidebar${isCapturing ? ' nodd-btn--active' : ''}`}
          onClick={() => setIsCapturing(v => {
            const next = !v;
            setVariantsOpen(false);
            setSidebarOpen(next && canComment); // signed-in commenters get the panel; guests get the auth gate
            return next;
          })}
          aria-label={isCapturing ? 'Exit comment mode' : 'Comment'}
          title={isCapturing ? 'Exit comment mode' : 'Comment'}
        >
          <Chat size={20} />
        </button>
      </div>

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

      {/* Capture layer — only commenters can place pins */}
      {canComment && isCapturing && (
        <CaptureLayer
          onCreate={handleCaptureCreate}
          onCancel={() => setIsCapturing(false)}
          portalRootRef={portalRootRef}
        />
      )}

      {/* Thread popover — read-only (no composer/resolve/delete) for viewers
          who can't comment. Portals into the absolute pin container so it
          scrolls with the page, anchored to the pin. */}
      {pinContainer && openThread && openPos && createPortal(
        <ThreadPopover
          threadId={openThread.id}
          anchorX={openPos.x}
          anchorY={openPos.y}
          comments={openThread.comments}
          currentUserId={user?.id ?? ''}
          resolved={openThread.resolved}
          members={memberList}
          onSubmitReply={handleReply}
          onToggleResolved={handleResolve}
          onDeleteComment={handleDeleteComment}
          onClose={() => setOpenThreadId(null)}
          readOnly={!canComment}
        />,
        pinContainer,
      )}

      {/* New thread popover — commenters only */}
      {canComment && pinContainer && pendingPin && createPortal(
        <ThreadPopover
          threadId="new"
          anchorX={pendingPin.x}
          anchorY={pendingPin.y}
          comments={[]}
          currentUserId={user?.id ?? ''}
          resolved={false}
          members={memberList}
          onSubmitReply={handleNewThreadSubmit}
          onToggleResolved={async () => {}}
          onDeleteComment={async () => {}}
          onClose={() => setPendingPin(null)}
        />,
        pinContainer,
      )}

      {/* Sidebar — read-only when the viewer can't comment (no delete/sign-out) */}
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        threadsOpen={onPageSummaries}
        threadsOtherState={otherStateSummaries}
        onItemActivate={handleItemActivate}
        onItemDelete={canComment ? handleDeleteThread : undefined}
        userName={user ? (user.displayName ?? user.email.split('@')[0]) : undefined}
        onSignOut={user ? () => void signOut() : undefined}
        onHideForSession={hideForSession}
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

      {/* Variants panel — shares the right-side region with the sidebar */}
      {variantsPanel}

      {/* Sign-in / name prompt — surfaced only when a read-only viewer tries to
          comment (presses "C"). Renders over pins + panels, not instead of them. */}
      {authGate}
    </Tooltip.Provider>
  );
}
