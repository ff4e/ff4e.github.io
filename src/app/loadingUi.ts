/**
 * The loading overlay, the fatal-error screen and the resize handler: the chrome the game
 * shows when it is NOT yet showing the game.
 *
 * ── Why these three sit together ─────────────────────────────────────────────
 * They are the only things that write to the page OUTSIDE the canvases. The overlay covers
 * the stage while a room's art is fetched, the fatal screen replaces everything when boot
 * fails, and `relayout()` resizes the stage box they both sit in. Keeping them together is
 * what lets everything else treat the DOM as "the canvases and nothing else".
 *
 * The overlay is DERIVED, not pushed: `syncLoadingUi` is called from the frame loop after
 * the draw branch and decides from live state whether to show. The long comment on that
 * function explains why that matters — a push-based version has to remember every site
 * that changes the flags, and leaving the room screen has to be un-done by hand.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * The three listeners this file installs (the fatal-screen reload button, and the
 * boot-failure `error` / `unhandledrejection` traps) are registered from
 * `initLoadingUi()`, not at module scope: `main.ts` refuses to run on a phone before any
 * other side effect, and an imported module is evaluated before any statement of its
 * importer. See AGENTS.md, "the module-evaluation trap".
 */
import { mapArtHolding, mapPresented, roomArtPending } from './art.js';
import { fatalEl, loadingEl, loadingMsg, stageBox, stageRow } from './dom.js';
import { setForceRoomRedraw, roomLoading } from './framePacing.js';
import { wake } from './frameClock.js';
import { booted } from './stageState.js';
import { subLang } from './playerSettings.js';
import { renderer } from './renderSettings.js';
import { ui } from './screenState.js';
import { computeStageLayout } from './layout.js';
import { setStage, stage } from './stageGeometry.js';
import { ROOMS } from '../data/roomTable.js';
import { webgl2Available } from '../render/glScreen.js';

export function setLoadingMsg(msg: string): void {
  if (loadingMsg) loadingMsg.textContent = msg;
}

// ── Post-boot room-loading overlay ────────────────────────────────────────────
// The same #loading markup boot uses, re-armed for room entry. Entering a cold room
// over a slow link takes 17-27s (measured, Slow 4G) and the stage is deliberately
// black for all of it, so the wait needs explaining. Armed on a DELAY: a cached or
// local entry is ready in a few ms and must never flash a spinner.
//
// Driven by the RENDER LOOP off the same `roomLoading || roomArtPending()` predicate
// the frame hold uses, rather than by notifications from every site that can change
// those flags. That is what keeps it honest: the hide happens after the loop has
// painted the frame the overlay was covering, and leaving the room screen (map,
// story page, cutscene) takes it down with no separate teardown call — both of which
// a push-based version had to hand-roll, and could get wrong by forgetting a site.
const LOADING_DELAY_MS = 200;
/** When the current room entry started, or 0 when no entry is in progress. */
let roomLoadingSince = 0;
/** When the map's overlay becomes visible, or 0 while the map is not waiting. */
let mapLoadingDueAt = 0;

/** Arm the overlay for a room entry (the loop reveals it if the wait is real). */
export function beginRoomLoadingUi(num: number): void {
  if (!booted || !loadingEl) return;
  roomLoadingSince = performance.now();
  const desc = ROOMS[num - 1];
  setLoadingMsg(desc ? `Loading ${subLang() === 'cz' ? desc.cz : desc.en}…` : 'Loading…');
  // The boot splash's title and attribution would read as a restart mid-game; the
  // spinner and the room name are the parts that belong to a room entry.
  loadingEl.classList.add('inroom');
}

/**
 * Show or hide the overlay for the frame that has just been painted. Called from
 * loop() AFTER the draw branch, so hiding it can never expose an unpainted stage.
 *
 * Serves BOTH holds — the room's art tier and the `ai` tier's world map — off their
 * own live-state predicates. There is one overlay, so it gets one owner: two syncs
 * writing `hidden` would fight over it on any frame where both had an opinion.
 *
 * The map's whole overlay state is DERIVED here, where the room's is pushed from
 * beginRoomLoadingUi(). That is not an inconsistency but the same principle applied
 * to a one-shot: a room entry re-runs its begin() every time, while the map's art
 * loads at most once per session, so a pushed arm could not re-arm anything when the
 * player leaves the `ai` tier (or the map screen) mid-load and comes back. Derived,
 * every return to the wait re-arms — and re-labels — for free. Note the room's begin()
 * can overwrite the message while the map's load is still in flight, which is exactly
 * the case a pushed map label would have got wrong.
 */
export function syncLoadingUi(now: number): void {
  if (!booted || !loadingEl) return;
  const roomWaiting = ui.screen === 'room' && (roomLoading || roomArtPending());
  const mapWaiting = mapArtHolding();
  if (!roomWaiting) roomLoadingSince = 0;
  if (!mapWaiting) mapLoadingDueAt = 0;
  else if (mapLoadingDueAt === 0) {
    // Delay the spinner only over a map that is ALREADY ON SCREEN — a switch into the
    // tier, where the player is looking at a perfectly good map and an instant (local)
    // load must not flash anything at them. When the map is not up yet the stage holds
    // black, or the room/intro we just left, so waiting 200ms to say so would only
    // present something the player is not being taken to.
    mapLoadingDueAt = now + (mapPresented ? LOADING_DELAY_MS : 0);
    setLoadingMsg('Loading the world map…');
    // The boot splash's title and attribution belong to boot — so keep them in the one
    // case where this IS boot still running: the overlay never came down between boot
    // and the map's first frame. Every other arm is a spinner being (re)shown mid-game,
    // where the splash would read as a restart, exactly as a room entry's does.
    if (loadingEl.hidden) loadingEl.classList.add('inroom');
  }
  const show =
    (roomWaiting && roomLoadingSince !== 0 && now - roomLoadingSince >= LOADING_DELAY_MS) ||
    (mapWaiting && now >= mapLoadingDueAt);
  if (loadingEl.hidden === show) loadingEl.hidden = !show;
}

/** Reveal the fatal-error screen (missing/broken assets or a boot exception). */
export function showFatal(msg?: string): void {
  if (loadingEl) loadingEl.hidden = true;
  if (fatalEl) {
    const p = document.getElementById('fatal-msg');
    if (p && msg) p.textContent = msg;
    fatalEl.hidden = false;
  }
}
/** Software-renderer note when WebGL2 is unavailable (CPU fallback is automatic). */
export function maybeShowWebglNote(): void {
  const note = document.getElementById('webgl-note');
  if (!note) return;
  if (webgl2Available() || localStorage.getItem('ff.webglNoteDismissed') === '1') return;
  note.hidden = false;
  document.getElementById('webgl-note-x')?.addEventListener('click', () => {
    note.hidden = true;
    try {
      localStorage.setItem('ff.webglNoteDismissed', '1');
    } catch {
      /* ignore */
    }
  });
}


/**
 * Recompute the stage scale from the available game area and size the stage box +
 * side panel. Called on boot, window resize, and fullscreen change. The room/map/
 * cutscene canvases are sized per-frame in their draw functions from `stage`.
 */
export function relayout(): void {
  const availW = stageRow?.clientWidth || window.innerWidth;
  const availH = stageRow?.clientHeight || window.innerHeight;
  setStage(computeStageLayout(availW, availH));
  stageBox.style.width = `${Math.round(stage.stageW)}px`;
  stageBox.style.height = `${Math.round(stage.stageH)}px`;
  if (stageRow) stageRow.style.gap = `${Math.round(stage.gap)}px`;
  setForceRoomRedraw(true); // the room canvas CSS size is set in draw() — repaint to rescale
  wake();
}

// Intro-movie overlay (UMain.pas daLogo/daIntro): full-screen <video> played
// before the map on first run, and replayable from the map's top-left corner.

/**
 * Register the fatal-screen handlers. Call once, from `main.ts`, after the device gate.
 *
 * It took a one-member host until `booted` got an owner in `stageState.ts`; now there is
 * nothing to hand over, only listeners that must not be armed at import time.
 */
export function initLoadingUi(): void {
  document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload());
  // Any unhandled failure DURING boot means the game never became playable → fatal.
  // After boot we stop hijacking errors (a mid-game exception shouldn't nuke play).
  window.addEventListener('unhandledrejection', (ev) => {
    if (!booted) {
      console.error('boot failed:', ev.reason);
      showFatal();
    }
  });
  window.addEventListener('error', (ev) => {
    if (!booted) {
      console.error('boot failed:', ev.error ?? ev.message);
      showFatal();
    }
  });
}
