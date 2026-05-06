// Activator registry — module-level so activators stay registered even when
// their target `<NoddState>` is unmounted. Hosts call `useNoddActivator(name, fn)`
// outside their conditional render so the activator is always available.

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

function waitForState(name: string, timeoutMs: number): Promise<Element | null> {
  const existing = findStateElement(name);
  if (existing) return Promise.resolve(existing);

  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      mo.disconnect();
      resolve(null);
    }, timeoutMs);

    const mo = new MutationObserver(() => {
      const el = findStateElement(name);
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
    if (findStateElement(segment)) continue; // already mounted

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

    const el = await waitForState(segment, timeoutMs);
    if (!el) return false;
  }
  return true;
}
