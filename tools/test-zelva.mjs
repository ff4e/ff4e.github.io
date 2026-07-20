/** UI probe: ZELVA (room 37) telepathic possession (natvrdo). Forcing a possession
 *  makes the host auto-swim the seized fish toward the target and ignore player
 *  input, releasing the fish (natvrdo -> 0) once it arrives. */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(37));
  await p.waitForFunction(
    () => window.__ff.screen() === 'room' && window.__ff.count() > 0,
    { timeout: 5000 },
  );
  expect(await p.evaluate(() => window.__ff.script() !== null), 'ZELVA has an active script');

  // Possess the little fish and send it a few cells to the left of where it starts.
  const start = await p.evaluate(() => window.__ff.fishCell('little'));
  const target = { x: Math.max(1, start.x - 5), y: start.y };
  await p.evaluate((t) => window.__ff.possess(1, t.x, t.y), target);
  expect(await p.evaluate(() => window.__ff.natvrdo()) === 1, 'possession is active');

  // Guard the fidelity fix (main.ts: only dir_no releases natvrdo; a blocked step
  // retries): the possession must persist across the multi-step walk, not clear on
  // the first non-arrival tick. Sample it a few ticks in while the fish is still en route.
  const startCount = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((c) => window.__ff.count() >= c + 3, startCount, { timeout: 5000 }).catch(() => {});
  const midNatvrdo = await p.evaluate(() => window.__ff.natvrdo());
  const midCell = await p.evaluate(() => window.__ff.fishCell('little'));
  // Either still possessed mid-journey, or already arrived at the target (both valid).
  expect(
    midNatvrdo === 1 || (midCell.x === target.x && midCell.y === target.y),
    `possession persists through the walk (natvrdo=${midNatvrdo}, cell=${JSON.stringify(midCell)})`,
  );

  // Player input must be ignored while possessed: an arrow key does nothing on its own,
  // but the host walks the fish toward the target and clears natvrdo on arrival.
  await p
    .waitForFunction(() => window.__ff.natvrdo() === 0, { timeout: 15000 })
    .catch(() => {});
  const end = await p.evaluate(() => window.__ff.fishCell('little'));
  expect(await p.evaluate(() => window.__ff.natvrdo()) === 0, 'possession released after arrival');
  expect(end.x < start.x, `possessed fish walked left toward the target (start x=${start.x}, end x=${end.x})`);
  console.log('ZELVA possession:', JSON.stringify({ start, target, end }));
});
