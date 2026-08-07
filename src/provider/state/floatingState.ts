// Overlays with no ARIA at all.
//
// `autoState.ts` needs a `role`. Plenty of real overlays don't have one — a
// popover panel in most component libraries, and every hand-rolled
// `{open && <div className="fixed inset-0" />}` menu. A comment placed inside
// one of those is captured with an empty state key, which matches every state,
// so it never hides and can never be reopened. That failure is silent: nothing
// downstream can tell the difference between "base screen" and "an overlay we
// couldn't see".
//
// This module adds a last-resort structural signal for exactly that case. It is
// weaker than ARIA — it reads layout, not semantics — so it is gated three ways:
//
//   1. It only runs when the ARIA/explicit walk found *nothing* (see
//      `getStateStackForElement`). It can therefore only ever affect comments
//      that would otherwise have had no scope at all, which is why adding it
//      cannot change how any existing thread behaves.
//   2. It requires one of two specific structures, not "looks floaty" — see
//      the tiers below. A sticky header or fixed toolbar matches neither.
//   3. The author sees what it decided, in the composer, and can switch it off.

import { accessibleName, slug } from './autoState';

/** Marks a structurally-detected segment: `float:<name-slug>`. */
export const FLOAT_PREFIX = 'float:';

export function isFloatSegment(segment: string): boolean {
  return segment.startsWith(FLOAT_PREFIX);
}

/** Human-readable label for a float segment, e.g. `float:steps` → "Steps". */
export function describeFloatSegment(segment: string): string | null {
  if (!isFloatSegment(segment)) return null;
  const name = segment.slice(FLOAT_PREFIX.length);
  return name
    ? name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Popup';
}

function styleOf(el: Element): CSSStyleDeclaration | null {
  if (typeof window === 'undefined' || !window.getComputedStyle) return null;
  try {
    return window.getComputedStyle(el);
  } catch {
    return null;
  }
}

/** A full-viewport fixed layer — the click-catching scrim behind a modal. */
function isScrim(el: Element): boolean {
  const s = styleOf(el);
  if (!s || s.position !== 'fixed') return false;
  // `inset: 0` (Tailwind's `inset-0`, and the hand-rolled equivalent) resolves
  // to all four offsets at zero. Measuring the rect instead would be equivalent
  // in a browser but is unavailable during tests and before first layout.
  if (!['top', 'right', 'bottom', 'left'].every(p => s.getPropertyValue(p) === '0px')) return false;
  // A scrim is a backdrop, not content.
  return (el.textContent ?? '').trim().length === 0 || el.tagName === 'BUTTON';
}

function isPositioned(el: Element): boolean {
  const p = styleOf(el)?.position;
  return p === 'fixed' || p === 'absolute';
}

/** Nodd's own portals, which must never be mistaken for host overlays. */
function isNoddOwned(el: Element): boolean {
  return el.hasAttribute('data-nodd-root') || el.hasAttribute('data-nodd-pin-container');
}

const LANDMARKS =
  'main,[role="main"],nav,[role="navigation"],header,[role="banner"],footer,[role="contentinfo"]';

/**
 * Page content, as opposed to a layer floating above it.
 *
 * Being the first element child of `<body>` is a hint, not proof: anything at
 * all can precede the app root — an analytics node, a framework shell, even a
 * component library's own focus guards (Radix inserts `<span>`s there). Relying
 * on it alone classified ordinary page content as a portal. So landmarks are
 * checked with `matches` as well as `querySelector`: `<main>` is frequently a
 * direct child of `<body>`, and a descendant-only query misses it.
 */
function looksLikePageContent(el: Element): boolean {
  if (el.matches(LANDMARKS) || el.querySelector(LANDMARKS)) return true;
  return el === el.ownerDocument.body.firstElementChild;
}

/**
 * Real evidence of a floating layer: the element, or the panel it wraps, is
 * taken out of normal flow. Portal *roots* are often plain static wrappers, so
 * the child has to count too.
 *
 * This is what separates a genuine overlay from any old `<div>` that happens to
 * sit beside the app root. Without it, "not the first body child" was enough to
 * scope a comment on plain page content to an imaginary popup.
 */
function isFloatingLayer(el: Element): boolean {
  if (isPositioned(el)) return true;
  const child = el.firstElementChild;
  return !!child && isPositioned(child);
}

/** React's `useId` and most CSS-in-JS ids change between builds or renders. */
function isStableId(id: string): boolean {
  return id.length > 0 && id.length <= 40 && !id.includes(':');
}

/**
 * An id that names the portal *mechanism* rather than the popup in it — every
 * overlay in the app shares one, so using it as a state name would make them
 * all indistinguishable.
 */
function isGenericContainerId(id: string): boolean {
  return /portal|overlay-?root|modal-?root|^root$/i.test(id);
}

/**
 * Name a container, strongest source first. The name is a durable key — a
 * comment survives a reload only if its state resolves to the same string — so
 * anything volatile is worse than no name at all.
 *
 * The last resort, the first control's text, is the weak one: a menu whose items
 * change gets a new name and its comments stop matching. It is still preferred
 * over going unnamed, which would let two different un-named layers on one page
 * be mistaken for each other — showing a comment in the wrong popup, rather than
 * merely losing track of it.
 */
function nameFor(el: Element): string {
  const stable = accessibleName(el);
  if (stable) return slug(stable);

  // A portal root is a wrapper the library reuses for every overlay; the popup
  // that actually deserves the name is the thing mounted inside it.
  for (const child of Array.from(el.children)) {
    const childName = accessibleName(child);
    if (childName) return slug(childName);
  }

  const testId = el.getAttribute('data-testid') ?? el.firstElementChild?.getAttribute('data-testid');
  if (testId) return slug(testId);

  if (isStableId(el.id) && !isGenericContainerId(el.id)) return slug(el.id);

  const firstControl = el.querySelector('button,a[href],[role="menuitem"],[role="option"]');
  const text = firstControl?.textContent?.trim();
  return text ? slug(text) : '';
}

/**
 * Does this element look like an overlay that carries no ARIA? Two structures
 * qualify, both of which mean "a layer deliberately placed above the page":
 *
 *   1. **A portal layer** — a child of `<body>` that is not page content *and*
 *      is actually taken out of flow (itself or the panel it wraps). Every major
 *      component library appends overlay content here, so this covers their
 *      un-roled popovers. Both halves are required: "not the app root" alone
 *      misfires the moment anything precedes the app root in `<body>`.
 *   2. **A scrimmed panel** — a positioned element immediately preceded by a
 *      full-viewport fixed backdrop. This is the hand-rolled modal/menu shape;
 *      it renders inline rather than through a portal, so tier 1 misses it.
 */
export function detectFloatingSegment(el: Element): string | null {
  if (isNoddOwned(el)) return null;

  const body = el.ownerDocument.body;
  const isPortalLayer =
    el.parentElement === body && !looksLikePageContent(el) && isFloatingLayer(el);

  const prev = el.previousElementSibling;
  const isScrimmedPanel = !!prev && isScrim(prev) && isPositioned(el);

  if (!isPortalLayer && !isScrimmedPanel) return null;

  const name = nameFor(el);
  return name ? `${FLOAT_PREFIX}${name}` : FLOAT_PREFIX.slice(0, -1);
}

// This walk runs for every thread that has no scope, on every DOM mutation
// tick, and each step can cost a `getComputedStyle`. Overlay panels sit near the
// top of their own subtree, so a bounded walk finds them; the cap keeps a deep
// host tree from turning pin resolution into a style-recalc storm. Same reasoning
// (and roughly the same number) as the selector builder's walk limit.
const MAX_WALK_DEPTH = 12;

/** Walk up from `el` looking for the innermost un-roled overlay containing it. */
export function findFloatingAncestor(el: Element | null): Element | null {
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== cur.ownerDocument.body && depth < MAX_WALK_DEPTH) {
    if (detectFloatingSegment(cur)) return cur;
    cur = cur.parentElement;
    depth++;
  }
  return null;
}

/** The currently-mounted container whose synthesized segment equals `segment`. */
export function findFloatingStateElement(segment: string): Element | null {
  if (typeof document === 'undefined') return null;
  const body = document.body;
  const candidates: Element[] = [
    ...Array.from(body.children),
    // Scrimmed panels render inline, so they can be anywhere; only elements
    // directly preceded by a scrim are worth testing.
    ...Array.from(document.querySelectorAll('*')).filter(
      e => e.previousElementSibling && isScrim(e.previousElementSibling),
    ),
  ];
  for (const el of candidates) {
    if (detectFloatingSegment(el) === segment) return el;
  }
  return null;
}
