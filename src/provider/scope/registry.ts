// Prototype-scope registry — per-provider, created once in NoddProvider (same
// Strict-Mode-safe ref pattern as CommentStore and the variant registry) and
// exposed through NoddContext.
//
// A `<NoddPrototype>` boundary registers on mount and unregisters on unmount.
// The overlay is gated on whether *any* scope is currently mounted: on the
// catalog nothing is wrapped, so `getActive()` is null and the overlay stays
// off (see `gateToPrototypes` in NoddProvider). Unlike the variant registry
// this holds no persisted state — just live mount tracking.
//
// Invariant against flicker: consumers must read `getActive()` only through
// `subscribe` + React state, never synchronously flush on notify. During a
// prototype→prototype route swap React commits the old subtree's cleanup and
// the new subtree's mount effects together, so the batched state update lands
// on the new scope; the transient count-0 is never rendered.

export type PrototypeScope = {
  /** Stable identity of the prototype. Used for gating and (phase 2) grouping. */
  id: string;
  /** Optional human label for future panel/inbox UIs. */
  label?: string;
};

export type PrototypeRegistry = {
  /** Register a mounted scope; returns a cleanup to call on unmount. */
  register(scope: PrototypeScope): () => void;
  /** The innermost currently-mounted scope, or null when none is mounted. */
  getActive(): PrototypeScope | null;
  subscribe(cb: () => void): () => void;
  dispose(): void;
};

const isDev =
  typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

export function createPrototypeRegistry(): PrototypeRegistry {
  // Ref-count per id (Strict-Mode double-mount and duplicate ids collapse here)
  // plus an ordered stack of live ids so `getActive` returns the innermost /
  // most-recently mounted scope. Nesting is allowed but warned about in dev,
  // since a prototype inside a prototype is usually a mistake.
  const counts = new Map<string, number>();
  const labels = new Map<string, string | undefined>();
  const stack: string[] = [];
  const listeners = new Set<() => void>();

  function notify() {
    for (const l of listeners) l();
  }

  return {
    register(scope) {
      const id = scope.id;
      const prev = counts.get(id) ?? 0;
      counts.set(id, prev + 1);
      if (scope.label !== undefined) labels.set(id, scope.label);
      stack.push(id);

      if (isDev && stack.length > 1 && stack[stack.length - 2] !== id) {
        console.warn(
          `[nodd] <NoddPrototype id="${id}"> mounted inside ` +
            `"${stack[stack.length - 2]}". Nested prototype scopes are unusual; ` +
            `the innermost wins for gating and grouping.`,
        );
      }

      notify();

      let cleaned = false;
      return () => {
        if (cleaned) return;
        cleaned = true;
        const c = counts.get(id) ?? 0;
        if (c <= 1) {
          counts.delete(id);
          labels.delete(id);
        } else {
          counts.set(id, c - 1);
        }
        // Remove the last occurrence of this id from the stack.
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i] === id) {
            stack.splice(i, 1);
            break;
          }
        }
        notify();
      };
    },

    getActive() {
      for (let i = stack.length - 1; i >= 0; i--) {
        const id = stack[i];
        if ((counts.get(id) ?? 0) > 0) {
          return { id, label: labels.get(id) };
        }
      }
      return null;
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    dispose() {
      listeners.clear();
      counts.clear();
      labels.clear();
      stack.length = 0;
    },
  };
}
