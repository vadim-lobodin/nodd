// End-to-end capture: press C, click something, get a composer.
//
// Nothing covered this path before, which is how three separate ways of
// silently getting no composer survived.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import ReactDOM from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { OverlayRenderer } from '../OverlayRenderer';
import { DOMAnchor } from '../anchoring/DOMAnchor';
import { NoddContext, type NoddContextValue } from '../../provider/NoddContext';
import { createVariantRegistry } from '../../provider/variants';
import { createPrototypeRegistry } from '../../provider/scope';
import type { AuthClient, CurrentUser } from '../../auth';
import type { CommentStore } from '../../store';
import type { PageSnapshot, Thread, MemberCache, MemberProfile } from '../../store/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver ??= class {
  observe() {} unobserve() {} disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
// jsdom has no layout, so it ships no hit-testing at all. Each test stubs the
// return value; this just gives the method something to exist as.
(document as unknown as { elementFromPoint: unknown }).elementFromPoint ??= () => null;

const user: CurrentUser = { id: 'me', email: 'you@example.com', displayName: 'You', avatarUrl: null };

function memoryStore(): { store: CommentStore; added: Array<Record<string, unknown>> } {
  const added: Array<Record<string, unknown>> = [];
  const threads: Thread[] = [];
  const members: MemberProfile[] = [{ userId: 'me', role: 'admin', displayName: 'You', avatarUrl: null }];
  const cache: MemberCache = { byId: new Map(members.map(m => [m.userId, m])), list: members, fetchedAt: 0 };
  const snap = (urlPath: string): PageSnapshot => ({ urlPath, threads, loading: false, error: null });
  const store = {
    subscribe(urlPath: string, listener: (s: PageSnapshot) => void) {
      listener(snap(urlPath));
      return () => {};
    },
    async addThread(input: Record<string, unknown>) {
      added.push(input);
      return 't1';
    },
    async replyToThread() { return 'c1'; },
    async resolveThread() {},
    async reopenThread() {},
    async deleteThread() {},
    async deleteComment() {},
    getMembers() { return cache; },
    async fetchResolved() { return []; },
    async fetchPrototypeThreads() { return []; },
    dispose() {},
  } as unknown as CommentStore;
  return { store, added };
}

let root: Root | null = null;
let added: Array<Record<string, unknown>>;

function mount(page: string | React.ReactNode) {
  document.body.innerHTML = typeof page === 'string' ? page : '';

  const pins = document.createElement('div');
  pins.id = 'nodd-pins';
  pins.setAttribute('data-nodd-pin-container', '');
  document.body.appendChild(pins);
  const noddRoot = document.createElement('div');
  noddRoot.id = 'nodd-root';
  noddRoot.setAttribute('data-nodd-root', '');
  document.body.appendChild(noddRoot);

  const host = document.createElement('div');
  document.body.appendChild(host);

  const mem = memoryStore();
  added = mem.added;
  const ctx = {
    projectId: 'p', user,
    signIn: async () => {}, signOut: async () => {},
    isVisible: true, toggleOverlay: () => {}, setVisible: () => {}, hideForDuration: () => {},
    theme: 'light', setTheme: () => {}, urlPath: '/',
    auth: { needsDisplayName: false, currentUser: user, setDisplayName: async () => {} } as unknown as AuthClient,
    writeStatus: 'ready', retryOnboarding: () => {},
    store: mem.store,
    variants: createVariantRegistry({ projectId: 'p' }),
    prototypes: createPrototypeRegistry(),
    activePrototype: null,
    navigate: () => {},
    pinContainer: pins,
  } as unknown as NoddContextValue;

  act(() => {
    root = createRoot(host);
    root.render(
      <NoddContext.Provider value={ctx}>
        {typeof page === 'string' ? null : page}
        <OverlayRenderer />
      </NoddContext.Provider>,
    );
  });
}

/**
 * Let deferred setup run. Radix registers its outside-pointerdown listener in a
 * `setTimeout(0)` (`react-dismissable-layer` line 165), so a synchronous test
 * races past the very behaviour it means to exercise.
 */
async function settle() {
  await act(async () => {
    await new Promise<void>(r => setTimeout(r, 0));
  });
}

/** Press "C" the way a viewer would, from wherever focus currently is. */
function pressC(target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }));
  });
}

/**
 * Click at a point, with the hit-test stubbed to land on `hit` (jsdom has no
 * layout). Dispatches the real press sequence from the capture layer, which is
 * what the viewer's pointer actually hits — the whole point being that the
 * overlay underneath must not treat it as an outside press.
 */
async function clickOn(hit: Element) {
  const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(hit as never);
  const from = captureLayer() ?? document.body;
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      from.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    }
    // CaptureLayer hides the portals for one frame before hit-testing.
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    await new Promise<void>(r => requestAnimationFrame(() => r()));
  });
  spy.mockRestore();
}

const composer = () => document.querySelector<HTMLTextAreaElement>('.nodd-popover textarea');
const captureLayer = () => document.querySelector('.nodd-capture-layer');

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('capturing on the base page', () => {
  it('opens a composer for a plain element', async () => {
    mount('<div id="page"><h1>Title</h1><p id="target">Some body copy</p></div>');
    pressC();
    expect(captureLayer()).not.toBeNull();
    await clickOn(document.getElementById('target')!);
    expect(composer()).not.toBeNull();
  });

  it('focuses the composer so the viewer can just type', async () => {
    mount('<div id="page"><p id="target">Some body copy</p></div>');
    pressC();
    await clickOn(document.getElementById('target')!);
    expect(document.activeElement).toBe(composer());
  });

  it('submits the comment that was typed', async () => {
    mount('<div id="page"><p id="target">Some body copy</p></div>');
    pressC();
    await clickOn(document.getElementById('target')!);
    const ta = composer()!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'looks off');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ body: 'looks off', urlPath: '/' });
  });
});

describe('commenting on empty page space', () => {
  it('opens a composer when the click lands on the page itself', async () => {
    // Blank area below the content hit-tests to <body>. This used to silently
    // cancel comment mode, because a body-anchored pin could never resolve.
    mount('<div id="page"><h1>Title</h1></div>');
    pressC();
    await clickOn(document.body);
    expect(captureLayer(), 'comment mode should not have cancelled').toBeNull();
    expect(composer()).not.toBeNull();
  });

  it('stores a page-anchored pin that resolves again', async () => {
    mount('<div id="page"><h1>Title</h1></div>');
    pressC();
    await clickOn(document.body);
    const ta = composer()!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'about the whole page');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const pin = added[0].pin as { selector: string };
    expect(pin.selector).toBe('body');
    // The point of the fix: it is still findable after a reload.
    expect(DOMAnchor.resolve(pin as never)?.element).toBe(document.body);
    expect(added[0]).toMatchObject({ stateKey: '' });
  });

  it('still cancels when the hit-test finds nothing at all', async () => {
    mount('<div id="page"><h1>Title</h1></div>');
    pressC();
    const spy = vi.spyOn(document, 'elementFromPoint').mockReturnValue(null as never);
    await act(async () => {
      (captureLayer() ?? document.body).dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }),
      );
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));
    });
    spy.mockRestore();
    expect(captureLayer()).toBeNull();
    expect(composer()).toBeNull();
  });
});

describe('commenting inside a modal overlay', () => {
  function DialogPage() {
    return (
      <RadixDialog.Root defaultOpen>
        <RadixDialog.Trigger>Open Settings dialog</RadixDialog.Trigger>
        <RadixDialog.Portal>
          <RadixDialog.Content>
            <RadixDialog.Title>Settings</RadixDialog.Title>
            <label id="target">Display name</label>
            <input defaultValue="Ada Lovelace" />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    );
  }

  it('does not dismiss the dialog when placing a pin inside it', async () => {
    mount(<DialogPage />);
    await settle();
    expect(document.querySelector('[role=dialog]')).not.toBeNull();

    pressC();
    await clickOn(document.getElementById('target')!);

    // The original report: the dialog closed the moment you clicked, because a
    // press on the capture layer reads as a dismissing press outside the content.
    expect(document.querySelector('[role=dialog]'), 'dialog should stay open').not.toBeNull();
    expect(composer()).not.toBeNull();
  });

  it('scopes the comment to the dialog it was left in', async () => {
    mount(<DialogPage />);
    await settle();
    pressC();
    await clickOn(document.getElementById('target')!);

    const ta = composer()!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, 'wrong label');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(added[0]).toMatchObject({ stateKey: 'auto:dialog:settings' });
  });
});

describe('commenting inside a focus-trapping menu', () => {
  function MenuPage() {
    return (
      <RadixMenu.Root defaultOpen>
        <RadixMenu.Trigger>Open Actions menu</RadixMenu.Trigger>
        <RadixMenu.Portal>
          <RadixMenu.Content>
            <RadixMenu.Item>Duplicate</RadixMenu.Item>
            <RadixMenu.Item>Archive</RadixMenu.Item>
            <RadixMenu.Item id="target">Delete</RadixMenu.Item>
          </RadixMenu.Content>
        </RadixMenu.Portal>
      </RadixMenu.Root>
    );
  }

  it('keeps the menu open and the composer focused', async () => {
    mount(<MenuPage />);
    await settle();
    expect(document.querySelector('[role=menu]')).not.toBeNull();

    pressC();
    await clickOn(document.getElementById('target')!);

    const ta = composer();
    expect(ta).not.toBeNull();
    expect(document.querySelector('[role=menu]'), 'menu should stay open').not.toBeNull();

    // The reported "blink": the composer took focus and Radix's focus scope
    // immediately dragged it back into the menu. Settle a few frames and it must
    // still be ours.
    await act(async () => {
      for (let i = 0; i < 5; i++) await new Promise<void>(r => requestAnimationFrame(() => r()));
    });
    expect(document.activeElement, 'composer should keep focus').toBe(ta);
  });

  it("a host focus trap cannot pull focus out of Nodd's own UI", async () => {
    // The mechanism behind the "blink", isolated: Radix's FocusScope remembers
    // the last element focused inside the menu and drags focus back there the
    // moment it lands anywhere else. Nodd's surfaces have to be exempt, or every
    // input we render over an open menu is unusable.
    mount(<MenuPage />);
    await settle();
    act(() => (document.getElementById('target') as HTMLElement).focus());

    const field = document.createElement('textarea');
    document.getElementById('nodd-root')!.appendChild(field);
    act(() => field.focus());

    expect(document.activeElement, 'Nodd input should keep focus').toBe(field);
  });
});

describe('the focus shield does not silence React focus events', () => {
  // Blocking `focusin`/`focusout` too early would take React's delegated
  // onFocus/onBlur down with the focus trap. The shield stops them at `document`
  // in the bubble phase, by which point every element-level listener has run.
  it("fires onFocus/onBlur on Nodd's own controls", async () => {
    const seen: string[] = [];
    function NoddControl() {
      const rootEl = document.getElementById('nodd-root');
      if (!rootEl) return null;
      return ReactDOM.createPortal(
        <input
          id="nodd-input"
          onFocus={() => seen.push('focus')}
          onBlur={() => seen.push('blur')}
        />,
        rootEl,
      );
    }
    mount(<NoddControl />);
    const input = document.getElementById('nodd-input') as HTMLInputElement;
    expect(input, 'portal into #nodd-root should have rendered').not.toBeNull();

    act(() => input.focus());
    act(() => input.blur());
    expect(seen).toEqual(['focus', 'blur']);
  });

  it('fires host onBlur when focus moves from the host into Nodd', async () => {
    const seen: string[] = [];
    function HostField() {
      return <input id="host-field" onBlur={() => seen.push('host-blur')} />;
    }
    mount(<HostField />);
    const field = document.getElementById('host-field') as HTMLInputElement;
    const noddInput = document.createElement('input');
    document.getElementById('nodd-root')!.appendChild(noddInput);

    act(() => field.focus());
    act(() => noddInput.focus());
    expect(seen).toEqual(['host-blur']);
  });

  it('still keeps a Radix focus trap from reclaiming focus', async () => {
    // The shield's actual job, re-asserted alongside the two guarantees above.
    mount(
      <RadixMenu.Root defaultOpen>
        <RadixMenu.Trigger>Actions</RadixMenu.Trigger>
        <RadixMenu.Portal>
          <RadixMenu.Content><RadixMenu.Item id="target">Delete</RadixMenu.Item></RadixMenu.Content>
        </RadixMenu.Portal>
      </RadixMenu.Root>,
    );
    await settle();
    act(() => (document.getElementById('target') as HTMLElement).focus());
    const field = document.createElement('textarea');
    document.getElementById('nodd-root')!.appendChild(field);
    act(() => field.focus());
    expect(document.activeElement).toBe(field);
  });
});

describe('composer focus survives an overlay closing', () => {
  it('takes focus back when the host restores it to a trigger', async () => {
    // Radix (and every other library that restores focus on close) does this a
    // frame or two after the comment is placed, which used to leave the viewer
    // typing into nothing.
    mount('<div id="page"><button id="trigger">Actions</button><p id="target">Item</p></div>');
    pressC();
    await clickOn(document.getElementById('target')!);
    const ta = composer()!;
    expect(document.activeElement).toBe(ta);

    await act(async () => {
      (document.getElementById('trigger') as HTMLElement).focus();
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));
    });
    expect(document.activeElement).toBe(ta);
  });

  it('lets a deliberate click elsewhere keep focus', async () => {
    mount('<div id="page"><input id="other" /><p id="target">Item</p></div>');
    pressC();
    await clickOn(document.getElementById('target')!);
    // Well past the re-assert window.
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 120));
    });
    const other = document.getElementById('other') as HTMLInputElement;
    act(() => other.focus());
    expect(document.activeElement).toBe(other);
  });
});

describe('starting comment mode', () => {
  it('C is ignored while typing in a host text field — as it must be', () => {
    mount('<div id="page"><input id="field" /></div>');
    const field = document.getElementById('field') as HTMLInputElement;
    field.focus();
    pressC(field);
    expect(captureLayer()).toBeNull();
  });

  // Documents a real gap rather than asserting a fix: "C" is the only way into
  // comment mode, and it is (correctly) ignored while focus sits in a host text
  // field. Overlays routinely autofocus one — the story's dialog does — so there
  // are situations with no way to start a comment. Closing that needs a product
  // decision about a pointer affordance, so it is left open deliberately.
  it('has no pointer alternative to the C key', () => {
    mount('<div id="page"><input id="field" /></div>');
    expect(document.querySelector('.nodd-btn--capture')).toBeNull();
  });
});
