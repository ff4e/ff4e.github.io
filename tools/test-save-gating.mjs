/**
 * UI test: save gating (CanSave, URoom.pas:26900-26906 + the panel colouring at
 * Uovl.pas:341-345). The original refuses to save unless both fish are alive, or
 * one is alive with the other already out — and greys the panel button when it
 * refuses. The port used to save unconditionally from F2 and the panel.
 */
import { selectRoom, withApp, tickSleep } from './ui-lib.mjs';

const SEDY = 0; // grey / disabled
const ORANZOVY = 1; // orange / available

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // UTES
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => localStorage.removeItem('ff.save.7'));
  await tickSleep(p, 3);

  // ---- both fish alive: saving is allowed, and the button is orange -----------
  expect((await p.evaluate(() => window.__ff.canSave())) === true, 'both fish alive -> CanSave');
  expect(
    (await p.evaluate(() => window.__ff.panelState())).save === ORANZOVY,
    'the save button is orange while saving is allowed',
  );
  expect((await p.evaluate(() => window.__ff.hasSave())) === false, 'no save yet');
  await p.evaluate(() => window.__ff.save());
  expect((await p.evaluate(() => window.__ff.hasSave())) === true, 'the save landed');

  // ---- a dead fish blocks saving ---------------------------------------------
  await p.evaluate(() => localStorage.removeItem('ff.save.7'));
  await p.evaluate(() => window.__ff.killFish('little'));
  await tickSleep(p, 2);
  expect((await p.evaluate(() => window.__ff.canSave())) === false, 'a dead fish blocks CanSave');
  expect(
    (await p.evaluate(() => window.__ff.panelState())).save === SEDY,
    'the save button greys out when a fish is dead',
  );
  await p.evaluate(() => window.__ff.save());
  expect(
    (await p.evaluate(() => window.__ff.hasSave())) === false,
    'saving with a dead fish is refused',
  );
  // The keyboard entry point is gated too, not just the panel button.
  await p.keyboard.press('F2');
  await tickSleep(p, 2);
  expect((await p.evaluate(() => window.__ff.hasSave())) === false, 'F2 is refused as well');

  // ---- a fish that has swum OUT does not block saving -------------------------
  await p.evaluate(() => window.__ff.enterRoomAwait(7));
  await p.waitForFunction(() => window.__ff && window.__ff.count() > 0, { timeout: 5000 });
  await p.evaluate(() => localStorage.removeItem('ff.save.7'));
  await p.evaluate(() => window.__ff.exitFish && window.__ff.exitFish('little'));
  await tickSleep(p, 2);
  expect(
    (await p.evaluate(() => window.__ff.canSave())) === true,
    'one fish out + one alive still allows saving',
  );

  console.log('CanSave OK: alive/dead/out gating, panel colour, F2 + panel entry points');
});
