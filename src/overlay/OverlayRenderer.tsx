import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Chat, Layers, ChevronDown, View, ViewOff, Logout } from '@carbon/icons-react';
import { useNoddContext } from '../provider/NoddContext';
import { PinMarker } from './components/PinMarker';
import { CaptureLayer } from './components/CaptureLayer';
import { ThreadPopover } from './components/ThreadPopover';
import { Sidebar, type ThreadSummary } from './components/Sidebar';
import { VariantsPanel } from './components/VariantsPanel';
import { NoddButton, NoddInput } from './components/FormControls';
import { DOMAnchor, type Pin } from './anchoring/DOMAnchor';
import { startReanchorLoop } from './anchoring/reanchorLoop';
import { getStateStackForElement, isStateMatch, stackToKey, keyToStack, activateState, describeAutoSegment } from '../provider/state';
import { matchesKey } from '../provider/keys';
import type { Thread, PageSnapshot } from '../store/types';

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function OverlayRenderer() {
  const ctx = useNoddContext();
  const { user, urlPath, store, variants, signIn, signOut, hideForDuration, theme, pinContainer, activePrototype, navigate } = ctx;
  // A viewer who can create/edit comments: signed in with a display name set.
  // Everyone else (logged out, or mid-onboarding) gets read-only comments.
  const canComment = !!user && !ctx.auth.needsDisplayName && ctx.writeStatus === 'ready';
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  // Resolved threads are excluded from the live snapshot (the store drops them
  // on resolve). When the viewer opts in via the settings menu we fetch them
  // separately and merge them into every derived view — dimmed, not hidden.
  const [showResolved, setShowResolved] = useState(false);
  const [resolvedThreads, setResolvedThreads] = useState<Thread[]>([]);
  // Bumped to force a fresh page subscribe (re-fetch of open threads) — used
  // after reopening a resolved thread, which the store can't fold back into the
  // live snapshot on its own.
  const [refreshKey, setRefreshKey] = useState(0);
  // Independent from NoddProvider's global `isVisible`: this only controls
  // comment UI (pins, popovers, sidebar, capture) while leaving the toolbar
  // and variants available.
  const [commentsVisible, setCommentsVisible] = useState(true);
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
  const [authName, setAuthName] = useState('');
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [pendingPin, setPendingPin] = useState<{
    pin: Pin;
    x: number;
    y: number;
    stateKey: string;
    urlPath: string;
    prototypeId: string | null;
  } | null>(null);

  const toggleCommentsPanel = useCallback(() => {
    setCommentsVisible(true);
    setVariantsOpen(false);
    setIsCapturing(false);
    setAuthPanelOpen(false);
    setSidebarOpen(open => !open);
  }, []);

  const requestAddComment = useCallback(() => {
    setCommentsVisible(true);
    setVariantsOpen(false);
    setSidebarOpen(true);
    if (canComment) {
      setAuthPanelOpen(false);
      setIsCapturing(true);
    } else {
      setAuthPanelOpen(true);
      setIsCapturing(false);
    }
  }, [canComment]);

  // Hiding comments is intentionally transient. Close every comment surface,
  // but keep the Nodd toolbar mounted so the viewer can restore them.
  useEffect(() => {
    if (commentsVisible) return;
    setIsCapturing(false);
    setSidebarOpen(false);
    setOpenThreadId(null);
    setPendingPin(null);
    setAuthPanelOpen(false);
  }, [commentsVisible]);

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

  // The panels overlay the host without mutating its layout. Keep this derived
  // flag only for moving the toolbar clear of whichever panel is open.
  const panelOpen = sidebarOpen || variantsOpen;

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
  }, [store, urlPath, user, refreshKey]);

  // Fetch the page's resolved threads while "Show resolved" is on. Re-runs on
  // snapshot changes so a just-resolved thread reappears (dimmed) and a
  // reopened one drops out. Bounded query; an epoch drops stale responses.
  const resolvedEpoch = useRef(0);
  useEffect(() => {
    if (!store || !showResolved) {
      setResolvedThreads([]);
      return;
    }
    const epoch = ++resolvedEpoch.current;
    void (async () => {
      try {
        const items = await store.fetchResolved(urlPath);
        if (resolvedEpoch.current === epoch) setResolvedThreads(items);
      } catch {
        if (resolvedEpoch.current === epoch) setResolvedThreads([]);
      }
    })();
  }, [store, showResolved, urlPath, snapshot]);

  // The set every derived view resolves against: live (open) threads plus the
  // resolved ones when opted in. A live thread wins over its resolved copy, so a
  // thread reopened during the merge window shows as open, not twice.
  const allThreads = useMemo<Thread[]>(() => {
    const base = snapshot?.threads ?? [];
    if (!showResolved || resolvedThreads.length === 0) return base;
    const byId = new Map<string, Thread>();
    for (const t of resolvedThreads) byId.set(t.id, t);
    for (const t of base) byId.set(t.id, t);
    return Array.from(byId.values());
  }, [snapshot, resolvedThreads, showResolved]);

  const [stateMatch, setStateMatch] = useState<Map<string, boolean>>(new Map());
  const [domVersion, setDomVersion] = useState(0);

  // Re-render when the variant registry changes so the toolbar's Variants
  // button appears the moment the first variant is declared in the host tree.
  const [, forceVariants] = useState(0);
  useEffect(() => variants.subscribe(() => forceVariants(v => v + 1)), [variants]);
  const hasVariants = variants.getDefinitions().length > 0;

  const resolveAllPins = useCallback(() => {
    const cache = new Map<string, Element>();
    const positions = new Map<string, { x: number; y: number }>();
    const matches = new Map<string, boolean>();
    for (const thread of allThreads) {
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
  }, [allThreads]);

  // Resolve pins on route change, snapshot change, or DOM mutation
  useLayoutEffect(() => {
    if (!commentsVisible) {
      anchorCache.current = new Map();
      pinPositionsRef.current = new Map();
      setPinPositions(new Map());
      setStateMatch(new Map());
      return;
    }
    resolveAllPins();
  }, [commentsVisible, resolveAllPins, urlPath, domVersion]);

  // Reanchor loop — uses imperative DOM updates for performance
  useEffect(() => {
    if (!commentsVisible || !allThreads.length) return;
    return startReanchorLoop({
      getPins: () =>
        allThreads
          .filter(t => anchorCache.current.has(t.id))
          .map(t => ({ id: t.id, pin: t.pin })),
      getElement: (id) => anchorCache.current.get(id) ?? null,
      setPinPosition: (id, x, y) => {
        // Update ref for popover positioning
        pinPositionsRef.current.set(id, { x, y });
        // Imperative DOM update — no React re-render
        const el = document.querySelector(`[data-nodd-pin-id="${id}"]`) as HTMLElement | null;
        if (el) el.style.translate = `${x}px ${y}px`;
      },
      onDOMMutation: () => setDomVersion(v => v + 1),
    });
  }, [allThreads, commentsVisible]);

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
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // matchesKey checks the physical key too, so shortcuts work on non-Latin
      // layouts (e.g. Russian, where C/V emit "с"/"м").
      if (ev.key === 'Escape') {
        if (authPanelOpen) {
          ev.preventDefault();
          setAuthPanelOpen(false);
        } else if (isCapturing) {
          ev.preventDefault();
          setIsCapturing(false);
        }
        return;
      }
      if (isEditable(ev.target)) return;
      // "C" is the explicit add-comment action. Read-only viewers are asked
      // to sign in here, rather than when they merely open the comments list.
      if (matchesKey(ev, 'c')) {
        ev.preventDefault();
        if (isCapturing) setIsCapturing(false);
        else requestAddComment();
        return;
      }
      // Variants are a client-side, per-viewer feature — independent of auth
      // and comment mode — so "V" works for signed-out viewers too.
      if (matchesKey(ev, 'v') && !isCapturing) {
        ev.preventDefault();
        setVariantsOpen(v => {
          if (!v) {
            setSidebarOpen(false);
            setAuthPanelOpen(false);
          } // panels are mutually exclusive
          return !v;
        });
        return;
      }
      // The comments list is available to everyone. RLS determines whether a
      // logged-out viewer receives public threads or an empty read-only list.
      if (matchesKey(ev, 'm') && !isCapturing) {
        ev.preventDefault();
        toggleCommentsPanel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [authPanelOpen, isCapturing, requestAddComment, toggleCommentsPanel]);

  // A visible pin is already on-screen and state-matched, so a direct click just
  // toggles its popover. Everything else (sidebar, inbox, deep link) goes
  // through revealThread, which restores the interactive state first.
  const handlePinOpen = useCallback((threadId: string) => {
    setOpenThreadId(prev => (prev === threadId ? null : threadId));
  }, []);

  const [revealHint, setRevealHint] = useState<string | null>(null);

  // The one path to open a thread that may live in another screen or interactive
  // state. Cross-screen items route to their screen (the deep-link arrival
  // re-reveals); same-screen items restore the captured state, re-anchor, then
  // open. If the state can't be brought back, surface a hint instead of a dead
  // click. Supersedes the old split of handlePinOpen / inbox-open / item-activate.
  const revealThread = useCallback(async (threadId: string, itemUrlPath?: string) => {
    if (itemUrlPath && itemUrlPath !== urlPath) {
      navigate(`${itemUrlPath}#nodd-thread=${threadId}`);
      return;
    }
    const thread = allThreads.find(t => t.id === threadId);
    if (!thread) return;

    // Restore the state the comment was captured in. activateState no-ops per
    // segment that's already mounted, so this is cheap when already in-state.
    const stack = keyToStack(thread.stateKey);
    if (stack.length > 0) {
      await activateState(stack);
      // Yield one frame so the MutationObserver-driven resolveAllPins has run.
      await new Promise<void>(r => requestAnimationFrame(() => r()));
    }

    const result = DOMAnchor.resolve(thread.pin);
    if (result && isStateMatch(thread.stateKey, getStateStackForElement(result.element))) {
      const position = DOMAnchor.reposition(thread.pin, result.element);
      anchorCache.current.set(threadId, result.element);
      pinPositionsRef.current.set(threadId, position);
      setPinPositions(current => new Map(current).set(threadId, position));
      setStateMatch(current => new Map(current).set(threadId, true));
      setOpenThreadId(threadId); // the scroll effect brings it into view
      return;
    }

    setRevealHint(
      "This comment was left in a state we couldn't reopen automatically — navigate to it and it'll appear.",
    );
  }, [allThreads, urlPath, navigate]);

  // Auto-dismiss the reveal hint.
  useEffect(() => {
    if (!revealHint) return;
    const t = setTimeout(() => setRevealHint(null), 6000);
    return () => clearTimeout(t);
  }, [revealHint]);

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

  // A state transition can keep the same DOM anchor alive while making the
  // thread itself out-of-scope. Pins already honor stateMatch; the popover must
  // do the same or it remains floating over the next prototype state.
  useEffect(() => {
    if (openThreadId && stateMatch.get(openThreadId) === false) {
      setOpenThreadId(null);
    }
  }, [openThreadId, stateMatch]);

  // Route changes invalidate all transient UI. In particular, never let a pin
  // captured on route A be submitted under route B by a still-open composer.
  useEffect(() => {
    setIsCapturing(false);
    setOpenThreadId(null);
    setPendingPin(null);
    setRevealHint(null);
  }, [urlPath]);

  // Deep link (#nodd-thread=<id>): a cross-screen inbox click navigates here
  // with this fragment. Capture the target and clean the URL on arrival; the
  // actual open waits until that thread is present in the loaded snapshot.
  const pendingDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const match = window.location.hash.match(/nodd-thread=([^&]+)/);
    if (!match) return;
    pendingDeepLinkRef.current = decodeURIComponent(match[1]);
    const cleaned = window.location.hash
      .replace(/(&)?nodd-thread=[^&]+/, '')
      .replace(/^#$/, '');
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search + (cleaned && cleaned !== '#' ? cleaned : ''),
    );
  }, [urlPath]);

  useEffect(() => {
    const id = pendingDeepLinkRef.current;
    if (!id) return;
    if (allThreads.some(t => t.id === id)) {
      pendingDeepLinkRef.current = null;
      void revealThread(id); // restore state + scroll, not just open
    }
  }, [allThreads, revealThread]);

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
        // Snapshot the active prototype at capture time — same guard as urlPath,
        // so a scope change between click and submit can't mis-stamp the thread.
        setPendingPin({ pin, x: pos.x, y: pos.y, stateKey, urlPath, prototypeId: activePrototype?.id ?? null });
      }
    },
    [store, user, urlPath, activePrototype],
  );

  // A new-thread composer is also state-bound. Re-resolve it after host DOM
  // mutations and close it if the original target/state is no longer present.
  useLayoutEffect(() => {
    if (!pendingPin) return;
    if (pendingPin.urlPath !== urlPath) {
      setPendingPin(null);
      return;
    }
    const result = DOMAnchor.resolve(pendingPin.pin);
    if (
      !result ||
      !isStateMatch(pendingPin.stateKey, getStateStackForElement(result.element))
    ) {
      setPendingPin(null);
      return;
    }
    const next = DOMAnchor.reposition(pendingPin.pin, result.element);
    if (next.x !== pendingPin.x || next.y !== pendingPin.y) {
      setPendingPin(current => current ? { ...current, ...next } : null);
    }
  }, [domVersion, urlPath, pendingPin]);

  const handleNewThreadSubmit = useCallback(
    async (body: string, mentions: string[]) => {
      if (!store || !pendingPin) return;
      await store.addThread({
        urlPath: pendingPin.urlPath,
        pin: pendingPin.pin,
        stateKey: pendingPin.stateKey,
        prototypeId: pendingPin.prototypeId,
        body,
        mentions,
      });
      setPendingPin(null);
    },
    [store, pendingPin],
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
    const thread = allThreads.find(t => t.id === openThreadId);
    if (!thread) return;
    if (thread.resolved) {
      await store.reopenThread(openThreadId);
      // The store can't re-add a thread it already dropped from the live page,
      // so force a fresh subscribe to pull the now-open thread back in.
      setRefreshKey(k => k + 1);
    } else {
      await store.resolveThread(openThreadId);
      setOpenThreadId(null);
    }
  }, [store, openThreadId, allThreads]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    if (!store || !openThreadId) return;
    const thread = allThreads.find(t => t.id === openThreadId);
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
  }, [store, openThreadId, allThreads]);

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
    allThreads.forEach((t, i) => {
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
        // Prettify auto-detected segments (auto:dialog:settings → "Settings").
        breadcrumb: t.stateKey ? stack.map(s => describeAutoSegment(s) ?? s).join(' · ') : undefined,
        canDelete: t.createdBy === user?.id,
      };
      if (stateMatch.get(t.id) ?? true) onPage.push(summary);
      else other.push(summary);
    });
    return { onPageSummaries: onPage, otherStateSummaries: other };
  }, [snapshot, allThreads, members, stateMatch, domVersion]);

  const handleSignIn = useCallback(async () => {
    const email = authEmail.trim();
    const name = authName.trim();
    if (authSending) return;
    if (!name) {
      setAuthError('Enter your name.');
      return;
    }
    if (!email) {
      setAuthError('Enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError('Enter a valid email address.');
      return;
    }
    setAuthError(null);
    setAuthSending(true);
    try {
      await signIn(email, name);
      setAuthSent(true);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Could not send the magic link. Please try again.',
      );
    } finally {
      setAuthSending(false);
    }
  }, [authEmail, authName, authSending, signIn]);

  const handleSetName = useCallback(async () => {
    const name = authName.trim();
    if (!name) return;
    await ctx.auth.setDisplayName(name);
  }, [authName, ctx.auth]);

  // Variants chrome (toolbar button + panel) is independent of auth and comment
  // mode — a signed-out viewer with the overlay on can still switch variants.
  // The button is always present in the toolbar; it's disabled when the page
  // registers no variants (global or local). Clicking toggles the panel.
  const variantsButton = (
    <button
      className={`nodd-btn nodd-btn--sidebar nodd-btn--variants${variantsOpen ? ' nodd-btn--active' : ''}`}
      onClick={() => setVariantsOpen(o => {
        const next = !o;
        if (next) {
          setIsCapturing(false);
          setSidebarOpen(false);
          setAuthPanelOpen(false);
        } // panel is exclusive with comment mode + comments panel
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
    />
  );

  // Read-only viewers see a compact explanation in the comments panel. The
  // form expands in place only after they choose Log in (or press C).
  const authSection = !canComment ? (
    <section className="nodd-sidebar-auth" aria-label="Comment access">
      {!user ? (
        authPanelOpen ? (
          authSent ? (
            <div className="nodd-auth-sent" role="status">
              <p>Check your email for a sign-in link.</p>
              <NoddButton variant="secondary" onClick={() => setAuthSent(false)}>
                Try again
              </NoddButton>
            </div>
          ) : (
            <form
              className="nodd-auth-form"
              noValidate
              onSubmit={e => { e.preventDefault(); void handleSignIn(); }}
            >
              <div>
                <div className="nodd-auth-title">Log in</div>
                <p className="nodd-auth-description">Enter your details to leave comments.</p>
              </div>
              <NoddInput
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Your name"
                value={authName}
                onChange={e => { setAuthName(e.target.value); setAuthError(null); }}
                aria-invalid={authError ? true : undefined}
                aria-describedby={authError ? 'nodd-auth-error' : undefined}
                autoFocus
              />
              <NoddInput
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={authEmail}
                onChange={e => { setAuthEmail(e.target.value); setAuthError(null); }}
                aria-invalid={authError ? true : undefined}
                aria-describedby={authError ? 'nodd-auth-error' : undefined}
              />
              <NoddButton
                type="submit"
                fullWidth
                disabled={authSending}
              >
                {authSending ? 'Sending…' : 'Send magic link'}
              </NoddButton>
              {authError ? (
                <p id="nodd-auth-error" className="nodd-auth-error" role="alert">
                  {authError}
                </p>
              ) : null}
            </form>
          )
        ) : (
          <>
            <div>
              <div className="nodd-auth-title">Log in to leave comments</div>
              <p className="nodd-auth-description">You can read existing comments without an account.</p>
            </div>
            <NoddButton
              fullWidth
              onClick={() => setAuthPanelOpen(true)}
            >
              Log in
            </NoddButton>
          </>
        )
      ) : ctx.auth.needsDisplayName ? (
        <div className="nodd-auth-form">
          <div className="nodd-auth-title">Welcome! What should we call you?</div>
          <NoddInput
            type="text"
            placeholder="Your name"
            value={authName}
            onChange={e => setAuthName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSetName()}
            autoFocus
          />
          <NoddButton fullWidth onClick={handleSetName}>
            Continue
          </NoddButton>
        </div>
      ) : (
        <div className="nodd-auth-form">
          <div className="nodd-auth-title">
            {ctx.writeStatus === 'joining' ? 'Preparing comments…' : 'Couldn’t enable comments'}
          </div>
          {ctx.writeStatus === 'error' ? (
            <NoddButton fullWidth onClick={ctx.retryOnboarding}>
              Try again
            </NoddButton>
          ) : null}
        </div>
      )}
    </section>
  ) : null;

  const openThread = openThreadId ? allThreads.find(t => t.id === openThreadId) : null;
  const openPos = openThreadId ? (pinPositionsRef.current.get(openThreadId) ?? pinPositions.get(openThreadId)) : null;
  const openThreadMatchesState = openThreadId
    ? (stateMatch.get(openThreadId) ?? openThread?.stateKey === '')
    : false;

  return (
    <Tooltip.Provider delayDuration={400}>
      {/* Toolbar — always visible, with both entry points. Variants (disabled
          when the page has none) toggles the variants panel. Comments opens
          the read-only-capable list; adding a comment is a separate action. */}
      <div className={`nodd-toolbar${panelOpen ? ' nodd-toolbar--shifted' : ''}`}>
        {variantsButton}
        <button
          className={`nodd-btn nodd-btn--sidebar${sidebarOpen ? ' nodd-btn--active' : ''}`}
          onClick={toggleCommentsPanel}
          aria-label={sidebarOpen ? 'Close comments' : 'Open comments'}
          title={sidebarOpen ? 'Close comments' : 'Open comments'}
        >
          <Chat size={20} />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="nodd-btn nodd-btn--sidebar nodd-btn--chevron"
              aria-label="More"
              title="More"
            >
              <ChevronDown size={20} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={portalRootRef.current}>
            <DropdownMenu.Content
              className="nodd-menu"
              align="end"
              side="top"
              sideOffset={6}
              onCloseAutoFocus={e => e.preventDefault()}
            >
              <DropdownMenu.Item
                className="nodd-menu-item"
                onSelect={() => setCommentsVisible(visible => !visible)}
              >
                {commentsVisible ? <ViewOff size={16} /> : <View size={16} />}
                <span>{commentsVisible ? 'Hide comments' : 'Show comments'}</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="nodd-menu-separator" />
              <DropdownMenu.Item
                className="nodd-menu-item nodd-menu-item--stacked"
                onSelect={() => hideForDuration(60 * 60 * 1000)}
              >
                <ViewOff size={16} />
                <span className="nodd-menu-item-text">
                  Hide Nodd for 1 hour
                  <span className="nodd-menu-item-hint">Press C or V to show</span>
                </span>
              </DropdownMenu.Item>
              {user && (
                <>
                  <DropdownMenu.Separator className="nodd-menu-separator" />
                  <DropdownMenu.Item
                    className="nodd-menu-item nodd-menu-item--danger"
                    onSelect={() => void signOut()}
                  >
                    <Logout size={16} />
                    <span>Log Out</span>
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Pins render into the separate absolute-positioned container so they scroll with the page */}
      {commentsVisible && pinContainer && createPortal(
        <>
          {allThreads.map((thread, i) => {
            const pos = pinPositions.get(thread.id);
            if (!pos) return null;
            if (!(stateMatch.get(thread.id) ?? thread.stateKey === '')) return null;
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
                resolved={thread.resolved}
                tooltipContainer={portalRootRef.current}
                onOpen={handlePinOpen}
              />
            );
          })}
        </>,
        pinContainer,
      )}

      {/* Capture layer — only commenters can place pins */}
      {commentsVisible && canComment && isCapturing && (
        <CaptureLayer
          onCreate={handleCaptureCreate}
          onCancel={() => setIsCapturing(false)}
          portalRootRef={portalRootRef}
        />
      )}

      {/* Thread popover — read-only (no composer/resolve/delete) for viewers
          who can't comment. Portals into the absolute pin container so it
          scrolls with the page, anchored to the pin. */}
      {commentsVisible && pinContainer && openThread && openPos && openThreadMatchesState && createPortal(
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
      {commentsVisible && canComment && pinContainer && pendingPin && createPortal(
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
        onClose={() => {
          setSidebarOpen(false);
          setAuthPanelOpen(false);
        }}
        threadsOpen={onPageSummaries}
        threadsOtherState={otherStateSummaries}
        onItemDelete={canComment ? handleDeleteThread : undefined}
        userName={user ? (user.displayName ?? user.email.split('@')[0]) : undefined}
        showResolved={showResolved}
        onToggleShowResolved={() => setShowResolved(v => !v)}
        authSection={authSection}
        prototypeLabel={activePrototype ? (activePrototype.label ?? activePrototype.id) : undefined}
        fetchPrototypeThreads={activePrototype ? async ({ resolved }) => {
          if (!store || !activePrototype) return [];
          const threads = await store.fetchPrototypeThreads(activePrototype.id, { resolved });
          return threads.map(t => {
            const member = members?.byId.get(t.createdBy);
            return {
              id: t.id,
              authorName: member?.displayName ?? member?.email ?? 'Unknown',
              authorAvatarUrl: member?.avatarUrl ?? undefined,
              snippet: t.comments[0]?.body.slice(0, 80) ?? '',
              createdAt: t.createdAt,
              replyCount: Math.max(0, t.comments.length - 1),
              resolved: t.resolved,
              unread: false,
              // Group by screen; the current screen keeps its live-open label.
              breadcrumb: t.urlPath === urlPath ? 'This screen' : t.urlPath,
              urlPath: t.urlPath,
              canDelete: t.createdBy === user?.id,
            } satisfies ThreadSummary;
          });
        } : undefined}
        onItemOpen={revealThread}
        onItemHover={() => {}}
        container={portalRootRef.current}
      />

      {/* Variants panel — shares the right-side region with the sidebar */}
      {variantsPanel}

      {/* Transient hint when a thread's captured state couldn't be reopened. */}
      {revealHint && (
        <div className="nodd-toast" role="status" onClick={() => setRevealHint(null)}>
          {revealHint}
        </div>
      )}
    </Tooltip.Provider>
  );
}
