/**
 * The Xbox shell's controller bridge (src/platform/hostGamepad.ts).
 *
 * On the console WebView2's own Gamepad API reports nothing, so the native shell reads the
 * pad and posts snapshots into the page; the bridge republishes them through
 * `navigator.getGamepads()` for `pollPad()`. What matters: it stays out of an ordinary
 * browser, a snapshot surfaces as a Standard Gamepad (press AND release), and an unplugged
 * pad leaves no phantom behind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (e: { data: unknown }) => void;
let listeners: Listener[] = [];
const win: Record<string, unknown> = {};
const nav: { getGamepads?: () => (Gamepad | null)[] } = {};

beforeEach(() => {
  vi.resetModules();
  listeners = [];
  for (const k of Object.keys(win)) delete win[k];
  nav.getGamepads = () => [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
});
afterEach(() => vi.unstubAllGlobals());

const asHost = () => {
  win.chrome = { webview: { addEventListener: (_t: string, cb: Listener) => listeners.push(cb) } };
};
const snapshot = (buttons: number[] = [], connected = true) => ({
  t: 'pad',
  connected,
  axes: [0.9, 0, 0, -0.9],
  buttons: Array.from({ length: 17 }, (_, i) => buttons[i] ?? 0),
});
const bridged = () => (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g && /native host bridge/.test(g.id));

describe('host gamepad bridge', () => {
  it('changes nothing in an ordinary browser', async () => {
    const before = nav.getGamepads;
    const { initHostGamepad } = await import('../src/platform/hostGamepad.js');
    initHostGamepad();
    expect(nav.getGamepads).toBe(before);
    expect(listeners).toHaveLength(0);
  });

  it('republishes the injected snapshot as a Standard Gamepad, press and release', async () => {
    asHost();
    const { initHostGamepad } = await import('../src/platform/hostGamepad.js');
    initHostGamepad();
    win.__ffPad = snapshot();
    let [pad] = bridged();
    expect(pad?.mapping).toBe('standard');
    expect(pad?.axes).toEqual([0.9, 0, 0, -0.9]);
    expect(pad?.buttons).toHaveLength(17);
    expect(pad?.buttons[9]?.pressed).toBe(false);
    win.__ffPad = snapshot([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]); // Menu
    [pad] = bridged();
    expect(pad?.buttons[9]?.pressed).toBe(true);
    win.__ffPad = snapshot();
    [pad] = bridged();
    expect(pad?.buttons[9]?.pressed).toBe(false);
  });

  it('falls back to its own message listener, and counts what it received', async () => {
    asHost();
    const { initHostGamepad } = await import('../src/platform/hostGamepad.js');
    initHostGamepad();
    expect(listeners).toHaveLength(1);
    listeners[0]!({ data: JSON.stringify(snapshot([1])) }); // a raw string is tolerated
    expect(bridged()[0]?.buttons[0]?.pressed).toBe(true);
    expect(win.__ffHostPad).toBe(1);
    listeners[0]!({ data: { t: 'other' } }); // not ours
    expect(win.__ffHostPad).toBe(1);
  });

  it('leaves no phantom pad once the controller is unplugged', async () => {
    asHost();
    const { initHostGamepad } = await import('../src/platform/hostGamepad.js');
    initHostGamepad();
    win.__ffPad = snapshot([], false);
    expect(bridged()).toHaveLength(0);
  });
});
