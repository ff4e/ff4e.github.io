/**
 * Gamepad input (platform layer).
 *
 * Polls the W3C Standard Gamepad each frame (gamepad state is polled, not evented)
 * and exposes a small semantic snapshot: 4-way stick directions (with a deadzone +
 * hysteresis so a resting/near-neutral stick doesn't twitch) and per-button rising
 * edges / held state. Xbox is the first console target; this lives in the platform
 * layer and is NEVER referenced by engine or game logic — the web build simply keeps
 * using keyboard/mouse and never calls it. The host (app/main.ts) maps this neutral
 * snapshot onto the game's existing commands.
 */

/** A 4-way direction, or null when the stick/d-pad is centred. Platform-neutral. */
export type PadDir = 'up' | 'down' | 'left' | 'right' | null;

/** Semantic Xbox buttons (a subset of the Standard Gamepad we actually use). */
export type PadButton =
  | 'a'
  | 'b'
  | 'x'
  | 'y'
  | 'lb'
  | 'rb'
  | 'lt'
  | 'rt'
  | 'view'
  | 'menu'
  | 'dup'
  | 'ddown'
  | 'dleft'
  | 'dright';

export interface PadSnapshot {
  /** Whether a gamepad is connected this poll. */
  connected: boolean;
  /** Left stick, deadzoned to a 4-way direction (the d-pad is folded in). */
  leftDir: PadDir;
  /** Right stick, deadzoned to a 4-way direction. */
  rightDir: PadDir;
  /** True on the poll where `b` transitions from up to down (a rising edge). */
  pressed(b: PadButton): boolean;
  /** True while `b` is held down. */
  down(b: PadButton): boolean;
  /** True if ANY button had a rising edge this poll (audio-unlock / skip gate). */
  anyPressed: boolean;
}

/** Standard Gamepad button indices (https://w3c.github.io/gamepad/#remapping). */
const BUTTON_INDEX: Record<PadButton, number> = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  view: 8,
  menu: 9,
  dup: 12,
  ddown: 13,
  dleft: 14,
  dright: 15,
};

// Deadzone with hysteresis: a centred stick must pass ENGAGE to register a
// direction, but only falls back below RELEASE — so a stick hovering near the
// threshold can't rapidly flip null/dir every frame.
const ENGAGE = 0.5;
const RELEASE = 0.35;
// A trigger (lt/rt) is an analogue axis reported as a button with `.value`; treat
// it as pressed past the halfway point.
const BUTTON_ON = 0.5;

const DISCONNECTED: PadSnapshot = {
  connected: false,
  leftDir: null,
  rightDir: null,
  pressed: () => false,
  down: () => false,
  anyPressed: false,
};

let prevButtons: boolean[] = [];
let leftPrev: PadDir = null;
let rightPrev: PadDir = null;

/** The first connected gamepad, preferring one with the Standard Gamepad mapping. */
function readGamepad(): Gamepad | null {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  let fallback: Gamepad | null = null;
  for (const p of pads) {
    if (!p || !p.connected) continue;
    if (p.mapping === 'standard') return p;
    fallback ??= p;
  }
  return fallback;
}

/** Reduce a stick's (x,y) to a 4-way direction, with a hysteretic deadzone. */
function stickDir(x: number, y: number, prev: PadDir): PadDir {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const mag = Math.max(ax, ay);
  const thresh = prev ? RELEASE : ENGAGE; // easier to keep a direction than to start one
  if (mag < thresh) return null;
  if (ax >= ay) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down'; // Standard Gamepad: up is negative Y
}

/**
 * Poll the active gamepad and return a fresh snapshot. Call once per frame. When no
 * pad is connected the internal edge/hysteresis state is reset so a later reconnect
 * starts clean, and a DISCONNECTED snapshot is returned.
 */
export function pollPad(): PadSnapshot {
  const gp = readGamepad();
  if (!gp) {
    prevButtons = [];
    leftPrev = null;
    rightPrev = null;
    return DISCONNECTED;
  }

  const cur = gp.buttons.map((b) => b.pressed || b.value > BUTTON_ON);
  const prev = prevButtons;

  // Left stick, with the d-pad folded in as a digital fallback (plan: d-pad mirrors
  // the left stick in-room).
  let leftDir = stickDir(gp.axes[0] ?? 0, gp.axes[1] ?? 0, leftPrev);
  if (!leftDir) {
    if (cur[BUTTON_INDEX.dup]) leftDir = 'up';
    else if (cur[BUTTON_INDEX.ddown]) leftDir = 'down';
    else if (cur[BUTTON_INDEX.dleft]) leftDir = 'left';
    else if (cur[BUTTON_INDEX.dright]) leftDir = 'right';
  }
  const rightDir = stickDir(gp.axes[2] ?? 0, gp.axes[3] ?? 0, rightPrev);
  leftPrev = leftDir;
  rightPrev = rightDir;

  const down = (b: PadButton): boolean => cur[BUTTON_INDEX[b]] ?? false;
  const pressed = (b: PadButton): boolean => {
    const i = BUTTON_INDEX[b];
    return (cur[i] ?? false) && !(prev[i] ?? false);
  };
  const anyPressed = cur.some((v, i) => v && !(prev[i] ?? false));

  prevButtons = cur;
  return { connected: true, leftDir, rightDir, pressed, down, anyPressed };
}
