// Overlays and sections named by their own control, with no role of their own.
//
// `autoState.ts` needs `role="dialog|alertdialog|menu|listbox"`. A great deal of
// real UI carries none of them and yet is unmistakably a toggled surface:
//
//   - Radix and Headless UI **Popover** content — no `role` at all;
//   - disclosure / accordion regions behind an `aria-expanded` button, where the
//     host *unmounts* the collapsed content (so `disclose.ts`, which needs the
//     element to still exist, can't help).
//
// What all of these do have is the disclosure half of the ARIA pattern: a
// control carrying `aria-expanded="true"` and `aria-controls="<id of the
// content>"`. That is an explicit, host-authored relationship — not a layout
// guess — and it is bidirectional, which is what makes it valuable: the same
// link that identifies the state at capture time is the thing to press to bring
// it back. Unlike a portalled dialog, there is never a question of *what opened
// this*.
//
// The segment is keyed on the **control's** accessible name rather than the
// content's, because this kind of content usually has no name and its id is
// generated (`radix-:r5:`, React `useId`) and so differs between reloads. A
// button labelled "Advanced" keys `ctl:advanced` for as long as it says
// "Advanced".
//
// Ordering: this runs in the same fallback position as `floatingState.ts`, and
// *after* it, so nothing that already resolves to a `float:` segment changes.
// See `getStateStackForElement`.

import { slug } from './autoState';
import { cssEscape } from './reopen';

/** Marks a control-derived segment: `ctl:<control-name-slug>`. */
export const CTL_PREFIX = 'ctl:';

export function isCtlSegment(segment: string): boolean {
  return segment.startsWith(CTL_PREFIX);
}

export function describeCtlSegment(segment: string): string | null {
  if (!isCtlSegment(segment)) return null;
  const name = segment.slice(CTL_PREFIX.length);
  return name ? name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Popup';
}

/** A control's own label — the thing the segment is keyed on. */
export function controlNameSlug(el: Element): string {
  const label = el.getAttribute('aria-label');
  return slug(label && label.trim() ? label : (el.textContent ?? ''));
}

/**
 * The single expanded control pointing at this element, or nothing.
 *
 * Two controls claiming one container is not a shape we try to interpret: which
 * one the viewer used is unknowable, and their labels would key different
 * segments. Nodd's own portals are excluded so the overlay can't scope itself.
 */
export function findControllingElement(el: Element): HTMLElement | null {
  const id = el.id;
  if (!id) return null;
  if (el.hasAttribute('data-nodd-root') || el.hasAttribute('data-nodd-pin-container')) return null;

  const doc = el.ownerDocument;
  const controls = Array.from(
    doc.querySelectorAll<HTMLElement>(`[aria-expanded="true"][aria-controls="${cssEscape(id)}"]`),
  ).filter(c => !el.contains(c) && c !== el);
  return controls.length === 1 ? controls[0] : null;
}

/**
 * Synthesize a segment for an element that an expanded control names, else null.
 *
 * `role="tabpanel"` is excluded deliberately. A tab panel is a persistent region
 * of the screen rather than a transient surface, so scoping comments to it would
 * hide them behind the *other* tabs' comments in every list; `disclose.ts`
 * reopens those instead, and correct tab markup uses `aria-selected` rather than
 * `aria-expanded` anyway.
 */
export function detectControlledSegment(el: Element): string | null {
  if (el.getAttribute('role') === 'tabpanel') return null;

  // Respect an explicit open/closed flag when the library exposes one.
  const dataState = el.getAttribute('data-state');
  if (dataState && dataState !== 'open') return null;

  const control = findControllingElement(el);
  if (!control) return null;

  const name = controlNameSlug(control);
  // An unnamed control cannot key a durable segment — and going unnamed would
  // let two different popovers on one page be mistaken for each other, which is
  // worse than leaving the comment unscoped.
  return name ? `${CTL_PREFIX}${name}` : null;
}

// Same reasoning as `floatingState.MAX_WALK_DEPTH`: this runs per unscoped
// thread on every mutation tick, and toggled surfaces sit near the top of their
// own subtree.
const MAX_WALK_DEPTH = 12;

/** Walk up from `el` for the innermost element an expanded control names. */
export function findControlledAncestor(el: Element | null): Element | null {
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== cur.ownerDocument.body && depth < MAX_WALK_DEPTH) {
    if (detectControlledSegment(cur)) return cur;
    cur = cur.parentElement;
    depth++;
  }
  return null;
}

/** The currently-open element whose synthesized segment equals `segment`. */
export function findControlledStateElement(segment: string): Element | null {
  if (typeof document === 'undefined') return null;
  for (const control of document.querySelectorAll('[aria-expanded="true"][aria-controls]')) {
    const target = document.getElementById(control.getAttribute('aria-controls')!);
    if (target && detectControlledSegment(target) === segment) return target;
  }
  return null;
}

/**
 * The closed control that would reopen `segment`.
 *
 * Stronger than the equivalent hunt in `autoState.findAutoTrigger`, because the
 * segment name *is* this control's name — we are not inferring which of several
 * closed triggers belongs to the state, we are looking one up by key. Ambiguity
 * (two buttons with the same label) still declines.
 */
export function findControlledTrigger(segment: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (!isCtlSegment(segment)) return null;
  const name = segment.slice(CTL_PREFIX.length);

  const matches = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-expanded="false"][aria-controls]'),
  ).filter(c => controlNameSlug(c) === name);
  return matches.length === 1 ? matches[0] : null;
}
