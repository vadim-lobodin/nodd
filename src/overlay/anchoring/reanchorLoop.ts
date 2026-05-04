export type ReanchorOpts = {
  getPins: () => Array<{ id: string; pin: { offsetX: number; offsetY: number } }>;
  getElement: (pinId: string) => Element | null;
  setPinPosition: (pinId: string, x: number, y: number) => void;
  onDOMMutation?: () => void;
};

const PIN_RADIUS = 14;

function isInsideAlign(node: Node | null): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur instanceof Element && (cur.hasAttribute('data-align-root') || cur.hasAttribute('data-align-pin-container'))) {
      return true;
    }
    cur = cur.parentNode;
  }
  return false;
}

export function startReanchorLoop(opts: ReanchorOpts): () => void {
  let pending = false;
  let mutationPending = false;

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
    });
  }

  function scheduleMutation() {
    if (mutationPending || !opts.onDOMMutation) return;
    mutationPending = true;
    requestAnimationFrame(() => {
      mutationPending = false;
      opts.onDOMMutation?.();
    });
  }

  const ro = new ResizeObserver(() => scheduleRecalc());
  ro.observe(document.body);

  // MutationObserver: re-run selector resolution when host DOM changes
  // (modal opens, route changes, content re-renders). Ignores mutations
  // inside our own portals to avoid feedback loops.
  const mo = new MutationObserver(records => {
    for (const r of records) {
      if (!isInsideAlign(r.target)) {
        scheduleMutation();
        return;
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Initial calc
  scheduleRecalc();

  return () => {
    ro.disconnect();
    mo.disconnect();
  };
}
