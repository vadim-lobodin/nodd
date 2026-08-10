// Opening a thread whose anchor isn't simply sitting there — the orchestration
// in `OverlayRenderer.revealThread`.
//
// The helpers underneath (`disclose`, `approximate`, `viewState`) each have unit
// coverage, and all of it passed while the sequencing between them was wrong:
// a React-controlled tab discloses by *replacing* its subtree, which destroys
// the element being tracked, and reveal read that as a failed disclosure and
// degraded a thread whose exact anchor was right there in the new DOM. Only an
// end-to-end assertion — "exact placement, no approximate notice" — catches it.
//
// Reveal is driven here through the `#nodd-thread=<id>` deep link, which is the
// same single path the sidebar, inbox and pin clicks all funnel into.

import React, { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OverlayRenderer } from '../OverlayRenderer';
import { DOMAnchor } from '../anchoring/DOMAnchor';
import { NoddContext, type NoddContextValue } from '../../provider/NoddContext';
import { createVariantRegistry } from '../../provider/variants';
import { createPrototypeRegistry } from '../../provider/scope';
import { useNoddViewState } from '../../provider/viewState';
import { clearViewStateRegistry } from '../../provider/viewState/registry';
import type { AuthClient, CurrentUser } from '../../auth';
import type { CommentStore } from '../../store';
import type { PageSnapshot, Pin, Thread, MemberCache, MemberProfile } from '../../store/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver ??= class {
  observe() {} unobserve() {} disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const author: CurrentUser = { id: 'me', email: 'you@example.com', displayName: 'You', avatarUrl: null };

// jsdom lays nothing out, so every rect is 0×0 and `isUsableContainer` would
// reject every candidate container — degradation could then only ever land on
// the body, and a test asserting exactly that would pass for the wrong reason.
beforeEach(() => {
  document.body.innerHTML = '';
  clearViewStateRegistry();
  window.history.replaceState(null, '', '/');
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40, toJSON() {} };
  } as never;
});

function thread(pin: Pin, stateKey = ''): Thread {
  return {
    id: 't1',
    projectId: 'p',
    urlPath: '/',
    prototypeId: null,
    pin,
    stateKey,
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    createdBy: 'me',
    createdAt: new Date(0).toISOString(),
    comments: [{
      id: 'c1',
      threadId: 't1',
      authorId: 'me',
      body: 'looks off',
      mentions: [],
      createdAt: new Date(0).toISOString(),
      editedAt: null,
    }],
  };
}

let root: Root | null = null;

function mount(threads: Thread[], page?: React.ReactNode, opts: { user?: CurrentUser | null } = {}) {
  const pins = document.createElement('div');
  pins.setAttribute('data-nodd-pin-container', '');
  document.body.appendChild(pins);
  const noddRoot = document.createElement('div');
  noddRoot.setAttribute('data-nodd-root', '');
  document.body.appendChild(noddRoot);
  const host = document.createElement('div');
  document.body.appendChild(host);

  const user = opts.user === undefined ? author : opts.user;
  const members: MemberProfile[] = [{ userId: 'me', role: 'admin', displayName: 'You', avatarUrl: null }];
  const cache: MemberCache = { byId: new Map(members.map(m => [m.userId, m])), list: members, fetchedAt: 0 };
  const store = {
    subscribe(urlPath: string, listener: (s: PageSnapshot) => void) {
      listener({ urlPath, threads, loading: false, error: null } as PageSnapshot);
      return () => {};
    },
    async addThread() { return 't1'; },
    async replyToThread() { return 'c1'; },
    async resolveThread() {}, async reopenThread() {},
    async deleteThread() {}, async deleteComment() {},
    getMembers() { return cache; },
    async fetchResolved() { return []; },
    async fetchPrototypeThreads() { return []; },
    dispose() {},
  } as unknown as CommentStore;

  const ctx = {
    projectId: 'p', user,
    signIn: async () => {}, signOut: async () => {},
    isVisible: true, toggleOverlay: () => {}, setVisible: () => {}, hideForDuration: () => {},
    theme: 'light', setTheme: () => {}, urlPath: '/',
    auth: { needsDisplayName: false, currentUser: user, setDisplayName: async () => {} } as unknown as AuthClient,
    writeStatus: 'ready', retryOnboarding: () => {},
    store,
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
        {page ?? null}
        <OverlayRenderer />
      </NoddContext.Provider>,
    );
  });
}

/** Let the reveal chain — awaits, settles, animation frames — run to completion. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise<void>(r => requestAnimationFrame(() => r()));
    }
    await new Promise<void>(r => setTimeout(r, 0));
  });
}

/** Arrive on the page the way a cross-screen inbox click does. */
function deepLinkTo(id: string) {
  window.history.replaceState(null, '', `/#nodd-thread=${id}`);
}

const popover = () => document.querySelector('.nodd-popover');
const notice = () => document.querySelector('.nodd-popover-notice')?.textContent ?? null;
const pin = () => document.querySelector('[data-nodd-pin-id="t1"]');
const isApproximate = () => pin()?.classList.contains('nodd-pin--approximate') ?? false;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('reveal — exact anchor', () => {
  it('opens at the anchor with no notice when nothing was in the way', async () => {
    document.body.innerHTML = '<main id="screen"><p id="target">Some body copy</p></main>';
    const t = thread(DOMAnchor.create(document.getElementById('target')!, 5, 5));

    deepLinkTo('t1');
    mount([t]);
    await settle();

    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(false);
    expect(notice()).toBeNull();
  });
});

describe('reveal — host view state', () => {
  /** A list whose current page lives in host React state, as it always does. */
  function List() {
    const [page, setPage] = useState(1);
    useNoddViewState('page', page, setPage);
    return (
      <main id="screen">
        <section id="team-list">
          <div className="row"><span className="name">Person {page}</span></div>
        </section>
      </main>
    );
  }

  it('puts the host back on the page the comment was left on, exactly', async () => {
    // Capture against page 4, standing in for the host having been there.
    document.body.innerHTML =
      '<main id="screen"><section id="team-list"><div class="row"><span class="name">Person 4</span></div></section></main>';
    const pinAt4 = DOMAnchor.create(document.querySelector('.name')!, 5, 5);
    const t = thread({ ...pinAt4, viewState: { page: 4 } });
    document.body.innerHTML = '';

    deepLinkTo('t1');
    mount([t], <List />);
    await settle();

    // The host moved itself, so the exact anchor exists again — no degrading.
    expect(document.querySelector('.name')?.textContent).toBe('Person 4');
    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(false);
    expect(notice()).toBeNull();
  });

  it('degrades when the host registered nothing, naming the kind and never the content', async () => {
    // The notice is chrome. Quoting the anchor's text put page data in it — a
    // comment on an invitee row read back as
    // "Ralph Edwardsralph.edwards@example.comOrg viewer".
    const row = (n: number) =>
      `<main id="screen"><section id="team-list"><div role="row" class="row">` +
      `<span class="name">Person ${n}</span><span>person${n}@example.com</span></div></section></main>`;
    document.body.innerHTML = row(4);
    const t = thread(DOMAnchor.create(document.querySelector('[role="row"]')!, 5, 5));
    document.body.innerHTML = row(1);

    deepLinkTo('t1');
    mount([t]);
    await settle();

    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(true);
    expect(notice()).toBe(
      'Showing this nearby \u2014 the row this was left on isn\u2019t on this screen right now.',
    );
  });

  it('says "element" for an anchor whose tag means nothing', async () => {
    document.body.innerHTML =
      '<main id="screen"><section id="team-list"><span class="name">Person 4</span></section></main>';
    const t = thread(DOMAnchor.create(document.querySelector('.name')!, 5, 5));
    document.body.innerHTML = '<main id="screen"><section id="team-list"></section></main>';

    deepLinkTo('t1');
    mount([t]);
    await settle();

    expect(notice()).toContain('the element this was left on');
    expect(notice()).not.toContain('Person 4');
  });
});

describe('reveal — disclosure', () => {
  const tabs = (open: 'general' | 'billing') => `
    <main id="screen">
      <div role="tablist">
        <button role="tab" id="tab-general" aria-controls="panel-general"
                aria-selected="${open === 'general'}">General</button>
        <button role="tab" id="tab-billing" aria-controls="panel-billing"
                aria-selected="${open === 'billing'}">Billing</button>
      </div>
      <div role="tabpanel" id="panel-general" aria-labelledby="tab-general" ${open === 'general' ? '' : 'hidden'}>
        <p class="body">General settings</p>
      </div>
      <div role="tabpanel" id="panel-billing" aria-labelledby="tab-billing" ${open === 'billing' ? '' : 'hidden'}>
        <p class="body">Billing settings</p>
      </div>
    </main>`;

  it('opens the tab and lands on the exact anchor when the node is mutated in place', async () => {
    document.body.innerHTML = tabs('billing');
    const t = thread(DOMAnchor.create(document.querySelector('#panel-billing .body')!, 5, 5));

    // Back on the General tab; a plain host toggles `hidden` on the same nodes.
    document.body.innerHTML = tabs('general');
    document.getElementById('tab-billing')!.addEventListener('click', () => {
      document.getElementById('panel-billing')!.removeAttribute('hidden');
      document.getElementById('panel-general')!.setAttribute('hidden', '');
    });

    deepLinkTo('t1');
    mount([t]);
    await settle();

    expect(document.getElementById('panel-billing')!.hasAttribute('hidden')).toBe(false);
    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(false);
    expect(notice()).toBeNull();
  });

  it('lands on the exact anchor when disclosing replaces the subtree', async () => {
    // This is what React does: unmount the closed panel, mount an open one. The
    // element we pressed for is gone, so the disclosure can't be observed on it
    // — and reading that as failure degraded a thread that was perfectly fine.
    document.body.innerHTML = tabs('billing');
    const t = thread(DOMAnchor.create(document.querySelector('#panel-billing .body')!, 5, 5));

    document.body.innerHTML = tabs('general');
    document.getElementById('tab-billing')!.addEventListener('click', () => {
      document.querySelector('#screen')!.innerHTML = tabs('billing').replace(/^\s*<main[^>]*>|<\/main>\s*$/g, '');
    });

    deepLinkTo('t1');
    mount([t]);
    await settle();

    expect(document.getElementById('panel-billing')!.hasAttribute('hidden')).toBe(false);
    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(false);
    expect(notice()).toBeNull();
  });

  it('names the section and degrades when it cannot be opened', async () => {
    document.body.innerHTML =
      '<main id="screen"><section id="archive" aria-label="Archived"><p class="body">Old note</p></section></main>';
    const t = thread(DOMAnchor.create(document.querySelector('.body')!, 5, 5));
    // No control of any kind now points at it, so there is nothing safe to press.
    document.getElementById('archive')!.setAttribute('hidden', '');

    deepLinkTo('t1');
    mount([t]);
    await settle();

    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(true);
    expect(notice()).toContain('Archived');
    expect(notice()).toContain('closed');
  });
});

describe('reveal — degraded placement', () => {
  it('upgrades to the exact anchor, silently, when it comes back', async () => {
    document.body.innerHTML =
      '<main id="screen"><section id="team-list"><div class="row"><span class="name">Person 4</span></div></section></main>';
    const t = thread(DOMAnchor.create(document.querySelector('.name')!, 5, 5));
    document.body.innerHTML = '<main id="screen"><section id="team-list"></section></main>';

    deepLinkTo('t1');
    mount([t]);
    await settle();
    expect(isApproximate()).toBe(true);

    // The viewer pages forward themselves, or a slow host restore lands. The
    // MutationObserver picks it up and the pin must stop claiming to be near.
    await act(async () => {
      document.querySelector('#team-list')!.innerHTML = '<div class="row"><span class="name">Person 4</span></div>';
      await new Promise<void>(r => setTimeout(r, 0));
    });
    await settle();

    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(false);
    expect(notice()).toBeNull();
  });

  it('keeps showing the thread when the container it degraded to is replaced', async () => {
    document.body.innerHTML =
      '<main id="screen"><section id="team-list"><div class="row"><span class="name">Person 4</span></div></section></main>';
    const t = thread(DOMAnchor.create(document.querySelector('.name')!, 5, 5));
    document.body.innerHTML = '<main id="screen"><section id="team-list"></section></main>';

    deepLinkTo('t1');
    mount([t]);
    await settle();
    expect(isApproximate()).toBe(true);

    await act(async () => {
      const list = document.querySelector('#team-list')!;
      const fresh = document.createElement('section');
      fresh.id = 'team-list';
      list.replaceWith(fresh);
      await new Promise<void>(r => setTimeout(r, 0));
    });
    await settle();

    // Still readable, still honest about being approximate.
    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(true);
  });

  it('stops claiming proximity when only the page itself survived', async () => {
    const deep = Array.from({ length: 12 }, (_, i) => `<div class="w${i}">`).join('');
    document.body.innerHTML = `${deep}<span class="name">Person 4</span>${'</div>'.repeat(12)}`;
    const t = thread(DOMAnchor.create(document.querySelector('.name')!, 5, 5));
    document.body.innerHTML = '<article>A completely different screen</article>';

    deepLinkTo('t1');
    mount([t]);
    await settle();

    // Readable — which is the whole point of degrading — but "nearby" would be
    // a lie about a pin sitting in the page's top-left corner.
    expect(popover()).not.toBeNull();
    expect(isApproximate()).toBe(true);
    expect(notice()).toContain('at the top of the page');
    expect(notice()).not.toContain('nearby');
  });

  it('drops the degraded pin when the popover is closed', async () => {
    document.body.innerHTML =
      '<main id="screen"><section id="team-list"><div class="row"><span class="name">Person 4</span></div></section></main>';
    const t = thread(DOMAnchor.create(document.querySelector('.name')!, 5, 5));
    document.body.innerHTML = '<main id="screen"><section id="team-list"></section></main>';

    deepLinkTo('t1');
    mount([t]);
    await settle();
    expect(pin()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise<void>(r => setTimeout(r, 0));
    });
    await settle();

    // An approximate pin exists only for the reveal that asked for it.
    expect(popover()).toBeNull();
    expect(pin()).toBeNull();
  });

  it('explains the approximate placement to a read-only viewer too', async () => {
    // A logged-out reader can see the conversation and the dashed pin. The pin
    // alone doesn't say the placement is a guess, and they need that as much as
    // the author does — it's information, not a permission.
    document.body.innerHTML =
      '<main id="screen"><section id="team-list"><div class="row"><span class="name">Person 4</span></div></section></main>';
    const t = thread(DOMAnchor.create(document.querySelector('.name')!, 5, 5));
    document.body.innerHTML = '<main id="screen"><section id="team-list"></section></main>';

    deepLinkTo('t1');
    mount([t], undefined, { user: null });
    await settle();

    expect(popover()).not.toBeNull();
    expect(document.querySelector('.nodd-popover-reply')).toBeNull(); // read-only
    expect(notice()).toContain('isn\u2019t on this screen right now');
    expect(notice()).not.toContain('Person 4');
    expect(document.querySelector('.nodd-popover-notice-action')).toBeNull();
  });
});
