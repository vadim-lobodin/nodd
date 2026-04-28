export type ReanchorOpts = {
  getPins: () => Array<{ id: string; pin: { offsetX: number; offsetY: number } }>;
  getElement: (pinId: string) => Element | null;
  setPinPosition: (pinId: string, x: number, y: number) => void;
  onRefreshHighlight?: () => void;
};

const PIN_RADIUS = 14;

export function startReanchorLoop(opts: ReanchorOpts): () => void {
  let pending = false;

  function scheduleRecalc() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const pins = opts.getPins();
      for (const { id, pin } of pins) {
        const el = opts.getElement(id);
        if (!el || !el.isConnected) continue;
        const r = el.getBoundingClientRect();
        // Page-absolute coords — pins are in a position:absolute container
        // so they scroll with the document natively, no JS scroll handler needed
        const x = r.left + window.scrollX + pin.offsetX * r.width - PIN_RADIUS;
        const y = r.top + window.scrollY + pin.offsetY * r.height - PIN_RADIUS;
        opts.setPinPosition(id, x, y);
      }
      opts.onRefreshHighlight?.();
    });
  }

  const ro = new ResizeObserver(() => scheduleRecalc());
  ro.observe(document.body);

  // Initial calc
  scheduleRecalc();

  return () => {
    ro.disconnect();
  };
}
