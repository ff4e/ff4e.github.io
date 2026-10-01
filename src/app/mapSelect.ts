/**
 * The world map played with a controller: one selected target, moved by the stick.
 *
 * A pointer clicks a room node or a corner button. A controller has nothing to point
 * with, so the map keeps a selection at all times — a room node or a corner — and Ⓐ does
 * to it exactly what a click would. The selection is shown with the map's OWN hover
 * feedback (the corner lights up, the room's name plaque appears) plus a ring round a
 * selected node, because a node has no hover art of its own (`mapDraw.ts`).
 *
 *   stick / d-pad   move to the nearest target that way (`render/mapSelection.ts`)
 *   Ⓐ               open it: a solved room's record panel, an unsolved room, a corner
 *   Ⓑ               close the record panel; on the plain map it does nothing
 *   ☰               Options
 *
 * Ⓑ on the plain map is deliberately NOT the keyboard's Escape, which resumes the loaded
 * room. Ⓑ is the button a controller player presses to back out of anything, so it gets
 * pressed on the map too, and resuming would drop them into whichever room happened to be
 * loaded — including one they have not reached. The last-played room is the default
 * selection instead, so resuming it is still one press: Ⓐ.
 *
 * The record panel's buttons live here too (`activateInfoButton`), for the pointer as well
 * as the controller: one place decides what Run / Replay / Cancel do, and the two inputs
 * only decide which of them was pressed.
 */
import { DirRepeat, type PadSnapshot } from '../platform/gamepad.js';
import { cornerCentroids, nearestInDirection, nodeCenter, selectableNodes, type MapTarget } from '../render/mapSelection.js';
import type { InfoButton } from '../render/mapInfo.js';
import type { WorldMap } from '../render/worldMap.js';
import { curNum } from './art.js';
import { closeMapInfo, openMapInfo } from './mapDraw.js';
import { closeMapOverlay, dispatchMapCorner, openMapOptions, showLegImage } from './mapNav.js';
import { hapticTap } from '../platform/haptics.js';
import { branchOfRoom, depthOfRoom } from '../data/world.js';
import { mapLaunching } from './roomLaunch.js';
import { ui } from './screenState.js';
import { wake } from './frameClock.js';

/** The names this module needs from `main.ts`: the player's record, and entering a room. */
export interface MapSelectHost {
  readonly solved: ReadonlySet<number>;
  readonly cheated: ReadonlySet<number>;
  readonly bestRecord: (room: number) => string | undefined;
  readonly enterRoom: (room: number, replay?: string) => void;
}

let host!: MapSelectHost;
let sel: MapTarget | null = null;
const repeat = new DirRepeat();
const corners = new WeakMap<WorldMap, MapTarget[]>();
const INFO_ORDER: readonly InfoButton[] = ['run', 'replay', 'cancel'];

export function initMapSelect(h: MapSelectHost): void {
  host = h;
}

function targets(): MapTarget[] {
  const wm = ui.worldMap;
  if (!wm) return [];
  let cs = corners.get(wm);
  if (!cs) {
    cs = cornerCentroids((x, y) => wm.cornerAction(x, y));
    corners.set(wm, cs);
  }
  return [...selectableNodes(host.solved, host.cheated), ...cs];
}

function same(a: MapTarget, b: MapTarget): boolean {
  return a.kind === 'node' ? b.kind === 'node' && a.room === b.room : b.kind === 'corner' && a.action === b.action;
}

/** Mirror the selection onto the hover state the map already draws. */
function show(): void {
  ui.mapHoverCorner = sel?.kind === 'corner' ? sel.action : null;
  ui.mapHoverRoom = sel?.kind === 'node' ? sel.room : null;
  ui.mapSelectRoom = sel?.kind === 'node' ? sel.room : null;
  wake();
}

/** The room just played if it is still selectable, else the first room not yet solved. */
function defaultTarget(all: MapTarget[]): MapTarget | null {
  const nodes = all.filter((t): t is Extract<MapTarget, { kind: 'node' }> => t.kind === 'node');
  return (
    nodes.find((t) => t.room === curNum) ??
    nodes.find((t) => !host.solved.has(t.room) && !host.cheated.has(t.room)) ??
    all[0] ??
    null
  );
}

/**
 * Keep the selection in step with the screen. Called every frame while a controller is
 * driving the UI: it puts a selection up on arrival (so the map never shows nothing
 * selected) and takes the ring down on the way out.
 */
export function syncMapSelect(active: boolean): void {
  if (!active || ui.screen !== 'map' || !ui.worldMap) {
    if (sel !== null || ui.mapSelectRoom !== null) {
      sel = null;
      ui.mapSelectRoom = null;
    }
    return;
  }
  const all = targets();
  if (sel === null || !all.some((t) => same(t, sel!))) {
    sel = defaultTarget(all);
    show();
  }
}

function activate(): void {
  if (!sel) return;
  if (sel.kind === 'node') {
    const room = sel.room;
    if (host.solved.has(room) || host.cheated.has(room)) openMapInfo(room);
    else host.enterRoom(room);
  } else {
    dispatchMapCorner(sel.action);
  }
}

/**
 * Press a record-panel button (Run / Replay / Cancel) for `room` — or, with `btn` null,
 * a click off the panel. Shared by the pointer (`main.ts` clickMapAt) and the
 * controller (below), so both reach the same daRun / daReplay / daCancel.
 */
export function activateInfoButton(room: number, btn: InfoButton | null): void {
  if (btn === 'run') {
    hapticTap();
    closeMapInfo();
    // Delphi: Run on a solved depth-15 room shows the leg story page first, then
    // launches once dismissed (daClickAndRun, UMain.pas:958→966).
    const leg = host.solved.has(room) && depthOfRoom(room) === 15 ? branchOfRoom(room) : 0;
    if (leg >= 1 && leg <= 8) void showLegImage(leg, { room });
    else host.enterRoom(room); // daRealyRun: play the room
  } else if (btn === 'replay') {
    const rec = host.bestRecord(room);
    if (rec !== undefined) {
      hapticTap();
      closeMapInfo();
      // Same story-page-first deferral for Replay (daReplay, UMain.pas:1030).
      const leg = host.solved.has(room) && depthOfRoom(room) === 15 ? branchOfRoom(room) : 0;
      if (leg >= 1 && leg <= 8) void showLegImage(leg, { room, replay: rec });
      else host.enterRoom(room, rec); // daReplay: animate the best solution
    }
    // no stored record → Replay is disabled; ignore the click (panel stays open)
  } else {
    if (btn === 'cancel') hapticTap(); // a click off the panel pressed no button
    closeMapInfo(); // Cancel button, or a click off the panel
  }
}

/** The record panel's Run / Replay / Cancel, chosen left and right. */
function handleInfoPanel(pad: PadSnapshot, now: number, room: number): void {
  if (pad.pressed('b')) {
    closeMapInfo();
    wake();
    return;
  }
  const usable = INFO_ORDER.filter((b) => b !== 'replay' || host.bestRecord(room) !== undefined);
  if (ui.mapInfoHover === null || !usable.includes(ui.mapInfoHover)) {
    ui.mapInfoHover = usable[0]!;
    ui.mapSig = null;
    wake();
  }
  const step = repeat.step(pad.leftDir ?? pad.rightDir, now);
  if (step === 'left' || step === 'right') {
    const i = usable.indexOf(ui.mapInfoHover);
    ui.mapInfoHover = usable[(i + (step === 'right' ? 1 : usable.length - 1)) % usable.length]!;
    ui.mapSig = null;
    wake();
  }
  if (pad.pressed('a')) activateInfoButton(room, ui.mapInfoHover);
}

/** One poll of controller input on the world map. */
export function handleMapPad(pad: PadSnapshot, now: number): void {
  if (mapLaunching() !== null) return; // the launch is blocking, as for every other input
  // The faithful Options face over the map (off a TV, where Options is not the HTML one).
  // It is modal, as it is to a click: nothing behind it may be selected or launched, and
  // Ⓑ / ☰ take it down the way Escape does.
  if (ui.mapOverlay === 'options') {
    if (pad.pressed('b') || pad.pressed('menu')) {
      closeMapOverlay();
      wake();
    }
    return;
  }
  if (ui.mapInfoRoom !== null) {
    handleInfoPanel(pad, now, ui.mapInfoRoom);
    return;
  }
  if (pad.pressed('menu')) {
    openMapOptions();
    wake();
    return;
  }
  const step = repeat.step(pad.leftDir ?? pad.rightDir, now);
  if (step && sel) {
    const from = sel.kind === 'node' ? nodeCenter(sel.room) : sel;
    const next = nearestInDirection(from, targets(), step);
    if (next) {
      sel = next;
      show();
    }
  }
  if (pad.pressed('a')) activate();
}
