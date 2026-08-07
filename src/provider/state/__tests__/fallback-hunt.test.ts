// `findAutoTrigger` — the reveal-time fallback for threads with no recorded
// trigger. Weaker than a recording by construction, so the interesting cases are
// the ones where it must still decline.

import { describe, it, expect, beforeEach } from 'vitest';
import { findAutoTrigger } from '../autoState';
import { activateState } from '../activator';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('name-based narrowing', () => {
  it('picks the trigger whose label matches the state name', () => {
    document.body.innerHTML = `
      <button id="a" aria-haspopup="dialog" aria-expanded="false">Profile</button>
      <button id="b" aria-haspopup="dialog" aria-expanded="false">Settings</button>`;
    expect(findAutoTrigger('auto:dialog:settings')?.id).toBe('b');
  });

  it('matches a trigger whose label contains the state name', () => {
    // A dialog titled "Settings" opened by a button reading "Open settings".
    document.body.innerHTML = `
      <button id="a" aria-haspopup="dialog" aria-expanded="false">Open profile</button>
      <button id="b" aria-haspopup="dialog" aria-expanded="false">Open settings</button>`;
    expect(findAutoTrigger('auto:dialog:settings')?.id).toBe('b');
  });

  it('still declines when the candidates are genuinely identical', () => {
    document.body.innerHTML = `
      <button aria-haspopup="menu" aria-expanded="false" aria-label="More"></button>
      <button aria-haspopup="menu" aria-expanded="false" aria-label="More"></button>`;
    expect(findAutoTrigger('auto:menu:row-actions')).toBeNull();
  });

  it('declines when two candidates match the name equally well', () => {
    document.body.innerHTML = `
      <button aria-haspopup="dialog" aria-expanded="false">Settings</button>
      <button aria-haspopup="dialog" aria-expanded="false">Settings</button>`;
    expect(findAutoTrigger('auto:dialog:settings')).toBeNull();
  });

  it('keeps working for an unnamed state with a single candidate', () => {
    document.body.innerHTML = `<button id="a" aria-haspopup="menu" aria-expanded="false">x</button>`;
    expect(findAutoTrigger('auto:menu')?.id).toBe('a');
  });
});

describe('combobox shape (aria-controls, no aria-haspopup)', () => {
  it('finds a Radix Select-style trigger', () => {
    document.body.innerHTML = `
      <button id="t" role="combobox" aria-expanded="false" aria-controls="list">Region</button>`;
    expect(findAutoTrigger('auto:listbox:region')?.id).toBe('t');
  });

  it('prefers an advertised haspopup trigger over a bare linked one', () => {
    document.body.innerHTML = `
      <button id="linked" aria-expanded="false" aria-controls="x">Region</button>
      <button id="advertised" aria-haspopup="listbox" aria-expanded="false">Region</button>`;
    expect(findAutoTrigger('auto:listbox:region')?.id).toBe('advertised');
  });
});

describe('scoping to an open parent state', () => {
  it('prefers a candidate inside the parent over an identical one outside', async () => {
    document.body.innerHTML = `
      <button id="outside" aria-haspopup="menu" aria-expanded="false" aria-label="More"></button>
      <div role="dialog" data-state="open" aria-label="Settings">
        <button id="inside" aria-haspopup="menu" aria-expanded="false" aria-label="More"></button>
      </div>`;
    const dialog = document.querySelector('[role=dialog]')!;
    expect(findAutoTrigger('auto:menu:more', { within: dialog })?.id).toBe('inside');
    // Document-wide, the two are indistinguishable and it declines.
    expect(findAutoTrigger('auto:menu:more')).toBeNull();
  });

  it('activateState scopes the nested hunt to the parent it just opened', async () => {
    // Two "More" menus on the page; only the one inside the dialog is correct.
    document.body.innerHTML = `
      <button id="outside" aria-haspopup="menu" aria-expanded="false" aria-label="More"></button>
      <div role="dialog" data-state="open" aria-label="Settings">
        <button id="inside" aria-haspopup="menu" aria-expanded="false" aria-label="More"></button>
      </div>`;
    let openedBy: string | null = null;
    document.querySelectorAll<HTMLElement>('[aria-label="More"]').forEach(btn => {
      btn.addEventListener('click', () => {
        openedBy = btn.id;
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('data-state', 'open');
        menu.setAttribute('aria-label', 'More');
        document.body.appendChild(menu);
      });
    });

    const result = await activateState(['auto:dialog:settings', 'auto:menu:more'], { timeoutMs: 300 });
    expect(result.ok).toBe(true);
    expect(openedBy).toBe('inside');
  });
});
