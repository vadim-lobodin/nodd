import React, { useContext, useMemo, type ReactNode } from 'react';
import { AlignStateContext } from './AlignStateContext';

export type AlignStateProps = {
  name: string;
  children: ReactNode;
};

function sanitize(name: string): string {
  return name.trim().replace(/\//g, '-');
}

export function AlignState({ name, children }: AlignStateProps) {
  const parent = useContext(AlignStateContext);
  const segment = sanitize(name);
  const value = useMemo(() => {
    if (!segment) return parent;
    return Object.freeze([...parent, segment]);
  }, [parent, segment]);

  return (
    <AlignStateContext.Provider value={value}>
      <div data-align-state={segment || undefined} style={{ display: 'contents' }}>
        {children}
      </div>
    </AlignStateContext.Provider>
  );
}

export function getStateStackForElement(el: Element | null): string[] {
  const stack: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    if (cur.hasAttribute('data-align-state')) {
      const v = cur.getAttribute('data-align-state');
      if (v) stack.unshift(v);
    }
    cur = cur.parentElement;
  }
  return stack;
}
