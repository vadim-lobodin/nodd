// Activator registry — module-level so activators stay registered even when
// their target `<NoddState>` is unmounted. Hosts call `useNoddActivator(name, fn)`
// outside their conditional render so the activator is always available.

import { isAutoSegment, findAutoStateElement, findAutoTrigger } from './autoState';

export type Activator = () => void | Promise<void>;

const activators = new Map<string, Activator>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function registerActivator(name: string, fn: Activator): () => void {
  activators.set(name, fn);
  notify();
  return () => {
    if (activators.get(name) === fn) {
      activators.delete(name);
      notify();
    }
  };
}

export function getActivator(name: string): Activator | undefined {
  return activators.get(name);
}

export function hasActivatorOrTrigger(name: string): boolean {
  if (isAutoSegment(name)) return findAutoTrigger(name) !== null;
  if (activators.has(name)) return true;
  if (typeof document === 'undefined') return false;
  return document.querySelector(`[data-nodd-open-state="${cssEscape(name)}"]`) !== null;
}

export function subscribeActivators(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(s)
    : s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`);
}

function findStateElement(name: string): Element | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-nodd-state="${cssEscape(name)}"]`);
}

function findTrigger(name: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-nodd-open-state="${cssEscape(name)}"]`) as HTMLElement | null;
}

// Wait until `find()` returns an element, or the timeout elapses. Generic over
// how the element is located so it serves both explicit and auto states.
function waitFor(find: () => Element | null, timeoutMs: number): Promise<Element | null> {
  const existing = find();
  if (existing) return Promise.resolve(existing);
  if (typeof document === 'undefined') return Promise.resolve(null);

  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      mo.disconnect();
      resolve(null);
    }, timeoutMs);

    const mo = new MutationObserver(() => {
      const el = find();
      if (el && !done) {
        done = true;
        clearTimeout(timer);
        mo.disconnect();
        resolve(el);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
}

export async function activateState(
  stack: readonly string[],
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  for (const segment of stack) {
    const auto = isAutoSegment(segment);
    const find = () => (auto ? findAutoStateElement(segment) : findStateElement(segment));
    if (find()) continue; // already mounted

    if (auto) {
      // No explicit activator for auto states — reopen via the advertised
      // trigger. A missing/ambiguous trigger fails closed.
      const trigger = findAutoTrigger(segment);
      if (!trigger) return false;
      trigger.click();
    } else {
      const fn = activators.get(segment);
      if (fn) {
        try {
          await fn();
        } catch {
          return false;
        }
      } else {
        const trigger = findTrigger(segment);
        if (!trigger) return false;
        trigger.click();
      }
    }

    const el = await waitFor(find, timeoutMs);
    if (!el) return false;
  }
  return true;
}
