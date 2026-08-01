/**
 * Host gamepad bridge (platform layer) — Xbox/console only.
 *
 * WebView2's own Gamepad API does not work in a UWP app on Xbox: it is backed by
 * GameInput (part of the Gaming Services Runtime), which a sideloaded Dev Mode app
 * cannot rely on, so `navigator.getGamepads()` inside the WebView simply reports
 * nothing and the controller appears dead. See
 * https://github.com/MicrosoftEdge/WebView2Feedback/issues/4366
 *
 * The native UWP shell CAN read the pad (Windows.Gaming.Input), so it polls the
 * controller and posts a Standard-Gamepad-shaped snapshot into the page. This module
 * receives those snapshots and patches `navigator.getGamepads()` to return them —
 * exactly the same trick as the dev simulator (virtualGamepad.ts), so `pollPad()` and
 * every consumer above it work unchanged.
 *
 * Inert unless the page is running inside the WebView2 host, so the plain web build is
 * completely unaffected.
 */

/** Snapshot posted by the native host (see xbox/Ff4eXbox/MainPage.xaml.cs). */
interface HostPadMessage {
  t: 'pad';
  /** Standard Gamepad axes: [leftX, leftY, rightX, rightY], Y positive = down. */
  axes: number[];
  /** Standard Gamepad button values, 0..1, in W3C index order. */
  buttons: number[];
  /** False when no controller is attached. */
  connected: boolean;
}

let latest: HostPadMessage | null = null;
let received = 0;
let installed = false;
let origGetGamepads: (() => (Gamepad | null)[]) | null = null;

/** True when running inside the native WebView2 host (i.e. on the console). */
export function hasNativeHost(): boolean {
  try {
    const w = window as unknown as { chrome?: { webview?: unknown } };
    return !!w.chrome && !!w.chrome.webview;
  } catch {
    return false;
  }
}

function buildPad(m: HostPadMessage): Gamepad {
  const buttons = m.buttons.map((v) => ({
    pressed: v >= 0.5,
    touched: v > 0,
    value: v,
  }));
  return {
    id: 'Xbox Controller (Standard, native host bridge)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: performance.now(),
    axes: m.axes.slice(),
    buttons: buttons as unknown as readonly GamepadButton[],
    hapticActuators: [],
    vibrationActuator: undefined as unknown as GamepadHapticActuator,
  } as unknown as Gamepad;
}

/**
 * Current controller state. The host injects a receiver into every document before any
 * page script runs (window.__ffPad), which is the reliable source: it exists from
 * document creation, whereas this module's own listener is only registered once the
 * bundle has evaluated, so anything posted before that is lost. The local listener is
 * kept as a fallback.
 */
function current(): HostPadMessage | null {
  const injected = (window as unknown as { __ffPad?: HostPadMessage }).__ffPad;
  if (injected && injected.t === 'pad') return injected;
  return latest;
}

function patchedGetGamepads(): (Gamepad | null)[] {
  const real = origGetGamepads ? Array.from(origGetGamepads.call(navigator)) : [];
  const m = current();
  const mine = m && m.connected && Array.isArray(m.axes) && Array.isArray(m.buttons)
    ? [buildPad(m)]
    : [];
  return [...mine, ...real.filter((p): p is Gamepad => !!p)];
}

/**
 * Start listening for controller state from the native host. Safe to call anywhere —
 * it returns immediately (and changes nothing) in a normal browser.
 */
export function initHostGamepad(): void {
  if (installed || !hasNativeHost()) return;
  installed = true;

  const webview = (window as unknown as {
    chrome: { webview: { addEventListener: (t: string, cb: (e: { data: unknown }) => void) => void } };
  }).chrome.webview;

  webview.addEventListener('message', (e) => {
    const d = e.data as HostPadMessage | string | null;
    if (!d) return;
    // PostWebMessageAsJson delivers a parsed object; be tolerant of a raw string too.
    const msg = (typeof d === 'string' ? safeParse(d) : d) as HostPadMessage | null;
    if (!msg || msg.t !== 'pad' || !Array.isArray(msg.axes) || !Array.isArray(msg.buttons)) return;
    latest = msg;
    // Counter the native host can read back (there is no console on a console) to tell
    // "no messages arriving" apart from "arriving but not reaching the game".
    received++;
    (window as unknown as { __ffHostPad?: number }).__ffHostPad = received;
  });

  const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
  origGetGamepads = nav.getGamepads ? nav.getGamepads.bind(nav) : () => [];
  try {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: patchedGetGamepads,
    });
  } catch {
    (navigator as unknown as { getGamepads: () => (Gamepad | null)[] }).getGamepads =
      patchedGetGamepads;
  }
}

function safeParse(s: string): HostPadMessage | null {
  try {
    return JSON.parse(s) as HostPadMessage;
  } catch {
    return null;
  }
}
