/**
 * How big the game is drawn, and the constants the simulation is timed by.
 *
 * ── Why these two things share a file ────────────────────────────────────────
 * They were adjacent in `main.ts` and they leave together, but the honest reason is that
 * both are answers to "what is the same for every screen": the stage box that everything
 * is scaled into, and the tick length everything is timed by. Nothing here reads game
 * state — `roomGeometry` takes the room as an argument rather than reading the global —
 * which is why this is the cheapest region in the file to move: it needs exactly ONE name
 * from `main.ts` (`settings`, for the player's fit mode).
 *
 * ── What deliberately did NOT come with it ───────────────────────────────────
 * The device gate. `main.ts` refuses to run on a phone before any other side effect, via
 * a never-settling top-level `await`, and an imported module is evaluated before any
 * statement of its importer — so moving the gate here would move it AFTER things it must
 * precede, and moving anything that touches the DOM here would jump it AHEAD of the gate.
 * The gate stays in `main.ts` as the first statement it runs. See AGENTS.md, "the
 * module-evaluation trap".
 *
 * That is also why `stage` is measured in `initStageGeometry()` rather than in its
 * initialiser: `window.innerWidth` is a DOM read, and this module must do nothing at
 * import time.
 */
import { aiRoom, aiRoomRenderActive } from './art.js';
import {
  computeStageLayout,
  contentScale as fitScale,
  type RoomGeometry,
  type StageLayout,
} from './layout.js';
import { roomScreenSize } from '../render/renderRoom.js';
import type { Room } from '../core/room.js';
import type { Settings } from '../core/settings.js';

/**
 * The one name this module needs from `main.ts`.
 *
 * `settings` is the player's persisted options, and only `fitMode` is read. It is not
 * imported directly because `loadSettings()` reads `localStorage`, which must not happen
 * before the device gate — so `main.ts` owns the call and hands the result over here.
 */
export interface StageGeometryHost {
  readonly settings: Settings;
}

let host!: StageGeometryHost;

// Display scaling (public-release Phase 1). The stage box + side panel are scaled
// together to fill the viewport (`stage`, recomputed on resize/fullscreen); each
// room/map/cutscene is drawn at contentScaleFor() and centered in the stage box.
// Replaces the old fixed `SCALE = 2`. Input stays scale-agnostic (every pointer
// handler maps via getBoundingClientRect ratios), so only display sizing changes.
// Measured in initStageGeometry(), not here: reading window.innerWidth at module scope
// would happen BEFORE main.ts's phone gate, and this module's whole contract is that
// importing it does nothing. The literal below is the same fallback the old expression
// used when there was no window at all.
export let stage: StageLayout = computeStageLayout(1600, 1200);

/** Recompute the stage box; called on resize, fullscreen and DPR changes. */
export function setStage(v: StageLayout): void {
  stage = v;
}

/**
 * Pick the scaling filter for a canvas whose BACKING STORE is `backingW` wide while it
 * is displayed `cssW` wide.
 *
 * The stylesheet sets `image-rendering: pixelated` on every canvas, which is right for
 * native-resolution art (crisp 1998 pixels) but wrong for the ai tier: a ×4 backing
 * store shown smaller gets point-sampled on the way down, which throws most of the
 * upscaled detail away and aliases.
 *
 * Smooth-filter only when the store is genuinely UPSCALED (>= 1.5× the displayed size),
 * not merely minified: a native 155px panel shown at 145px is also "minifying", and
 * smoothing that would soften the faithful tiers, which must keep their exact pixels.
 * Returns the value for style.imageRendering ('' = inherit the stylesheet).
 */
export const UPSCALED_STORE_RATIO = 1.5;
export function scalingFilterFor(backingW: number, cssW: number): string {
  return backingW >= cssW * UPSCALED_STORE_RATIO ? 'auto' : '';
}

/** Display px per native px for content of size w×h, per the current fit mode. */
export function contentScaleFor(w: number, h: number): number {
  // Pass devicePixelRatio so 'native' can snap to whole PHYSICAL pixels (crisp at
  // any browser zoom / display scaling); the other modes ignore it.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return fitScale(w, h, stage.scale, host.settings.fitMode, dpr);
}

/**
 * Everything about where and how big the current room is drawn — the single source of
 * truth for the room's geometry.
 *
 * It exists because "the room canvas's backing store is the native game resolution" was
 * true for classic and enhanced, so the two were used interchangeably in half a dozen
 * independently-derived places. The `ai` tier falsifies it (its backing store is ×scale)
 * and every one of those places became a chance to conflate them. That produced a real
 * bug — the subtitle overlay was sized from the backing store and came out up to 2.7×
 * wider than the room — and would have produced more.
 *
 * So the two are named separately here and derived once:
 *   native   the resolution the SIMULATION uses; all game coordinates are in these px
 *   css      the on-screen box; every layer stacked over the room must match this
 *   backing  the buffer the frame is COMPOSITED in, which is native×upscale in the ai
 *            tier — the #screen canvas on the canvas-2D path, GlAiScreen's offscreen
 *            FBO on the GPU one (where #screen is left at native size, since nothing
 *            paints into it)
 *
 * `scale` converts native → css, which is what any overlay drawing in game coordinates
 * needs; it is deliberately NOT derived from the backing store.
 */
export function roomGeometry(r: Room): RoomGeometry {
  const { w: nativeW, h: nativeH } = roomScreenSize(r);
  const scale = contentScaleFor(nativeW, nativeH);
  // Only the AI compositor renders above native resolution, and only when it is the
  // path that will actually draw this frame (aiRoomRenderActive covers the gate, the
  // loaded art and the current room).
  const upscale = aiRoomRenderActive(r) && aiRoom ? aiRoom.scale : 1;
  return {
    nativeW,
    nativeH,
    scale,
    cssW: nativeW * scale,
    cssH: nativeH * scale,
    backingW: nativeW * upscale,
    backingH: nativeH * upscale,
    upscale,
  };
}

// The original advances ALL game logic on a fixed WALL-CLOCK timestep, not the
// display refresh and not per audio buffer. The shipped game loop is TRoom.Jedeme
// (URoom.pas:23952, called from UMain.pas:266): a manual busy-wait that spins on
// `Application.ProcessMessages` until ~80ms of system `Time` have elapsed
// (`until curtime > lasttime + 0.08/86400`, i.e. 0.08s), then runs ONE logic step
// (Timer1Timer). So logic runs at ~80ms/step (~12.5 fps). The audio-buffer gate
// that would have locked it to the 139.32ms buffer (`else if Tick=0 then exit`,
// URoom.pas:24061) is COMMENTED OUT; Timer1's Interval=90ms (URoom.dfm) is only a
// secondary/fallback and the 80ms loop out-paces it. We reproduce this fixed
// timestep so dialog `delay`s, idle timers, the `count` clock and animation `fazi`
// counts all run at the authentic rate — otherwise (at the 60fps render rate)
// every scripted pause is ~6.7x too short.
export const LOGIC_MS = 80; // ~12.5 game ticks/sec — TRoom.Jedeme's 0.08s wall-clock step
export const LOGIC_SEC = LOGIC_MS / 1000;
// Jedeme runs exactly one step per loop iteration: under load the loop just takes
// longer (the game slows), it never fast-forwards. So we step at most once per
// rendered frame — no multi-step catch-up — matching that behaviour.
export const MAX_STEPS_PER_FRAME = 1;
export const DEFAULT_LINE_TICKS = 12; // readable fallback when a voice line has no audio

// Sound-effect volume vs voices (RSound.pas:33-35): snd_volume=48, talk_volume=64,
// max_volume=64. Effects (landings, death cries, bubbles, script Snd) play at 48/64
// of voice level; the port previously played them at full voice volume, so loud
// near-full-scale effects (e.g. the sp-smrt death scream) overlapping a landing
// summed past 0 dB and hard-clipped — a harsh "beep". Voices/music keep their levels.
export const EFFECT_VOL = 48 / 64;


// Animation lengths in game ticks (URoom.pas:425-433) — shared with the step-engine.
export const EXIT_CELLS = 5; // cells of travel to slide fully off-screen (render constant)

/** Hand this module its view of the game and take the first stage measurement. */
export function initStageGeometry(h: StageGeometryHost): void {
  host = h;
  if (typeof window !== 'undefined') {
    stage = computeStageLayout(window.innerWidth, window.innerHeight);
  }
}
