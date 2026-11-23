/**
 * Native entry, driven by the C host (native/host/main.c). Three modes:
 *
 *   ff4e-native <bundle.js> --root <public dir> [--room N] [--demo] [--seconds S] [--store F]
 *     the game (`game.ts`): starts on the world map (`mapScreen.ts`), or in room N, and
 *     comes back to the map after every room. --demo plays every room's recorded solution
 *     through the real loop instead of reading input, room after room. --remote-keys makes
 *     the keyboard a Siri Remote (native/host/main.c). Input: `uiInput.ts`; menus:
 *     `menus.ts`. Controls: native/README.md.
 *   ff4e-native <bundle.js> --root <public dir> --headless --smoke ROOMS [--smoke-player ROOMS] --store F
 *     the smoke gate (`smoke.ts`): plays rooms through the real flow, headless, and exits
 *     non-zero unless each one is won.
 *   ff4e-native <bundle.js> --root <public dir> --headless --smoke-map --store F
 *     the map smoke gate (`mapSmoke.ts`): the world map driven by keys through the real flow.
 *   ff4e-native <bundle.js> --root <public dir> --headless --smoke-menus --store F [--smoke-out DIR] [--update-snapshot]
 *     the menu smoke gate (`menuSmoke.ts`): the pause menu, the confirm prompt, Options, Help,
 *     the map's Options corner and the remote's room mapping, through the real flow, and the
 *     UI layout snapshot (native/ui-layout.snap.json).
 *   ff4e-native <bundle.js> --root <public dir> --headless --smoke-audio --store F
 *     the sound gate (`audioSmoke.ts`): the mixer, the decoder, and PRVNI's dialogue timing.
 *   ff4e-native <bundle.js> --root <public dir> --room N --headless --out f.rgba
 *     [--replay TICKS] [--still] [--alpha A] [--probe]
 *     renders ONE composite of the parity scene (`scene.ts`) for native/compare.mjs.
 *   ff4e-native <bundle.js> --root <public dir> --headless --map-scene CASE --out f.rgba
 *     paints ONE case of the world-map parity scene (`mapScene.ts`) for native/compare-map.mjs.
 *   ff4e-native <bundle.js> --root <public dir> --headless --subs-scene CASE --out f.rgba
 *     draws ONE case of the subtitle parity scene (`subtitleScene.ts`) for native/compare-subs.mjs.
 */
import { runTimers, readBytes } from './shims.js';
import { RANDPOLE } from '../../src/render/framebuffer.js';
import { NativeAiScreen } from './nativeAiScreen.js';
import { nativeScratchCanvas } from './nativeCanvas.js';
import { setScratchCanvasFactory } from '../../src/render/scratchCanvas.js';
import { setSurfaceFactory } from '../../src/render/surface2d.js';
import { NativeSurface, decodeImage, nativeSurface } from './nativeSurface.js';
import { loadMapScene, paintMapCase } from './mapScene.js';
import { AI_MAP_H, AI_MAP_W } from '../../src/render/worldMapAi.js';
import { compositeSize, frameFor, loadScene, pinRandom, probeFrame, replaySolution } from './scene.js';
import { advance, draw, enterRoom, firstRoom, initGame, showMap } from './game.js';
import { ensureMapArt, mapFrame, mapPresented } from './mapScreen.js';
import { inputFrame, routeEvent, setLastInput } from './uiInput.js';
import { openOptions } from './menus.js';
import { initUiLayer, paintUi, windowLayout } from './uiLayer.js';
import { ensureOptionsArt } from './optionsPaint.js';
import { runMenuSmoke } from './menuSmoke.js';
import { ui } from '../../src/app/screenState.js';
import { runSmoke } from './smoke.js';
import { runMapSmoke } from './mapSmoke.js';
import { SUB_CASES, buildSubScene } from './subtitleScene.js';
import { SubtitleLayout } from './subtitleLayout.js';
import { loadFace } from './subtitleFonts.js';
import { GlyphAtlas, drawSubtitles } from './subtitleDraw.js';
import { loadSubtitleAssets, subtitleOverlay } from './roomSubtitles.js';
import { runAudioSmoke } from './audioSmoke.js';
import { soundPoll } from './sound.js';
import { mixer } from './seams/audioEngine.js';
import { MIX_RATE } from './sdlAudioBackend.js';

const argv = __native.args();
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string): boolean => argv.includes(name);

const g = globalThis as Record<string, unknown>;

async function main(): Promise<void> {
  __native.setRandTable(RANDPOLE.slice().buffer);
  setScratchCanvasFactory(nativeScratchCanvas);
  setSurfaceFactory(nativeSurface);
  const target = new NativeAiScreen();
  if (flag('--smoke-audio')) {
    __native.quit(await runAudioSmoke());
    return;
  }
  if (flag('--smoke-menus')) {
    __native.quit(await runMenuSmoke(target));
    return;
  }
  if (flag('--smoke-map')) {
    __native.quit(await runMapSmoke());
    return;
  }
  if (flag('--smoke') || flag('--smoke-player')) {
    __native.quit(await runSmoke(arg('--smoke'), target));
    return;
  }
  if (flag('--map-scene')) {
    await renderMapCase(arg('--map-scene')!);
    return;
  }
  if (flag('--subs-scene')) {
    await renderSubsCase(arg('--subs-scene')!);
    return;
  }
  if (flag('--headless')) {
    await renderParityFrame(target);
    return;
  }
  initGame({ verbose: true, demo: flag('--demo'), openCorner: () => openOptions() });
  await loadSubtitleAssets();
  await initUiLayer();
  void ensureOptionsArt();
  if (flag('--remote-keys')) setLastInput('remote');
  console.log(`sound: ${mixer.mode}, mixing at ${MIX_RATE} Hz`);
  if (arg('--room')) await enterRoom(Number(arg('--room')));
  else if (flag('--demo')) await enterRoom(firstRoom());
  else {
    await ensureMapArt();
    showMap();
  }
  runInteractive(target);
}

/** One composite of the parity scene, identical in state to the browser reference's. */
async function renderParityFrame(target: NativeAiScreen): Promise<void> {
  pinRandom(1);
  const t0 = __native.now();
  const scene = await loadScene(Number(arg('--room') ?? 1), readBytes);
  console.log(`room #${scene.num} ${scene.jmeno}: AI art ×${scene.ai.scale}, loaded in ${(__native.now() - t0).toFixed(0)} ms`);
  const ticks = Number(arg('--replay') ?? 0);
  if (ticks > 0) console.log(`replayed ${replaySolution(scene, ticks)} recorded moves in ${ticks} ticks`);
  if (flag('--still')) scene.room.wamp = 0;
  const alpha = Number(arg('--alpha') ?? 0);
  const f = flag('--probe') ? probeFrame(scene, alpha) : frameFor(scene, alpha);
  const { w, h } = compositeSize(scene);
  target.begin(w, h);
  scene.ai.drawInto(target, scene.room, f);
  __native.saveComposite(arg('--out') ?? 'composite.rgba');
  __native.quit();
}

/** One case of the world-map parity scene (`mapScene.ts`), for native/compare-map.mjs. */
async function renderMapCase(name: string): Promise<void> {
  const scene = await loadMapScene({
    bytes: readBytes,
    image: async (url) => decodeImage((await readBytes(url)).slice().buffer),
  });
  const screen = new NativeSurface(AI_MAP_W, AI_MAP_H);
  paintMapCase(screen, scene, name);
  __native.saveTexture(screen.id, arg('--out') ?? 'map.rgba');
  __native.quit();
}

/**
 * One case of the subtitle parity scene (`subtitleScene.ts`), for native/compare-subs.mjs.
 * `--mutate KIND` draws it deliberately wrong, for the comparison's self-test (`MUTATIONS`).
 */
async function renderSubsCase(name: string): Promise<void> {
  const c = SUB_CASES.find((x) => x.name === name);
  if (!c) throw new Error(`no subtitle case ${name}`);
  const scene = await buildSubScene(c, readBytes);
  const face = await loadFace(scene.face, readBytes);
  const mutate = arg('--mutate');
  const rows = scene.sys.debugLines().map((t, i) => mutateRow(t, i, mutate));
  const box = mutate === 'size' ? { ...scene.box, textScale: scene.box.textScale * 1.06 } : scene.box;
  const now = mutate === 'late' ? scene.count - 1 : scene.count;
  const source = { debugLines: () => rows, vectorScreen: scene.sys.vectorScreen };
  let frame = new SubtitleLayout(face).layout(source, now, box, face.name);
  if (mutate === 'shift') frame = { ...frame, lines: frame.lines.map((l) => ({ ...l, baseline: l.baseline + 2 / scene.density / frame.tier })) };
  if (mutate === 'outline') frame = { ...frame, lines: frame.lines.map((l) => ({ ...l, strokeW: 0 })) };
  const screen = new NativeSurface(scene.devW, scene.devH);
  drawSubtitles(screen, frame, face, new GlyphAtlas(), scene.density);
  __native.saveTexture(screen.id, arg('--out') ?? 'subs.rgba');
  __native.quit();
}

/** The self-test's wrong rows: another fish's colour, or one letter changed. */
function mutateRow<T extends { obsah: string; rgb: [number, number, number] }>(t: T, i: number, kind: string | undefined): T {
  if (i !== 0) return t;
  if (kind === 'colour') return { ...t, rgb: [t.rgb[2], t.rgb[1], t.rgb[0]] };
  if (kind === 'letter') {
    const at = t.obsah.search(/[a-z]/);
    return { ...t, obsah: t.obsah.slice(0, at) + (t.obsah[at] === 'e' ? 'a' : 'e') + t.obsah.slice(at + 1) };
  }
  return t;
}

function runInteractive(target: NativeAiScreen): void {
  const stopAt = arg('--seconds') ? __native.now() + Number(arg('--seconds')) * 1000 : Infinity;
  let last = __native.now();
  let jsMs = 0;
  let frames = 0;
  let statAt = last;
  let statSound = mixer.now();
  g.__frame = (): void => {
    const now = __native.now();
    // Each event goes to the screen that is up when it arrives: one can change the screen.
    for (const ev of __native.events()) routeEvent(ev, now);
    inputFrame(now);
    if (now >= stopAt) {
      __native.quit();
      return;
    }
    soundPoll();
    const alpha = advance(now - last);
    last = now;
    if (ui.screen === 'room') {
      // Nothing is presented while a room loads, so the map's parchment frame stays up.
      const drawn = draw(target, alpha);
      const subs = drawn ? subtitleOverlay(target.width, target.height, alpha) : null;
      const win = drawn ? windowLayout(target.width, target.height) : null;
      const layer = win ? paintUi(win.w, win.h, win.picture) : null;
      // Measured BEFORE present: present waits for vsync, which is idle time, not work.
      jsMs += __native.now() - now;
      if (drawn) __native.present(subs?.id, layer?.surface.id);
    } else {
      const shown = mapFrame(now); // the map, or the story page over it
      const win = shown ? windowLayout(shown.width, shown.height) : null;
      const layer = win ? paintUi(win.w, win.h, win.picture) : null;
      jsMs += __native.now() - now;
      if (shown) __native.presentTexture(shown.id, layer?.surface.id);
      mapPresented();
    }
    frames++;
    if (now - statAt >= 5000) {
      // The mixer's clock against the wall's: ~1.000 when the output consumes in real time.
      const sound = mixer.now();
      console.log(`${(frames * 1000 / (now - statAt)).toFixed(0)} fps, game logic + drawing + GPU command encoding ${(jsMs / frames).toFixed(2)} ms/frame; ` +
        `sound clock ×${((sound - statSound) / (now - statAt)).toFixed(3)} of wall, ${__native.audioVoices()} voices`);
      statSound = sound;
      frames = 0;
      jsMs = 0;
      statAt = now;
    }
  };
}

g.__timers = runTimers;
main().catch((e: unknown) => {
  console.error('fatal:', e);
  __native.quit(1);
});
