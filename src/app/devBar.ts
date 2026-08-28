/**
 * The developer bar: the room picker, the fit/renderer/graphics selects, the idle-render
 * toggle and the solve-room button — plus the resize, fullscreen and DPR watchers that keep
 * the stage sized.
 *
 * All of it is dev-only chrome (`body.dev` in CSS) except the relayout triggers, which the
 * game needs whatever mode it is in. It moves as one piece because it is all the same kind
 * of code: reach into the DOM once, wire a listener, and never be thought about again.
 *
 * Two names from `main.ts`, and both are navigation — the room picker is the only control
 * here that changes what the game is doing rather than how it looks.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * Every statement in this file used to run at `main.ts`'s module scope, which is why the
 * whole thing is inside `initDevBar()`: an imported module is evaluated before any
 * statement of its importer, so leaving it at module scope would wire the DOM ahead of
 * everything `main.ts` sequences. See AGENTS.md, "the module-evaluation trap".
 */
import { ROOMS } from '../data/roomTable.js';
import { isFitMode } from './layout.js';
import { devSolveRoom } from './cheats.js';
import { setSolveSpeed, solveStatus } from './solveMode.js';
import { solutionFor } from '../rooms/index.js';
import { fitSelect, graphicsSelect, idleDirtyToggle, rendererSelect, select, solveRoomBtn, solveSpeedSelect, touchSelect } from './dom.js';
import { relayout } from './loadingUi.js';
import { closeMapOverlay } from './mapNav.js';
import { O_NORMAL, O_SC_DOWN, ui } from './screenState.js';
import { settings } from './playerSettings.js';
import { refreshTouchMode } from './touchButtons.js';
import { readTouchOverride, writeTouchOverride } from './touchMode.js';
import { saveSettings } from '../core/settings.js';
import {
  graphics,
  devEnabled,
  renderOnDirty,
  renderer,
  setGraphics,
  setRenderOnDirty,
  setRenderer,
} from './renderSettings.js';
import { wake } from './frameClock.js';
import { setForceRoomRedraw } from './framePacing.js';

/** The two names this module needs from `main.ts`, both of them navigation. */
export interface DevBarHost {
  readonly enterRoom: (num: number) => void;
  readonly showMap: () => void;
}

let host!: DevBarHost;

/** Wire the dev bar and the relayout watchers. Call once, from `main.ts`, during boot. */
export function initDevBar(h: DevBarHost): void {
  host = h;
  function populateRooms(): void {
    const mapOpt = document.createElement('option');
    mapOpt.value = 'map';
    mapOpt.textContent = '🗺  World map';
    select.appendChild(mapOpt);
    for (const r of ROOMS) {
      const opt = document.createElement('option');
      opt.value = String(r.num);
      opt.textContent = `${String(r.num).padStart(2, '0')} — ${r.jmeno} (${r.en})`;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      wake();
      if (select.value === 'map') host.showMap();
      else host.enterRoom(Number(select.value));
    });
  }

  populateRooms();
  select.value = 'map'; // the game opens on the world map, so start the picker there

  // Public-release layout: the visible fit-mode control (localStorage-persisted via
  // settings) + responsive stage scaling on resize / fullscreen.
  if (fitSelect) {
    // A local const, because TypeScript will not carry the null-narrowing of an
    // IMPORTED binding into a closure (an exporting module may reassign it; these
    // never do). Same one-line dance at the four dev-bar controls below.
    const el = fitSelect;
    el.value = settings.fitMode;
    el.addEventListener('change', () => {
      const v = el.value;
      settings.fitMode = isFitMode(v) ? v : 'medium';
      saveSettings(settings);
      setForceRoomRedraw(true); // the fit scale changes the room canvas size — repaint
      relayout(); // the box's width ceiling is per-mode (stageBoxCeiling) — resize it too
      wake();
    });
  }
  // Dev-bar renderer (CPU/WebGL) + idle-FPS-saver toggles. These mirror the state
  // driven by the hidden R hotkey; syncDevControls() keeps their displayed value
  // current after a hotkey toggle.
  if (rendererSelect) {
    const el = rendererSelect;
    el.value = renderer;
    el.addEventListener('change', () => setRenderer(el.value === 'cpu' ? 'cpu' : 'webgl'));
  }
  // Dev-bar graphics-level combobox. Mirrors the E hotkey (setGraphics keeps the
  // select value in sync when E cycles), and is the primary point-and-click switch.
  if (graphicsSelect) {
    const el = graphicsSelect;
    el.value = graphics;
    el.addEventListener('change', () => {
      const v = el.value;
      setGraphics(v === 'classic' || v === 'ai' ? v : 'enhanced');
    });
  }
  // The touch-UI override. Dev chrome, not a player setting — see touchMode.ts for why
  // "which controls do you want" is a question the device already answers. It takes
  // effect immediately rather than on reload: the bar's visibility is derived per frame,
  // so re-reading the mode and relaying out is the whole of it.
  if (touchSelect) {
    const el = touchSelect;
    el.value = readTouchOverride(window);
    el.addEventListener('change', () => {
      const v = el.value;
      writeTouchOverride(window, v === 'on' || v === 'off' ? v : 'auto');
      refreshTouchMode();
      // Put the FAITHFUL Options face back to a known state on the way through. Turning
      // touch on while it is open would strand it: the hand-over in `togglePanelOptions`
      // returns before the branch that scrolls it back down, so nothing could close it
      // until the next room load. This control is the only way that can happen — a real
      // device never changes touch mode mid-session — but the series' invariant is that
      // the two Options are never both on screen, so it is unwound rather than excepted.
      if (ui.mapOverlay === 'options') closeMapOverlay();
      else if (ui.ostav !== O_NORMAL) ui.ostav = O_SC_DOWN;
      relayout();
      wake();
    });
  }
  if (idleDirtyToggle) {
    const el = idleDirtyToggle;
    el.checked = renderOnDirty;
    el.addEventListener('change', () => setRenderOnDirty(el.checked));
  }
  if (solveSpeedSelect) {
    const el = solveSpeedSelect;
    // Persisted, because the whole point is not having to re-pick it on every reload.
    const saved = localStorage.getItem('ff.solveSpeed');
    if (saved && [...el.options].some((o) => o.value === saved)) el.value = saved;
    el.addEventListener('change', () => {
      localStorage.setItem('ff.solveSpeed', el.value);
      setSolveSpeed(Number(el.value)); // take effect mid-run, not just on the next one
      el.blur();
    });
  }
  if (solveRoomBtn) {
    const el = solveRoomBtn;
    el.addEventListener('click', () => {
      const failed = devSolveRoom(solveSpeed());
      // Only ever reachable when the button is enabled, so a failure here is a real
      // surprise and belongs on the button rather than in the console.
      if (failed) el.title = `cannot run: ${failed.detail}`;
      el.blur(); // drop button focus so a Space/Enter dismiss doesn't re-click it
    });
  }
  // Apply the persisted dev-pane state on boot (Ctrl+Alt+D toggles it thereafter).
  document.body.classList.toggle('dev', devEnabled);
  relayout();
  window.addEventListener('resize', relayout);
  document.addEventListener('fullscreenchange', relayout);
  // devicePixelRatio can change without a resize event (moving the window to a
  // monitor of different density). Re-arm a matchMedia watch on each change so
  // 'native' re-snaps to whole physical pixels and stays crisp.
  if (typeof window.matchMedia === 'function') {
    const watchDpr = (): void => {
      window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
        'change',
        () => {
          relayout();
          watchDpr();
        },
        { once: true },
      );
    };
    watchDpr();
  }
}

/** The speed the dev bar is currently set to run a solution replay at. */
function solveSpeed(): number {
  return Number(solveSpeedSelect?.value ?? 1) || 1;
}

/**
 * Reflect the solution replay on its button: whether it can run here, how far it has got,
 * and why it stopped.
 *
 * The disabled state is the honest one — a button that looks live and does nothing is
 * worse than a greyed one — and the reason goes in the tooltip because the two cases are
 * different problems. Today `missing` is only ZAVER #71 and SCORE #72, which are the
 * ending and the results screens rather than puzzles, so there is nothing to go and fix;
 * `undecodable` would mean a recording grew a character the decoder does not know, which
 * is a real bug in one of the two.
 *
 * Called from the render loop only while a run is going, and on room change. It touches
 * the DOM only when a string actually changed, so a 6 045-move run is not 6 045 layout
 * invalidations.
 */
export function syncSolveBtn(): void {
  const el = solveRoomBtn;
  // Cheap enough to call every frame, and it has to be: the button's state has to be able
  // to come BACK from "Solving …, disabled" when a run ends, and a run can end from paths
  // that never touch the dev bar (Escape, a restart, the auto-return after a win). Syncing
  // only while a run existed left it stuck disabled after a cancel, with no way to start
  // another. Nothing below allocates, and the writes are guarded on an actual change.
  if (!el || !document.body.classList.contains('dev')) return;
  const s = solveStatus();
  const jmeno = ROOMS[Number(select.value) - 1]?.jmeno;
  const avail = jmeno ? solutionFor(jmeno) : { known: 'missing' as const };

  let label = 'Solve room';
  let title =
    'Play the room from its recorded solution, live: real speed, fish speak, moves recorded. ' +
    'Stops and says so if anything goes wrong.';
  let disabled = avail.known !== 'ok';
  if (disabled) title = `No recorded solution for ${jmeno ?? 'this room'} — it is not a puzzle, so there is none to record.`;
  if (ui.screen !== 'room') {
    // Stated rather than inherited: there is nothing to solve from the map, and the arming
    // guard would refuse anyway. Being greyed here was previously a side effect.
    disabled = true;
    title = 'Enter a room first.';
  }

  if (s.running) {
    label = `Solving ${s.idx}/${s.total}${s.speed > 1 ? ` (${s.speed}x)` : ''}`;
    title = `Playing ${s.jmeno}'s recorded solution — press Escape to stop.`;
    disabled = true;
  } else if (s.abort) {
    // `at` is a 0-based index for the move-shaped aborts, and +1 makes it the human "move
    // N of M". `exhausted` is the exception: it has no failing move — every move was
    // played — so `at` is already the total, and +1 rendered it as "534/533".
    const at = s.abort.reason === 'exhausted' ? s.abort.of : s.abort.at + 1;
    label = `✗ ${s.abort.reason} @ ${at}/${s.abort.of}`;
    title = `${s.jmeno}: ${s.abort.detail}`;
  } else if (s.won) {
    label = `✓ solved in ${s.total}`;
    title = `${s.jmeno} played its recorded solution to a win.`;
  }

  if (el.textContent !== label) el.textContent = label;
  if (el.title !== title) el.title = title;
  if (el.disabled !== disabled) el.disabled = disabled;
}
