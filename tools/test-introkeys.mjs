/**
 * UI probe: keyboard handling on the first-run intro (gated splash / movies).
 *
 * Two regressions, both reported while arming the dev pane on "the very first
 * intro page":
 *   1. Ctrl+Alt+D must toggle the dev pane IN PLACE during the intro — a bare
 *      modifier keydown (Ctrl, Alt) must never count as a skip, otherwise arming
 *      Ctrl+Alt+D fired three skips (Ctrl, Alt, D) and blew through the whole
 *      sequence straight to the map.
 *   2. Skipping the gated splash with a key must start exactly ONE map-music
 *      loop. That single keydown runs both showMap()'s startMenuMusic and the
 *      once-per-session audio-unlock's; a second overlapping 'menu' loop phased
 *      into the first as "weird" music (and survived stopMusic()).
 *
 * Uses a fresh gated page per scenario so the once-per-session audio unlock is
 * still armed for scenario 2 (the double-start trigger). No withApp — it forces
 * ff.devEnabled=1 and runs a single page.
 */
import { chromium } from 'playwright';
import { WAIT_BACKSTOP } from './ui-lib.mjs';

const port = process.env.FF_UI_PORT ?? '5173';
const url = `http://127.0.0.1:${port}/`;
let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

const newGatedPage = async (devEnabled) => {
  const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
  // This probe drives its own page instead of going through gotoApp, so it has to opt
  // into the same wait backstop the rest of the suite gets.
  p.setDefaultTimeout(WAIT_BACKSTOP);
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push('PE:' + e.message));
  await p.addInitScript((d) => {
    try {
      localStorage.setItem('ff.devEnabled', d ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, devEnabled);
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap());
  return { p, errs };
};

// ── Scenario 1: arm the dev pane on the gated intro without skipping ──
{
  const { p, errs } = await newGatedPage(false);
  expect((await p.evaluate(() => window.__ff.screen())) === 'intro', 'first run boots into the gated intro');
  expect(await p.evaluate(() => window.__ff.introPlaying()), 'intro is active on the gated splash');
  expect(await p.evaluate(() => !document.body.classList.contains('dev')), 'dev pane starts disabled');

  // Bare modifier keydowns must NOT skip.
  await p.keyboard.down('Control');
  await p.keyboard.down('Alt');
  expect((await p.evaluate(() => window.__ff.screen())) === 'intro', 'bare Ctrl/Alt do not skip the intro');
  expect(await p.evaluate(() => window.__ff.introPlaying()), 'intro still playing after modifier keys');

  // Ctrl+Alt+D toggles the dev pane in place, still not skipping.
  await p.keyboard.press('KeyD');
  await p.keyboard.up('Alt');
  await p.keyboard.up('Control');
  expect(await p.evaluate(() => document.body.classList.contains('dev')), 'Ctrl+Alt+D enables the dev pane during the intro');
  expect((await p.evaluate(() => window.__ff.screen())) === 'intro', 'Ctrl+Alt+D does not skip the intro');
  expect(await p.evaluate(() => window.__ff.introPlaying()), 'intro still playing after arming the dev pane');

  // The dev bar must render ON TOP of the full-screen intro overlay (z-index:100),
  // otherwise it toggles on but stays hidden behind the black movie layer and can't
  // be used. Hit-test its centre: it should resolve to the bar, not #intro-layer.
  const barVisible = await p.evaluate(() => {
    const bar = document.getElementById('devbar');
    const r = bar.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(el && el.closest('#devbar'));
  });
  expect(barVisible, 'the dev bar is on top of the intro overlay (clickable), not hidden behind it');
  // And its controls (e.g. the Graphics combobox) are reachable for a real click.
  expect(
    await p.evaluate(() => {
      const g = document.getElementById('graphics');
      const r = g.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(el && (el === g || el.closest('#devbar')));
    }),
    'the Graphics combobox is clickable over the intro',
  );
  if (errs.length) {
    ok = false;
    console.log('  console errors:', errs);
  }
  await p.close();
}

// ── Scenario 2: a keyboard skip to the map starts exactly ONE map track ──
// The skip-to-map keydown runs BOTH showMap()'s startMenuMusic and the once-per-
// session audio-unlock's (this is the session's first keydown) — a second overlapping
// 'menu' loop would phase into "weird" music and survive stopMusic(). Uses a *replay*
// (a single, ungated movie) so one keydown reaches the map while the keydown-unlock is
// still armed — the gated first-run splash is now sticky and never skips.
{
  const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push('PE:' + e.message));
  await p.addInitScript(() => {
    try {
      localStorage.setItem('ff.options', JSON.stringify({ introSeen: true })); // boot straight to the map
      localStorage.setItem('ff.devEnabled', '1');
    } catch {
      /* storage unavailable */
    }
  });
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap());
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'a returning player boots straight to the map');
  await p.evaluate(() => window.__ff.clearSoundLog());
  // Replay the intro from the map's top-left corner (a single, ungated movie).
  await p.evaluate(() => window.__ff.clickMapCorner(20, 20));
  await p.waitForFunction(() => window.__ff.screen() === 'intro');
  // The session's FIRST keydown skips the single movie to the map AND unlocks audio.
  await p.keyboard.press('Space');
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await p.waitForFunction(() => window.__ff.music() === 'menu');
  const menuStarts = await p.evaluate(
    () => window.__ff.soundLog().filter((s) => s.name.includes('menu') && s.name.includes('music-loop')).length,
  );
  expect(menuStarts === 1, `exactly one menu-music loop starts on a keyboard skip (got ${menuStarts})`);
  expect((await p.evaluate(() => window.__ff.music())) === 'menu', 'the map is playing the menu track');
  if (errs.length) {
    ok = false;
    console.log('  console errors:', errs);
  }
  await p.close();
}

// ── Scenario 3: picking AI-upscaled on the splash plays the AI movies ──
// The queue is resolved at play time, so a level chosen on the gated splash (before
// "Click to start") must apply to the movies that follow — not the boot-time level.
{
  const { p, errs } = await newGatedPage(true); // dev on → Graphics combobox available
  expect((await p.evaluate(() => window.__ff.screen())) === 'intro', 'first run boots into the gated intro');
  // Pick AI-upscaled via the (now on-top) combobox, exactly as a user would.
  await p.selectOption('#graphics', 'ai');
  expect((await p.evaluate(() => window.__ff.graphics())) === 'ai', 'combobox switches the level to AI-upscaled');
  // Wait for the AI HEAD-probe to resolve so the resolver reports the upscale.
  await p.waitForFunction(() => window.__ff.logoMovieUrl().includes('logo_ai'));
  // Click "Click to start"; the logo that plays must be the AI upscale.
  await p.click('#intro-start');
  await p.waitForFunction(() => {
      const v = document.getElementById('intro-video');
      const s = v && v.getAttribute('src');
      return !!s && s.includes('logo');
    });
  const src = await p.evaluate(() => document.getElementById('intro-video').getAttribute('src'));
  expect(src.includes('logo_ai.mp4'), `the played logo is the AI upscale after picking AI on the splash (got ${src})`);
  if (errs.length) {
    ok = false;
    console.log('  console errors:', errs);
  }
  await p.close();
}

await b.close();
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);