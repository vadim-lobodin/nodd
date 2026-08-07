// The structural fallback for overlays with no ARIA. Its precision matters more
// than its recall: a false positive scopes a comment to a "state" that isn't
// one, so most of these tests are about what it must decline to claim.

import { describe, it, expect, beforeEach } from 'vitest';
import { detectFloatingSegment, findFloatingStateElement } from '../floatingState';
import { getStateStackForElement } from '../NoddState';
import { isStateMatch } from '../useNoddState';

const FIXED_FULL = 'position:fixed;top:0;right:0;bottom:0;left:0';

beforeEach(() => {
  document.body.innerHTML = '';
});

const stackOf = (id: string) => getStateStackForElement(document.getElementById(id)!);

describe('portal tier', () => {
  it('claims a body-level layer that is not the app root', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal"><div aria-label="Filters" style="position:fixed"><p id="probe">x</p></div></div>`;
    expect(stackOf('probe')).toEqual(['float:filters']);
  });

  it('declines a body child that is not actually floating', () => {
    // "Not the app root" is not evidence of an overlay. Requiring the layer to
    // be out of flow is what keeps ordinary page content unscoped.
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="sibling-section"><h2>Related</h2><p id="probe">x</p></div>`;
    expect(stackOf('probe')).toEqual([]);
  });

  it('declines the app root itself', () => {
    document.body.innerHTML = `<div id="root"><main><p id="probe">x</p></main></div>`;
    expect(stackOf('probe')).toEqual([]);
  });

  it('declines a second body child that holds landmark content', () => {
    document.body.innerHTML = `
      <div id="a">sidebar</div>
      <div id="b"><nav>links</nav><p id="probe">x</p></div>`;
    expect(stackOf('probe')).toEqual([]);
  });

  it('declines the app root when something precedes it in <body>', () => {
    // The regression that shipped: Radix inserts focus-guard <span>s as body
    // children, so the app root stopped being `firstElementChild` and every
    // comment on plain page content was scoped to an imaginary popup.
    document.body.innerHTML = `
      <span data-radix-focus-guard style="position:fixed"></span>
      <div id="page" style="position:relative"><h1>Title</h1><p id="probe">Some body copy</p></div>
      <div id="nodd-root" data-nodd-root></div>`;
    expect(stackOf('probe')).toEqual([]);
  });

  it('declines a <main> that is itself a body child', () => {
    // `querySelector` only sees descendants, so a landmark at this level was
    // invisible to the app-root check.
    document.body.innerHTML = `
      <script></script>
      <main style="position:relative"><p id="probe">Some body copy</p></main>`;
    expect(stackOf('probe')).toEqual([]);
  });

  it('declines an app that renders several body children', () => {
    document.body.innerHTML = `
      <header style="position:sticky">brand</header>
      <div id="content" style="position:relative"><p id="probe">Some body copy</p></div>
      <footer>fine print</footer>`;
    expect(stackOf('probe')).toEqual([]);
  });

  it("declines Nodd's own portals", () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="nodd-root" data-nodd-root><p id="probe">x</p></div>`;
    expect(stackOf('probe')).toEqual([]);
  });
});

describe('scrim tier', () => {
  it('claims a positioned panel behind a full-viewport backdrop', () => {
    document.body.innerHTML = `
      <div id="root">
        <div style="${FIXED_FULL}"></div>
        <div aria-label="Steps menu" style="position:absolute"><p id="probe">x</p></div>
      </div>`;
    expect(stackOf('probe')).toEqual(['float:steps-menu']);
  });

  it('accepts a <button> scrim (the close-on-click-outside idiom)', () => {
    document.body.innerHTML = `
      <div id="root">
        <button aria-label="Close" style="${FIXED_FULL}"></button>
        <div aria-label="Drawer" style="position:fixed"><p id="probe">x</p></div>
      </div>`;
    expect(stackOf('probe')).toEqual(['float:drawer']);
  });

  it('declines a panel with no backdrop', () => {
    document.body.innerHTML = `
      <div id="root"><div aria-label="Card" style="position:absolute"><p id="probe">x</p></div></div>`;
    expect(stackOf('probe')).toEqual([]);
  });

  it('declines a sticky header — it is neither portalled nor scrimmed', () => {
    document.body.innerHTML = `
      <div id="root">
        <header style="position:fixed;top:0;left:0;right:0"><p id="probe">Logo</p></header>
        <main>page</main>
      </div>`;
    expect(stackOf('probe')).toEqual([]);
  });

  it('declines a full-viewport element that holds content (not a backdrop)', () => {
    document.body.innerHTML = `
      <div id="root">
        <div style="${FIXED_FULL}">a background with words in it</div>
        <div aria-label="Panel" style="position:absolute"><p id="probe">x</p></div>
      </div>`;
    expect(stackOf('probe')).toEqual([]);
  });
});

describe('precedence — the fallback never competes with a real signal', () => {
  it('yields to an ARIA role', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal">
        <div role="dialog" data-state="open" aria-label="Settings"><p id="probe">x</p></div>
      </div>`;
    expect(stackOf('probe')).toEqual(['auto:dialog:settings']);
  });

  it('yields to an explicit <NoddState>', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal"><div data-nodd-state="wizard"><p id="probe">x</p></div></div>`;
    expect(stackOf('probe')).toEqual(['wizard']);
  });

  it('cannot change how an existing unscoped thread matches', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal"><div aria-label="Filters" style="position:fixed"><p id="probe">x</p></div></div>`;
    // A thread written before this signal existed carries an empty key, and an
    // empty key matches every state — including the new one.
    expect(isStateMatch('', stackOf('probe'))).toBe(true);
  });
});

describe('naming', () => {
  it('prefers an accessible name over content', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal"><div aria-label="Filters" style="position:fixed"><button>Clear all</button><p id="probe">x</p></div></div>`;
    expect(stackOf('probe')).toEqual(['float:filters']);
  });

  it('names a portal layer after the panel inside it, not the portal root', () => {
    // Every overlay in a Headless UI app shares this container; naming them all
    // "headlessui-portal-root" would make them indistinguishable.
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="headlessui-portal-root">
        <div aria-label="Filters" style="position:fixed"><p id="probe">x</p></div>
      </div>`;
    expect(stackOf('probe')).toEqual(['float:filters']);
  });

  it('falls back through data-testid before content', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal" data-testid="filter-popover" style="position:fixed"><button>Clear all</button><p id="probe">x</p></div>`;
    expect(stackOf('probe')).toEqual(['float:filter-popover']);
  });

  it('ignores generated ids like React useId output', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id=":r7:" style="position:fixed"><button>Clear all</button><p id="probe">x</p></div>`;
    expect(stackOf('probe')).toEqual(['float:clear-all']);
  });
});

describe('scoping behaviour', () => {
  it('hides the comment once the overlay is gone', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal"><div aria-label="Filters" style="position:fixed"><p id="probe">x</p></div></div>`;
    const key = stackOf('probe')[0];
    expect(isStateMatch(key, [key])).toBe(true);
    document.getElementById('portal')!.remove();
    expect(isStateMatch(key, [])).toBe(false);
    expect(findFloatingStateElement(key)).toBeNull();
  });

  it('finds the container again while it is open', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal"><div aria-label="Filters" style="position:fixed"><p id="probe">x</p></div></div>`;
    expect(findFloatingStateElement('float:filters')?.id).toBe('portal');
  });

  it('detectFloatingSegment is a pure query — no host DOM is mutated', () => {
    document.body.innerHTML = `
      <div id="root"><main>page</main></div>
      <div id="portal"><p id="probe">x</p></div>`;
    const before = document.body.innerHTML;
    detectFloatingSegment(document.getElementById('portal')!);
    expect(document.body.innerHTML).toBe(before);
  });
});
