// Degraded anchoring — what a comment falls back to when the host has swapped
// the view out from under it (page 4 of a list, a different filter, a different
// demo scenario). The property that matters is that the thread stays reachable
// without ever claiming a precision it doesn't have.

import { describe, it, expect, beforeEach } from 'vitest';
import { DOMAnchor } from '../DOMAnchor';
import { resolveApproximateAnchor, captureAnchorLabel, isPageLevelContainer } from '../approximate';

// jsdom lays nothing out, so every rect is 0×0 and the "is it rendered" check
// would reject every container. Give elements a size unless a test says otherwise.
beforeEach(() => {
  document.body.innerHTML = '';
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40, toJSON() {} };
  } as never;
});

function page(n: number) {
  document.body.innerHTML = `
    <main id="screen">
      <section id="team-list">
        <div class="row" data-testid="row-${n}"><span class="name">Person ${n}</span></div>
      </section>
    </main>`;
  return document.querySelector('.name') as Element;
}

describe('resolveApproximateAnchor', () => {
  it('falls back to the nearest container that survived the view change', () => {
    const pin = DOMAnchor.create(page(4), 10, 10);
    expect(DOMAnchor.resolve(pin)).not.toBeNull();

    // The host paginates back to page 1: same list, different rows.
    page(1);
    expect(DOMAnchor.resolve(pin)).toBeNull(); // exact anchor is gone…

    const container = resolveApproximateAnchor(pin);
    expect(container).not.toBeNull();
    // …but the list it lived in is still here, and that is where it lands.
    expect(container?.closest('#team-list')).not.toBeNull();
  });

  it('walks further out when a nearer container is gone too', () => {
    const pin = DOMAnchor.create(page(4), 10, 10);
    document.body.innerHTML = '<main id="screen"><p>Nothing to see</p></main>';
    expect(resolveApproximateAnchor(pin)?.id).toBe('screen');
  });

  it('lands on the body rather than nowhere when the whole screen changed', () => {
    const pin = DOMAnchor.create(page(4), 10, 10);
    document.body.innerHTML = '<article>A completely different screen</article>';
    expect(resolveApproximateAnchor(pin)).toBe(document.body);
  });

  it('still lands on the body when the anchor was deeper than the chain records', () => {
    // Eight levels is where the recorded chain stops, and the levels it does
    // record are the nearest ones — the ones most likely to be swapped out with
    // the anchor. A twelve-deep tree (ordinary for React) would otherwise leave
    // nothing to match and dead-end exactly like it did before this existed.
    const deep = Array.from({ length: 12 }, (_, i) => `<div class="w${i}">`).join('');
    document.body.innerHTML = `${deep}<span class="name">Person 4</span>${'</div>'.repeat(12)}`;
    const pin = DOMAnchor.create(document.querySelector('.name') as Element, 5, 5);

    expect(pin.ancestors?.length).toBeGreaterThan(8);
    const floor = pin.ancestors![pin.ancestors!.length - 1];
    expect(document.querySelectorAll(floor)[0]).toBe(document.body);

    document.body.innerHTML = '<article>A completely different screen</article>';
    expect(resolveApproximateAnchor(pin)).toBe(document.body);
  });

  it('declines rather than guessing between two copies of a container', () => {
    document.body.innerHTML = '<div><ul class="list"><li class="item">a</li></ul></div>';
    const pin = DOMAnchor.create(document.querySelector('.item') as Element, 1, 1);
    // A second, identical list appears — which one held the comment is unknowable,
    // so the ambiguous level is skipped in favour of the unambiguous one outside it.
    document.body.innerHTML =
      '<div><ul class="list"><li>x</li></ul><ul class="list"><li>y</li></ul></div>';
    const container = resolveApproximateAnchor(pin);
    expect(container?.tagName).not.toBe('UL');
    expect(container).not.toBeNull();
  });

  it('skips a container that is present but not rendered', () => {
    const pin = DOMAnchor.create(page(4), 10, 10);
    page(1);
    const list = document.querySelector('#team-list') as HTMLElement;
    list.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }) as never;
    expect(resolveApproximateAnchor(pin)?.id).toBe('screen');
  });

  it('gives nothing for a pin written before the chain was recorded', () => {
    const pin = DOMAnchor.create(page(4), 10, 10);
    delete (pin as { ancestors?: string[] }).ancestors;
    expect(resolveApproximateAnchor(pin)).toBeNull();
  });
});

describe('isPageLevelContainer', () => {
  it('marks the page itself, so reveal stops calling it nearby', () => {
    document.body.innerHTML = '<div id="d"></div>';
    expect(isPageLevelContainer(document.body)).toBe(true);
    expect(isPageLevelContainer(document.documentElement)).toBe(true);
    expect(isPageLevelContainer(document.getElementById('d')!)).toBe(false);
  });
});

describe('captureAnchorLabel', () => {
  it('names the element so a viewer can be told what is missing', () => {
    expect(captureAnchorLabel(page(4))).toBe('Person 4');
  });

  it('collapses whitespace and truncates, since it is shown inline', () => {
    document.body.innerHTML = `<p>${'word '.repeat(40)}</p>`;
    const label = captureAnchorLabel(document.querySelector('p') as Element)!;
    expect(label.length).toBeLessThanOrEqual(48);
    expect(label).not.toMatch(/\s\s/);
    expect(label.endsWith('…')).toBe(true);
  });

  it('falls back to the accessible name when there is no text', () => {
    document.body.innerHTML = '<button aria-label="Close dialog"></button>';
    expect(captureAnchorLabel(document.querySelector('button') as Element)).toBe('Close dialog');
  });

  it('is absent rather than empty when there is nothing to say', () => {
    document.body.innerHTML = '<div class="spacer"></div>';
    expect(captureAnchorLabel(document.querySelector('.spacer') as Element)).toBeUndefined();
  });
});
