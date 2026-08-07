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
import { resolveApproximateAnchor, positionInContainer } from './anchoring/approximate';
import { getStateStackForElement, isStateMatch, stackToKey, keyToStack, activateState, describeSegment, isFloatSegment } from '../provider/state';
import { captureStateTriggers, makeTriggerResolver } from './stateTriggers';
import { matchesKey } from '../provider/keys';
import type { Thread, PageSnapshot } from '../store/types';

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Keyboard reference for the toolbar's More menu. Comment mode is armed by
// opening the comments panel and left with Esc or C, so the shortcuts need a
// home the viewer can find at rest — not only the capture toast, which is
// visible exactly when they already know where they are.
const SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: 'C', label: 'Comment mode' },
  { keys: 'Esc', label: 'Exit comment mode' },
  { keys: 'M', label: 'Comments panel' },
  { keys: 'V', label: 'Variants' },
];

/**
 * How long reveal keeps re-trying the anchor after its state has mounted.
 * A state element appears as soon as it mounts, but its contents can lag by a
 * few frames — enter animations, lazily-rendered children, a virtualised list
 * filling in. One frame of grace turned that into a spurious "the anchor isn't
 * on this screen"; a few hundred milliseconds covers it and still feels instant.
 */
const ANCHOR_SETTLE_MS = 400;

/**
 * Resolve `pin` to an element that is genuinely in scope, retrying each frame
 * until the budget runs out. Returns on the first success, so the common case
 * (already settled) costs one attempt.
 */
async function resolveWhenSettled(
  pin: Pin,
  stateKey: string,
  budgetMs: number,
): Promise<{ element: Element; position: { x: number; y: number } } | null> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const result = DOMAnchor.resolve(pin);
    if (result && isStateMatch(stateKey, getStateStackForElement(result.element))) {
      return { element: result.element, position: DOMAnchor.reposition(pin, result.element) };
    }
    if (Date.now() >= deadline) return null;
    await new Promise<void>(r => requestAnimationFrame(() => r()));
  }
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
    /** Set when the state this pin sits in has no known way back — see below. */
    reopenWarning: string | null;
    /**
     * Present when the scope came from the structural signal rather than ARIA
     * or host markup. That signal reads layout, so the author gets to see what
     * it concluded and drop it — `scopeDropped` reverts this thread to the
     * unscoped behaviour it would have had before the signal existed.
     */
    detectedScope: string | null;
    scopeDropped: boolean;
  } | null>(null);
  const [revealHint, setRevealHint] = useState<string | null>(null);
  /**
   * The one thread, if any, currently shown at a degraded anchor because its
   * exact one is gone. Held in a ref so `resolveAllPins` can re-apply it after
   * a DOM mutation wipes the position map, and singular because it only ever
   * comes from an explicit reveal — degraded pins are never shown unprompted.
   */
  const approxRef = useRef<{ threadId: string; element: Element } | null>(null);
  const [approxNotice, setApproxNotice] = useState<string | null>(null);
  // Page-absolute box drawn around the control that opens a state we couldn't
  // reopen ourselves, so a failed reveal still points somewhere.
  const [revealHighlight, setRevealHighlight] = useState<
    { x: number; y: number; width: number; height: number } | null
  >(null);

  // A deliberate exit from comment mode (Esc, or C again) has to stick for as
  // long as the panel stays open — otherwise the arming effect below would put
  // the viewer straight back into a mode they just dismissed. Cleared when the
  // panel closes, so the next open arms again.
  const captureDisarmedRef = useRef(false);

  const toggleCommentsPanel = useCallback(() => {
    setCommentsVisible(true);
    setVariantsOpen(false);
    setAuthPanelOpen(false);
    setSidebarOpen(open => !open);
  }, []);

  /** Manual exit from comment mode — remembered for this panel session. */
  const disarmCapture = useCallback(() => {
    captureDisarmedRef.current = true;
    setIsCapturing(false);
  }, []);

  const requestAddComment = useCallback(() => {
    setCommentsVisible(true);
    setVariantsOpen(false);
    setSidebarOpen(true);
    if (canComment) {
      setAuthPanelOpen(false);
      captureDisarmedRef.current = false;
      setIsCapturing(true);
    } else {
      setAuthPanelOpen(true);
      setIsCapturing(false);
    }
  }, [canComment]);

  // For a signed-in viewer the comments panel and the ability to place a pin are
  // one state: opening the panel arms comment mode, so leaving a comment no
  // longer depends on discovering "C". This lives in an effect rather than in
  // toggleCommentsPanel because every path that opens the panel should arm it
  // (deep link, requestAddComment), and because write access can land *after*
  // the panel is open — session restore and project join both resolve async.
  useEffect(() => {
    if (!sidebarOpen || !commentsVisible || !canComment) return;
    if (captureDisarmedRef.current) return;
    setIsCapturing(true);
  }, [sidebarOpen, commentsVisible, canComment]);

  // Closing the panel leaves comment mode and forgets a manual exit.
  useEffect(() => {
    if (sidebarOpen) return;
    captureDisarmedRef.current = false;
    setIsCapturing(false);
  }, [sidebarOpen]);

  // Hiding comments is intentionally transient. Close every comment surface,
  // but keep the Nodd toolbar mounted so the viewer can restore them.
  useEffect(() => {
    if (commentsVisible) return;
    setIsCapturing(false);
    setSidebarOpen(false);
    setOpenThreadId(null);
    setPendingPin(null);
    setAuthPanelOpen(false);
    setRevealHighlight(null);
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

  // Host overlays trap focus. Radix's FocusScope listens for `focusin`/`focusout`
  // on the document and, whenever focus lands outside its container, pulls it
  // straight back in. Nodd's UI *is* outside it — so a composer opened over an
  // open menu takes focus for a single frame and immediately loses it again, and
  // the viewer types into nothing.
  //
  // Nodd's surfaces aren't part of the host's focus model, so a focus trap must
  // not see focus entering them. The delicate part is *where* to stop the event.
  // `document` in the **bubble** phase is the one place that works: by then it
  // has already passed every listener attached to an element — React's delegated
  // `onFocus`/`onBlur` (bound to the root and portal containers), Nodd's own
  // handlers, Radix primitives inside Nodd, and host `onBlur` validation on the
  // field being left. Only document-level listeners are cut off, and a focus
  // trap is exactly that. Stopping earlier — at `window`, or in the capture
  // phase — would silence React's focus events along with the trap.
  //
  // `focusout` has to be matched on `relatedTarget`: its `target` is the host
  // element losing focus, and the destination is what makes the event ours.
  useEffect(() => {
    const shield = (ev: FocusEvent) => {
      const touchesNodd = [ev.target, ev.relatedTarget].some(
        n => n instanceof Element && n.closest('[data-nodd-root], [data-nodd-pin-container]'),
      );
      if (touchesNodd) ev.stopImmediatePropagation();
    };
    // Registered on mount, so it precedes any trap that arms itself when its
    // overlay opens — which is every one of them, since the overlay lives longer.
    document.addEventListener('focusin', shield);
    document.addEventListener('focusout', shield);
    return () => {
      document.removeEventListener('focusin', shield);
      document.removeEventListener('focusout', shield);
    };
  }, []);

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
    // A thread revealed at a degraded anchor has no real resolution to find, so
    // the loop above just dropped it. Put it back — otherwise the first DOM
    // mutation after the reveal closes the popover the viewer is reading.
    const approx = approxRef.current;
    if (approx && !positions.has(approx.threadId)) {
      const thread = allThreads.find(t => t.id === approx.threadId);
      const el = approx.element.isConnected
        ? approx.element
        : thread
          ? resolveApproximateAnchor(thread.pin)
          : null;
      if (el) {
        approxRef.current = { threadId: approx.threadId, element: el };
        cache.set(approx.threadId, el);
        positions.set(approx.threadId, positionInContainer(el));
        matches.set(approx.threadId, true);
      } else {
        approxRef.current = null;
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
          // A degraded pin is placed *at* its container, not at a fraction
          // across it, so repositioning it from the pin's offsets would jump it
          // somewhere arbitrary inside. resolveAllPins keeps it current instead.
          .filter(t => anchorCache.current.has(t.id) && t.id !== approxRef.current?.threadId)
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
  // held, so host-app and browser shortcuts keep working. None of them are
  // gated on comment mode being off — for a signed-in viewer with the panel
  // open that is now the resting state, so gating would disable M and V.
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
        } else if (pendingPin || openThreadId) {
          // An open popover owns Esc (its own handler closes it), so the first
          // press closes the thread and only the next one leaves comment mode.
          // Placing or reading a pin doesn't end the session.
        } else if (isCapturing) {
          ev.preventDefault();
          disarmCapture();
        }
        return;
      }
      if (isEditable(ev.target)) return;
      // "C" is the explicit add-comment action. Read-only viewers are asked
      // to sign in here, rather than when they merely open the comments list.
      if (matchesKey(ev, 'c')) {
        ev.preventDefault();
        if (isCapturing) disarmCapture();
        else requestAddComment();
        return;
      }
      // Variants are a client-side, per-viewer feature — independent of auth
      // and comment mode — so "V" works for signed-out viewers too.
      if (matchesKey(ev, 'v')) {
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
      if (matchesKey(ev, 'm')) {
        ev.preventDefault();
        toggleCommentsPanel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [authPanelOpen, isCapturing, pendingPin, openThreadId, disarmCapture, requestAddComment, toggleCommentsPanel]);

  // A visible pin is already on-screen and state-matched, so a direct click just
  // toggles its popover. Everything else (sidebar, inbox, deep link) goes
  // through revealThread, which restores the interactive state first.
  const handlePinOpen = useCallback((threadId: string) => {
    setOpenThreadId(prev => (prev === threadId ? null : threadId));
  }, []);

  // Scroll an element into view and ring it. Used when we can't finish the job
  // for the viewer but do know where they need to click.
  const highlightElement = useCallback((el: Element) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    // Measure before the smooth scroll lands: the rect is converted to page
    // coordinates, which the scroll doesn't change.
    const r = el.getBoundingClientRect();
    setRevealHighlight({
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      width: r.width,
      height: r.height,
    });
  }, []);

  /** Stop showing a thread at its degraded anchor, and let the pins re-resolve. */
  const clearApprox = useCallback(() => {
    if (!approxRef.current) return;
    approxRef.current = null;
    setApproxNotice(null);
    setDomVersion(v => v + 1);
  }, []);

  /**
   * Open a thread whose exact anchor is gone, at the nearest container that
   * still exists. Returns whether it found one.
   *
   * The alternative — what this replaces — was a toast and nothing else, which
   * left the viewer unable to even read a conversation that plainly exists. So
   * this deliberately opens the thread on a weaker claim than normal
   * resolution makes, and labels it, rather than being right or silent.
   */
  const revealApproximately = useCallback((thread: Thread, notice: string): boolean => {
    const container = resolveApproximateAnchor(thread.pin);
    if (!container) return false;
    const position = positionInContainer(container);
    approxRef.current = { threadId: thread.id, element: container };
    setApproxNotice(notice);
    anchorCache.current.set(thread.id, container);
    pinPositionsRef.current.set(thread.id, position);
    setPinPositions(current => new Map(current).set(thread.id, position));
    setStateMatch(current => new Map(current).set(thread.id, true));
    setOpenThreadId(thread.id); // the scroll effect brings it into view
    return true;
  }, []);

  // The one path to open a thread that may live in another screen or interactive
  // state. Cross-screen items route to their screen (the deep-link arrival
  // re-reveals); same-screen items restore the captured state, re-anchor, then
  // open. When that can't be done, degrade to pointing at the way in rather
  // than a dead click. Supersedes the old split of handlePinOpen /
  // inbox-open / item-activate.
  const revealThread = useCallback(async (threadId: string, itemUrlPath?: string) => {
    if (itemUrlPath && itemUrlPath !== urlPath) {
      navigate(`${itemUrlPath}#nodd-thread=${threadId}`);
      return;
    }
    const thread = allThreads.find(t => t.id === threadId);
    if (!thread) return;
    setRevealHighlight(null);
    clearApprox();

    // Restore the state the comment was captured in, preferring the trigger
    // recorded alongside the pin. activateState no-ops per segment that's
    // already mounted, so this is cheap when already in-state.
    const recordedTrigger = makeTriggerResolver(thread.pin);
    const stack = keyToStack(thread.stateKey);
    let failedSegment: string | null = null;
    if (stack.length > 0) {
      failedSegment = (await activateState(stack, { recordedTrigger })).failedSegment;
    }

    // Give the anchor a few frames to settle — the state mounts before its
    // contents finish arriving. Threads with no state to restore are already
    // settled, so they get a single attempt.
    const settled = await resolveWhenSettled(
      thread.pin,
      thread.stateKey,
      stack.length > 0 && !failedSegment ? ANCHOR_SETTLE_MS : 0,
    );
    if (settled) {
      anchorCache.current.set(threadId, settled.element);
      pinPositionsRef.current.set(threadId, settled.position);
      setPinPositions(current => new Map(current).set(threadId, settled.position));
      setStateMatch(current => new Map(current).set(threadId, true));
      setOpenThreadId(threadId); // the scroll effect brings it into view
      return;
    }

    if (!failedSegment) {
      // No state blocked us — the anchor is simply not in the DOM. Usually the
      // host is showing a different slice of the same UI: another page of the
      // list, another filter, another scenario. That view state lives in the
      // host's own React state, which Nodd has no universal way to restore, so
      // fall back to the nearest surviving container and say so.
      const named = thread.pin.label ? `“${thread.pin.label}”` : 'the element this was left on';
      if (revealApproximately(thread, `Showing this nearby — ${named} isn’t on this screen right now.`)) {
        return;
      }
      setRevealHint(
        "This comment's anchor isn't on this screen right now — it may have moved or been removed.",
      );
      return;
    }

    // We know which state blocked us. Name it, and if its opening control is on
    // the page, take the viewer to it so the next click is theirs to make. The
    // thread still opens at a degraded anchor, so the conversation is readable
    // whether or not they take that click.
    const label = describeSegment(failedSegment);
    const opener = recordedTrigger(failedSegment);
    const notice = opener
      ? `Showing this nearby — it was left inside “${label}”, and we’ve highlighted what opens it.`
      : `Showing this nearby — it was left inside “${label}”.`;
    if (opener) highlightElement(opener);
    if (revealApproximately(thread, notice)) return;

    if (opener) {
      setRevealHint(`This comment is inside “${label}” — we've highlighted what opens it.`);
    } else {
      setRevealHint(`This comment is inside “${label}” — open it and the comment will appear.`);
    }
  }, [allThreads, urlPath, navigate, highlightElement, clearApprox, revealApproximately]);

  // Auto-dismiss the reveal hint and its highlight together.
  useEffect(() => {
    if (!revealHint) return;
    const t = setTimeout(() => {
      setRevealHint(null);
      setRevealHighlight(null);
    }, 6000);
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
  // captured on route A be submitted under route B by a still-open composer —
  // that invariant is about the captured pin, so it's `pendingPin` that must go.
  // `isCapturing` deliberately survives: comment mode is bound to the panel, and
  // silently dropping it on navigation would leave the viewer clicking at a
  // screen that no longer takes pins.
  useEffect(() => {
    setOpenThreadId(null);
    setPendingPin(null);
    setRevealHint(null);
    setRevealHighlight(null);
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

  // Placing a pin does not leave comment mode — a reviewer usually has several
  // things to say about a screen. The capture layer is suppressed while the
  // composer is open (see its render site) and comes back when it closes.
  const handleCaptureCreate = useCallback(
    async (pin: Pin) => {
      if (!store || !user) return;
      // Open a new thread popover at the pin location
      const result = DOMAnchor.resolve(pin);
      if (!result) return;
      const pos = DOMAnchor.reposition(pin, result.element);
      const stack = getStateStackForElement(result.element);

      // Record how to get back into every state this pin sits under. This is
      // the only moment it can be done: the states are open, so their triggers
      // still advertise the link to them. Days later, when someone opens this
      // comment from the feed, that link is gone.
      const { triggers, unreopenable } = captureStateTriggers(stack);
      const pinWithTriggers: Pin =
        Object.keys(triggers).length > 0 ? { ...pin, stateTriggers: triggers } : pin;

      // Tell the author now, while they can still move the comment somewhere
      // reachable, rather than letting it fail silently for the next reader.
      const reopenWarning = unreopenable.length
        ? `Nodd can’t reopen ${unreopenable
            .map(s => `“${describeSegment(s)}”`)
            .join(' › ')} on its own, so this comment won’t be clickable from the sidebar — only visible when you’re back in that state.`
        : null;

      // Snapshot the active prototype at capture time — same guard as urlPath,
      // so a scope change between click and submit can't mis-stamp the thread.
      setPendingPin({
        pin: pinWithTriggers,
        x: pos.x,
        y: pos.y,
        stateKey: stackToKey(stack),
        urlPath,
        prototypeId: activePrototype?.id ?? null,
        reopenWarning,
        detectedScope: stack.length === 1 && isFloatSegment(stack[0]) ? describeSegment(stack[0]) : null,
        scopeDropped: false,
      });
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
      // Dropping a detected scope stores an empty key and no recorded triggers —
      // exactly the thread this would have been before the structural signal.
      const dropped = pendingPin.scopeDropped;
      const { stateTriggers: _omit, ...bare } = pendingPin.pin;
      await store.addThread({
        urlPath: pendingPin.urlPath,
        pin: dropped ? bare : pendingPin.pin,
        stateKey: dropped ? '' : pendingPin.stateKey,
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
        authorName: member?.displayName ?? 'Unknown',
        authorAvatarUrl: member?.avatarUrl ?? undefined,
        snippet: t.comments[0]?.body.slice(0, 80) ?? '',
        createdAt: t.createdAt,
        replyCount: Math.max(0, t.comments.length - 1),
        resolved: t.resolved,
        unread: false,
        // Prettify auto-detected segments (auto:dialog:settings → "Settings").
        breadcrumb: t.stateKey ? stack.map(describeSegment).join(' · ') : undefined,
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
                  <span className="nodd-menu-item-hint">Press C or V to bring it back</span>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="nodd-menu-separator" />
              {/* Reference rows, not actions — plain children so Radix keeps them
                  out of the menu's keyboard navigation. */}
              <DropdownMenu.Label className="nodd-menu-label">Shortcuts</DropdownMenu.Label>
              <div className="nodd-menu-shortcuts">
                {SHORTCUTS.map(({ keys, label }) => (
                  <div className="nodd-menu-shortcut" key={keys}>
                    <span>{label}</span>
                    <kbd className="nodd-kbd">{keys}</kbd>
                  </div>
                ))}
              </div>
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
                authorName={author?.displayName ?? undefined}
                authorAvatarUrl={author?.avatarUrl ?? undefined}
                snippet={thread.comments[0]?.body.slice(0, 120)}
                resolved={thread.resolved}
                approximate={approxRef.current?.threadId === thread.id}
                tooltipContainer={portalRootRef.current}
                onOpen={handlePinOpen}
              />
            );
          })}
        </>,
        pinContainer,
      )}

      {/* Ring around the control that opens a state we couldn't reopen for the
          viewer. Lives in the absolute pin container so it tracks the page as
          it scrolls, and is inert to pointer events. */}
      {commentsVisible && pinContainer && revealHighlight && createPortal(
        <div
          className="nodd-reveal-highlight"
          aria-hidden="true"
          style={{
            transform: `translate(${revealHighlight.x}px, ${revealHighlight.y}px)`,
            width: revealHighlight.width,
            height: revealHighlight.height,
          }}
        />,
        pinContainer,
      )}

      {/* Capture layer — only commenters can place pins. Suspended while any
          thread popover is open (new or existing): comment mode stays armed, but
          the layer lives in the fixed root (z 2147483000) above the pin container
          that holds the popovers, so leaving it mounted would swallow the clicks
          and focus that the composer and reply box need. It comes back when the
          popover closes, ready for the next pin. */}
      {commentsVisible && canComment && isCapturing && !pendingPin && !openThreadId && (
        <CaptureLayer
          onCreate={handleCaptureCreate}
          onCancel={disarmCapture}
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
          onClose={() => { setOpenThreadId(null); clearApprox(); }}
          readOnly={!canComment}
          notice={approxRef.current?.threadId === openThread.id ? (approxNotice ?? undefined) : undefined}
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
          notice={
            pendingPin.scopeDropped
              ? 'Not scoped — this comment will show on the whole screen.'
              : pendingPin.detectedScope
                // A structurally-detected scope usually can't be reopened either
                // (no ARIA means nothing to click), so say both things at once
                // rather than letting the scope message hide the warning.
                ? `Scoped to “${pendingPin.detectedScope}” — it’ll show only when that’s open${
                    pendingPin.reopenWarning ? ', and can’t be reopened from the sidebar' : ''
                  }.`
                : (pendingPin.reopenWarning ?? undefined)
          }
          noticeAction={
            pendingPin.detectedScope && !pendingPin.scopeDropped
              ? {
                  label: 'Not a popup?',
                  onClick: () =>
                    setPendingPin(current => (current ? { ...current, scopeDropped: true } : null)),
                }
              : undefined
          }
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
              authorName: member?.displayName ?? 'Unknown',
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
        <div
          className="nodd-toast"
          role="status"
          onClick={() => { setRevealHint(null); setRevealHighlight(null); }}
        >
          {revealHint}
        </div>
      )}
    </Tooltip.Provider>
  );
}
