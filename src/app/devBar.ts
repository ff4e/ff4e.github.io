/**
 * The developer bar: the room picker, the fit/renderer/graphics selects, the idle-render
 * toggle and the win-room button — plus the resize, fullscreen and DPR watchers that keep
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
 * statement of its importer, so leaving it at module scope would wire the DOM ahead of the
 * device gate. See AGENTS.md, "the module-evaluation trap".
 */
import { ROOMS } from '../data/roomTable.js';
import { isFitMode } from './layout.js';
import { devWinRoom } from './cheats.js';
import { fitSelect, graphicsSelect, idleDirtyToggle, rendererSelect, select, winRoomBtn } from './dom.js';
import { relayout } from './loadingUi.js';
import { settings } from './playerSettings.js';
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
  if (idleDirtyToggle) {
    const el = idleDirtyToggle;
    el.checked = renderOnDirty;
    el.addEventListener('change', () => setRenderOnDirty(el.checked));
  }
  if (winRoomBtn) {
    const el = winRoomBtn;
    el.addEventListener('click', () => {
      devWinRoom();
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
