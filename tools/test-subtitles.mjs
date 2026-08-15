/**
 * UI test: each art tier's subtitles are painted the way that tier paints them.
 *  - `enhanced` and `ai` paint real DOM text (#domsubs).
 *  - `classic` bakes them into the pixel frame, so nothing appears in the DOM at all.
 *  - ANY tier bakes them when no subtitle font loaded — the one fallback left.
 * Also guards the idle-skip (no DOM text when no subtitle is showing), a wrapped sentence
 * being drawn at ONE size rather than one per row, and a tier switch
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

  // ── one sentence, one font size ──
  //
  // A wrapped line is several rows, and the fit-to-room shrink used to be applied to each
  // of them on its own: the long row overflowed the vector face and shrank, the short
  // remainder did not, and the same sentence rendered at two sizes (reported from KUFRIK
  // in the `ai` tier — this is that line). Only a browser can see it, because the
  // overflow comes from measuring a real font: `newSubtitle` wraps against the ORIGINAL
  // BITMAP metrics (URoom.pas:592, and those wrap points stay), while the row is drawn in
  // FreeSans-Bold 20% larger.
  //
  // Read off computed style rather than the internal fit, so a rule applied per block but
  // written per row still fails.
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.evaluate(() =>
    window.__ff.pushSubtitle('Nyní začínáme znovu - můžeme však nahrát uloženou pozici klávesou F3.', 'M'),
  );
  await tickSleep(p, 5);
  const rowPx = await p.evaluate(() =>
    [...(document.getElementById('domsubs')?.children ?? [])].map((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    ),
  );
  expect(rowPx.length > 1, `[ai] the fixture line wraps to several rows (${rowPx.length})`);
  expect(
    Math.max(...rowPx) - Math.min(...rowPx) < 0.01,
    `[ai] every row of one sentence is drawn at the same size (${rowPx.map((v) => v.toFixed(2)).join(', ')})`,
  );
  await p.evaluate(() => window.__ff.clearSubtitles());
  await tickSleep(p, 2);
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);

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

  // ── the font-failure fallback ──
  //
  // `useVecSubs` is `enhancedArtActive() && subs !== null && subFontReady` (framePainter),
  // so a browser that loads none of the bundled faces bakes its subtitles in EVERY tier,
  // with the game's own bitmap font. That is the only fallback the vector path has left:
  // the Web Animations one was deleted with the canvas renderer, on the grounds that no
  // engine able to parse the ES2022 bundle lacks the API. This one is real, and until now
  // nothing reached it — `setSubFontReady` had no hook, so no probe could ask for it.
  //
  // Asserted in both directions on the SAME line, which is what stops it passing for the
  // wrong reason: with the font marked missing the line must still be live but absent
  // from the DOM (not simply dropped), and turning the font back on must bring it back
  // (so the gate is what moved it, not a subtitle system left broken by the flag).
  //
  // The `ai` pass is NOT the `enhanced` pass again. `useVecSubs` is the same boolean in
  // both, so on its own the second iteration would re-assert the first one's proposition
  // and buy nothing. What is ai-only is the knock-on: a baked line cannot be composited
  // by the hi-res AI compositor, so `bakedSubsNeeded` pulls that whole path out of the
  // frame for as long as the line is up (art.ts -> aiRoomGateAllows, roomAi.ts). That
  // wiring is invisible to `roomAi`'s unit tests, which cover the RULE and not what is
  // fed into it, and it costs no extra game ticks to check here.
  for (const tier of ['enhanced', 'ai']) {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.evaluate(() => window.__ff.clearSubtitles());
    await tickSleep(p, 2);
    // The ai tier has to be actually compositing before "it stops" can mean anything.
    // Waited for rather than assumed: the tier switch has to fetch the room's AI art.
    if (tier === 'ai') {
      await p.waitForFunction(() => window.__ff.aiRoomActive()).catch(() => {});
      expect(await p.evaluate(() => window.__ff.aiRoomActive()), '[ai] the tier is compositing before the font fails');
    }
    await p.evaluate(() => window.__ff.subFontReady(false));
    await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
    await tickSleep(p, 5);
    expect(
      await p.evaluate(() => window.__ff.subsActive()),
      `[${tier}] with no subtitle font the line is still being said`,
    );
    expect((await domLines(p)) === 0, `[${tier}] with no subtitle font nothing is drawn as DOM text (baked instead)`);
    if (tier === 'ai') {
      expect(
        (await p.evaluate(() => window.__ff.aiRoomActive())) === false,
        '[ai] a baked line takes the hi-res compositor out of the frame (bakedSubsNeeded)',
      );
    }

    await p.evaluate(() => window.__ff.subFontReady(true));
    await tickSleep(p, 5);
    expect((await domLines(p)) > 0, `[${tier}] the same line comes back as DOM text once a font is available`);
    if (tier === 'ai') {
      expect(await p.evaluate(() => window.__ff.aiRoomActive()), '[ai] and the compositor comes back with it');
    }
  }
  await p.evaluate(() => window.__ff.clearSubtitles());
  await tickSleep(p, 2);

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
