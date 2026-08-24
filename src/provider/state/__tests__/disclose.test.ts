// Anchors that are present but not shown — closed tab panels, collapsed
// accordions, <details>. Two properties matter: such an anchor must never be
// treated as a normal, positionable one (that was the top-left-corner bug), and
// it must be reopenable without the host having done anything for Nodd.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isHiddenElement,
  isRendered,
  findDiscloseControl,
  discloseAncestors,
  describeContainer,
} from '../disclose';

beforeEach(() => {
  document.body.innerHTML = '';
  // jsdom has no rAF by default in some configs; keep the polling loop cheap.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number,
  );
});

/** A tab widget wired the way the ARIA pattern says to wire one. */
function tabs(selected: 'general' | 'billing') {
  document.body.innerHTML = `
    <div role="tablist">
      <button role="tab" id="tab-general" aria-controls="panel-general"
              aria-selected="${selected === 'general'}">General</button>
      <button role="tab" id="tab-billing" aria-controls="panel-billing"
              aria-selected="${selected === 'billing'}">Billing</button>
    </div>
    <div role="tabpanel" id="panel-general" aria-labelledby="tab-general"
         ${selected === 'general' ? '' : 'hidden'}><p class="body">General settings</p></div>
    <div role="tabpanel" id="panel-billing" aria-labelledby="tab-billing"
         ${selected === 'billing' ? '' : 'hidden'}><p class="body">Card on file</p></div>`;

  // Make the tabs actually work, as a host would.
  for (const tab of document.querySelectorAll<HTMLElement>('[role="tab"]')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll<HTMLElement>('[role="tab"]')) {
        const panel = document.getElementById(t.getAttribute('aria-controls')!)!;
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        panel.toggleAttribute('hidden', !on);
      }
    });
  }
}

describe('isHiddenElement / isRendered', () => {
  it('reads declared hiding, not layout', () => {
    document.body.innerHTML = '<div id="a"><span id="b">text</span></div>';
    const b = document.getElementById('b')!;
    // Zero-size in jsdom, but nothing has declared it hidden — so it counts as
    // rendered. Measuring layout here would suppress pins that are simply
    // pre-paint or inside a display:contents wrapper.
    expect(isRendered(b)).toBe(true);

    document.getElementById('a')!.setAttribute('hidden', '');
    expect(isRendered(b)).toBe(false);
  });

  it.each([
    ['hidden attribute', '<div hidden><i id="t"></i></div>'],
    ['aria-hidden', '<div aria-hidden="true"><i id="t"></i></div>'],
    ['display none', '<div style="display:none"><i id="t"></i></div>'],
    ['visibility hidden', '<div style="visibility:hidden"><i id="t"></i></div>'],
    ['closed details', '<details><summary>More</summary><i id="t"></i></details>'],
  ])('treats %s as hidden', (_label, html) => {
    document.body.innerHTML = html;
    expect(isRendered(document.getElementById('t')!)).toBe(false);
  });

  it('does not treat an open details as hidden', () => {
    document.body.innerHTML = '<details open><summary>More</summary><i id="t"></i></details>';
    expect(isRendered(document.getElementById('t')!)).toBe(true);
  });

  it('a detached element is not rendered', () => {
    const el = document.createElement('div');
    expect(isRendered(el)).toBe(false);
  });
});

describe('findDiscloseControl', () => {
  it('finds the tab that owns a hidden panel', () => {
    tabs('general');
    const panel = document.getElementById('panel-billing')!;
    expect(findDiscloseControl(panel)?.id).toBe('tab-billing');
  });

  it('finds the summary of a closed details', () => {
    document.body.innerHTML = '<details id="d"><summary>Advanced</summary><i></i></details>';
    expect(findDiscloseControl(document.getElementById('d')!)?.tagName).toBe('SUMMARY');
  });

  it('finds a disclosure button via aria-controls', () => {
    document.body.innerHTML = `
      <button id="toggle" aria-expanded="false" aria-controls="region">Advanced</button>
      <div id="region" hidden><i></i></div>`;
    expect(findDiscloseControl(document.getElementById('region')!)?.id).toBe('toggle');
  });

  it('declines when two controls claim the same container', () => {
    document.body.innerHTML = `
      <button id="a" aria-controls="region"></button>
      <button id="b" aria-controls="region"></button>
      <div id="region" hidden></div>`;
    expect(findDiscloseControl(document.getElementById('region')!)).toBeNull();
  });

  it('ignores a control that already reports itself expanded', () => {
    // It is pointing at something else that shares the id relationship, or the
    // host's state is inconsistent. Either way pressing it would close, not open.
    document.body.innerHTML = `
      <button id="toggle" aria-expanded="true" aria-controls="region"></button>
      <div id="region" hidden></div>`;
    expect(findDiscloseControl(document.getElementById('region')!)).toBeNull();
  });

  it('gives nothing for a container with no ARIA and no id', () => {
    document.body.innerHTML = '<div class="panel" hidden><i></i></div>';
    expect(findDiscloseControl(document.querySelector('.panel')!)).toBeNull();
  });
});

describe('discloseAncestors', () => {
  it('opens the tab a comment was left under', async () => {
    tabs('general');
    const anchor = document.querySelector('#panel-billing .body')!;
    expect(isRendered(anchor)).toBe(false);

    const result = await discloseAncestors(anchor);

    expect(result).toEqual({ revealed: true, changed: true, blocked: null });
    expect(isRendered(anchor)).toBe(true);
    expect(document.getElementById('tab-billing')!.getAttribute('aria-selected')).toBe('true');
  });

  it('opens a details', async () => {
    document.body.innerHTML = '<details><summary>More</summary><i id="t"></i></details>';
    const anchor = document.getElementById('t')!;
    const result = await discloseAncestors(anchor);
    expect(result.revealed).toBe(true);
    expect(document.querySelector('details')!.open).toBe(true);
  });

  it('opens nested disclosures from the outside in', async () => {
    document.body.innerHTML = `
      <button id="outer-btn" aria-expanded="false" aria-controls="outer">Section</button>
      <div id="outer" hidden>
        <details id="inner"><summary>Details</summary><i id="t"></i></details>
      </div>`;
    document.getElementById('outer-btn')!.addEventListener('click', () => {
      document.getElementById('outer')!.removeAttribute('hidden');
    });

    const result = await discloseAncestors(document.getElementById('t')!);

    expect(result.revealed).toBe(true);
    expect(document.getElementById('inner')!.hasAttribute('open')).toBe(true);
  });

  it('names what blocked it rather than pressing something it is unsure of', async () => {
    document.body.innerHTML = '<section class="panel" hidden aria-label="Archived"><i id="t"></i></section>';
    const result = await discloseAncestors(document.getElementById('t')!);
    expect(result.revealed).toBe(false);
    expect(result.blocked).toBe(document.querySelector('.panel'));
    expect(describeContainer(result.blocked!)).toBe('Archived');
  });

  it('reports failure when the control exists but does nothing', async () => {
    document.body.innerHTML = `
      <button id="toggle" aria-expanded="false" aria-controls="region">Open</button>
      <div id="region" hidden><i id="t"></i></div>`;
    const result = await discloseAncestors(document.getElementById('t')!, 20);
    expect(result.revealed).toBe(false);
    expect(result.blocked?.id).toBe('region');
  });

  it('counts the container being replaced as progress, not failure', async () => {
    // Hosts routinely unmount the closed panel and mount an open one, so the
    // element we pressed for can legitimately vanish.
    document.body.innerHTML = `
      <button id="toggle" aria-expanded="false" aria-controls="region">Open</button>
      <div id="region" hidden><i id="t"></i></div>`;
    document.getElementById('toggle')!.addEventListener('click', () => {
      const old = document.getElementById('region')!;
      const fresh = document.createElement('div');
      fresh.id = 'region';
      fresh.innerHTML = '<i id="t"></i>';
      old.replaceWith(fresh);
    });
    const result = await discloseAncestors(document.getElementById('t')!, 50);
    // The original anchor is detached, so `revealed` cannot be true — there is
    // nothing left to observe. `changed` is the load-bearing part: it's what
    // tells the caller to go and re-resolve. Asserting only `blocked: null`
    // missed that, because a detached anchor also reports nothing blocking, and
    // the caller then degraded a disclosure that had plainly worked.
    expect(result).toEqual({ revealed: false, changed: true, blocked: null });
  });

  it('reports no progress when it never pressed anything', async () => {
    document.body.innerHTML = '<section class="panel" hidden><i id="t"></i></section>';
    const result = await discloseAncestors(document.getElementById('t')!);
    expect(result.changed).toBe(false);
  });

  it('reports no progress when the anchor was never hidden', async () => {
    document.body.innerHTML = '<i id="t"></i>';
    expect(await discloseAncestors(document.getElementById('t')!)).toEqual({
      revealed: true,
      changed: false,
      blocked: null,
    });
  });
});

describe('describeContainer', () => {
  it('prefers an explicit label', () => {
    document.body.innerHTML = '<div id="d" aria-label="Billing details"></div>';
    expect(describeContainer(document.getElementById('d')!)).toBe('Billing details');
  });

  it('uses the tab name for a tabpanel', () => {
    tabs('general');
    expect(describeContainer(document.getElementById('panel-billing')!)).toBe('Billing');
  });

  it('falls back to something honest when there is no name', () => {
    document.body.innerHTML = '<div id="d" role="tabpanel"></div>';
    expect(describeContainer(document.getElementById('d')!)).toBe('a tab');
  });
});
