/**
 * UI test: a sprite the manifest promised and the server did not deliver must never draw
 * as a DIFFERENT sprite.
 *
 * ── The defect ────────────────────────────────────────────────────────────────
 * `loadEnhancedObjects` used to turn a frame that failed to load into `null` and then
 * compact the list:
 *
 *     const valid = frames.filter((f) => f !== null);
 *     return valid.length > 0 ? { item: e.item, frames: valid } : null;
 *
 * The renderer indexes that list by the item's animation phase —
 * `obj.frames[frameIndex(item.afaze, obj.frames.length)]` (enhancedArtSource.ts) — and
 * `frameIndex` returns `afaze` unchanged for anything in range. So dropping frame 10 of
 * SCHODY's 44-frame snail does not cost one picture: phase 11 draws frame 12, phase 12
 * draws frame 13, and every phase after the gap is wrong for as long as the room is open.
 * Nothing 404s visibly, nothing throws, and the room renders — it just animates wrongly.
 *
 * ── The oracle ────────────────────────────────────────────────────────────────
 * This asserts on the PICTURE, not on "the room rendered". The trick is to compare
 * against the render the game already produces for an object that legitimately has no
 * enhanced art — 21 sprites ship that way and draw as 1998 bitmaps inside a truecolor
 * room, which is the honest fallback:
 *
 *   A  every snail frame served      -> the correct enhanced snail
 *   E  EVERY snail frame 404s        -> the object is dropped, snail drawn classic
 *   B  exactly ONE snail frame 404s  -> the case under test
 *
 * B must be pixel-identical to E: one undeliverable frame costs the object its enhanced
 * art, and nothing else. Before the fix B was identical to neither — the snail was drawn
 * from shifted enhanced art, a picture that is neither correct nor honest.
 *
 * A != E is asserted too, as a vacuity guard: if the snail's enhanced art made no
 * difference to these pixels, B == E would prove nothing.
 *
 * Determinism: SCHODY's snail is driven by `s.random` (schody.ts), so `Math.random` is
 * pinned to a fixed sequence before boot — the same technique the unit suite uses
 * (test/rng.setup.ts) — and frames are keyed by the game's tick COUNT, so a loaded
 * machine changes how often we sample but not what any given tick looks like.
 */
import { selectRoom, withApp } from './ui-lib.mjs';

const SCHODY = 5;
const TICKS = 90; // enough for the snail's phase to run well past the hole at frame 10

/**
 * Pin Math.random to a CONSTANT before any app code runs.
 *
 * A seeded sequence is the obvious choice and it is not enough here. The three runs below
 * are separate page loads that must reach identical game states, and a sequence only does
 * that if every consumer draws from it the same number of times in the same order — which
 * the game does not guarantee, because some of its consumers are driven by the frame
 * clock rather than by the game tick. On a loaded machine the runs then diverge for a
 * reason that has nothing to do with what is being tested (measured: 38 of 66 sampled
 * ticks differing, with the fix in place and working).
 *
 * A constant removes the order dependence entirely: however many times anything draws,
 * every draw returns the same number, so the room state is a pure function of the tick
 * count. The room is still fully animated — the snail's phase is advanced by its tick
 * state machine, not by the RNG — which is what the vacuity guard below confirms.
 */
function pinRandom() {
  Math.random = () => 0.5;
}

/**
 * Sample one canvas signature per game tick, in page.
 *
 * Keying on the tick COUNT (rather than on wall-clock or a frame number) is what makes
 * this immune to a busy machine: the same tick draws the same picture however many rAFs
 * the browser managed in between.
 *
 * A tick is only USED if every sample taken during it agreed. Most of the room is a pure
 * function of the tick, but not quite all of it — the wall shimmer (wamp/wper/wspd) is
 * driven by the frame clock, so a tick that happens to straddle a shimmer step shows two
 * different pictures under the same count. Those ticks are ambiguous evidence, and there
 * is no threshold that makes them unambiguous, so they are dropped rather than tolerated:
 * an assertion over the remaining (stable) ticks is exact, and a run that cannot collect
 * enough of them fails on the sample-count check instead of quietly comparing noise.
 */
function installSampler(maxTick) {
  window.__sig = new Map(); // tick -> { hash, samples, stable }
  const cv = document.getElementById('screen');
  const g = cv.getContext('2d', { willReadFrequently: true });
  const BAND = 10; // canvas rows per band
  // One hash per horizontal BAND rather than one for the whole frame, so the comparison
  // can be confined to the bands the object under test actually paints into. The rest of
  // the stage carries animation this probe is not asking about (the wall shimmer is
  // driven by the frame clock, not the game tick), and including it makes the oracle
  // report differences that have nothing to do with the sprite.
  const hash = () => {
    const W = cv.width;
    const H = cv.height;
    if (!W || !H) return null;
    const d = g.getImageData(0, 0, W, H).data;
    const bands = [];
    for (let y0 = 0; y0 < H; y0 += BAND) {
      let h = 0x811c9dc5;
      const end = Math.min(y0 + BAND, H) * W * 4;
      for (let i = y0 * W * 4; i < end; i += 7) {
        h ^= d[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      bands.push(h);
    }
    return bands.join(',');
  };
  const step = () => {
    if (!window.__sampling) return;
    requestAnimationFrame(step);
    const ff = window.__ff;
    if (ff.screen() !== 'room' || ff.roomLoading() || ff.roomArtPending()) return;
    const t = ff.count();
    if (t > maxTick) return;
    const h = hash();
    const prev = window.__sig.get(t);
    if (prev === undefined) window.__sig.set(t, { hash: h, samples: 1, stable: true });
    else {
      prev.samples++;
      if (prev.hash !== h) prev.stable = false;
    }
  };
  window.__sampling = true;
  requestAnimationFrame(step);
}

/**
 * Boot fresh with `routes` in force, walk SCHODY for TICKS ticks, and return the
 * per-tick canvas signatures.
 */
async function run(p, globs) {
  await p.unrouteAll({ behavior: 'ignoreErrors' });
  for (const glob of globs) {
    // fulfil a 404 rather than aborting: this half is about an asset that is DEFINITELY
    // not there (a broken build), not about a blip. An abort is the other half of this
    // task and is covered by test-tier-recovery.
    await p.route(glob, (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' }));
  }
  // A reload, so nothing is served from enhancedCache: the routes only bite on a fetch
  // that actually happens.
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff !== undefined);
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await selectRoom(p, SCHODY, 0);
  await p.evaluate(installSampler, TICKS);
  await p.waitForFunction((n) => window.__ff.count() > n, TICKS);
  await p.evaluate(() => { window.__sampling = false; });
  return p.evaluate(() =>
    [...window.__sig.entries()]
      .filter(([, v]) => v.stable && v.samples >= 2)
      .map(([t, v]) => [t, v.hash]),
  );
}

/**
 * Compare two runs band by band, over the ticks both sampled reliably.
 *
 * `bands` restricts the comparison to a set of band indices; omit it to compare the whole
 * frame. Returns how many (tick, band) cells disagree, and which bands ever did.
 */
function compare(x, y, bands) {
  const a = new Map(x);
  const b = new Map(y);
  const shared = [...a.keys()].filter((t) => b.has(t));
  let cells = 0;
  let differing = 0;
  const perBand = new Map(); // band -> how many ticks it differed on
  for (const t of shared) {
    const av = a.get(t).split(',');
    const bv = b.get(t).split(',');
    const idx = bands ?? av.map((_, i) => i);
    for (const i of idx) {
      cells++;
      if (av[i] !== bv[i]) {
        differing++;
        perBand.set(i, (perBand.get(i) ?? 0) + 1);
      }
    }
  }
  // A band the art paints into differs on EVERY tick. A band that differs on one or two
  // is a band something else moved in — the game is not bit-reproducible across page
  // loads (two identical runs were measured differing on 1 tick in 90, under load), and
  // an "ever differed" rule let that noise into the set of bands being compared, which
  // then failed the assertion for a reason unrelated to the sprite.
  const always = [...perBand.entries()]
    .filter(([, n]) => n === shared.length)
    .map(([i]) => i)
    .sort((p, q) => p - q);
  const hot = [...perBand.keys()].sort((p, q) => p - q);
  return { ticks: shared.length, cells, differing, hot, always };
}

const ALL_FRAMES = ['**/enhanced/SCHODY/obj/snek_*.png'];
const ONE_FRAME = ['**/enhanced/SCHODY/obj/snek_10.png'];

await withApp(
  async ({ p, expect, allowed }) => {
    await p.addInitScript(pinRandom);

    const a = await run(p, []); // every frame served
    const e = await run(p, ALL_FRAMES); // no enhanced art for the snail at all
    const b = await run(p, ONE_FRAME); // one promised frame missing

    // Which bands does the snail's enhanced art actually paint into? Measured, not
    // assumed: they are the bands where the correct render and the no-art render differ.
    // Deriving them per session rather than hardcoding a rectangle keeps the probe honest
    // if the art or the room layout ever moves — the guard below fails loudly instead of
    // the comparison quietly looking at empty background.
    const where = compare(a, e);
    expect(where.ticks > 20, `enough ticks sampled in every run (${where.ticks})`);
    expect(where.always.length > 0, `the snail's enhanced art is visible on screen (bands ${where.always.join(',')})`);

    const be = compare(b, e, where.always);
    expect(
      be.differing === 0,
      `one undeliverable frame costs the object its enhanced art and nothing else ` +
        `(${be.differing}/${be.cells} band-ticks differ from the honest classic fallback` +
        `${be.differing ? `, bands ${be.hot.join(',')}` : ''})`,
    );
    // ...and the same measurement the other way round, so a probe that had quietly
    // stopped looking at the snail could not pass: with the art present, those bands MUST
    // differ from the no-art render.
    const ae = compare(a, e, where.always);
    expect(ae.differing > 0, `the comparison is looking at the snail (${ae.differing}/${ae.cells} band-ticks differ)`);

    // A manifest that promises a file the server does not have is a broken build, and
    // must not be silent — that is the whole difference between this case and an item
    // that is simply absent from the manifest.
    expect(
      allowed.some((t) => /\[art\].*snek_10\.png/.test(t)),
      'the missing manifest-listed sprite was reported',
    );
  },
  {
    cpu: true, // the canvas-2D backend is the only one whose pixels a probe can read
    graphics: 'enhanced',
    allowErrors: /\[art\]|Failed to load resource/,
  },
);
