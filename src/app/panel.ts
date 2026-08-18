/**
 * The side panel: the buttons the original game is actually played through, the options
 * sub-panel that scrolls up over them, and the help overlay.
 *
 * Faithful to `Uovl.pas` — the scroll is a ten-frame animation on the original's 100 ms
 * panel timer (`Ostav`, `SCMIN`..`SCMAX`), not a transition invented here — so most of the
 * code is about matching frames and hit regions rather than about drawing.
 *
 * Three names from `main.ts`, and they are all the same question asked three ways: may the
 * player save right now (`canSave`), is there something to load (`saveExists`), and get me
 * back to the map (`closeMapOverlay`). The panel does not otherwise know what the game is
 * doing.
 */
import {
  ORANZOVY,
  PANEL_H,
  PANEL_W,
  SEDY,
  SVITICI,
  ZLUTY,
  composeOptions,
  composePanel,
  panelToRgba,
  type OptionsState,
  type PanelState,
} from '../render/hud.js';
import { aiPanel, ensureAiPanel } from './art.js';
import { audio } from './audioEngine.js';
import { canvas, ctx, feedbar, helpClose, panelCanvas, panelCol, panelCtx } from './dom.js';
import { wake } from './frameClock.js';
import { engine, room } from './gameState.js';
import { settings, subLang } from './playerSettings.js';
import { graphics } from './renderSettings.js';
import { contentScaleFor, scalingFilterFor, stage } from './stageGeometry.js';
import type { VolumeBus } from '../core/settings.js';
import { ui, O_NORMAL, O_OPTIONS, O_SC_DOWN, O_SC_UP, PANEL_SCROLL_MS, SCMAX, SCMIN, helpScreens } from './screenState.js';

/** The three names this module needs from `main.ts`. */
export interface PanelHost {
  readonly canSave: () => boolean;
  readonly closeMapOverlay: () => void;
  readonly saveExists: () => boolean;
}

let host!: PanelHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initPanel(h: PanelHost): void {
  host = h;
  // The help overlay's own way out. Registered here rather than in dom.ts because that
  // module must stay free of behaviour (and importing panel.ts from it would be a cycle).
  helpClose.addEventListener('click', () => {
    closeHelp();
    wake();
  });
  // A right-click anywhere on the help page closes it, and the button is part of the
  // page — without this it would be the one spot where the secondary button raised the
  // browser's context menu instead. The page's own handler is on #screen underneath and
  // a click on the button never reaches it, so it is repeated here rather than shared.
  helpClose.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeHelp();
    wake();
  });
}

export function panelState(): PanelState {
  const bigDead = !room || !room.alive.big || room.busy.big !== 0;
  const littleDead = !room || !room.alive.little || room.busy.little !== 0;
  const bothAlive = !!room && room.alive.big && room.alive.little;
  const p = ui.panelPressed;
  let pressedDir = 0;
  if (p >= 1 && p <= 4) pressedDir = p; // little up/down/left/right
  else if (p >= 6 && p <= 9) pressedDir = p - 1; // big -> 5..8
  return {
    velka: bigDead ? SEDY : engine?.active === 'big' ? ZLUTY : ORANZOVY,
    mala: littleDead ? SEDY : engine?.active === 'little' ? ZLUTY : ORANZOVY,
    space: p === 11 ? SVITICI : bothAlive ? ORANZOVY : SEDY,
    save: p === 12 ? SVITICI : host.canSave() ? ORANZOVY : SEDY,
    load: p === 13 ? SVITICI : host.saveExists() ? ORANZOVY : SEDY,
    abort: p === 14 ? SVITICI : ORANZOVY,
    restart: p === 15 ? SVITICI : ORANZOVY,
    pressedDir,
  };
}

/** The live options-panel state for rendering (KresliOptions, Uovl.pas:461). */
export function optionsState(): OptionsState {
  return {
    volume: { ...settings.volume },
    subtitles: settings.subtitles,
    helpActive: ui.helpOpen,
    scrollFrame: ui.ostav === O_SC_UP || ui.ostav === O_SC_DOWN ? ui.scroll : -1,
  };
}

/**
 * Advance the options scroll animation one frame (the original panel Timer,
 * Uovl.pas:499-512): o_sc_up runs scroll scmin->scmax then settles on o_options;
 * o_sc_down runs scmax->scmin then settles on o_normal.
 */
export function advancePanelScroll(): void {
  if (ui.ostav === O_SC_UP) {
    if (ui.scroll >= SCMAX) ui.ostav = O_OPTIONS;
    else ui.scroll++;
  } else if (ui.ostav === O_SC_DOWN) {
    if (ui.scroll <= SCMIN) ui.ostav = O_NORMAL;
    else ui.scroll--;
  }
}

/** Drive the scroll animation off wall-clock time (independent of game logic). */
export function tickPanelScroll(dtMs: number): void {
  if (ui.ostav !== O_SC_UP && ui.ostav !== O_SC_DOWN) {
    ui.scrollAcc = 0;
    return;
  }
  ui.scrollAcc += dtMs;
  if (ui.scrollAcc < PANEL_SCROLL_MS) return;
  // Advance at most ONE frame per rendered frame and DROP the rest of the backlog —
  // the same rule the game logic uses (see the MAX_STEPS_PER_FRAME guard in loop()).
  //
  // This used to `while`-loop, which fast-forwarded the whole 10-frame animation
  // inside a single long frame: opening the options right after entering a room, while
  // the tier's art was still decoding, burned the entire roll-down in one tick and the
  // panel appeared to snap open with no animation at all. (Closing it, and every later
  // open, looked fine because nothing was loading by then.) A dropped backlog just
  // makes the animation take marginally longer under load, which is invisible; a
  // batched one skips it entirely.
  ui.scrollAcc = 0;
  advancePanelScroll();
}

/**
 * Toggle the options sub-panel (the corner button oblroh, or a right-click on the
 * panel; Uovl.pas:636-639,709-712): normal -> scroll up -> options -> scroll down.
 */
export function togglePanelOptions(): void {
  if (ui.ostav === O_NORMAL) ui.ostav = O_SC_UP;
  else if (ui.ostav === O_OPTIONS) ui.ostav = O_SC_DOWN;
}

/**
 * Open the help screens (akce_help / ToggleHelp, Uovl.pas:719,252): load the pages
 * for the current subtitle language (tit_def when subtitles are off, as the original
 * uses tit_def) and show the overlay from the first page.
 */
export function openHelp(): void {
  // Leaving the map's Options overlay open here used to render it ON TOP of the
  // full-screen help pages and hide them, because the column floats at zIndex 50. That
  // can no longer happen — drawPanel hides the column outright while help is open — so
  // this now only decides where the player lands when help closes: the plain map. That
  // is the established behaviour and tools/test-options.mjs pins it; kept deliberately
  // rather than dropped, since restoring Options instead is a different choice, not a
  // bug fix.
  if (ui.mapOverlay === 'options') host.closeMapOverlay();
  ui.helpOpen = true;
  helpScreens.page = 0;
  // Silence the room and the map, keeping each sound's place. The logic tick freezes
  // with it (renderLoop) — see the note there for why the port deviates from the
  // original's non-modal FHelp.Show here.
  audio.setModalPause(true);
  void helpScreens.load(subLang());
}

/** Close the help overlay (any key, Help.pas:FormKeyDown). */
export function closeHelp(): void {
  ui.helpOpen = false;
  audio.setModalPause(false);
}

/** Draw the current help page full-screen on the main canvas (Help.pas:TabControl1Change). */
export function drawHelp(): void {
  const pages = helpScreens.pages(subLang());
  const pg = pages[helpScreens.page];
  if (!pg) return; // still loading
  ui.mapSig = null; // help paints #screen — invalidate the map cache
  if (canvas.width !== pg.w || canvas.height !== pg.h) {
    canvas.width = pg.w;
    canvas.height = pg.h;
  }
  // Shrink to fit the stage box, but never enlarge past 1:1.
  //
  // The page is a fixed-resolution bitmap the original blitted at its own size, so
  // scaling it UP would only blur art the player is meant to read — 1:1 is the faithful
  // ceiling and the size on any ordinary window. But the page is 642x482 and the box is
  // 800x600 NATIVE, so on a small window the box is the smaller of the two in CSS px and
  // `overflow: hidden` simply cut the page off: measured at 700x620 the box was 580px
  // against a 642px page, and at 900x420 it was 420px tall against 482. That took the
  // close button (top-left, inside the page) off screen with it — the one affordance
  // that exists BECAUSE the panel is hidden here. Found by review.
  const cs = Math.min(1, contentScaleFor(pg.w, pg.h));
  const cssW = `${Math.floor(pg.w * cs)}px`; // floor, so it can never round OVER the box
  const cssH = `${Math.floor(pg.h * cs)}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  // Nearest-neighbour is right for art shown at 1:1; a fractional shrink of a photographic
  // page aliases badly, so let the browser filter that case (the same trade scalingFilterFor
  // makes for the AI tier's upscaled store).
  const want = cs < 1 ? 'auto' : '';
  if (canvas.style.imageRendering !== want) canvas.style.imageRendering = want;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pg.rgba), pg.w, pg.h), 0, 0);
}

/** Composite and blit the control panel next to the play area (or as a map overlay). */
export function drawPanel(): void {
  if (!ui.panel) return;
  const asMapOverlay = ui.screen === 'map' && ui.mapOverlay === 'options';
  // Hidden while the help pages are up. The help page is drawn at its own unscaled size
  // (drawHelp), and the stage box hugs its content, so a visible panel would slide a long
  // way left the moment help opened and back again when it closed — measured 541px at
  // 2048x1017. Hiding it removes the jump at its source rather than damping it, and the
  // page is self-contained anyway: nothing on the panel acts on it. `helpClose` is the
  // way out that this takes away (dom.ts).
  const visible = (ui.screen === 'room' || asMapOverlay) && !ui.helpOpen;
  // Hide the COLUMN, not just the canvas inside it. `display: none` takes an element
  // out of the flex row entirely, and with it the row's gap; hiding only the canvas
  // would leave a zero-width column still claiming that gap, so the map sat half a gap
  // off-centre and then jumped right the moment Options floated the column out of the
  // flow. (That is exactly what happened when the column was introduced — the canvas
  // used to be the flex item itself, and hiding it removed the gap for free.)
  panelCol.style.display = visible ? '' : 'none';
  // The feedback strip belongs to the Options face and hangs under it (index.html).
  // It is shown only while those options are actually on screen, so nothing modern is
  // in view while the game is being played — and it is absolutely positioned, so it
  // never changes the panel column's size and cannot move the game when it appears.
  // Written through a guard like every other DOM touch in this function: drawPanel runs
  // per frame, and an unconditional assignment here would be the one line in it that
  // does style work on an idle room.
  const wantBar = !(visible && ui.ostav === O_OPTIONS);
  if (feedbar && feedbar.hidden !== wantBar) feedbar.hidden = wantBar;
  // Float the panel over the map when opened from the Options corner; otherwise
  // it sits statically beside the play area (its normal in-room position). The COLUMN
  // is what floats, not the canvas, so the strip travels with the panel it belongs to.
  if (asMapOverlay) {
    panelCol.style.position = 'fixed';
    panelCol.style.left = '50%';
    panelCol.style.top = '50%';
    panelCol.style.transform = 'translate(-50%, -50%)';
    panelCol.style.zIndex = '50';
  } else if (panelCol.style.position === 'fixed') {
    panelCol.style.position = '';
    panelCol.style.left = '';
    panelCol.style.top = '';
    panelCol.style.transform = '';
    panelCol.style.zIndex = '';
  }
  if (!visible) return;
  // Composing the panel (155×395) + palette→RGBA + putImageData is pure per-frame
  // waste while nothing on it changes (idle in a room). Compute a signature from the
  // state FIRST and bail before the (allocating) compose+blit when it's unchanged.
  if (graphics === 'ai' && !ui.aiPanelTried) { ui.aiPanelTried = true; void ensureAiPanel(); }
  // The AI panel composites at ×scale into a bigger backing store; the CSS size below
  // is unchanged, so this is purely a resolution increase. Falls back the moment the
  // art is missing or the tier is switched away.
  const ai = graphics === 'ai' ? aiPanel : null;
  const wantW = ai ? ai.width : PANEL_W;
  const wantH = ai ? ai.height : PANEL_H;
  if (panelCanvas.width !== wantW || panelCanvas.height !== wantH) {
    panelCanvas.width = wantW;
    panelCanvas.height = wantH;
    ui.panelSig = null; // resize cleared the backing store — force a repaint
  }
  let sig: string;
  let paint: () => void;
  if (ui.ostav === O_NORMAL) {
    const st = panelState();
    sig = `n|${st.velka}|${st.mala}|${st.space}|${st.save}|${st.load}|${st.abort}|${st.restart}|${st.pressedDir}`;
    paint = ai
      ? () => ai.drawPanel(panelCtx, st)
      : () => panelCtx.putImageData(new ImageData(new Uint8ClampedArray(panelToRgba(composePanel(ui.panel!.images, st), ui.panel!.palette)), PANEL_W, PANEL_H), 0, 0);
  } else {
    const st = optionsState();
    sig = `o|${st.volume.effect}|${st.volume.voice}|${st.volume.music}|${st.subtitles}|${st.helpActive ? 1 : 0}|${st.scrollFrame}`;
    paint = ai
      ? () => ai.drawOptions(panelCtx, st)
      : () => panelCtx.putImageData(new ImageData(new Uint8ClampedArray(panelToRgba(composeOptions(ui.panel!.images, ui.panel!.cudl, st), ui.panel!.palette)), PANEL_W, PANEL_H), 0, 0);
  }
  // The signature must include which renderer produced the pixels, or switching tiers
  // with an otherwise-identical panel state would leave the old resolution on screen.
  sig = `${ai ? 'a' : 'f'}|${sig}`;
  if (sig !== ui.panelSig) {
    ui.panelSig = sig;
    paint();
  }
  // Fixed panel size at the stage scale — constant across all rooms (no longer
  // tracks the room height, so it stops resizing room-to-room). Only touch the DOM
  // when it actually changes (a resize), so idle frames do no style work.
  const pw = `${Math.round(stage.panelW)}px`;
  const ph = `${Math.round(stage.panelH)}px`;
  if (panelCanvas.style.width !== pw) panelCanvas.style.width = pw;
  if (panelCanvas.style.height !== ph) panelCanvas.style.height = ph;
  // The ai panel composites at ×4 into a 620×1580 store shown at ~145px wide, so
  // without this it is point-sampled and loses the detail it was upscaled for.
  const pFilter = scalingFilterFor(panelCanvas.width, Math.round(stage.panelW));
  if (panelCanvas.style.imageRendering !== pFilter) panelCanvas.style.imageRendering = pFilter;
}

/**
 * Ensure the level name-plaque data (Desky) is loaded for the current subtitle
 * language (typdesek<>tit_def reload, UMain.pas:1437): popdesk<n>.dat + desky<n>.dat
 * where n = 1 (cz) / 2 (en). The language is the shared subtitle language (subLang),
 * so the room-name plaques always match the subtitles/help.
 */
