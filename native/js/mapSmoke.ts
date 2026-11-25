/**
 * The map smoke gate: the native world map driven the way a player drives it — input events
 * through the router (`uiInput.ts`: keyboard codes, and the pad's Ⓐ/Ⓑ), frames through `mapFrame` —
 * over the real game flow, headless, against a store it wipes.
 *
 *   ff4e-native <bundle.js> --root public --headless --smoke-map --store F
 *
 * It walks the controller spec's world map: a session opens on the map with a room
 * selected; Ⓑ there does nothing; Ⓐ on an unsolved room launches it; a win comes back to
 * the map with that room still selected; a direction moves the selection; Ⓐ on a solved
 * room opens its record panel, where left/right cycle Run → Replay → Cancel and Ⓑ closes
 * it; Replay plays the best record and comes back; and a leg-final room shows its story
 * page after its win and before a Run. Each step is checked against the state the screen
 * must be in. Exits non-zero on the first that is not.
 */
import { ROOMS } from '../../src/data/roomTable.js';
import { replaymode } from '../../src/app/gameState.js';
import { step } from '../../src/app/logicTick.js';
import { ui } from '../../src/app/screenState.js';
import { armSolve, setSolvemode } from '../../src/app/solveMode.js';
import { loadSubtitleAssets } from './roomSubtitles.js';
import { currentRoom, enterRoom, initGame, roomReady, showMap } from './game.js';
import { ensureMapArt, mapFrame, mapPresented } from './mapScreen.js';
import { inputFrame, routeEvent, setExitHandler } from './uiInput.js';
import { legendScreen } from './legend.js';
import { topMenu } from './menus.js';
import { pinRandom } from './scene.js';
import { LOGIC_MS } from './seams/stageGeometry.js';
import { soundTime } from './sound.js';

class MapSmokeFailure extends Error {}

const settle = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A press and release, routed as the interactive loop routes the host's events (`uiInput.ts`). */
async function tap(code: string): Promise<void> {
  routeEvent(`+${code}`, performance.now());
  routeEvent(`-${code}`, performance.now());
  await settle();
}

/** One map frame, as the interactive loop takes it: paint, present, then what follows a present. */
async function frame(): Promise<void> {
  if (ui.screen !== 'room') {
    const shown = mapFrame(performance.now());
    if (shown) __native.presentTexture(shown.id);
    mapPresented();
  }
  await settle();
}

async function untilReady(): Promise<void> {
  for (let i = 0; i < 10_000 && !roomReady(); i++) await new Promise((r) => setTimeout(r, 0));
  if (!roomReady()) throw new MapSmokeFailure(`room ${currentRoom()} never became playable`);
}

/** Step the room until it is left (a win, or the end of a replay), then let the exit land. */
async function playOut(what: string): Promise<void> {
  for (let i = 0; i < 200_000 && ui.screen === 'room'; i++) {
    soundTime(LOGIC_MS); // the mixer's clock moves with game time: 80 ms a step
    step();
  }
  await settle();
  if (ui.screen === 'room') throw new MapSmokeFailure(`${what}: the room was never left`);
}

async function solveHere(): Promise<void> {
  await untilReady();
  const armed = armSolve(ROOMS[currentRoom() - 1]!.jmeno, 1);
  if ('error' in armed) throw new MapSmokeFailure(armed.detail);
  setSolvemode(armed);
  await playOut(`solving room ${currentRoom()}`);
}

export async function runMapSmoke(): Promise<number> {
  if (!__native.args().includes('--store')) {
    console.error('--smoke-map needs --store <file>: it wipes the store, so it must never be the player\'s');
    return 2;
  }
  localStorage.clear();
  pinRandom(1);
  const store = initGame({ verbose: false, demo: false });
  await loadSubtitleAssets();
  let n = 0;
  const check = (ok: boolean, what: string): void => {
    n++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) throw new MapSmokeFailure(what);
  };
  const t0 = __native.now();
  try {
    await ensureMapArt();
    showMap();
    await frame();
    check(ui.screen === 'map' && ui.mapHoverRoom === 1, 'a fresh session opens on the map with room 1 selected');
    await tap('PadB');
    await frame();
    check(ui.screen === 'map' && ui.mapInfoRoom === null && ui.mapHoverRoom === 1, 'Ⓑ on the plain map does nothing');

    await tap('PadA');
    check(ui.screen === 'map', 'Ⓐ on an unsolved room arms a launch: the parchment frame comes first');
    await frame();
    check(ui.screen === 'room' && currentRoom() === 1, '...and the room is entered under it');
    await solveHere();
    check(ui.screen === 'map' && store.solved.has(1), 'a win comes back to the map, solved');
    await frame();
    check(ui.mapHoverRoom === 1, 'the room just played stays selected');

    const moved = new Set<number>();
    for (const dir of ['KeyL', 'KeyK', 'KeyJ', 'KeyI', 'ArrowRight', 'KeyD']) {
      showMap();
      await frame();
      await tap(dir);
      await frame();
      if (ui.mapHoverRoom !== 1 && ui.mapHoverRoom !== null) moved.add(ui.mapHoverRoom);
    }
    check(moved.has(2), `a direction moves the selection to a newly reachable room (reached ${[...moved].join(', ') || 'none'})`);

    showMap();
    await frame();
    await tap('PadA');
    await frame();
    check(ui.mapInfoRoom === 1 && ui.mapInfoHover === 'run', 'Ⓐ on a solved room opens its record panel on Run');
    check(legendScreen(topMenu()) === null, 'no hints over the record panel, for any input (B6: none on the map\'s side)');
    const order: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      await tap('KeyL');
      order.push(ui.mapInfoHover);
    }
    check(order.join(',') === 'replay,cancel,run', `right cycles Run → Replay → Cancel → Run (${order.join(',')})`);
    await tap('ArrowLeft');
    check(ui.mapInfoHover === 'cancel', 'left cycles back');
    await tap('KeyI');
    check(ui.mapInfoHover === 'cancel' && ui.mapInfoRoom === 1, 'up and down do not move off the panel');
    await tap('PadB');
    check(ui.mapInfoRoom === null && ui.screen === 'map', 'Ⓑ closes the panel');

    // On an Apple TV (the system owning Back at the root, as `systemBack` says there), two
    // remote Backs drained in one poll: the first closes the panel, the second lands at the
    // root it uncovered before any frame — the system's then, never the game's to quit on.
    await tap('PadA');
    await frame();
    const realBack = __native.systemBack;
    const owns: boolean[] = [];
    __native.systemBack = (atRoot: boolean): boolean => {
      owns.push(atRoot);
      return atRoot;
    };
    let exits = 0, codes: string[] = [];
    setExitHandler(() => exits++);
    try {
      inputFrame(performance.now());
      const opened = ui.mapInfoRoom === 1 && owns[owns.length - 1] === false;
      [, , codes] = __native.remoteBackProbe(2);
      for (const ev of codes) routeEvent(ev, performance.now());
      await settle();
      check(opened && codes.length === 4 && ui.mapInfoRoom === null && ui.screen === 'map' && exits === 0 && owns[owns.length - 1] === true,
        `on an Apple TV, two Backs in one poll from the record panel: it closes, and the second Back is the system's at the root (${exits} quits)`);
    } finally {
      __native.systemBack = realBack;
      inputFrame(performance.now());
    }

    await tap('PadA');
    await tap('KeyL');
    await tap('PadA');
    await frame();
    check(ui.screen === 'room' && currentRoom() === 1, 'Replay enters the room');
    await untilReady();
    await settle();
    check(replaymode !== null, '...with its best record armed');
    await playOut('the replay');
    check(ui.screen === 'map', 'the end of a replay comes back to the map');

    // Room 29 SPUNT ends leg 2 (depth 15). Its branch opens from room 5.
    for (const r of [2, 3, 4, 5, 20, 21, 22, 23, 24, 25, 26, 27, 28]) store.solved.add(r);
    store.saveSolved();
    await enterRoom(29);
    await solveHere();
    check(ui.screen === 'legimage', 'winning a leg-final room shows the leg\'s story page');
    await tap('KeyJ');
    check(ui.screen === 'map', 'any button dismisses it to the map');
    await frame();
    check(ui.mapHoverRoom === 29, 'with that room selected');
    await tap('PadA');
    await tap('PadA');
    check(ui.screen === 'legimage', 'Run on a solved leg-final room shows the story page first');
    await tap('Enter');
    check(ui.screen === 'room' && currentRoom() === 29, '...and dismissing it enters the room');
    await untilReady();
    await tap('PadB');
    check(ui.screen === 'map', 'Ⓑ in a room goes back to the map');
  } catch (e) {
    console.log(`map smoke FAILED: ${e instanceof MapSmokeFailure ? e.message : e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)}`);
    return 1;
  }
  console.log(`map smoke: ${n} checks passed in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}
