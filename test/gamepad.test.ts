/**
 * Gamepad poller (platform layer) — validates the neutral Standard-Gamepad snapshot:
 * 4-way stick reduction with a hysteretic deadzone, d-pad folded into the left stick,
 * button rising-edge detection, trigger-as-axis, and clean reset on disconnect. Pure
 * logic; `navigator.getGamepads` is mocked. No engine/game refs (platform layer).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pollPad, type PadButton } from '../src/platform/gamepad.js';

type BtnLike = { pressed: boolean; value: number };

function pad(opts: { axes?: number[]; buttons?: number[]; mapping?: string; connected?: boolean }): Gamepad {
  const buttons: BtnLike[] = Array.from({ length: 17 }, (_, i) => {
    const v = opts.buttons?.[i] ?? 0;
    return { pressed: v >= 0.5, value: v };
  });
  return {
    axes: opts.axes ?? [0, 0, 0, 0],
    buttons: buttons as unknown as readonly GamepadButton[],
    connected: opts.connected ?? true,
    mapping: (opts.mapping ?? 'standard') as GamepadMappingType,
    id: 'mock',
    index: 0,
    timestamp: 0,
    vibrationActuator: null as unknown as GamepadHapticActuator,
  } as Gamepad;
}

function setPads(pads: (Gamepad | null)[]): void {
  vi.stubGlobal('navigator', { getGamepads: () => pads });
}

// Standard button indices used by the tests.
const IDX: Record<PadButton, number> = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9,
  dup: 12, ddown: 13, dleft: 14, dright: 15,
};
function buttons(...on: PadButton[]): number[] {
  const arr = new Array(17).fill(0);
  for (const b of on) arr[IDX[b]] = 1;
  return arr;
}

describe('gamepad poller', () => {
  beforeEach(() => {
    setPads([null]); // clear the module's prev-button / hysteresis state between tests
    pollPad();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports disconnected when no pad is present', () => {
    setPads([null]);
    const s = pollPad();
    expect(s.connected).toBe(false);
    expect(s.leftDir).toBeNull();
    expect(s.anyPressed).toBe(false);
  });

  it('reduces a left-stick push to a 4-way direction (up is -Y)', () => {
    setPads([pad({ axes: [0, -0.9, 0, 0] })]);
    expect(pollPad().leftDir).toBe('up');
    setPads([pad({ axes: [0.9, 0, 0, 0] })]);
    expect(pollPad().leftDir).toBe('right');
  });

  it('maps the right stick independently of the left', () => {
    setPads([pad({ axes: [0, 0, 0, 0.9] })]);
    const s = pollPad();
    expect(s.leftDir).toBeNull();
    expect(s.rightDir).toBe('down');
  });

  it('applies a deadzone: a small tilt registers nothing', () => {
    setPads([pad({ axes: [0.2, 0, 0, 0] })]);
    expect(pollPad().leftDir).toBeNull();
  });

  it('has hysteresis: a held direction persists between ENGAGE and RELEASE', () => {
    setPads([pad({ axes: [0.9, 0, 0, 0] })]);
    expect(pollPad().leftDir).toBe('right'); // engage
    setPads([pad({ axes: [0.4, 0, 0, 0] })]);
    expect(pollPad().leftDir).toBe('right'); // 0.4 > RELEASE(0.35): still held
    setPads([pad({ axes: [0.3, 0, 0, 0] })]);
    expect(pollPad().leftDir).toBeNull(); // below RELEASE: let go
  });

  it('folds the d-pad into the left stick when the stick is centred', () => {
    setPads([pad({ buttons: buttons('dleft') })]);
    expect(pollPad().leftDir).toBe('left');
  });

  it('detects button rising edges once per press', () => {
    setPads([pad({ buttons: buttons('a') })]);
    let s = pollPad();
    expect(s.pressed('a')).toBe(true); // rising edge
    expect(s.anyPressed).toBe(true);
    setPads([pad({ buttons: buttons('a') })]);
    s = pollPad();
    expect(s.pressed('a')).toBe(false); // still held, not a new edge
    expect(s.down('a')).toBe(true);
  });

  it('treats a trigger past halfway as pressed (analogue-as-button)', () => {
    const arr = new Array(17).fill(0);
    arr[IDX.rt] = 0.8;
    setPads([pad({ buttons: arr })]);
    expect(pollPad().down('rt')).toBe(true);
  });

  it('resets edge state on disconnect so a reconnect starts clean', () => {
    setPads([pad({ buttons: buttons('a') })]);
    expect(pollPad().pressed('a')).toBe(true);
    setPads([null]);
    pollPad(); // disconnected: internal prev-state cleared
    setPads([pad({ buttons: buttons('a') })]);
    expect(pollPad().pressed('a')).toBe(true); // fresh edge, not swallowed
  });
});
