import { useContext, useEffect, useSyncExternalStore } from 'react';
import { NoddContext } from '../NoddContext';
import { sanitizeVariantSegment, type VariantScope } from './registry';

export type UseVariantOptions = {
  /** Panel display name. Falls back to the key. */
  label?: string;
  /** Forces the Global section regardless of how many pages mount it. */
  scope?: VariantScope;
};

/**
 * Feature-flag-style hook. Returns the active option for `key` (default:
 * `options[0]`). Safe to call without a `<NoddProvider>` — returns `options[0]`
 * and never throws.
 *
 * Prefer the `<Variant>` component when you want variant-aware comments: the
 * hook alone adds no `data-nodd-state` wrapper, so comments placed in
 * hook-controlled regions are not tagged with the active option.
 */
export function useVariant(
  key: string,
  options: string[],
  opts?: UseVariantOptions,
): string {
  const ctx = useContext(NoddContext);
  const registry = ctx?.variants ?? null;
  const urlPath = ctx?.urlPath ?? '/';
  const sKey = sanitizeVariantSegment(key);
  const optionsSig = options.join('|');
  const label = opts?.label;
  const scope = opts?.scope;

  // Register on mount, unregister on unmount. Re-register when the path
  // changes so the definition's `paths` accumulates (drives global scoping).
  useEffect(() => {
    if (!registry) return;
    return registry.register({ key, options, label, scope }, urlPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, sKey, optionsSig, urlPath, label, scope]);

  const active = useSyncExternalStore(
    cb => (registry ? registry.subscribe(cb) : () => {}),
    () => (registry ? registry.getValue(sKey) : options[0]),
    () => options[0], // server snapshot — always the default
  );

  // The registry works in sanitized space; map the active option back to the
  // exact string the caller passed so feature-flag comparisons work and the
  // <Variant> block lookup hits.
  return options.find(o => sanitizeVariantSegment(o) === active) ?? options[0];
}
