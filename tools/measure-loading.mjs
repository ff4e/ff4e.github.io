/**
 * Measurement harness for the room-loading UX work (NOT part of the test suite).
 *
 * Boots the production build unthrottled, then applies a controlled "Slow 4G"
 * profile via CDP and enters cold rooms in the `ai` tier, recording:
 *   - core ready      — roomLoading() clears (FFR/FFT/FFS parsed, buildRoom done)
 *   - enhanced ready  — enhancedPending clears (truecolor art landed)
 *   - AI ready        — #screen switches to the ×4 backing store (AI compositor)
 *   - black window    — how long the stage stays black after entry
 *
 * Usage: node tools/measure-loading.mjs [--rooms 1,6] [--label before]
 */
import { chromium } from 'playwright';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const ROOMS = arg('rooms', '1,6').split(',').map(Number);
const LABEL = arg('label', 'run');
const PORT = arg('port', '4173');
// Two regimes, because they answer different questions:
//  slow4g  — 150ms RTT + 1.6 Mbps: what a player on a bad mobile link actually sees.
//  latency — 150ms RTT, bandwidth unlimited: isolates the per-file round-trip cost,
//            i.e. how much a request-count reduction (packing/parallelising) can win.
const PROFILES = {
  slow4g: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  latency: { offline: false, latency: 150, downloadThroughput: -1, uploadThroughput: -1 },
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};
const PROFILE = arg('profile', 'slow4g');
const NET = PROFILES[PROFILE];
if (!NET) throw new Error(`unknown profile ${PROFILE} (${Object.keys(PROFILES).join('|')})`);

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 640 } });
const p = await ctx.newPage();
await p.addInitScript(() => {
  try {
    localStorage.setItem('ff.options', JSON.stringify({ introSeen: true }));
    localStorage.setItem('ff.devEnabled', '1');
    localStorage.setItem('ff.renderer', 'cpu');
    localStorage.setItem('ff.graphics', 'ai');
  } catch { /* storage unavailable */ }
});

const reqs = [];
p.on('response', (r) => reqs.push({ url: r.url(), t: Date.now() }));

await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ff !== undefined, null, { timeout: 120000 });

// Let boot finish completely BEFORE throttling. Boot loads room 7 and, in the ai
// tier, kicks off its AI art + the 134-file shared fish set; throttling into the
// middle of that made every run start from a different cache state.
const settleBoot = async (quietMs = 3000, maxMs = 120000) => {
  const until = Date.now() + maxMs;
  for (;;) {
    const n = reqs.length;
    await p.waitForTimeout(quietMs);
    if (reqs.length === n || Date.now() > until) return;
  }
};
await settleBoot();

const cdp = await ctx.newCDPSession(p);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', NET);

const rows = [];
// Let the link go quiet between rooms too: otherwise room 2 is measured while room
// 1's deferred/background transfers are still consuming the (deliberately tiny)
// pipe, which is exactly the kind of noise that makes two configs incomparable.
const settle = settleBoot;
for (const num of ROOMS) {
  await p.evaluate(() => window.__ff.showMap());
  await settle();
  const before = reqs.length;
  const res = await p.evaluate(async (n) => {
    const ff = window.__ff;
    const cv = document.getElementById('screen');
    const g = cv.getContext('2d', { willReadFrequently: true });
    const t0 = performance.now();
    const m = { core: null, enh: null, ai: null, black: null, firstPaint: null };
    // Cheap non-black probe: 25 single-pixel reads on a grid, not a full frame read.
    const nonBlack = () => {
      const W = cv.width, H = cv.height;
      if (!W || !H) return false;
      for (let i = 1; i <= 5; i++)
        for (let j = 1; j <= 5; j++) {
          const d = g.getImageData(Math.floor((W * i) / 6), Math.floor((H * j) / 6), 1, 1).data;
          if (d[0] > 16 || d[1] > 16 || d[2] > 16) return true;
        }
      return false;
    };
    const sample = () => {
      const t = performance.now() - t0;
      const lit = nonBlack();
      // The black window only starts once the stage has actually been cleared —
      // before the first paint the canvas still holds the map we came from.
      if (m.black === null && !lit) m.black = t;
      if (m.firstPaint === null && m.black !== null && lit) m.firstPaint = t;
      if (m.core === null && !ff.roomLoading() && ff.roomNum() === n) m.core = t;
      if (m.enh === null && m.core !== null && !ff.throttleInfo().enhancedPending) m.enh = t;
      // Only meaningful once THIS room is the live one: until then aiRoom/room still
      // hold the room we came from, whose AI art is (of course) already active.
      if (m.ai === null && m.core !== null && ff.aiRoomActive()) m.ai = t;
      return m.core !== null && m.enh !== null && m.ai !== null && m.firstPaint !== null;
    };
    ff.enterRoom(n);
    return await new Promise((done) => {
      const deadline = t0 + 180000;
      const step = () => {
        if (sample() || performance.now() > deadline) done({ ...m, total: performance.now() - t0 });
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, num);
  const fetched = reqs.slice(before);
  rows.push({ num, ...res, requests: fetched.length, aiFiles: fetched.filter((r) => r.url.includes('/enhanced-ai/')).length });
  await p.waitForTimeout(500);
}

const fmt = (v) => (v === null ? '   n/a' : `${(v / 1000).toFixed(2)}s`);
console.log(`\n=== ${LABEL} — ${PROFILE} (${NET.latency}ms RTT, ${NET.downloadThroughput < 0 ? 'unlimited' : '1.6Mbps'} down) ===`);
console.log('room | core   | enhanced | AI     | black window | enh→AI gap | reqs (ai)');
for (const r of rows) {
  const gap = r.ai !== null && r.enh !== null ? r.ai - r.enh : null;
  const black = r.firstPaint !== null && r.black !== null ? r.firstPaint - r.black : null;
  console.log(
    `${String(r.num).padStart(4)} | ${fmt(r.core)} | ${fmt(r.enh).padStart(8)} | ${fmt(r.ai)} | ${fmt(black).padStart(12)} | ${fmt(gap).padStart(10)} | ${r.requests} (${r.aiFiles})`,
  );
}
console.log(JSON.stringify(rows));
await b.close();
