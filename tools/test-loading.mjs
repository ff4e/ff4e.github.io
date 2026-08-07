/**
 * UI test: the boot splash looks like the game and reads like the game.
 *
 * What a player is supposed to see while ~48 MB of art and audio arrive: KORALY's
 * crab dancing where the CSS spinner used to be, a large line in the fish's voice in
 * the language they chose, and — smaller, underneath — the technical phase that says
 * WHERE a hung boot hung. All of it is painted by index.html before the module bundle
 * exists, so all of it is asserted here against a real boot rather than against a
 * synthesised overlay.
 *
 * Boot is held open with a route gate on the sound package (`Loading sound…`), which
 * is the last long await before the world loads. Without a gate there is nothing to
 * look at: on a warm local server the splash is gone in well under a second.
 *
 * THE CRAB'S ANIMATION IS READ TWICE, AND NEITHER READ IS A FLAG:
 *   - from the DOM, as the computed opacity of the two stacked frames (which is the
 *     CSS animation's live output, not a variable the app sets), and
 *   - from PIXELS, as screenshots of the element that differ from each other.
 * A flag would keep passing with the animation deleted; neither of these can.
 *
 * Both reads are WAITS, not measurements of a rate, so the probe stays in the parallel
 * pool: it never asserts that a flip happened within some window, only that one
 * happens. The crab's beat is 320 ms (two poses, 2 game ticks each), so a loaded
 * machine makes this slower to observe, never wrong.
 *
 * Sections: 1 the held splash (crab, sizes, Czech line, technical phase); 2 the same
 * boot in English; 3-4 the art broken two ways — a decode failure and a real 404 —
 * where the screen must fall back to the spinner and boot must still finish; 5 the
 * stripped-down room-entry mode, which keeps the crab and drops the joke.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { budget, observed, withApp } from './ui-lib.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The fish's lines, taken from index.html itself.
 *
 * Read out of the source rather than restated here: a copy in the probe would assert
 * that the probe agrees with the probe. `runInNewContext` on our own repo file is the
 * cheap way to parse a JS array literal exactly as the browser will.
 */
function fishLines() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const literal = html.match(/var LINES = (\[[\s\S]*?\]);/);
  if (!literal) throw new Error('index.html: could not find the LINES array');
  return runInNewContext(literal[1]);
}

const LINES = fishLines();
const SOUND_PKG = '**/data/Sound/x00.ffs';
const CRAB = '**/KORALY/obj/krab_0*.webp';

/** Everything the splash shows, as the browser has computed it. */
const SPLASH = () => {
  const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
  const shown = (el) => (el ? getComputedStyle(el).display !== 'none' : false);
  const crab = document.getElementById('loading-crab');
  const frames = crab ? [...crab.getElementsByTagName('img')] : [];
  return {
    visible: document.getElementById('loading').hidden === false,
    fun: document.getElementById('loading-fun').textContent,
    funPx: px(document.getElementById('loading-fun')),
    funShown: shown(document.getElementById('loading-fun')),
    msg: document.getElementById('loading-msg').textContent,
    msgPx: px(document.getElementById('loading-msg')),
    titleShown: shown(document.querySelector('#loading h1')),
    creditShown: shown(document.getElementById('loading-credit')),
    crabShown: shown(crab),
    spinnerShown: shown(document.querySelector('#loading .spinner')),
    opacities: frames.map((f) => getComputedStyle(f).opacity),
  };
};

/** Boot with a chosen subtitle language, merged into whatever else is persisted. */
const PIN_LANG = (lang) => {
  try {
    const o = JSON.parse(localStorage.getItem('ff.options') ?? '{}');
    o.subtitles = lang;
    o.titDef = lang;
    localStorage.setItem('ff.options', JSON.stringify(o));
  } catch {
    /* storage unavailable */
  }
};

/**
 * Wait until both crab frames have finished trying to load.
 *
 * The crab is hidden until its art decodes, so "it is not shown" is also true of a
 * frame that simply has not arrived yet — asserting the fallback without this wait
 * would pass against a perfectly working crab.
 */
const settledCrab = (p) =>
  p.waitForFunction(() => [...document.querySelectorAll('#loading-crab img')].every((i) => i.complete));

await withApp(
  async ({ p, expect }) => {
    // === 1. The splash, held at the sound package, in the default language (cz). ===
    let releaseSound;
    const openGate = () => new Promise((r) => { releaseSound = r; });
    let sound = openGate();
    // continue() can race the unroute once the gate opens; the assertions are about
    // what was on screen, not about who won that race.
    await p.route(SOUND_PKG, async (route) => { await sound; await route.continue().catch(() => {}); });

    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => /sound/i.test(document.getElementById('loading-msg')?.textContent ?? ''));

    const held = await p.evaluate(SPLASH);
    expect(held.visible, 'the boot splash is up while the sound package loads');
    expect(held.titleShown && held.creditShown, 'the boot splash keeps its title and attribution');
    expect(held.crabShown, 'the crab is on screen once its art has decoded');
    expect(!held.spinnerShown, 'the crab has REPLACED the spinner, not joined it');
    // The whole point of keeping this line: when a boot hangs it is the only thing
    // that says which of the five phases it hung in.
    expect(/^Loading sound/.test(held.msg ?? ''), `the technical phase is still shown (got "${held.msg}")`);
    expect(held.funShown && (held.fun ?? '').length > 0, 'a line in the fish\u2019s voice is shown');
    expect(
      LINES.some((l) => l.cz === held.fun),
      `the line is one of the Czech lines, the default language (got "${held.fun}")`,
    );
    // "Bigger" is the requirement; the old sizes were 13px status / 11px credit.
    expect(held.funPx >= 22, `the fish\u2019s line is large type (${held.funPx}px)`);
    expect(held.msgPx >= 15, `the technical phase grew too, but stayed secondary (${held.msgPx}px)`);
    expect(held.funPx > held.msgPx, `the joke leads and the diagnostics follow (${held.funPx}px vs ${held.msgPx}px)`);
    expect(
      held.opacities.length === 2 && held.opacities.filter((o) => Number(o) > 0.5).length === 1,
      `exactly one of the two crab poses is visible at a time (${JSON.stringify(held.opacities)})`,
    );

    // --- The crab really animates, read 1: the CSS animation's own output. The wait's
    //     budget is nominally one pose (160 ms) and deliberately generous around it:
    //     this is a wait, not a stopwatch — a loaded machine may render the flip late,
    //     and that is not a failure of the thing being tested. ---
    const flipped = await observed(
      p.waitForFunction(
        (first) => {
          const now = [...document.querySelectorAll('#loading-crab img')].map((f) => getComputedStyle(f).opacity);
          return now.join() !== first.join();
        },
        held.opacities,
        { timeout: budget(160) },
      ),
    );
    expect(flipped, 'the crab changes pose over time (computed opacity of the two frames)');

    // --- Read 2: pixels. Bounded loop rather than a fixed pair of samples, so a
    //     stalled machine costs time instead of producing a false failure. ---
    const crabBox = p.locator('#loading-crab');
    const first = await crabBox.screenshot();
    let moved = false;
    for (let i = 0; i < 24 && !moved; i++) {
      await p.waitForTimeout(80); // wall-clock: the CSS beat is wall-clock too
      moved = !(await crabBox.screenshot()).equals(first);
    }
    expect(moved, 'the crab\u2019s rendered pixels change over time');

    // === 2. The same boot in English: the line follows the player's language. ===
    releaseSound();
    await p.waitForFunction(() => window.__ff !== undefined);
    await p.unroute(SOUND_PKG).catch(() => {});
    await p.addInitScript(PIN_LANG, 'en');
    sound = openGate();
    await p.route(SOUND_PKG, async (route) => { await sound; await route.continue().catch(() => {}); });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => /sound/i.test(document.getElementById('loading-msg')?.textContent ?? ''));

    const english = await p.evaluate(SPLASH);
    expect(
      LINES.some((l) => l.en === english.fun),
      `an English player gets the English line (got "${english.fun}")`,
    );
    expect(
      !LINES.some((l) => l.cz === english.fun),
      'and not the Czech one — the two lists are distinct per line',
    );
    releaseSound();
    await p.waitForFunction(() => window.__ff !== undefined);
    await p.unroute(SOUND_PKG).catch(() => {});

    // === 3. The art fails to DECODE (a 200 of something that is not an image).
    //        The loading screen is what explains a slow start, so it must not be able
    //        to become the cause of a broken one: the spinner comes back and boot
    //        finishes exactly as it did before the crab existed. ===
    await p.route(CRAB, (route) => route.fulfill({ status: 200, contentType: 'image/webp', body: 'not an image' }));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await settledCrab(p);
    const undecodable = await p.evaluate(SPLASH);
    expect(!undecodable.crabShown, 'an undecodable crab is not shown');
    expect(undecodable.spinnerShown, 'the spinner is still there to fall back on');
    expect((undecodable.fun ?? '').length > 0, 'the fish still has its line');
    expect(
      await observed(p.waitForFunction(() => window.__ff !== undefined)),
      'and the game still boots',
    );
    await p.unroute(CRAB).catch(() => {});

    // === 4. The art 404s outright — the half-deployed-site case. Chromium logs the
    //        failed request as a console error, which is why this probe declares it
    //        expected (see `ignoreConsole` below). ===
    await p.route(CRAB, (route) => route.fulfill({ status: 404, body: '' }));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await settledCrab(p);
    const missing = await p.evaluate(SPLASH);
    expect(!missing.crabShown, 'a missing crab is not shown');
    expect(missing.spinnerShown, 'the spinner covers for it');
    expect(/Loading/.test(missing.msg ?? ''), `the technical phase is unaffected (got "${missing.msg}")`);
    expect(
      await observed(p.waitForFunction(() => window.__ff !== undefined)),
      'boot survives a 404 on the crab',
    );
    await p.unroute(CRAB).catch(() => {});

    // === 5. Room entry re-uses this markup in a reduced form. A room entry is a few
    //        seconds behind a 200 ms arming delay — long enough to want a sign of
    //        life, far too short to read a joke off — so it keeps the crab and drops
    //        the title, the fish's line and the attribution. ===
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__ff !== undefined);
    let releaseRoom;
    const room = new Promise((r) => { releaseRoom = r; });
    for (const glob of ['**/enhanced-ai/PRVNI/**', '**/enhanced-ai/_fish/**']) {
      await p.route(glob, async (route) => { await room; await route.continue().catch(() => {}); });
    }
    await p.evaluate(() => window.__ff.enterRoom(1));
    await p.waitForFunction(() => window.__ff.loadingVisible());
    const entering = await p.evaluate(SPLASH);
    expect(entering.crabShown, 'a room entry keeps the crab — it is the sign that something is happening');
    expect(!entering.funShown, 'a room entry does NOT show the fish\u2019s line');
    expect(!entering.titleShown && !entering.creditShown, 'nor the boot splash\u2019s title and attribution');
    expect(
      /Loading .+/.test(entering.msg ?? ''),
      `the room name is what a room entry says instead (got "${entering.msg}")`,
    );
    releaseRoom();
    await p.waitForFunction(() => !window.__ff.loadingVisible());
    for (const glob of ['**/enhanced-ai/PRVNI/**', '**/enhanced-ai/_fish/**']) {
      await p.unroute(glob).catch(() => {});
    }
  },
  // Section 4 breaks the crab's URLs on purpose; Chromium's own log line for that is
  // the expected result, not a defect. Nothing else is forgiven.
  { ignoreConsole: /krab_0\d\.webp/ },
);
