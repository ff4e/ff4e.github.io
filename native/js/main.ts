/**
 * Native entry, driven by the C host (native/host/main.c). Three modes:
 *
 *   ff4e-native <bundle.js> --root <public dir> [--room N] [--demo] [--seconds S] [--store F]
 *     the game (`game.ts`): starts on the world map (`mapScreen.ts`), or in room N, and
 *     comes back to the map after every room. --demo plays every room's recorded solution
 *     through the real loop instead of reading input, room after room. Controls:
 *     native/README.md.
 *   ff4e-native <bundle.js> --root <public dir> --headless --smoke ROOMS [--smoke-player ROOMS] --store F
 *     the smoke gate (`smoke.ts`): plays rooms through the real flow, headless, and exits
 *     non-zero unless each one is won.
 *   ff4e-native <bundle.js> --root <public dir> --headless --smoke-map --store F
 *     the map smoke gate (`mapSmoke.ts`): the world map driven by keys through the real flow.
 *   ff4e-native <bundle.js> --root <public dir> --headless --smoke-audio --store F
 *     the sound gate (`audioSmoke.ts`): the mixer, the decoder, and PRVNI's dialogue timing.
 *   ff4e-native <bundle.js> --root <public dir> --room N --headless --out f.rgba
 *     [--replay TICKS] [--still] [--alpha A] [--probe]
 *     renders ONE composite of the parity scene (`scene.ts`) for native/compare.mjs.
 *   ff4e-native <bundle.js> --root <public dir> --headless --map-scene CASE --out f.rgba
 *     paints ONE case of the world-map parity scene (`mapScene.ts`) for native/compare-map.mjs.
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
import { advance, blur, draw, enterRoom, firstRoom, initGame, keyDown, keyUp, showMap } from './game.js';
import { ensureMapArt, mapBlur, mapFrame, mapKeyDown, mapKeyUp, mapPresented } from './mapScreen.js';
import { ui } from '../../src/app/screenState.js';
import { runSmoke } from './smoke.js';
import { runMapSmoke } from './mapSmoke.js';
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
  if (flag('--headless')) {
    await renderParityFrame(target);
    return;
  }
  initGame({ verbose: true, demo: flag('--demo') });
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

function runInteractive(target: NativeAiScreen): void {
  const stopAt = arg('--seconds') ? __native.now() + Number(arg('--seconds')) * 1000 : Infinity;
  let last = __native.now();
  let jsMs = 0;
  let frames = 0;
  let statAt = last;
  let statSound = mixer.now();
  g.__frame = (): void => {
    const now = __native.now();
    for (const ev of __native.events()) {
      // Each event goes to the screen that is up when it arrives: one can change the screen.
      const onRoom = ui.screen === 'room';
      if (ev === '!blur') {
        blur();
        mapBlur();
      } else if (ev[0] === '-') {
        if (onRoom) keyUp(ev.slice(1));
        else mapKeyUp(ev.slice(1));
      } else if (onRoom) keyDown(ev.slice(1));
      else mapKeyDown(ev.slice(1));
    }
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
      // Measured BEFORE present: present waits for vsync, which is idle time, not work.
      jsMs += __native.now() - now;
      if (drawn) __native.present();
    } else {
      const shown = mapFrame(now); // the map, or the story page over it
      jsMs += __native.now() - now;
      if (shown) __native.presentTexture(shown.id);
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
