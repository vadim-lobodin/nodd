import { buildSelector } from './selectorBuilder';
import { computeFingerprintSync } from './fingerprint';
import { resolvePin, type ResolveResult } from './resolver';

export type Pin = {
  selector: string;
  offsetX: number;
  offsetY: number;
  fingerprint: string;
  viewportWidth: number;
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const PIN_RADIUS = 14;

export const DOMAnchor = {
  create(target: Element, clientX: number, clientY: number): Pin {
    const selector = buildSelector(target);
    const fingerprint = computeFingerprintSync(target);
    const r = target.getBoundingClientRect();
    const offsetX = clamp((clientX - r.left) / r.width, 0, 1);
    const offsetY = clamp((clientY - r.top) / r.height, 0, 1);
    return {
      selector,
      offsetX,
      offsetY,
      fingerprint,
      viewportWidth: window.innerWidth,
    };
  },

  resolve(pin: Pin): ResolveResult {
    return resolvePin(pin);
  },

  reposition(pin: Pin, cachedElement: Element): { x: number; y: number } {
    const r = cachedElement.getBoundingClientRect();
    return {
      x: r.left + window.scrollX + pin.offsetX * r.width - PIN_RADIUS,
      y: r.top + window.scrollY + pin.offsetY * r.height - PIN_RADIUS,
    };
  },
};
