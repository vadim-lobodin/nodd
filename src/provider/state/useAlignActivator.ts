import { useEffect, useState } from 'react';
import { registerActivator, subscribeActivators, hasActivatorOrTrigger, type Activator } from './activator';

/**
 * Register a function that activates the named state when called. The
 * activator should mount the matching `<AlignState name="...">` (e.g. open
 * the modal, navigate to the wizard step). Mount this hook *outside* any
 * conditional render so the activator stays registered even when the state
 * is currently inactive — that's the whole point.
 */
export function useAlignActivator(name: string, fn: Activator): void {
  useEffect(() => {
    return registerActivator(name, fn);
  }, [name, fn]);
}

/**
 * Returns whether the given state stack can be activated right now —
 * either an activator is registered for each segment, or a
 * `[data-align-open-state]` trigger exists in the current DOM.
 *
 * Re-evaluates when activators change or when the DOM mutates (so a
 * trigger appearing on a newly-loaded page becomes available).
 */
export function useCanActivate(stack: readonly string[]): boolean {
  const [ok, setOk] = useState(() => stack.every(s => hasActivatorOrTrigger(s)));
  useEffect(() => {
    const recheck = () => setOk(stack.every(s => hasActivatorOrTrigger(s)));
    recheck();
    const unsub = subscribeActivators(recheck);
    if (typeof window === 'undefined') return unsub;
    const mo = new MutationObserver(recheck);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      unsub();
      mo.disconnect();
    };
  }, [stack.join('/')]);
  return ok;
}
