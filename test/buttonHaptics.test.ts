/**
 * Which clicks tick (src/app/buttonHaptics.ts). The tick itself — native host only, the
 * selection pattern — is pinned in haptics.test.ts; this file pins what counts as a press.
 *
 * Units, not a probe: a browser cannot feel a haptic, and on the web `hapticTap` returns
 * before doing anything, so a probe could only assert on the same predicate less directly.
 * The fake `closest` below matches the module's real selector string, so a control dropped
 * from it (or a slider added to it) fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hapticTap = vi.hoisted(() => vi.fn());
vi.mock('../src/platform/haptics.js', () => ({ hapticTap }));

import { initButtonHaptics, pressesControl } from '../src/app/buttonHaptics.js';

interface FakeEl {
  tag: string;
  type?: string;
  cls?: string;
  disabled?: boolean;
  parent?: FakeEl;
  closest(sel: string): FakeEl | null;
}

/** `tag`, `tag.class` or `tag[type="x"]` — the only shapes the selector uses. */
function matches(el: FakeEl, simple: string): boolean {
  const m = /^([a-z]+)(?:\.([\w-]+))?(?:\[type="(\w+)"\])?$/.exec(simple.trim());
  if (!m) throw new Error(`fake closest cannot parse ${simple}`);
  return el.tag === m[1] && (!m[2] || el.cls === m[2]) && (!m[3] || el.type === m[3]);
}

function el(tag: string, extra: Partial<FakeEl> = {}): FakeEl {
  const self: FakeEl = {
    tag,
    ...extra,
    closest(sel) {
      for (let at: FakeEl | undefined = self; at; at = at.parent) {
        if (sel.split(',').some((s) => matches(at!, s))) return at;
      }
      return null;
    },
  };
  return self;
}

describe('what counts as pressing a control', () => {
  it('is any button, including a tap on the icon inside it', () => {
    const button = el('button');
    expect(pressesControl(button)).toBe(true);
    expect(pressesControl(el('svg', { parent: button }))).toBe(true);
  });

  it('includes the radio rows and the link-styled feedback buttons', () => {
    expect(pressesControl(el('input', { type: 'radio' }))).toBe(true);
    expect(pressesControl(el('a', { cls: 'fb-btn' }))).toBe(true);
  });

  it('excludes sliders, plain links, the room canvas and a disabled button', () => {
    expect(pressesControl(el('input', { type: 'range' }))).toBe(false);
    expect(pressesControl(el('a'))).toBe(false);
    expect(pressesControl(el('canvas'))).toBe(false);
    expect(pressesControl(el('button', { disabled: true }))).toBe(false);
  });

  it('ignores a target that is not an element', () => {
    expect(pressesControl(null)).toBe(false);
    expect(pressesControl({} as EventTarget)).toBe(false);
  });
});

describe('the listener', () => {
  const listeners: { type: string; fn: (e: { target: unknown }) => void; capture: unknown }[] = [];

  beforeEach(() => {
    listeners.length = 0;
    hapticTap.mockClear();
    vi.stubGlobal('document', {
      addEventListener: (type: string, fn: (e: { target: unknown }) => void, capture: unknown) =>
        listeners.push({ type, fn, capture }),
    });
    initButtonHaptics();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('captures clicks on the document, so a button that stops propagation still ticks', () => {
    expect(listeners).toHaveLength(1);
    expect(listeners[0]).toMatchObject({ type: 'click', capture: true });
  });

  it('ticks once per press of a control and never for anything else', () => {
    const click = listeners[0]!.fn;
    click({ target: el('button') });
    expect(hapticTap).toHaveBeenCalledTimes(1);
    click({ target: el('canvas') });
    click({ target: el('button', { disabled: true }) });
    expect(hapticTap).toHaveBeenCalledTimes(1);
  });
});
