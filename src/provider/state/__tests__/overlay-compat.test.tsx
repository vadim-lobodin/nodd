// Overlay library compatibility matrix.
//
// Answers two questions per primitive, by rendering the real library:
//   1. **Scoped?** — does `detectAutoSegment` synthesize a state segment for it?
//      A "no" is the serious failure: the comment bleeds onto the base screen
//      and nothing downstream can even warn about it.
//   2. **Reopenable?** — can `findOpeningTrigger` record the control that opened
//      it, so the comment is clickable from the sidebar later?
//
// Only libraries installed here are covered, because only those can be observed.
// See README §4b for the (short) procedure to add another one, and for the list
// of libraries whose behaviour is still unverified.

import { describe, it, expect, afterAll } from 'vitest';
import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import {
  Dialog as HuiDialog, DialogPanel, DialogTitle,
  Menu as HuiMenu, MenuButton, MenuItems, MenuItem,
  Listbox as HuiListbox, ListboxButton, ListboxOptions, ListboxOption,
  Popover as HuiPopover, PopoverButton, PopoverPanel,
} from '@headlessui/react';
import { render, click } from './harness';
import { getStateStackForElement } from '../NoddState';
import { findOpeningTrigger } from '../reopen';

type Row = { library: string; primitive: string; scoped: string; reopenable: string };
const matrix: Row[] = [];

/**
 * Compute what Nodd sees for the element marked `#probe` — the element a pin
 * would anchor to — and record it in the matrix.
 */
function probe(library: string, primitive: string): { segment: string | null; trigger: HTMLElement | null } {
  const el = document.getElementById('probe');
  if (!el) throw new Error('fixture has no #probe element');
  const stack = getStateStackForElement(el);
  const segment = stack.length ? stack[stack.length - 1] : null;
  const trigger = segment ? findOpeningTrigger(segment) : null;
  matrix.push({
    library,
    primitive,
    scoped: segment ? `yes — ${segment}` : 'NO — comment bleeds to base screen',
    reopenable: !segment ? '—' : trigger ? `yes — <${trigger.tagName.toLowerCase()}> ${trigger.textContent?.trim().slice(0, 20)}` : 'no',
  });
  return { segment, trigger };
}

describe('Radix UI (also covers shadcn/ui, which wraps it)', () => {
  it('Dialog — scoped by title, reopenable via aria-controls', () => {
    render(
      <RadixDialog.Root defaultOpen>
        <RadixDialog.Trigger>Open settings</RadixDialog.Trigger>
        <RadixDialog.Portal>
          <RadixDialog.Content>
            <RadixDialog.Title>Settings</RadixDialog.Title>
            <p id="probe">Display name</p>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>,
    );
    const { segment, trigger } = probe('Radix', 'Dialog');
    expect(segment).toBe('auto:dialog:settings');
    expect(trigger?.textContent).toBe('Open settings');
  });

  it('DropdownMenu — named after its trigger via aria-labelledby', () => {
    render(
      <RadixMenu.Root defaultOpen>
        <RadixMenu.Trigger>Row actions</RadixMenu.Trigger>
        <RadixMenu.Portal>
          <RadixMenu.Content>
            <RadixMenu.Item id="probe">Delete</RadixMenu.Item>
          </RadixMenu.Content>
        </RadixMenu.Portal>
      </RadixMenu.Root>,
    );
    const { segment, trigger } = probe('Radix', 'DropdownMenu');
    // Radix points the content's aria-labelledby at the trigger, so the segment
    // name comes from the trigger's text — stable across reloads.
    expect(segment).toBe('auto:menu:row-actions');
    expect(trigger?.textContent).toBe('Row actions');
  });

  it('two identical menus — each records its own trigger', () => {
    function TwoRows() {
      return (
        <>
          {['Alpha', 'Beta'].map(name => (
            <RadixMenu.Root key={name} defaultOpen={name === 'Beta'}>
              <RadixMenu.Trigger>{name}</RadixMenu.Trigger>
              <RadixMenu.Portal>
                <RadixMenu.Content>
                  <RadixMenu.Item id={name === 'Beta' ? 'probe' : undefined}>Delete</RadixMenu.Item>
                </RadixMenu.Content>
              </RadixMenu.Portal>
            </RadixMenu.Root>
          ))}
        </>
      );
    }
    render(<TwoRows />);
    const { trigger } = probe('Radix', 'DropdownMenu ×2 (ambiguous)');
    // The pre-existing document-wide hunt cannot answer this; aria-controls can.
    expect(trigger?.textContent).toBe('Beta');
  });
});

describe('Headless UI', () => {
  it('Dialog — scoped by title; controlled, so no trigger exists to record', () => {
    render(
      <HuiDialog open onClose={() => {}}>
        <DialogPanel>
          <DialogTitle>Settings</DialogTitle>
          <p id="probe">body</p>
        </DialogPanel>
      </HuiDialog>,
    );
    const { segment, trigger } = probe('Headless UI', 'Dialog (controlled)');
    expect(segment).toBe('auto:dialog:settings');
    // Nothing opened it that we can click — this is the case #2's capture-time
    // warning exists for.
    expect(trigger).toBeNull();
  });

  it('Menu — scoped and reopenable', () => {
    render(
      <HuiMenu>
        <MenuButton>Row actions</MenuButton>
        <MenuItems static>
          {/* the probe is nested: Headless UI overwrites `id` on the item itself */}
          <MenuItem><a href="#"><span id="probe">Delete</span></a></MenuItem>
        </MenuItems>
      </HuiMenu>,
    );
    click(document.querySelector('button'));
    const { segment, trigger } = probe('Headless UI', 'Menu');
    expect(segment).toBe('auto:menu:row-actions');
    expect(trigger?.textContent).toBe('Row actions');
  });

  it('Listbox — scoped and reopenable', () => {
    render(
      <HuiListbox value="eu" onChange={() => {}}>
        <ListboxButton>Region</ListboxButton>
        <ListboxOptions static>
          <ListboxOption value="eu">{() => <span id="probe">Europe</span>}</ListboxOption>
        </ListboxOptions>
      </HuiListbox>,
    );
    click(document.querySelector('button'));
    const { segment, trigger } = probe('Headless UI', 'Listbox');
    expect(segment).toBe('auto:listbox:region');
    expect(trigger?.textContent).toBe('Region');
  });

  it('Popover — NOT scoped (panel carries no role)', () => {
    render(
      <HuiPopover>
        <PopoverButton>More</PopoverButton>
        <PopoverPanel static>
          <p id="probe">panel body</p>
        </PopoverPanel>
      </HuiPopover>,
    );
    click(document.querySelector('button'));
    const { segment } = probe('Headless UI', 'Popover');
    // The systematic hole: no role means no segment, so a comment here bleeds
    // onto the base screen and #2 cannot warn about it.
    expect(segment).toBeNull();
  });
});

describe('hand-rolled overlays (no ARIA at all)', () => {
  it('div menu with a scrim — scoped structurally, but not reopenable', () => {
    document.body.innerHTML = `
      <button>Steps</button>
      <div style="position:fixed;top:0;right:0;bottom:0;left:0;z-index:40"></div>
      <div aria-label="Steps menu" style="position:absolute;z-index:50">
        <a id="probe" href="#">Slide 3</a>
      </div>`;
    const { segment, trigger } = probe('hand-rolled', 'div menu + scrim');
    // The structural fallback catches it, so the comment at least hides with
    // the menu instead of bleeding onto the base screen…
    expect(segment).toBe('float:steps-menu');
    // …but with no ARIA there is nothing to click, so it can't be reopened.
    expect(trigger).toBeNull();
  });

  it('bare div with no scrim and no ARIA — still invisible to Nodd', () => {
    document.body.innerHTML = `
      <div id="root"><div style="position:absolute"><a id="probe" href="#">Slide 3</a></div></div>`;
    const { segment } = probe('hand-rolled', 'positioned div, no scrim');
    expect(segment).toBeNull();
  });

  it('same menu with two data attributes — fully scoped and reopenable', () => {
    document.body.innerHTML = `
      <button data-nodd-open-state="steps-menu">Steps</button>
      <div style="position:fixed;inset:0;z-index:40"></div>
      <div data-nodd-state="steps-menu" style="position:absolute;z-index:50">
        <a id="probe" href="#">Slide 3</a>
      </div>`;
    const el = document.getElementById('probe')!;
    expect(getStateStackForElement(el)).toEqual(['steps-menu']);
    matrix.push({
      library: 'hand-rolled',
      primitive: 'div menu + data-nodd-state',
      scoped: 'yes — steps-menu',
      reopenable: 'yes — [data-nodd-open-state]',
    });
    // Explicit segments are host-instrumented, so no trigger is recorded for
    // them; `activateState` uses the declared one.
    expect(findOpeningTrigger('steps-menu')).toBeNull();
  });
});

afterAll(() => {
  const w = [12, 30, 42];
  const line = (r: Row | null) =>
    r === null
      ? `+${'-'.repeat(w[0] + 2)}+${'-'.repeat(w[1] + 2)}+${'-'.repeat(w[2] + 2)}+----------------------+`
      : `| ${r.library.padEnd(w[0])} | ${r.primitive.padEnd(w[1])} | ${r.scoped.padEnd(w[2])} | ${r.reopenable.padEnd(20)} |`;
  console.log(
    [
      '',
      'Overlay compatibility — observed by rendering each library',
      line(null),
      line({ library: 'Library', primitive: 'Primitive', scoped: 'Scoped to its state?', reopenable: 'Reopenable?' }),
      line(null),
      ...matrix.map(r => line(r)),
      line(null),
      '',
    ].join('\n'),
  );
});
