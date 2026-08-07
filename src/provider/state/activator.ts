// Activator registry — module-level so activators stay registered even when
// their target `<NoddState>` is unmounted. Hosts call `useNoddActivator(name, fn)`
// outside their conditional render so the activator is always available.

import { isAutoSegment, findAutoTrigger } from './autoState';
import { findStateElement, findExplicitTrigger, isDerivedSegment, pressTrigger } from './reopen';

export type Activator = () => void | Promise<void>;

/**
 * Looks up the control recorded at capture time for a state segment, if it is
 * still on the page. Supplied by the overlay, which owns the selector +
 * fingerprint machinery the recorded reference is re-resolved with.
 */
export type TriggerResolver = (segment: string) => HTMLElement | null;

export type ActivateResult = {
  ok: boolean;
  /** The first segment we couldn't bring back — what to tell the viewer about. */
  failedSegment: string | null;
};

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
  if (isDerivedSegment(name)) return false; // structural: only a recording helps
  if (activators.has(name)) return true;
  return findExplicitTrigger(name) !== null;
}

/**
 * Whether we know a way to bring `segment` back *after it closes* — the question
 * to ask while a comment is being written, so the author learns now rather than
 * on a dead click days later.
 *
 * Deliberately does not count "the state is open right now": at capture time it
 * always is. For an auto-detected state the honest answer is whether we managed
 * to record its opening control, since `findAutoTrigger`'s closed-trigger hunt
 * can't run while the state is open.
 */
export function hasReopenPath(
  segment: string,
  hasRecordedTrigger?: (segment: string) => boolean,
): boolean {
  if (hasRecordedTrigger?.(segment)) return true;
  if (isDerivedSegment(segment)) return false;
  return activators.has(segment) || findExplicitTrigger(segment) !== null;
}

export function subscribeActivators(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
  opts: { timeoutMs?: number; recordedTrigger?: TriggerResolver } = {},
): Promise<ActivateResult> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  // The enclosing state, once opened — scopes the fallback hunt for the next
  // segment down, where the whole document would be needlessly ambiguous.
  let parent: Element | null = null;

  for (const segment of stack) {
    const find = () => findStateElement(segment);
    const mounted = find();
    if (mounted) {
      parent = mounted;
      continue; // already open
    }

    const failed: ActivateResult = { ok: false, failedSegment: segment };

    if (isDerivedSegment(segment)) {
      // Prefer the control recorded when the comment was written — it names one
      // specific element, where the ARIA hunt only works when the page happens
      // to hold a single closed candidate. Fall back to the hunt for pins
      // written before triggers were recorded; a structural segment has no role
      // to hunt with, so for those the recording is the only route.
      const trigger =
        opts.recordedTrigger?.(segment) ??
        (isAutoSegment(segment) ? findAutoTrigger(segment, { within: parent }) : null);
      if (!trigger) return failed;
      pressTrigger(trigger);
    } else {
      // An explicit state is host-instrumented, so its own activator wins.
      const fn = activators.get(segment);
      if (fn) {
        try {
          await fn();
        } catch {
          return failed;
        }
      } else {
        const trigger = findExplicitTrigger(segment) ?? opts.recordedTrigger?.(segment);
        if (!trigger) return failed;
        pressTrigger(trigger);
      }
    }

    const el = await waitFor(find, timeoutMs);
    if (!el) return failed;
    parent = el;
  }
  return { ok: true, failedSegment: null };
}
