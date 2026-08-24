// How an interactive state gets back on screen.
//
// Two mirror-image questions live here:
//
//   - **Capture time** — the state is open, so: *what opened it?*
//     (`findOpeningTrigger`)
//   - **Reveal time** — the state is closed, so: *what would open it?*
//     (`findStateElement`, `findExplicitTrigger`, and `findAutoTrigger` in
//     `autoState.ts`)
//
// The capture-time answer is by far the reliable one. While the overlay is open
// the browser still holds the ARIA link between trigger and content
// (`aria-controls`, `aria-expanded="true"`) — a link that is gone by the time
// someone clicks that comment in the feed three days later. So `OverlayRenderer`
// snapshots the opening control into the pin, and reveal clicks *that* control
// instead of hunting for an unambiguous one document-wide. The hunt is what
// fails on the pages people actually build: twenty identical row menus, or a
// controlled dialog whose only "trigger" is a parent component's `open` prop.
//
// Fail-closed still applies at every step: every heuristic below either finds
// exactly one candidate or gives up, and the recorded trigger is re-verified by
// selector + fingerprint before it is clicked.

import { isAutoSegment, findAutoStateElement, autoSegmentRole } from './autoState';
import { isFloatSegment, findFloatingStateElement } from './floatingState';
import { isCtlSegment, findControlledStateElement } from './controlledState';

/**
 * A segment Nodd derived from the DOM (ARIA role or structure) rather than one
 * the host declared. These have no activator registry entry, so reopening them
 * depends on finding a control to click.
 */
export function isDerivedSegment(segment: string): boolean {
  return isAutoSegment(segment) || isFloatSegment(segment) || isCtlSegment(segment);
}

/** Controls that a click can plausibly activate. */
const FOCUSABLE_CONTROL = 'button,[role="button"],a[href],summary,[tabindex]:not([tabindex="-1"])';

/**
 * Activate a trigger the way a person would.
 *
 * `el.click()` is not enough. Menu, select, and popover triggers in Radix (and
 * so shadcn/ui) toggle on **`pointerdown`** and ignore `click` entirely, so a
 * bare `.click()` on one is silently a no-op — the state never reopens and we
 * report a timeout as if the host were at fault. Dialog triggers do use `click`,
 * which is why this went unnoticed.
 *
 * Dispatching the full press sequence covers both conventions: pointer-driven
 * widgets react to the first event, click-driven ones to the last. Widgets that
 * handle both still see a single coherent press rather than two toggles.
 */
export function pressTrigger(el: HTMLElement): void {
  const init: MouseEventInit = { bubbles: true, cancelable: true, button: 0, composed: true };
  const Pointer: typeof MouseEvent =
    typeof PointerEvent === 'function' ? (PointerEvent as unknown as typeof MouseEvent) : MouseEvent;
  const pointerInit = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };

  el.dispatchEvent(new Pointer('pointerdown', pointerInit as MouseEventInit));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.dispatchEvent(new Pointer('pointerup', pointerInit as MouseEventInit));
  el.dispatchEvent(new MouseEvent('mouseup', init));
  // Last, and via the native method so a real <button> also does its default.
  el.click();
}

export function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(s)
    : s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`);
}

/** The mounted `<NoddState name>` wrapper for an explicit segment, if present. */
export function findExplicitStateElement(name: string): Element | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-nodd-state="${cssEscape(name)}"]`);
}

/** The host-declared `[data-nodd-open-state]` trigger for an explicit segment. */
export function findExplicitTrigger(name: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-nodd-open-state="${cssEscape(name)}"]`) as HTMLElement | null;
}

/** The mounted element for any segment — explicit, ARIA-detected, or structural. */
export function findStateElement(segment: string): Element | null {
  if (isAutoSegment(segment)) return findAutoStateElement(segment);
  if (isFloatSegment(segment)) return findFloatingStateElement(segment);
  if (isCtlSegment(segment)) return findControlledStateElement(segment);
  return findExplicitStateElement(segment);
}

function haspopupMatches(trigger: Element, role: string): boolean {
  const hp = trigger.getAttribute('aria-haspopup');
  // aria-haspopup values: "dialog" | "menu" | "listbox" | "true". A dialog
  // trigger commonly reports "dialog"; older widgets report the generic "true".
  return hp === role || hp === 'true' || (role === 'menu' && hp === 'menu');
}

/**
 * The control that opened `segment`, discovered while that state is still open.
 *
 * Only auto-detected segments are considered: an explicit `<NoddState>` is
 * host-instrumented by definition (its activator or `[data-nodd-open-state]`
 * trigger is authoritative), and a `display: contents` wrapper has no ARIA
 * relationship we could read a trigger off of — guessing one there would be
 * exactly the wrong-overlay error this module exists to avoid.
 */
export function findOpeningTrigger(segment: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (!isDerivedSegment(segment)) return null;

  const stateEl = findStateElement(segment);
  if (!stateEl) return null;
  // A structural segment has no role to match candidates against, so only the
  // explicit `aria-controls` link below applies to it.
  const role = isAutoSegment(segment) ? autoSegmentRole(segment) : null;
  if (isAutoSegment(segment) && !role) return null;

  // A control cannot be its own overlay, live inside it, or wrap it.
  const outside = (el: Element) =>
    el !== stateEl && !stateEl.contains(el) && !el.contains(stateEl);

  // Tier 1 — the explicit ARIA link. `aria-controls` names the content node;
  // some libraries point it at an inner wrapper, so accept a match anywhere in
  // the open subtree. This is the only tier that isn't a guess.
  const byControls = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-controls]'),
  ).filter(t => {
    if (!outside(t)) return false;
    const id = t.getAttribute('aria-controls');
    const target = id ? document.getElementById(id) : null;
    return !!target && (target === stateEl || stateEl.contains(target) || target.contains(stateEl));
  });
  if (byControls.length === 1) return byControls[0];
  if (!role) return null;

  // Tier 2 — an expanded trigger advertising this kind of popup. Unlike the
  // reveal-time hunt this runs while the state is open, so the candidate set is
  // "things currently expanded", which is small.
  const expanded = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-haspopup]'),
  ).filter(t => outside(t) && haspopupMatches(t, role));
  if (expanded.length === 1) return expanded[0];

  // Tier 3 — a control marked open with no ARIA link at all. This is the
  // custom-select shape: a `<button data-state="open">` driving a listbox or
  // menu. Limited to those two roles on purpose — there is nothing here to
  // verify the pairing against, and a dialog with no ARIA trigger is far more
  // likely to be one a parent opened via an `open` prop (nothing to click) than
  // one whose opener happens to be the page's only `data-state="open"` button.
  if (role === 'listbox' || role === 'menu') {
    const openControls = Array.from(
      document.querySelectorAll<HTMLElement>('[data-state="open"]'),
    ).filter(t => outside(t) && t.matches(FOCUSABLE_CONTROL));
    if (openControls.length === 1) return openControls[0];
  }

  return null;
}
