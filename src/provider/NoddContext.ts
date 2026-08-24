import { createContext, useContext } from 'react';
import type { AuthClient, CurrentUser } from '../auth';
import type { CommentStore } from '../store';
import type { VariantRegistry } from './variants';
import type { PrototypeRegistry, PrototypeScope } from './scope';

export type NoddTheme = 'light' | 'dark' | 'system';
export type NoddWriteStatus = 'ready' | 'joining' | 'error';

export type NoddContextValue = {
  projectId: string;
  user: CurrentUser | null;
  signIn: (email: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  isVisible: boolean;
  toggleOverlay: () => void;
  setVisible: (v: boolean) => void;
  /** Dismiss the overlay for a wall-clock duration in ms (e.g. 1 hour). */
  hideForDuration: (ms: number) => void;
  theme: NoddTheme;
  setTheme: (theme: NoddTheme) => void;
  urlPath: string;
  /**
   * Null when the provider runs with comments off — no Supabase credentials, or
   * a backend that turned out to be unreachable. There is no session to speak
   * of in that mode, so the comment chrome that reads this is unmounted.
   */
  auth: AuthClient | null;
  /**
   * False when there is no comment backend: `store` is a null store, `auth` is
   * null, and the overlay shows variants only. Variants, `<NoddState>` and view
   * state are client-side and unaffected.
   */
  commentsEnabled: boolean;
  /** Auto-membership must settle before the overlay enables mutations. */
  writeStatus: NoddWriteStatus;
  retryOnboarding: () => void;
  store: CommentStore;
  variants: VariantRegistry;
  /** Registry of mounted `<NoddPrototype>` scopes (gates the overlay). */
  prototypes: PrototypeRegistry;
  /** The innermost currently-mounted prototype scope, or null. */
  activePrototype: PrototypeScope | null;
  /**
   * Navigate to another screen (used by the prototype inbox to open a thread on
   * a different url_path). Uses the host router via NoddProvider's `onNavigate`
   * when provided, else falls back to a full page load.
   */
  navigate: (path: string) => void;
  pinContainer: HTMLElement | null;
};

const defaultSignIn = async () => {};
const defaultSignOut = async () => {};
const noop = () => {};

export const NoddContext = createContext<NoddContextValue | null>(null);

export function useNodd(): {
  user: CurrentUser | null;
  signIn: (email: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  toggleOverlay: () => void;
  hideForDuration: (ms: number) => void;
  isVisible: boolean;
  theme: NoddTheme;
  setTheme: (theme: NoddTheme) => void;
} {
  const ctx = useContext(NoddContext);
  if (!ctx) {
    return {
      user: null,
      signIn: defaultSignIn,
      signOut: defaultSignOut,
      toggleOverlay: noop,
      hideForDuration: noop,
      isVisible: false,
      theme: 'system',
      setTheme: noop,
    };
  }
  return {
    user: ctx.user,
    signIn: ctx.signIn,
    signOut: ctx.signOut,
    toggleOverlay: ctx.toggleOverlay,
    hideForDuration: ctx.hideForDuration,
    isVisible: ctx.isVisible,
    theme: ctx.theme,
    setTheme: ctx.setTheme,
  };
}

export function useNoddContext(): NoddContextValue {
  const ctx = useContext(NoddContext);
  if (!ctx) {
    throw new Error('useNoddContext must be used within an NoddProvider');
  }
  return ctx;
}
