import React, { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  NoddContext,
  type NoddContextValue,
  type NoddTheme,
  type NoddWriteStatus,
} from './NoddContext';
import { AuthClient, type CurrentUser } from '../auth';
import { createCommentStore, type CommentStore } from '../store';
import { createVariantRegistry, type VariantRegistry } from './variants';
import { createPrototypeRegistry, type PrototypeRegistry, type PrototypeScope } from './scope';
import { OverlayRenderer } from '../overlay';
import { subscribeToRouteChanges } from './useRouteChange';
import { isBrowser } from './ssr';
import { matchesKey } from './keys';

// Strip stale Supabase auth error fragments from the URL hash before the client
// parses them. Keeps the last valid access_token block if present.
if (isBrowser() && window.location.hash) {
  const raw = window.location.hash.substring(1); // drop leading #
  // Find the last access_token occurrence — that's the fresh one
  const lastIdx = raw.lastIndexOf('access_token=');
  if (lastIdx !== -1) {
    // Walk backwards to find the start of this fragment block (after # or &sb=)
    let start = lastIdx;
    while (start > 0 && raw[start - 1] !== '#') start--;
    const cleanHash = raw.substring(start);
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#' + cleanHash);
  } else if (raw.includes('error=')) {
    // Only errors, no token — just strip it
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Global singleton cache — survives HMR, Strict Mode, and module re-evaluation
const CACHE_KEY = '__nodd_client_cache__' as const;
type ClientEntry = { supabase: SupabaseClient; auth: AuthClient };

function authStorageKey(supabaseUrl: string): string {
  try {
    return `nodd-auth:${new URL(supabaseUrl).host}`;
  } catch {
    // createClient will report an invalid URL separately. Keep auth storage
    // isolated even when a host passes a non-standard URL during development.
    return `nodd-auth:${supabaseUrl || 'unknown'}`;
  }
}

function getOrCreateClients(supabaseUrl: string, supabaseAnonKey: string): ClientEntry {
  const g = globalThis as any;
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map<string, ClientEntry>();
  const cache = g[CACHE_KEY] as Map<string, ClientEntry>;

  const key = `${supabaseUrl}::${supabaseAnonKey}`;
  let entry = cache.get(key);
  if (!entry) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: authStorageKey(supabaseUrl),
        detectSessionInUrl: true,
        flowType: 'implicit',
        // No-op lock: Supabase's default `navigator.locks` coordination
        // causes "Lock stolen" errors when multiple tabs / Strict Mode /
        // visibility changes interleave, which can break session reads
        // mid-insert. We accept the trade-off (each context independently
        // refreshes the token) in exchange for reliable auth checks.
        lock: async <R,>(_name: string, _timeout: number, fn: () => Promise<R>): Promise<R> => fn(),
      },
    });
    const auth = new AuthClient(supabase);
    entry = { supabase, auth };
    cache.set(key, entry);
  }
  return entry;
}

export type NoddProviderProps = {
  projectId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  theme?: NoddTheme;
  /**
   * If set, when a user signs in whose email matches this value, the project
   * row (using `projectId`) and an admin `project_members` row for the user
   * are auto-created via the `nodd_bootstrap_project` RPC. Removes the
   * manual SQL setup step for the project owner. Server enforces email match
   * and first-come-first-served: subsequent strangers cannot claim.
   */
  bootstrapAdminEmail?: string;
  /**
   * Display name for the auto-created project. Defaults to "My Prototype".
   * Only used on the first bootstrap call.
   */
  projectName?: string;
  /**
   * If true, any authenticated user (not just the admin) is auto-added to
   * `project_members` as `member` on first sign-in via the `nodd_join_project`
   * RPC. Use this for prototypes you want to share openly — anyone with the
   * deploy URL who can receive the magic-link email becomes a commenter.
   * Without this flag, only the bootstrap admin is auto-membered; teammates
   * must be added via SQL or an invite UI.
   */
  openMembership?: boolean;
  /**
   * If true, logged-out visitors can *read* (but not write) this project's
   * comments. Only takes effect through the `bootstrapAdminEmail` flow: the
   * value is written to `projects.allow_public_reads` when the admin bootstraps
   * (or re-signs-in), which gates the anon SELECT policies added in migration
   * `0004_public_reads.sql`. Without bootstrap, set the column via SQL instead.
   * Off by default — comments stay members-only.
   */
  allowPublicReads?: boolean;
  /**
   * If true, the overlay only mounts while a `<NoddPrototype>` boundary is
   * mounted in the tree — so comments live *inside* prototypes and a catalog /
   * index route (left unwrapped) shows no overlay. Off by default: the overlay
   * appears on every route, preserving existing behavior for consumers that
   * don't adopt `<NoddPrototype>`.
   */
  gateToPrototypes?: boolean;
  /**
   * Navigate to another in-app screen. The prototype inbox uses this to open a
   * thread that lives on a different url_path. Pass your router's push (e.g.
   * `path => router.push(path)`) for SPA navigation with no reload; when
   * omitted, Nodd falls back to a full page load (`window.location.assign`).
   * The target path may carry a `#nodd-thread=<id>` fragment, which the overlay
   * consumes on arrival to auto-open that thread.
   */
  onNavigate?: (path: string) => void;
  children: ReactNode;
};

// Wall-clock "hide until" flag: a timestamp in localStorage so a "Hide for 1
// hour" survives reloads and navigation within the hour, then auto-expires.
// `0`/absent means not set. This is the overlay's only persisted dismissal —
// distinct from the transient `toggleOverlay` state, which isn't persisted.
function hiddenUntilKey(projectId: string): string {
  return `nodd:hidden-until:${projectId}`;
}
function readHiddenUntil(projectId: string): number {
  if (!isBrowser()) return 0;
  try {
    const raw = window.localStorage.getItem(hiddenUntilKey(projectId));
    const ts = raw ? Number(raw) : 0;
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}
function writeHiddenUntil(projectId: string, ts: number): void {
  if (!isBrowser()) return;
  try {
    if (ts > 0) window.localStorage.setItem(hiddenUntilKey(projectId), String(ts));
    else window.localStorage.removeItem(hiddenUntilKey(projectId));
  } catch {
    // private-mode / quota — timed hide stays in-memory for this render only
  }
}

export function NoddProvider({
  projectId,
  supabaseUrl,
  supabaseAnonKey,
  theme: initialTheme = 'system',
  bootstrapAdminEmail,
  projectName = 'My Prototype',
  openMembership = false,
  allowPublicReads = false,
  gateToPrototypes = false,
  onNavigate,
  children,
}: NoddProviderProps) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  // Start hidden if a timed hide ("Hide Nodd for 1 hour") is still in effect.
  const [isVisible, setIsVisible] = useState(() => !(readHiddenUntil(projectId) > Date.now()));
  const [urlPath, setUrlPath] = useState('/');
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [theme, setTheme] = useState<NoddTheme>(initialTheme);
  const [activePrototype, setActivePrototype] = useState<PrototypeScope | null>(null);

  // Module-level singleton — safe across Strict Mode double-render
  const { supabase, auth } = getOrCreateClients(supabaseUrl, supabaseAnonKey);

  // Store is created in useEffect to avoid realtime subscription during render.
  // The variant registry rides the same lifecycle so both are Strict-Mode-safe
  // (recreated on remount, disposed on unmount) and gated by the same
  // `storeReady` flag in ctxValue.
  const storeRef = useRef<CommentStore | null>(null);
  const variantsRef = useRef<VariantRegistry | null>(null);
  const prototypesRef = useRef<PrototypeRegistry | null>(null);
  const [storeReady, setStoreReady] = useState(false);

  useEffect(() => {
    if (!storeRef.current) {
      storeRef.current = createCommentStore({
        supabase,
        projectId,
        getCurrentUserId: () => auth.currentUser?.id ?? null,
      });
    }
    if (!variantsRef.current) {
      variantsRef.current = createVariantRegistry({ projectId });
    }
    if (!prototypesRef.current) {
      prototypesRef.current = createPrototypeRegistry();
    }
    // Load persisted selections from localStorage in an effect (SSR-safe).
    variantsRef.current.hydrate();
    setStoreReady(true);
    return () => {
      storeRef.current?.dispose();
      storeRef.current = null;
      variantsRef.current?.dispose();
      variantsRef.current = null;
      prototypesRef.current?.dispose();
      prototypesRef.current = null;
      setStoreReady(false);
    };
  }, [supabase, projectId, auth]);

  // Auth listener — Supabase emits INITIAL_SESSION on subscription, no need
  // to also call restoreSession() (would race the auth lock under Strict Mode).
  useEffect(() => {
    const unsub = auth.onAuthChange(user => {
      setUser(user);
      // Clean up Supabase magic-link hash fragments after the session is
      // established, so subsequent reloads don't replay stale tokens.
      if (user && isBrowser() && window.location.hash.includes('access_token')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    });
    return unsub;
  }, [auth]);

  // Route detection
  useEffect(() => {
    return subscribeToRouteChanges(setUrlPath);
  }, []);

  // Track the active prototype scope. Reading only through subscribe + state
  // (never a synchronous flush) is what avoids a one-frame overlay unmount
  // during a prototype→prototype route swap: React commits the old subtree's
  // cleanup and the new subtree's registration together, so the batched update
  // lands on the new scope.
  useEffect(() => {
    if (!storeReady) return;
    const registry = prototypesRef.current;
    if (!registry) return;
    setActivePrototype(registry.getActive());
    return registry.subscribe(() => setActivePrototype(registry.getActive()));
  }, [storeReady]);

  // Dev nudge: gating is on but nothing ever registered a scope — the most
  // likely cause of a "the overlay vanished" report is a missing
  // `<NoddPrototype>` wrapper. Warn once, well after mount.
  useEffect(() => {
    if (!gateToPrototypes || !isBrowser()) return;
    const isDev =
      typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
    if (!isDev) return;
    const t = setTimeout(() => {
      if (!prototypesRef.current?.getActive()) {
        console.warn(
          '[nodd] gateToPrototypes is on but no <NoddPrototype> has mounted. ' +
            'The overlay stays hidden until a prototype boundary is on screen — ' +
            'wrap each prototype route in <NoddPrototype id="…">.',
        );
      }
    }, 5_000);
    return () => clearTimeout(t);
  }, [gateToPrototypes]);

  // Auto-onboard: admin claims project + membership; everyone else joins as
  // member when openMembership is on. The overlay stays read-only while this
  // settles so a fast first comment cannot race the membership RLS grant.
  const onboardingAttemptRef = useRef<string | null>(null);
  const activeOnboardingKeyRef = useRef<string | null>(null);
  const [onboarding, setOnboarding] = useState<{
    key: string | null;
    status: NoddWriteStatus;
  }>({ key: null, status: 'joining' });
  const [onboardingRetry, setOnboardingRetry] = useState(0);
  const onboardingKey = user ? `${projectId}:${user.id}` : null;
  const isBootstrapAdmin = !!(
    user &&
    bootstrapAdminEmail &&
    user.email.toLowerCase() === bootstrapAdminEmail.toLowerCase()
  );
  const requiresAutoOnboarding = !!user && (isBootstrapAdmin || openMembership);
  activeOnboardingKeyRef.current = onboardingKey;

  useEffect(() => {
    if (!user || !requiresAutoOnboarding || !onboardingKey) return;
    if (onboarding.key === onboardingKey && onboarding.status === 'ready') return;
    if (onboardingAttemptRef.current === onboardingKey) return;

    onboardingAttemptRef.current = onboardingKey;
    setOnboarding({ key: onboardingKey, status: 'joining' });

    const call = isBootstrapAdmin
      ? supabase.rpc('nodd_bootstrap_project', {
          _project_id: projectId,
          _project_name: projectName,
          _expected_email: bootstrapAdminEmail,
          _allow_public_reads: allowPublicReads,
        })
      : supabase.rpc('nodd_join_project', { _project_id: projectId });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const { error } = await call.abortSignal(controller.signal);
        if (activeOnboardingKeyRef.current !== onboardingKey) return;
        if (error) {
          console.warn('[nodd] onboard failed:', error.message);
          setOnboarding({ key: onboardingKey, status: 'error' });
        } else {
          setOnboarding({ key: onboardingKey, status: 'ready' });
        }
      } catch (error) {
        if (activeOnboardingKeyRef.current !== onboardingKey) return;
        console.warn('[nodd] onboard failed:', error instanceof Error ? error.message : error);
        setOnboarding({ key: onboardingKey, status: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    })();
  }, [
    user,
    onboardingKey,
    onboarding.key,
    onboarding.status,
    onboardingRetry,
    requiresAutoOnboarding,
    isBootstrapAdmin,
    bootstrapAdminEmail,
    allowPublicReads,
    projectId,
    projectName,
    supabase,
  ]);

  const writeStatus: NoddWriteStatus = !requiresAutoOnboarding
    ? 'ready'
    : onboarding.key === onboardingKey
      ? onboarding.status
      : 'joining';

  const retryOnboarding = useCallback(() => {
    onboardingAttemptRef.current = null;
    setOnboardingRetry(value => value + 1);
  }, []);

  // Resolve system theme
  const resolvedTheme = useMemo(() => {
    if (theme !== 'system') return theme;
    if (!isBrowser()) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system' || !isBrowser()) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setTheme(t => t); // force re-render to re-evaluate resolvedTheme
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Portal elements: fixed overlay root + absolute pin container
  const [pinContainerEl, setPinContainerEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!isBrowser()) return;
    // Pin container: position:absolute, scrolls with document
    const pinEl = document.createElement('div');
    pinEl.id = 'nodd-pins';
    pinEl.setAttribute('data-nodd-pin-container', '');
    pinEl.setAttribute('data-nodd-root', '');
    document.body.appendChild(pinEl);
    setPinContainerEl(pinEl);

    // Overlay root: position:fixed, for toolbar/sidebar/popover/capture
    const el = document.createElement('div');
    el.id = 'nodd-root';
    el.setAttribute('data-nodd-root', '');
    document.body.appendChild(el);
    setPortalEl(el);
    return () => {
      document.body.removeChild(el);
      document.body.removeChild(pinEl);
    };
  }, []);

  // Sync theme attribute on portal elements
  useEffect(() => {
    if (portalEl) portalEl.setAttribute('data-nodd-theme', resolvedTheme);
    if (pinContainerEl) pinContainerEl.setAttribute('data-nodd-theme', resolvedTheme);
  }, [portalEl, pinContainerEl, resolvedTheme]);

  // Showing the overlay (toggle-on or explicit) also clears any timed hide,
  // so the host's own launcher brings it back after "Hide Nodd for 1 hour".
  const setVisible = useCallback((v: boolean) => {
    writeHiddenUntil(projectId, 0);
    setIsVisible(v);
  }, [projectId]);

  const toggleOverlay = useCallback(() => {
    setIsVisible(v => {
      const next = !v;
      writeHiddenUntil(projectId, 0);
      return next;
    });
  }, [projectId]);

  // Dismiss for a wall-clock duration ("Hide Nodd for 1 hour"). Persisted as an
  // expiry timestamp so it survives reloads within the window, then the effect
  // below (or a fresh mount) auto-reveals. C/V also reveal early — see effect.
  const hideForDuration = useCallback((ms: number) => {
    writeHiddenUntil(projectId, Date.now() + ms);
    setIsVisible(false);
  }, [projectId]);

  // While the overlay is hidden it (and its keyboard handler) is unmounted, so
  // reveal lives here: a timed hide auto-expires, and pressing C or V brings it
  // back (surfaced as the "Press C or V to show" hint in the toolbar menu).
  useEffect(() => {
    if (isVisible || !isBrowser()) return;
    const until = readHiddenUntil(projectId);
    const timer = until > Date.now()
      ? window.setTimeout(() => setVisible(true), until - Date.now())
      : undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const el = ev.target;
      if (el instanceof HTMLElement &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
           el.tagName === 'SELECT' || el.isContentEditable)) return;
      // matchesKey also checks the physical key, so C/V reveal works on
      // non-Latin layouts (e.g. Russian, where they emit "с"/"м").
      if (matchesKey(ev, 'c') || matchesKey(ev, 'v')) setVisible(true);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isVisible, projectId, setVisible]);

  const signIn = useCallback(
    (email: string, displayName?: string) => auth.signIn(email, displayName),
    [auth],
  );

  const signOut = useCallback(() => auth.signOut(), [auth]);

  // Router-agnostic navigation for cross-screen inbox jumps. Prefer the host's
  // router (no reload, overlay state preserved); otherwise a full-page load,
  // after which the deep-link fragment re-opens the thread on the new screen.
  const navigate = useCallback((path: string) => {
    if (onNavigate) onNavigate(path);
    else if (isBrowser()) window.location.assign(path);
  }, [onNavigate]);

  const store = storeRef.current;
  const variants = variantsRef.current;
  const prototypes = prototypesRef.current;

  const ctxValue: NoddContextValue | null = useMemo(() => {
    if (!store || !variants || !prototypes) return null;
    return {
      projectId,
      user,
      signIn,
      signOut,
      isVisible,
      toggleOverlay,
      setVisible,
      hideForDuration,
      theme,
      setTheme,
      urlPath,
      auth,
      writeStatus,
      retryOnboarding,
      store,
      variants,
      prototypes,
      activePrototype,
      navigate,
      pinContainer: pinContainerEl,
    };
  }, [projectId, user, signIn, signOut, isVisible, toggleOverlay, setVisible, hideForDuration, theme, urlPath, auth, writeStatus, retryOnboarding, store, variants, prototypes, activePrototype, navigate, storeReady, pinContainerEl]);

  if (!ctxValue) {
    return <>{children}</>;
  }

  // When gating is on, the overlay only mounts inside a `<NoddPrototype>` — so
  // the catalog/index route shows nothing. Full unmount (not just hidden)
  // preserves the "zero host impact when off" invariant and resets transient
  // overlay state on prototype exit.
  const overlayActive = !gateToPrototypes || !!activePrototype;

  return (
    <NoddContext.Provider value={ctxValue}>
      {children}
      {portalEl && isVisible && overlayActive ? createPortal(<OverlayRenderer />, portalEl) : null}
    </NoddContext.Provider>
  );
}
