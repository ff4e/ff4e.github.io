/**
 * UI test: clicking in the room moves the fish — in EVERY graphics tier.
 *
 * Room clicks are converted to game cells by cellFromEvent, which divides by FSIZE, a
 * NATIVE cell size. It used to scale the pointer by `canvas.width / rect.width`, i.e.
 * into BACKING-STORE pixels. Those are the same thing in classic and enhanced, but the
 * ai tier renders at x4, so every click landed four times too far right and down and
 * mouse control of the fish was completely broken in that tier — while the keyboard
 * kept working, so nothing looked obviously wrong.
 *
 * Asserts behaviour (the fish steps toward the click) rather than the arithmetic, so it
 * stays honest if the conversion is rewritten.
 */
import { withApp } from './ui-lib.mjs';

const TIERS = ['classic', 'enhanced', 'ai'];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());

  for (const tier of TIERS) {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.evaluate(() => window.__ff.enterRoomAwait(1));
    await p.waitForFunction(() => window.__ff.roomNum() === 1);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier);
    await p.waitForFunction(() => window.__ff.phase() === 'idle');

    const st = await p.evaluate(() => window.__ff.state());
    expect(st.little !== null && st.big !== null, `[${tier}] both fish are present`);

    /** Client coords of the CENTRE of a native game cell. */
    const clientOf = (cx, cy) => p.evaluate(([gx, gy]) => {
      const c = document.querySelector('#screen');
      const r = c.getBoundingClientRect();
      const F = window.__ff.fsize();
      const g = window.__ff.roomGeom();        // native/css/backing sizes
      const nx = gx * F + F / 2;
      const ny = gy * F + F / 2;
      return { x: r.left + (nx / g.nativeW) * r.width, y: r.top + (ny / g.nativeH) * r.height };
    }, [cx, cy]);

    // A LEFT click on a fish selects it (akce_set). Deterministic: no pathfinding, no
    // walls, no animation — it depends only on the click landing in the right CELL.
    // Select the OTHER fish first so the assertion cannot pass by accident.
    const other = st.active === 'little' ? 'big' : 'little';
    const o = st[other];
    const a = await clientOf(o.x, o.y);
    await p.mouse.click(a.x, a.y);
    await p.waitForFunction((w) => window.__ff.state().active === w, other).catch(() => {});
    expect(
      (await p.evaluate(() => window.__ff.state().active)) === other,
      `[${tier}] clicking the ${other} fish selects it (cell ${o.x},${o.y})`,
    );

    // Selecting a fish plays a short "peek" at it, and clickCell ignores input while
    // the engine is not idle — so wait for it to settle before clicking again.
    await p.waitForFunction(() => window.__ff.phase() === 'idle');

    // ...and back, so a stuck-on-one-fish failure cannot pass either.
    const first = st.active;
    const f = st[first];
    const b = await clientOf(f.x, f.y);
    await p.mouse.click(b.x, b.y);
    await p.waitForFunction((w) => window.__ff.state().active === w, first).catch(() => {});
    expect(
      (await p.evaluate(() => window.__ff.state().active)) === first,
      `[${tier}] clicking the ${first} fish selects it back (cell ${f.x},${f.y})`,
    );
  }
});
