import React, { useContext, useMemo, type ReactNode } from 'react';
import { NoddStateContext } from './NoddStateContext';
import { detectAutoSegment } from './autoState';
import { detectFloatingSegment, findFloatingAncestor } from './floatingState';

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
//
// Only if that finds nothing do we fall back to the structural signal in
// `floatingState.ts`, which catches overlays carrying no ARIA. Confining it to
// the empty case is what makes it safe to add: a thread that already resolved
// to some stack keeps resolving to exactly that stack, and a thread whose key
// is empty matches every state anyway — so no existing comment changes
// behaviour, only new ones gain a scope they previously went without.
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
  if (stack.length > 0) return stack;

  const floating = findFloatingAncestor(el);
  const segment = floating ? detectFloatingSegment(floating) : null;
  return segment ? [segment] : [];
}
