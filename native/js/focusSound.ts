/**
 * The focus tick: the short, soft click an Apple TV plays as the focus moves from one thing
 * to the next — here between the map's bubbles (and its corner buttons and the record
 * panel's buttons), the top bar's tabs, the Options rows and the confirm prompt's buttons.
 *
 * It is our own sound, not tvOS's. tvOS plays its focus sound only through the UIKit focus
 * engine, as part of a focus update between UIKit views (`UIFocusSoundIdentifierDefault`,
 * returned from `soundIdentifierForFocusUpdateInContext:`; UIFocus.h): there is no public
 * call that plays it on demand and no system sound id for it, and the game's menus are not
 * UIKit views — they are drawn into one SDL window that takes the remote through
 * GameController. Apple's sound file cannot be shipped either. So it is synthesised here, a
 * few damped partials close to the system's tick, and played by the game's own mixer
 * (`audio.c`'s cue slot), which also lets it follow the effects slider.
 *
 * What the mixer promises (audio.c): the cue is on the effects bus — so its slider sets its
 * level, and at 0 it is silent — beside the game's voices rather than among them, so it
 * neither stops nor delays a sound or a line of speech; it sounds while a panel pauses the
 * room; and a new tick restarts it rather than adding another, so quick moves never pile up.
 *
 * This module is the policy only, free of the host: a menu says where its focus was and
 * where it is now (`focusMoved`), and only a real move ticks — not a press at an edge that
 * does not wrap, nor a step whose every target is greyed. `sound.ts` binds it to the mixer.
 */

/** The click's length, ms. */
export const FOCUS_CLICK_MS = 32;
/**
 * Its voice gain on the effects bus: at the default effects level the click peaks at about
 * a fifth of full scale after MASTER_GAIN — under the game's own effects, as tvOS's tick
 * sits under an app's sound.
 */
export const FOCUS_GAIN = 0.3;

/**
 * The click, as 16-bit mono PCM at `rate`: three damped sines (a body at ~1.4 kHz, a bright
 * edge at ~3.1 kHz, a low knock at ~620 Hz), a 0.6 ms attack so it does not pop, and a fade
 * to exact silence at the end, peaking at 90 % of full scale. Deterministic: no noise.
 */
export function focusClickPcm(rate: number): Int16Array {
  const n = Math.round((rate * FOCUS_CLICK_MS) / 1000);
  const partials: ReadonlyArray<readonly [hz: number, amp: number, tauMs: number]> = [
    [1400, 0.6, 5],
    [3100, 0.35, 2.2],
    [620, 0.3, 9],
  ];
  const attack = Math.max(1, Math.round(rate * 0.0006));
  const fade = Math.max(1, Math.round(rate * 0.004));
  const f = new Float64Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let s = 0;
    for (const [hz, amp, tau] of partials) s += amp * Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / (tau / 1000));
    s *= Math.min(1, i / attack) * Math.min(1, (n - 1 - i) / fade);
    f[i] = s;
    peak = Math.max(peak, Math.abs(s));
  }
  const k = peak > 0 ? (0.9 * 32767) / peak : 0;
  return Int16Array.from(f, (s) => Math.round(s * k));
}

/** What plays the click, and whether it may now; unset (no sound) until `setFocusSound`. */
let play: (() => void) | null = null;
let audible: () => boolean = () => true;

/** Bind the tick to something that plays it (`sound.ts`: the mixer's cue) and say when it may. */
export function setFocusSound(player: (() => void) | null, when: () => boolean = () => true): void {
  play = player;
  audible = when;
}

/**
 * A menu's focus went from `from` to `to` (an index, a room, a button — anything compared
 * with `Object.is`): tick if it moved. Returns whether it did.
 */
export function focusMoved<T>(from: T, to: T): boolean {
  if (Object.is(from, to)) return false;
  if (play && audible()) play();
  return true;
}
