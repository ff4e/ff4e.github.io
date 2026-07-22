/**
 * On-screen virtual gamepad (DEV-ONLY test harness — never shipped to players).
 *
 * The browser Gamepad API only reports *physical* hardware, so the controller UI
 * (world-map selection ring, Save/Load/Restart confirm prompts, the Options overlay)
 * can't be exercised on a desktop without an actual Xbox pad. This module renders a
 * clickable/draggable gamepad widget on the right of the screen and patches
 * `navigator.getGamepads()` to return a synthetic W3C *Standard Gamepad* built from the
 * widget's state. `platform/gamepad.ts` (`pollPad`) then reads it exactly as it would a
 * real pad — no game/engine code knows the difference.
 *
 * Enabled from the dev bar only (see app/main.ts). When disabled the navigator patch is
 * removed and real hardware works normally. Purely a diagnostic; the plain web build and
 * the console build never enable it.
 */

// Standard Gamepad button indices (https://w3c.github.io/gamepad/#remapping).
interface PadButtonDef {
  index: number;
  label: string;
  cls: string; // CSS class → grid placement + colour
  title: string;
}

const BUTTONS: PadButtonDef[] = [
  { index: 0, label: 'A', cls: 'vg-a', title: 'A — confirm / activate' },
  { index: 1, label: 'B', cls: 'vg-b', title: 'B — cancel / back to map' },
  { index: 2, label: 'X', cls: 'vg-x', title: 'X — restart room' },
  { index: 3, label: 'Y', cls: 'vg-y', title: 'Y — (reserved)' },
  { index: 4, label: 'LB', cls: 'vg-lb', title: 'LB — save game' },
  { index: 5, label: 'RB', cls: 'vg-rb', title: 'RB — load game' },
  { index: 6, label: 'LT', cls: 'vg-lt', title: 'LT — (reserved)' },
  { index: 7, label: 'RT', cls: 'vg-rt', title: 'RT — (reserved)' },
  { index: 8, label: 'View', cls: 'vg-view', title: 'View — back to map' },
  { index: 9, label: 'Menu', cls: 'vg-menu', title: 'Menu — Options' },
  { index: 12, label: '▲', cls: 'vg-dup', title: 'D-pad up' },
  { index: 13, label: '▼', cls: 'vg-ddown', title: 'D-pad down' },
  { index: 14, label: '◀', cls: 'vg-dleft', title: 'D-pad left' },
  { index: 15, label: '▶', cls: 'vg-dright', title: 'D-pad right' },
];

const BUTTON_COUNT = 17; // Standard Gamepad reports 17 buttons (0..16)
const AXIS_COUNT = 4; // [leftX, leftY, rightX, rightY]

interface ButtonState {
  pressed: boolean;
  value: number;
}

// Mutable virtual-pad state, read every poll by the synthetic Gamepad below.
const state = {
  axes: new Array<number>(AXIS_COUNT).fill(0),
  buttons: Array.from({ length: BUTTON_COUNT }, (): ButtonState => ({ pressed: false, value: 0 })),
};

let enabled = false;
let root: HTMLElement | null = null;
// Preserve the platform's real getGamepads so we can restore it on disable.
let origGetGamepads: (() => (Gamepad | null)[]) | null = null;

/** Build a fresh Standard-Gamepad-shaped snapshot from the current widget state. */
function buildSyntheticPad(): Gamepad {
  const buttons = state.buttons.map((b) => ({
    pressed: b.pressed,
    touched: b.pressed,
    value: b.value,
  }));
  return {
    id: 'Virtual Gamepad (Standard, dev sim)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: performance.now(),
    axes: state.axes.slice(),
    buttons: buttons as unknown as readonly GamepadButton[],
    hapticActuators: [],
    vibrationActuator: undefined as unknown as GamepadHapticActuator,
  } as unknown as Gamepad;
}

/** getGamepads override: our synthetic pad first, then any real hardware. */
function patchedGetGamepads(): (Gamepad | null)[] {
  const real = origGetGamepads ? Array.from(origGetGamepads.call(navigator)) : [];
  return [buildSyntheticPad(), ...real.filter((p): p is Gamepad => !!p)];
}

function installPatch(): void {
  if (origGetGamepads) return;
  const nav = navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
  origGetGamepads = nav.getGamepads ? nav.getGamepads.bind(nav) : () => [];
  try {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: patchedGetGamepads,
    });
  } catch {
    (navigator as unknown as { getGamepads: () => (Gamepad | null)[] }).getGamepads = patchedGetGamepads;
  }
}

function removePatch(): void {
  if (!origGetGamepads) return;
  const restore = origGetGamepads;
  origGetGamepads = null;
  try {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: restore,
    });
  } catch {
    (navigator as unknown as { getGamepads: () => (Gamepad | null)[] }).getGamepads = restore;
  }
  // Zero the state so a later re-enable starts neutral.
  state.axes.fill(0);
  for (const b of state.buttons) {
    b.pressed = false;
    b.value = 0;
  }
}

function setButton(index: number, on: boolean, el: HTMLElement): void {
  const b = state.buttons[index];
  if (!b) return;
  b.pressed = on;
  b.value = on ? 1 : 0;
  el.classList.toggle('vg-on', on);
}

/** Wire a momentary button: pressed while the pointer is held down on it. */
function wireButton(el: HTMLElement, index: number): void {
  const press = (e: PointerEvent): void => {
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    setButton(index, true, el);
  };
  const release = (): void => setButton(index, false, el);
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
}

/**
 * Wire a thumbstick pad: drag the knob to set the two axes (clamped to the pad
 * radius, normalised to -1..1, up = negative Y per Standard Gamepad); springs back
 * to centre on release.
 */
function wireStick(pad: HTMLElement, knob: HTMLElement, axisX: number, axisY: number): void {
  let dragging = false;

  const R = () => pad.clientWidth / 2 - knob.clientWidth / 2;

  const apply = (nx: number, ny: number): void => {
    const r = R();
    state.axes[axisX] = nx;
    state.axes[axisY] = ny;
    knob.style.transform = `translate(${nx * r}px, ${ny * r}px)`;
  };

  const move = (e: PointerEvent): void => {
    if (!dragging) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (e.clientX - cx) / (rect.width / 2);
    let dy = (e.clientY - cy) / (rect.height / 2);
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }
    apply(dx, dy);
  };

  const end = (): void => {
    dragging = false;
    apply(0, 0); // spring to centre
  };

  pad.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    dragging = true;
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
    move(e);
  });
  pad.addEventListener('pointermove', move);
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  pad.addEventListener('lostpointercapture', end);
}

const STYLE_ID = 'vg-style';

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
  #vg-root {
    position: fixed; top: 50%; right: 14px; transform: translateY(-50%);
    z-index: 1000; width: 300px; padding: 14px 14px 16px;
    background: rgba(18,20,30,0.92); border: 1px solid #2c2f42; border-radius: 14px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.5); color: #cdd; user-select: none;
    touch-action: none; font: 12px/1.3 system-ui, sans-serif;
  }
  #vg-root .vg-head { text-align: center; font-weight: 600; letter-spacing: .04em;
    color: #8fb7ff; margin-bottom: 10px; font-size: 11px; text-transform: uppercase; }
  #vg-root .vg-bumpers { display: flex; justify-content: space-between; margin-bottom: 8px; gap: 6px; }
  #vg-root .vg-bumpers > div { display: flex; gap: 6px; }
  #vg-root .vg-mid { display: flex; justify-content: space-between; align-items: center; }
  #vg-root .vg-cluster { display: grid; grid-template-columns: repeat(3, 30px);
    grid-template-rows: repeat(3, 30px); gap: 3px; }
  /* D-pad cluster placements */
  #vg-root .vg-dup   { grid-column: 2; grid-row: 1; }
  #vg-root .vg-dleft { grid-column: 1; grid-row: 2; }
  #vg-root .vg-dright{ grid-column: 3; grid-row: 2; }
  #vg-root .vg-ddown { grid-column: 2; grid-row: 3; }
  /* Face-button diamond placements */
  #vg-root .vg-y { grid-column: 2; grid-row: 1; }
  #vg-root .vg-x { grid-column: 1; grid-row: 2; }
  #vg-root .vg-b { grid-column: 3; grid-row: 2; }
  #vg-root .vg-a { grid-column: 2; grid-row: 3; }
  #vg-root .vg-btn {
    display: flex; align-items: center; justify-content: center;
    background: #262a3c; border: 1px solid #3a3f57; border-radius: 8px;
    color: #dde; font-weight: 600; cursor: pointer; height: 30px; min-width: 30px;
    padding: 0 6px; transition: background .05s, transform .05s;
  }
  #vg-root .vg-btn:hover { background: #2f3550; }
  #vg-root .vg-btn.vg-on { background: #4a7dff; color: #fff; transform: scale(0.92); }
  #vg-root .vg-a { border-color: #3a7d3a; } #vg-root .vg-a.vg-on { background: #57c957; }
  #vg-root .vg-b { border-color: #9a3a3a; } #vg-root .vg-b.vg-on { background: #e05555; }
  #vg-root .vg-x { border-color: #3a5a9a; } #vg-root .vg-x.vg-on { background: #5588e0; }
  #vg-root .vg-y { border-color: #9a8a3a; } #vg-root .vg-y.vg-on { background: #e0c355; color:#222; }
  #vg-root .vg-sticks { display: flex; justify-content: space-between; margin: 12px 0; }
  #vg-root .vg-stick {
    position: relative; width: 78px; height: 78px; border-radius: 50%;
    background: radial-gradient(circle at 50% 45%, #20243a, #14162400);
    border: 1px solid #363b52; cursor: grab;
  }
  #vg-root .vg-stick:active { cursor: grabbing; }
  #vg-root .vg-knob {
    position: absolute; left: 50%; top: 50%; width: 30px; height: 30px; margin: -15px 0 0 -15px;
    border-radius: 50%; background: #4a5170; border: 1px solid #6b74a0; pointer-events: none;
  }
  #vg-root .vg-stick-lbl { position:absolute; bottom:-15px; left:0; right:0; text-align:center;
    font-size:10px; color:#7a819c; }
  #vg-root .vg-menus { display: flex; justify-content: center; gap: 10px; margin-top: 6px; }
  #vg-root .vg-menus .vg-btn { height: 24px; font-size: 11px; border-radius: 12px; }
  #vg-root .vg-hint { text-align:center; font-size:10px; color:#666e88; margin-top:10px; }
  `;
  document.head.appendChild(style);
}

function makeButton(def: PadButtonDef): HTMLElement {
  const el = document.createElement('div');
  el.className = `vg-btn ${def.cls}`;
  el.textContent = def.label;
  el.title = def.title;
  wireButton(el, def.index);
  return el;
}

function byIndex(i: number): PadButtonDef {
  return BUTTONS.find((b) => b.index === i)!;
}

function buildWidget(): HTMLElement {
  injectStyle();
  const el = document.createElement('div');
  el.id = 'vg-root';

  const head = document.createElement('div');
  head.className = 'vg-head';
  head.textContent = 'Gamepad Sim';
  el.appendChild(head);

  // Bumpers + triggers row.
  const bumpers = document.createElement('div');
  bumpers.className = 'vg-bumpers';
  const left = document.createElement('div');
  left.append(makeButton(byIndex(4)), makeButton(byIndex(6))); // LB, LT
  const right = document.createElement('div');
  right.append(makeButton(byIndex(5)), makeButton(byIndex(7))); // RB, RT
  bumpers.append(left, right);
  el.appendChild(bumpers);

  // D-pad (left) + face buttons (right).
  const mid = document.createElement('div');
  mid.className = 'vg-mid';
  const dpad = document.createElement('div');
  dpad.className = 'vg-cluster';
  dpad.append(makeButton(byIndex(12)), makeButton(byIndex(14)), makeButton(byIndex(15)), makeButton(byIndex(13)));
  const face = document.createElement('div');
  face.className = 'vg-cluster';
  face.append(makeButton(byIndex(3)), makeButton(byIndex(2)), makeButton(byIndex(1)), makeButton(byIndex(0)));
  mid.append(dpad, face);
  el.appendChild(mid);

  // Thumbsticks.
  const sticks = document.createElement('div');
  sticks.className = 'vg-sticks';
  const makeStick = (label: string, ax: number, ay: number): HTMLElement => {
    const pad = document.createElement('div');
    pad.className = 'vg-stick';
    const knob = document.createElement('div');
    knob.className = 'vg-knob';
    const lbl = document.createElement('div');
    lbl.className = 'vg-stick-lbl';
    lbl.textContent = label;
    pad.append(knob, lbl);
    wireStick(pad, knob, ax, ay);
    return pad;
  };
  sticks.append(makeStick('L — little fish', 0, 1), makeStick('R — big fish', 2, 3));
  el.appendChild(sticks);

  // View / Menu.
  const menus = document.createElement('div');
  menus.className = 'vg-menus';
  menus.append(makeButton(byIndex(8)), makeButton(byIndex(9))); // View, Menu
  el.appendChild(menus);

  const hint = document.createElement('div');
  hint.className = 'vg-hint';
  hint.textContent = 'Drag sticks · click buttons';
  el.appendChild(hint);

  return el;
}

/** Show/hide the widget and install/remove the navigator patch. */
export function setVirtualGamepadEnabled(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  if (on) {
    if (!root) {
      root = buildWidget();
      document.body.appendChild(root);
    }
    root.style.display = '';
    installPatch();
  } else {
    if (root) root.style.display = 'none';
    removePatch();
  }
}

/** Whether the virtual gamepad is currently active. */
export function isVirtualGamepadEnabled(): boolean {
  return enabled;
}
