/**
 * The menu smoke gate: the native menus and the remote's room mapping, driven the way a
 * player drives them — input events through `uiInput.ts`'s router, as the host delivers
 * them — over the real game flow, headless, against a store it wipes. Each step is checked
 * against the game's own state (the move record, the store's keys, the settings), never
 * against what the menu says about itself.
 *
 *   ff4e-native <bundle.js> --root public --headless --smoke-menus --store F
 *     [--smoke-out DIR] [--update-snapshot]
 *
 * It walks: the map's Options (☰, and the Options corner) — a volume step persisted to
 * `ff.options` and on the bus, the subtitle language persisted and the plaques following it,
 * no row for the subtitle font (whose `ff.subfont` the subtitles still read) — Help paging and closing, Back at the map's
 * root leaving the game; in a room, the remote's edge click moving the active fish, its
 * centre click switching fish, a swipe moving nothing, Play/Pause undoing (and repeating
 * while held), Back opening the pause menu and pausing the room, Load greyed with no save,
 * Save → confirm → saved, Load → confirm → the saved record restored, Restart, a declined
 * prompt changing nothing, the web's gate refusing a save mid-move, the pad's direct
 * LB/RB/Ⓧ prompts and Ⓑ to the map, and the pause menu's Map.
 *
 * First, what the UI draws with (`uiAssetSmoke.ts`): every carved icon, timed at a 4K TV's
 * size, and every UI string's glyphs in both languages.
 *
 * The UI layout snapshot: at a dozen states the UI layer is drawn into a 1280×720 window
 * and what it drew — every rectangle, glyph, image and string, with its position — is
 * compared with native/ui-layout.snap.json. A layout change fails here with the first op
 * that moved; `--update-snapshot` rewrites the file (review its diff), and `--smoke-out`
 * keeps each state's pixels (`DIR/ui-<state>.rgba`, as compare.mjs reads them) and the
 * picture under it (`DIR/pic-<state>.rgba`: the room's composite or the map), to look at.
 */
import { count, engine, loadmode } from '../../src/app/gameState.js';
import { step } from '../../src/app/logicTick.js';
import { helpScreens, ui } from '../../src/app/screenState.js';
import { atRest } from '../../src/app/roomGates.js';
import { lengthOfRecord } from '../../src/core/record.js';
import { busMultiplier, loadSettings } from '../../src/core/settings.js';
import { advance, currentRoom, draw, enterRoom, initGame, isPaused, roomReady, saveExists, showLegImage, showMap } from './game.js';
import { ensureMapArt, mapFrame, mapPresented, mapSelectedCorner } from './mapScreen.js';
import { OPTIONS_ROWS, PAUSE_ITEMS, menuOpen, openMenus, openOptions, pauseItemEnabled, topMenu } from './menus.js';
import { ensureOptionsArt } from './optionsPaint.js';
import { preloadHelpFigures } from './helpPaint.js';
import { confirmItems, legendItems, preloadLegendArt, type LegendScreen } from './legend.js';
import type { NativeAiScreen } from './nativeAiScreen.js';
import { loadSubtitleAssets, subtitleFace } from './roomSubtitles.js';
import { pinRandom } from './scene.js';
import { mixer } from './seams/audioEngine.js';
import { settings } from './seams/playerSettings.js';
import { LOGIC_MS } from './seams/stageGeometry.js';
import { soundTime } from './sound.js';
import { SUB_FACES } from './subtitleFonts.js';
import { inputFrame, lastInput, routeEvent, setExitHandler, setKeyboardIsRemote, setLastInput } from './uiInput.js';
import type { Insets } from './safeArea.js';
import { t } from './uiStrings.js';
import { initUiLayer, menusReady, paintUi, type Box } from './uiLayer.js';
import { currentCost, describeCost, resetCost } from './uiCost.js';
import { loadUiFonts, type UiOp } from './uiDraw.js';
import { checkIcons, checkStrings } from './uiAssetSmoke.js';

class MenuSmokeFailure extends Error {}

const SNAPSHOT = 'native/ui-layout.snap.json';
const WIN_W = 1280, WIN_H = 720;

const settle = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/** The host's clock for the router, advanced by hand so held-input timing is exact. */
let clock = 1_000_000;

async function press(code: string, down = true): Promise<void> {
  routeEvent(`${down ? '+' : '-'}${code}`, clock);
  await settle();
}

/** A press and its release, as one quick tap. */
async function tap(code: string): Promise<void> {
  await press(code, true);
  await press(code, false);
}

/** One map frame, as the interactive loop takes it. */
async function mapTick(): Promise<void> {
  if (ui.screen !== 'room') {
    const shown = mapFrame(performance.now());
    if (shown) __native.presentTexture(shown.id);
    mapPresented();
  }
  await settle();
}

/** `n` game steps, bypassing the menu pause (to move a room on) — the clock moves with them. */
function steps(n: number): void {
  for (let i = 0; i < n; i++) {
    soundTime(LOGIC_MS);
    step();
    clock += LOGIC_MS;
    inputFrame(clock);
  }
}

/** Step until the fish are at rest and the undo point is banked. */
function rest(): void {
  for (let i = 0; i < 200 && !atRest(); i++) steps(1);
  steps(2);
}

async function untilReady(): Promise<void> {
  for (let i = 0; i < 10_000 && !roomReady(); i++) await new Promise((r) => setTimeout(r, 0));
  if (!roomReady()) throw new MenuSmokeFailure(`room ${currentRoom()} never became playable`);
  rest();
}

const moves = (): number => lengthOfRecord(engine?.srecord ?? '');

/**
 * Whether a recorded op lies inside a `w`×`h` area: its box (a text op's pen and the line of
 * its size above its baseline — its right end is not recorded, only that it starts inside).
 */
function opInside(op: UiOp, w: number, h: number): boolean {
  const n = (i: number): number => op[i] as number;
  const box = (x: number, y: number, bw: number, bh: number): boolean => x >= 0 && y >= 0 && x + bw <= w && y + bh <= h;
  switch (op[0]) {
    case 'rect': case 'frame': case 'strip': return box(n(1), n(2), n(3), n(4));
    case 'image': return box(n(2), n(3), n(4), n(5));
    case 'shape': case 'icon': return box(n(2), n(3), n(4), n(4));
    case 'text': return n(2) >= 0 && n(2) < w && n(3) - n(4) >= 0 && n(3) <= h;
    default: return false;
  }
}

/** The picture's box in a `ww`×`wh` window: the room's composite, or the map, letterboxed. */
function pictureBox(cw: number, ch: number, ww: number, wh: number): Box {
  const k = Math.min(ww / cw, wh / ch);
  const w = Math.floor(cw * k), h = Math.floor(ch * k);
  return [Math.floor((ww - w) / 2), Math.floor((wh - h) / 2), w, h];
}

export async function runMenuSmoke(target: NativeAiScreen): Promise<number> {
  const args = __native.args();
  if (!args.includes('--store')) {
    console.error('--smoke-menus needs --store <file>: it wipes the store, so it must never be the player\'s');
    return 2;
  }
  const outDir = args.includes('--smoke-out') ? args[args.indexOf('--smoke-out') + 1] : undefined;
  const update = args.includes('--update-snapshot');
  localStorage.clear();
  pinRandom(1);
  let corners = 0;
  initGame({ verbose: false, demo: false, openCorner: () => { corners++; openOptions(); } });
  // The snapshot is the English UI whatever this machine's language (a first run follows it).
  settings.subtitles = 'en';
  settings.titDef = 'en';
  await loadSubtitleAssets();
  await initUiLayer();
  await ensureOptionsArt();
  await preloadHelpFigures('en');
  await preloadHelpFigures('cz');
  await preloadLegendArt();
  let exits = 0;
  setExitHandler(() => exits++);
  // Watch the mixer's bus gains: a volume step must reach the bus at once.
  let busSet: [string, number] | null = null;
  const setBusGain = mixer.setBusGain.bind(mixer);
  mixer.setBusGain = (bus, gain) => {
    busSet = [bus, gain];
    setBusGain(bus, gain);
  };

  let n = 0;
  const check = (ok: boolean, what: string): void => {
    n++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) throw new MenuSmokeFailure(what);
  };
  const snaps: Record<string, readonly UiOp[]> = {};
  /** Draw the UI layer at a state, into a `ww`×`wh` window (by default the snapshot's 1280×720). */
  const snap = (name: string, ww = WIN_W, wh = WIN_H, insets?: Insets): void => {
    // In a room, composite it first: the picture's box is the composite's size, as on screen.
    const inRoom = ui.screen === 'room' && draw(target, 0);
    const page = ui.screen === 'legimage' ? mapFrame(performance.now()) : null;
    const box = inRoom ? pictureBox(target.width, target.height, ww, wh)
      : page ? pictureBox(page.width, page.height, ww, wh) : pictureBox(2560, 1920, ww, wh);
    const r = paintUi(ww, wh, box, insets);
    if (!r) throw new MenuSmokeFailure(`the UI layer drew nothing for ${name}`);
    snaps[name] = r.ops;
    if (!outDir) return;
    if (r.surface) __native.saveTexture(r.surface.id, `${outDir}/ui-${name}.rgba`);
    if (inRoom) __native.saveComposite(`${outDir}/pic-${name}.rgba`);
    else {
      const shown = mapFrame(performance.now());
      if (shown) __native.saveTexture(shown.id, `${outDir}/pic-${name}.rgba`);
    }
  };
  /** Is the room's legend in `source`'s glyphs on screen now (its "Switch fish" / "Little")? */
  const roomHints = (): boolean => {
    const r = paintUi(WIN_W, WIN_H, pictureBox(target.width, target.height, WIN_W, WIN_H));
    return !!r?.ops.some((op) => op[0] === 'text' && (op[1] === 'Switch fish' || op[1] === 'Little'));
  };
  /** Enter room `num` and return whether its first drawable frame shows the room's hints. */
  const enterShowsHints = async (num: number): Promise<boolean> => {
    await enterRoom(num);
    for (let i = 0; i < 10_000 && !draw(target, 0); i++) await new Promise((r) => setTimeout(r, 0));
    return roomHints();
  };
  /**
   * Draw the layer at 1920×1080 inside tvOS's title-safe insets (80 px at the sides, 60 above
   * and below): every op it records — in the safe area's coordinates — must lie inside it.
   */
  const insideSafeArea = (what: string): void => {
    const W = 1920, H = 1080, sw = W - 160, sh = H - 120;
    const box = ui.screen === 'room' && draw(target, 0) ? pictureBox(target.width, target.height, W, H) : pictureBox(2560, 1920, W, H);
    const ops = paintUi(W, H, box, [80, 60, 80, 60])?.ops ?? [];
    // Only a scrim may reach past it: one rectangle exactly the whole window.
    const scrim = (op: UiOp): boolean => op[0] === 'rect' && op[1] === -80 && op[2] === -60 && op[3] === W && op[4] === H;
    const out = ops.filter((op) => !opInside(op, sw, sh) && !scrim(op));
    check(ops.length > 0 && out.length === 0,
      `${what} at 1920×1080 stays inside tvOS's title-safe area (${out.length} of ${ops.length} drawn outside${out.length ? `, first ${JSON.stringify(out[0])}` : ''})`);
  };
  /**
   * The first pause menu, confirm prompt, Options and Help at a 4K Apple TV's size (3840×2160,
   * tvOS's title-safe insets), as the room's frames would have them: nothing at that size is
   * cached yet, so the frames before a menu opens must get them ready — a little each (the
   * largest frame's rasterising is printed) — and each menu's first frame then costs about what
   * any later one does. On the Apple TV this interpreter is several times slower than on a Mac
   * (QuickJS on an A12 against an M-series core: ~3.5× by single-core benchmarks, taken as 5×
   * here), so a first frame is held under 50 ms there: 10 ms here. The first pause menu once
   * took ~0.6 s here, ~3 s and more on an A12, all of it rasterising its glass at that size.
   */
  const firstMenusAt4k = async (): Promise<void> => {
    const W = 3840, H = 2160, insets = [160, 120, 160, 120] as const;
    const DEVICE_FACTOR = 5, DEVICE_MS = 50;
    const box = pictureBox(target.width, target.height, W, H);
    let frames = 0, worst = 0;
    while (!menusReady() || frames === 0) {
      resetCost();
      const t = __native.now();
      paintUi(W, H, box, insets);
      worst = Math.max(worst, __native.now() - t);
      if (++frames > 600) break;
    }
    check(menusReady(), `at 2160 lines the menus get ready in ${frames} frames while none is up, the dearest frame ${worst.toFixed(1)} ms`);
    /** Open a menu with `code`'s press and release, timing that (the router and the menu's state), then its first frame. */
    const first = async (what: string, code: string): Promise<void> => {
      const t = __native.now();
      routeEvent(`+${code}`, clock);
      routeEvent(`-${code}`, clock);
      const opening = __native.now() - t;
      await settle();
      resetCost();
      const t1 = __native.now();
      paintUi(W, H, box, insets);
      const ms = __native.now() - t1;
      check(ms * DEVICE_FACTOR < DEVICE_MS,
        `${what}'s first frame at 2160 lines: ${describeCost(currentCost(), ms)} (×${DEVICE_FACTOR} for an Apple TV: under ${DEVICE_MS} ms); the press that opened it ${opening.toFixed(1)} ms`);
    };
    await first('the pause menu', 'RemoteBack');
    check(topMenu()?.kind === 'pause', 'that was the pause menu');
    const select = async (item: string): Promise<void> => {
      for (let i = 0; i < PAUSE_ITEMS.length && PAUSE_ITEMS[(topMenu() as { sel: number }).sel] !== item; i++) await tap('RemoteDown');
    };
    await select('options');
    await first('Options', 'RemoteSelect');
    await tap('RemoteBack');
    await select('help');
    await first('Help', 'RemoteSelect');
    await tap('RemoteBack');
    await select('restart');
    await first('the restart prompt', 'RemoteSelect');
    check(topMenu()?.kind === 'confirm', 'that was the restart prompt');
    await tap('RemoteBack');
    await tap('RemoteBack');
    check(!menuOpen(), 'and Back closes them all');
  };
  /** Did state `name` draw the hints' dark strip (they lie over the picture)? */
  const strip = (name: string): boolean => snaps[name]!.some((op) => op[0] === 'strip');
  const stored = (): ReturnType<typeof loadSettings> => loadSettings();
  const t0 = __native.now();
  try {
    checkIcons(check);
    checkStrings(check, await loadUiFonts());
    await ensureMapArt();
    showMap();
    await mapTick();
    snap('map-key');
    check(snaps['map-key']!.length === 0, 'the keyboard on the map: no legend, and no UI layer drawn at all');
    routeEvent('!background', clock);
    await settle();
    check(ui.screen === 'map' && !menuOpen(), 'leaving the app on the map opens nothing');

    // ── The map's Options, from the pad's ☰ ────────────────────────────────────────
    await tap('PadMenu');
    check(topMenu()?.kind === 'options' && lastInput() === 'pad', 'the pad\'s ☰ on the map opens Options');
    snap('options-pad');
    insideSafeArea('Options, with the pad\'s legend,');
    const music0 = settings.volume.music;
    await tap('PadDown');
    await tap('PadDown');
    check(OPTIONS_ROWS[(topMenu() as { row: number }).row] === 'music', 'down moves to the music slider');
    await tap('PadRight');
    await tap('PadLeft');
    await tap('PadLeft');
    const want = Math.max(0, music0 - 1);
    check(settings.volume.music === want && stored().volume.music === want,
      `left/right step the music volume, persisted to ff.options (${music0} → ${stored().volume.music})`);
    check(busSet?.[0] === 'music' && busSet[1] === busMultiplier('music', want), 'and applied to the music bus at once');
    await tap('PadDown');
    const sub0 = settings.subtitles;
    await tap('PadRight');
    check(stored().subtitles !== sub0 && stored().subtitles === settings.subtitles,
      `right on Subtitles changes the language, persisted (${sub0} → ${stored().subtitles})`);
    while (settings.subtitles !== 'en') await tap('PadRight');
    check(stored().subtitles === 'en' && stored().titDef === 'en', 'English subtitles, and tit_def with them');
    await tap('PadDown');
    check(OPTIONS_ROWS[(topMenu() as { row: number }).row] === 'help' && !(OPTIONS_ROWS as readonly string[]).includes('font'),
      'below Subtitles is Help: Options has no subtitle-font row');
    // The face is still the player's pick, read from the store as the browser stores it.
    localStorage.setItem('ff.subfont', SUB_FACES[1]!.name);
    await loadSubtitleAssets();
    const picked = subtitleFace()?.name;
    localStorage.removeItem('ff.subfont');
    await loadSubtitleAssets();
    check(picked === SUB_FACES[1]!.name && subtitleFace()?.name === SUB_FACES[0]!.name,
      `the subtitles still take their face from ff.subfont (${picked}), and the default without it (${subtitleFace()?.name})`);
    await tap('PadA');
    check(topMenu()?.kind === 'help' && helpScreens.page === 0 && openMenus().length === 2, 'Ⓐ on Help opens the help over Options, on page 1');
    snap('help-pad');
    await tap('PadRB');
    await tap('PadRB');
    await tap('PadLB');
    check(helpScreens.page === 1, `RB / LB turn the page (page ${helpScreens.page + 1})`);
    snap('help-page2');
    await tap('PadB');
    check(topMenu()?.kind === 'options', 'Ⓑ closes the help, back to Options');
    await tap('PadB');
    check(!menuOpen() && ui.screen === 'map', 'Ⓑ closes Options');

    // ── Back at the root, and the Options corner ──────────────────────────────────
    await tap('PadB');
    check(exits === 0 && ui.screen === 'map', 'the pad\'s Ⓑ on the plain map does nothing');
    snap('map-pad');
    check(!strip('map-pad'), 'the pad\'s hints in the map\'s letterbox margin: muted, no strip');
    snap('map-pad-fill', 960, 720);
    check(strip('map-pad-fill'), 'with the map filling the window, the hints lie over it on a dark strip');
    await tap('Escape');
    check(exits === 1, 'the keyboard\'s Esc at the map\'s root leaves the game');
    await tap('RemoteBack');
    check(exits === 2, 'and so does the remote\'s Back (tvOS: Back at the top level goes Home)');
    for (let i = 0; i < 40 && mapSelectedCorner() !== 'options'; i++) {
      await tap(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][Math.floor(i / 10)]!);
      await mapTick();
    }
    check(mapSelectedCorner() === 'options', 'the Options corner can be selected');
    snap('map-corner');
    await tap('Space');
    check(corners === 1, 'Ⓐ on it runs its action');
    await settle();
    check(topMenu()?.kind === 'options', '...which opens Options');
    await tap('Escape');
    check(!menuOpen(), 'Esc closes it');

    // ── A room, with the remote ───────────────────────────────────────────────────
    await tap('RemoteUp'); // on the map: the remote is the last input
    check(lastInput() === 'remote' && await enterShowsHints(1), 'entering a room, its first frame shows the remote\'s hints');
    await untilReady();
    await tap('RemoteSelect'); // a press makes the remote the last input
    await tap('RemoteSelect'); // and switches back
    const active0 = engine!.active;
    check(lastInput() === 'remote', 'the remote is the last input');
    await tap('RemoteSelect');
    check(engine!.active !== active0, `the remote's centre click switches the active fish (${active0} → ${engine!.active})`);
    await tap('RemoteSelect');
    let movedBy = '';
    for (const dir of ['RemoteRight', 'RemoteLeft', 'RemoteUp', 'RemoteDown']) {
      const before = moves();
      await press(dir);
      steps(8);
      await press(dir, false);
      rest();
      if (moves() > before) {
        movedBy = dir;
        break;
      }
    }
    check(movedBy !== '', `an edge click moves the active fish (${movedBy || 'no direction moved'})`);
    snap('room-remote');
    check(!strip('room-remote'), 'the remote\'s hints in the room\'s letterbox margin: no strip');
    snap('room-remote-fill', 800, 720);
    check(strip('room-remote-fill'), 'with the room filling the window, the hints lie over it on a dark strip');
    // Where the legend goes must not depend on which fish is active (the little fish's
    // picture is wider than the big one's): across window widths spanning the margin/top
    // switch, the same place with either fish.
    const placements = (): string[] => {
      const out: string[] = [];
      for (let ww = 760; ww <= 1400; ww += 8) {
        const r = paintUi(ww, WIN_H, pictureBox(target.width, target.height, ww, WIN_H));
        const move = r?.ops.find((op) => op[0] === 'text' && op[1] === 'Move');
        out.push(`${move?.[2]},${move?.[3]}`);
      }
      return out;
    };
    const fish0 = engine!.active, at0 = placements();
    await tap('RemoteSelect');
    const fish1 = engine!.active, at1 = placements();
    await tap('RemoteSelect');
    const rows = at0.filter((p) => Number(p.split(',')[1]) < 120).length;
    check(fish0 !== fish1 && at0.join() === at1.join() && rows > 0 && rows < at0.length,
      `switching fish never moves the legend: ${at0.length} window widths, ${rows} with the row on top, the same with either fish`);
    // The remote's touch surface as the host reads it, through SDL's own mapping of a Siri
    // Remote (y inverted): a lifted thumb must read as lifted, though SDL_GetGamepadAxis says
    // -1 for it, and a thumb as where it is, y pointing down.
    const [lifted, sdlY] = __native.remoteProbe(0, 0);
    const [thumb] = __native.remoteProbe(16384, 16384);
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;
    check(lifted === null && sdlY !== 0 && !!thumb && near(thumb[0], 0.5) && near(thumb[1], -0.5),
      `the remote's touch surface reads raw: a lifted thumb is none (SDL_GetGamepadAxis: ${sdlY}), raw (16384, 16384) is ${JSON.stringify(thumb?.map((v) => +v.toFixed(3)))}`);
    // In a room a swipe does nothing, so a click right after one toward its edge is a click.
    const pre = moves();
    await tap(`RemoteSwipe${movedBy.slice('Remote'.length)}`);
    await press(movedBy);
    steps(8);
    await press(movedBy, false);
    rest();
    check(moves() === pre + 1, 'in a room, an edge click just after a swipe toward that edge still moves the fish');
    const before = moves();
    for (const sw of ['RemoteSwipeLeft', 'RemoteSwipeRight', 'RemoteSwipeUp', 'RemoteSwipeDown']) await tap(sw);
    steps(10);
    check(moves() === before, 'a swipe moves nothing');
    await tap('RemotePlayPause');
    rest();
    check(moves() === before - 1, `Play/Pause undoes one move (${before} → ${moves()})`);
    // Three moves, then hold Play/Pause: the first undo at 350 ms, then one every 80 ms.
    for (let i = 0; i < 3; i++) {
      await press(movedBy);
      steps(8);
      await press(movedBy, false);
      rest();
    }
    const three = moves();
    await press('RemotePlayPause');
    for (let t = 0; t < 350 + 80 + 10; t += 10) {
      clock += 10;
      inputFrame(clock);
    }
    await press('RemotePlayPause', false);
    check(moves() === three - 2, `holding Play/Pause repeats the undo, and the release adds none (${three} → ${moves()})`);
    rest();
    // A hold whose release lands in a menu ends there: nothing repeats afterwards, and the
    // next press still works.
    for (let i = 0; i < 2; i++) {
      await press(movedBy);
      steps(8);
      await press(movedBy, false);
      rest();
    }
    const held = moves();
    await press('RemotePlayPause');
    await tap('RemoteBack');
    await press('RemotePlayPause', false);
    await tap('RemoteBack');
    for (let t = 0; t < 1000; t += 10) {
      clock += 10;
      inputFrame(clock);
    }
    check(!menuOpen() && moves() === held, `Play/Pause released inside the pause menu undoes nothing, then or later (${held} → ${moves()})`);
    await tap('RemotePlayPause');
    rest();
    check(moves() === held - 1, 'and the next Play/Pause undoes one move');

    // ── A 4K Apple TV's first menus ─────────────────────────────────────────────
    await firstMenusAt4k();

    // ── The pause menu ────────────────────────────────────────────────────────────
    check(!saveExists() && !pauseItemEnabled('load'), 'no save yet: Load is greyed');
    await tap('RemoteBack');
    check(topMenu()?.kind === 'pause' && isPaused(), 'Back in a room opens the pause menu and pauses the room');
    const c0 = count;
    advance(LOGIC_MS * 1.5);
    advance(LOGIC_MS * 1.5);
    check(count === c0, 'a paused room does not step');
    snap('pause-remote');
    await tap('RemoteBack');
    check(!menuOpen() && roomHints(), 'Back resumes, and the room\'s hints are up at once');
    insideSafeArea('the room\'s remote legend');
    routeEvent('!background', clock);
    await settle();
    const c1 = count;
    advance(LOGIC_MS * 1.5);
    advance(LOGIC_MS * 1.5);
    check(topMenu()?.kind === 'pause' && isPaused() && count === c1, 'leaving the app in a room opens the pause menu, and the room holds');
    insideSafeArea('the pause menu');
    await tap('RemoteBack');
    await tap('RemoteBack');
    const order: string[] = [];
    for (let i = 0; i < PAUSE_ITEMS.filter(pauseItemEnabled).length; i++) {
      await tap('RemoteSwipeDown');
      order.push(PAUSE_ITEMS[(topMenu() as { sel: number }).sel]!);
    }
    check(!order.includes('load') && order[order.length - 1] === 'resume', `a swipe moves the highlight, skipping the greyed Load (${order.join(' → ')})`);
    // A swipe that finishes pressing the ring toward its edge is one step, not two; a click
    // on that edge a moment later is a click again.
    const sel = (): number => (topMenu() as { sel: number }).sel;
    const s0 = sel();
    await tap('RemoteSwipeDown');
    const s1 = sel();
    await tap('RemoteDown');
    check(s1 !== s0 && sel() === s1, 'a swipe that ends clicking the ring toward its edge steps the highlight once');
    clock += 400;
    await tap('RemoteDown');
    check(sel() !== s1, 'and a click on that edge a moment later steps it again');
    const select = async (item: string): Promise<void> => {
      for (let i = 0; i < PAUSE_ITEMS.length && PAUSE_ITEMS[(topMenu() as { sel: number }).sel] !== item; i++) await tap('RemoteDown');
      await tap('RemoteSelect');
    };
    const rec = engine!.srecord;
    await select('save');
    check(topMenu()?.kind === 'confirm', 'Save asks first');
    snap('confirm-save-remote');
    await tap('RemoteBack');
    check(topMenu()?.kind === 'pause' && !saveExists(), 'Back declines: back on the pause menu, nothing saved');
    await tap('RemoteSelect');
    await tap('RemoteSelect');
    check(!menuOpen() && !isPaused() && saveExists(), 'a click says yes: saved, and the room resumes');
    check(JSON.parse(localStorage.getItem(`ff.save.${currentRoom()}`) ?? '{}').rec === rec, 'the slot holds the move record');
    // Move on, then load the save back.
    await press(movedBy);
    steps(8);
    await press(movedBy, false);
    rest();
    check(engine!.srecord !== rec, 'a move after the save');
    await tap('RemoteBack');
    await select('load');
    check(topMenu()?.kind === 'confirm', 'Load asks first');
    await tap('RemoteSelect');
    for (let i = 0; i < 5000 && (loadmode || !atRest()); i++) steps(1);
    rest();
    check(engine!.srecord === rec, 'yes: the saved record is restored');

    // Options and Help from the pause menu, and back to it.
    await tap('RemoteBack');
    await select('options');
    check(topMenu()?.kind === 'options' && isPaused(), 'Options from the pause menu, the room still paused');
    const fx0 = settings.volume.effect;
    await tap('RemoteRight');
    check(stored().volume.effect === Math.min(12, fx0 + 1), 'an edge click right raises the effect volume, persisted');
    await tap('RemoteLeft');
    snap('options-remote');
    await tap('RemoteBack');
    check(topMenu()?.kind === 'pause', 'Back closes Options, back to the pause menu');
    await select('help');
    await tap('RemoteRight');
    check(topMenu()?.kind === 'help' && helpScreens.page === 1, 'Help from the pause menu pages right');
    await tap('RemoteSelect');
    check(topMenu()?.kind === 'pause', 'a click closes the help');
    await select('restart');
    await tap('RemoteSelect');
    rest();
    check(!menuOpen() && moves() === 0, 'Restart → yes: the room starts over');

    // The web's gate still decides: F2 refuses while a fish is moving.
    localStorage.removeItem(`ff.save.${currentRoom()}`);
    await press(movedBy);
    steps(1);
    check(!atRest(), 'a fish is mid-move');
    await tap('RemoteBack');
    await select('save');
    await tap('RemoteSelect');
    check(!saveExists(), 'Save → yes mid-move is refused, as F2 is on the web');
    await press(movedBy, false);
    rest();

    // ── The pad's direct shortcuts, and the keyboard ──────────────────────────────
    await tap('PadX');
    check(topMenu()?.kind === 'confirm' && lastInput() === 'pad', 'the pad\'s Ⓧ asks to restart');
    snap('confirm-restart-pad');
    await tap('PadB');
    check(!menuOpen(), 'Ⓑ says no');
    await tap('PadRB');
    check(!menuOpen(), 'RB with no save opens nothing');
    await tap('PadLB');
    check(topMenu()?.kind === 'confirm', 'LB asks to save');
    await tap('PadA');
    check(saveExists(), 'Ⓐ says yes: saved');
    snap('room-pad');
    await tap('PadMenu');
    check(topMenu()?.kind === 'pause', 'the pad\'s ☰ opens the pause menu');
    snap('pause-pad');
    await tap('PadMenu');
    check(!menuOpen(), 'and closes it');
    await tap('Escape');
    check(topMenu()?.kind === 'pause' && lastInput() === 'key', 'the keyboard\'s Esc opens the pause menu');
    snap('pause-key');
    const screens: LegendScreen[] = ['room', 'map', 'panel', 'legimage', 'pause', 'options', 'help'];
    check(screens.every((sc) => legendItems(sc, 'key').length === 0) && confirmItems('key').length === 0,
      'the keyboard gets no button hints on any screen, nor on the confirm prompt');
    check(screens.every((sc) => legendItems(sc, 'pad').length > 0 && legendItems(sc, 'remote').length > 0),
      'the pad and the remote get them on every screen');
    // The keyboard's confirm prompt: the question alone, answered by Esc and Enter.
    localStorage.removeItem(`ff.save.${currentRoom()}`);
    for (let i = 0; i < PAUSE_ITEMS.length && PAUSE_ITEMS[(topMenu() as { sel: number }).sel] !== 'save'; i++) await tap('ArrowDown');
    await tap('Enter');
    check(topMenu()?.kind === 'confirm' && lastInput() === 'key', 'Enter on Save asks first');
    snap('confirm-save-key');
    await tap('Escape');
    check(topMenu()?.kind === 'pause' && !saveExists(), 'Esc declines: back on the pause menu, nothing saved');
    await tap('Enter');
    await tap('Enter');
    check(!menuOpen() && !isPaused() && saveExists(), 'Enter says yes: saved, and the room resumes');
    await tap('Escape');
    check(topMenu()?.kind === 'pause', 'Esc opens the pause menu again');
    await tap('Escape');
    check(!menuOpen(), 'and Esc resumes');
    snap('room-key');
    check(snaps['room-key']!.length === 0, 'the keyboard in a room: no legend, and no UI layer drawn at all');
    await tap('PadB');
    check(ui.screen === 'map', 'the pad\'s Ⓑ goes straight to the map');
    await enterRoom(1);
    await untilReady();
    await tap('RemoteBack');
    await select('map');
    check(ui.screen === 'map' && !menuOpen(), 'the pause menu\'s World map leaves the room');

    // A story page filling the window: its "Continue" on the strip, and any button dismisses it.
    check(lastInput() === 'remote', 'the remote is still the last input');
    await showLegImage(1);
    check(ui.screen === 'legimage', 'a story page is up');
    snap('legimage-remote-fill', 960, 720);
    check(strip('legimage-remote-fill'), 'its hint lies over the page on a dark strip');
    await tap('RemoteSelect');
    check(ui.screen === 'map', 'a click dismisses it');

    // `--remote-keys`: the keyboard is the remote, every key of it. A key the host leaves
    // unmapped (Space reaching the game as itself, a letter) keeps the remote's hints up.
    setKeyboardIsRemote(true);
    check(await enterShowsHints(2), 'back from the map into KUFRIK: its first frame shows the remote\'s hints');
    await untilReady();
    await tap('Space');
    await tap('KeyQ');
    check(lastInput() === 'remote' && roomHints(), 'with --remote-keys, Space and a letter keep the remote\'s hints');
    setKeyboardIsRemote(false);
    await tap('Space');
    check(lastInput() === 'key' && !roomHints(), 'without it, Space is the keyboard: no hints');

    // ── Czech: the UI follows the subtitles' language ────────────────────────────
    settings.subtitles = 'cz';
    settings.titDef = 'cz';
    await tap('PadMenu');
    snap('pause-pad-cz');
    check(snaps['pause-pad-cz']!.some((op) => op[0] === 'text' && op[1] === 'Pauza'), 'with Czech subtitles the pause menu is Czech');
    await tap('PadB');
    snap('room-pad-cz');
    check(snaps['room-pad-cz']!.some((op) => op[0] === 'text' && op[1] === 'Malá'), 'and so is the room\'s legend');
    await tap('PadX');
    snap('confirm-restart-pad-cz');
    await tap('PadB');
    openOptions();
    snap('options-pad-cz');
    await tap('PadB');
    settings.subtitles = 'off';
    check(t('paused') === 'Pauza', 'subtitles off: the UI keeps the last language chosen');
    settings.subtitles = 'en';
    settings.titDef = 'en';
    check(t('paused') === 'Paused', 'and English with English subtitles');

    // ── A TV's legend, inside tvOS's title-safe area ─────────────────────────────
    // The map and room 1 (the list down the left margin) and UTES, wider than the screen
    // (a row along the top), at a 1080-line and a 2160-line Apple TV with the remote.
    setLastInput('remote');
    const tv = async (name: string): Promise<void> => {
      snap(`tv-${name}-1080`, 1920, 1080, [80, 60, 80, 60]);
      snap(`tv-${name}-2160`, 3840, 2160, [160, 120, 160, 120]);
    };
    showMap();
    await mapTick();
    await tv('map');
    await enterRoom(1);
    await untilReady();
    await tv('room');
    await enterRoom(7);
    await untilReady();
    await tv('wide');
    // Against the safe area's edge, a hair in (4 px at 1080 lines, ×u): the list's chips at its
    // left, the row's at its top — and nothing outside it.
    for (const lines of [1080, 2160]) {
      const sw = lines === 1080 ? 1760 : 3520, sh = lines === 1080 ? 960 : 1920, hair = Math.round((4 * sh) / 1080);
      const chips = (name: string): UiOp[] => snaps[`tv-${name}-${lines}`]!.filter((op) => op[0] === 'rect');
      const left = (name: string): number => Math.min(...chips(name).map((op) => op[1] as number));
      const top = (name: string): number => Math.min(...chips(name).map((op) => op[2] as number));
      check(left('map') === hair && left('room') === hair && top('wide') === hair &&
        ['map', 'room', 'wide'].every((nm) => snaps[`tv-${nm}-${lines}`]!.every((op) => opInside(op, sw, sh))),
      `at ${lines} lines the TV legend hugs the title-safe edge, ${hair} px in: the map's and room 1's list at its left (${left('map')}, ${left('room')}), UTES's row at its top (${top('wide')})`);
    }

    // ── The layout snapshot ──────────────────────────────────────────────────────
    const json = `${JSON.stringify(snaps, null, 0).replace(/\],\[/g, '],\n[').replace(/":\[\[/g, '":[\n[')}\n`;
    if (update) {
      __native.writeText(SNAPSHOT, json);
      console.log(`  wrote ${SNAPSHOT} (${Object.keys(snaps).length} states)`);
    } else {
      const committed = __native.readText(SNAPSHOT);
      if (committed === null) throw new MenuSmokeFailure(`${SNAPSHOT} is missing: run with --update-snapshot and commit it`);
      const old = JSON.parse(committed) as Record<string, UiOp[]>;
      for (const name of new Set([...Object.keys(old), ...Object.keys(snaps)])) {
        const a = old[name] ?? [], b = snaps[name] ?? [];
        const at = a.findIndex((op, i) => JSON.stringify(op) !== JSON.stringify(b[i]));
        const diff = at >= 0 ? at : a.length !== b.length ? Math.min(a.length, b.length) : -1;
        if (diff >= 0) {
          __native.writeText('native/build/ui-layout.snap.new.json', json);
          throw new MenuSmokeFailure(`UI layout of "${name}" changed at op ${diff}: ${JSON.stringify(a[diff])} → ${JSON.stringify(b[diff])} ` +
            '(the new snapshot is native/build/ui-layout.snap.new.json; if intended, rerun with --update-snapshot)');
        }
      }
      check(true, `the UI layout matches ${SNAPSHOT} (${Object.keys(snaps).length} states)`);
    }
  } catch (e) {
    console.log(`menu smoke FAILED: ${e instanceof MenuSmokeFailure ? e.message : e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)}`);
    return 1;
  }
  console.log(`menu smoke: ${n} checks passed in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}
