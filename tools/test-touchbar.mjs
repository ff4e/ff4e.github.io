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
 * is not also a test of Chromium's touch emulation, which test-rotate.mjs already covers.
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
      marginRight: stage ? getComputedStyle(stage).marginRight : '',
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
  expect(d.marginRight === '0px', `desktop: the stage has no margin reserved (${d.marginRight})`);
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
    inRoom.buttons.join(',') === '14,12,13,16,15',
    `the five buttons send map/save/load/options/restart (${inRoom.buttons.join(',')})`,
  );
  // It reserves space rather than floating over the room: the stage is measured with
  // clientWidth, so a margin is the only thing that both moves the bar out of the way
  // and tells the layout about it.
  expect(
    inRoom.marginRight === '72px' && inRoom.stageW <= inRoom.viewW - 72,
    `the bar reserves its width from the stage (margin ${inRoom.marginRight}, stage ${inRoom.stageW} of ${inRoom.viewW})`,
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

  // ── The clipping this mostly fixes. A phone-width portrait viewport could not hold the
  // row: measured at 393x852 with touch OFF, rooms overhang it by 22px (KOSTE), 84px and
  // 93px (the 795-wide ones), and `#stagebox`'s `overflow: hidden` cut the difference off.
  // The 167 native px of panel + gap were the bulk of it, so retiring the panel is the
  // bulk of the fix — but NOT all: `MIN_STAGE_SCALE` floors the scale at 0.5 here, so the
  // logical box is 400px in a 393px viewport and a room wide enough to fill it still
  // overhangs by 7. That residual is pinned in test/layout.test.ts, where it is arithmetic
  // rather than a second room to load. KOSTE (540 native) does not fill the box, so this
  // assertion is about KOSTE and says so.
  // Resized rather than opened in a context of its own: the viewport is a page property,
  // and a second context would pay the boot again to assert two numbers.
  await p.setViewportSize({ width: 393, height: 852 });
  await settleBox(p, tRow.roomW);
  const portrait = await rowState(p);
  expect(
    portrait.left >= 0 && portrait.right <= portrait.viewW,
    `portrait phone width: this room's row fits the viewport (${portrait.left}..${portrait.right} of ${portrait.viewW})`,
  );

  // ── And the room genuinely gets that width, measured end to end rather than in the
  // layout maths (test/layout.test.ts has the arithmetic). It takes a WIDTH-bound
  // viewport to show: where the height is what limits the scale, the panel's 167px were
  // never what the room was short of. 900x1000 is width-bound (900/800 < 1000/600) and
  // far enough above MIN_STAGE_SCALE that the floor, not the maths, is not what decides.
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

  // ── Save (region 12): a save exists afterwards where none did before.
  await p.evaluate(() => localStorage.removeItem('ff.save.' + window.__ff.roomNum()));
  await tap(p, 12);
  await p.waitForFunction(() => window.__ff.hasSave());
  expect(true, 'Save writes a save for this room');

  // ── Load (region 13): it takes, without the room ending up somewhere else.
  await tap(p, 13);
  await p.waitForFunction(() => !window.__ff.roomLoading() && window.__ff.screen() === 'room');
  expect((await p.evaluate(() => window.__ff.roomNum())) === ROOM, 'Load stays in the same room');

  // ── Map (region 14): off to the world map, and the bar goes with it. The second half
  // is the one a pushed implementation would get wrong.
  await tap(p, 14);
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await settle(p, false);
  const onMap = await barState(p);
  expect(!onMap.visible, 'Map leaves the room, and the bar comes down with it');
  expect(
    onMap.marginRight === '0px',
    `the map gets its width back (${onMap.marginRight})`,
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
  expect(off.marginRight === '0px', `and the stage gets its width back (${off.marginRight})`);
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
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
} finally {
  await browser.close().catch(() => {});
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
