/**
 * UI test: the player can actually reach the author, and reaching them costs nothing
 * they did not choose.
 *
 * The payload builder is pinned in isolation (test/feedback.test.ts). What only a real
 * browser can show is the part that matters here:
 *
 *  - the strip belongs to the OPTIONS face: absent while the game is being played, and
 *    present in both places the panel lives (beside a room, and floating over the map);
 *  - it never touches the 1998 art, and opening Options never MOVES the game — both
 *    measured against the real boxes at several window shapes rather than taken on
 *    trust, because the stage scale is derived from the available area;
 *  - the form shows the finished report before offering any way to send it, and that
 *    report really does carry the room and the move record the player just made —
 *    which is the point of hanging this off Options rather than off a map corner:
 *    Options opens over the room, so the record is still live;
 *  - the two send buttons are ordinary links whose hrefs are well-formed — asserted
 *    without following them, because following them would be the one thing this feature
 *    promises never to do on its own;
 *  - NOTHING leaves the page: no request goes anywhere off-origin while the form is
 *    opened, filled in and closed;
 *  - typing in the form does not drive the fish. Every letter key is a fish command or
 *    a cheat prefix (Uovl.pas:744), so without the keyboard guard in main.ts, writing
 *    "the fish sank" would swim the fish around behind the form — and corrupt the very
 *    move record the report is about.
 */
import { idle, selectRoom, tickSleep, withApp } from './ui-lib.mjs';

/** The strip's box, or null when it is hidden (which is a result, not a failure). */
const barBox = (p) =>
  p.evaluate(() => {
    const e = document.getElementById('feedbar');
    if (!e || e.hidden || e.getClientRects().length === 0) return null;
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });

const boxOf = (p, sel) =>
  p.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }, sel);

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.state);

  // Everything that goes anywhere else. The page's own origin is the dev/preview
  // server; anything else is the feature sending something it was not asked to.
  const offOrigin = [];
  const origin = new URL(p.url()).origin;
  p.on('request', (r) => {
    if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) {
      offOrigin.push(r.url());
    }
  });

  const overlaps = (a, b) =>
    a !== null && b !== null && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  // ── It is not there while the game is being played ────────────────────────────
  expect((await barBox(p)) === null, 'on the map, with Options closed, there is no modern chrome on screen');
  await selectRoom(p, 7); // UTES — both fish alive, open water
  await p.waitForFunction(() => window.__ff.state() && window.__ff.count() > 0);
  await tickSleep(p, 3);
  expect((await barBox(p)) === null, 'in a room, with Options closed, there is no modern chrome on screen');

  // ── Make a real move record, THEN open Options over the room ──────────────────
  // Options opens over the room without leaving it, so the record is still live. That
  // is the whole reason the strip hangs here and not off a world-map corner.
  await p.keyboard.press('Digit1'); // active = little
  await idle(p);
  const x0 = await p.evaluate(() => window.__ff.state().little.x);
  await p.keyboard.press('ArrowLeft');
  await p.waitForFunction((x) => window.__ff.state().little.x !== x || window.__ff.phase() !== 'idle', x0);
  await idle(p);
  const record = await p.evaluate(() => window.__ff.record());
  expect(record.length > 0, `the room has a move record to attach (${JSON.stringify(record)})`);

  const gameBefore = JSON.stringify({
    screen: await boxOf(p, '#screen'),
    panel: await boxOf(p, '#panel'),
    box: await boxOf(p, '#stagebox'),
  });
  await p.evaluate(() => window.__ff.toggleOptions());
  await p.waitForFunction(() => window.__ff.optionsOpen());
  await p.waitForFunction(() => {
    const e = document.getElementById('feedbar');
    return e && !e.hidden;
  });
  const gameAfter = JSON.stringify({
    screen: await boxOf(p, '#screen'),
    panel: await boxOf(p, '#panel'),
    box: await boxOf(p, '#stagebox'),
  });
  // The strip is absolutely positioned for exactly this reason: the stage layout is
  // computed from the panel's 155×395 (layout.ts), so a strip that took up space would
  // rescale the whole game the moment a player opened Options.
  expect(gameBefore === gameAfter, 'opening Options does not move or resize the game');

  // ── It hangs under the panel, and never on the art ────────────────────────────
  // Checked at several window shapes: the stage scale is derived from the available
  // area, so "below the panel" at one size says nothing about a short or narrow window.
  for (const vp of [
    { width: 900, height: 420 },
    { width: 1920, height: 1080 },
    { width: 700, height: 1000 },
    { width: 1200, height: 640 },
  ]) {
    const was = await p.evaluate(() => document.getElementById('stagebox').style.width);
    await p.setViewportSize(vp);
    // `relayout` runs straight off the resize event (main.ts) and writes the stage box's
    // CSS width, so wait for that write rather than for a wall-clock guess. Every step
    // above changes it, so this is always a real signal.
    await p.waitForFunction((w) => document.getElementById('stagebox').style.width !== w, was);
    const bar = await barBox(p);
    const canvasBox = await boxOf(p, '#screen');
    const panelBox = await boxOf(p, '#panel');
    const at = `${vp.width}×${vp.height}`;
    expect(bar !== null && bar.height > 0, `${at}: the strip is on screen while Options is open`);
    expect(!overlaps(bar, canvasBox), `${at}: the strip does not cover the game canvas`);
    // Below the panel, not on it: the panel is ALTAR's own 155×395 bitmap.
    expect(!overlaps(bar, panelBox), `${at}: the strip does not cover the control panel`);
    expect(
      bar.y >= panelBox.y + panelBox.height - 0.5,
      `${at}: the strip hangs UNDER the panel (bar ${Math.round(bar.y)} vs panel bottom ${Math.round(panelBox.y + panelBox.height)})`,
    );
    // Never wider than the window it is a footer of.
    expect(
      bar.width <= panelBox.width + 0.5,
      `${at}: the strip is no wider than the panel (${Math.round(bar.width)} vs ${Math.round(panelBox.width)})`,
    );
  }
  expect(
    (await p.locator('#feedbar-build').textContent()).trim().startsWith('v'),
    'the strip names the build, so a report has a version even without the form',
  );
  expect(
    (await p.evaluate(() => window.__ff.record())) === record,
    'Options opened over the room, so the record is still the one being reported',
  );

  // ── Opening the form ──────────────────────────────────────────────────────────
  expect(!(await p.evaluate(() => window.__ff.feedbackOpen())), 'the form starts closed');
  await p.click('#feedback-open');
  await p.waitForFunction(() => window.__ff.feedbackOpen());
  expect(await p.locator('#feedback-preview').isVisible(), 'the payload is on screen before anything can be sent');

  // ── Typing must not reach the game ────────────────────────────────────────────
  const before = await p.evaluate(() => ({ rec: window.__ff.record(), pos: window.__ff.posHash() }));
  // Deliberately full of fish keys (w, a, s, d, i, k, j, l) and of `x`, which arms the
  // cheat machine — the two ways a stray keystroke could damage the report or the game.
  await p.locator('#feedback-what').pressSequentially('the little fish sank while I was pushing a crate, x marks it');
  await tickSleep(p, 3);
  const after = await p.evaluate(() => ({ rec: window.__ff.record(), pos: window.__ff.posHash() }));
  expect(after.rec === before.rec, 'typing in the form does not add moves to the record');
  expect(after.pos === before.pos, 'typing in the form does not move anything in the room');

  // ── The payload says what it is going to say ──────────────────────────────────
  const preview = await p.evaluate(() => window.__ff.feedbackPreview());
  expect(preview.includes('the little fish sank'), 'the preview shows what the player wrote');
  expect(preview.includes('UTES'), `the preview names the room (${preview.split('\n').find((l) => l.includes('Room')) ?? '—'})`);
  expect(preview.includes(record), 'the preview carries the move record, so the report can be replayed');
  expect(/Fish Fillets 4ever \d+\.\d+\.\d+/.test(preview), 'the preview carries the build');
  expect(!/null|undefined/.test(preview), 'no unavailable field leaks into the preview as "null"');
  expect(
    (await p.evaluate(() => window.__ff.feedbackNote())) === '',
    'a normal-length report needs no warning about what a link cannot carry',
  );

  // ── The three exits ───────────────────────────────────────────────────────────
  const links = await p.evaluate(() => window.__ff.feedbackLinks());
  const issue = new URL(links.issue);
  expect(issue.origin === 'https://github.com', 'the issue link goes to GitHub');
  expect(issue.pathname === '/ff4e/ff4e.github.io/issues/new', `the issue link opens a new issue (${issue.pathname})`);
  expect(issue.searchParams.get('template') === 'bug_report.yml', 'it targets the bug form, not a blank issue');
  expect(
    (issue.searchParams.get('what-happened') ?? '').includes('the little fish sank'),
    'the form arrives prefilled with what the player wrote',
  );
  expect((issue.searchParams.get('move-record') ?? '').includes(record), 'the issue carries the move record');
  expect(links.issue.length <= 6000, `the issue link is inside a safe URL budget (${links.issue.length})`);
  expect(
    links.email.startsWith('mailto:fish_fillets@icloud.com?'),
    `the email link addresses the dedicated address (${links.email.slice(0, 48)}…)`,
  );
  const mail = new URLSearchParams(links.email.slice(links.email.indexOf('?') + 1));
  expect((mail.get('body') ?? '').includes(record), 'the email carries the move record');
  expect(
    (await p.locator('#feedback-issue').getAttribute('target')) === '_blank',
    'the issue link opens in a new tab, so the game is not lost',
  );
  expect(
    await p.locator('#feedback-copy').isVisible(),
    'the clipboard fallback is offered next to the two links',
  );

  // ── The fallback that has to work when the other two do not ───────────────────
  // Both the modern Clipboard API and the `execCommand` fallback, because the fallback
  // is the one that runs where the others already failed — and because appending its
  // scratch textarea outside the modal makes `execCommand` return true while copying
  // NOTHING (measured: the dialog's inertness eats it), which would leave the player
  // told "Copied" over an untouched clipboard.
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(p.url()).origin,
  });
  for (const path of ['clipboard API', 'execCommand fallback']) {
    await p.evaluate(async (useFallback) => {
      // Keep a real handle before anything is stubbed, so the read-back is honest.
      window.__clipRead ??= navigator.clipboard.readText.bind(navigator.clipboard);
      window.__clipWrite ??= navigator.clipboard.writeText.bind(navigator.clipboard);
      await window.__clipWrite('MARKER-NOT-THE-REPORT');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: useFallback
          ? { writeText: () => Promise.reject(new Error('no secure context')) }
          : { writeText: window.__clipWrite },
      });
    }, path !== 'clipboard API');
    await p.click('#feedback-copy');
    await p.waitForFunction(() => document.getElementById('feedback-status').textContent !== '');
    const copied = await p.evaluate(() => window.__clipRead());
    expect(
      copied === (await p.evaluate(() => window.__ff.feedbackPreview())),
      `${path}: “Copy report” really puts the whole report on the clipboard`,
    );
    expect(
      (await p.locator('#feedback-status').textContent()).startsWith('Copied'),
      `${path}: and tells the player it was copied`,
    );
  }

  // ── An idea collects almost nothing ───────────────────────────────────────────
  await p.check('input[name="feedback-kind"][value="idea"]');
  const ideaPreview = await p.evaluate(() => window.__ff.feedbackPreview());
  expect(!ideaPreview.includes(record), 'an idea does not attach a move record');
  expect(!/Mozilla|renderer:|window \d/.test(ideaPreview), 'an idea does not attach browser diagnostics');
  expect(/Fish Fillets 4ever \d+\.\d+\.\d+/.test(ideaPreview), 'an idea still says which build it was written against');
  const ideaLink = new URL((await p.evaluate(() => window.__ff.feedbackLinks())).issue);
  expect(ideaLink.searchParams.get('template') === 'idea.yml', 'an idea targets the idea form');

  // ── Closing gives the keyboard back ───────────────────────────────────────────
  await p.click('#feedback-close');
  await p.waitForFunction(() => !window.__ff.feedbackOpen());
  await p.keyboard.press('Digit2');
  expect((await p.evaluate(() => window.__ff.state())).active === 'big', 'the game has its keyboard back');

  // ── It follows the panel into its other home, over the world map ──────────────
  // The panel column is what floats there, not the canvas, so the strip travels with
  // the window it is a footer of rather than being left behind beside the stage.
  await p.evaluate(() => {
    window.__ff.showMap();
    window.__ff.openMapOptions();
  });
  await p.waitForFunction(() => window.__ff.mapOverlay() === 'options');
  await p.waitForFunction(() => {
    const e = document.getElementById('feedbar');
    return e !== null && !e.hidden && e.getBoundingClientRect().width > 0;
  });
  {
    const bar = await barBox(p);
    const panelBox = await boxOf(p, '#panel');
    const mapBox = await boxOf(p, '#screen');
    expect(
      bar !== null && Math.abs(bar.y - (panelBox.y + panelBox.height)) < 12,
      'over the map, the strip floats with the panel it belongs to',
    );
    expect(Math.abs(bar.width - panelBox.width) < 1, 'and is still exactly the panel’s width');
    // It DOES sit over the map art here — the whole floating panel does, by design
    // (daOptions is modal over the map, UMain.pas:1120) — so the only thing to check
    // is that it stays within the panel's own footprint horizontally.
    expect(
      mapBox !== null && bar.x >= panelBox.x - 0.5 && bar.x + bar.width <= panelBox.x + panelBox.width + 0.5,
      'and never spreads wider than the floating panel',
    );
  }
  await p.evaluate(() => window.__ff.closeMapOverlay());
  await p.waitForFunction(() => {
    const e = document.getElementById('feedbar');
    return e === null || e.hidden;
  });
  expect((await barBox(p)) === null, 'closing Options takes the strip away again');

  // ── And nothing was sent ──────────────────────────────────────────────────────
  expect(offOrigin.length === 0, `nothing left the page (${offOrigin.slice(0, 3).join(', ') || 'no off-origin requests'})`);
});
