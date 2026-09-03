/**
 * What the game is drawn WITH: the art tier, the render backend, the idle-FPS saver and
 * the developer pane. Four persisted player/developer choices and the four functions that
 * change them.
 *
 * ── The one thing to be careful about here ──────────────────────────────────
 * All four values are stored in `localStorage`, and `persist.ts` states the invariant that
 * `migrateSaves()` must run before any `ff.*` key is read. Module scope runs before any
 * statement of the importer, so reading them at the top of this file would read them
 * before the store had been opened, which is the one ordering rule `persist.ts` calls
 * an invariant rather than a habit.
 *
 * So each is declared with the default its stored value falls back to, and the real read
 * happens in `initRenderSettings()`, which `main.ts` calls exactly where these
 * declarations used to sit. A missed init therefore degrades to the documented default
 * rather than to something arbitrary. See AGENTS.md, "the module-evaluation trap".
 *
 * ── Why `art.ts` still takes `graphics` through its host ────────────────────
 * It could import it from here instead, and its host would shrink again. It does not,
 * because this module calls `retargetArtForTier()` — so importing back the other way
 * would make `art.ts` and this file a circular pair. One direction is enough.
 */
import { retargetArtForTier } from './art.js';
import { setAiFilterTier } from './aiFilter.js';
import { graphicsSelect, idleDirtyToggle, rendererSelect } from './dom.js';
import { setForceRoomRedraw } from './framePacing.js';
import { wake } from './frameClock.js';
import { enableWebgl } from './glPlumbing.js';
import { ui } from './screenState.js';
import type { GraphicsLevel } from '../core/settings.js';

/**
 * The one name this module needs from `main.ts`: the dev-only status caption, refreshed
 * because it prints the current tier. `#info` is `body.dev` only and no probe reads its
 * text, but it is still the game telling the truth about itself.
 */
export interface RenderSettingsHost {
  readonly setInfo: () => void;
}

let host!: RenderSettingsHost;

// Default: the AI-upscaled tier. Each element falls back to enhanced (and thence to
// classic) when it has no AI asset, so this is safe even for anything unbuilt.
//
// The persisted value is read in initRenderSettings(), NOT here: `migrateSaves()` must run
// before any `ff.*` key is read (see persist.ts), and module scope runs before main.ts's
// first statement. All four values below are declared with the same default the stored
// value falls back to, so a missed init is the documented default rather than a surprise.
export let graphics: GraphicsLevel = 'ai';

/**
 * True when the active level may use the enhanced (truecolor) art source. The AI
 * level counts too: enhanced is its per-element fallback and supplies the shared
 * truecolor-mode behaviour, so the art must be loaded either way. This is exactly `graphics !==
 * 'classic'`, so classic (false) and enhanced (true) keep their prior behaviour
 * byte-for-byte; only the new `ai` level newly returns true.
 */
export const enhancedArtActive = (): boolean => graphics !== 'classic';
// Render backend (P3): the CPU compositor (oracle, fallback) or the WebGL2 GPU
// compositor. Orthogonal to `graphics` (the art source) — both art sources
// composite on either backend, and every room (incl. gspec=42 ZX) is on the GPU.
// Any GL failure falls back to the CPU compositor. Persisted; defaults to webgl.
// The default is webgl unconditionally (not gated on a live webgl2Available()
// probe): the probe spins up a throwaway GL context and, under context pressure,
// can transiently fail on a fresh load and strand the picker on CPU. A genuine GL
// failure at runtime still falls back to the CPU compositor via glFailed, and the
// HUD shows the WEBGL→cpu fallback, so webgl stays the honest intended default.
export let renderer: 'cpu' | 'webgl' = 'webgl';
// Render-on-dirty (perf): when true, an idle room is repainted only when its frame
// actually changes (the wobble/animation advances on the 12.5fps logic tick), not
// on every 60fps rAF — cutting idle in-room CPU ~5x. 60fps is kept while anything
// is animating (fish sliding, ZX bands, etc.). Persisted; default on.
export let renderOnDirty = true;
// Developer pane: persisted, off by default. Enabled via Ctrl+Alt+D — it shows the
// tuning chrome (dev bar) + perf HUD (both gated on body.dev in CSS) and arms the
// one-key dev toggles (E/R/P/F/G). Players never see it.
export let devEnabled = false;

/** Enable/disable the developer pane; persists and mirrors the body.dev CSS hook. */
export function setDevEnabled(v: boolean): void {
  devEnabled = v;
  localStorage.setItem('ff.devEnabled', v ? '1' : '0');
  document.body.classList.toggle('dev', v);
}

/**
 * Switch the render backend (CPU compositor ⇄ WebGL). The CPU path is the parity
 * oracle + fallback; WebGL is re-enabled explicitly even after a prior GL failure
 * (the user is retrying). Persists, keeps the dev-bar select in sync, and forces a
 * room repaint so the switch shows immediately under render-on-dirty.
 */
export function setRenderer(r: 'cpu' | 'webgl'): void {
  renderer = r;
  if (renderer === 'webgl') enableWebgl();
  localStorage.setItem('ff.renderer', renderer);
  if (rendererSelect) rendererSelect.value = renderer;
  setForceRoomRedraw(true);
  wake();
  host.setInfo();
}

/** Toggle/set the idle-FPS saver (render-on-dirty); persists + syncs the dev-bar checkbox. */
export function setRenderOnDirty(v: boolean): void {
  renderOnDirty = v;
  localStorage.setItem('ff.renderOnDirty', v ? '1' : '0');
  if (idleDirtyToggle) idleDirtyToggle.checked = v;
  setForceRoomRedraw(true); // repaint immediately when turning the saver off
  wake();
}

// The graphics-level cycle order for the E hotkey (classic → enhanced → ai → …).
export const GRAPHICS_LEVELS: readonly GraphicsLevel[] = ['classic', 'enhanced', 'ai'];

/**
 * Reflect the tier onto `<html>` so the stylesheet can see it (`data-graphics`, read the
 * same way as `data-touch`/`data-touchbar` beside it). The AI tier's colour filter hangs
 * off this — `src/app/aiFilter.ts` explains what for.
 *
 * Called from BOTH writers below, because they are not one path: `setGraphics()` is the
 * single entry point for a CHANGE, but boot does not go through it — `initRenderSettings()`
 * assigns `graphics` straight from localStorage. Miss that one and the attribute is
 * correct for every switch the player makes and wrong for the tier they actually start
 * in, which is the AI tier by default and so wrong almost always.
 */
function reflectGraphics(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.graphics = graphics;
  // The colour tuning is scoped to the AI tier, so its dev-bar controls go live and dead
  // with it. Pushed rather than pulled so `aiFilter.ts` need not import this module back.
  setAiFilterTier(graphics === 'ai');
}

/**
 * Set the graphics-quality level (classic/enhanced/ai). Single entry point shared
 * by the E hotkey, the dev-bar combobox, and the ff.setGraphics hook: persists,
 * ensures the enhanced art for the current room is loaded whenever the new level
 * uses it (enhanced or ai), keeps the dev-bar select in sync, and forces a room
 * repaint so the switch shows immediately under render-on-dirty.
 */
export function setGraphics(level: GraphicsLevel): void {
  graphics = level;
  localStorage.setItem('ff.graphics', graphics);
  reflectGraphics();
  retargetArtForTier();
  if (graphicsSelect) graphicsSelect.value = graphics;
  setForceRoomRedraw(true);
  ui.mapSig = null; // repaint the map so switching to/from the AI level shows immediately
  wake();
  host.setInfo();
}

/**
 * Assign the backend and nothing else.
 *
 * `__ff.setRenderer` has always done its own thing rather than calling `setRenderer()`
 * above: it assigns, calls `enableWebgl()`, persists, and deliberately skips the dev-bar
 * sync, the forced repaint, the wake and the caption refresh. That difference is
 * pre-existing and is preserved here rather than quietly fixed — a restructuring is the
 * wrong place to change what a test hook does, and the probes are the oracle for this
 * series. This export exists so that path can keep working now the binding is imported.
 */
export function setRendererValue(r: 'cpu' | 'webgl'): void {
  renderer = r;
}

/**
 * Hand this module its view of the game and load the four persisted choices.
 *
 * Called from `main.ts` after the save store is open, which is what makes reading these
 * keys legal (see the header).
 */
export function initRenderSettings(h: RenderSettingsHost): void {
  host = h;
  const g = localStorage.getItem('ff.graphics');
  if (g === 'classic' || g === 'enhanced' || g === 'ai') graphics = g;
  reflectGraphics();
  renderer = (localStorage.getItem('ff.renderer') as 'cpu' | 'webgl' | null) ?? 'webgl';
  renderOnDirty = localStorage.getItem('ff.renderOnDirty') !== '0';
  devEnabled = localStorage.getItem('ff.devEnabled') === '1';
}
