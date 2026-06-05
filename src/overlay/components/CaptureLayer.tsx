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

      // Clicks on Nodd's own chrome (the comment-mode panel, sidebar) must not
      // place a pin — let the control handle its own click. Everything inside
      // portalRoot that isn't the capture layer is overlay UI.
      const target = ev.target as Node | null;
      const captureLayer = portalRoot.querySelector('.nodd-capture-layer');
      if (target && portalRoot.contains(target) && captureLayer && !captureLayer.contains(target)) {
        return;
      }

      // Guard against re-entry during the one-frame elementFromPoint dance.
      if (!activeRef.current) return;
      activeRef.current = false;

      ev.preventDefault();
      ev.stopImmediatePropagation();

      const { clientX, clientY } = ev;

      try {
        portalRoot.style.visibility = 'hidden';
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        const hit = document.elementFromPoint(clientX, clientY);
        portalRoot.style.visibility = '';

        if (!hit || hit === document.body || hit === document.documentElement) {
          onCancel();
        } else {
          const pin = DOMAnchor.create(hit, clientX, clientY);
          onCreate(pin);
        }
      } catch {
        if (portalRoot) portalRoot.style.visibility = '';
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
