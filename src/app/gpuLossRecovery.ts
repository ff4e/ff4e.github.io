/**
 * Recovering from the loss of the browser's GPU process: the black screen a player found
 * on coming back to the iOS app after it had been in the background for a while.
 *
 * ── What happens ─────────────────────────────────────────────────────────────
 * WebKit draws canvases in a separate GPU process, and iOS may kill that process while
 * the app is in the background. Reproduced in the iPhone 17 Pro simulator (iOS 26.5) by
 * killing `com.apple.WebKit.GPU`: every canvas and every ImageBitmap the page holds reads
 * back as transparent black afterwards, whether accelerated or `willReadFrequently`. That
 * is all of the decoded art (the `ai` tier's ImageBitmaps, the cached composites, the
 * map), not only the WebGL context. New drawing works, so the page carries on running and
 * repaints, but from empty sources. The room or the map stays black between side panels.
 * That is the screenshot from the report, reproduced exactly.
 *
 * WebKit says almost nothing about it. A WebGL context gets `webglcontextlost` and then
 * `webglcontextrestored` about 0.4 s later (glPlumbing.ts falls back to the CPU path,
 * which only draws the same empty art). A 2D canvas fires no `contextlost` at all, and a
 * page that never made a WebGL context hears nothing. So the loss is DETECTED here: a
 * 1x1 canvas is painted opaque at boot and read back whenever the page comes back on
 * screen. If its alpha is zero, everything else was wiped with it.
 *
 * ── Why a reload, and what it keeps ──────────────────────────────────────────
 * Rebuilding the art in place would mean finding and refilling every cache of decoded
 * images (about a dozen modules decode some), and any one missed would stay black. A
 * reload refills all of them by construction. What it would lose is the attempt in
 * progress, so that goes into sessionStorage first, in the same shape as a save slot
 * (record, script variables, undo history), and boot puts the player back into the room
 * with it (`takeGpuLossResume` / `resumeAfterGpuLoss`). Anywhere other than a room, the
 * reload lands on the map, which is where it would have gone anyway.
 *
 * A loss that recurs within `RECOVERY_COOLDOWN_MS` of the last recovery is logged rather
 * than reloaded again, so nothing here can turn into a reload loop.
 *
 * Module scope is side-effect-free; `initGpuLossRecovery()` is called by boot.
 */
import { curNum } from './art.js';
import { inShowmode } from './cutscene.js';
import { glCanvas } from './dom.js';
import { activeScript, engine, loadmode, replaymode, room } from './gameState.js';
import {
  RECOVERED_AT_KEY,
  RESUME_KEY,
  decodeResume,
  encodeResume,
  mayRecover,
  sentinelWiped,
  type GpuLossResume,
} from './gpuLoss.js';
import { focusRestoredFish, restore } from './movement.js';
import { ui } from './screenState.js';
import { inSolvemode } from './solveMode.js';
import { loadUndoHistory, undoHistoryForSave } from './undo.js';
import type { ScriptSnapshot } from '../core/script.js';

let sentinel: CanvasRenderingContext2D | null = null;
let reloading = false;

function readSentinel(g: CanvasRenderingContext2D): Uint8ClampedArray | null {
  try {
    return g.getImageData(0, 0, 1, 1).data;
  } catch {
    return null;
  }
}

/** Paint the sentinel and start watching for the loss. Called once, at the end of boot. */
export function initGpuLossRecovery(): void {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = '#123456';
  g.fillRect(0, 0, 1, 1);
  // A browser whose canvas cannot be read back faithfully right now never will be, and
  // acting on its reads would reload for nothing. Such a page simply goes unwatched.
  if (readSentinel(g)?.[3] !== 255) return;
  sentinel = g;
  // Checked twice: the page can be told it is visible before WebKit has noticed that
  // its GPU process is gone.
  const checkSoon = (): void => {
    checkGpuLoss();
    setTimeout(checkGpuLoss, 1000);
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkSoon();
  });
  // The loss can also happen on screen. A WebGL context is the one thing that reports it.
  glCanvas.addEventListener('webglcontextlost', checkSoon);
}

/** Whether the sentinel is armed — read by the `__ff` hook. */
export function gpuLossArmed(): boolean {
  return sentinel !== null;
}

/** Test-only: wipe the sentinel the way a lost GPU process does. */
export function wipeGpuLossSentinel(): void {
  sentinel?.clearRect(0, 0, 1, 1);
}

/** Read the sentinel; on a loss, hand the attempt over and reload. Returns whether it did. */
export function checkGpuLoss(): boolean {
  if (!sentinel || reloading) return false;
  const px = readSentinel(sentinel);
  if (!px || !sentinelWiped(px)) return false;
  let lastAt: number | null = null;
  try {
    const raw = sessionStorage.getItem(RECOVERED_AT_KEY);
    lastAt = raw === null ? null : Number(raw);
  } catch {
    /* storage unavailable: nothing to compare against */
  }
  const now = Date.now();
  if (!mayRecover(now, lastAt)) {
    console.warn('[ff] the GPU process was lost again right after a recovery; not reloading a second time');
    sentinel = null;
    return false;
  }
  try {
    sessionStorage.setItem(RECOVERED_AT_KEY, String(now));
    const resume = captureResume();
    if (resume) sessionStorage.setItem(RESUME_KEY, encodeResume(resume));
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    /* storage unavailable: still reload, the picture matters more than the attempt */
  }
  console.warn('[ff] the GPU process was lost and took the decoded art with it; reloading');
  reloading = true;
  location.reload();
  return true;
}

/**
 * What the reload must restore, or null to land on the map.
 *
 * The attempt is only carried over when a save would be allowed to take it (`canSave`)
 * and nothing is replaying a record of its own. In those other cases, such as a dead
 * fish or the briefcase demonstration, the room starts again from the beginning.
 */
function captureResume(): GpuLossResume | null {
  if (ui.screen !== 'room' || !room || !engine || curNum < 1 || room.won) return null;
  const replaying = inShowmode() || inSolvemode() || replaymode !== null || loadmode !== null;
  if (replaying || !room.canSave) return { room: curNum, rec: '', vars: null, undo: null, active: null };
  return {
    room: curNum,
    rec: engine.srecord,
    vars: activeScript?.s.snapshot() ?? null,
    undo: undoHistoryForSave(),
    active: engine.active,
  };
}

/** The hand-over left by a recovery reload, removed as it is read so it applies once. */
export function takeGpuLossResume(): GpuLossResume | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return decodeResume(raw);
  } catch {
    return null;
  }
}

/**
 * Enter the room and replay the attempt into it, the same way undo does: the instant
 * replay, so the player finds the room exactly as they left it rather than watching
 * the fish race back to their places.
 */
export function resumeAfterGpuLoss(r: GpuLossResume, enterRoom: (num: number) => Promise<void>): void {
  void enterRoom(r.room).then(() => {
    if (!r.rec || ui.screen !== 'room' || curNum !== r.room) return;
    loadUndoHistory(r.undo);
    restore(r.rec, r.vars as ScriptSnapshot | null, false, false);
    if (r.active) focusRestoredFish(r.active);
  });
}
