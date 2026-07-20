/**
 * UI test: BUG-001 — the busy input gate (DalsiPrikaz, URoom.pas:27002-27016).
 * While a fish is `busy` (mid-dialogue, turned to face the player) real keyboard/mouse
 * input for that fish is dropped: it must not move. Once busy clears, input works again.
 * This drives the actual DOM keydown handler (not just __ff.press) end-to-end.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  const press = (code) =>
    p.evaluate(
      (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true, cancelable: true })),
      code,
    );

  // A plain standard room; RECYCLED(30) has a freely-movable little fish.
  await p.evaluate(() => window.__ff.enterRoomAwait(30));
  await p.waitForFunction(() => window.__ff && window.__ff.screen() === 'room' && window.__ff.count() > 0, {
    timeout: 5000,
  });
  await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 5000 });

  const before = await p.evaluate(() => window.__ff.fishCell('little'));

  // Mark the little fish busy, then hammer every little-fish input surface.
  await p.evaluate(() => window.__ff.setBusy('little', 1));
  for (let i = 0; i < 6; i++) {
    await press('KeyJ'); // IJKL left
    await press('KeyL'); // IJKL right
    await press('ArrowLeft'); // active-fish arrow
    await p.waitForTimeout(40);
  }
  const during = await p.evaluate(() => window.__ff.fishCell('little'));
  expect(
    during.x === before.x && during.y === before.y,
    `busy little fish must not move (was ${before.x},${before.y}, now ${during.x},${during.y})`,
  );

  // Clear busy: input must now take effect (facing flips and/or it moves).
  await p.evaluate(() => window.__ff.setBusy('little', 0));
  await press('KeyJ');
  await p.waitForTimeout(120);
  await press('KeyJ');
  await p.waitForFunction(
    (b) => {
      const c = window.__ff.fishCell('little');
      const s = window.__ff.state();
      return c.x !== b.x || c.y !== b.y || s.phase !== 'idle' || !s.little.facingRight;
    },
    before,
    { timeout: 3000 },
  );
  expect(true, 'input resumes once the fish is no longer busy');
});
