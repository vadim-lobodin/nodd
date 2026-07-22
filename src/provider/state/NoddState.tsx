import React, { useContext, useMemo, type ReactNode } from 'react';
import { NoddStateContext } from './NoddStateContext';
import { detectAutoSegment } from './autoState';

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

// Walk from `el` to the root collecting state segments in top-down order.
// Explicit `<NoddState>` markers (`data-nodd-state`) take precedence per node;
// otherwise an open ARIA overlay ancestor contributes an auto-detected segment
// so comments inside modals/menus are scoped without host instrumentation.
export function getStateStackForElement(el: Element | null): string[] {
  const stack: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    if (cur.hasAttribute('data-nodd-state')) {
      const v = cur.getAttribute('data-nodd-state');
      if (v) stack.unshift(v);
    } else {
      const auto = detectAutoSegment(cur);
      if (auto) stack.unshift(auto);
    }
    cur = cur.parentElement;
  }
  return stack;
}
