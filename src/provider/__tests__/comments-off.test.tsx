// Comments off, variants on — the mode a prototype runs in with no backend in
// reach. What matters here is that the *variants* half is untouched: it's the
// reason the provider stays mounted at all instead of being switched off by the
// host, which is what used to happen and silently took `<Variant>` with it.

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, click } from '../state/__tests__/harness';
import { NoddProvider } from '../NoddProvider';
import { Variant } from '../variants';

const toolbarButtons = () =>
  Array.from(document.querySelectorAll('[data-nodd-root] .nodd-toolbar button'));
const byLabel = (label: string) =>
  document.querySelector<HTMLElement>(`[data-nodd-root] [aria-label="${label}"]`);

let fetchSpy: ReturnType<typeof vi.fn>;
let realFetch: typeof fetch;
let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // jsdom ships no matchMedia, which the provider's theme resolution reads.
  (window as any).matchMedia ??= () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  realFetch = globalThis.fetch;
  fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  window.localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  info.mockRestore();
  // No body wipe here: the provider's portals are still mounted, and clearing
  // them out from under React breaks the *next* test's unmount (see harness).
});

describe('NoddProvider with no credentials', () => {
  it('renders its children and sends no requests', () => {
    render(
      <NoddProvider projectId="p1">
        <p>host content</p>
      </NoddProvider>,
    );

    expect(document.body.textContent).toContain('host content');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(String(info.mock.calls[0]?.[0] ?? '')).toContain('comments are off');
  });

  it('keeps variants switchable — the switcher is the only toolbar entry', () => {
    render(
      <NoddProvider projectId="p1">
        <Variant name="plan" options={{ 'Plans first': <span>A screen</span>, Seats: <span>B screen</span> }} />
      </NoddProvider>,
    );

    // Variants render exactly as they do with a backend: first option active.
    expect(document.body.textContent).toContain('A screen');

    // The comment chrome is absent rather than dead: no Open comments button,
    // and the variants button is the toolbar's only control besides More.
    expect(byLabel('Open comments')).toBeNull();
    expect(byLabel('Variants')).not.toBeNull();
    expect(toolbarButtons()).toHaveLength(2);

    // And the panel still switches the live option.
    click(byLabel('Variants'));
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[data-nodd-root] button, [data-nodd-root] [role="radio"]'),
    ).find(el => el.textContent?.trim() === 'Seats');
    expect(option).toBeDefined();
    click(option!);
    expect(document.body.textContent).toContain('B screen');
  });

  it('ignores a half-configured backend instead of guessing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <NoddProvider projectId="p1" supabaseUrl="http://127.0.0.1:54321">
        <p>host content</p>
      </NoddProvider>,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(byLabel('Open comments')).toBeNull();
    expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('half-configured');
    warn.mockRestore();
  });
});

describe('NoddProvider when a configured backend turns out to be down', () => {
  // The regression this pins down: the flip to comments-off used to dispose and
  // recreate the variant registry, leaving the overlay and the host's
  // `<Variant>`s holding a registry that had been thrown away. A page with
  // variants on it then reported "no variants on this page" — the switcher gone
  // for exactly the local-development case the mode exists to serve.
  it('keeps the variant registry, and the switcher, across the flip', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    render(
      <NoddProvider
        projectId="p1"
        supabaseUrl="http://127.0.0.1:54399"
        supabaseAnonKey="anon-key"
      >
        <Variant name="surface" options={{ Modal: <span>modal picker</span>, Page: <span>full page</span> }} />
      </NoddProvider>,
    );

    // The store's first query fails, which marks the backend offline; let the
    // resulting state updates settle.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(String(warn.mock.calls.map(c => c[0]).join(' '))).toContain('unreachable');
    // Comments are off…
    expect(byLabel('Open comments')).toBeNull();
    // …and the variants button is live, not the "No variants on this page" stub.
    const variants = byLabel('Variants');
    expect(variants).not.toBeNull();
    expect((variants as HTMLButtonElement).disabled).toBe(false);
    // The state segment is still what comments anchor to.
    expect(document.querySelector('[data-nodd-state="surface:Modal"]')).not.toBeNull();
    warn.mockRestore();
  });
});
