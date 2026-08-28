/**
 * The touch Options: the same four settings, as plain HTML controls.
 *
 * ── Why this one screen is deliberately not faithful ─────────────────────────
 * Everything else in this port reproduces the 1998 game; this does not, and the reason
 * is physical. The faithful Options is a FACE of the 155x395 control panel: the corner
 * button scrolls the indexed-palette bitmap over ten frames to a second picture whose
 * volume sliders are 130 px wide and 9 px tall, and whose three subtitle buttons are
 * about 20 px square — at the scale a phone draws that panel, none of them is a target a
 * thumb can hit. A pixel-faithful control that cannot be operated is not fidelity.
 *
 * So this is native `<input type=range>` and native radios: they come with the platform's
 * own touch handling, its accessibility and its drag behaviour, none of which is worth
 * reimplementing on a canvas. It is not styled to look like the game (Martin's decision,
 * 2026-08-26) — a half-imitation would read as a bug rather than as the settings screen.
 *
 * The canvas Options face is untouched and stays exactly as it was for mouse players.
 * The two are never both reachable: `togglePanelOptions` and `openMapOptions` — the only
 * two ways into the faithful face — hand over to this module while touch mode is on.
 *
 * ── Everything goes through `panelAction`, sliders included ──────────────────
 * The same rule `touchButtons.ts` states, and here it costs one helper to keep: a range
 * input has an index where the panel has a click position, so a volume change is sent as
 * `panelAction(17..19, sliderX(i))` (`render/hud.ts`, the exact inverse of the panel's
 * own `sliderIndex`). Subtitles and Help are regions 20-23 with no coordinate at all.
 *
 * The point is not tidiness. `panelAction` opens with `hracNespi()` — the original's
 * unconditional "the player is not asleep" on every panel press (Uovl.pas:946) — and it
 * is what `tools/test-options.mjs` drives, so this UI is covered by the oracle that
 * already exists for volumes, subtitles and their persistence rather than needing a
 * parallel one. Calling `setVolume`/`setSubtitleMode` directly would have been shorter
 * and would have left both of those behind.
 *
 * ── What it does not do ──────────────────────────────────────────────────────
 * It does not pause the game, for the same reason the faithful panel does not: the panel
 * sits BESIDE a live room and the player can open it mid-puzzle. Nothing here is a mode.
 * (Help is, and Help already handles that itself — `openHelp` sets the modal pause.)
 */
import { VOLUMES, type SubtitleMode, type VolumeBus } from '../core/settings.js';
import { settings } from './playerSettings.js';
import { sliderX } from '../render/hud.js';
import { touchUi } from './touchButtons.js';
import { ui } from './screenState.js';

/** The one name this module needs from `main.ts` — the panel's dispatch table. */
export interface TouchOptionsHost {
  /** `panelAction(region, panelX)` (Uovl regions). See the file comment. */
  readonly panelAction: (region: number, panelX?: number) => void;
}

/** Slider id -> (bus, region). The regions are Uovl's oblsnd / obltalk / oblmusic. */
const SLIDERS: ReadonlyArray<{ id: string; bus: VolumeBus; region: number }> = [
  { id: 'topt-effect', bus: 'effect', region: 17 },
  { id: 'topt-voice', bus: 'voice', region: 18 },
  { id: 'topt-music', bus: 'music', region: 19 },
];

/** Subtitle choice -> region (obltitcz / obltiteng / obltitno). */
const SUB_REGION: Record<SubtitleMode, number> = { cz: 20, en: 21, off: 22 };

let host!: TouchOptionsHost;
let open = false;

/** Is the touch Options overlay up? Read by the panel/map hand-over and by the probe. */
export function touchOptionsOpen(): boolean {
  return open;
}

/**
 * Show or hide the overlay. Private: everything outside comes in through the two
 * verbs below, so "is touch mode on" is asked in exactly one place.
 */
function setOpen(want: boolean): void {
  if (want === open) return;
  open = want;
  const el = document.getElementById('touchopts');
  if (el) el.hidden = !want;
  // Mirrors `data-touch`/`data-touchbar`: an attribute a probe can see even if the
  // markup is missing, so a test cannot pass by finding nothing.
  document.documentElement.toggleAttribute('data-touchopts', want);
  if (want) syncControls();
}

/** Open the touch Options (the touch stand-in for the panel's Options face). */
export function openTouchOptions(): void {
  setOpen(true);
}

/** Close it, back to whatever screen is underneath. */
export function closeTouchOptions(): void {
  setOpen(false);
}

/** The corner button's behaviour: open if closed, close if open (Uovl.pas:636-639). */
export function toggleTouchOptions(): void {
  setOpen(!open);
}

/**
 * Push the live settings into the controls.
 *
 * On open rather than per frame: these four values change from exactly two places — this
 * screen, and the faithful panel that is unreachable while this one is on — so there is
 * nothing to keep in step in between. A reading on open also covers the dev override
 * flipping touch mode mid-session with the canvas panel having moved a slider.
 */
function syncControls(): void {
  for (const s of SLIDERS) {
    const el = document.getElementById(s.id) as HTMLInputElement | null;
    if (el) el.value = String(settings.volume[s.bus]);
    showLevel(s.id, settings.volume[s.bus]);
  }
  const mode = settings.subtitles;
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="topt-subs"]')) {
    el.checked = el.value === mode;
  }
}

/**
 * The number beside a slider.
 *
 * It is the ORIGINAL's level (`Volumes[]`, 1..64), not the 0..12 index, because the
 * index is an implementation detail of the 1998 slider and 64 is a number a player can
 * read as "loud". Index 0 is 1, not silence — the original has no off — so it is shown
 * as the small number it is rather than labelled "Off", which would be a lie.
 */
function showLevel(id: string, index: number): void {
  const out = document.getElementById(id + '-val');
  if (out) out.textContent = String(VOLUMES[Math.max(0, Math.min(12, index))]);
}

/**
 * Arm the controls. Called once from `main.ts` at boot, whatever the device is — the
 * listeners cost nothing on an overlay that is never shown, and attaching them lazily
 * would mean a second place that decides what touch mode is.
 */
export function initTouchOptions(h: TouchOptionsHost): void {
  host = h;
  for (const s of SLIDERS) {
    const el = document.getElementById(s.id) as HTMLInputElement | null;
    // `input`, not `change`: the volume has to follow the thumb, because hearing the
    // level is the only way to choose one. That is also what the panel's mouse drag does.
    el?.addEventListener('input', () => {
      const i = Number(el.value);
      if (!Number.isFinite(i)) return;
      host.panelAction(s.region, sliderX(i));
      showLevel(s.id, i);
    });
  }
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="topt-subs"]')) {
    el.addEventListener('change', () => {
      const region = SUB_REGION[el.value as SubtitleMode];
      if (region) host.panelAction(region);
    });
  }
  // Help (region 23) is a full-screen document of its own, so this overlay gets out of
  // its way first — it is `position: fixed` and would otherwise sit on top of it.
  document.getElementById('topt-help')?.addEventListener('click', () => {
    closeTouchOptions();
    host.panelAction(23);
  });
  document.getElementById('topt-close')?.addEventListener('click', closeTouchOptions);
}

/**
 * Take the overlay down when it no longer has a screen to sit on.
 *
 * Called from the frame loop beside `syncTouchButtons`. Nothing PUTS it up from here —
 * it is opened by a deliberate act, not derived — but the things that can pull the
 * ground out from under it (the dev override turning touch off, a room script starting
 * a cutscene, help opening some other way) are spread over half the app, and none of
 * them should have to know this overlay exists. A closed overlay costs one comparison.
 */
export function syncTouchOptions(): void {
  if (!open) return;
  const grounded = touchUi() && !ui.helpOpen && (ui.screen === 'room' || ui.screen === 'map');
  if (!grounded) closeTouchOptions();
}
