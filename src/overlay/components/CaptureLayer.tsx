import React, { useEffect, useCallback, useRef } from 'react';
import { DOMAnchor, type Pin } from '../anchoring/DOMAnchor';

export type CaptureLayerProps = {
  onCreate: (pin: Pin) => void;
  /** Esc — an explicit exit from comment mode. Not fired by unanchorable clicks. */
  onCancel: () => void;
  portalRootRef: React.RefObject<HTMLElement | null>;
};

/**
 * Clicks on Nodd chrome (the toolbar, sidebar, existing pins, an open popover)
 * must reach their own control instead of placing a pin. Both portals carry a
 * `data-nodd-*` attribute; anything inside them that isn't the capture layer
 * itself is overlay UI.
 */
function isNoddChrome(ev: Event): boolean {
  const target = ev.target instanceof Element ? ev.target : null;
  return !!(
    target?.closest('[data-nodd-root], [data-nodd-pin-container]') &&
    !target?.closest('.nodd-capture-layer')
  );
}

// The press events an overlay watches to decide it has been dismissed, plus the
// ones that would otherwise activate host controls. Swallowed wholesale while
// comment mode is on.
const SWALLOWED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'contextmenu', 'dblclick'];

export function CaptureLayer({ onCreate, onCancel, portalRootRef }: CaptureLayerProps) {
  const activeRef = useRef(true);

  const handleClick = useCallback(
    async (ev: MouseEvent) => {
      const portalRoot = portalRootRef.current;
      if (!portalRoot) return;
      if (isNoddChrome(ev)) return;

      // Guard against re-entry during the one-frame elementFromPoint dance.
      if (!activeRef.current) return;
      activeRef.current = false;

      ev.preventDefault();
      ev.stopImmediatePropagation();

      const { clientX, clientY } = ev;
      // Hit-test in two passes, hiding one portal at a time: the first sees Nodd's
      // own pins (so a click on one reaches it), the second sees only the host
      // element under the cursor.
      const pinContainer = document.querySelector<HTMLElement>('[data-nodd-pin-container]');

      try {
        portalRoot.style.visibility = 'hidden';
        // First pass with the pin container still visible. Comment mode now
        // outlives a single pin, so existing pins are under the crosshair for
        // whole sessions — and this layer lives in the fixed root, which paints
        // above the pin container, so those pins never receive the click. Forward
        // it to the pin instead of stacking a second pin on top of the first.
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        const pinEl = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-nodd-pin-id]');
        if (pinEl) {
          portalRoot.style.visibility = '';
          activeRef.current = true;
          pinEl.click();
          return;
        }

        if (pinContainer) pinContainer.style.visibility = 'hidden';
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        const hit = document.elementFromPoint(clientX, clientY);
        portalRoot.style.visibility = '';
        if (pinContainer) pinContainer.style.visibility = '';

        // A click on empty space hit-tests to <body> or <html>. That used to
        // cancel — not as a product decision, but because the anchor layer had
        // no way to represent the page, so such a pin could never resolve again.
        // It can now, so the only thing left to bail on is nothing at all. And
        // comment mode is a mode now, not a one-shot, so even that is a no-op:
        // re-arm and wait for the next click rather than dropping the viewer out.
        if (!hit) {
          activeRef.current = true;
        } else {
          const pin = DOMAnchor.create(hit, clientX, clientY);
          onCreate(pin);
        }
      } catch {
        portalRoot.style.visibility = '';
        if (pinContainer) pinContainer.style.visibility = '';
        activeRef.current = true;
      }
    },
    [onCreate, onCancel, portalRootRef],
  );

  const handleKeyDown = useCallback(
    (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onCancel();
      }
    },
    [onCancel],
  );

  // While comment mode is on, the host page must be inert to pointer input —
  // and not merely as a nicety. Modal overlays dismiss themselves on a
  // *pointerdown* they judge to be outside their content (Radix registers
  // `document.addEventListener('pointerdown', …)` for exactly this). Since the
  // capture layer covers the viewport, every attempt to place a pin inside a
  // dialog looked like an outside press and closed the dialog the comment was
  // being left in — taking the anchor with it.
  //
  // So the whole press is swallowed, and only the click is acted on. These are
  // bound on `window` in the capture phase, which runs before any listener on
  // `document` regardless of who registered first — ordering we would otherwise
  // lose, since the overlay always mounts before comment mode starts.
  useEffect(() => {
    const swallow = (ev: Event) => {
      if (isNoddChrome(ev)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    for (const type of SWALLOWED) {
      window.addEventListener(type, swallow, { capture: true });
    }
    window.addEventListener('click', handleClick, { capture: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      for (const type of SWALLOWED) {
        window.removeEventListener(type, swallow, true);
      }
      window.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClick, handleKeyDown]);

  return (
    <div className="nodd-capture-layer">
      <div className="nodd-capture-toast">
        Click anywhere to leave a comment — press Esc or C to exit comment mode
      </div>
    </div>
  );
}
