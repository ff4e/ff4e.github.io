/**
 * UI test: every asset the game asks for, and what it costs the player when it does not
 * arrive.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 * Each asset is declared at its call site as one of three tiers (src/render/assetFetch.ts),
 * and each tier has exactly one surface:
 *
 *  - **must have** → the failure screen. The session ends and the asset is named.
 *  - **should have** → the note in the `#notes` rail. Play continues, and the asset is named.
 *  - **nice to have** → nothing. Play continues and the player is not interrupted.
 *
 * A 404 and a dropped connection are different WORDS at every tier — a 404 must never
 * tell anyone to check their connection — but they are the same tier, because what an
 * asset costs does not depend on why it is missing.
 *
 * ── Why this is a table and not thirty probes ─────────────────────────────────
 * There are about twenty kinds of asset, and a probe apiece would be ~30 × 7 s of wall
 * clock that nobody would keep current. Each row below is `{ tier, label, url, reach }`:
 * break that one glob, drive the game to the point that needs it, and assert the surface
 * the tier promises — with the WORDING checked, because "the game stopped" is not the
 * claim. Adding an asset class adds a row, not a file.
 *
 * Most must-have rows are boot-time and reached by a reload, which is also the cheapest
 * way to guarantee the fetch actually happens: an asset already in the browser cache
 * issues no request, so a route that is never hit would make the row pass having tested
 * nothing. §0 measures that for one row rather than assuming it for all of them.
 *
 * ── The section this file exists for ──────────────────────────────────────────
 * §3. The previous version of this policy made every asset fatal, and the world map
 * fetches a room's name plaque FROM THE DRAW PATH — opening or hovering a room asks for
 * it — so moving the mouse across the map could end the session. §3 drives that same
 * gesture against a dead server and asserts the game does not so much as blink. It is the
 * regression test for the bug this whole branch is a correction of.
 *
 * ── The exception, which matters more than the rule ───────────────────────────
 * §4 is the half that must NOT fail, and it is not a nicety: SCORE ships with no enhanced
 * art, 21 object sprites are legitimately unstaged, and the credits deliberately ask for
 * a file a build tool may not have produced. Every one of those 404s on a perfectly good
 * deploy. If the rule ever ate them, the game would be unplayable in the tiers that are
 * behaving exactly as intended — so this probe would rather fail on §4 than on anything
 * above it.
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
const noteUp = (p) => p.waitForFunction(() => window.__ff.loadNoteShown(), null, { timeout: budget(8000) });

/**
 * The table. `reach` is what has to happen for the asset to be wanted; rows without one
 * are fetched by boot itself, so a reload is enough.
 *
 * `label` is matched against the surface case-insensitively — the screen and the note are
 * the only places a player learns which file broke, so an asset that stops (or quietly
 * degrades) the game without saying which one is still a bug.
 */
const CASES = [
  // ── must have: boot, and nothing is playable until these land ───────────────
  { tier: 'mustHave', label: 'game font', url: '**/data/Intro/Chars.dat' },
  // The four bundled subtitle faces. `FontFace` with a `url()` was a third network door
  // — no retry, no deadline, and a rejection that cannot tell a 404 from a dropped
  // connection — so this used to catch per face and fall back to baked bitmaps.
  { tier: 'mustHave', label: 'subtitle fonts', url: '**/fonts/Mulish.ttf' },
  { tier: 'mustHave', label: 'control panel', url: '**/data/Menu/panel.ffp' },
  { tier: 'mustHave', label: 'world map', url: '**/data/Menu/mapa-0.BMP' },
  { tier: 'mustHave', label: 'world map info panel', url: '**/data/Menu/krokomer.BMP' },
  { tier: 'mustHave', label: 'map name plaques', url: '**/data/Menu/desky*.dat' },
  // 8.3 MB of sound the game used to boot happily without. Each is its own package and
  // its own sentence, which is the point: "sound package index" told a player nothing.
  { tier: 'mustHave', label: 'sound effects', url: '**/data/Sound/x00.ffs' },
  { tier: 'mustHave', label: 'fish chatter', url: '**/data/Sound/x03.ffs' },
  { tier: 'mustHave', label: 'death commentary', url: '**/data/Sound/x02.ffs' },
  // Fetched AFTER boot, deliberately off the critical path — which is exactly why it
  // used to be a `console.warn` nobody would ever read.
  { tier: 'mustHave', label: 'restored 1998 lines', url: '**/restored/restored.ffs' },
  { tier: 'mustHave', label: 'enhanced fish sprites', url: '**/enhanced/_fish/manifest.json' },
  { tier: 'mustHave', label: 'music', url: '**/data/Music/menu.wav' },

  // ── must have: a room, fetched up front on the deliberate act of entering it ─
  {
    // 5.3 MB fetched on entering KUFRIK. Fatal means a blip here ends the session rather
    // than skipping the story — a deliberate call, stated in the PR, because it will be
    // seen.
    tier: 'mustHave',
    label: 'briefcase demonstration',
    url: '**/data/Intro/demo.pck',
    reach: async (p) => {
      await p.evaluate(() => window.__ff.enterRoomAwait(2)); // KUFRIK
      await waitRoom(p, 0);
      await p.evaluate(() => window.__ff.startCutscene());
    },
  },
  {
    tier: 'mustHave',
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
    tier: 'mustHave',
    label: 'enhanced sprite for SCHODY',
    url: '**/enhanced/SCHODY/obj/*.png',
    how: absent,
    reach: async (p) => {
      await p.evaluate(() => window.__ff.setGraphics('enhanced'));
      await p.evaluate(() => void window.__ff.enterRoomAwait(5).catch(() => {})); // SCHODY
    },
  },

  // ── should have: the player asked for this, and would not otherwise know ────
  // Every one is deliberate (a panel opened, a leg finished, a cheat typed) and none is
  // load-bearing for play, so the game keeps running behind the note. Without the note
  // each of these degrades INVISIBLY — an empty help screen reads as what the help looks
  // like — which is the exact shape the middle tier exists for.
  {
    tier: 'shouldHave',
    label: 'help pages',
    url: '**/data/Help/help*.txt',
    reach: (p) => p.evaluate(() => window.__ff.openHelp()),
  },
  {
    tier: 'shouldHave',
    label: 'credits',
    url: '**/data/Menu/CredStat1.BMP',
    reach: (p) => p.evaluate(() => void window.__ff.openCredits()),
  },
  {
    tier: 'shouldHave',
    label: 'story page for leg 3',
    url: '**/data/Menu/003.$dv',
    reach: (p) => p.evaluate(() => window.__ff.showLegImage(3)),
  },
  {
    // Also the row that would have caught a bug the tier CREATED: `tetrisPending` makes
    // the game modal from the instant the cheat fires, and only the success path used to
    // clear it. At must-have that was invisible (the session ended); at should-have it
    // would have left the player in an empty modal for ever.
    tier: 'shouldHave',
    label: 'minigame',
    url: '**/data/Intro/all.BMP',
    reach: async (p) => {
      for (const ch of 'xtetris') await p.keyboard.press(ch);
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
  for (const { tier, label, url, reach, how = failing } of CASES) {
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

    let said;
    if (tier === 'mustHave') {
      await fatalUp(p);
      said = await fatalText(p);
    } else {
      // Named rather than left as a bare `waitForFunction` timeout: the interesting way
      // for this to fail is an asset that was re-tiered DOWN, and "Timeout exceeded" does
      // not say which row or what was expected.
      await noteUp(p).catch(() => {
        throw new Error(`${label}: should-have, but no note ever appeared — was it re-tiered to niceToHave?`);
      });
      said = await p.evaluate(() => window.__ff.loadNoteText());
      // The whole claim of the middle tier, and the reason it is not just a quieter
      // failure screen: the session is still alive behind the note.
      expect(!(await p.evaluate(() => window.__ff.fatalShown())), `${label}: the session did not end`);
    }
    expect(said.toLowerCase().includes(label.toLowerCase()), `${label}: the surface names it (“${said}”)`);
    expect(
      how === absent
        ? /missing from the game files/i.test(said)
        : /didn't finish loading|check your connection/i.test(said),
      `${label}: the wording matches the kind of failure (“${said}”)`,
    );
  }
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // ── 2. Total outage: everything fails, and nothing hangs ────────────────────
  // With every request dead the game must reach its failure screen rather than sitting on
  // a spinner for ever, which is the one failure mode worse than the bug this replaces.
  // Requests here are ABORTED, not stalled: a stalled request is the headers deadline's
  // job and is asserted in `test/assetFetch.test.ts` with an injected deadline, because
  // waiting out the real 20 s in a browser probe would buy the same fact for 20 s.
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

  // ── 3. nice to have: the gesture that used to be able to end the session ────
  // The reason this branch exists. The map fetches a room's upscaled name plaque from the
  // DRAW path — opening a room's record panel, or hovering it, is what asks for it — and
  // 140 of them at ×4 would be ~30 MB to hold, so they are fetched and evicted on demand.
  // Under all-or-nothing this gesture was fatal. Here it must be invisible.
  //
  // TWO loaders, broken separately and in this order, because they are in series and the
  // obvious single glob tests only the first: `plaques.json` carries the geometry, and
  // without it `aiPlaqueFor` returns before it ever asks for an image. Breaking both at
  // once therefore leaves `loadAiPlaque` — the actual hover-driven fetch, and the one the
  // bug was about — never called at all.
  //
  // And the negatives are asserted AFTER the retry budget is spent, not straight after
  // the gesture. Both mistakes were made here and both let a re-tiering of `loadAiPlaque`
  // to `mustHave` pass this probe: a failure does not exist until ~1.25 s of retries have
  // gone by, so "no failure screen yet" a frame later is not the claim being made.
  const RETRIES_SPENT = budget(2500); // 250 ms + 1000 ms, jittered +25%, plus the requests

  await reloadApp(p);
  await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
  await p.evaluate(() => window.__ff.setGraphics('ai'));

  /** Open four different rooms' record panels, which is what asks for four plaques. */
  const hoverRooms = async () => {
    for (const n of [3, 5, 7, 9]) {
      await p.evaluate((r) => window.__ff.openMapInfo(r), n);
      await waitFrames(p, 2);
    }
    await p.waitForTimeout(RETRIES_SPENT);
    return p.evaluate(() => ({
      fatal: window.__ff.fatalShown(),
      note: window.__ff.loadNoteShown(),
      screen: window.__ff.screen(),
      presented: window.__ff.mapPresented(),
    }));
  };

  // 3a. The plaque IMAGES fail; the geometry loads, so every hovered room really does
  //     issue a fetch. Four different rooms means four different URLs, so the per-URL
  //     cooldown is not what is keeping the session alive here.
  const plaqueHits = new Map();
  const countPlaques = (r) => {
    const f = r.url().split('/').pop();
    if (r.url().includes('_desky') && f.endsWith('.webp')) plaqueHits.set(f, (plaqueHits.get(f) ?? 0) + 1);
  };
  p.on('request', countPlaques);
  await failing(p, '**/enhanced-ai/_desky/*.webp');
  const images = await hoverRooms();
  p.off('request', countPlaques);
  expect(!images.fatal, 'a plaque that will not load does not end the session — THE bug this file guards');
  expect(!images.note, 'and does not interrupt with a note either: it is nice-to-have, not should-have');
  expect(images.screen === 'map' && images.presented, 'and the map is still there, and still the map');
  // The FIRST room opened never fetches an image: `aiPlaqueFor` returns as soon as it
  // finds no geometry, having kicked `plaques.json` off. So three of the four is the whole
  // of it, and asserting four would be asserting a bug. This is here so the section above
  // cannot pass by never asking for a plaque at all — which is exactly how an earlier
  // version of it passed with `loadAiPlaque` marked `mustHave`.
  expect(plaqueHits.size >= 3, `the plaques really were asked for (${[...plaqueHits.keys()].join(', ') || 'none'})`);
  // No assertion here on how OFTEN a dead plaque is re-requested, deliberately. The
  // per-URL cooldown in assetFetch.ts is real but small, because the in-flight guard in
  // `loadAiPlaque` already coalesces the gestures: measured with the cooldown disabled,
  // twenty alternating panel opens over a second produced two requests, not twenty. A
  // probe cannot separate the two here, so the cooldown is proved in
  // `test/assetFetch.test.ts` on an injected clock instead, and this comment exists so
  // the assertion that cannot work is not written a second time.
  await p.evaluate(() => window.__ff.closeMapInfo());
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // 3b. The GEOMETRY fails, which is the same gesture one step earlier.
  await reloadApp(p);
  await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
  await failing(p, '**/enhanced-ai/_desky/plaques.json');
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  const geom = await hoverRooms();
  expect(!geom.fatal, 'nor does the plaque GEOMETRY failing, which is the same gesture one step earlier');
  expect(!geom.note && geom.screen === 'map' && geom.presented, 'and it too passes without a word');
  await p.evaluate(() => window.__ff.closeMapInfo());
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // 3b. The launch parchment, the other nice-to-have: the overlay fallback already exists
  //     for the window before boot decodes it, so a player who never gets the parchment
  //     sees what the first seconds of every session look like. It is also the one
  //     nice-to-have that is AWAITED by boot, which is the case where the tier alone is
  //     not enough — the loader has to swallow its own failure or boot goes down with it.
  await failing(p, '**/data/Menu/loading.BMP');
  await reloadApp(p);
  await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
  const parch = await p.evaluate(() => ({ fatal: window.__ff.fatalShown(), note: window.__ff.loadNoteShown() }));
  expect(!parch.fatal && !parch.note, 'a missing launch parchment does not stop, or interrupt, anyone');
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // ── 4. The exception: absence BY DESIGN is still silent ─────────────────────
  await reloadApp(p);
  await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());

  // 4a. The credits ask for a strip a build tool may not have produced, and fall back to
  //     the one that always ships. This 404 is the code ASKING which build it is on.
  await absent(p, '**/data/Menu/CredMov_port.BMP');
  await p.evaluate(() => void window.__ff.openCredits());
  await p.waitForFunction(() => window.__ff.creditLength() > 0, null, { timeout: budget(6000) });
  expect(!(await p.evaluate(() => window.__ff.fatalShown())), 'a 404 on the port credits strip is not a failure');
  expect(!(await p.evaluate(() => window.__ff.loadNoteShown())), 'and is not worth a note either');
  expect((await p.evaluate(() => window.__ff.creditLength())) > 0, 'the credits roll on the fallback strip');
  await p.evaluate(() => window.__ff.closeMapOverlay());
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // 4b. A room with no AI art at all still plays, one tier down, silently. This is the
  //     case that would make the game unplayable if the rule were applied without it:
  //     SCORE ships no enhanced art, CHODBA and WIN draw classic backgrounds by design.
  await absent(p, '**/enhanced-ai/SCHODY/**');
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.evaluate(() => void window.__ff.enterRoomAwait(5).catch(() => {}));
  await waitRoom(p, 0);
  await waitFrames(p, 3);
  const staged = await p.evaluate(() => ({
    fatal: window.__ff.fatalShown(),
    note: window.__ff.loadNoteShown(),
    screen: window.__ff.screen(),
  }));
  expect(!staged.fatal, 'a room that ships no AI art is not a failure — it is the tier working');
  expect(!staged.note, 'and it is not a note either: nothing the player asked for was lost');
  expect(staged.screen === 'room', 'and the room is playable, a tier down');
  await p.unrouteAll({ behavior: 'ignoreErrors' });

  // Every one of those failures is SUPPOSED to be logged, and `allowErrors` only lets
  // them through — this is the assertion that they happened. A probe whose provocation
  // silently stopped working would otherwise pass on an unbroken game. The nice-to-have
  // rows are logged too: silent to the PLAYER never means silent to the console, because
  // a tier that left no trace would be indistinguishable from a loader nobody called.
  expect(allowed.length >= CASES.length, `every provoked failure was reported (${allowed.length} logged)`);
},
  // Every row here provokes a load the game is SUPPOSED to complain about: the browser
  // logs the dead request, and the app logs the asset error on its way to its surface.
  // Asserted rather than ignored — see the last expectation in the body.
  {
    graphics: 'ai',
    allowErrors:
      /asset failed|\[art\]|Failed to load resource|net::ERR|ERR_FAILED|404|Failed to fetch|boot failed|network error|returned HTTP|PE:|parchment/,
  },
);
