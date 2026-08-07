// Host view state — the one thing Nodd asks the host for, because nothing in
// the DOM records that a `setPage` exists or that passing it 4 brings a row
// back. The contract has to be small enough to add at the state's own site, and
// forgiving enough that a stale blob from an older build degrades rather than
// breaking reveal.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import React, { useState } from 'react';
import { act } from 'react-dom/test-utils';
import { render } from '../../state/__tests__/harness';
import { useNoddViewState } from '../useNoddViewState';
import { captureViewState, applyViewState, clearViewStateRegistry, registerViewState } from '../registry';

beforeEach(() => {
  clearViewStateRegistry();
});

/** A paginated list — the case that started this. */
function List({ pageSize = 2 }: { pageSize?: number }) {
  const [page, setPage] = useState(1);
  useNoddViewState('page', page, setPage);
  const people = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fay'];
  const shown = people.slice((page - 1) * pageSize, page * pageSize);
  return (
    <div>
      <ul>{shown.map(p => <li key={p} className="row">{p}</li>)}</ul>
      <button onClick={() => setPage(p => p + 1)}>Next</button>
    </div>
  );
}

const names = () => Array.from(document.querySelectorAll('.row')).map(e => e.textContent);

describe('capture', () => {
  it('snapshots what the host registered', () => {
    render(<List />);
    expect(captureViewState()).toEqual({ page: 1 });
  });

  it('tracks the current value, not the one at registration', () => {
    render(<List />);
    act(() => { (document.querySelector('button') as HTMLElement).click(); });
    expect(captureViewState()).toEqual({ page: 2 });
  });

  it('records nothing at all when the host opted out', () => {
    render(<div />);
    // The common case — most consumers will never call the hook, and a pin must
    // stay exactly as small as it is today for them.
    expect(captureViewState()).toBeUndefined();
  });

  it('skips values JSON would not round-trip faithfully', () => {
    const box = { current: { value: new Map([['a', 1]]), restore: () => {} } };
    registerViewState('filters', box);
    registerViewState('scenario', { current: { value: 'connected', restore: () => {} } });
    // A Map serialises to `{}` — storing that would come back as a silently
    // different value, which is worse than not storing it.
    expect(captureViewState()).toEqual({ scenario: 'connected' });
  });

  it('skips values that cannot be serialised at all', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    registerViewState('a', { current: { value: circular, restore: () => {} } });
    expect(captureViewState()).toBeUndefined();
  });
});

describe('restore', () => {
  it('puts the host back on the page a comment was left on', async () => {
    render(<List />);
    act(() => { (document.querySelector('button') as HTMLElement).click(); });
    act(() => { (document.querySelector('button') as HTMLElement).click(); });
    const snapshot = captureViewState();
    expect(names()).toEqual(['Ed', 'Fay']);

    // Someone reloads the screen; it comes back on page 1.
    render(<List />);
    expect(names()).toEqual(['Ann', 'Bo']);

    await act(async () => { await applyViewState(snapshot); });

    expect(names()).toEqual(['Ed', 'Fay']);
  });

  it('leaves the host alone when the value already matches', async () => {
    const restore = vi.fn();
    registerViewState('page', { current: { value: 4, restore } });
    const result = await applyViewState({ page: 4 });
    expect(restore).not.toHaveBeenCalled();
    expect(result).toEqual({ restored: [], missing: [] });
  });

  it('does nothing when the pin recorded no view state', async () => {
    const restore = vi.fn();
    registerViewState('page', { current: { value: 1, restore } });
    expect(await applyViewState(undefined)).toEqual({ restored: [], missing: [] });
    expect(restore).not.toHaveBeenCalled();
  });

  it('reports a key the host no longer registers instead of throwing', async () => {
    // A blob written by an older build of the prototype. Reveal must degrade.
    registerViewState('page', { current: { value: 1, restore: () => {} } });
    const result = await applyViewState({ page: 1, scenario: 'connected' });
    expect(result.missing).toEqual(['scenario']);
  });

  it('contains a restore that throws to its own key', async () => {
    const good = vi.fn();
    registerViewState('bad', { current: { value: 1, restore: () => { throw new Error('nope'); } } });
    registerViewState('good', { current: { value: 1, restore: good } });

    const result = await applyViewState({ bad: 2, good: 2 });

    expect(good).toHaveBeenCalledWith(2);
    expect(result.restored).toEqual(['good']);
    expect(result.missing).toEqual(['bad']);
  });

  it('awaits an async restore', async () => {
    let done = false;
    registerViewState('page', {
      current: {
        value: 1,
        restore: async () => {
          await new Promise(r => setTimeout(r, 5));
          done = true;
        },
      },
    });
    await applyViewState({ page: 4 });
    expect(done).toBe(true);
  });
});

describe('lifecycle', () => {
  it('unregisters when the component holding the state unmounts', () => {
    render(<List />);
    expect(captureViewState()).toEqual({ page: 1 });
    render(<div />);
    expect(captureViewState()).toBeUndefined();
  });

  it('keeps two screens using the same key from colliding', () => {
    // Threads are revealed on the urlPath they were written on, so per-screen
    // keys are all that's needed — but the last mount must win cleanly.
    render(<List />);
    render(<List pageSize={3} />);
    expect(Object.keys(captureViewState() ?? {})).toEqual(['page']);
  });
});
