import React, { useEffect, useCallback, useRef } from 'react';
import { DOMAnchor, type Pin } from '../anchoring/DOMAnchor';

export type CaptureLayerProps = {
  onCreate: (pin: Pin) => void;
  /** Esc — an explicit exit from comment mode. Not fired by unanchorable clicks. */
  onCancel: () => void;
  portalRootRef: React.RefObject<HTMLElement | null>;
};

export function CaptureLayer({ onCreate, onCancel, portalRootRef }: CaptureLayerProps) {
  const activeRef = useRef(true);

  const handleClick = useCallback(
    async (ev: MouseEvent) => {
      const portalRoot = portalRootRef.current;
      if (!portalRoot) return;

      // Clicks on any Nodd chrome (the comment-mode panel, sidebar, existing
      // pins, an open popover) must not place a pin — let the control handle
      // its own click. Both portals carry a data-nodd-* attribute; anything
      // inside them that isn't the capture layer itself is overlay UI.
      const target = ev.target instanceof Element ? ev.target : null;
      const onChrome =
        target?.closest('[data-nodd-root], [data-nodd-pin-container]') &&
        !target?.closest('.nodd-capture-layer');
      if (onChrome) return;

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

        if (!hit || hit === document.body || hit === document.documentElement) {
          // Nothing anchorable under the cursor. Comment mode is a mode now, not
          // a one-shot, so an unusable click is a no-op — re-arm and wait for the
          // next one rather than dropping the viewer out of it.
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

  useEffect(() => {
    document.addEventListener('click', handleClick, { capture: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClick, true);
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
