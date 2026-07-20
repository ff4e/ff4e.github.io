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
import { withApp } from './ui-lib.mjs';

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

async function setMode(p, mode) {
  await p.evaluate((m) => window.__ff.setGraphics(m), mode);
  await p.waitForTimeout(150);
}

await withApp(async ({ p, expect }) => {
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
    await p.selectOption('#room', String(num));
    await p.evaluate((m) => window.__ff.setGraphics(m), 'enhanced');
    // Wait for the art to load (fails loudly if it never does — the fallback bug).
    const loaded = await p
      .waitForFunction(() => window.__ff && window.__ff.enhancedActive && window.__ff.enhancedActive(), {
        timeout: 12000,
      })
      .then(() => true)
      .catch(() => false);
    expect(loaded, `${name}: enhanced active (art loaded)`);
    await p.waitForTimeout(150);
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
  await p.selectOption('#room', '3');
  await p.waitForTimeout(300);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'enhanced', 'defaults to enhanced');
}, { cpu: true });
