/**
 * Native spike entry: one room on the AI tier, driven by the C host (native/host/main.c).
 *
 *   ff4e-native <bundle.js> --root <public dir> [--room N] [--demo] [--seconds S]
 *     interactive: arrows / d-pad / left stick move the active fish, Space / Ⓐ switches
 *     fish, Esc / Ⓑ quits. --demo plays the room's recorded solution instead of the pad;
 *     --seconds quits after S seconds (smoke tests).
 *   ff4e-native <bundle.js> --root <public dir> --room N --headless --out f.rgba
 *     [--replay TICKS] [--still] [--alpha A] [--probe]
 *     renders ONE composite and writes it, for comparison with the browser's GlAiScreen.
 */
import { runTimers, readBytes } from './shims.js';
import { RANDPOLE } from '../../src/render/framebuffer.js';
import { NativeAiScreen } from './nativeAiScreen.js';
import { compositeSize, frameFor, loadScene, pinRandom, probeFrame, replaySolution, solutionSteps, tick, type Scene } from './scene.js';

const LOGIC_MS = 80; // src/app/stageGeometry.ts LOGIC_MS — TRoom.Jedeme's 0.08 s step

const argv = __native.args();
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string): boolean => argv.includes(name);

const g = globalThis as Record<string, unknown>;

async function main(): Promise<void> {
  const num = Number(arg('--room') ?? 1);
  __native.setRandTable(RANDPOLE.slice().buffer);
  if (flag('--headless')) pinRandom(1); // identical state to the browser reference
  const t0 = __native.now();
  const scene = await loadScene(num, readBytes);
  console.log(`room #${scene.num} ${scene.jmeno}: AI art ×${scene.ai.scale}, loaded in ${(__native.now() - t0).toFixed(0)} ms`);
  const target = new NativeAiScreen();

  if (flag('--headless')) {
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
    return;
  }
  runInteractive(scene, target);
}

function runInteractive(s: Scene, target: NativeAiScreen): void {
  const { w, h } = compositeSize(s);
  const demo = flag('--demo') ? solutionSteps(s) : null;
  let demoAt = 0;
  const stopAt = arg('--seconds') ? __native.now() + Number(arg('--seconds')) * 1000 : Infinity;
  let last = __native.now();
  let acc = 0;
  let jsMs = 0;
  let frames = 0;
  let statAt = last;
  g.__frame = (): void => {
    const now = __native.now();
    acc += now - last;
    last = now;
    const pressed = __native.pressed();
    if (pressed & 2 || now >= stopAt) { __native.quit(); return; }
    if (pressed & 1) s.active = s.active === 'little' ? 'big' : 'little';
    // At most a few catch-up ticks, so a stall (window drag) does not fast-forward the room.
    for (let n = 0; acc >= LOGIC_MS && n < 4; n++) {
      acc -= LOGIC_MS;
      if (demo) {
        if (tick(s, demoAt < demo.length ? demo[demoAt]! : null)) demoAt++;
      } else {
        const dir = __native.heldDir();
        tick(s, dir ? { which: s.active, dir } : null);
      }
    }
    if (acc > LOGIC_MS) acc = 0;
    target.begin(w, h);
    s.ai.drawInto(target, s.room, frameFor(s, acc / LOGIC_MS));
    // Measured BEFORE present: present waits for vsync, which is idle time, not work.
    jsMs += __native.now() - now;
    __native.present();
    frames++;
    if (now - statAt >= 2000) {
      console.log(`${(frames * 1000 / (now - statAt)).toFixed(0)} fps, game logic + room walk + GPU command encoding ${(jsMs / frames).toFixed(2)} ms/frame, ` +
        `tick ${s.count}, active ${s.active}, phase ${s.engine.phase}`);
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
