import React, { forwardRef, useImperativeHandle, useRef } from 'react';

export type HoverHighlightHandle = {
  show(rect: DOMRect): void;
  hide(): void;
  refresh(): void;
};

export const HoverHighlight = forwardRef<HoverHighlightHandle>(function HoverHighlight(_, ref) {
  const elRef = useRef<HTMLDivElement>(null);
  const lastRect = useRef<DOMRect | null>(null);

  useImperativeHandle(ref, () => ({
    show(rect: DOMRect) {
      lastRect.current = rect;
      const el = elRef.current;
      if (!el) return;
      el.style.display = 'block';
      el.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
    },
    hide() {
      lastRect.current = null;
      const el = elRef.current;
      if (el) el.style.display = 'none';
    },
    refresh() {
      // No-op unless we track the element
    },
  }));

  return <div ref={elRef} className="align-hover-highlight" />;
});
