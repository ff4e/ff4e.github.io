/**
 * UI test: the in-room touch bar and the touch Options, and the desktop neither must
 * appear on.
 *
 * The rule for whether touch mode is on is pinned in the unit suite
 * (test/touchMode.test.ts). What only a browser can show is everything these two modules
 * are actually made of: that each button reaches the RIGHT verb, that the bar comes and
 * goes with the screen, that it reserves its space instead of covering the room, and
 * that the two doors into the faithful Options face lead somewhere else in touch mode.
 *
 * The buttons and the Options controls are asserted by their EFFECT — the map appears,
 * the effects bus moves, the active fish changes — rather than by spying on
 * `panelAction`. Spying would prove a number was sent; this proves it was the right one,
 * which is the mistake worth catching in a table of regions copied into markup.
 *
 * The touch Options shares this probe rather than opening one of its own: it is reached
 * from this bar, so the setup is the same, and a second probe would pay the 1.3-2.7 s
 * browser launch again for it (AGENTS.md).
 *
 * It runs on a plain desktop context with `?touch=on`, deliberately: the touch UI has to
 * be reachable that way (it is the dev override's whole purpose), and it means this probe
 * is not also a test of Chromium's touch emulation, which test-phone-boots.mjs (a phone
 * reaches touch mode on its own) and test-touchswipe.mjs (a real touch pointer stream)
 * cover between them.
 */
import { chromium } from 'playwright';
import { exitProbe, WAIT_BACKSTOP } from './ui-lib.mjs';

const BASE = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/** KOSTE (room 6): an ordinary wide room, and not the boot room. */
const ROOM = 6;

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

/** What the bar is doing, and what it is costing the stage. */
const barState = (p) =>
  p.evaluate(() => {
    const bar = document.getElementById('touchbar');
    const stage = document.querySelector('.stage');
    return {
      mode: document.documentElement.hasAttribute('data-touch'),
      reserving: document.documentElement.hasAttribute('data-touchbar'),
      visible: bar !== null && !bar.hidden,
      buttons: bar ? [...bar.querySelectorAll('[data-region]')].map((b) => b.dataset.region) : [],
      marginLeft: stage ? getComputedStyle(stage).marginLeft : '',
      marginTop: stage ? getComputedStyle(stage).marginTop : '',
      stageW: stage ? stage.clientWidth : 0,
      viewW: window.innerWidth,
    };
  });

/**
 * The faithful panel column, and what the stage row is spending its width on.
 *
 * `#stagebox` and `#panelcol` are the row's only children, so their extremes ARE its
 * content. Measured as extremes rather than with `scrollWidth`, which is no use here: the
 * row is centred, so it overflows BOTH ways and only the right-hand half of that shows up
 * in a scroll width.
 */
const rowState = (p) =>
  p.evaluate(() => {
    const stage = document.querySelector('.stage');
    const col = document.getElementById('panelcol');
    const box = document.getElementById('stagebox');
    const shown = [...stage.children].filter((el) => getComputedStyle(el).display !== 'none');
    const rects = shown.map((el) => el.getBoundingClientRect());
    return {
      panel: col !== null && getComputedStyle(col).display !== 'none',
      panelW: col ? Math.round(col.getBoundingClientRect().width) : 0,
      roomW: box ? Math.round(box.getBoundingClientRect().width) : 0,
      left: Math.round(Math.min(...rects.map((r) => r.left))),
      right: Math.round(Math.max(...rects.map((r) => r.right))),
      viewW: window.innerWidth,
    };
  });

/**
 * Where the ROOM's centre lands, against the screen's, and how close it comes to the bar.
 *
 * `#stagebox`/`#panelcol` are no use for this: the box hugs the room horizontally but is
 * handed the whole HEIGHT and letterboxes the room inside it, so its centre is the room's
 * on one axis only. `#screen` is the room. Measured through `clientLeft`/`clientWidth`
 * rather than the bounding rect, which includes the canvas's 1px border — a pixel that
 * `#stagebox`'s `overflow: hidden` clips and the player never sees, but that would show
 * up here as a one-pixel overlap of the bar.
 */
const roomCentre = (p) =>
  p.evaluate(() => {
    const el = document.getElementById('screen');
    const r = el.getBoundingClientRect();
    const bar = document.getElementById('touchbar').getBoundingClientRect();
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    return {
      dx: Math.round(left + el.clientWidth / 2 - window.innerWidth / 2),
      dy: Math.round(top + el.clientHeight / 2 - window.innerHeight / 2),
      left: Math.round(left),
      top: Math.round(top),
      right: Math.round(left + el.clientWidth),
      bottom: Math.round(top + el.clientHeight),
      barRight: Math.round(bar.right),
      barBottom: Math.round(bar.bottom),
      viewW: window.innerWidth,
      viewH: window.innerHeight,
    };
  });

async function open(query) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 620 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(WAIT_BACKSTOP);
  await p.addInitScript(() => {
    try {
      const raw = localStorage.getItem('ff.options');
      const o = raw ? JSON.parse(raw) : {};
      o.introSeen = true;
      localStorage.setItem('ff.options', JSON.stringify(o));
      // The dev bar carries the Touch override this probe drives at the end; it is
      // hidden for players and revealed by this flag (see withApp in ui-lib.mjs).
      localStorage.setItem('ff.devEnabled', '1');
    } catch {
      /* storage unavailable */
    }
  });
  await p.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff !== undefined);
  return p;
}

const enter = async (p, num) => {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await p.waitForFunction(
    (n) =>
      window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.roomNum() === n,
    num,
  );
};

/** Wait for the bar to be up or down — it is only recomputed on a painted frame. */
const settle = (p, want) =>
  p.waitForFunction((w) => document.documentElement.hasAttribute('data-touchbar') === w, want);

/**
 * Wait for the bar's landscape EDGE to settle on `want`, room and all.
 *
 * Two conditions, and the second is the one that matters: the attribute alone says the
 * decision was made, not that the room has been re-scaled into what the bar now leaves.
 * `roomGeom()` is what `relayout()` computed and the canvas takes it in the room's draw,
 * so they agree only once both have caught up — the same idiom as `settleRoom`.
 *
 * The attribute is absent until the edge first moves off its default, so a missing one
 * reads as 'left'.
 */
const settleEdge = (p, want) =>
  p.waitForFunction((w) => {
    const g = window.__ff.roomGeom();
    const el = document.getElementById('screen');
    return (
      (document.documentElement.getAttribute('data-touchbar-edge') ?? 'left') === w &&
      g !== null &&
      Math.abs(el.clientWidth - g.cssW) <= 1 &&
      Math.abs(el.clientHeight - g.cssH) <= 1
    );
  }, want);

/**
 * Wait for a resize or a mode change to reach the screen.
 *
 * `relayout()` only recomputes the stage; the box is re-sized in the room's draw, so a
 * measurement taken straight after either would be the PREVIOUS frame's. Waits for the
 * width to stop being what it was rather than for a target, so the caller does not have
 * to predict the number it is about to measure.
 */
const settleBox = (p, was) =>
  p.waitForFunction(
    (w) => Math.round(document.getElementById('stagebox').getBoundingClientRect().width) !== w,
    was,
  );

/**
 * Resize, and wait for the new size to reach the ROOM.
 *
 * `settleBox` above is no use for the centring block, twice over: it waits for a WIDTH to
 * change, so a resize that only moves the height never satisfies it, and a rect that has
 * merely stopped moving is not the same as a rect that is RIGHT — `#screen` sits at the
 * canvas default of 300x150 until the first draw after `enter()`, which is stable, wrong,
 * and (being centred like anything else) passes a centring assertion vacuously.
 *
 * So it waits for two things: that the room's rect has actually MOVED (the same idiom as
 * `settleBox` — `relayout()` runs off the resize event, which is not ordered against this
 * poll, so "the new size arrived" cannot be assumed from `innerWidth` alone), and that the
 * DOM then agrees with the app's own layout — `roomGeom()` is what `relayout()` computed,
 * the canvas takes it in the room's draw, and the two match only once both have caught up.
 * Every viewport this is called with therefore has to change the room's size.
 */
const settleRoom = async (p, width, height) => {
  const was = await p.evaluate(() => {
    const el = document.getElementById('screen');
    return [el.clientWidth, el.clientHeight].join(',');
  });
  await p.setViewportSize({ width, height });
  await p.waitForFunction(
    ([w, h]) => window.innerWidth === w && window.innerHeight === h,
    [width, height],
  );
  await p.waitForFunction((was) => {
    const g = window.__ff.roomGeom();
    const el = document.getElementById('screen');
    return (
      g !== null &&
      [el.clientWidth, el.clientHeight].join(',') !== was &&
      Math.abs(el.clientWidth - g.cssW) <= 1 &&
      Math.abs(el.clientHeight - g.cssH) <= 1
    );
  }, was);
};

/** Where the bar's buttons actually end up, for the "do six of them still fit?" check. */
const barFit = (p) =>
  p.evaluate(() => {
    const els = [...document.querySelectorAll('#touchbar [data-region]')];
    const rects = els.map((el) => el.getBoundingClientRect());
    return {
      count: els.length,
      left: Math.round(Math.min(...rects.map((r) => r.left))),
      right: Math.round(Math.max(...rects.map((r) => r.right))),
      minW: Math.round(Math.min(...rects.map((r) => r.width))),
      viewW: window.innerWidth,
    };
  });

const tap = (p, region) => p.click(`#touchbar [data-region="${region}"]`);

/**
 * Move a range input the way a thumb does: set the value, then fire the `input` event
 * the browser fires during a drag. `p.fill()` on a range does not emit it, and `input`
 * is what the live-volume wiring listens to (src/app/touchOptions.ts).
 */
const setRange = (p, id, value) =>
  p.evaluate(
    ({ id, value }) => {
      const el = document.getElementById(id);
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { id, value },
  );

const browser = await chromium.launch();
try {
  // ── A desktop, untouched. The guarantee the whole touch series rests on, asserted
  // where it would actually be visible: in a room, which is the only place the bar is
  // ever up.
  const desktop = await open('');
  await enter(desktop, ROOM);
  const d = await barState(desktop);
  expect(!d.mode, 'desktop: touch mode is off');
  expect(!d.visible && !d.reserving, 'desktop: no bar in a room, and the stage keeps its width');
  expect(d.marginLeft === '0px', `desktop: the stage has no margin reserved (${d.marginLeft})`);
  const dRow = await rowState(desktop);
  expect(dRow.panel, 'desktop: the faithful control panel is beside the room');
  expect(dRow.panelW > 0, `desktop: and it is taking its width (${dRow.panelW}px)`);
  // The mouse player's Options is untouched: the corner button still scrolls the panel
  // to the canvas face, and the HTML one stays out of it. This is the guarantee the
  // whole touch series rests on, asserted at the one place the two could collide.
  await desktop.evaluate(() => window.__ff.panelAction(16));
  await desktop.waitForFunction(() => window.__ff.optionsOpen());
  expect(
    !(await desktop.evaluate(() => document.documentElement.hasAttribute('data-touchopts'))),
    'desktop: the corner button still opens the CANVAS options face',
  );

  // ── The same desktop with the dev override on: the touch UI has to be reachable
  // without device emulation, or nobody can look at it while building it.
  const p = await open('?touch=on');
  const boot = await barState(p);
  expect(boot.mode, 'override: touch mode is on');
  expect(!boot.visible, 'override: no bar on the map — these are IN-ROOM controls');

  await enter(p, ROOM);
  await settle(p, true);
  const inRoom = await barState(p);
  expect(inRoom.visible, 'in a room: the bar is up');
  expect(
    inRoom.buttons.join(',') === '14,12,13,24,16,15',
    `the six buttons send map/save/load/undo/options/restart (${inRoom.buttons.join(',')})`,
  );
  // It reserves space rather than floating over the room: the stage is measured with
  // clientWidth, so a margin is the only thing that both moves the bar out of the way
  // and tells the layout about it.
  expect(
    inRoom.marginLeft === '72px' && inRoom.stageW <= inRoom.viewW - 72,
    `the bar reserves its width from the stage (margin ${inRoom.marginLeft}, stage ${inRoom.stageW} of ${inRoom.viewW})`,
  );

  // ── The faithful panel is retired, and the room is given its footprint back. The
  // whole point of doing this LAST: everything the panel does now has a thumb-sized
  // counterpart, so hiding it leaves nothing unreachable.
  const tRow = await rowState(p);
  expect(!tRow.panel, 'the faithful panel column is gone in touch mode');
  expect(
    tRow.panelW === 0,
    `and it is claiming no width at all — column, not canvas (${tRow.panelW}px)`,
  );

  // ── The clipping this fixes. A phone-width portrait viewport could not hold the row:
  // measured at 393x852 with touch OFF, rooms overhang it by 22px (KOSTE), 84px and 93px
  // (the 795-wide ones), and `#stagebox`'s `overflow: hidden` cut the difference off. The
  // 167 native px of panel + gap were the bulk of it, and `MIN_STAGE_SCALE` was the rest:
  // it floored the scale at 0.5, so the logical box was 400px in a 393px viewport and a
  // room wide enough to fill it still overhung by 7. The floor now yields to the width, so
  // the residual is gone; the arithmetic for both halves is in test/layout.test.ts.
  // Resized rather than opened in a context of its own: the viewport is a page property,
  // and a second context would pay the boot again to assert two numbers.
  // Resized rather than opened in a context of its own: the viewport is a page property,
  // and a second context would pay the boot again to assert two numbers.
  await p.setViewportSize({ width: 393, height: 852 });
  await settleBox(p, tRow.roomW);
  const portrait = await rowState(p);
  expect(
    portrait.left >= 0 && portrait.right <= portrait.viewW,
    `portrait phone width: this room's row fits the viewport (${portrait.left}..${portrait.right} of ${portrait.viewW})`,
  );
  // The portrait half of the same reservation, asserted for parity with the landscape
  // check above: the bar is on the TOP edge here, so the height it costs is a
  // `margin-top`, and the landscape `margin-left` must be gone with its media query.
  const portraitBar = await barState(p);
  expect(
    portraitBar.marginTop === '66px' && portraitBar.marginLeft === '0px',
    `portrait: the bar reserves its height from the top (margin-top ${portraitBar.marginTop}, margin-left ${portraitBar.marginLeft})`,
  );
  // ── Six buttons in a portrait ROW, at the narrowest width this game is willing to be
  // played at. Landscape stacks them in a 72px column and has the whole height to spend,
  // so it cannot run out; portrait is the axis that can, and the bar neither wraps nor
  // scrolls — `.tbtn` is floored at 56px wide with a 6px gap, so six of them need 366px
  // before the sixth is pushed off the edge. 375 is an iPhone SE (deviceGate.ts's own
  // device table), which leaves 9px. Asserted from the rendered rects rather than from
  // that arithmetic, so a seventh button, a wider label or a padding change fails here
  // instead of on somebody's phone.
  await p.setViewportSize({ width: 375, height: 812 });
  await settleBox(p, portrait.roomW);
  const narrow = await barFit(p);
  const narrowRow = await rowState(p);
  expect(
    narrow.count === 6 && narrow.left >= 0 && narrow.right <= narrow.viewW,
    `portrait 375px: all ${narrow.count} buttons fit on screen (${narrow.left}..${narrow.right} of ${narrow.viewW})`,
  );
  expect(
    narrow.minW >= 44,
    `portrait 375px: and none is shrunk below a thumb (narrowest ${narrow.minW}px)`,
  );
  await p.setViewportSize({ width: 393, height: 852 });
  await settleBox(p, narrowRow.roomW);

  // ── And the room genuinely gets that width, measured end to end rather than in the
  // layout maths (test/layout.test.ts has the arithmetic). It takes a WIDTH-bound
  // viewport to show: where the height is what limits the scale, the panel's 167px were
  // never what the room was short of. 900x1000 is width-bound (900/800 < 1000/600).
  // Two things now separate the two numbers, not one: the panel's width, and the fit mode
  // — touch is always 'fill' (layout.ts, effectiveFitMode) and a width-bound viewport also
  // hands the box its leftover HEIGHT (stageBoxHeight). Both move the room the same way,
  // so the assertion is still one-directional; it just no longer isolates the panel.
  await p.setViewportSize({ width: 900, height: 1000 });
  await settleBox(p, portrait.roomW);
  const noPanel = await rowState(p);
  await p.selectOption('#touchmode', 'off');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touch'));
  await settleBox(p, noPanel.roomW);
  const withPanel = await rowState(p);
  expect(
    noPanel.roomW > withPanel.roomW,
    `the room gets the panel's width back (${noPanel.roomW} without it, ${withPanel.roomW} with)`,
  );
  await p.selectOption('#touchmode', 'on');
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touch'));
  await settleBox(p, withPanel.roomW);
  // Back to the probe's own viewport. Waits on `innerWidth`, NOT on `settleBox`: the box
  // here differs from the 900x1000 one by a single rounded pixel, and a "wait for it to
  // change" that the two sides can tie on is a wait that hangs the probe with no
  // diagnostic. Nothing after this reads geometry, so the resize landing is enough.
  await p.setViewportSize({ width: 1100, height: 620 });
  await p.waitForFunction(() => window.innerWidth === 1100);

  // ── Options (region 16): in touch mode the corner button opens the plain-HTML
  // Options, NOT the canvas face the mouse gets. Both halves matter: a touch player has
  // to reach the settings, and a touch player must not be able to reach the 9px-tall
  // canvas sliders that this screen exists to replace.
  await tap(p, 16);
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchopts'));
  expect(true, 'Options opens the touch Options');
  expect(
    (await p.evaluate(() => window.__ff.optionsOpen())) === false,
    'and NOT the canvas options face',
  );

  // Each control reaches the same verb the panel's own region does. Asserted by effect —
  // the setting actually moved — rather than by spying on `panelAction`, like the buttons
  // above: what is worth catching is a slider wired to the wrong bus.
  await setRange(p, 'topt-effect', 3);
  expect((await p.evaluate(() => window.__ff.volumes().effect)) === 3, 'the effects slider sets the effects bus');
  await setRange(p, 'topt-voice', 9);
  expect((await p.evaluate(() => window.__ff.volumes().voice)) === 9, 'the voices slider sets the voices bus');
  await setRange(p, 'topt-music', 12);
  expect((await p.evaluate(() => window.__ff.volumes().music)) === 12, 'the music slider sets the music bus');
  // The readout is the ORIGINAL's level (Volumes[12] = 64), not the 0..12 index.
  expect(
    (await p.evaluate(() => document.getElementById('topt-music-val').textContent)) === '64',
    'and the number beside it is the level, not the index',
  );
  await p.click('#touchopts input[value="en"]');
  await p.waitForFunction(() => window.__ff.subtitleMode() === 'en');
  expect(true, 'the subtitle radios set the subtitle mode');

  // Help: the pages are a full-screen document, so this overlay has to get out of the way
  // — it is position:fixed and would otherwise sit on top of them.
  await p.click('#topt-help');
  await p.waitForFunction(() => window.__ff.helpOpen());
  expect(
    !(await p.evaluate(() => document.documentElement.hasAttribute('data-touchopts'))),
    'Help opens the help pages and closes the Options over them',
  );
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !window.__ff.helpOpen());

  await tap(p, 16);
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchopts'));
  await p.click('#topt-close');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touchopts'));
  expect(true, 'Done closes it again');

  // ── Undo (region 24), and the `-` key that is its desktop door. The one button on this
  // bar with no `Uovl.pas` region behind it: the 1998 game has no undo, so nothing here
  // is a fidelity question and nothing else in the repo would notice a wrong region.
  //
  // Asserted by walking a run forwards banking `posHash` after each move — the hash that
  // exists for exactly this ("undo/load must reproduce it exactly", debugHooks.ts) — and
  // then undoing back down it. That is the property the whole approach rests on, and the
  // browser is where it is worth checking, because the unit suite drives the engine
  // directly while this drives the real room build, the real tick and the real button.
  //
  // The moves are found rather than chosen: which pushes are legal is a fact about KOSTE,
  // and a probe that hard-codes them breaks the day the room data is looked at again. Any
  // press that the record accepts will do.
  await p.evaluate(() => window.__ff.restart());
  await p.waitForFunction(() => window.__ff.moves() === 0 && window.__ff.undoDepth() === 1);
  const bank = [await p.evaluate(() => window.__ff.posHash())];
  for (const which of ['little', 'big']) {
    for (const dir of [4, 3, 1, 2]) {
      if (bank.length >= 4) break;
      const depth = bank.length;
      // One round trip per press: read the record, press, and hand back what was read.
      // Three moves, not thirty — each undo is a real room rebuild, and this probe pays
      // for every one of them.
      await p.evaluate(([w, d]) => window.__ff.press(w, d), [which, dir]);
      await p.waitForFunction(() => window.__ff.phase() === 'idle');
      const after = await p.evaluate(() => [window.__ff.undoDepth(), window.__ff.posHash()]);
      if (after[0] === depth) continue; // the push was blocked: try another direction
      bank.push(after[1]);
    }
  }
  expect(bank.length === 4, `three moves banked to undo (${bank.length - 1})`);
  // The `-` key first, once, so the desktop trigger is asserted on a real key event and
  // not only through the button. FFNG's key for it, which is where the choice comes from.
  await p.keyboard.press('Minus');
  await p.waitForFunction((n) => window.__ff.moves() === n, bank.length - 2);
  expect(
    (await p.evaluate(() => window.__ff.posHash())) === bank[bank.length - 2],
    'the − key takes back exactly one move',
  );
  // …and on a layout that is not the one this machine is typing on. Playwright presses a
  // physical key, so the line above only ever proves the US position; the binding matches
  // `e.key` precisely so that it does not. On a Czech QWERTZ the `-` key reports
  // `code: 'Slash'` — a `code: 'Minus'` binding does nothing there and silently steals
  // `=`, which is the key that IS in that position. Both halves are asserted, because the
  // second is how the first was found: reported from a real Czech keyboard, where the
  // on-screen button worked and the key did not.
  const czech = (key, code) =>
    p.evaluate(
      (e) => window.dispatchEvent(new KeyboardEvent('keydown', { ...e, bubbles: true, cancelable: true })),
      { key, code },
    );
  let atMoves = await p.evaluate(() => window.__ff.moves());
  await czech('-', 'Slash');
  await p.waitForFunction((n) => window.__ff.moves() === n - 1, atMoves);
  expect(true, "a Czech/German layout's − (code 'Slash') undoes too");
  atMoves = await p.evaluate(() => window.__ff.moves());
  await czech('=', 'Minus');
  await p.waitForTimeout(200);
  expect(
    (await p.evaluate(() => window.__ff.moves())) === atMoves,
    "and the '=' sitting at the US − position does not",
  );
  for (let i = (await p.evaluate(() => window.__ff.moves())); i > 0; i--) {
    await tap(p, 24);
    await p.waitForFunction((n) => window.__ff.moves() === n, i - 1);
    expect(
      (await p.evaluate(() => window.__ff.posHash())) === bank[i - 1],
      `Undo #${bank.length - i} lands exactly on the position before move ${i}`,
    );
  }
  // And it stops at the room's start instead of running off the bottom: the last point in
  // the history IS where the player is, so there is nothing below it.
  expect(!(await p.evaluate(() => window.__ff.canUndo())), 'at the start, there is nothing to undo');
  await tap(p, 24);
  const after = await p.evaluate(() => [window.__ff.moves(), window.__ff.screen()]);
  expect(after[0] === 0 && after[1] === 'room', 'and pressing it anyway is a clean no-op');

  // ── The rescue case, which is why undo does NOT copy save's rule. `CanSave` refuses
  // while a fish is dead (URoom.pas:26900) and a lone survivor deliberately keeps playing,
  // so before this the only way out of a fatal move was a full restart. Undo is the way
  // out, and this is the assertion that says so: refused by save, offered by undo.
  await p.evaluate(() => window.__ff.press('little', 3));
  await p.waitForFunction(() => window.__ff.phase() === 'idle' && window.__ff.undoDepth() === 2);
  await p.evaluate(() => window.__ff.killFish('little'));
  await p.waitForFunction(() => window.__ff.state().dead);
  const dead = await p.evaluate(() => [window.__ff.canSave(), window.__ff.canUndo()]);
  expect(!dead[0], 'with a fish dead, saving is refused');
  expect(dead[1], 'and undo is offered anyway');
  await tap(p, 24);
  await p.waitForFunction(() => !window.__ff.state().dead);
  expect(true, 'Undo brings the dead fish back — the move that killed it is taken back');

  // ── Restart (region 15): the room goes back to a fresh attempt. It is on the bar ONLY
  // because retiring the faithful panel took away its last touch-reachable door — its
  // other one is the Backspace key, which a phone does not have (touchButtons.ts). It is
  // also the one destructive button here, so it is worth knowing it does exactly the
  // panel's verb and not something adjacent.
  //
  // Asserted by two effects, because either alone is weak: the attempt counter moves
  // (`pokus`, the original's own "this is another try"), and the active fish is back to
  // what the room started with — which is what a rebuild does, and which a mere repaint
  // would not. The swap in between is what gives the rebuild something to undo; it goes
  // through `panelAction(11)` rather than a button because Swap no longer HAS one (a tap
  // on the play area swaps, and test-touchswipe covers that).
  const startActive = await p.evaluate(() => window.__ff.state().active);
  const startPokus = await p.evaluate(() => window.__ff.script().pokus);
  await p.evaluate(() => window.__ff.panelAction(11));
  await p.waitForFunction((a) => window.__ff.state().active !== a, startActive);
  await tap(p, 15);
  await p.waitForFunction((a) => window.__ff.state().active === a, startActive);
  expect(true, `Restart rebuilds the room (active fish back to ${startActive})`);
  const nowPokus = await p.evaluate(() => window.__ff.script().pokus);
  expect(
    nowPokus === startPokus + 1,
    `and it counts as a fresh attempt (pokus ${startPokus} -> ${nowPokus})`,
  );

  // ── Save (region 12): a save exists afterwards where none did before. One move first,
  // remembering the position BEFORE it, because what the save has to carry is not only
  // where the player is but how they got there.
  await p.evaluate(() => localStorage.removeItem('ff.save.' + window.__ff.roomNum()));
  let beforeLast = null;
  for (const dir of [3, 4, 1, 2]) {
    const depth = await p.evaluate(() => window.__ff.undoDepth());
    const at = await p.evaluate(() => window.__ff.posHash());
    await p.evaluate((d) => window.__ff.press('little', d), dir);
    await p.waitForFunction(() => window.__ff.phase() === 'idle');
    if ((await p.evaluate(() => window.__ff.undoDepth())) > depth) {
      beforeLast = at;
      break;
    }
  }
  expect(beforeLast !== null, 'a move before saving, so the save has a history to carry');
  const savedMoves = await p.evaluate(() => window.__ff.moves());
  await tap(p, 12);
  await p.waitForFunction(() => window.__ff.hasSave());
  expect(true, 'Save writes a save for this room');

  // ── A save carries the undo history with it (Martin, 2026-08-29), so a load resumes an
  // ATTEMPT and not merely a position: undo after it walks back through the moves that
  // reached the save. Restart in between is what makes this an assertion about the SAVE —
  // it throws the in-memory history away, so anything undoable afterwards came off disk.
  await tap(p, 15);
  await p.waitForFunction(() => window.__ff.moves() === 0 && !window.__ff.canUndo());
  expect(true, 'Restart in between leaves nothing in memory to undo');

  // ── Load (region 13): it takes, without the room ending up somewhere else.
  await tap(p, 13);
  // `loading()` as well as `roomLoading()`, and they are different things: the second is
  // the ROOM being fetched, the first is the load's fast-forward still replaying the
  // record. `phase` is 'idle' between that replay's moves and `moves()` reaches its total
  // on the last one, so without this the probe can measure a load that has not finished —
  // and undo is deliberately refused while it runs, which is a real refusal read as a bug.
  await p.waitForFunction(
    (n) =>
      !window.__ff.roomLoading() &&
      !window.__ff.loading() &&
      window.__ff.moves() === n &&
      window.__ff.phase() === 'idle',
    savedMoves,
  );
  expect((await p.evaluate(() => window.__ff.roomNum())) === ROOM, 'Load stays in the same room');
  expect(
    await p.evaluate(() => window.__ff.canUndo()),
    'and it brings the saved run\'s undo history back with it',
  );
  await tap(p, 24);
  await p.waitForFunction((h) => window.__ff.posHash() === h, beforeLast);
  expect(true, 'Undo after a load steps back INTO the saved run, one move at a time');

  // ── Nothing in this room's history failed to replay. `undoMove` falls back to an
  // earlier point when a replay does not reproduce the one it was aimed at, which is a
  // real case (PARTY2 #18 replays one of its own records into a dead fish) — but in an
  // ordinary room it must never fire, and a counter that has moved here means the replay
  // path has drifted from the live one.
  expect(
    (await p.evaluate(() => window.__ff.undoDiverged())) === 0,
    'no point in this room needed the divergence fallback',
  );
  expect(
    (await p.evaluate(() => window.__ff.undoSnapshots())) <= 120,
    'and the history keeps script snapshots only for the newest points',
  );

  // ── Map (region 14): off to the world map, and the bar goes with it. The second half
  // is the one a pushed implementation would get wrong.
  await tap(p, 14);
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await settle(p, false);
  const onMap = await barState(p);
  expect(!onMap.visible, 'Map leaves the room, and the bar comes down with it');
  expect(
    onMap.marginLeft === '0px',
    `the map gets its width back (${onMap.marginLeft})`,
  );
  // ── The map's own Options corner is the SECOND door into the faithful face, and it
  // has to hand over too — otherwise the panel column floats over the map on a phone
  // with the very sliders the touch screen replaces. `mapOverlay` staying 'none' is the
  // half worth pinning: nothing floats, so there is no overlay state to unwind.
  await p.evaluate(() => window.__ff.openMapOptions());
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchopts'));
  expect(
    (await p.evaluate(() => window.__ff.mapOverlay())) === 'none',
    "the map's Options corner opens the touch Options, without floating the panel",
  );
  await p.click('#topt-close');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touchopts'));
  // ── The dev-bar control, driven the way a person drives it. Two independent
  // reviewers found the same defect here: the page was loaded with `?touch=on`, and
  // with the URL outranking everything the control could write storage all day and
  // never turn the mode off. Nothing in the suite touched this control at all, which is
  // why it was invisible — so it is asserted from the far end, on the bar itself.
  await enter(p, ROOM);
  await settle(p, true);
  await p.selectOption('#touchmode', 'off');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touch'));
  await settle(p, false);
  const off = await barState(p);
  expect(!off.visible, 'the dev-bar control turns the touch UI off, over a ?touch=on URL');
  expect(off.marginLeft === '0px', `and the stage gets its width back (${off.marginLeft})`);
  const offRow = await rowState(p);
  expect(offRow.panel, 'and the faithful panel comes back with it');
  await p.selectOption('#touchmode', 'on');
  await settle(p, true);
  expect((await barState(p)).visible, 'and back on again');

  // ── Turning the override ON while the CANVAS Options face is open must not strand it.
  // The hand-over returns before the branch that scrolls that face back down, so without
  // an unwind nothing could close it until the next room load and both Options would be
  // on screen at once — the one thing this series promises cannot happen. Only reachable
  // from this control, which is exactly why nothing else was watching it.
  await p.selectOption('#touchmode', 'off');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touch'));
  await p.evaluate(() => window.__ff.panelAction(16));
  await p.waitForFunction(() => window.__ff.optionsOpen());
  await p.selectOption('#touchmode', 'on');
  await p.waitForFunction(() => !window.__ff.optionsOpen());
  expect(true, 'switching to touch closes the canvas options face behind it');

  // ── The room is centred on the SCREEN, not on what the bar left over ─────────────
  // The bar reserves its space with a margin on `.stage`, and `.stage` centres its
  // content inside its OWN box — so before this was fixed "centred" meant centred in
  // [barWidth, viewport], and the room sat half a bar's width off true centre: +36px in
  // landscape, +33px in portrait, independent of the room. What is wanted is
  // `nearEdge = max(barSize, (viewport - roomSize) / 2)` — the screen's centre, given up
  // only as far as it takes to clear the bar — so both halves of that max are asserted,
  // on both axes. See the flex-spacer rules in index.html for how the clamp is expressed.
  //
  // Runs LAST, on this page rather than a context of its own, because it needs the dev
  // chrome GONE: `#devbar` and `#info` are in-flow siblings of `.stage`, so while they
  // are up the stage is not the viewport and the vertical half of this cannot be measured
  // against `innerHeight` at all. Ctrl+Alt+D is the only door out of dev mode (main.ts),
  // and it takes the dev bar this file's previous section drives with it — hence last,
  // rather than paying another boot to say the same thing.
  await enter(p, ROOM);
  await settle(p, true);
  await p.keyboard.press('Control+Alt+D');
  await p.waitForFunction(() => !document.body.classList.contains('dev'));
  const player = p;

  // 900x800 is width-bound (828 of usable width against 800 native px), so the room fills
  // everything the bar left and there is nowhere to take a centring gap from. The bar
  // wins — that is the one thing allowed to beat true centring — but by exactly the width
  // it needs and no more. First, because dropping the dev chrome resizes nothing on its
  // own and `settleRoom` needs a viewport that actually moves.
  await settleRoom(player, 900, 800);
  const tight = await roomCentre(player);
  expect(
    tight.left >= tight.barRight,
    `landscape tight: the bar wins over centring (room left ${tight.left}, bar right ${tight.barRight})`,
  );
  expect(
    tight.left <= tight.barRight + 1 && tight.right <= tight.viewW,
    `landscape tight: and takes no more than it must (${tight.left}..${tight.right} of ${tight.viewW})`,
  );

  // Slack on both sides — the reported case, and the one where the clamp must NOT bind.
  await settleRoom(player, 1100, 620);
  const wide = await roomCentre(player);
  expect(
    Math.abs(wide.dx) <= 1,
    `landscape: the room's centre is the screen's (off by ${wide.dx}px of ${wide.viewW})`,
  );
  expect(
    wide.left >= wide.barRight,
    `landscape: and the bar still does not overlap it (room left ${wide.left}, bar right ${wide.barRight})`,
  );

  // The portrait half. A different element carries it — the box is handed the whole
  // height and letterboxes the room inside it, so the vertical slack is in `#stagebox`,
  // not in `.stage` — which is exactly why it needs a probe of its own rather than being
  // assumed to follow from the landscape one.
  await settleRoom(player, 393, 852);
  const tall = await roomCentre(player);
  expect(
    Math.abs(tall.dy) <= 1,
    `portrait: the room's centre is the screen's (off by ${tall.dy}px of ${tall.viewH})`,
  );
  expect(
    tall.top >= tall.barBottom,
    `portrait: and the bar still does not overlap it (room top ${tall.top}, bar bottom ${tall.barBottom})`,
  );

  // Portrait's tight case takes a viewport small enough that the room fills the height it
  // is left (320x360: 294px of it against a 284px-tall room, less than one bar of slack).
  // Same rule as landscape — the bar is the one thing that outranks the centre — and the
  // same upper bound, which is the half that bites: the box is sized SHORTER than the
  // stage and `.stage` re-centres it, so without `#stagebox` growing to fill the height
  // the room settles `STAGE_EDGE * scale` below the bar rather than against it.
  await settleRoom(player, 320, 360);
  const squat = await roomCentre(player);
  expect(
    squat.top >= squat.barBottom,
    `portrait tight: the bar wins over centring (room top ${squat.top}, bar bottom ${squat.barBottom})`,
  );
  expect(
    squat.top <= squat.barBottom + 1 && squat.bottom <= squat.viewH,
    `portrait tight: and takes no more than it must (${squat.top}..${squat.bottom} of ${squat.viewH})`,
  );

  // ── The third combination: which EDGE the bar takes in LANDSCAPE, per room ──
  //
  // The two above are orientation-only, and a media query is enough for them. This one is
  // not: at ONE landscape viewport, a room much wider than the screen puts the bar along
  // the top and an ordinary room leaves it down the left. Asserted as a pair at a single
  // size, because that IS the claim — the edge tracks the room, and CSS cannot see which
  // room is loaded (`src/app/touchBarEdge.ts`).
  //
  // 1100x620 is 1.77:1. KOSTE 540x495 is 1.09:1, flatter than the screen, so it is
  // height-bound and the 72px left bar comes out of the width it was not using. UTES
  // 780x225 is 3.47:1, wider than the screen, so it is width-bound and the same 72px come
  // straight off the axis that decides its scale — while 66px off the height do not.
  await settleRoom(player, 1100, 620);
  await settleEdge(player, 'left');
  const flatBar = await barState(player);
  expect(
    flatBar.marginLeft === '72px' && flatBar.marginTop === '0px',
    `landscape, ordinary room: the bar stays down the left (margin-left ${flatBar.marginLeft}, margin-top ${flatBar.marginTop})`,
  );

  await enter(player, 7); // UTES, the widest room in the game
  await settleEdge(player, 'top');
  const wideBar = await barState(player);
  expect(
    wideBar.marginTop === '66px' && wideBar.marginLeft === '0px',
    `landscape, very wide room: the SAME viewport puts the bar on top (margin-top ${wideBar.marginTop}, margin-left ${wideBar.marginLeft})`,
  );
  // The centring clamp (#126) has to hold on the new edge exactly as it does on the other
  // two — this is the regression that would otherwise go unnoticed, since the clamp moves
  // to a different element here (`#stagebox`, as in portrait) than it uses for the left
  // bar (`.stage`).
  const wideRoom = await roomCentre(player);
  expect(
    Math.abs(wideRoom.dx) <= 1,
    `landscape top bar: the room's centre is still the screen's (off by ${wideRoom.dx}px of ${wideRoom.viewW})`,
  );
  expect(
    wideRoom.top >= wideRoom.barBottom,
    `landscape top bar: and the bar does not overlap it (room top ${wideRoom.top}, bar bottom ${wideRoom.barBottom})`,
  );
  // The edge is chosen by comparing VISIBLE area, so the winner can never be an edge that
  // cuts the room off — the thing a scale comparison alone would have got wrong.
  expect(
    wideRoom.bottom <= wideRoom.viewH && wideRoom.left >= 0 && wideRoom.right <= wideRoom.viewW,
    `landscape top bar: and the room is not clipped by it (${wideRoom.left}..${wideRoom.right} of ${wideRoom.viewW}, bottom ${wideRoom.bottom} of ${wideRoom.viewH})`,
  );

  // And back, without the viewport moving at all: a room change alone moves the bar, which
  // is the whole reason this cannot live in `relayout()` (a room change never reaches it).
  await enter(player, 6);
  await settleEdge(player, 'left');
  const backBar = await barState(player);
  expect(
    backBar.marginLeft === '72px' && backBar.marginTop === '0px',
    `landscape: leaving the wide room puts the bar back on the left (margin-left ${backBar.marginLeft})`,
  );

  // ── A cut room never wins, however much of it survives the cut ──
  //
  // 669x280 with ZRC (555x225), found by Martin 2026-08-31. It is short enough that
  // MIN_STAGE_SCALE's floor overflows the height once the top bar has taken 66px of it, so
  // the room is drawn 266px tall into 214px and 52px of the level is simply not on screen.
  // The surviving part is still LARGER than the whole room is with the bar on the left
  // (140,598 px2 against 138,740), so a plain "bigger wins" comparison moves the bar onto
  // the cut layout — which is what shipped first and what this pins against coming back.
  await enter(player, 9);
  await settleEdge(player, 'top'); // roomy window: the top edge is bigger and cuts nothing
  await settleRoom(player, 669, 280);
  await settleEdge(player, 'left');
  const cut = await roomCentre(player);
  expect(
    cut.top >= 0 && cut.bottom <= cut.viewH,
    `short viewport: the whole room is on screen vertically (${cut.top}..${cut.bottom} of ${cut.viewH})`,
  );
  expect(
    cut.left >= cut.barRight && cut.right <= cut.viewW,
    `short viewport: and horizontally, clear of the bar (${cut.left}..${cut.right} of ${cut.viewW}, bar right ${cut.barRight})`,
  );
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
} finally {
  await browser.close().catch(() => {});
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
