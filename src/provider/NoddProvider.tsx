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
import { OverlayRenderer } from '../overlay';
import { subscribeToRouteChanges } from './useRouteChange';
import { isBrowser } from './ssr';

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
  children: ReactNode;
};

// Session-scoped "hide" flag. Distinct from the transient `toggleOverlay`
// state: it survives reloads within the same tab (sessionStorage) so a viewer
// who dismisses the overlay isn't nagged on every navigation, but a fresh tab
// starts visible again.
function hiddenStorageKey(projectId: string): string {
  return `nodd:hidden:${projectId}`;
}
function readSessionHidden(projectId: string): boolean {
  if (!isBrowser()) return false;
  try {
    return window.sessionStorage.getItem(hiddenStorageKey(projectId)) === '1';
  } catch {
    return false;
  }
}
function writeSessionHidden(projectId: string, hidden: boolean): void {
  if (!isBrowser()) return;
  try {
    if (hidden) window.sessionStorage.setItem(hiddenStorageKey(projectId), '1');
    else window.sessionStorage.removeItem(hiddenStorageKey(projectId));
  } catch {
    // private-mode / quota — hide stays in-memory for this render only
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
  children,
}: NoddProviderProps) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  // Start hidden if this tab's session was dismissed via "Hide for this session".
  const [isVisible, setIsVisible] = useState(() => !readSessionHidden(projectId));
  const [urlPath, setUrlPath] = useState('/');
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [theme, setTheme] = useState<NoddTheme>(initialTheme);

  // Module-level singleton — safe across Strict Mode double-render
  const { supabase, auth } = getOrCreateClients(supabaseUrl, supabaseAnonKey);

  // Store is created in useEffect to avoid realtime subscription during render.
  // The variant registry rides the same lifecycle so both are Strict-Mode-safe
  // (recreated on remount, disposed on unmount) and gated by the same
  // `storeReady` flag in ctxValue.
  const storeRef = useRef<CommentStore | null>(null);
  const variantsRef = useRef<VariantRegistry | null>(null);
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
    // Load persisted selections from localStorage in an effect (SSR-safe).
    variantsRef.current.hydrate();
    setStoreReady(true);
    return () => {
      storeRef.current?.dispose();
      storeRef.current = null;
      variantsRef.current?.dispose();
      variantsRef.current = null;
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

  // Showing the overlay (toggle-on or explicit) also clears any session-hide,
  // so the host's own launcher brings it back after "Hide for this session".
  const setVisible = useCallback((v: boolean) => {
    writeSessionHidden(projectId, false);
    setIsVisible(v);
  }, [projectId]);

  const toggleOverlay = useCallback(() => {
    setIsVisible(v => {
      const next = !v;
      writeSessionHidden(projectId, false);
      return next;
    });
  }, [projectId]);

  // Dismiss for the rest of this tab's session — persisted so reloads/navigation
  // don't re-show it, until the host re-shows or the tab closes.
  const hideForSession = useCallback(() => {
    writeSessionHidden(projectId, true);
    setIsVisible(false);
  }, [projectId]);

  const signIn = useCallback(
    (email: string) => auth.signIn(email),
    [auth],
  );

  const signOut = useCallback(() => auth.signOut(), [auth]);

  const store = storeRef.current;
  const variants = variantsRef.current;

  const ctxValue: NoddContextValue | null = useMemo(() => {
    if (!store || !variants) return null;
    return {
      projectId,
      user,
      signIn,
      signOut,
      isVisible,
      toggleOverlay,
      setVisible,
      hideForSession,
      theme,
      setTheme,
      urlPath,
      auth,
      writeStatus,
      retryOnboarding,
      store,
      variants,
      pinContainer: pinContainerEl,
    };
  }, [projectId, user, signIn, signOut, isVisible, toggleOverlay, setVisible, hideForSession, theme, urlPath, auth, writeStatus, retryOnboarding, store, variants, storeReady, pinContainerEl]);

  if (!ctxValue) {
    return <>{children}</>;
  }

  return (
    <NoddContext.Provider value={ctxValue}>
      {children}
      {portalEl && isVisible ? createPortal(<OverlayRenderer />, portalEl) : null}
    </NoddContext.Provider>
  );
}
