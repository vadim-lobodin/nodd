import { buildSelector } from './selectorBuilder';

/**
 * Degraded anchoring — where to put a comment whose exact anchor is gone.
 *
 * The exact anchor disappears for reasons Nodd cannot see and cannot restore:
 * the list moved to page 4, a filter deselected the row, a demo scenario swapped
 * the cards out. That view state lives in the host's own React state, so there
 * is no universal way to put it back — the host would have to hand Nodd a way in.
 *
 * What Nodd *can* do without any host cooperation is stop dead-ending. The
 * anchor's surroundings usually survive when the anchor doesn't: the row is
 * gone, the list it was in is still there. Recording the ancestor chain at
 * capture time lets reveal fall back to the nearest container that still
 * exists, so the comment lands somewhere honest and — more to the point — can
 * be read at all.
 *
 * This is deliberately kept out of `resolvePin`. Resolution decides where pins
 * render *unprompted*, and a page full of comments silently sliding up to their
 * containers would be worse than not showing them. Degradation happens only
 * when a viewer has explicitly asked to see one particular thread, and says so.
 */

/**
 * How far up to record. Deeper than `CONTEXT_DEPTH` in `fingerprint.ts`, which
 * exists to tell look-alikes apart and gets no value from distant ancestors.
 * Here the distant ones are the point — they are the levels most likely to
 * outlive the anchor.
 */
const CHAIN_DEPTH = 8;

const LABEL_MAX = 48;

/**
 * Selectors for the anchor's ancestors, nearest first, ending at `body`.
 *
 * Selectors rather than fingerprints: a fingerprint hashes `textContent`, so
 * every container that holds the changing content — which is every container
 * that matters here — fingerprints differently once the content changes. The
 * list on page 1 and the list on page 4 are the same element with different
 * hashes. Precision matters less than for the exact anchor anyway, because the
 * result is presented to the viewer as approximate.
 */
export function captureAncestorChain(target: Element): string[] {
  const chain: string[] = [];
  let cur = target.parentElement;
  let reachedRoot = false;
  while (cur && chain.length < CHAIN_DEPTH) {
    chain.push(buildSelector(cur));
    if (cur === document.body || cur === document.documentElement) {
      reachedRoot = true;
      break;
    }
    cur = cur.parentElement;
  }
  // React trees go deeper than eight levels routinely, and the levels the walk
  // does record are the nearest ones — the ones most likely to be swapped out
  // along with the anchor. Without a floor, a screen that re-renders wholesale
  // leaves nothing to match and the click dead-ends again. The page always
  // survives, so it is recorded as the last resort; `isPageLevelContainer` is
  // how reveal avoids describing it as if it were nearby.
  if (!reachedRoot && chain.length > 0 && document.body) chain.push(buildSelector(document.body));
  return chain;
}

/**
 * A short human name for what the comment was left on, for the viewer to read
 * when we can't show them the thing itself. The fingerprint is a hash, so
 * without this there is nothing to say beyond "it's gone".
 */
export function captureAnchorLabel(target: Element): string | undefined {
  const text = (target.textContent ?? '').replace(/\s+/g, ' ').trim();
  const source = text || target.getAttribute('aria-label') || target.getAttribute('alt') || '';
  if (!source) return undefined;
  return source.length > LABEL_MAX ? `${source.slice(0, LABEL_MAX - 1)}…` : source;
}

function isUsableContainer(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el === document.body || el === document.documentElement) return true;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

/**
 * The nearest recorded ancestor that still exists, or nothing.
 *
 * Requires an unambiguous match at each level: two candidates means we would be
 * guessing which copy of the container the comment belonged to, and the next
 * level up is a better answer than a coin flip. Chains recorded by
 * `captureAncestorChain` end at `body`, so those always land somewhere; pins
 * written before that floor existed can still come back empty.
 */
export function resolveApproximateAnchor(pin: { ancestors?: string[] }): Element | null {
  for (const selector of pin.ancestors ?? []) {
    let matches: Element[];
    try {
      matches = Array.from(document.querySelectorAll(selector));
    } catch {
      continue; // invalid selector — try the next level out
    }
    if (matches.length === 1 && isUsableContainer(matches[0])) return matches[0];
  }
  return null;
}

/**
 * Whether the only thing that survived is the page itself.
 *
 * Worth opening a thread there — being able to read a conversation beats a toast
 * that says it exists, which is the whole point of degrading — but not worth
 * calling "nearby". At this level the pin is in the page's top-left corner and
 * has no relationship to where the comment was left, so reveal says so.
 */
export function isPageLevelContainer(el: Element): boolean {
  return el === el.ownerDocument.body || el === el.ownerDocument.documentElement;
}

/** Top-left of a container, in page coordinates, inset so the pin sits inside it. */
export function positionInContainer(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + window.scrollX + 8, y: r.top + window.scrollY + 8 };
}
