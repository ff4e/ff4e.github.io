/**
 * UI test: each art tier's subtitles are painted the way that tier paints them.
 *  - `enhanced` and `ai` paint real DOM text (#domsubs).
 *  - `classic` bakes them into the pixel frame, so nothing appears in the DOM at all.
 * Also guards the idle-skip (no DOM text when no subtitle is showing), and a tier switch
 * with a line already up: the renderer does not change, but the room's box and the tier's
 * own scale do, so the layer has to follow both rather than be left as it was. Finally,
 * leaving the room has to take an abandoned line off the screen.
 * Asserts painted-vs-empty and the layer's box, never pixel-exact glyph positions or wave
 * timing, so it is not flaky.
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

  // enhanced: real DOM text.
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5); // let the wave-in run (it advances on the game tick)
  expect(await p.evaluate(() => window.__ff.subsActive()), 'enhanced: subtitle active');
  expect((await domLines(p)) > 0, 'enhanced: subtitle painted as real DOM text');

  // Classic is the one tier this whole line of work never touches: it bakes its
  // subtitles into the pixel frame, so nothing reaches the DOM at all.
  await p.evaluate(() => window.__ff.setGraphics('classic'));
  await tickSleep(p, 3);
  expect((await domLines(p)) === 0, 'classic: the DOM layer is cleared on switch');
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'classic: subtitle active');
  expect((await domLines(p)) === 0, 'classic: no DOM text either (subs baked into frame)');

  // ai: same renderer as enhanced. Switched with a line ALREADY on screen, because the
  // tier change resizes and rescales the layer.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await tickSleep(p, 3);
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'ai: subtitle active');
  expect((await domLines(p)) > 0, 'ai: subtitle painted as real DOM text');

  // A tier switch mid-line. The renderer does not change, so "the text is still there"
  // is nearly free and proves little on its own — what actually has to happen is that the
  // layer follows the new tier: it must still cover the room's box, and it must pick up
  // the tier's own scale (`ai` shrinks its subtitles about the bottom edge, `enhanced`
  // does not). Both are read off the live element, so a layer left at the previous tier's
  // geometry fails here rather than passing as "a line is present".
  const layerBox = () =>
    p.evaluate(() => {
      const s = document.getElementById('domsubs');
      const room = document.getElementById('screen');
      if (!s || !room) return null;
      return { w: s.style.width, roomW: room.style.width, transform: s.style.transform };
    });

  const inAi = await layerBox();
  expect(inAi !== null && inAi.w === inAi.roomW, `[ai] the layer covers the room box (layer ${inAi?.w}, room ${inAi?.roomW})`);
  expect(/scale\(/.test(inAi?.transform ?? ''), `[ai] the layer carries the tier's shrink (transform "${inAi?.transform}")`);

  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await tickSleep(p, 5);
  const inEnh = await layerBox();
  expect((await domLines(p)) > 0, 'the line survives a tier switch mid-line');
  expect(inEnh !== null && inEnh.w === inEnh.roomW, `[enhanced] the layer follows the new room box (layer ${inEnh?.w}, room ${inEnh?.roomW})`);
  expect(!/scale\(/.test(inEnh?.transform ?? ''), `[enhanced] the ai shrink is dropped on the way back (transform "${inEnh?.transform}")`);

  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await tickSleep(p, 5);
  const backInAi = await layerBox();
  expect((await domLines(p)) > 0, 'and survives switching back');
  expect(/scale\(/.test(backInAi?.transform ?? ''), `[ai] the shrink comes back with the tier (transform "${backInAi?.transform}")`);

  // Leaving the ROOM with a line still up must take the DOM text down. No draw branch
  // clears it on its own — a branch paints #screen, and the layer is a sibling element —
  // so a line survived onto the world map and sat over it. The render loop's guard covers
  // the help page, a cutscene and a room load by the same condition; the map is the one a
  // player actually walks into.
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
