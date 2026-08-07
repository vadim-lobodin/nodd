// Shared setup for the state tests: a jsdom environment complete enough for
// real overlay libraries to mount, plus a tiny render helper.
//
// The libraries are rendered for real rather than reproduced as HTML fixtures.
// A fixture written from memory is still a guess, just an executable one — and
// the whole point of the compatibility matrix is to replace guesses about what
// these libraries emit with observations.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
(Element.prototype as any).hasPointerCapture ??= () => false;
(Element.prototype as any).releasePointerCapture ??= () => {};
(Element.prototype as any).setPointerCapture ??= () => {};

export function render(ui: React.ReactElement): void {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(ui);
  });
}

export function click(el: Element | null): void {
  if (!el) throw new Error('nothing to click');
  act(() => {
    (el as HTMLElement).click();
  });
}

export function reset(): void {
  document.body.innerHTML = '';
}
