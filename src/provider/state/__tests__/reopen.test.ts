// Unit coverage for the capture-time trigger discovery tiers. Library-agnostic:
// these are hand-written DOM shapes chosen to pin down each tier's boundary,
// including the ones where it must decline to answer.

import { describe, it, expect, beforeEach } from 'vitest';
import { findOpeningTrigger } from '../reopen';
import { detectAutoSegment } from '../autoState';
import { getStateStackForElement } from '../NoddState';

beforeEach(() => {
  document.body.innerHTML = '';
});

const segmentOf = (selector: string) => detectAutoSegment(document.querySelector(selector)!)!;

describe('tier 1 — aria-controls', () => {
  it('follows the explicit link', () => {
    document.body.innerHTML = `
      <button id="t" aria-haspopup="dialog" aria-expanded="true" aria-controls="c">Open</button>
      <div id="c" role="dialog" data-state="open" aria-label="Settings"><p id="probe">body</p></div>`;
    expect(findOpeningTrigger(segmentOf('#c'))?.id).toBe('t');
  });

  it('accepts a link that points inside the overlay, not only at its root', () => {
    document.body.innerHTML = `
      <button id="t" aria-controls="inner">Open</button>
      <div role="dialog" data-state="open" aria-label="Settings">
        <div id="inner"><p id="probe">body</p></div>
      </div>`;
    expect(findOpeningTrigger(segmentOf('[role=dialog]'))?.id).toBe('t');
  });

  it('disambiguates identical row triggers, which the reveal-time hunt cannot', () => {
    document.body.innerHTML = `
      <button class="more" aria-haspopup="menu" aria-expanded="false" aria-label="More"></button>
      <button class="more" id="t" aria-haspopup="menu" aria-expanded="true" aria-controls="c" aria-label="More"></button>
      <button class="more" aria-haspopup="menu" aria-expanded="false" aria-label="More"></button>
      <div id="c" role="menu" data-state="open" aria-label="Row actions"><span id="probe">Delete</span></div>`;
    expect(findOpeningTrigger(segmentOf('#c'))?.id).toBe('t');
  });
});

describe('tier 2 — expanded haspopup', () => {
  it('takes the sole expanded trigger of the matching role', () => {
    document.body.innerHTML = `
      <button id="t" aria-haspopup="dialog" aria-expanded="true">Open</button>
      <div role="dialog" data-state="open" aria-label="Profile"><p id="probe">x</p></div>`;
    expect(findOpeningTrigger(segmentOf('[role=dialog]'))?.id).toBe('t');
  });

  it('declines when two candidates are expanded', () => {
    document.body.innerHTML = `
      <button id="a" aria-haspopup="dialog" aria-expanded="true">A</button>
      <button id="b" aria-haspopup="dialog" aria-expanded="true">B</button>
      <div role="dialog" data-state="open" aria-label="Profile"><p id="probe">x</p></div>`;
    expect(findOpeningTrigger(segmentOf('[role=dialog]'))).toBeNull();
  });

  it('ignores an expanded trigger advertising a different popup kind', () => {
    document.body.innerHTML = `
      <button id="t" aria-haspopup="menu" aria-expanded="true">Menu</button>
      <div role="dialog" data-state="open" aria-label="Profile"><p id="probe">x</p></div>`;
    expect(findOpeningTrigger(segmentOf('[role=dialog]'))).toBeNull();
  });
});

describe('tier 3 — bare data-state control', () => {
  it('catches the custom-select shape', () => {
    document.body.innerHTML = `
      <button id="t" data-state="open">Pick one</button>
      <div role="listbox" data-state="open" aria-label="Region"><p id="probe">EU</p></div>`;
    expect(findOpeningTrigger(segmentOf('[role=listbox]'))?.id).toBe('t');
  });

  it('is not applied to dialogs — a lone open button elsewhere is likely unrelated', () => {
    document.body.innerHTML = `
      <button id="accordion" data-state="open">Section</button>
      <div role="dialog" data-state="open" aria-label="Assign policy"><p id="probe">x</p></div>`;
    expect(findOpeningTrigger(segmentOf('[role=dialog]'))).toBeNull();
  });

  it('skips non-interactive elements marked open', () => {
    document.body.innerHTML = `
      <div id="decor" data-state="open"></div>
      <div role="listbox" data-state="open" aria-label="Region"><p id="probe">EU</p></div>`;
    expect(findOpeningTrigger(segmentOf('[role=listbox]'))).toBeNull();
  });
});

describe('guards', () => {
  it('never picks a control inside the overlay it would open', () => {
    document.body.innerHTML = `
      <div role="dialog" data-state="open" aria-label="Settings">
        <button id="inner" aria-haspopup="menu" aria-expanded="true">Inner</button>
        <p id="probe">x</p>
      </div>`;
    expect(findOpeningTrigger(segmentOf('[role=dialog]'))).toBeNull();
  });

  it('never records a trigger for an explicit <NoddState> segment', () => {
    document.body.innerHTML = `
      <button id="t" aria-haspopup="dialog" aria-expanded="true">Open</button>
      <div data-nodd-state="step-2"><p id="probe">x</p></div>`;
    expect(findOpeningTrigger('step-2')).toBeNull();
  });
});

describe('nested states', () => {
  it('records a separate opener for each level of the stack', () => {
    document.body.innerHTML = `
      <button id="dt" aria-haspopup="dialog" aria-expanded="true" aria-controls="d">Open dialog</button>
      <div id="d" role="dialog" data-state="open" aria-label="Settings">
        <button id="mt" aria-haspopup="menu" aria-expanded="true" aria-controls="m">Actions</button>
        <div id="m" role="menu" data-state="open" aria-label="Actions"><p id="probe">Delete</p></div>
      </div>`;
    const stack = getStateStackForElement(document.getElementById('probe')!);
    expect(stack).toEqual(['auto:dialog:settings', 'auto:menu:actions']);
    expect(findOpeningTrigger(stack[0])?.id).toBe('dt');
    expect(findOpeningTrigger(stack[1])?.id).toBe('mt');
  });
});
