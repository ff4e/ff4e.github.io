/**
 * UI test: each art tier's subtitles are painted the way that tier paints them.
 *  - `enhanced` and `ai` paint real DOM text (#domsubs).
 *  - `classic` bakes them into the pixel frame, so nothing appears in the DOM at all.
 *  - ANY tier bakes them when no subtitle font loaded — the one fallback left.
 * Also guards the idle-skip (no DOM text when no subtitle is showing), a wrapped sentence
 * being drawn at ONE size rather than one per row, the same line being the same size in a
 * small room and a large one, and a tier switch
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

  // ── two identical rows are two rows ──
  //
  // The renderer keeps one element per engine row. Recognising the row by its CONTENT
  // (startcount, speaker, text) is not an identity: the same short line said twice on one
  // tick collapses onto a single element and the player sees one line where the engine
  // has two. Only a browser can see this — it is about what reached the DOM.
  await p.evaluate(() => window.__ff.clearSubtitles());
  await tickSleep(p, 2);
  await p.evaluate(() => {
    window.__ff.pushSubtitle('Echo.', 'M');
    window.__ff.pushSubtitle('Echo.', 'M'); // same tick, same speaker, same text
  });
  await tickSleep(p, 5);
  expect(
    (await domLines(p)) === 2,
    `two identical lines on one tick are two rows in the DOM (${await domLines(p)})`,
  );

  // ── one sentence, one font size ──
  //
  // A wrapped line is several rows, and the fit-to-room shrink used to be applied to each
  // of them on its own: the long row overflowed the vector face and shrank, the short
  // remainder did not, and the same sentence rendered at two sizes (reported from KUFRIK
  // in the `ai` tier — this is that line). Only a browser can see it, because the
  // overflow comes from measuring a real font: `newSubtitle` wraps against the ORIGINAL
  // BITMAP metrics (URoom.pas:592, and those wrap points stay), while the row is drawn in
  // the bundled vector face (Mulish Medium by default) 20% larger.
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

  // ── the same sentence is the same size in a small room and a large one ──
  //
  // The reported symptom A: subtitles were sized from the ROOM's zoom-to-fit, so the same
  // line was drawn a third larger in a small room than in a large one. They are sized
  // from the stage now (framePainter has the fidelity argument), and this is the property
  // that says so — asserted on the rendered text rather than on the scale that feeds it,
  // because the number being right and the text being right are different claims.
  //
  // The rooms are the two ends of the range: DRAKAR (795x435) barely zooms at all, MIKRO
  // (360x210) hits the default mode's cap. The zoom itself is read back and asserted to
  // still differ, or the whole check would pass vacuously the day the modes change.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  // A bigger window than the suite's default 1200x640, for the whole of this block.
  //
  // The integer fit modes only diverge from the stage when the stage has grown past one
  // physical pixel per game pixel: at 1200x640 the stage sits near 1.06 and 'x1' at 1.00,
  // a 6% gap that hides the defect entirely. On the reported machine (a retina display,
  // a large window) the stage is ~1.65 against an 'x1' room at 0.5. This reproduces that
  // shape without needing a device pixel ratio the pool does not have.
  const SUITE_VIEWPORT = { width: 1200, height: 640 };
  await p.setViewportSize({ width: 1934, height: 1200 });
  await tickSleep(p, 3);
  const lineInk = async (num) => {
    await p.evaluate(() => window.__ff.clearSubtitles());
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await p.waitForFunction((n) => window.__ff.roomNum() === n, num);
    // Long enough that the defect is loud (an oversized line is cut down by whatever the
    // room's width allows, so a longer line diverges further), short enough that it never
    // WRAPS in MIKRO, the narrowest room. Both matter: a wrapped line is fitted as a
    // block against wrap points that differ per room, so its size legitimately differs
    // between rooms and it cannot be the oracle here.
    await p.evaluate(() => window.__ff.pushSubtitle('Careful, little fish!', 'M'));
    await p.waitForFunction(() => (document.getElementById('domsubs')?.children.length ?? 0) > 0);
    await tickSleep(p, 5);
    // The LARGEST size on the layer, not the ink box: a room says its own lines as you
    // walk in, so the layer is not ours alone, and the union of everything on it measures
    // however many rows happen to be up. This line never shrinks when the geometry is
    // right, so it is the largest thing there — and a size is a size whether or not the
    // wave has finished moving it.
    return p.evaluate(() => {
      const px = [...document.getElementById('domsubs').children].map((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      );
      return { fs: Math.max(...px), zoom: window.__ff.roomGeom()?.scale ?? 0 };
    });
  };

  // Both families of fit mode, because they fail differently. In 'medium' the rooms are
  // zoomed by different amounts and the text must not follow. In 'x1' every room is drawn
  // at the SAME scale — but one smaller than the stage, so stage-sized text does not fit
  // and every line gets shrunk by whatever its own room's width demands. That second case
  // is the one that was reported, and it looks nothing like the first.
  //
  // The two need DIFFERENT windows, and the reason is the cell ceiling (layout.ts,
  // MAX_CELL_PX). 'x1' needs a big window — the integer modes only diverge from the stage
  // once the stage is past one physical pixel per game pixel. 'medium' needs a smaller one:
  // at 1934x1200 the stage alone is already at 30px per cell, over the 28px ceiling, so
  // every room falls back to the faithful scale and DRAKAR and MIKRO come out identical —
  // which is correct behaviour and leaves this half of the probe with nothing to measure.
  // At 1200x760 the stage is 25px per cell, under the ceiling, and the two rooms differ by
  // 34% again. The zoom is read back and asserted below, so if either window ever drifts
  // out of its band the probe says so instead of passing vacuously.
  const MODE_VIEWPORT = { medium: { width: 1200, height: 760 }, x1: { width: 1934, height: 1200 } };
  for (const mode of ['medium', 'x1']) {
    await p.setViewportSize(MODE_VIEWPORT[mode]);
    await tickSleep(p, 3);
    await p.evaluate((m) => window.__ff.fitMode(m), mode);
    const big = await lineInk(17); // DRAKAR — the widest room
    const small = await lineInk(33); // MIKRO — the smallest
    if (mode === 'medium') {
      expect(
        Math.abs(small.zoom / big.zoom - 1) > 0.1,
        `[${mode}] the two rooms really are zoomed differently (${big.zoom.toFixed(3)} vs ${small.zoom.toFixed(3)})`,
      );
    }
    expect(
      big.fs > 0 && Math.abs(small.fs / big.fs - 1) < 0.02,
      `[${mode}] the same line is the same size in both rooms ` +
        `(${big.fs.toFixed(2)}px in DRAKAR, ${small.fs.toFixed(2)}px in MIKRO, ` +
        `room scales ${big.zoom.toFixed(2)}/${small.zoom.toFixed(2)})`,
    );
  }

  // A fit-mode change with a line ALREADY up, from 'small' to 'fixed'.
  //
  // That exact pair, for two reasons. Both draw the room at least as big as the stage, so
  // the text scale — and with it the font string — is identical in the two while the
  // width a row is fitted inside is not: the case a font-keyed cache cannot see, where
  // the row keeps a fit decided against the wider budget and then overflows the narrower
  // room, which the host clips, losing the last word. And both are narrow enough for the
  // fit to be doing anything at all — a room enlarged by 1.2x or more already carries the
  // vector face's own +20% (SUB_SCALE), so between, say, 'fill' and 'medium' no line is
  // ever shrunk and a stale factor of 1 stays harmlessly correct.
  await p.evaluate(() => window.__ff.fitMode('small'));
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.evaluate(() =>
    window.__ff.pushSubtitle('Nyní začínáme znovu - můžeme však nahrát uloženou pozici klávesou F3.', 'M'),
  );
  await tickSleep(p, 4);
  await p.evaluate(() => window.__ff.fitMode('fixed'));
  await tickSleep(p, 4);
  const overflow = await p.evaluate(() => {
    const hostEl = document.getElementById('domsubs');
    const host = hostEl.getBoundingClientRect();
    let worst = 0;
    let glyphs = 0;
    for (const line of hostEl.children) {
      for (const sp of line.querySelectorAll('span')) {
        const r = sp.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        glyphs++;
        worst = Math.max(worst, host.left - r.left, r.right - host.right);
      }
    }
    return { worst, glyphs };
  });
  // The line has to still BE there. Without this the check passes on an empty layer —
  // no glyphs, no overflow — which is exactly what a rebuild that dropped the line
  // would look like.
  expect(overflow.glyphs > 0, `the line survives the fit-mode change (${overflow.glyphs} glyphs)`);
  expect(
    overflow.worst <= 1,
    `a line refits when the fit mode changes under it (overflow ${overflow.worst.toFixed(1)}px)`,
  );
  await p.evaluate(() => window.__ff.fitMode('medium'));
  await p.evaluate(() => window.__ff.clearSubtitles());

  // ── the readable band ──
  //
  // Subtitle size tracks the stage, which tracks the window, and a window's size is
  // bounded by nothing: measured across real displays the faithful line ran from 24 CSS
  // px in a small laptop window to 90 on an unscaled 4K desktop.
  //
  // Only the CEILING is checked here, and it is checked as an EQUALITY. The arithmetic is
  // already a millisecond unit test, so what a ~10s probe is worth is proving the wire-up
  // — and `<= max` would not: this block runs after a 1934x1200 viewport that is already
  // pinned to the ceiling, so an in-band assertion would hold even if setViewportSize did
  // nothing at all. The stage scale is read back for the same reason. The FLOOR is not
  // checked here on purpose: it is capped by the room (see `clampTextScale`), so what it
  // lands on depends on the room, and that composition is a unit test.
  //
  // Read on the FONT size, not on what the ai tier finally paints: the tier's shrink is a
  // transform on the layer and has to stay a constant factor on top of the band rather
  // than be flattened into it (test-aisubs owns that ratio, and reads 1.00 instead of
  // 0.75 when a clamp is applied past the shrink).
  const [, maxPx] = await p.evaluate(() => window.__ff.subPxBand());
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.setViewportSize({ width: 3840, height: 2030 });
  await p.evaluate(() => window.__ff.clearSubtitles());
  await tickSleep(p, 3);
  await p.evaluate(() => window.__ff.pushSubtitle('Careful!', 'M'));
  await p.waitForFunction(() => (document.getElementById('domsubs')?.children.length ?? 0) > 0);
  await tickSleep(p, 3);
  const band = await p.evaluate(() => {
    const el = document.getElementById('domsubs')?.children[0];
    return {
      px: el ? parseFloat(getComputedStyle(el).fontSize) : null,
      wanted: window.__ff.roomGeom()?.scale ?? 0,
    };
  });
  // The room would carry a far bigger line than the ceiling allows, or the ceiling is not
  // what is holding it down and this proves nothing.
  expect(
    band.wanted * 27.6 > maxPx * 1.5,
    `[4K] the room is asking for a much bigger line than the ceiling (room scale ${band.wanted.toFixed(2)})`,
  );
  expect(
    band.px !== null && Math.abs(band.px - maxPx) < 0.01,
    `[4K] the subtitle is held at the ${maxPx}px ceiling (${band.px === null ? 'no line' : band.px.toFixed(1) + 'px'})`,
  );
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.setViewportSize(SUITE_VIEWPORT);
  await tickSleep(p, 3);

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
