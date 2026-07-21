import React, { useContext, useEffect, type ReactNode } from 'react';
import { NoddContext } from '../NoddContext';
import type { PrototypeScope } from './registry';

export type NoddPrototypeProps = {
  /** Stable identity of the prototype (route id, slug, …). */
  id: string;
  /** Optional human label for future panel/inbox UIs. */
  label?: string;
  children: ReactNode;
};

/**
 * Register the subtree as a prototype scope for as long as it is mounted.
 *
 * Reads the context defensively via `useContext` (not the throwing
 * `useNoddContext`): while the provider is still booting its store/registries
 * `ctxValue` is null and no context is published (NoddProvider renders children
 * bare). Registration simply defers until the registry appears — the effect's
 * dep on `registry` re-runs it then.
 */
export function useNoddPrototype(scope: PrototypeScope): void {
  const ctx = useContext(NoddContext);
  const registry = ctx?.prototypes ?? null;
  const { id, label } = scope;

  useEffect(() => {
    if (!registry) return;
    return registry.register({ id, label });
  }, [registry, id, label]);
}

/**
 * Boundary that marks its subtree as a prototype. When the provider's
 * `gateToPrototypes` is on, the overlay only mounts while at least one
 * `<NoddPrototype>` is mounted — so a catalog/index route (left unwrapped)
 * shows no overlay. Renders a fragment: zero layout or DOM impact.
 */
export function NoddPrototype({ id, label, children }: NoddPrototypeProps) {
  useNoddPrototype({ id, label });
  return <>{children}</>;
}
