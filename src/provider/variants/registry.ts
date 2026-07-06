// Variant registry — per-provider, created once in NoddProvider (same
// Strict-Mode-safe ref pattern as CommentStore) and exposed through
// NoddContext. Holds the variant *definitions* declared in code and the
// current viewer's per-variant *selection*, persisted to localStorage.
//
// Definitions persist for the whole session even after the registering
// component unmounts (mountCount drops to 0) — mirrors the module-level
// rationale in ../state/activator.ts: the panel and the "Show me" activators
// must keep working for off-screen variants.

import { isBrowser } from '../ssr';
import { registerActivator } from '../state/activator';

export type VariantScope = 'global' | 'page';

export type VariantDefinition = {
  key: string;
  /** First registration wins; a later mismatch warns in dev. */
  options: string[];
  label?: string;
  declaredScope?: VariantScope;
  /** Every urlPath this key was mounted on this session. */
  paths: Set<string>;
  /** Ref count of currently mounted hooks. */
  mountCount: number;
};

export type VariantRegistration = {
  key: string;
  options: string[];
  label?: string;
  scope?: VariantScope;
};

export type VariantRegistry = {
  register(def: VariantRegistration, urlPath: string): () => void;
  getDefinitions(): VariantDefinition[];
  getValue(key: string): string;
  setSelection(key: string, option: string): void;
  resolveScope(key: string): VariantScope;
  subscribe(cb: () => void): () => void;
  hydrate(): void;
  dispose(): void;
};

/**
 * Variant keys and options must not contain `/` (breaks stackToKey) or `:`
 * (our state-segment separator). Same spirit as NoddState's sanitize.
 */
export function sanitizeVariantSegment(name: string): string {
  return name.trim().replace(/[/:]/g, '-');
}

const isDev =
  typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

function optionsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function createVariantRegistry(opts: { projectId: string }): VariantRegistry {
  const storageKey = `nodd:variants:${opts.projectId}`;

  const definitions = new Map<string, VariantDefinition>();
  const selections = new Map<string, string>();
  const listeners = new Set<() => void>();
  const activatorCleanups: Array<() => void> = [];

  function notify() {
    for (const l of listeners) l();
  }

  function persist() {
    if (!isBrowser()) return;
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of selections) obj[k] = v;
      window.localStorage.setItem(storageKey, JSON.stringify(obj));
    } catch {
      // private-mode Safari / quota — selections stay in-memory this session
    }
  }

  function setSelection(key: string, option: string): void {
    const sKey = sanitizeVariantSegment(key);
    const sOption = sanitizeVariantSegment(option);
    const def = definitions.get(sKey);
    // Validate against the definition when we know it; a stored/renamed option
    // that's no longer present is ignored (falls back to default via getValue).
    if (def && !def.options.includes(sOption)) return;
    if (selections.get(sKey) === sOption) return;
    selections.set(sKey, sOption);
    persist();
    notify();
  }

  return {
    register(input, urlPath) {
      const sKey = sanitizeVariantSegment(input.key);
      const sOptions = input.options.map(sanitizeVariantSegment);
      let def = definitions.get(sKey);
      if (!def) {
        def = {
          key: sKey,
          options: sOptions,
          label: input.label,
          declaredScope: input.scope,
          paths: new Set(),
          mountCount: 0,
        };
        definitions.set(sKey, def);
        // Register one stable activator per option so "Show me" on an
        // off-screen comment can flip the variant. Kept for the session;
        // dispose() unregisters them.
        for (const opt of sOptions) {
          activatorCleanups.push(
            registerActivator(`${sKey}:${opt}`, () => setSelection(sKey, opt)),
          );
        }
      } else {
        if (isDev && !optionsEqual(def.options, sOptions)) {
          console.warn(
            `[nodd] variant "${sKey}" re-declared with different options ` +
              `(${JSON.stringify(def.options)} vs ${JSON.stringify(sOptions)}). ` +
              `First registration wins.`,
          );
        }
        // Fill in metadata the first registration may have omitted.
        if (input.label && !def.label) def.label = input.label;
        if (input.scope && !def.declaredScope) def.declaredScope = input.scope;
      }
      def.paths.add(urlPath);
      def.mountCount += 1;
      notify();

      return () => {
        const d = definitions.get(sKey);
        if (d) {
          d.mountCount = Math.max(0, d.mountCount - 1);
          notify();
        }
      };
    },

    getDefinitions() {
      return Array.from(definitions.values());
    },

    getValue(key) {
      const sKey = sanitizeVariantSegment(key);
      const def = definitions.get(sKey);
      const sel = selections.get(sKey);
      if (def) {
        if (sel && def.options.includes(sel)) return sel;
        return def.options[0] ?? '';
      }
      // Definition not registered yet (first render before the mount effect):
      // surface any hydrated selection so the correct option can render early.
      return sel ?? '';
    },

    setSelection,

    resolveScope(key) {
      const def = definitions.get(sanitizeVariantSegment(key));
      if (!def) return 'page';
      return def.declaredScope ?? (def.paths.size > 1 ? 'global' : 'page');
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    hydrate() {
      if (!isBrowser()) return;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return;
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string') {
              selections.set(sanitizeVariantSegment(k), sanitizeVariantSegment(v));
            }
          }
          notify();
        }
      } catch {
        // corrupt/unavailable storage — start with no selections
      }
    },

    dispose() {
      for (const c of activatorCleanups) c();
      activatorCleanups.length = 0;
      listeners.clear();
      definitions.clear();
      selections.clear();
    },
  };
}
