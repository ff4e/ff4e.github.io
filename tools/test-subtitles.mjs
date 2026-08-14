/**
 * UI test: each art tier's subtitles are painted the way that tier paints them.
 *  - `enhanced` and `ai` paint real DOM text (#domsubs).
 *  - `classic` bakes them into the pixel frame, so nothing appears in the DOM at all.
 * Also guards the idle-skip (no DOM text when no subtitle is showing) and the two ways a
 * line can be abandoned on screen: leaving the room, and switching tier mid-line — the
 * layer has to follow the room's box and scale across that.
 * Asserts painted-vs-empty, never pixel-exact positions or wave timing, so it is not flaky.
 *
 * What is NOT here any more: the DOM line measured against the canvas line in the same
 * tier. That was the strongest oracle this file had — it is what caught every line being
 * drawn ~5% too small — and it died with the canvas renderer, because it needed a second
 * implementation to compare against. The geometry it was really guarding is now pinned in
 * test/subtitle-geom.test.ts at unit-test cost; what is no longer covered anywhere is the
 * DOM path's own measurement and CSS placement.
 */
import { selectRoom, tickSleep, withApp } from './ui-lib.mjs';

/** How many subtitle lines exist as real DOM text right now. */
async function domLines(p) {
  return p.evaluate(() => document.getElementById('domsubs')?.children.length ?? 0);
}

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // UTES — has both fish
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p
    .waitForFunction(() => window.__ff.enhancedActive && window.__ff.enhancedActive())
    .catch(() => {});
  await tickSleep(p, 3);

  // Idle (no subtitle): nothing is drawn anywhere.
  expect((await domLines(p)) === 0, 'enhanced idle: no DOM text');

  // enhanced: real DOM text, and the canvas overlay left alone.
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5); // let the wave-in run (it advances on the game tick)
  expect(await p.evaluate(() => window.__ff.subsActive()), 'enhanced: subtitle active');
  expect((await domLines(p)) > 0, 'enhanced: subtitle painted as real DOM text');

  // Classic is the third renderer and the one this change never touches: it bakes its
  // subtitles into the pixel frame, so neither layer shows anything.
  await p.evaluate(() => window.__ff.setGraphics('classic'));
  await tickSleep(p, 3);
  expect((await domLines(p)) === 0, 'classic: the DOM layer is cleared on switch');
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'classic: subtitle active');
  expect((await domLines(p)) === 0, 'classic: no DOM text either (subs baked into frame)');

  // ai: same renderer as enhanced. Switched with a line ALREADY on screen, because the
  // tier change resizes and rescales the layer, so it has to be rebuilt against the new box.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await tickSleep(p, 3);
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'ai: subtitle active');
  expect((await domLines(p)) > 0, 'ai: subtitle painted as real DOM text');

  // A tier switch mid-line: the renderer does not change, but the room's box and scale
  // do, so the layer has to be rebuilt against them rather than left as it was.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await tickSleep(p, 5);
  expect((await domLines(p)) > 0, 'the line survives a tier switch mid-line');
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await tickSleep(p, 5);
  expect((await domLines(p)) > 0, 'and survives switching back');

  // Leaving the ROOM with a line still up must take the DOM text down. Nothing in the
  // non-room draw branches clears it — they wipe the canvas overlay, which is a
  // different element — so a line survived onto the world map, painted over it. The
  // guard covers the help page, a cutscene and a room load by the same condition; the
  // map is the one a player actually walks into.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await tickSleep(p, 3);
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);
  expect((await domLines(p)) > 0, 'ai: a line is up before leaving the room');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  // Wait for the condition rather than sleeping a fixed time: the clear happens in the
  // draw path, and on a loaded machine the next frame is not owed within any particular
  // number of milliseconds (a fixed wait here failed under full-suite contention). A
  // genuine regression still fails — the wait times out — which was verified by
  // reverting the fix and watching this assertion go red.
  await p.waitForFunction(() => (document.getElementById('domsubs')?.children.length ?? 0) === 0);
  expect((await domLines(p)) === 0, 'leaving the room takes the DOM subtitle off the map');
}, { cpu: true });
