/**
 * The world map, natively: the screen a session starts on and comes back to after a room,
 * played with a controller, a TV remote's d-pad or a keyboard (the controller spec's A3
 * "World map" and "Record panel"). The leg story pages shown on the way in and out of a
 * leg-final room are here too, because they sit over the map.
 *
 * The picture is the browser's, from the same painter (`paintAiMap`,
 * src/render/mapPaintAi.ts) on the native Surface2D — native/compare-map.mjs holds the two
 * to the byte. What is native is what replaces the pointer:
 *
 *   - a selection always exists — a room node a click could reach — and is shown with the
 *     node's name plaque, as the pointer's hover shows it, plus a ring (`selectRoom`);
 *   - a direction moves it to the nearest target that way (src/render/mapSelection.ts),
 *     first step at once, then a repeat after 340 ms and every 140 ms while held;
 *   - Ⓐ opens it: a solved or cheated room's record panel, an unsolved room's launch;
 *   - in the record panel, left/right cycle Run → Replay → Cancel (Replay skipped with no
 *     record), Ⓐ presses, Ⓑ closes;
 *   - Ⓑ on the plain map does nothing, on purpose: it is the button that gets mashed to back
 *     out of things, and must not drop the player into a room.
 *
 * The default selection is the room last played if it can still be selected, else the
 * first room not yet solved — so resuming is one press of Ⓐ.
 *
 * The corner buttons (Intro, Credits, Options, Exit) are not selectable yet: none of their
 * screens exists natively, and a target that does nothing is worse than none. They join
 * `NATIVE_CORNERS` as their screens arrive; the geometry already handles them.
 *
 * The host (native/host/main.c) turns the gamepad into key codes, so this reads one stream:
 * IJKL (d-pad, left stick), WASD (right stick) and the arrows are directions; Space (Ⓐ) and
 * Enter press; Escape (Ⓑ) backs out.
 */
import { INFO_FAZE_MS, INFO_SETTLE_FAZE, type InfoButton } from '../../src/render/mapInfo.js';
import { paintAiMap } from '../../src/render/mapPaintAi.js';
import {
  cornerCentroids, nearestInDirection, nodeCenter, selectableNodes, type MapStep, type MapTarget,
} from '../../src/render/mapSelection.js';
import { MAP_H, MAP_W, type MapAction } from '../../src/render/worldMap.js';
import { AI_MAP_H, AI_MAP_W } from '../../src/render/worldMapAi.js';
import { branchOfRoom, depthOfRoom } from '../../src/data/world.js';
import { ui } from '../../src/app/screenState.js';
import { subLang } from './seams/playerSettings.js';
import { loadAiPlaque, loadMapArt, paintParchmentAi, type MapArt, type MapIo } from './mapArt.js';
import { NativeSurface, decodeImage, type NativeImage } from './nativeSurface.js';
import { readBytes } from './shims.js';
import { DirRepeat } from './dirRepeat.js';

/** What the map needs of the game: the player's record, and the way into a room. */
export interface MapScreenHost {
  readonly solved: ReadonlySet<number>;
  readonly cheated: ReadonlySet<number>;
  readonly scores: ReadonlyMap<number, number>;
  readonly bestRecord: (room: number) => string | undefined;
  /** daRealyRun / daReplay: enter `room`, replaying `replay` when given. */
  readonly enterRoom: (room: number, replay?: string) => void;
  /** Run / Replay of a solved leg-final room shows the leg's story page first. */
  readonly showLegImage: (leg: number, pending: { room: number; replay?: string }) => void;
  /** Any button on a story page: what dismissing it does. */
  readonly dismissLegImage: () => void;
  /** The room last played (0 for none), for the default selection. */
  readonly lastRoom: () => number;
}

/** The corner buttons a native host can act on. None yet: see the header. */
const NATIVE_CORNERS: readonly MapAction[] = [];

const DIRS: Readonly<Record<string, MapStep>> = {
  KeyI: 'up', KeyK: 'down', KeyJ: 'left', KeyL: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};
const PRESS = new Set(['Space', 'Enter', 'NumpadEnter']);
const INFO_ORDER: readonly InfoButton[] = ['run', 'replay', 'cancel'];

const io: MapIo = {
  bytes: readBytes,
  image: async (url) => decodeImage((await readBytes(url)).slice().buffer),
};

let host!: MapScreenHost;
let art: MapArt | null = null;
let artLoad: Promise<void> | null = null;
let screen: NativeSurface | null = null;
let layer: NativeSurface | null = null;
let corners: MapTarget[] | null = null;
let sel: MapTarget | null = null;
/** Direction keys held, oldest first: the last one pressed and still held steers. */
const held: string[] = [];
const repeat = new DirRepeat<MapStep>();
/** A launch: painted once with the parchment, then the room is entered under it. */
let launch: { room: number; replay?: string | undefined } | null = null;
let legPage: { img: NativeImage; surface: NativeSurface | null } | null = null;

/** Upscaled plaques, decoded on demand and bounded as the browser's are (mapDraw.ts). */
const plaques = new Map<number, Awaited<ReturnType<typeof loadAiPlaque>>>();
const plaqueLoading = new Set<number>();
const PLAQUE_CACHE_MAX = 12;

export function initMapScreen(h: MapScreenHost): void {
  host = h;
}

/** Load the map's art (once). The map paints nothing until it has landed. */
export function ensureMapArt(): Promise<void> {
  return (artLoad ??= loadMapArt(io, subLang()).then((a) => {
    art = a;
  }));
}

/** The map has just come up (`showMap`): pick the selection afresh, drop held input. */
export function mapArrived(): void {
  sel = null;
  launch = null;
  held.length = 0;
  repeat.step(null, 0);
  ui.mapInfoRoom = null;
  ui.mapInfoHover = null;
  void ensureMapArt();
}

function targets(): MapTarget[] {
  if (!art) return [];
  const wm = art.worldMap;
  corners ??= cornerCentroids((x, y) => wm.cornerAction(x, y)).filter(
    (c) => c.kind === 'corner' && NATIVE_CORNERS.includes(c.action),
  );
  return [...selectableNodes(host.solved, host.cheated), ...corners];
}

function same(a: MapTarget, b: MapTarget): boolean {
  return a.kind === 'node' ? b.kind === 'node' && a.room === b.room : b.kind === 'corner' && a.action === b.action;
}

/** The room last played if it is still selectable, else the first room not yet solved. */
function defaultTarget(all: MapTarget[]): MapTarget | null {
  const nodes = all.filter((t): t is Extract<MapTarget, { kind: 'node' }> => t.kind === 'node');
  const last = host.lastRoom();
  return (
    nodes.find((t) => t.room === last) ??
    nodes.find((t) => !host.solved.has(t.room) && !host.cheated.has(t.room)) ??
    all[0] ??
    null
  );
}

/** Keep a selection up, and mirror it onto the hover state the map draws (plaque, corner art). */
function syncSelection(): void {
  const all = targets();
  if (sel === null || !all.some((t) => same(t, sel!))) sel = defaultTarget(all);
  ui.mapHoverCorner = sel?.kind === 'corner' ? sel.action : null;
  ui.mapHoverRoom = sel?.kind === 'node' ? sel.room : null;
}

/**
 * Open the record panel (daInfo, UMain.pas:1008). One deliberate difference from the
 * browser's: the hover starts on Run rather than on nothing, because a controller has no
 * pointer to put it anywhere — the controller spec's record panel always has a highlighted
 * button (#165's mapSelect.ts does the same).
 * restates src/app/mapDraw.ts `export function openMapInfo(` @ c05f081eae9a
 */
function openMapInfo(room: number): void {
  ui.mapInfoRoom = room;
  ui.mapInfoHover = usableButtons(room)[0]!;
  ui.mapInfoFaze = 0; // InfoFaze := 0 — restart the odometer roll
  ui.mapInfoOpenAt = performance.now();
}

/**
 * Close the record panel (daCancel, UMain.pas:1018). The repaint invalidation the browser's
 * does has no counterpart: the native map is painted every frame.
 * restates src/app/mapDraw.ts `export function closeMapInfo(` @ 3299a0b72470
 */
function closeMapInfo(): void {
  ui.mapInfoRoom = null;
  ui.mapInfoHover = null;
}

function usableButtons(room: number): InfoButton[] {
  return INFO_ORDER.filter((b) => b !== 'replay' || host.bestRecord(room) !== undefined);
}

/**
 * Press a record-panel button (Run / Replay / Cancel) for `room`: daRun, daReplay, daCancel.
 * A Run or Replay of a solved depth-15 room shows the leg's story page first
 * (daClickAndRun, UMain.pas:958→966, and :1030).
 * restates src/app/main.ts `function clickMapAt(` @ 1005c9d2ed20
 */
function activateInfoButton(room: number, btn: InfoButton | null): void {
  if (btn === 'run' || btn === 'replay') {
    const rec = btn === 'replay' ? host.bestRecord(room) : undefined;
    if (btn === 'replay' && rec === undefined) return; // Replay is disabled: the panel stays open
    closeMapInfo();
    const leg = host.solved.has(room) && depthOfRoom(room) === 15 ? branchOfRoom(room) : 0;
    if (leg >= 1 && leg <= 8) host.showLegImage(leg, rec === undefined ? { room } : { room, replay: rec });
    else launch = { room, replay: rec };
    return;
  }
  closeMapInfo();
}

function move(step: MapStep): void {
  const room = ui.mapInfoRoom;
  if (room !== null) {
    if (step !== 'left' && step !== 'right') return;
    const usable = usableButtons(room);
    const i = Math.max(0, usable.indexOf(ui.mapInfoHover ?? 'run'));
    ui.mapInfoHover = usable[(i + (step === 'right' ? 1 : usable.length - 1)) % usable.length]!;
    return;
  }
  if (!sel) return;
  const next = nearestInDirection(sel.kind === 'node' ? nodeCenter(sel.room) : sel, targets(), step);
  if (next) sel = next;
}

function press(): void {
  if (ui.mapInfoRoom !== null) {
    activateInfoButton(ui.mapInfoRoom, ui.mapInfoHover);
    return;
  }
  if (sel?.kind !== 'node') return; // no corner acts natively yet
  if (host.solved.has(sel.room) || host.cheated.has(sel.room)) openMapInfo(sel.room);
  else launch = { room: sel.room };
}

function steer(now: number): void {
  const code = held[held.length - 1];
  const step = repeat.step(code ? DIRS[code]! : null, now);
  if (step) move(step);
}

/** A key went down while the map or a story page is up. */
export function mapKeyDown(code: string): void {
  if (ui.screen === 'legimage') {
    host.dismissLegImage(); // any button continues
    return;
  }
  if (launch || !art) return; // a launch blocks input, as on the web
  syncSelection();
  if (DIRS[code]) {
    const i = held.indexOf(code);
    if (i >= 0) held.splice(i, 1);
    held.push(code);
    steer(performance.now()); // the first step on the press itself, not on the next frame
  } else if (PRESS.has(code)) {
    press();
  } else if (code === 'Escape' && ui.mapInfoRoom !== null) {
    closeMapInfo(); // daCancel; on the plain map Ⓑ does nothing
  }
}

export function mapKeyUp(code: string): void {
  const i = held.indexOf(code);
  if (i < 0) return;
  held.splice(i, 1);
  steer(performance.now());
}

/** Focus lost: a held direction's release will never arrive. */
export function mapBlur(): void {
  held.length = 0;
  repeat.step(null, 0);
}

function plaqueFor(room: number): Awaited<ReturnType<typeof loadAiPlaque>> {
  const hit = plaques.get(room);
  if (hit !== undefined) {
    plaques.delete(room); // most recently used goes last
    plaques.set(room, hit);
    return hit;
  }
  if (art && !plaqueLoading.has(room)) {
    plaqueLoading.add(room);
    void loadAiPlaque(io, art, room, subLang())
      .catch((e: unknown) => {
        console.warn(`the AI plaque for room ${room} did not load; the 640×480 one stands in`, e);
        return null;
      })
      .then((p) => {
        plaques.set(room, p);
        while (plaques.size > PLAQUE_CACHE_MAX) {
          const [oldest, old] = plaques.entries().next().value!;
          if (old) __native.releaseTexture((old.img as NativeImage).id);
          plaques.delete(oldest);
        }
      })
      .finally(() => plaqueLoading.delete(room));
  }
  return null; // the native-resolution plaque meanwhile, as in the browser
}

/** Open the AI story page for `leg`; false when it cannot be shown. */
export async function openLegPage(leg: number): Promise<boolean> {
  try {
    legPage = { img: decodeImage((await readBytes(`/enhanced-ai/_story/leg${leg}.webp`)).slice().buffer), surface: null };
  } catch (e) {
    console.warn(`the story page for leg ${leg} did not load; going on without it`, e);
    return false;
  }
  ui.screen = 'legimage';
  return true;
}

export function closeLegPage(): void {
  if (legPage) __native.releaseTexture(legPage.img.id);
  legPage = null;
}

/**
 * One frame of the map (or the story page over it): steer and paint. Returns the surface to
 * present, or null when there is nothing to show yet; the caller presents it, so that its
 * frame-time measurement leaves out the wait for vsync.
 */
export function mapFrame(now: number): NativeSurface | null {
  if (ui.screen === 'legimage') {
    if (!legPage) return null;
    if (!legPage.surface) {
      legPage.surface = new NativeSurface(legPage.img.width, legPage.img.height);
      legPage.surface.setSmoothing(false);
      legPage.surface.drawImage(legPage.img, 0, 0);
    }
    return legPage.surface;
  }
  if (!art) return null;
  syncSelection();
  if (!launch) steer(now);
  // The odometer rolls on wall-clock time, one faze per INFO_FAZE_MS.
  // restates src/app/renderLoop.ts `if (ui.mapInfoRoom !== null && ui.mapInfoFaze < INFO_SETTLE_FAZE) {` @ 1653a8adf9d4
  if (ui.mapInfoRoom !== null && ui.mapInfoFaze < INFO_SETTLE_FAZE) {
    ui.mapInfoFaze = Math.min(Math.floor((now - ui.mapInfoOpenAt) / INFO_FAZE_MS), INFO_SETTLE_FAZE);
  }
  const room = ui.mapInfoRoom;
  const launching = launch?.room ?? null;
  const plaqueRoom = launching ?? room ?? ui.mapHoverRoom;
  const a = art;
  screen ??= new NativeSurface(AI_MAP_W, AI_MAP_H);
  paintAiMap(screen, {
    map: a.ai,
    worldMap: a.worldMap,
    solved: host.solved,
    cheated: host.cheated,
    // kPul's ~140 ms pulse, and the reveal from Depth -3, +1 per ~60 ms (mapDraw.ts).
    pulse: Math.floor(now / 140),
    depth: Math.floor((now - ui.mapRevealStart) / 60) - 3,
    hoverCorner: ui.mapHoverCorner,
    unlit: room !== null || launching !== null,
    zoom: 1,
    plaqueRoom,
    aiPlaque: plaqueRoom !== null ? plaqueFor(plaqueRoom) : null,
    desky: a.desky,
    assets: a.assets,
    panel: room === null ? null : {
      room,
      count: host.scores.get(room) ?? null,
      hover: ui.mapInfoHover,
      faze: ui.mapInfoFaze,
      replayEnabled: host.bestRecord(room) !== undefined,
    },
    minigame: null,
    layer: () => (layer ??= new NativeSurface(MAP_W, MAP_H)),
    parchment: launching !== null ? (t) => paintParchmentAi(t, a) : null,
    selectRoom: ui.mapHoverRoom,
  });
  return screen;
}

/**
 * After the frame is presented. daRun -> daRealyRun: the frame carrying the parchment is
 * on screen, so the load starts, and it stays there until the room's first frame replaces
 * it (roomLaunch.ts).
 */
export function mapPresented(): void {
  if (!launch) return;
  const l = launch;
  launch = null;
  host.enterRoom(l.room, l.replay);
}
