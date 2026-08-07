/**
 * UI test: the player can actually reach the author, and reaching them costs nothing
 * they did not choose.
 *
 * The payload builder is pinned in isolation (test/feedback.test.ts). What only a real
 * browser can show is the part that matters here:
 *
 *  - the affordance exists in the player's view and is OUTSIDE the game canvas — this
 *    is a faithful port and a modern button over the 1998 art would be a defect, so the
 *    bar's box is measured against the canvas's rather than taken on trust;
 *  - the form shows the finished report before offering any way to send it, and that
 *    report really does carry the room and the move record the player just made;
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

  // ── The affordance is in the player's view, and not on the art ────────────────
  const overlaps = (a, b) =>
    a !== null && b !== null && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // Checked at several window shapes, not one: the stage scale is derived from the
  // available area (computeStageLayout), so "outside the canvas" at 1200×640 says
  // nothing about a short or a narrow window — and being outside it at EVERY size is
  // the actual claim being made about not touching the 1998 art.
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
    const bar = await p.locator('#feedbar').boundingBox();
    const canvasBox = await p.locator('#screen').boundingBox();
    const panelBox = await p.locator('#panel').boundingBox();
    const at = `${vp.width}×${vp.height}`;
    expect(bar !== null && bar.height > 0, `${at}: the feedback bar is on screen for a player`);
    expect(!overlaps(bar, canvasBox), `${at}: the bar does not cover the game canvas`);
    expect(!overlaps(bar, panelBox), `${at}: the bar does not cover the control panel`);
  }
  expect(
    (await p.locator('#feedbar-build').textContent()).trim().startsWith('v'),
    'the bar names the build, so a report has a version even without the form',
  );

  // ── Make a real move record to attach ─────────────────────────────────────────
  await selectRoom(p, 7); // UTES — both fish alive, open water
  await p.waitForFunction(() => window.__ff.state() && window.__ff.count() > 0);
  await tickSleep(p, 3);
  await p.keyboard.press('Digit1'); // active = little
  await idle(p);
  const x0 = await p.evaluate(() => window.__ff.state().little.x);
  await p.keyboard.press('ArrowLeft');
  await p.waitForFunction((x) => window.__ff.state().little.x !== x || window.__ff.phase() !== 'idle', x0);
  await idle(p);
  const record = await p.evaluate(() => window.__ff.record());
  expect(record.length > 0, `the room has a move record to attach (${JSON.stringify(record)})`);

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

  // ── And nothing was sent ──────────────────────────────────────────────────────
  expect(offOrigin.length === 0, `nothing left the page (${offOrigin.slice(0, 3).join(', ') || 'no off-origin requests'})`);
});
