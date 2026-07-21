/**
 * UI probe: the intro movie + world-map corner "buttons" (UMain.pas daIntro/
 * daCredits/daOptions). Verifies the first-run intro gate, skip → map, the
 * persisted introSeen flag, the corner hit-test, and the credits/options
 * overlays — all without actually playing the (large) MP4s (we skip through).
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap(), { timeout: 8000 });

  // First run (fresh localStorage): boot lands on the intro, gated by the splash.
  expect(await p.evaluate(() => window.__ff.screen()) === 'intro', 'first run boots into the intro');
  expect(await p.evaluate(() => window.__ff.introPlaying()), 'intro is active on first run');
  expect(await p.evaluate(() => window.__ff.introSeen()) === false, 'introSeen is false before the intro is watched');

  // Intro video sizing (v1.0.3): the <video> must fill the viewport and letterbox
  // via object-fit:contain. The pre-fix CSS used only max-width/max-height:100v*,
  // which cap but never upscale, so the video sat at its small intrinsic size.
  const introLayerHidden = await p.evaluate(() => document.getElementById('intro-layer').hasAttribute('hidden'));
  expect(!introLayerHidden, 'the intro layer is visible during the first-run intro');
  const vid = await p.evaluate(() => {
    const v = document.getElementById('intro-video');
    return {
      objectFit: getComputedStyle(v).objectFit,
      cw: v.clientWidth,
      ch: v.clientHeight,
      iw: window.innerWidth,
      ih: window.innerHeight,
    };
  });
  expect(vid.objectFit === 'contain', `intro video letterboxes with object-fit:contain (got ${vid.objectFit})`);
  expect(vid.cw >= vid.iw - 2, `intro video fills the viewport width — scaled up, not native size (cw ${vid.cw} vs vw ${vid.iw})`);
  expect(vid.ch >= vid.ih - 2, `intro video fills the viewport height (ch ${vid.ch} vs vh ${vid.ih})`);

  // Title cover (v1.0.6): while the first-run splash is gated (before the audio
  // gesture), the FILLETS cover art shows behind the "Click to start" button.
  expect(
    await p.evaluate(() => !document.getElementById('intro-cover').hasAttribute('hidden')),
    'the title cover is visible behind the gated first-run splash',
  );
  expect(
    await p.evaluate(() => getComputedStyle(document.getElementById('intro-cover')).backgroundImage.includes('cover.webp')),
    'the cover element uses the generated cover.webp art',
  );

  // Cover size cap (v1.0.10): background-size is min(88vw, 1100px) — earlier it
  // was `contain`, which scaled the logo up to fill the whole viewport width on a
  // maximized window. Assert the resolved width never exceeds the 1100px cap nor
  // the viewport, proving the cap applies (and it's no longer `contain`).
  const coverSize = await p.evaluate(() => {
    const w = parseFloat(getComputedStyle(document.getElementById('intro-cover')).backgroundSize);
    return { w, cap: Math.min(1100, window.innerWidth * 0.88) };
  });
  expect(coverSize.w > 0 && coverSize.w <= 1101, `cover width is a capped pixel size, not \`contain\` (got ${coverSize.w}px)`);
  expect(coverSize.w <= coverSize.cap + 1, `cover width respects the min(88vw, 1100px) cap (got ${coverSize.w}px, cap ${coverSize.cap}px)`);

  // Skip while the splash is up abandons the whole intro → the map, and flips the flag.
  await p.evaluate(() => window.__ff.skipIntro());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.introSeen()) === true, 'introSeen persists after the intro finishes');
  expect(await p.evaluate(() => window.__ff.introPlaying()) === false, 'intro is no longer active on the map');
  expect(
    await p.evaluate(() => document.getElementById('intro-cover').hasAttribute('hidden')),
    'the title cover is hidden once the intro finishes',
  );

  // A reload with introSeen persisted goes straight to the map — no intro.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap(), { timeout: 8000 });
  expect(await p.evaluate(() => window.__ff.screen()) === 'map', 'second boot skips straight to the map');
  expect(await p.evaluate(() => window.__ff.introPlaying()) === false, 'no intro on the second boot');

  // Corner hit-test: each corner colour maps to its action (Exit stays unwired).
  const corners = await p.evaluate(() => ({
    intro: window.__ff.mapCorner(20, 20),
    exit: window.__ff.mapCorner(620, 20),
    credits: window.__ff.mapCorner(20, 470),
    options: window.__ff.mapCorner(620, 470),
    middle: window.__ff.mapCorner(320, 240),
  }));
  expect(corners.intro === 'intro', `top-left corner is intro (got ${corners.intro})`);
  expect(corners.exit === 'exit', `top-right corner is exit (got ${corners.exit})`);
  expect(corners.credits === 'credits', `bottom-left corner is credits (got ${corners.credits})`);
  expect(corners.options === 'options', `bottom-right corner is options (got ${corners.options})`);
  expect(corners.middle === null, 'the map interior is not a corner button');

  // Hover highlight (UMain.pas:1448): moving over a corner lights it + shows a
  // pointer; leaving the corners clears it. Driven by real mouse moves over #screen.
  const canvasBox = await p.evaluate(() => {
    const c = document.getElementById('screen');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const moveFrac = (fx, fy) => p.mouse.move(canvasBox.x + canvasBox.w * fx, canvasBox.y + canvasBox.h * fy);
  await moveFrac(0.06, 0.06); // top-left → intro
  await p.waitForTimeout(120);
  expect(await p.evaluate(() => window.__ff.mapHover()) === 'intro', 'hovering the top-left corner lights intro');
  expect(await p.evaluate(() => document.getElementById('screen').style.cursor) === 'pointer', 'a corner shows a pointer cursor');
  await moveFrac(0.5, 0.5); // interior → no corner
  await p.waitForTimeout(120);
  expect(await p.evaluate(() => window.__ff.mapHover()) === null, 'the map interior clears the corner highlight');

  // Top-left corner replays the intro (just intro.avi, not gated).
  await p.evaluate(() => window.__ff.clickMapCorner(20, 20));
  await p.waitForFunction(() => window.__ff.screen() === 'intro', { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.introPlaying()), 'the intro replays from the top-left corner');
  await p.evaluate(() => window.__ff.skipIntro());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });

  // Options corner opens the Options panel over the map; Esc/close returns.
  await p.evaluate(() => window.__ff.clickMapCorner(620, 470));
  expect(await p.evaluate(() => window.__ff.mapOverlay()) === 'options', 'options corner opens the options overlay');
  expect(await p.evaluate(() => window.__ff.optionsOpen()), 'the options sub-panel is showing');
  await p.evaluate(() => window.__ff.closeMapOverlay());
  expect(await p.evaluate(() => window.__ff.mapOverlay()) === 'none', 'the options overlay closes');

  // Credits corner rolls the credits (async asset load); a click dismisses them.
  await p.evaluate(() => window.__ff.clickMapCorner(20, 470));
  await p.waitForFunction(() => window.__ff.mapOverlay() === 'credits', { timeout: 8000 });
  expect(await p.evaluate(() => window.__ff.creditMode()) >= 0, 'the credits roll is advancing');
  await p.evaluate(() => window.__ff.closeMapOverlay());
  expect(await p.evaluate(() => window.__ff.mapOverlay()) === 'none', 'the credits close');
  expect(await p.evaluate(() => window.__ff.screen()) === 'map', 'back on the map after the credits');
}, { firstRun: true });
