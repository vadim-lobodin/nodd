import React, { useContext, useMemo, type ReactNode } from 'react';
import { NoddStateContext } from './NoddStateContext';

export type NoddStateProps = {
  name: string;
  children: ReactNode;
};

function sanitize(name: string): string {
  return name.trim().replace(/\//g, '-');
}

export function NoddState({ name, children }: NoddStateProps) {
  const parent = useContext(NoddStateContext);
  const segment = sanitize(name);
  const value = useMemo(() => {
    if (!segment) return parent;
    return Object.freeze([...parent, segment]);
  }, [parent, segment]);

  return (
    <NoddStateContext.Provider value={value}>
      <div data-nodd-state={segment || undefined} style={{ display: 'contents' }}>
        {children}
      </div>
    </NoddStateContext.Provider>
  );
}

export function getStateStackForElement(el: Element | null): string[] {
  const stack: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    if (cur.hasAttribute('data-nodd-state')) {
      const v = cur.getAttribute('data-nodd-state');
      if (v) stack.unshift(v);
    }
    cur = cur.parentElement;
  }
  return stack;
}
