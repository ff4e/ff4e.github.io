/**
 * UI test: BUG-001 — the busy input gate (DalsiPrikaz, URoom.pas:27002-27016).
 * While a fish is `busy` (mid-dialogue, turned to face the player) real keyboard/mouse
 * input for that fish is dropped: it must not move. Once busy clears, input works again.
 * This drives the actual DOM keydown handler (not just __ff.press) end-to-end.
 */
import { forTicks, tickSleep, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  const press = (code) =>
    p.evaluate(
      (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true, cancelable: true })),
      code,
    );

  // A plain standard room; RECYCLED(30) has a freely-movable little fish.
  await p.evaluate(() => window.__ff.enterRoomAwait(30));
  await p.waitForFunction(() => window.__ff && window.__ff.screen() === 'room' && window.__ff.count() > 0);
  await p.waitForFunction(() => window.__ff.phase() === 'idle');

  const before = await p.evaluate(() => window.__ff.fishCell('little'));

  // Mark the little fish busy, then hammer every little-fish input surface.
  await p.evaluate(() => window.__ff.setBusy('little', 1));
  // Hammered over a window of GAME ticks: the busy gate is checked once per dispatch
  // tick, so "the fish did not move" is only meaningful if dispatch ticks happened.
  await forTicks(p, 12, async () => {
    await press('KeyJ'); // IJKL left
    await press('KeyL'); // IJKL right
    await press('ArrowLeft'); // active-fish arrow
  }, 40);
  const during = await p.evaluate(() => window.__ff.fishCell('little'));
  expect(
    during.x === before.x && during.y === before.y,
    `busy little fish must not move (was ${before.x},${before.y}, now ${during.x},${during.y})`,
  );

  // Clear busy: input must now take effect (facing flips and/or it moves).
  await p.evaluate(() => window.__ff.setBusy('little', 0));
  await press('KeyJ');
  await tickSleep(p, 2);
  await press('KeyJ');
  await p.waitForFunction((b) => {
      const c = window.__ff.fishCell('little');
      const s = window.__ff.state();
      return c.x !== b.x || c.y !== b.y || s.phase !== 'idle' || !s.little.facingRight;
    }, before);
  expect(true, 'input resumes once the fish is no longer busy');
});
