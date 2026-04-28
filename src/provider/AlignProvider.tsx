import React, { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AlignContext, type AlignContextValue, type AlignTheme } from './AlignContext';
import { AuthClient, type CurrentUser } from '../auth';
import { createCommentStore, type CommentStore } from '../store';
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
const CACHE_KEY = '__align_client_cache__' as const;
type ClientEntry = { supabase: SupabaseClient; auth: AuthClient };

function getOrCreateClients(supabaseUrl: string, supabaseAnonKey: string): ClientEntry {
  const g = globalThis as any;
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map<string, ClientEntry>();
  const cache = g[CACHE_KEY] as Map<string, ClientEntry>;

  const key = `${supabaseUrl}::${supabaseAnonKey}`;
  let entry = cache.get(key);
  if (!entry) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: 'align-auth',
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

export type AlignProviderProps = {
  projectId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  theme?: AlignTheme;
  children: ReactNode;
};

export function AlignProvider({
  projectId,
  supabaseUrl,
  supabaseAnonKey,
  theme: initialTheme = 'system',
  children,
}: AlignProviderProps) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [urlPath, setUrlPath] = useState('/');
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [theme, setTheme] = useState<AlignTheme>(initialTheme);

  // Module-level singleton — safe across Strict Mode double-render
  const { supabase, auth } = getOrCreateClients(supabaseUrl, supabaseAnonKey);

  // Store is created in useEffect to avoid realtime subscription during render
  const storeRef = useRef<CommentStore | null>(null);
  const [storeReady, setStoreReady] = useState(false);

  useEffect(() => {
    if (!storeRef.current) {
      storeRef.current = createCommentStore({
        supabase,
        projectId,
        getCurrentUserId: () => auth.currentUser?.id ?? null,
      });
      setStoreReady(true);
    }
    return () => {
      storeRef.current?.dispose();
      storeRef.current = null;
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
    pinEl.id = 'align-pins';
    pinEl.setAttribute('data-align-pin-container', '');
    document.body.appendChild(pinEl);
    setPinContainerEl(pinEl);

    // Overlay root: position:fixed, for toolbar/sidebar/popover/capture
    const el = document.createElement('div');
    el.id = 'align-root';
    el.setAttribute('data-align-root', '');
    document.body.appendChild(el);
    setPortalEl(el);
    return () => {
      document.body.removeChild(el);
      document.body.removeChild(pinEl);
    };
  }, []);

  // Sync theme attribute on portal elements
  useEffect(() => {
    if (portalEl) portalEl.setAttribute('data-align-theme', resolvedTheme);
    if (pinContainerEl) pinContainerEl.setAttribute('data-align-theme', resolvedTheme);
  }, [portalEl, pinContainerEl, resolvedTheme]);

  const toggleOverlay = useCallback(() => setIsVisible(v => !v), []);

  const signIn = useCallback(
    (email: string) => auth.signIn(email),
    [auth],
  );

  const signOut = useCallback(() => auth.signOut(), [auth]);

  const store = storeRef.current;

  const ctxValue: AlignContextValue | null = useMemo(() => {
    if (!store) return null;
    return {
      projectId,
      user,
      signIn,
      signOut,
      isVisible,
      toggleOverlay,
      setVisible: setIsVisible,
      theme,
      setTheme,
      urlPath,
      auth,
      store,
      pinContainer: pinContainerEl,
    };
  }, [projectId, user, signIn, signOut, isVisible, toggleOverlay, theme, urlPath, auth, store, storeReady, pinContainerEl]);

  if (!ctxValue) {
    return <>{children}</>;
  }

  return (
    <AlignContext.Provider value={ctxValue}>
      {children}
      {portalEl && isVisible ? createPortal(<OverlayRenderer />, portalEl) : null}
    </AlignContext.Provider>
  );
}
