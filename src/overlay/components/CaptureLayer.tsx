import React, { useEffect, useCallback, useRef } from 'react';
import { DOMAnchor, type Pin } from '../anchoring/DOMAnchor';

export type CaptureLayerProps = {
  onCreate: (pin: Pin) => void;
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
      // Hide both portals so elementFromPoint returns the host element under
      // the cursor, never Nodd's own pins/popover in the pin container.
      const pinContainer = document.querySelector<HTMLElement>('[data-nodd-pin-container]');

      try {
        portalRoot.style.visibility = 'hidden';
        if (pinContainer) pinContainer.style.visibility = 'hidden';
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        const hit = document.elementFromPoint(clientX, clientY);
        portalRoot.style.visibility = '';
        if (pinContainer) pinContainer.style.visibility = '';

        if (!hit || hit === document.body || hit === document.documentElement) {
          onCancel();
        } else {
          const pin = DOMAnchor.create(hit, clientX, clientY);
          onCreate(pin);
        }
      } catch {
        portalRoot.style.visibility = '';
        if (pinContainer) pinContainer.style.visibility = '';
        onCancel();
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
        Click anywhere to leave a comment — press C or Esc to cancel
      </div>
    </div>
  );
}
