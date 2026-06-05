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
      ev.preventDefault();
      ev.stopImmediatePropagation();

      const { clientX, clientY } = ev;
      const portalRoot = portalRootRef.current;
      if (!portalRoot) return;

      try {
        portalRoot.style.visibility = 'hidden';
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        const target = document.elementFromPoint(clientX, clientY);
        portalRoot.style.visibility = '';

        if (!target || target === document.body || target === document.documentElement) {
          onCancel();
        } else {
          const pin = DOMAnchor.create(target, clientX, clientY);
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
    document.addEventListener('click', handleClick, { capture: true, once: true });
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
