import { createContext, useContext } from 'react';
import type { AuthClient, CurrentUser } from '../auth';
import type { CommentStore } from '../store';
import type { VariantRegistry } from './variants';

export type NoddTheme = 'light' | 'dark' | 'system';

export type NoddContextValue = {
  projectId: string;
  user: CurrentUser | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  isVisible: boolean;
  toggleOverlay: () => void;
  setVisible: (v: boolean) => void;
  theme: NoddTheme;
  setTheme: (theme: NoddTheme) => void;
  urlPath: string;
  auth: AuthClient;
  store: CommentStore;
  variants: VariantRegistry;
  pinContainer: HTMLElement | null;
};

const defaultSignIn = async () => {};
const defaultSignOut = async () => {};
const noop = () => {};

export const NoddContext = createContext<NoddContextValue | null>(null);

export function useNodd(): {
  user: CurrentUser | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  toggleOverlay: () => void;
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

export function useNoddContext(): NoddContextValue {
  const ctx = useContext(NoddContext);
  if (!ctx) {
    throw new Error('useNoddContext must be used within an NoddProvider');
  }
  return ctx;
}
