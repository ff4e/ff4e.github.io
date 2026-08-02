/**
 * `ai`-tier room compositor benchmark — canvas-2D against the GPU, per ×S frame.
 *
 *   Usage: node tools/bench-ai-room.mjs [--rooms a,b,c] [--frames N] [--dpr N] [--repeat N]
 *
 * Reports the MARGINAL cost of one ×S room frame on each backend, via
 * `__ff.aiRenderBench()` (see its comment for why the measurement is differenced rather
 * than divided — a single drained run folds a fixed sync cost into the per-frame number
 * and the answer then changes with the frame count).
 *
 * What this does NOT measure is the other half of the win: the canvas-2D path hands the
 * browser a ×S canvas to rescale into the room's box on every presented frame, while
 * the GPU path presents straight into it. That cost lives in the compositor, not in the
 * page, so it shows up as frame rate on a loaded machine rather than in either number
 * here.
 *
 * Not a pass/fail test — a report. Numbers are host/GPU/DPR dependent; compare runs on
 * the same machine. The suite's own blow-up guard lives in tools/test-gl-room-ai.mjs.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
const args = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const FRAMES = num('--frames', 30);
const DPR = num('--dpr', 2);
const REPEAT = num('--repeat', 3);
const roomsArg = args.indexOf('--rooms');
// 3 and 10 are among the largest backing stores in the game (2400×2100 and 3120×1980);
// 55 is mid-sized, so the three together show how the cost tracks the buffer.
const ROOMS = roomsArg >= 0 ? args[roomsArg + 1].split(',').map(Number) : [3, 10, 55];

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: DPR });
p.on('pageerror', (e) => console.log('page error:', e.message));
await p.addInitScript(() => {
  try {
    const o = JSON.parse(localStorage.getItem('ff.options') || '{}');
    o.introSeen = true;
    localStorage.setItem('ff.options', JSON.stringify(o));
    localStorage.setItem('ff.graphics', 'ai');
    localStorage.setItem('ff.renderer', 'webgl');
  } catch {}
});
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ff && window.__ff.count, null, { timeout: 60000 });

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`ai room compositor, ${FRAMES} frames/sample x${REPEAT}, dpr ${DPR} (median)\n`);
for (const numRoom of ROOMS) {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), numRoom);
  await p.waitForFunction(() => window.__ff.roomLoading() === false, null, { timeout: 30000 });
  await p.waitForFunction(() => window.__ff.roomArtPending() === false, null, { timeout: 60000 });
  await p.waitForTimeout(400);
  const cpu = [];
  const gpu = [];
  let size = '';
  for (let i = 0; i < REPEAT; i++) {
    const r = await p.evaluate((f) => window.__ff.aiRenderBench(f), FRAMES);
    if (!r) { console.log(`  room ${numRoom}: no AI art`); break; }
    size = `${r.w}x${r.h}`;
    cpu.push(r.cpuMs);
    if (r.gpuMs !== null) gpu.push(r.gpuMs);
  }
  if (!cpu.length) continue;
  const c = median(cpu);
  const g = gpu.length ? median(gpu) : null;
  console.log(
    `  room ${String(numRoom).padStart(2)} ${size.padEnd(10)} canvas-2D ${c.toFixed(2)} ms  ` +
      (g === null ? 'gpu n/a (no WebGL2)' : `gpu ${g.toFixed(2)} ms  (${(c / g).toFixed(1)}x)`),
  );
}

await b.close();
process.exit(0);
