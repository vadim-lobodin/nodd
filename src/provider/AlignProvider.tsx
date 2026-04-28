import React, { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AlignContext, type AlignContextValue, type AlignTheme } from './AlignContext';
import { AuthClient, type CurrentUser } from '../auth';
import { createCommentStore, type CommentStore } from '../store';
import { OverlayRenderer } from '../overlay';
import { subscribeToRouteChanges } from './useRouteChange';
import { isBrowser } from './ssr';

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

  // Use refs to create stable singleton instances that survive Strict Mode double-mount
  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) {
    supabaseRef.current = createClient(supabaseUrl, supabaseAnonKey);
  }
  const supabase = supabaseRef.current;

  const authRef = useRef<AuthClient | null>(null);
  if (!authRef.current) {
    authRef.current = new AuthClient(supabase);
  }
  const auth = authRef.current;

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

  // Auth listener
  useEffect(() => {
    const unsub = auth.onAuthChange(setUser);
    void auth.restoreSession();
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
