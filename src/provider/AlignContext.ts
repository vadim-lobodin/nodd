import { createContext, useContext } from 'react';
import type { AuthClient, CurrentUser } from '../auth';
import type { CommentStore } from '../store';

export type AlignTheme = 'light' | 'dark' | 'system';

export type AlignContextValue = {
  projectId: string;
  user: CurrentUser | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  isVisible: boolean;
  toggleOverlay: () => void;
  setVisible: (v: boolean) => void;
  theme: AlignTheme;
  setTheme: (theme: AlignTheme) => void;
  urlPath: string;
  auth: AuthClient;
  store: CommentStore;
  pinContainer: HTMLElement | null;
};

const defaultSignIn = async () => {};
const defaultSignOut = async () => {};
const noop = () => {};

export const AlignContext = createContext<AlignContextValue | null>(null);

export function useAlign(): {
  user: CurrentUser | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  toggleOverlay: () => void;
  isVisible: boolean;
  theme: AlignTheme;
  setTheme: (theme: AlignTheme) => void;
} {
  const ctx = useContext(AlignContext);
  if (!ctx) {
    return {
      user: null,
      signIn: defaultSignIn,
      signOut: defaultSignOut,
      toggleOverlay: noop,
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
    isVisible: ctx.isVisible,
    theme: ctx.theme,
    setTheme: ctx.setTheme,
  };
}

export function useAlignContext(): AlignContextValue {
  const ctx = useContext(AlignContext);
  if (!ctx) {
    throw new Error('useAlignContext must be used within an AlignProvider');
  }
  return ctx;
}
