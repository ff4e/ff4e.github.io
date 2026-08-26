/**
 * The "turn your phone" prompt: one overlay, derived from the frame loop.
 *
 * ── Why derived rather than pushed ───────────────────────────────────────────
 * Exactly the reasoning `loadingUi.ts` gives for its own overlay, and for the same
 * reward. What the prompt shows depends on three things that change independently — the
 * device's orientation, which screen is up, and which room is loaded — and pushing would
 * mean an update call at every one of those sites, with a missed one leaving the prompt
 * stuck over a game the player can no longer reach. Read once per frame it cannot go
 * stale, and it needs no wiring anywhere: `renderLoop` calls it beside `syncLoadingUi`.
 *
 * ── What it costs to run every frame ─────────────────────────────────────────
 * Two `window` reads and, in a room, the room's native size. The device class is NOT
 * re-derived per frame — `matchMedia` is the expensive part and the answer cannot change
 * within a session — so it is resolved once, lazily, on the first frame. DOM writes are
 * guarded on a change of state, so the steady case (desktop, every frame, for ever) is a
 * class comparison that leaves immediately.
 *
 * ── What it deliberately does not do ─────────────────────────────────────────
 * It does not pause the game. The overlay covers the screen, and on a phone there is no
 * input reaching the game behind it that is not the touch layer this prompt is part of,
 * so a pause would only add a state the rest of the code would have to know about. It
 * also never fires on a desktop or a tablet: `rotationDemand` refuses to demand anything
 * of a device that is not a phone, so the desktop path here is a single early return.
 */
import { deviceClass, type DeviceClass } from './deviceGate.js';
import { rotationDemand, type Orientation, type RotationDemand } from './orientation.js';
import { room } from './gameState.js';
import { roomScreenSize } from '../render/renderRoom.js';
import { ui } from './screenState.js';

/**
 * The world map's native size (`layout.ts`), and the stand-in for every screen that is
 * not a room — the map, the intro, a cutscene, the leg image. All of them are landscape
 * and none of them varies per room, so one landscape-shaped constant answers for the lot
 * rather than four special cases that would all say the same thing.
 */
const NON_ROOM_CONTENT = { w: 640, h: 480 };

/** Resolved once: `matchMedia` is not cheap and the answer cannot change mid-session. */
let cls: DeviceClass | null = null;

/** Last state written to the DOM, so a steady prompt is not rewritten 60 times a second. */
let shown: RotationDemand = 'ok';

/** What the player is asked, per direction. Kept short: it is read at arm's length. */
const COPY: Record<Orientation, { title: string; msg: string }> = {
  portrait: {
    title: 'Turn your phone upright',
    msg: 'This room is taller than it is wide — it needs the long side of your screen going up.',
  },
  landscape: {
    title: 'Turn your phone sideways',
    msg: 'Fish Fillets is played the wide way round.',
  },
};

/** The content the CURRENT screen is drawing, in native px. */
function contentSize(): { w: number; h: number } {
  if (ui.screen === 'room' && room) {
    const { w, h } = roomScreenSize(room);
    return { w, h };
  }
  return NON_ROOM_CONTENT;
}

/**
 * Put the prompt up, take it down, or leave it exactly as it is.
 *
 * Called from the frame loop after the frame is painted, like `syncLoadingUi` — so the
 * overlay is only ever hidden over a screen that has already been drawn.
 */
export function syncRotatePrompt(): void {
  if (typeof window === 'undefined') return;
  cls ??= deviceClass(window);
  // The overwhelmingly common case, and the reason the class is cached: a desktop pays
  // one comparison per frame, for ever.
  if (cls !== 'phone' && shown === 'ok') return;
  const { w, h } = contentSize();
  const want = rotationDemand({
    device: cls,
    contentW: w,
    contentH: h,
    viewW: window.innerWidth,
    viewH: window.innerHeight,
  });
  if (want === shown) return;
  shown = want;
  const el = document.getElementById('rotate');
  if (!el) return;
  if (want === 'ok') {
    el.hidden = true;
    delete document.documentElement.dataset.rotate;
    return;
  }
  const t = document.getElementById('rotate-title');
  const m = document.getElementById('rotate-msg');
  if (t) t.textContent = COPY[want].title;
  if (m) m.textContent = COPY[want].msg;
  el.hidden = false;
  // Read by BOTH the stylesheet and the probe, mirroring `data-unsupported`. The
  // stylesheet picks which way the phone glyph turns from it — the two directions are
  // different animations, because the glyph is drawn tall — and the attribute survives
  // even if the markup above is missing, so a test cannot pass by finding nothing.
  document.documentElement.dataset.rotate = want;
}
