import { buildSelector } from './selectorBuilder';
import { computeFingerprintSync, computeContextFingerprintSync, isRootElement } from './fingerprint';
import { resolvePin, type ResolveResult } from './resolver';
import { captureAncestorChain, captureAnchorKind } from './approximate';

/**
 * A re-resolvable handle on an element. Stricter than a pin's anchor, because
 * the consequence of being wrong is different: a mis-resolved pin renders in an
 * odd place, whereas a mis-resolved *control* gets pressed — opening some other
 * row's menu. So identity is recorded as well as position, and anything short of
 * an unambiguous match resolves to nothing.
 */
export type ElementRef = {
  selector: string;
  fingerprint: string;
  /** Ancestor fingerprints, nearest first — see `computeContextFingerprintSync`. */
  context?: string[];
  /** Lower-cased tag name, so a drifted selector can be re-searched document-wide. */
  tag?: string;
};

export type Pin = {
  selector: string;
  offsetX: number;
  offsetY: number;
  fingerprint: string;
  viewportWidth: number;
  /**
   * The control that opened each interactive-state segment this pin lives
   * under, keyed by segment. Recorded while the state is open, because that is
   * the only moment the trigger→content link exists; reveal then clicks the
   * exact control instead of hunting for an unambiguous one across the page.
   * Absent on pins written before this shipped — reveal falls back to the hunt.
   */
  stateTriggers?: Record<string, ElementRef>;
  /**
   * Absolute document coordinates, for a comment left on empty space where
   * there is no element to hang off. Present only for page anchors; when set it
   * supersedes `offsetX`/`offsetY`, which have nothing to be relative to.
   *
   * Deliberately absolute rather than a fraction of the document. Sizing it
   * proportionally puts the pin's position at the mercy of the document's
   * height — which Nodd's own absolutely-positioned pin container contributes
   * to, so a pin low on the page grows the document and then chases its own
   * tail. The same pin rendered at 800px, 1600px or 427px depending on when you
   * measured. Fixed coordinates simply stay where the viewer put them.
   */
  page?: { x: number; y: number };
  /**
   * Selectors for the anchor's ancestors, nearest first — the fallback for when
   * the anchor itself is gone because the host swapped the view (paginated,
   * filtered, changed scenario). See `anchoring/approximate.ts`. Absent on pins
   * written before this shipped, which simply get no degraded anchor.
   */
  ancestors?: string[];
  /**
   * What kind of thing was anchored — "button", "row", "image" — so reveal can
   * say what is missing. Deliberately a kind and not the element's text: naming
   * it by content put page data in the notice. Absent for a plain `div`.
   */
  kind?: string;
  /**
   * Opaque snapshot of the host's own view state (`useNoddViewState`) — the one
   * thing the DOM cannot tell us, because "a `setPage` exists and 4 brings this
   * row back" is nowhere in it. Stamped by `OverlayRenderer` at capture rather
   * than here: this module knows about elements, not about the host.
   */
  viewState?: Record<string, unknown>;
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const PIN_RADIUS = 14;

export const DOMAnchor = {
  create(target: Element, clientX: number, clientY: number): Pin {
    if (isRootElement(target)) {
      return {
        selector: target === document.body ? 'body' : 'html',
        // Unused for a page anchor; `page` carries the position.
        offsetX: 0,
        offsetY: 0,
        page: { x: clientX + window.scrollX, y: clientY + window.scrollY },
        fingerprint: computeFingerprintSync(target),
        viewportWidth: window.innerWidth,
      };
    }
    const selector = buildSelector(target);
    const fingerprint = computeFingerprintSync(target);
    const r = target.getBoundingClientRect();
    const offsetX = clamp((clientX - r.left) / r.width, 0, 1);
    const offsetY = clamp((clientY - r.top) / r.height, 0, 1);
    return {
      selector,
      offsetX,
      offsetY,
      fingerprint,
      viewportWidth: window.innerWidth,
      ancestors: captureAncestorChain(target),
      kind: captureAnchorKind(target),
    };
  },

  resolve(pin: Pin): ResolveResult {
    return resolvePin(pin);
  },

  createRef(target: Element): ElementRef {
    return {
      selector: buildSelector(target),
      fingerprint: computeFingerprintSync(target),
      context: computeContextFingerprintSync(target),
      tag: target.tagName.toLowerCase(),
    };
  },

  /**
   * Find the element a ref names, or nothing.
   *
   * A ref recorded before context existed cannot be told apart from a look-alike,
   * so it is declined outright rather than trusted — the caller falls back to its
   * own search, which fails closed on ambiguity.
   */
  resolveRef(ref: ElementRef): Element | null {
    if (!ref.context) return null;

    const context = ref.context;
    const sameElement = (el: Element) => computeFingerprintSync(el) === ref.fingerprint;

    /**
     * Reduce look-alikes to the one that sits where the original sat. The
     * nearest ancestor must match — that is the identity check, and a candidate
     * failing it is a different row, not a moved one. Further ancestors only
     * break ties, because they change whenever any sibling does.
     */
    const pick = (pool: Element[]): Element | null => {
      let candidates = pool.filter(el => computeContextFingerprintSync(el)[0] === context[0]);
      for (let depth = 1; depth < context.length && candidates.length > 1; depth++) {
        const narrowed = candidates.filter(
          el => computeContextFingerprintSync(el)[depth] === context[depth],
        );
        if (narrowed.length === 0) break; // outer context drifted; judge on what matched
        candidates = narrowed;
      }
      return candidates.length === 1 ? candidates[0] : null;
    };

    let bySelector: Element[] = [];
    try {
      bySelector = Array.from(document.querySelectorAll(ref.selector)).filter(sameElement);
    } catch {
      // Invalid selector — the document-wide search below still applies.
    }
    const found = pick(bySelector);
    if (found) return found;

    // The selector encodes position (`:nth-of-type`), so sorting, filtering or
    // inserting a row aims it at a different one. Widen to every element of the
    // same tag and let identity, rather than position, choose.
    return ref.tag ? pick(Array.from(document.querySelectorAll(ref.tag)).filter(sameElement)) : null;
  },

  reposition(pin: Pin, cachedElement: Element): { x: number; y: number } {
    if (pin.page) {
      return { x: pin.page.x - PIN_RADIUS, y: pin.page.y - PIN_RADIUS };
    }
    const r = cachedElement.getBoundingClientRect();
    return {
      x: r.left + window.scrollX + pin.offsetX * r.width - PIN_RADIUS,
      y: r.top + window.scrollY + pin.offsetY * r.height - PIN_RADIUS,
    };
  },
};
