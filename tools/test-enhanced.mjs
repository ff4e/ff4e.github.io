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
import { observed, selectRoom, withApp } from './ui-lib.mjs';

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
 * Install a cheap canvas "is anything actually drawn here" probe. While a room
 * loads, the loop paints the stage solid black (main.ts, `roomLoading`), so a
 * flat canvas means "no art yet" — which is how an early version of this probe
 * once sampled `enh=1` colour.
 */
async function installSig(p) {
  await p.evaluate(() => {
    window.__uniform = () => {
      const c = document.getElementById('screen');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4 * 149) {
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false;
      }
      return true;
    };
  });
}

/**
 * Wait until the room canvas actually holds a frame drawn in `mode`.
 *
 * Sampling pixels after a fixed sleep is a guess, and comparing frame hashes is
 * not good enough either: STEEL's red-alert art animates every tick, so "the
 * frame changed" is satisfied by the animation rather than by the mode switch —
 * that is how a classic sample once came back with 4218 colours (i.e. still the
 * enhanced frame). So ask the renderer directly. `paintedRoomSig()` is the
 * signature of the last frame the room-draw path actually painted; we require it
 * to name `mode` with no enhanced-art hold outstanding, plus a non-flat canvas.
 *
 * This is only a "the right frame is up" gate — it never looks at pixel CONTENT,
 * so the truecolor assertions below still do all the judging: a silent fallback
 * to classic paints a perfectly good frame here and still fails them.
 */
async function waitPainted(p, mode) {
  await p.waitForFunction(
    (m) => {
      const [, pending, graphics] = window.__ff.paintedRoomSig().split('|');
      return graphics === m && pending === '0' && !window.__uniform();
    },
    mode,
    { polling: 100 },
  );
}

async function setMode(p, mode) {
  await p.evaluate((m) => window.__ff.setGraphics(m), mode);
  await waitPainted(p, mode);
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
    await selectRoom(p, num);
    await p.evaluate((m) => window.__ff.setGraphics(m), 'enhanced');
    // Wait for the art to load (fails loudly if it never does — the fallback bug).
    const loaded = await observed(
      p.waitForFunction(() => window.__ff && window.__ff.enhancedActive && window.__ff.enhancedActive()),
    );
    expect(loaded, `${name}: enhanced active (art loaded)`);
    await waitPainted(p, 'enhanced');
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
  await selectRoom(p, 3);
  await waitPainted(p, 'enhanced');
  expect((await p.evaluate(() => window.__ff.graphics())) === 'enhanced', 'defaults to enhanced');
}, { cpu: true });
