// Page anchors — comments left on empty space, where there is no element to
// hang off. The property that matters is that they do not move.

import { describe, it, expect, beforeEach } from 'vitest';
import { DOMAnchor } from '../DOMAnchor';
import { buildSelector } from '../selectorBuilder';
import { computeFingerprintSync } from '../fingerprint';

(globalThis as any).ResizeObserver ??= class {
  observe() {} unobserve() {} disconnect() {}
};

function setDocumentSize(width: number, height: number) {
  Object.defineProperty(document.documentElement, 'scrollWidth', { value: width, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: height, configurable: true });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="page">short content</div>';
  setDocumentSize(1000, 1500);
  window.scrollX = 0;
  window.scrollY = 0;
});

describe('creating a page anchor', () => {
  it('gives the root elements a resolvable selector', () => {
    // The walk-up deliberately stops before these, which used to leave an empty
    // selector — a pin that could never be found again.
    expect(buildSelector(document.body)).toBe('body');
    expect(buildSelector(document.documentElement)).toBe('html');
  });

  it('resolves back to the page after a reload', () => {
    const pin = DOMAnchor.create(document.body, 500, 800);
    const roundTripped = JSON.parse(JSON.stringify(pin));
    expect(DOMAnchor.resolve(roundTripped)?.element).toBe(document.body);
  });

  it('fingerprints the page by tag alone, so editing the page cannot orphan it', () => {
    const before = computeFingerprintSync(document.body);
    document.body.innerHTML = '<div id="page">completely different copy</div>';
    expect(computeFingerprintSync(document.body)).toBe(before);
  });
});

describe('a page anchor stays where it was put', () => {
  it('renders at the clicked point', () => {
    const pin = DOMAnchor.create(document.body, 500, 800);
    const { x, y } = DOMAnchor.reposition(pin, document.body);
    expect(x + 14).toBe(500);
    expect(y + 14).toBe(800);
  });

  it('does not move when the document grows or shrinks', () => {
    // The regression this replaced: position was a *fraction* of the document,
    // so the same pin landed at 800, 1600 or 427 depending on when it was
    // measured — and Nodd's own absolutely-positioned pin container feeds into
    // that height, so a pin low on the page chased its own tail.
    const pin = DOMAnchor.create(document.body, 500, 800);
    const at = () => DOMAnchor.reposition(pin, document.body).y;
    const original = at();

    setDocumentSize(1000, 3000);
    expect(at()).toBe(original);
    setDocumentSize(1000, 800);
    expect(at()).toBe(original);
  });

  it('records the point in document space, not viewport space', () => {
    window.scrollY = 400;
    const pin = DOMAnchor.create(document.body, 500, 200); // 200px down a scrolled viewport
    expect(pin.page).toEqual({ x: 500, y: 600 });
    // Pins live in the page-absolute container, so this is what keeps them
    // pinned to the document rather than sliding with the viewport.
    expect(DOMAnchor.reposition(pin, document.body).y + 14).toBe(600);
  });
});

describe('the re-anchor loop agrees with DOMAnchor', () => {
  it('leaves a page anchor alone on a layout tick', async () => {
    // This loop used to carry a second copy of the positioning arithmetic, which
    // knew nothing about page anchors: it read offsetX/offsetY (0, 0 for these)
    // against the body box and threw the pin to the document origin on the first
    // resize. One definition of "where does this pin go", not two.
    const { startReanchorLoop } = await import('../reanchorLoop');
    const pin = DOMAnchor.create(document.body, 500, 800);
    const moved: Array<{ x: number; y: number }> = [];

    const stop = startReanchorLoop({
      getPins: () => [{ id: 'p', pin }],
      getElement: () => document.body,
      setPinPosition: (_id, x, y) => moved.push({ x, y }),
    });
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    stop();

    expect(moved.length).toBeGreaterThan(0);
    const last = moved[moved.length - 1];
    expect(last).toEqual(DOMAnchor.reposition(pin, document.body));
    expect(last.y + 14).toBe(800);
  });
});

describe('element anchors are untouched', () => {
  it('still positions from the element box', () => {
    const el = document.getElementById('page')!;
    el.getBoundingClientRect = () => ({ left: 100, top: 200, width: 400, height: 50 }) as DOMRect;
    const pin = DOMAnchor.create(el, 300, 225);
    expect(pin.page).toBeUndefined();
    expect(pin.offsetX).toBeCloseTo(0.5);
    expect(DOMAnchor.reposition(pin, el).x + 14).toBe(300);
  });
});
