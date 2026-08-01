/**
 * `ai`-tier CPU↔GPU room parity, plus the guard that the tier reaches the GPU at all.
 *
 * The AI tier composites at ×S from staged hi-res art, through the SAME room walk
 * (AiRoom.drawInto) on both backends: canvas-2D (Canvas2dAiTarget, the oracle and the
 * no-WebGL2 fallback) and GlAiScreen. This probe renders both for every room and diffs
 * them, exactly as test-gl-room.mjs does for the classic tier.
 *
 * ── The gate, and why it is not max === 0 ─────────────────────────────────────
 * The classic/enhanced oracle (RgbaScreen) is pure JS with rounding this repo defines,
 * so those probes can demand byte-equality. This oracle is the BROWSER's canvas-2D
 * `drawImage`, which blends in premultiplied space with rounding no specification pins
 * down, against GL's own blend. A ±1 disagreement on an anti-aliased sprite edge is
 * therefore expected and is not a defect.
 *
 * Measured across all 71 AI-art rooms on this build: 70 rooms are byte-exact (max = 0)
 * and one (room 9) differs by 1 on a single channel of a single pixel. So the gate is
 * max ≤ 1 with ZERO pixels off by more than 2 — tight enough that the bug this probe
 * was written against still fails it loudly. That bug is worth recording: the staged
 * art was being decoded to PREMULTIPLIED ImageBitmaps, the GPU multiplied by alpha
 * again, and every anti-aliased edge darkened toward the background — max = 64, but
 * only 0.004 % of pixels, so a loose "average looks fine" gate would have shipped it.
 *
 * Runs its own headless Chromium with ANGLE so WebGL2 is available; if the environment
 * has no WebGL2 it skips (pass), so CI without a GPU still passes.
 */
import { exitProbe, gotoApp, launchBrowser, waitRoom } from './ui-lib.mjs';

const MAX_CHANNEL_DELTA = 1; // see the header: browser-vs-GL blend rounding, nothing more
const ROOMS = 72;

const b = await launchBrowser({ gl: true });
const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => {
  try {
    const o = JSON.parse(localStorage.getItem('ff.options') || '{}');
    o.introSeen = true;
    localStorage.setItem('ff.options', JSON.stringify(o));
    // This probe is about the ai tier specifically, and about it running on the GPU.
    localStorage.setItem('ff.graphics', 'ai');
    localStorage.setItem('ff.renderer', 'webgl');
  } catch {}
});
await gotoApp(p);
await p.waitForFunction(() => window.__ff && window.__ff.count);

/** Wait until the room is built AND its AI art has landed (the tier holds the frame). */
async function enter(num) {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await waitRoom(p, 15);
  await p.waitForFunction(() => window.__ff.roomArtPending() === false, { timeout: 30000 });
}

let ok = true;
let tested = 0, noArt = 0, worstMax = 0, worstRoom = 0, exact = 0;
const cpuRooms = [];

await enter(3);
const cap = await p.evaluate(() => window.__ff.aiGlParity());
if (!cap || cap.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  exitProbe(0);
}

for (let num = 1; num <= ROOMS; num++) {
  try {
    await enter(num);
    // 1. The regression this whole path exists for: with renderer=webgl and the art
    //    loaded, the DEFAULT tier must actually paint on the GPU. It used to report
    //    `webgl` while canvas-2D did the painting, in 70 of these 72 rooms.
    const live = await p.evaluate(() => ({
      aiLoaded: window.__ff.aiRoomLoaded(),
      aiActive: window.__ff.aiRoomActive(),
      backend: window.__ff.roomBackend(),
      glActive: window.__ff.glActive(),
    }));
    if (live.aiActive && live.backend !== 'webgl') {
      ok = false;
      cpuRooms.push(num);
      console.log(`  FAIL room ${num}: ai frame painted on ${live.backend}, not the GPU`);
    }
    if (live.aiActive && live.glActive !== (live.backend === 'webgl')) {
      ok = false;
      console.log(`  FAIL room ${num}: glActive()=${live.glActive} contradicts backend=${live.backend}`);
    }

    // 2. CPU↔GPU pixel parity of the ×S composite. A room with no staged AI art has
    //    nothing for this tier to composite (room 72) — it renders through the normal
    //    compositor, which test-gl-room covers.
    if (!live.aiLoaded) { noArt++; continue; }
    const r = await p.evaluate(() => window.__ff.aiGlParity());
    if (!r) { ok = false; console.log(`  FAIL room ${num}: no parity result`); continue; }
    if (!r.webgl) { ok = false; console.log(`  FAIL room ${num}: WebGL vanished mid-run`); continue; }
    if (r.noCanvas) { ok = false; console.log(`  FAIL room ${num}: no 2D oracle context`); continue; }
    if (r.dimMismatch) { ok = false; console.log(`  FAIL room ${num}: dim mismatch`); continue; }
    tested++;
    if (r.max === 0) exact++;
    if (r.max > worstMax) { worstMax = r.max; worstRoom = num; }
    if (r.max > MAX_CHANNEL_DELTA || r.overPct > 0) {
      ok = false;
      console.log(
        `  FAIL room ${num}: max=${r.max} overPct=${r.overPct.toFixed(4)}% rmse=${r.rmse.toFixed(3)} ` +
          `worst at ${JSON.stringify(r.worstAt)} cpu=${JSON.stringify(r.worstCpu)} gpu=${JSON.stringify(r.worstGpu)}`,
      );
    }
  } catch (e) {
    ok = false;
    console.log(`  FAIL room ${num}: ${String(e).slice(0, 80)}`);
  }
}

// 3. The room's on-screen geometry must not depend on which backend painted it. The
//    GPU path leaves #screen at NATIVE size (nothing paints into it) while the
//    canvas-2D path sizes it to the ×S backing store; both must still present the same
//    CSS box, or toggling R would nudge the room and everything stacked over it.
try {
  await enter(3);
  const boxes = {};
  for (const mode of ['webgl', 'cpu']) {
    await p.evaluate((m) => window.__ff.setRenderer(m), mode);
    await p.waitForTimeout(300);
    boxes[mode] = await p.evaluate(() => {
      const r = (id) => {
        const e = document.getElementById(id);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return [Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.width * 100), Math.round(b.height * 100)];
      };
      return { screen: r('screen'), panel: r('panel') };
    });
  }
  await p.evaluate(() => window.__ff.setRenderer('webgl'));
  if (JSON.stringify(boxes.webgl) !== JSON.stringify(boxes.cpu)) {
    ok = false;
    console.log(`  FAIL layout: webgl=${JSON.stringify(boxes.webgl)} cpu=${JSON.stringify(boxes.cpu)}`);
  }
} catch (e) {
  ok = false;
  console.log(`  FAIL layout: ${String(e).slice(0, 80)}`);
}

// 4. The dissolving skeleton (KresliK's RANDPOLE dither) is the one primitive no
//    resting frame reaches — it needs a crushed fish. Its erosion pattern is a
//    per-original-pixel threshold, so a scale or row/column mix-up in the shader turns
//    into a subtly different pattern that the room sweep above cannot see at all.
try {
  await enter(1);
  await p.evaluate(() => window.__ff.killFish('little'));
  await p.waitForTimeout(200);
  const d = await p.evaluate(() => window.__ff.aiGlParity());
  if (!d || !d.webgl) {
    ok = false;
    console.log('  FAIL dissolve: no parity result');
  } else if (d.max > MAX_CHANNEL_DELTA || d.overPct > 0) {
    ok = false;
    console.log(`  FAIL dissolve: max=${d.max} overPct=${d.overPct.toFixed(4)}% worst at ${JSON.stringify(d.worstAt)}`);
  } else {
    console.log(`  dissolving skeleton: max=${d.max}`);
  }
} catch (e) {
  ok = false;
  console.log(`  FAIL dissolve: ${String(e).slice(0, 80)}`);
}

// 5. A blow-up guard on the GPU path's per-frame cost.
//
//    NOT a performance target — this suite runs eight browsers at once and any tight
//    bound would just flake. It is deliberately loose enough to survive a fully loaded
//    machine while still catching the class of regression that would otherwise pass
//    every assertion above: something per-frame and synchronous sneaking into the GPU
//    path (a full-FBO readback, a re-upload of the room's art, a stall) turns 0.3 ms
//    into tens of ms, which no amount of machine load explains. Measured on an idle M4:
//    0.26-0.39 ms GPU against 0.26-0.51 ms canvas-2D (tools/bench-ai-room.mjs) — the
//    two are near parity per frame, so do not read the 3x bound as a speed claim.
try {
  await enter(3);
  const bench = await p.evaluate(() => window.__ff.aiRenderBench(30));
  if (!bench || bench.gpuMs === null) {
    ok = false;
    console.log('  FAIL bench: no GPU timing');
  } else {
    console.log(`  frame cost ${bench.w}x${bench.h}: cpu ${bench.cpuMs.toFixed(2)} ms  gpu ${bench.gpuMs.toFixed(2)} ms`);
    if (!(bench.gpuMs < bench.cpuMs * 3)) {
      ok = false;
      console.log(`  FAIL bench: gpu ${bench.gpuMs.toFixed(2)} ms is not below 3x cpu ${bench.cpuMs.toFixed(2)} ms`);
    }
  }
} catch (e) {
  ok = false;
  console.log(`  FAIL bench: ${String(e).slice(0, 80)}`);
}

if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(
  `  ai rooms tested=${tested} byteExact=${exact} noAiArt=${noArt} worstMax=${worstMax} (room ${worstRoom})` +
    (cpuRooms.length ? ` cpuFallbackRooms=[${cpuRooms.join(',')}]` : ''),
);
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
exitProbe(ok ? 0 : 1);
