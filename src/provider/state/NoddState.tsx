import React, { useContext, useMemo, type ReactNode } from 'react';
import { NoddStateContext } from './NoddStateContext';
import { detectAutoSegment } from './autoState';
import { detectFloatingSegment, findFloatingAncestor } from './floatingState';
import { detectControlledSegment, findControlledAncestor } from './controlledState';

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
// Only if that finds nothing do we fall back — first to the structural signal
// in `floatingState.ts` (overlays carrying no ARIA), then to the disclosure
// signal in `controlledState.ts` (content named by an `aria-expanded` control).
// Confining both to the empty case is what makes them safe to add: a thread
// that already resolved to some stack keeps resolving to exactly that stack,
// and a thread whose key is empty matches every state anyway — so no existing
// comment changes behaviour, only new ones gain a scope they went without.
//
// Floating is tried before controlled for the same reason, and only that
// reason: it shipped first, so every `float:` thread already in the wild must
// keep resolving to `float:`. On a portalled popover both signals fire.
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
  const floatSegment = floating ? detectFloatingSegment(floating) : null;
  if (floatSegment) return [floatSegment];

  const controlled = findControlledAncestor(el);
  const ctlSegment = controlled ? detectControlledSegment(controlled) : null;
  return ctlSegment ? [ctlSegment] : [];
}
