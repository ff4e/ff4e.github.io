/**
 * UI test: every asset the game asks for, all or nothing.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 * A load that FAILED — no answer at all — ends the session, everywhere. A 404 ends it
 * too, EXCEPT where absence is the documented design. There is no third outcome: the
 * game does not play on quietly without its music, its death commentary, its help pages
 * or its story pages.
 *
 * ── Why this is a table and not thirty probes ─────────────────────────────────
 * There are about twenty kinds of asset, and a probe apiece would be ~30 x 7 s of wall
 * clock that nobody would keep current. Each row below is `{ label, url, reach }`:
 * break that one glob, drive the game to the point that needs it, and assert the
 * failure screen — with the WORDING checked, because "the game stopped" is not the
 * claim. Adding an asset class adds a row, not a file.
 *
 * Most rows are boot-time and reached by a reload, which is also the cheapest way to
 * guarantee the fetch actually happens: an asset already in the browser cache issues no
 * request, so a route that is never hit would make the row pass having tested nothing.
 * §0 measures that for one row rather than assuming it for all of them.
 *
 * ── The exception, which matters more than the rule ───────────────────────────
 * §3 is the half that must NOT fail, and it is not a nicety: SCORE ships with no
 * enhanced art, 21 object sprites are legitimately unstaged, and the credits deliberately
 * ask for a file a build tool may not have produced. Every one of those 404s on a
 * perfectly good deploy. If the rule ever ate them, the game would be unplayable in the
 * tiers that are behaving exactly as intended — so this probe would rather fail on §3
 * than on anything above it.
 *
 * ── What it replaces ──────────────────────────────────────────────────────────
 * `test-enhanced-partial.mjs` (72.9 s), which asserted the OLD outcome for a
 * manifest-listed sprite that 404s: drop the object and draw the item in 1998 bitmaps.
 * That outcome is gone — see the SCHODY row — and the frame-shift bug it was really
 * about is now impossible one level lower, where `Promise.all` over the manifest cannot
 * produce a short list at all (test/enhancedObjects.test.ts).
 */
import { budget, reloadApp, waitFrames, waitRoom, withApp } from './ui-lib.mjs';

/** Fail a glob outright: a transport failure, i.e. what "the connection dropped" does. */
const failing = (p, glob) => p.route(glob, (r) => r.abort('failed'));
/** Answer a glob with a 404: the server saying, authoritatively, "not there". */
const absent = (p, glob) => p.route(glob, (r) => r.fulfill({ status: 404, body: '' }));

/** The failure screen's text, readable even when boot never got as far as `window.__ff`. */
const fatalText = (p) => p.evaluate(() => document.getElementById('fatal-msg')?.textContent ?? '');
const fatalUp = (p) =>
  p.waitForFunction(() => document.getElementById('fatal')?.hidden === false, null, { timeout: budget(8000) });

/**
 * The table. `reach` is what has to happen for the asset to be wanted; rows without one
 * are fetched by boot itself, so a reload is enough.
 *
 * `label` is matched against the failure screen case-insensitively — the screen is the
 * only place a player learns which file broke, so an asset that stops the game without
 * saying which one is still a bug.
 */
const CASES = [
  // ── Boot ────────────────────────────────────────────────────────────────────
  { label: 'game font', url: '**/data/Intro/Chars.dat' },
  { label: 'control panel', url: '**/data/Menu/panel.ffp' },
  { label: 'world map', url: '**/data/Menu/mapa-0.BMP' },
  { label: 'world map info panel', url: '**/data/Menu/krokomer.BMP' },
  { label: 'map name plaques', url: '**/data/Menu/desky*.dat' },
  { label: 'room-entry parchment', url: '**/data/Menu/loading.BMP' },
  // 8.3 MB of sound the game used to boot happily without. Each is its own package and
  // its own sentence, which is the point: "sound package index" told a player nothing.
  { label: 'sound effects', url: '**/data/Sound/x00.ffs' },
  { label: 'fish chatter', url: '**/data/Sound/x03.ffs' },
  { label: 'death commentary', url: '**/data/Sound/x02.ffs' },
  // Fetched AFTER boot, deliberately off the critical path — which is exactly why it
  // used to be a `console.warn` nobody would ever read.
  { label: 'restored 1998 lines', url: '**/restored/restored.ffs' },
  { label: 'enhanced fish sprites', url: '**/enhanced/_fish/manifest.json' },
  { label: 'music', url: '**/data/Music/menu.wav' },

  // ── Reached from the map ────────────────────────────────────────────────────
  {
    label: 'help pages',
    url: '**/data/Help/help*.txt',
    reach: (p) => p.evaluate(() => window.__ff.openHelp()),
  },
  {
    label: 'credits',
    url: '**/data/Menu/CredStat1.BMP',
    reach: (p) => p.evaluate(() => void window.__ff.openCredits()),
  },
  {
    label: 'story page for leg 3',
    url: '**/data/Menu/003.$dv',
    reach: (p) => p.evaluate(() => window.__ff.showLegImage(3)),
  },
  {
    label: 'minigame',
    url: '**/data/Intro/all.BMP',
    reach: async (p) => {
      for (const ch of 'xtetris') await p.keyboard.press(ch);
    },
  },

  // ── Reached from a room ─────────────────────────────────────────────────────
  {
    // 5.3 MB fetched on entering KUFRIK. Fatal means a blip here ends the session rather
    // than skipping the story — stated in the PR, because it will be seen.
    label: 'briefcase demonstration',
    url: '**/data/Intro/demo.pck',
    reach: async (p) => {
      await p.evaluate(() => window.__ff.enterRoomAwait(2)); // KUFRIK
      await waitRoom(p, 0);
      await p.evaluate(() => window.__ff.startCutscene());
    },
  },
  {
    label: 'KUFRIK demonstration',
    url: '**/data/Intro/help.cap',
    reach: async (p) => {
      await p.evaluate(() => window.__ff.enterRoomAwait(2));
      await waitRoom(p, 0);
      await p.evaluate(() => window.__ff.forceShowmode());
    },
  },
  {
    // A manifest-listed sprite, and the row that replaces test-enhanced-partial.mjs.
    // 404 rather than an abort, because "the build is missing a file it promised" is the
    // case that used to be silent — an abort was already loud.
    label: 'enhanced sprite for SCHODY',
    url: '**/enhanced/SCHODY/obj/*.png',
    how: absent,
    reach: async (p) => {
      await p.evaluate(() => window.__ff.setGraphics('enhanced'));
      await p.evaluate(() => void window.__ff.enterRoomAwait(5).catch(() => {})); // SCHODY
    },
  },
];

await withApp(async ({ p, expect, allowed }) => {
  // ── 0. The routes actually bite ─────────────────────────────────────────────
  // A row whose asset is answered from cache would never issue a request, so the route
  // would never fire and the row would pass having proved nothing. Measured once, on a
  // boot asset, because every boot row shares the mechanism.
  let hits = 0;
  await p.route('**/data/Menu/panel.ffp', (r) => {
    hits++;
    return r.abort('failed');
  });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await fatalUp(p);
  expect(hits > 0, 'a reload really refetches a boot asset — the routes are not being answered from cache');
  await p.unroute('**/data/Menu/panel.ffp');

  // ── 1. Every asset class, one row at a time ─────────────────────────────────
  for (const { label, url, reach, how = failing } of CASES) {
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await how(p, url);
    if (reach) {
      // Reached assets need a running game first, so the reload happens BEFORE the route
      // would bite anything — then the route is in force for the thing that wants it.
      await reloadApp(p);
      await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
      await reach(p);
    } else {
      await p.reload({ waitUntil: 'domcontentloaded' });
    }
    await fatalUp(p);
    const note = await fatalText(p);
    expect(note.toLowerCase().includes(label.toLowerCase()), `${label}: the screen names it (“${note}”)`);
    expect(
      how === absent
        ? /missing from the game files/i.test(note)
        : /didn't finish loading|check your connection/i.test(note),
      `${label}: the wording matches the kind of failure (“${note}”)`,
    );
  }
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // ── 2. Total outage: everything fails, and nothing hangs ────────────────────
  // The regression test for the headers deadline as much as for the policy: with every
  // request dead the game must reach its failure screen rather than sitting on a
  // spinner for ever, which is the one failure mode worse than the bug this replaces.
  // By RESOURCE TYPE, not by extension: the page and its modules have to load or there
  // is no game to fail, and the document itself has no extension to match on.
  const APP = new Set(['document', 'script', 'stylesheet']);
  await p.route('**/*', (r) => (APP.has(r.request().resourceType()) ? r.continue() : r.abort('failed')));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await fatalUp(p);
  expect(true, 'a total outage ends on the failure screen rather than hanging');
  const outage = await fatalText(p);
  expect(outage.trim().length > 0, `and it says something (“${outage}”)`);
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // ── 3. The exception: absence BY DESIGN is still silent ─────────────────────
  await reloadApp(p);
  await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());

  // 3a. The credits ask for a strip a build tool may not have produced, and fall back to
  //     the one that always ships. This 404 is the code ASKING which build it is on.
  await absent(p, '**/data/Menu/CredMov_port.BMP');
  await p.evaluate(() => void window.__ff.openCredits());
  await p.waitForFunction(() => window.__ff.creditLength() > 0, null, { timeout: budget(6000) });
  expect(!(await p.evaluate(() => window.__ff.fatalShown())), 'a 404 on the port credits strip is not a failure');
  expect((await p.evaluate(() => window.__ff.creditLength())) > 0, 'the credits roll on the fallback strip');
  await p.evaluate(() => window.__ff.closeMapOverlay());
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // 3b. A room with no AI art at all still plays, one tier down, silently. This is the
  //     case that would make the game unplayable if the rule were applied without it:
  //     SCORE ships no enhanced art, CHODBA and WIN draw classic backgrounds by design.
  await absent(p, '**/enhanced-ai/SCHODY/**');
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.evaluate(() => void window.__ff.enterRoomAwait(5).catch(() => {}));
  await waitRoom(p, 0);
  await waitFrames(p, 3);
  const staged = await p.evaluate(() => ({ fatal: window.__ff.fatalShown(), screen: window.__ff.screen() }));
  expect(!staged.fatal, 'a room that ships no AI art is not a failure — it is the tier working');
  expect(staged.screen === 'room', 'and the room is playable, a tier down');
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // Every one of those failures is SUPPOSED to be logged, and `allowErrors` only lets
  // them through — this is the assertion that they happened. A probe whose provocation
  // silently stopped working would otherwise pass on an unbroken game.
  expect(allowed.length >= CASES.length, `every provoked failure was reported (${allowed.length} logged)`);
},
  // Every row here provokes a load the game is SUPPOSED to complain about: the browser
  // logs the dead request, and the app logs the asset error on its way to the screen.
  // Asserted rather than ignored — see the last expectation in the body.
  {
    graphics: 'ai',
    allowErrors: /asset failed|\[art\]|Failed to load resource|net::ERR|ERR_FAILED|404|Failed to fetch|boot failed|network error|returned HTTP|PE:/,
  },
);
