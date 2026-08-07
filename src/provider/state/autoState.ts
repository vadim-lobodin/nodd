// Auto-detected interactive states.
//
// The explicit protocol (`<NoddState name>` + `useNoddActivator` /
// `[data-nodd-open-state]`) requires the host to instrument every interactive
// state by hand. That is friction, and when it's skipped a comment placed
// inside a modal/menu is captured with an empty state key and then *bleeds*
// onto the base screen (an empty key matches every state).
//
// Auto-detection removes that first burden for the common case: standard ARIA
// overlay containers (`role="dialog|alertdialog|menu|listbox"`). A comment
// placed inside an open overlay is scoped to a synthesized state segment, so it
// hides when the overlay closes instead of floating over the page.
//
// Philosophy mirrors the anchoring resolver — fail closed. We only rely on
// web-standard ARIA (not framework internals), we key on a *stable* accessible
// name so the segment survives reloads, and auto-restore fires only on an
// unambiguous trigger. Anything uncertain resolves to "can't restore" and the
// UI shows a hint rather than guessing wrong.

/** Marks a synthesized (non-`<NoddState>`) segment: `auto:<role>[:<name-slug>]`. */
export const AUTO_PREFIX = 'auto:';

// Standard ARIA roles for transient overlay surfaces. Deliberately web-standard
// so this works beyond any one component library.
const OVERLAY_ROLES = ['dialog', 'alertdialog', 'menu', 'listbox'] as const;
const OVERLAY_ROLE_SET = new Set<string>(OVERLAY_ROLES);
const OVERLAY_SELECTOR = OVERLAY_ROLES.map(r => `[role="${r}"]`).join(',');

export function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// A name stable across reloads: prefer the author-provided label, then the
// referenced label element(s), then a heading inside the overlay. Text content
// is stable in a way generated ids (radix-:r5:) are not.
export function accessibleName(el: Element): string | null {
  const label = el.getAttribute('aria-label');
  if (label && label.trim()) return label.trim();

  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby && typeof document !== 'undefined') {
    const parts = labelledby
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  const heading = el.querySelector('h1,h2,h3,[role="heading"]');
  const ht = heading?.textContent?.trim();
  if (ht) return ht;

  return null;
}

/**
 * Synthesize a state segment for an ancestor element if it is an open overlay
 * container, else null. Only considers open overlays — a closed/hidden overlay
 * (`data-state` present and not "open") is not a state to scope to.
 */
export function detectAutoSegment(el: Element): string | null {
  const role = el.getAttribute('role');
  if (!role || !OVERLAY_ROLE_SET.has(role)) return null;

  // Respect an explicit open/closed flag when the library exposes one; absence
  // means a plain semantic container that we still scope to.
  const dataState = el.getAttribute('data-state');
  if (dataState && dataState !== 'open') return null;

  const name = accessibleName(el);
  return name ? `${AUTO_PREFIX}${role}:${slug(name)}` : `${AUTO_PREFIX}${role}`;
}

export function isAutoSegment(segment: string): boolean {
  return segment.startsWith(AUTO_PREFIX);
}

/** Human-readable label for a synthesized segment, e.g. "Settings" / "Dialog". */
export function describeAutoSegment(segment: string): string | null {
  if (!isAutoSegment(segment)) return null;
  const [role, ...nameParts] = segment.slice(AUTO_PREFIX.length).split(':');
  const name = nameParts.join(':');
  const title = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return name ? title(name) : title(role || 'state');
}

/** The currently-open overlay whose synthesized segment equals `segment`, if any. */
export function findAutoStateElement(segment: string): Element | null {
  if (typeof document === 'undefined') return null;
  const candidates = document.querySelectorAll(OVERLAY_SELECTOR);
  for (const el of candidates) {
    if (detectAutoSegment(el) === segment) return el;
  }
  return null;
}

/** Parse the role back out of `auto:<role>[:<slug>]`. */
export function autoSegmentRole(segment: string): string | null {
  const rest = segment.slice(AUTO_PREFIX.length);
  const role = rest.split(':', 1)[0];
  return role || null;
}

/** Parse the name slug back out of `auto:<role>[:<slug>]`, if it has one. */
export function autoSegmentName(segment: string): string | null {
  const rest = segment.slice(AUTO_PREFIX.length);
  const idx = rest.indexOf(':');
  return idx === -1 ? null : rest.slice(idx + 1) || null;
}

/** A trigger's own label, for matching against a segment's name. */
function triggerNameSlug(el: Element): string {
  const label = el.getAttribute('aria-label');
  return slug(label && label.trim() ? label : (el.textContent ?? ''));
}

/**
 * Narrow several candidate triggers using the state's name. Many libraries name
 * the overlay after its trigger (Radix and Headless UI both point the content's
 * `aria-labelledby` at the trigger), so an exact slug match is common; a dialog
 * titled "Settings" opened by "Open settings" needs the containment pass.
 * Returns null unless exactly one candidate survives — ambiguity still loses.
 */
function narrowByName(candidates: HTMLElement[], name: string | null): HTMLElement | null {
  if (candidates.length === 1) return candidates[0];
  if (!name || candidates.length === 0) return null;

  const exact = candidates.filter(t => triggerNameSlug(t) === name);
  if (exact.length === 1) return exact[0];

  const related = candidates.filter(t => {
    const s = triggerNameSlug(t);
    return s.length > 0 && (s.includes(name) || name.includes(s));
  });
  return related.length === 1 ? related[0] : null;
}

/**
 * Best-effort trigger to reopen an auto-state, for threads that carry no
 * recorded trigger (written before `pin.stateTriggers` shipped — see
 * `state/reopen.ts`). This is the weaker, after-the-fact question: of the
 * controls sitting closed on the page right now, which one opens this?
 *
 * Two ordered passes, each of which must land on a single candidate or decline:
 *   1. closed triggers advertising a matching `aria-haspopup`;
 *   2. closed triggers with an `aria-controls` link but no `aria-haspopup`
 *      (the combobox shape — Radix `Select` reports `role="combobox"` and never
 *      sets `aria-haspopup`).
 *
 * Within a pass, several candidates can still be narrowed by the state's name.
 * `within` scopes the search to an already-open parent state, which is both more
 * precise and cheaper for nested stacks; it widens to the document if that finds
 * nothing. Ambiguity that survives all of this fails closed, as before.
 */
export function findAutoTrigger(
  segment: string,
  opts: { within?: Element | null } = {},
): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const role = autoSegmentRole(segment);
  if (!role) return null;
  const name = autoSegmentName(segment);

  const search = (root: ParentNode): HTMLElement | null => {
    const closed = Array.from(root.querySelectorAll<HTMLElement>('[aria-expanded="false"]'));

    // aria-haspopup values: "dialog" | "menu" | "listbox" | "true"; a dialog
    // trigger commonly reports "dialog". Accept the role match or the generic
    // "true" fallback that older widgets use.
    const advertised = closed.filter(t => {
      const hp = t.getAttribute('aria-haspopup');
      return hp === role || hp === 'true';
    });
    const byRole = narrowByName(advertised, name);
    if (byRole) return byRole;

    const linked = closed.filter(t => !t.hasAttribute('aria-haspopup') && t.hasAttribute('aria-controls'));
    return narrowByName(linked, name);
  };

  if (opts.within) {
    const scoped = search(opts.within);
    if (scoped) return scoped;
  }
  return search(document);
}
