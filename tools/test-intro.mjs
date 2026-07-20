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

  // Skip while the splash is up abandons the whole intro → the map, and flips the flag.
  await p.evaluate(() => window.__ff.skipIntro());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.introSeen()) === true, 'introSeen persists after the intro finishes');
  expect(await p.evaluate(() => window.__ff.introPlaying()) === false, 'intro is no longer active on the map');

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
