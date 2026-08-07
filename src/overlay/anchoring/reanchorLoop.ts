import { DOMAnchor, type Pin } from './DOMAnchor';

export type ReanchorOpts = {
  getPins: () => Array<{ id: string; pin: Pin }>;
  getElement: (pinId: string) => Element | null;
  setPinPosition: (pinId: string, x: number, y: number) => void;
  onDOMMutation?: () => void;
};

function isInsideAlign(node: Node | null): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur instanceof Element && (cur.hasAttribute('data-nodd-root') || cur.hasAttribute('data-nodd-pin-container'))) {
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
        // Page-absolute coords — pins live in a position:absolute container, so
        // they scroll with the document natively, no JS scroll handler needed.
        //
        // Delegated rather than recomputed inline: this loop used to carry its
        // own copy of the arithmetic, which silently ignored page anchors and
        // flung those pins to the document origin on the next resize tick. One
        // definition, one behaviour.
        const { x, y } = DOMAnchor.reposition(pin, el);
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

  // ResizeObserver is delivered after layout and can miss the current paint's
  // rAF deadline. The viewport event schedules the same coalesced pass sooner;
  // `pending` ensures both signals still produce at most one calculation per
  // frame.
  window.addEventListener('resize', scheduleRecalc, { passive: true });

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
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    // A stable <NoddState name={state}> wrapper can change state without
    // mounting a new node, so watch that one semantic attribute explicitly.
    attributes: true,
    attributeFilter: ['data-nodd-state'],
  });

  // Initial calc
  scheduleRecalc();

  return () => {
    ro.disconnect();
    mo.disconnect();
    window.removeEventListener('resize', scheduleRecalc);
  };
}
