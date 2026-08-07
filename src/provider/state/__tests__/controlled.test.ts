// Content named by its own control — the disclosure half of ARIA.
//
// Two properties matter. It must catch the surfaces the role and structural
// tiers systematically miss (popover panels; accordion regions whose content is
// unmounted), and it must not disturb anything those tiers already handle,
// because a thread's stored stateKey only matches if the DOM still derives the
// same string.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectControlledSegment,
  findControlledStateElement,
  findControlledTrigger,
  isCtlSegment,
  describeCtlSegment,
} from '../controlledState';
import { getStateStackForElement } from '../NoddState';
import { activateState } from '../activator';
import { describeSegment } from '../describe';

beforeEach(() => {
  document.body.innerHTML = '';
});

function popover(open: boolean) {
  document.body.innerHTML = `
    <div id="root">
      <button id="btn" aria-expanded="${open}" aria-controls="panel">More options</button>
      ${open ? '<div id="panel"><a id="probe" href="#">Duplicate</a></div>' : ''}
    </div>`;
  const btn = document.getElementById('btn')!;
  btn.addEventListener('click', () => {
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!isOpen));
    if (isOpen) {
      document.getElementById('panel')?.remove();
    } else {
      const panel = document.createElement('div');
      panel.id = 'panel';
      panel.innerHTML = '<a id="probe" href="#">Duplicate</a>';
      document.getElementById('root')!.append(panel);
    }
  });
}

describe('detectControlledSegment', () => {
  it('keys on the control name, not the content', () => {
    popover(true);
    expect(detectControlledSegment(document.getElementById('panel')!)).toBe('ctl:more-options');
  });

  it('scopes a comment inside a roleless panel that carries no scrim either', () => {
    popover(true);
    // Neither the ARIA-role tier (no role) nor the structural tier (inline, no
    // scrim, not a body child) sees this. It used to bleed onto the base screen.
    expect(getStateStackForElement(document.getElementById('probe')!)).toEqual(['ctl:more-options']);
  });

  it('ignores a control that is not expanded', () => {
    document.body.innerHTML = `
      <button aria-expanded="false" aria-controls="p">More</button>
      <div id="p"><i id="probe"></i></div>`;
    expect(detectControlledSegment(document.getElementById('p')!)).toBeNull();
  });

  it('declines when two controls claim the same content', () => {
    document.body.innerHTML = `
      <button aria-expanded="true" aria-controls="p">A</button>
      <button aria-expanded="true" aria-controls="p">B</button>
      <div id="p"></div>`;
    expect(detectControlledSegment(document.getElementById('p')!)).toBeNull();
  });

  it('declines when the control has no name to key on', () => {
    document.body.innerHTML = `
      <button aria-expanded="true" aria-controls="p"></button><div id="p"></div>`;
    expect(detectControlledSegment(document.getElementById('p')!)).toBeNull();
  });

  it('leaves tab panels alone', () => {
    // A tab panel is a persistent region, not a transient surface; scoping
    // comments to it would hide each tab's comments behind the others.
    document.body.innerHTML = `
      <button aria-expanded="true" aria-controls="p">Billing</button>
      <div id="p" role="tabpanel"></div>`;
    expect(detectControlledSegment(document.getElementById('p')!)).toBeNull();
  });

  it('respects an explicit closed flag', () => {
    document.body.innerHTML = `
      <button aria-expanded="true" aria-controls="p">More</button>
      <div id="p" data-state="closed"></div>`;
    expect(detectControlledSegment(document.getElementById('p')!)).toBeNull();
  });
});

describe('precedence', () => {
  it('does not displace an explicit <NoddState> segment', () => {
    document.body.innerHTML = `
      <button aria-expanded="true" aria-controls="p">More</button>
      <div id="p" data-nodd-state="steps"><i id="probe"></i></div>`;
    expect(getStateStackForElement(document.getElementById('probe')!)).toEqual(['steps']);
  });

  it('does not displace an ARIA role segment', () => {
    document.body.innerHTML = `
      <button aria-expanded="true" aria-controls="p">More</button>
      <div id="p" role="dialog" aria-label="Settings"><i id="probe"></i></div>`;
    expect(getStateStackForElement(document.getElementById('probe')!)).toEqual(['auto:dialog:settings']);
  });

  it('does not displace a structural segment, so float: threads keep resolving', () => {
    document.body.innerHTML = `
      <div id="app"><main>page</main></div>
      <button aria-expanded="true" aria-controls="p">More</button>
      <div id="p" aria-label="Steps menu" style="position:absolute"><i id="probe"></i></div>`;
    expect(getStateStackForElement(document.getElementById('probe')!)).toEqual(['float:steps-menu']);
  });
});

describe('reopening', () => {
  it('finds the open panel by segment', () => {
    popover(true);
    expect(findControlledStateElement('ctl:more-options')?.id).toBe('panel');
  });

  it('finds nothing once it is closed', () => {
    popover(false);
    expect(findControlledStateElement('ctl:more-options')).toBeNull();
  });

  it('looks the closed control up by the name the segment is keyed on', () => {
    popover(false);
    expect(findControlledTrigger('ctl:more-options')?.id).toBe('btn');
  });

  it('declines when two closed controls share that name', () => {
    document.body.innerHTML = `
      <button aria-expanded="false" aria-controls="a">More</button>
      <button aria-expanded="false" aria-controls="b">More</button>`;
    expect(findControlledTrigger('ctl:more')).toBeNull();
  });

  it('reopens a closed panel end to end', async () => {
    popover(false);
    expect(document.getElementById('probe')).toBeNull();

    const result = await activateState(['ctl:more-options'], { timeoutMs: 500 });

    expect(result).toEqual({ ok: true, failedSegment: null });
    expect(document.getElementById('probe')).not.toBeNull();
  });

  it('reports the segment it could not reopen', async () => {
    document.body.innerHTML = '<div>nothing here opens anything</div>';
    const result = await activateState(['ctl:more-options'], { timeoutMs: 50 });
    expect(result).toEqual({ ok: false, failedSegment: 'ctl:more-options' });
  });
});

describe('naming', () => {
  it('is recognised and described like the other derived kinds', () => {
    expect(isCtlSegment('ctl:more-options')).toBe(true);
    expect(describeCtlSegment('ctl:more-options')).toBe('More Options');
    expect(describeSegment('ctl:more-options')).toBe('More Options');
  });
});
