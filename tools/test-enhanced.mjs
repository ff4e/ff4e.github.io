/**
 * UI test: enhanced (truecolor) graphics. Verifies — across a diverse set of
 * rooms — that enhanced mode ACTUALLY renders truecolor (not a silent fallback
 * to classic), that the toggle flips both ways, and that classic stays intact.
 *
 * The colour-count assertion is what catches "silent fallback" regressions like
 * the dev-server SPA-fallback bug: if enhanced quietly reverted to classic, the
 * rendered frame would have ~the same (few hundred) colours as classic instead
 * of thousands.
 */
import { selectRoom, withApp } from './ui-lib.mjs';

/** Count unique RGB colours currently on the room canvas. */
async function canvasColors(p) {
  return p.evaluate(() => {
    const c = document.getElementById('screen');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const s = new Set();
    for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return s.size;
  });
}

/**
 * Install a cheap canvas signature in the page — sparse enough to poll a few
 * times a second, dense enough that any repaint changes it.
 */
async function installSig(p) {
  await p.evaluate(() => {
    window.__sig = () => {
      const c = document.getElementById('screen');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261;
      let uniform = true;
      for (let i = 0; i < d.length; i += 4 * 149) {
        h = Math.imul(h ^ d[i], 16777619);
        h = Math.imul(h ^ d[i + 1], 16777619);
        h = Math.imul(h ^ d[i + 2], 16777619);
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) uniform = false;
      }
      return { h: h >>> 0, uniform };
    };
  });
}

const sigNow = (p) => p.evaluate(() => window.__sig().h);

/**
 * Wait until the room canvas holds a real, newly painted frame: different from
 * `prev` AND not a flat fill.
 *
 * Both halves matter. The renderer skips repaints for an unchanged idle room, so
 * without the "different" half we would read the previous room's frame. And while
 * a room loads, the loop paints the stage solid black (main.ts, `roomLoading`) —
 * that black IS a repaint and satisfies "different", which is how a parallel run
 * read `enh=1` colours off a blank canvas. Requiring a non-uniform frame skips
 * past the clear to the first frame that actually has art in it.
 *
 * This is only a "the new frame is on the canvas" gate — it says nothing about
 * WHICH art was drawn, so the truecolor assertions below still do all the
 * judging: a silent fallback to classic paints a non-uniform frame too, and
 * would still fail them.
 */
async function waitRepaint(p, prev) {
  await p.waitForFunction(
    (old) => {
      const s = window.__sig();
      return !s.uniform && s.h !== old;
    },
    prev,
    { polling: 100, timeout: 30000 },
  );
}

async function setMode(p, mode) {
  const before = await sigNow(p);
  await p.evaluate((m) => window.__ff.setGraphics(m), mode);
  await waitRepaint(p, before);
}

await withApp(async ({ p, expect }) => {
  await installSig(p);

  // Rooms with a truecolor wall master: enhanced must render far more colours
  // than classic. Includes STEEL (multi-frame red-alert art) and DRAKAR1
  // (spec=10 mirrored objects).
  const rooms = [
    [3, 'PRAVIDLA'],
    [55, 'STEEL'],
    [63, 'JESKYNE'],
    [13, 'DRAKAR1'],
    [24, 'KNIHOVNA'],
  ];

  for (const [num, name] of rooms) {
    const before = await sigNow(p);
    await selectRoom(p, num);
    await p.evaluate((m) => window.__ff.setGraphics(m), 'enhanced');
    // Wait for the art to load (fails loudly if it never does — the fallback bug).
    const loaded = await p
      .waitForFunction(() => window.__ff && window.__ff.enhancedActive && window.__ff.enhancedActive(), {
        timeout: 12000,
      })
      .then(() => true)
      .catch(() => false);
    expect(loaded, `${name}: enhanced active (art loaded)`);
    await waitRepaint(p, before);
    const enh = await canvasColors(p);

    await setMode(p, 'classic');
    expect(!(await p.evaluate(() => window.__ff.enhancedActive())), `${name}: classic after toggle`);
    const cla = await canvasColors(p);

    // Real truecolor art has thousands of colours; classic is palette-crushed
    // (a few hundred). A silent fallback would make these ~equal.
    expect(
      enh > cla * 3 && enh > 1500,
      `${name}: enhanced is truecolor (enh=${enh} colours vs classic=${cla})`,
    );

    await setMode(p, 'enhanced');
    expect(await p.evaluate(() => window.__ff.enhancedActive()), `${name}: enhanced restored`);
  }

  // Default-on: a freshly entered room boots in enhanced.
  const before = await sigNow(p);
  await selectRoom(p, 3);
  await waitRepaint(p, before);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'enhanced', 'defaults to enhanced');
}, { cpu: true });
