// The full capture → persist → reload → reveal round trip, on the page shape
// that defeats the reveal-time hunt: several identical row menus.

import { describe, it, expect, beforeEach } from 'vitest';
import { captureStateTriggers, makeTriggerResolver } from '../../../overlay/stateTriggers';
import { getStateStackForElement } from '../NoddState';
import { activateState } from '../activator';
import type { Pin } from '../../../overlay/anchoring/DOMAnchor';

const ROWS = ['Alpha', 'Beta', 'Gamma'];

/**
 * Rows with identical "More" buttons, distinguished only by their title.
 * Clicking a row's button opens that row's menu.
 */
function buildRows(order: string[] = ROWS) {
  document.body.innerHTML = `<ul>${order
    .map(
      name =>
        `<li class="row"><span class="title">${name}</span><button class="more" aria-haspopup="menu" aria-expanded="false" aria-label="More"></button></li>`,
    )
    .join('')}</ul>`;
  document.querySelectorAll<HTMLElement>('.more').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') === 'true') return;
      const menu = document.createElement('div');
      menu.id = `menu-${i}`;
      menu.setAttribute('role', 'menu');
      menu.setAttribute('data-state', 'open');
      menu.setAttribute('aria-label', 'Row actions');
      menu.innerHTML = '<button class="item">Delete</button>';
      document.body.appendChild(menu);
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-controls', menu.id);
    });
  });
}

/** Round-trip the pin through JSON the way the store would. */
function persist(stateTriggers: Pin['stateTriggers']): Pin {
  return JSON.parse(JSON.stringify({
    selector: 'x', offsetX: 0, offsetY: 0, fingerprint: 'x', viewportWidth: 1000, stateTriggers,
  }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('capture → reveal', () => {
  it('reopens the specific row the comment was left in', async () => {
    buildRows();
    document.querySelectorAll<HTMLElement>('.more')[1].click();

    const stack = getStateStackForElement(document.querySelector('#menu-1 .item')!);
    expect(stack).toEqual(['auto:menu:row-actions']);
    const captured = captureStateTriggers(stack);
    expect(captured.unreopenable).toEqual([]);
    const pin = persist(captured.triggers);

    buildRows(); // reload: every menu closed again
    expect(document.querySelectorAll('[role=menu]')).toHaveLength(0);

    const result = await activateState(stack, {
      recordedTrigger: makeTriggerResolver(pin),
      timeoutMs: 500,
    });
    expect(result.ok).toBe(true);
    expect(document.querySelector('[role=menu]')?.id).toBe('menu-1');
  });

  it('never reopens a different row after the list is reordered', async () => {
    // The motivating case for recorded triggers is also its sharpest hazard: the
    // buttons are indistinguishable, so a selector that leans on positional
    // ancestry happily resolves to the wrong row's identical button and presses
    // it with full confidence. Opening a stranger's menu is worse than failing.
    buildRows();
    document.querySelectorAll<HTMLElement>('.more')[1].click(); // Beta
    const stack = getStateStackForElement(document.querySelector('#menu-1 .item')!);
    const pin = persist(captureStateTriggers(stack).triggers);

    buildRows(['Gamma', 'Alpha', 'Beta']); // Beta is now last
    const resolved = makeTriggerResolver(pin)('auto:menu:row-actions');
    expect(resolved).toBe(document.querySelectorAll<HTMLElement>('.more')[2]);
  });

  it('never reopens a different row after a row is inserted above', async () => {
    buildRows();
    document.querySelectorAll<HTMLElement>('.more')[1].click(); // Beta
    const stack = getStateStackForElement(document.querySelector('#menu-1 .item')!);
    const pin = persist(captureStateTriggers(stack).triggers);

    buildRows(['Zeta', ...ROWS]); // everything shifts down one
    const resolved = makeTriggerResolver(pin)('auto:menu:row-actions');
    expect(resolved).toBe(document.querySelectorAll<HTMLElement>('.more')[2]);
  });

  it('declines rather than substituting a look-alike when the row is gone', async () => {
    buildRows();
    document.querySelectorAll<HTMLElement>('.more')[1].click(); // Beta
    const stack = getStateStackForElement(document.querySelector('#menu-1 .item')!);
    const pin = persist(captureStateTriggers(stack).triggers);

    buildRows(['Alpha', 'Gamma']); // Beta deleted; its twin buttons remain
    expect(makeTriggerResolver(pin)('auto:menu:row-actions')).toBeNull();
  });

  it('fails closed, naming the segment, when nothing was recorded', async () => {
    buildRows();
    const result = await activateState(['auto:menu:row-actions'], {
      recordedTrigger: () => null,
      timeoutMs: 100,
    });
    expect(result).toEqual({ ok: false, failedSegment: 'auto:menu:row-actions' });
  });

  it('falls back to the hunt rather than clicking a control that has changed', async () => {
    buildRows();
    document.querySelectorAll<HTMLElement>('.more')[1].click();
    const stack = getStateStackForElement(document.querySelector('#menu-1 .item')!);
    const pin = persist(captureStateTriggers(stack).triggers);

    // The host ships a redesign: the row buttons are labelled differently, so
    // the recorded fingerprint no longer matches anything.
    buildRows();
    document.querySelectorAll('.more').forEach(b => { b.textContent = 'Options'; });
    expect(makeTriggerResolver(pin)('auto:menu:row-actions')).toBeNull();
  });

  it('warns at capture time for a controlled overlay with no trigger', () => {
    document.body.innerHTML = `
      <div role="dialog" data-state="open" aria-label="Assign to policy"><p id="t">x</p></div>`;
    const stack = getStateStackForElement(document.getElementById('t')!);
    const captured = captureStateTriggers(stack);
    expect(captured.triggers).toEqual({});
    expect(captured.unreopenable).toEqual(['auto:dialog:assign-to-policy']);
  });

  it('does not warn for an explicit state the host registered a trigger for', () => {
    document.body.innerHTML = `
      <button data-nodd-open-state="steps-menu">Steps</button>
      <div data-nodd-state="steps-menu"><p id="t">x</p></div>`;
    const stack = getStateStackForElement(document.getElementById('t')!);
    expect(captureStateTriggers(stack).unreopenable).toEqual([]);
  });

  it('skips segments that are already mounted', async () => {
    document.body.innerHTML = `
      <div role="dialog" data-state="open" aria-label="Settings"><p id="t">x</p></div>`;
    const result = await activateState(['auto:dialog:settings'], { timeoutMs: 50 });
    expect(result.ok).toBe(true);
  });
});
