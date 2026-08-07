// Anchors that are present but not shown.
//
// A closed tab panel, a collapsed accordion, a `<details>` — the commented
// element is still in the document, still matches its selector, still matches
// its fingerprint. Resolution therefore reported *success*, and then
// `getBoundingClientRect()` returned zeros and the pin rendered in the page's
// top-left corner. Silently wrong, which is worse than orphaned.
//
// This is also the one category of hidden state that can be reopened with no
// host cooperation at all, because disclosure is the best-instrumented pattern
// in ARIA: tabs carry `aria-controls`, disclosures carry `aria-expanded` +
// `aria-controls`, and `<details>` is a browser primitive. Where an overlay
// might be a portal with no link back to its opener, a tab panel names its tab.
//
// Distinct from `activator.ts` / `reopen.ts`, which restore an interactive
// *state* the comment was scoped to. A collapsed section isn't a state — the
// comment belongs to the base screen and matches it — so nothing in the state
// stack refers to this, and there is no captured segment to key off. All we
// have is the anchor and the DOM above it.

import { pressTrigger, cssEscape } from './reopen';

/** How long to wait for one disclosure to take effect before giving up. */
const DISCLOSE_TIMEOUT_MS = 800;

/** Ceiling on nested disclosures — a tab inside an accordion inside a details. */
const MAX_DEPTH = 4;

/**
 * Whether an element is hidden *by declaration*, as opposed to merely being
 * scrolled out of view or laid out at zero size.
 *
 * Deliberately reads explicit markers rather than measuring layout. A zero-size
 * rect is far too eager a signal — it is also what an element reports before
 * first paint, inside a `display: contents` wrapper, or during an enter
 * animation — and treating those as hidden would suppress pins that are about
 * to be perfectly fine. Every marker below is something the host (or the UA)
 * had to actively set.
 */
export function isHiddenElement(el: Element): boolean {
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  // A closed <details> hides its non-summary children through UA styles that
  // don't consistently surface in getComputedStyle, so match the element itself.
  if (el.tagName === 'DETAILS' && !el.hasAttribute('open')) return true;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  return style.display === 'none' || style.visibility === 'hidden';
}

/** The hidden ancestors-or-self of an element, outermost first. */
export function findHiddenAncestors(el: Element): Element[] {
  const chain: Element[] = [];
  let cur: Element | null = el;
  while (cur && cur !== cur.ownerDocument.documentElement) {
    // A closed <details> hides its content, not itself — the summary stays
    // visible — so the element to act on is the <details>, reached from inside.
    if (isHiddenElement(cur)) chain.push(cur);
    cur = cur.parentElement;
  }
  return chain.reverse();
}

/** Whether an element is in the document and not hidden by anything above it. */
export function isRendered(el: Element): boolean {
  if (!el.isConnected) return false;
  return findHiddenAncestors(el).length === 0;
}

/**
 * The control that would reveal a hidden container, or nothing.
 *
 * Fail-closed like everything else in this module: two candidates means we'd be
 * choosing which tab the comment was under, and pressing the wrong one is worse
 * than telling the viewer we couldn't.
 */
export function findDiscloseControl(container: Element): HTMLElement | null {
  const doc = container.ownerDocument;

  // A <details> opens from its own summary — no ARIA involved, and the summary
  // is a child rather than an outside control, so this precedes the ID search.
  if (container.tagName === 'DETAILS') {
    const summary = container.querySelector(':scope > summary');
    if (summary) return summary as HTMLElement;
    return null;
  }

  const id = container.id;
  if (id) {
    // The ARIA link, pointing inward: a tab at its panel, a disclosure button at
    // its region, a popover trigger at its content. Controls already expanded
    // are excluded — one of those is pointing at something else that happens to
    // share the relationship, not at the thing we need opened.
    const byControls = Array.from(
      doc.querySelectorAll<HTMLElement>(`[aria-controls="${cssEscape(id)}"]`),
    ).filter(c => !container.contains(c) && c.getAttribute('aria-expanded') !== 'true');
    if (byControls.length === 1) return byControls[0];
    if (byControls.length > 1) return null; // ambiguous — don't guess
  }

  // The ARIA link pointing outward, which is how a tabpanel names its tab.
  // Only trusted for tabpanels: `aria-labelledby` elsewhere usually points at a
  // heading, and headings are not controls.
  if (container.getAttribute('role') === 'tabpanel') {
    const labelledBy = container.getAttribute('aria-labelledby');
    const tab = labelledBy ? doc.getElementById(labelledBy) : null;
    if (tab && tab.getAttribute('role') === 'tab') return tab as HTMLElement;
  }

  return null;
}

function nextFrame(): Promise<void> {
  return new Promise(r => requestAnimationFrame(() => r()));
}

export type DiscloseResult = {
  /** Whether the anchor ended up rendered. */
  revealed: boolean;
  /**
   * The container that stopped us — hidden, with no control we could identify
   * or one that didn't take effect. Null when nothing blocked us.
   */
  blocked: Element | null;
};

/**
 * Open whatever is hiding an element, outermost first.
 *
 * Recomputes the hidden chain after each press rather than walking a list
 * captured up front: opening a tab panel re-renders its contents, so the inner
 * accordion we were about to click may be a different element by then — or may
 * already be open.
 */
export async function discloseAncestors(
  el: Element,
  timeoutMs: number = DISCLOSE_TIMEOUT_MS,
): Promise<DiscloseResult> {
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!el.isConnected) return { revealed: false, blocked: null };
    const hidden = findHiddenAncestors(el);
    if (hidden.length === 0) return { revealed: true, blocked: null };

    const container = hidden[0];
    const control = findDiscloseControl(container);
    if (!control) return { revealed: false, blocked: container };

    pressTrigger(control);

    const deadline = Date.now() + timeoutMs;
    while (isHiddenElement(container) && container.isConnected && Date.now() < deadline) {
      await nextFrame();
    }
    // `container` leaving the document counts as progress, not failure: hosts
    // routinely unmount the closed panel and render an open one in its place.
    if (container.isConnected && isHiddenElement(container)) {
      return { revealed: false, blocked: container };
    }
  }
  return { revealed: isRendered(el), blocked: isRendered(el) ? null : findHiddenAncestors(el)[0] ?? null };
}

/** A short human name for a container, for telling the viewer what's closed. */
export function describeContainer(el: Element): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute('aria-labelledby');
  const label =
    el.getAttribute('aria-label') ??
    (labelledBy ? doc.getElementById(labelledBy)?.textContent : null) ??
    (el.tagName === 'DETAILS' ? el.querySelector(':scope > summary')?.textContent : null);
  const text = (label ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return el.getAttribute('role') === 'tabpanel' ? 'a tab' : 'a collapsed section';
}
