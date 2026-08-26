/**
 * UI test: the in-room touch bar, and the desktop it must never appear on.
 *
 * The rule for whether touch mode is on is pinned in the unit suite
 * (test/touchMode.test.ts). What only a browser can show is everything this module is
 * actually made of: that each button reaches the RIGHT verb, that the bar comes and goes
 * with the screen, and that it reserves its space instead of covering the room.
 *
 * The buttons are asserted by their EFFECT — the map appears, the options face opens, the
 * active fish changes — rather than by spying on `panelAction`. Spying would prove the
 * bar sent a number; this proves the number was the right one, which is the mistake worth
 * catching in a table of five regions copied into markup.
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

  // ── Options (region 16): the face the panel scrolls to.
  await tap(p, 16);
  await p.waitForFunction(() => window.__ff.optionsOpen());
  expect(true, 'Options opens the options face');
  await tap(p, 16);
  await p.waitForFunction(() => !window.__ff.optionsOpen());
  expect(true, 'Options again closes it');

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
