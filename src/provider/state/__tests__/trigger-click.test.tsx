// Reopening a real overlay is not the same as finding its trigger.
//
// These exist because the compatibility matrix asserted that we locate the
// right trigger, and the round-trip test clicked a hand-written listener — so
// both passed while reopening a real Radix menu did nothing at all. Radix menu,
// select and popover triggers toggle on `pointerdown` and ignore `click`.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import * as RadixDialog from '@radix-ui/react-dialog';
import { render } from './harness';
import { pressTrigger, findOpeningTrigger } from '../reopen';
import { activateState } from '../activator';

describe('pressTrigger vs. a bare click', () => {
  function menu() {
    return (
      <RadixMenu.Root>
        <RadixMenu.Trigger>Actions</RadixMenu.Trigger>
        <RadixMenu.Portal>
          <RadixMenu.Content>
            <RadixMenu.Item>Delete</RadixMenu.Item>
          </RadixMenu.Content>
        </RadixMenu.Portal>
      </RadixMenu.Root>
    );
  }

  it('a bare .click() does not open a Radix menu — the original bug', () => {
    render(menu());
    act(() => {
      document.querySelector<HTMLElement>('button')!.click();
    });
    expect(document.querySelector('[role=menu]')).toBeNull();
  });

  it('pressTrigger opens it', () => {
    render(menu());
    act(() => pressTrigger(document.querySelector<HTMLElement>('button')!));
    expect(document.querySelector('[role=menu]')).not.toBeNull();
  });

  it('pressTrigger still works for click-driven triggers (Radix Dialog)', () => {
    render(
      <RadixDialog.Root>
        <RadixDialog.Trigger>Open</RadixDialog.Trigger>
        <RadixDialog.Portal>
          <RadixDialog.Content><RadixDialog.Title>Settings</RadixDialog.Title></RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>,
    );
    act(() => pressTrigger(document.querySelector<HTMLElement>('button')!));
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
  });

  it('does not double-toggle a trigger that handles both pointerdown and click', () => {
    let opens = 0;
    render(<button onPointerDown={() => opens++} onClick={() => opens++}>t</button>);
    act(() => pressTrigger(document.querySelector<HTMLElement>('button')!));
    // Both handlers fire once — one press, not two.
    expect(opens).toBe(2);
  });
});

// `activateState` dispatches the press and then waits for the DOM to change.
// Inside `act()` React holds its update until the scope exits, so the wait would
// deadlock on a render that can't happen yet — an artefact of the harness, not
// the product: a browser flushes discrete events like `pointerdown`
// synchronously. Stepping outside act for these reproduces the real timing.
describe('activateState reopens real overlays', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('reopens a Radix DropdownMenu end to end', async () => {
    render(
      <RadixMenu.Root>
        <RadixMenu.Trigger>Row actions</RadixMenu.Trigger>
        <RadixMenu.Portal>
          <RadixMenu.Content>
            <RadixMenu.Item>Delete</RadixMenu.Item>
          </RadixMenu.Content>
        </RadixMenu.Portal>
      </RadixMenu.Root>,
    );
    expect(document.querySelector('[role=menu]')).toBeNull();

    const result = await activateState(['auto:menu:row-actions'], { timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect(document.querySelector('[role=menu]')).not.toBeNull();
  });

  it('reopens a Radix Dialog end to end', async () => {
    render(
      <RadixDialog.Root>
        <RadixDialog.Trigger>Open settings</RadixDialog.Trigger>
        <RadixDialog.Portal>
          <RadixDialog.Content>
            <RadixDialog.Title>Settings</RadixDialog.Title>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>,
    );
    const result = await activateState(['auto:dialog:settings'], { timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
  });

  // The shape design-system wrappers actually ship: the dialog is driven by an
  // `open` prop and renders no trigger of its own, so nothing in the DOM links
  // it to the button that opened it — unless that button says so. Two standard
  // ARIA attributes are the whole contract, and consumers are told to add them
  // (jcp-prototyping AGENTS.md, "Dialogs and overlays"), so it is tested here
  // rather than left to the unit-level tier-2 case with a hand-written div.
  it('records and reopens a controlled dialog whose opener is marked with ARIA', async () => {
    function ControlledDialog() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <button aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
            Invite people
          </button>
          <RadixDialog.Root open={open} onOpenChange={setOpen}>
            <RadixDialog.Portal>
              <RadixDialog.Content>
                <RadixDialog.Title>Invite people</RadixDialog.Title>
              </RadixDialog.Content>
            </RadixDialog.Portal>
          </RadixDialog.Root>
        </>
      );
    }
    render(<ControlledDialog />);

    // Capture time: the state is open, so the opener is discoverable.
    const segment = 'auto:dialog:invite-people';
    const recorded = findOpeningTrigger(segment);
    expect(recorded?.textContent).toBe('Invite people');

    // Close it the way a viewer would, then reveal the comment later.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role=dialog]')).toBeNull();

    const result = await activateState([segment], {
      timeoutMs: 1000,
      recordedTrigger: () => recorded,
    });
    expect(result.ok).toBe(true);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
  });

  it('cannot reopen the same dialog when the opener carries no ARIA', async () => {
    function BareDialog() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>Invite people</button>
          <RadixDialog.Root open={open} onOpenChange={setOpen}>
            <RadixDialog.Portal>
              <RadixDialog.Content>
                <RadixDialog.Title>Invite people</RadixDialog.Title>
              </RadixDialog.Content>
            </RadixDialog.Portal>
          </RadixDialog.Root>
        </>
      );
    }
    render(<BareDialog />);
    // Nothing to record — which is what the composer warns the author about.
    expect(findOpeningTrigger('auto:dialog:invite-people')).toBeNull();
  });
});
