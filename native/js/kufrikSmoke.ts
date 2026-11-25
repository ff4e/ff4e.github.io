/**
 * The KUFRIK smoke gate: the briefcase story and the tutorial demonstration, played headless
 * through the real flow — `roomLoad` enters room 2, the room's own script starts the story at
 * the briefcase's phase 8 and the demonstration when both fish reach its spot, and
 * `cutscenePlay.ts`, `logicTick.step` and the movement code play them, as `game.ts` wires them.
 *
 *   ff4e-native <bundle.js> --root public --headless --smoke-kufrik --store F [--smoke-out DIR]
 *
 * It asserts the state the game keeps and the sound the mixer was asked for, never what a
 * screen says about itself:
 *
 * - entering KUFRIK holds until the story and the tutorial recording are read, as the browser's;
 * - the story starts by itself when the player's moves (the room's recorded solution, typed
 *   key by key) knock the briefcase down, with its looping 'kufrik' music; its frames advance,
 *   the upscaled art is read and each shown frame is decoded; its KD-* narration is voiced on
 *   the voice bus and captioned, each line starting as the one before has sounded its FFT
 *   `delka`; it plays to its end, its art is released, the music stays, and the briefcase
 *   closes in the room;
 * - while it plays, other buttons do nothing (no menu, no move), the legend says what skips it,
 *   and each of A3's Ⓑ / Ⓐ / ☰, B2's click and Back, and the keyboard's Esc skips it — the
 *   narration stopped, the music kept;
 * - the fish at the tutorial spot start the demonstration (put there, as the browser's probe
 *   puts them: the spot is in the workshop, past the steel block's puzzle), which drives them
 *   from the recording — through its scripted death and restart — with its help lines spoken
 *   in the dialogue queue's timing (none before the one before it has held the queue for its
 *   `delka`), leaves Save and Load available as it teaches them, and hands the room back;
 * - the map's Replay of KUFRIK's solution, which drops the briefcase and walks both fish
 *   through that spot, plays neither the story nor the demonstration, and wins the room.
 *
 * With `--smoke-out DIR` a few story pictures are kept (`DIR/kufrik-story-<tick>-<frame>.rgba`,
 * `<frame>` the upscaled frame shown, or `pixels` for the original's).
 * Exits non-zero on the first check that fails.
 */
import { activeScript, count, cutscene, cutsceneAssets, cutsceneSubs, engine, room, showmode } from '../../src/app/gameState.js';
import { inShowmode } from '../../src/app/cutscenePlay.js';
import { ui } from '../../src/app/screenState.js';
import { Dir } from '../../src/core/dir.js';
import { decodeMoves } from '../../src/core/solutionMoves.js';
import { solutionFor } from '../../src/rooms/index.js';
import { heldKeyState } from '../../src/app/movement.js';
import { TALKING_MEZ_SEC } from '../../src/audio/audio.js';
import { FFS_SAMPLE_RATE } from '../../src/audio/ffs.js';
import { parseFft } from '../../src/data/fft.js';
import { readBytes } from './shims.js';
import { advance, enterRoom, initGame, keyDown, keyUp, roomReady, solutionRecord, type LeaveReason } from './game.js';
import { cutsceneFrame, kufrArtState } from './cutsceneScreen.js';
import { legendItems, legendScreen } from './legend.js';
import { menuOpen, verbAvailable } from './menus.js';
import { cutsceneCaptionOverlay, loadSubtitleAssets } from './roomSubtitles.js';
import { pinRandom } from './scene.js';
import { audio } from './seams/audioEngine.js';
import { showmodeRecording } from './seams/roomPreload.js';
import { LOGIC_MS, LOGIC_SEC } from './seams/stageGeometry.js';
import { soundPoll } from './sound.js';
import { routeEvent } from './uiInput.js';


class KufrikSmokeFailure extends Error {}

const KUFRIK = 2;
/** The tutorial spot (URoom.pas:19923): the little fish at (25,23), the big one at (27,21). */
const SPOT = { little: { x: 25, y: 23 }, big: { x: 27, y: 21 } } as const;

let checks = 0;
function check(ok: boolean, what: string): void {
  if (!ok) throw new KufrikSmokeFailure(what);
  checks++;
  console.log(`ok   ${what}`);
}

const settle = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Every sound started, with the tick it started on: `audio.play` and the music, watched. */
const played: { name: string; bus: string; count: number; tick: number }[] = [];
/** Frames run: a clock a room rebuild (which zeroes `count`) does not reset. */
let tick = 0;
function watchSound(): void {
  const play = audio.play.bind(audio);
  audio.play = (name, volume, prior, bus) => {
    played.push({ name, bus: bus ?? 'effect', count, tick });
    play(name, volume, prior, bus);
  };
}

const KEY_OF: Record<'little' | 'big', Record<number, string>> = {
  little: { [Dir.up]: 'KeyI', [Dir.down]: 'KeyK', [Dir.left]: 'KeyJ', [Dir.right]: 'KeyL' },
  big: { [Dir.up]: 'KeyW', [Dir.down]: 'KeyS', [Dir.left]: 'KeyA', [Dir.right]: 'KeyD' },
};

let left: { num: number; why: LeaveReason } | null = null;
const out = (): string | undefined => {
  const a = __native.args();
  return a.includes('--smoke-out') ? a[a.indexOf('--smoke-out') + 1] : undefined;
};

/** One 80 ms frame as the interactive loop takes it: the step, the mixer, and the story's picture. */
async function frame(): Promise<void> {
  tick++;
  advance(LOGIC_MS);
  soundPoll();
  const story = cutsceneFrame();
  if (story) __native.presentTexture(story.id);
  await settle(2);
}

async function frames(n: number, until: () => boolean = () => false): Promise<number> {
  let i = 0;
  for (; i < n && !until(); i++) await frame();
  return i;
}

async function enterKufrik(replay?: string): Promise<void> {
  left = null;
  await enterRoom(KUFRIK, replay);
  for (let i = 0; i < 10_000 && !roomReady(); i++) await settle(1);
  if (!roomReady()) throw new KufrikSmokeFailure('KUFRIK never became playable');
}

/**
 * The briefcase falls when the player's first moves knock it off its shelf: type the room's
 * recorded solution, key by key as a player would, until the story starts. Returns the moves typed.
 */
async function untilStory(): Promise<number> {
  const moves = decodeMoves(solutionFor('KUFRIK').moves ?? '');
  let typed = 0;
  for (let t = 0; t < 4000 && !cutscene; t++) {
    if (engine!.phase === 'idle' && heldKeyState() === 0 && typed < moves.length) {
      const m = moves[typed++]!;
      keyDown(KEY_OF[m.which][m.dir]!);
      keyUp(KEY_OF[m.which][m.dir]!);
    }
    await frame();
  }
  if (!cutscene) throw new KufrikSmokeFailure(`the briefcase story had not started after ${typed} moves of KUFRIK's solution`);
  return typed;
}

/** The ticks a talk line holds the dialogue queue for: the FFT `delka`, less Talking()'s lead. */
const talkTicks = (name: string): number => {
  const d = audio.duration(name);
  return d > 0 ? Math.max(1, Math.round((d - TALKING_MEZ_SEC) / LOGIC_SEC)) : 0;
};

/**
 * Where a `winW`×`winH` window shows the story (`presentRect`'s letterbox, restated for the
 * window the smoke has not got) — a window taller than the picture, so there is room below it.
 */
function storyRect(winW: number, winH: number, w: number, h: number): [number, number, number, number, number] {
  const s = Math.min(winW / w, winH / h);
  const dw = Math.floor(w * s), dh = Math.floor(h * s);
  return [Math.floor((winW - dw) / 2), Math.floor((winH - dh) / 2), dw, dh, 1];
}

/**
 * The caption layer's ink inside and outside the story's box, read back from the GPU. The
 * file goes beside the bundle's build (`<root>/../native/build`), the one place both
 * `saveTexture` (a plain path) and `readFile` (under the asset root) reach.
 */
function captionInk(winW: number, winH: number, rect: readonly [number, number, number, number, number]): { inside: number; outside: number } {
  const caps = cutsceneCaptionOverlay(winW, winH, 0, rect);
  if (!caps) return { inside: 0, outside: 0 };
  const args = __native.args();
  const root = args[args.indexOf('--root') + 1]!;
  __native.saveTexture(caps.id, `${root}/../native/build/smoke-kufrik-captions.rgba`);
  const buf = __native.readFile('/../native/build/smoke-kufrik-captions.rgba');
  if (!buf) throw new KufrikSmokeFailure('the caption layer could not be read back');
  const dv = new DataView(buf);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
  const px = new Uint8Array(buf, 8);
  const [ox, oy, dw, dh] = rect;
  let inside = 0, outside = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] === 0) continue;
      if (x >= ox && x < ox + dw && y >= oy && y < oy + dh) inside++;
      else outside++;
    }
  }
  return { inside, outside };
}

async function storyToItsEnd(): Promise<void> {
  played.length = 0;
  await enterKufrik();
  check(cutsceneAssets !== null && showmodeRecording() !== null,
    'entering KUFRIK read the briefcase story and the tutorial recording before the room was playable');
  const typed = await untilStory();
  const start = count;
  check(typed > 0, `the briefcase story started by itself once the briefcase fell, ${typed} moves in (its phase 8)`);
  const legend = legendItems(legendScreen(null)!, 'pad');
  check(legend.length === 1 && legend[0]!.key === 'skip', `the pad's legend over the story is "B Skip" (${legend.map((l) => l.key).join(',')})`);
  check(legendItems('cutscene', 'key').length === 0, 'the keyboard gets no legend over the story');
  await frames(30);
  check(audio.currentMusic === 'kufrik', `the story plays the 'kufrik' music (${audio.currentMusic || 'none'})`);
  const voiced = played.filter((p) => p.name.startsWith('KD-'));
  check(voiced.length > 0 && voiced.every((p) => p.bus === 'voice'), `the story's narration is voiced on the voice bus (${voiced.map((p) => p.name).join(',')})`);
  const first = voiced[0]!;
  check(audio.duration(first.name) > 0, `${first.name} is in the room's voice package, with a length`);
  check(cutsceneSubs !== null && cutsceneSubs.active, `${first.name} is captioned`);

  // Run the story out, watching its frames and its voices.
  const rec = engine!.srecord;
  const shownAt: number[] = [];
  let decoded = 0, wanted = 0;
  let keep = [40, 400, 900];
  /** KD-ufo's six rows scroll in from below the picture: the caption layer must keep them in it. */
  const WIN = [1280, 1100] as const;
  let ufoSamples = 0, ufoInside = 0, ufoOutside = 0;
  for (let i = 0; i < 6000 && cutscene; i++) {
    const c = cutscene;
    const before = c.framesShown;
    await frame();
    if (c.framesShown !== before) shownAt.push(c.framesShown);
    const st = kufrArtState();
    if (cutscene && st.art && c.framesShown > 0) {
      const name = st.order[c.framesShown - 1];
      wanted++;
      if (name && st.frames.includes(name)) decoded++;
    }
    const line = [...played].reverse().find((p) => p.name.startsWith('KD-'));
    if (cutscene && line?.name === 'KD-ufo' && (count - line.count) % 6 === 1 && (count - line.count) < 60) {
      const ink = captionInk(WIN[0], WIN[1], storyRect(WIN[0], WIN[1], cutscene.width * 4, cutscene.height * 4));
      ufoSamples++;
      ufoInside += ink.inside;
      ufoOutside += ink.outside;
    }
    const dir = out();
    if (dir && keep.length && count - start >= keep[0]!) {
      const story = cutsceneFrame();
      const st = kufrArtState();
      const name = (cutscene && st.order[cutscene.framesShown - 1]) || 'none';
      const img = st.frames.includes(name) ? name.replace('.webp', '') : 'pixels';
      if (story) __native.saveTexture(story.id, `${dir}/kufrik-story-${keep[0]}-${img}.rgba`);
      keep = keep.slice(1);
    }
  }
  check(cutscene === null, 'the story played to its end by itself');
  check(shownAt.length > 200, `its frames advanced: ${shownAt.length} distinct pictures shown`);
  check(wanted > 0 && decoded / wanted > 0.9, `the upscaled frame was decoded for ${decoded} of ${wanted} story ticks`);
  check(engine!.srecord === rec, 'no move was made while it played');
  check(ufoSamples >= 8 && ufoInside > 0 && ufoOutside === 0,
    `KD-ufo's caption, scrolling in, stays inside the story's box in a window taller than it (${ufoSamples} samples, ${ufoInside} px of ink in it, ${ufoOutside} outside)`);
  // Each line sounds for its FFT `delka`: the story waits ('w') for the voice to go quiet,
  // so each line starts when the one before it has sounded for its whole length. The
  // `delka` is read here from the room's .fft itself, not through the audio engine that
  // timed the story.
  const fft = new Map(parseFft(await readBytes('/data/Title/002.fft')).map((e) => [e.name, e.delka]));
  const kd = played.filter((p) => p.name.startsWith('KD-'));
  const late: string[] = [];
  for (let i = 1; i < kd.length; i++) {
    const gap = kd[i]!.count - kd[i - 1]!.count;
    const delka = fft.get(kd[i - 1]!.name);
    if (delka === undefined || delka <= 0) {
      late.push(`${kd[i - 1]!.name} has no delka in 002.fft`);
      continue;
    }
    const want = Math.round(delka / FFS_SAMPLE_RATE / LOGIC_SEC);
    if (Math.abs(gap - want) > 1) late.push(`${kd[i]!.name} started ${gap} ticks after ${kd[i - 1]!.name}, whose delka is ${want} ticks`);
  }
  check(kd.length >= 10 && late.length === 0,
    `${kd.length} narration lines were voiced, each starting as the one before had sounded its delka in 002.fft (±1 tick)${late.length ? `: ${late.join('; ')}` : ''}`);
  check(kufrArtState().art === false && kufrArtState().frames.length === 0, "the story's art was released at its end");
  check(audio.currentMusic === 'kufrik', "the 'kufrik' music keeps playing after the story (DoneKufrDemo never stops it)");
  await frames(80);
  check(activeScript!.s.vars(1)[3] === 1, 'the briefcase closed in the room after the story (kufr_hotovo)');
}

async function skips(): Promise<void> {
  const ways: ReadonlyArray<readonly [string, string]> = [
    ['PadB', "the pad's Ⓑ"], ['PadA', "the pad's Ⓐ"], ['PadMenu', "the pad's ☰"],
    ['RemoteSelect', "the remote's click"], ['RemoteBack', "the remote's Back"], ['Escape', "the keyboard's Esc"],
  ];
  for (const [code, who] of ways) {
    await enterKufrik();
    await untilStory();
    await frames(40);
    if (code === 'PadB') {
      const rec = engine!.srecord;
      for (const other of ['PadX', 'PadLB', 'PadUp', 'PadY', 'RemotePlayPause', 'KeyI', 'Space', 'F2']) {
        routeEvent(`+${other}`);
        routeEvent(`-${other}`);
        await frame();
      }
      check(cutscene !== null && !menuOpen() && engine!.srecord === rec && ui.screen === 'room',
        'other buttons during the story open nothing, move nothing and do not skip it');
    }
    check(audio.playing(-1), `the narration is sounding before ${who}`);
    routeEvent(`+${code}`);
    routeEvent(`-${code}`);
    await frame();
    check(cutscene === null && !menuOpen() && ui.screen === 'room', `${who} skips the story, and opens no menu`);
    check(!audio.playing(-1) && audio.currentMusic === 'kufrik', `…the narration stops, the 'kufrik' music plays on`);
    check(kufrArtState().art === false, "…and the story's art is released");
  }
}


async function demonstration(): Promise<void> {
  // The spot is in the workshop, which a player reaches only by solving the steel block's part
  // of the room, so the fish are put there, as the browser's probe puts them (test-showmode):
  // what starts the demonstration is the room's own script, which asks on its next tick.
  await enterKufrik();
  await frames(5);
  played.length = 0;
  for (const w of ['little', 'big'] as const) {
    const it = room!.items[w === 'little' ? room!.littleIdx : room!.bigIdx]!;
    it.x = SPOT[w].x;
    it.y = SPOT[w].y;
  }
  check(showmode === null, 'no demonstration before the fish are at the spot');
  await frames(5, () => showmode !== null);
  check(showmode !== null, 'the fish at the tutorial spot started the demonstration (the room script, unprompted)');
  check(room!.facingRight.big === false, 'the big fish was turned to face left (natoceni[velka] := smer_vlevo)');
  check(verbAvailable('save') && verbAvailable('load'), 'Save and Load stay available while the demonstration teaches them');
  const total = showmode!.actions.length;
  let ticks = 0, moved = 0;
  const cued = new Set<string>();
  for (; ticks < 30_000 && showmode !== null; ticks++) {
    const rec = engine!.srecord;
    await frame();
    if (engine!.srecord.length > rec.length && engine!.srecord.startsWith(rec)) moved++;
    const last = [...played].reverse().find((p) => /^help\d+$/.test(p.name))?.name ?? '';
    for (const it of legendItems('room', 'pad')) if (it.pulse) cued.add(`${last}:${it.key}`);
    for (const it of legendItems('room', 'remote')) if (it.pulse) cued.add(`${last}:remote-${it.key}`);
  }
  check(showmode === null && !inShowmode(), `the demonstration played all ${total} recorded actions and ended, in ${ticks} ticks`);
  check(moved > 50, `it moved the fish itself (${moved} moves recorded as they were made)`);
  check(room!.alive.little && room!.alive.big && ui.screen === 'room', 'the room is handed back with both fish alive');
  const help = played.filter((p) => /^help\d+$/.test(p.name));
  check(help.length >= 20 && help.every((p) => p.bus === 'voice'), `its ${help.length} help lines were voiced (${help.map((p) => p.name).join(',')})`);
  const early: string[] = [];
  for (let i = 1; i < help.length; i++) {
    const gap = help[i]!.tick - help[i - 1]!.tick;
    const hold = talkTicks(help[i - 1]!.name);
    if (hold <= 0 || gap < hold) early.push(`${help[i]!.name} ${gap} ticks after ${help[i - 1]!.name}, which holds the queue ${hold}`);
  }
  check(help.length > 1 && early.length === 0,
    `each of the ${help.length - 1} help lines after the first started no sooner than the one before held the queue for (its FFT delka)${early.length ? `: ${early.join('; ')}` : ''}`);
  const cues = [...cued].sort().join(' ');
  check(cued.has('help2:save') && cued.has('help7:load') && cued.has('help11:load') && cued.has('help2:remote-menu') &&
    [...cued].every((c) => /^help(2|7|11):/.test(c)),
  `the legend's Save pulses through help2, its Load through help7 and help11, the remote's Menu through each, and nothing else (${cues})`);
}

/** The map's Replay of `rec`: neither the story nor the demonstration may start. */
async function replay(rec: string): Promise<void> {
  await enterKufrik(rec);
  let story = false, demo = false, atSpot = false, fell = false;
  for (let i = 0; i < 20_000 && left === null; i++) {
    await frame();
    story ||= cutscene !== null;
    demo ||= inShowmode();
    fell ||= (activeScript?.s.vars(1)[1] ?? 0) > 8;
    if (room) {
      const l = room.items[room.littleIdx]!, b = room.items[room.bigIdx]!;
      atSpot ||= l.x === SPOT.little.x && l.y === SPOT.little.y && b.x === SPOT.big.x && b.y === SPOT.big.y;
    }
  }
  check(left !== null, `the Replay played to its end (${left?.why ?? 'still playing'})`);
  check(fell && !story, 'the briefcase fell during the Replay, and the story was not played');
  check(atSpot, 'the replayed solution walked both fish through the tutorial spot');
  check(!demo, 'a map Replay does not start the demonstration');
}

export async function runKufrikSmoke(): Promise<number> {
  if (!__native.args().includes('--store')) {
    console.error('--smoke-kufrik needs --store <file>: it wipes the store, so it must never be the player\'s');
    return 2;
  }
  localStorage.clear();
  initGame({ verbose: false, demo: false, onLeave: (num, why) => { left = { num, why }; } });
  await loadSubtitleAssets();
  watchSound();
  pinRandom(2);
  const t0 = __native.now();
  try {
    await storyToItsEnd();
    await skips();
    await demonstration();
    await replay(solutionRecord('KUFRIK'));
  } catch (e) {
    console.log(`FAIL ${e instanceof KufrikSmokeFailure ? e.message : e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)}`);
    return 1;
  }
  console.log(`kufrik smoke: ${checks} checks passed in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}
