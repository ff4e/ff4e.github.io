/**
 * Enhanced (vector) subtitle benchmark — the cost of the #subs overlay.
 *
 *   Usage: node tools/bench-subtitles.mjs [--rooms a,b] [--frames N] [--dpr N]
 *
 * Two measurements, both with a long line on screen:
 *
 *  1. MICRO — `__ff.benchSubs()` times the exact per-frame overlay work draw()
 *     does (full clear + drawVector at the display scale), with a 1x1 readback
 *     per iteration so the 2D commands really rasterize inside the timed window.
 *     Reported for a settled line (wave finished) and an animating one (the tick
 *     advances every iteration, i.e. every glyph gets a fresh dy).
 *  2. MACRO — real rAF frame intervals while the game runs with a subtitle up
 *     and the idle saver off, so the loop paints every frame: mean/p95 frame time
 *     and the share of frames that missed the 16.7ms budget ("jank").
 *
 * Not a pass/fail test — a report. Numbers are host/GPU/DPR dependent; compare
 * runs on the same machine.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
const args = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const FRAMES = num('--frames', 200);
const DPR = num('--dpr', 2);
const ratesArg = args.indexOf('--rates');
const RATES = ratesArg >= 0 ? args[ratesArg + 1].split(',').map(Number) : [1, 6];
const roomsArg = args.indexOf('--rooms');
const ROOMS = roomsArg >= 0 ? args[roomsArg + 1].split(',').map(Number) : [7];

// A long line: 4 subtitle rows' worth of characters, the worst realistic case.
const LONG = 'Careful now, the whole cavern is about to collapse on top of us both!';
const LONG2 = 'Stop shoving me around, you overgrown sardine, I can see it perfectly well!';

const b = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
});
const p = await b.newPage({
  viewport: { width: num('--width', 1512), height: num('--height', 900) },
  deviceScaleFactor: DPR,
});
p.on('pageerror', (e) => console.log('PE:', e.message));
await p.addInitScript(() => {
  try {
    const o = JSON.parse(localStorage.getItem('ff.options') || '{}');
    o.introSeen = true;
    localStorage.setItem('ff.options', JSON.stringify(o));
    localStorage.setItem('ff.renderOnDirty', '0'); // paint every frame: the worst case
    localStorage.setItem('ff.graphics', 'enhanced');
  } catch {
    /* storage unavailable */
  }
});
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ff !== undefined, null, { timeout: 60000 });
await p.evaluate(() => window.__ff.setGraphics('enhanced'));

const cdp = await p.context().newCDPSession(p);
/** Emulate a slower CPU (1 = host speed). The M-series host never janks otherwise. */
async function throttle(rate) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/** rAF frame intervals over `ms`, plus the overlay-redraw rate over the same window. */
async function frameStats(ms) {
  return p.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const d = [];
        let prev = 0;
        const step = (t) => {
          if (prev) d.push(t - prev);
          prev = t;
          if (d.length && t - start > dur) {
            d.sort((a, b) => a - b);
            const mean = d.reduce((a, b) => a + b, 0) / d.length;
            const secs = (t - start) / 1000;
            resolve({
              n: d.length,
              mean,
              median: d[Math.floor(d.length / 2)],
              p95: d[Math.floor(d.length * 0.95)],
              jank: d.filter((x) => x > 20).length / d.length,
              fps: d.length / secs,
              paints: (window.__ff.subPaints() - paints0) / secs,
            });
            return;
          }
          requestAnimationFrame(step);
        };
        const start = performance.now();
        const paints0 = window.__ff.subPaints();
        requestAnimationFrame(step);
      }),
    ms,
  );
}

const dpr = await p.evaluate(() => window.devicePixelRatio || 1);
console.log(`\n  Fish Fillets — enhanced subtitle overlay benchmark   dpr=${dpr}  frames=${FRAMES}`);

for (const roomNum of ROOMS) {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), roomNum);
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 20, { timeout: 12000 });
  await p.waitForFunction(() => window.__ff.subFontReady(), { timeout: 12000 }).catch(() => {});
  await p.waitForTimeout(150);

  const pushLines = async () => {
    // Worst realistic case: a full stack of subtitle rows (two speakers talking
    // over each other), not a single line.
    await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), LONG);
    await p.evaluate((s) => window.__ff.pushSubtitle(s, 'V'), LONG2);
    await p.waitForTimeout(2200); // let the wave-in settle so the lines are fully shown
  };

  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.waitForTimeout(200);
  await pushLines();
  const settled = await p.evaluate((f) => window.__ff.benchSubs(f), FRAMES);
  const animating = await p.evaluate((f) => window.__ff.benchSubs(f, 20, window.__ff.count(), true), FRAMES);

  /** The four macro scenarios at one CPU-throttling rate. */
  async function macro(rate, gate) {
    await p.evaluate((g) => window.__ff.setSubsGate(g), gate);
    await throttle(rate);
    const win = rate > 1 ? 3000 : 2000;
    await p.evaluate(() => window.__ff.clearSubtitles());
    await p.waitForTimeout(300);
    const still0 = await frameStats(win);
    // Measured DURING the wave-in, which is the only phase that animates between
    // logic ticks (and so the only phase that still repaints the overlay often).
    await p.evaluate(() => window.__ff.clearSubtitles());
    await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), LONG);
    await p.evaluate((s) => window.__ff.pushSubtitle(s, 'V'), LONG2);
    const wave = await frameStats(1500);
    await p.waitForTimeout(1200);
    const still1 = await frameStats(win);
    // The scenario that actually stutters: the fish is SWIMMING (so the loop paints
    // every rAF, not once per logic tick) while a subtitle is on screen.
    await p.evaluate(() => window.__ff.clearSubtitles());
    await p.keyboard.down('ArrowRight');
    await p.waitForTimeout(500);
    const move0 = await frameStats(win);
    await pushLines();
    const move1 = await frameStats(win);
    await p.keyboard.up('ArrowRight');
    await p.waitForTimeout(300);
    await throttle(1);
    return { still0, wave, still1, move0, move1 };
  }

  const macros = [];
  for (const rate of RATES) {
    for (const gate of [false, true]) macros.push([rate, gate, await macro(rate, gate)]);
  }
  await p.evaluate(() => window.__ff.setSubsGate(true));

  const name = await p.evaluate(() => (document.getElementById('info').textContent || '').split('—')[0].trim());
  console.log(
    `\n  room ${roomNum} ${name}   overlay ${settled?.overlay}   ${settled?.chars} chars / ${settled?.lines} lines on screen`,
  );
  console.log('  ' + '─'.repeat(74));
  console.log('  MICRO  per-frame overlay cost (clear + drawVector + flush), ms');
  for (const [label, r] of [
    ['settled lines', settled],
    ['animating    ', animating],
  ]) {
    if (!r) continue;
    console.log(
      `    ${label}  min ${r.min.toFixed(2)}   median ${r.median.toFixed(2)}   mean ${r.mean.toFixed(2)}   p95 ${r.p95.toFixed(2)}`,
    );
  }
  if (settled) {
    console.log(
      `    control: clear+flush only  median ${settled.clearOnly.median.toFixed(2)}` +
        `    drawVector without flush  median ${settled.noFlush.median.toFixed(2)}`,
    );
  }
  console.log('  MACRO  rAF frame interval, ms (saver off → the loop paints every frame)');
  for (const [rate, gate, m] of macros) {
    console.log(`    CPU throttle x${rate}   repaint gate ${gate ? 'ON  (this branch)' : 'off (pre-fix behaviour)'}`);
    for (const [label, r] of [
      ['still, none  ', m.still0],
      ['waving subs  ', m.wave],
      ['settled subs ', m.still1],
      ['moving, none ', m.move0],
      ['moving, subs ', m.move1],
    ]) {
      console.log(
        `      ${label}  median ${r.median.toFixed(1).padStart(6)}   mean ${r.mean.toFixed(1).padStart(6)}` +
          `   p95 ${r.p95.toFixed(1).padStart(6)}   jank>20ms ${(r.jank * 100).toFixed(1).padStart(5)}%` +
          `   ${r.fps.toFixed(0).padStart(3)} fps   overlay redraws/s ${r.paints.toFixed(0).padStart(3)}`,
      );
    }
  }
}

await b.close();
