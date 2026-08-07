// Bridges the two halves of state restoration: `provider/state/reopen.ts` knows
// how to *find* the control that opens an interactive state, and
// `anchoring/DOMAnchor` knows how to *remember* an element across page loads.
// This module joins them so a pin can carry its own way back.
//
// It lives in the overlay because the overlay owns the anchoring machinery;
// `activateState` stays free of it and takes an injected resolver instead.

import { DOMAnchor, type ElementRef, type Pin } from './anchoring/DOMAnchor';
import { findOpeningTrigger, hasReopenPath, describeAutoSegment } from '../provider/state';

export type StateCapture = {
  /** Recorded opening control per segment — goes straight into the pin. */
  triggers: Record<string, ElementRef>;
  /**
   * Segments with no known way back once they close. A comment under one of
   * these will still be scoped correctly, but reopening it from the feed can
   * only tell the viewer where to go, not take them there.
   */
  unreopenable: string[];
};

const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

/**
 * Snapshot how to re-enter every state in `stack`. Called at the moment a pin is
 * placed, while all of those states are still open.
 */
export function captureStateTriggers(stack: readonly string[]): StateCapture {
  const triggers: Record<string, ElementRef> = {};
  for (const segment of stack) {
    const trigger = findOpeningTrigger(segment);
    if (trigger) triggers[segment] = DOMAnchor.createRef(trigger);
  }

  const unreopenable = stack.filter(segment => !hasReopenPath(segment, s => s in triggers));

  if (isDev && unreopenable.length > 0) {
    console.warn(
      `[nodd] This comment is being placed inside ${unreopenable
        .map(s => `"${describeAutoSegment(s) ?? s}"`)
        .join(', ')}, which Nodd can't reopen on its own — opening the comment ` +
        'from the sidebar will show a hint instead of jumping to it. Wrap the ' +
        'state in <NoddState name="…"> and register useNoddActivator("…", open) ' +
        'to make it reopenable.',
    );
  }

  return { triggers, unreopenable };
}

/**
 * Reveal-time counterpart: look up the recorded control for a segment and
 * confirm it is still the same element. `resolveRef` re-checks the fingerprint,
 * so a rewritten or relocated control resolves to nothing and activation falls
 * back to the ARIA hunt rather than clicking something unrelated.
 */
export function makeTriggerResolver(pin: Pin): (segment: string) => HTMLElement | null {
  const recorded = pin.stateTriggers;
  if (!recorded) return () => null;
  return segment => {
    const ref = recorded[segment];
    if (!ref) return null;
    const el = DOMAnchor.resolveRef(ref);
    return el instanceof HTMLElement ? el : null;
  };
}
