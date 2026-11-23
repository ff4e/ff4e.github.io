/**
 * Native entry, driven by the C host (native/host/main.c). Three modes:
 *
 *   ff4e-native <bundle.js> --root <public dir> [--room N] [--demo] [--seconds S] [--store F]
 *     the game (`game.ts`): starts in room N, or where the store says the player left off,
 *     and goes on to the next room on every win. --demo plays every room's recorded
 *     solution through the real loop instead of reading input. Controls: native/README.md.
 *   ff4e-native <bundle.js> --root <public dir> --headless --smoke ROOMS [--smoke-player ROOMS] --store F
 *     the smoke gate (`smoke.ts`): plays rooms through the real flow, headless, and exits
 *     non-zero unless each one is won.
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
import { advance, blur, draw, enterRoom, firstRoom, initGame, keyDown, keyUp } from './game.js';
import { runSmoke } from './smoke.js';

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
  await enterRoom(arg('--room') ? Number(arg('--room')) : firstRoom());
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
  g.__frame = (): void => {
    const now = __native.now();
    for (const ev of __native.events()) {
      if (ev === '!blur') blur();
      else if (ev[0] === '-') keyUp(ev.slice(1));
      else if (!keyDown(ev.slice(1))) {
        __native.quit();
        return;
      }
    }
    if (now >= stopAt) {
      __native.quit();
      return;
    }
    const alpha = advance(now - last);
    last = now;
    const drawn = draw(target, alpha);
    // Measured BEFORE present: present waits for vsync, which is idle time, not work.
    jsMs += __native.now() - now;
    if (drawn) __native.present();
    frames++;
    if (now - statAt >= 5000) {
      console.log(`${(frames * 1000 / (now - statAt)).toFixed(0)} fps, game logic + room walk + GPU command encoding ${(jsMs / frames).toFixed(2)} ms/frame`);
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
