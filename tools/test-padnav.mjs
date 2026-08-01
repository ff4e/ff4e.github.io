/**
 * UI test: controller behaviour that differs from the keyboard and can strand the
 * player. Both cases were reported from a console and neither is reachable with a mouse.
 *
 *  1. Ⓑ during the briefcase cutscene must SKIP it (what Escape does), not walk out to
 *     the map. Leaving mid-cutscene left it half-played, so re-entering the room
 *     resumed it stuck part-way through.
 *  2. Ⓑ on the plain world map must do nothing. It used to mirror Escape and "resume"
 *     the loaded room, which on a pad — where Ⓑ is the constant Back button — dropped
 *     the player into whichever room happened to be loaded.
 */
import { withApp, selectRoom } from './ui-lib.mjs';

const NEUTRAL = { t: 'pad', connected: true, axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) };
const B_INDEX = 1;

/** Press and release a button on the bridged pad, leaving time for the game to poll. */
async function tap(p, index) {
  await p.evaluate(
    ({ i, neutral }) => {
      const b = new Array(17).fill(0);
      b[i] = 1;
      window.__ffPad = { ...neutral, buttons: b };
    },
    { i: index, neutral: NEUTRAL },
  );
  await p.waitForTimeout(250);
  await p.evaluate((neutral) => {
    window.__ffPad = { ...neutral, buttons: new Array(17).fill(0) };
  }, NEUTRAL);
  await p.waitForTimeout(250);
}

await withApp(async ({ p, expect }) => {
  // Install the native-host bridge the console uses, then reload so it takes effect.
  await p.addInitScript(() => {
    window.chrome = window.chrome || {};
    window.chrome.webview = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
  });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__ff, { timeout: 60000 });

  // --- 2. B on the plain map must not enter a room -------------------------------
  // Load a room first, so a stale `room` exists to be wrongly resumed, then go back.
  await selectRoom(p, 1);
  await p.evaluate(() => window.__ff.showMap && window.__ff.showMap());
  await p.waitForTimeout(300);
  const backOnMap = await p.evaluate(() => window.__ff.screen());
  expect(backOnMap === 'map', `on the map before pressing B (screen=${backOnMap})`);

  await tap(p, B_INDEX);
  const afterMapB = await p.evaluate(() => window.__ff.screen());
  expect(afterMapB === 'map', `B on the map does not enter a room (screen=${afterMapB})`);

  // --- 1. B during the cutscene skips it, and does not leave the room -------------
  // The briefcase demo (KufrDemo) normally fires from a room script partway through
  // room 2; start it directly so the test does not depend on that timing.
  await selectRoom(p, 2);
  await p.evaluate(() => window.__ff.startCutscene());
  await p.waitForFunction(() => window.__ff.cutscene(), { timeout: 15000 }).catch(() => {});
  const cutsceneUp = await p.evaluate(() => window.__ff.cutscene());
  expect(cutsceneUp, 'the briefcase cutscene is playing in room 2');

  await tap(p, B_INDEX);
  const after = await p.evaluate(() => ({ cutscene: window.__ff.cutscene(), screen: window.__ff.screen() }));
  expect(!after.cutscene, 'B skipped the cutscene');
  expect(
    after.screen === 'room',
    `B during the cutscene stayed in the room (screen=${after.screen})`,
  );
});
