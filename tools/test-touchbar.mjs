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
    inRoom.buttons.join(',') === '14,12,13,16,11',
    `the five buttons send map/save/load/options/swap (${inRoom.buttons.join(',')})`,
  );
  // It reserves space rather than floating over the room: the stage is measured with
  // clientWidth, so a margin is the only thing that both moves the bar out of the way
  // and tells the layout about it.
  expect(
    inRoom.marginRight === '72px' && inRoom.stageW <= inRoom.viewW - 72,
    `the bar reserves its width from the stage (margin ${inRoom.marginRight}, stage ${inRoom.stageW} of ${inRoom.viewW})`,
  );

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

  // ── Swap (region 11): the active fish changes. Asserted as a CHANGE from whatever it
  // was, so it does not depend on which fish a room starts with.
  const before = await p.evaluate(() => window.__ff.showmodeState().activeFish);
  await tap(p, 11);
  await p.waitForFunction((b) => window.__ff.showmodeState().activeFish !== b, before);
  expect(true, `Swap changes the active fish (from ${before})`);

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
  await p.selectOption('#touchmode', 'on');
  await settle(p, true);
  expect((await barState(p)).visible, 'and back on again');
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
} finally {
  await browser.close().catch(() => {});
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
