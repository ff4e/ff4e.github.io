/**
 * UI test: the game played with a controller on a TV (`?tv`).
 *
 * TV mode is the tablet UI driven by a controller (src/app/touchMode.ts), so what this
 * probe pins is the part only a browser can show: that the tablet's pieces a controller
 * cannot use stand aside (the faithful panel, the floating buttons), that the legend
 * replaces them, and that every screen a player reaches can be worked from the pad alone —
 * the fish, the confirmed Save / Load / Restart, Undo, Options, the help, the map and its
 * record panel, the credits.
 *
 * The pad is a stub Standard Gamepad patched into `navigator.getGamepads()` before boot,
 * the same seam the dev sim-pad and the Xbox shell's bridge use, so the poller under test
 * is the real one. Everything is asserted by EFFECT — the fish moved, the save exists, the
 * map came up — not by spying on which function was called.
 */
import { chromium } from 'playwright';
import { exitProbe, launchBrowser, WAIT_BACKSTOP } from './ui-lib.mjs';

const BASE = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/** KOSTE (room 6): an ordinary room with both fish free to move. */
const ROOM = 6;

const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, view: 8, menu: 9, dup: 12, ddown: 13, dleft: 14, dright: 15 };

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const browser = await launchBrowser();
const errs = [];

async function open(query, firstRun = false) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(WAIT_BACKSTOP);
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push('PE:' + e.message));
  if (firstRun) await p.addInitScript(() => (window.__firstRun = true));
  await p.addInitScript(() => {
    try {
      const raw = localStorage.getItem('ff.options');
      const o = raw ? JSON.parse(raw) : {};
      if (!window.__firstRun) o.introSeen = true;
      localStorage.setItem('ff.options', JSON.stringify(o));
    } catch {
      /* storage unavailable */
    }
    const pad = {
      id: 'probe pad (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    window.__probePad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await p.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff !== undefined);
  return p;
}

/**
 * Let the render loop run a few more times, so the pad has been POLLED in its new state.
 * Counted in loop iterations rather than milliseconds: the loop is idle-throttled and, in a
 * parallel run, starved, so a fixed sleep can miss a press or a release entirely.
 */
const polls = async (p) => {
  const start = await p.evaluate(() => window.__ff.throttleInfo().loops);
  await p.waitForFunction((n) => window.__ff.throttleInfo().loops >= n + 3, start);
};

async function press(p, name) {
  await p.evaluate((i) => {
    window.__probePad.buttons[i] = { pressed: true, touched: true, value: 1 };
  }, BTN[name]);
  await polls(p);
  await p.evaluate((i) => {
    window.__probePad.buttons[i] = { pressed: false, touched: false, value: 0 };
  }, BTN[name]);
  await polls(p);
}

async function stick(p, axes) {
  await p.evaluate((a) => {
    window.__probePad.axes = a;
  }, axes);
}

const enter = async (p, num) => {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await p.waitForFunction(
    (n) => window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.roomNum() === n,
    num,
  );
};

const legend = (p) =>
  p.evaluate(() => {
    const el = document.getElementById('padlegend');
    return el && !el.hidden ? [...el.querySelectorAll('.pl-item')].map((i) => i.textContent) : null;
  });

/** The move record: IJKL are the little fish's moves, WASD the big one's (core/record.ts). */
const record = (p) => p.evaluate(() => window.__ff.record());

try {
  const p = await open('?tv');

  // ── TV mode is the tablet layout, with the legend instead of buttons ───────
  const attrs = await p.evaluate(() => ({
    tv: document.documentElement.hasAttribute('data-tv'),
    touch: document.documentElement.hasAttribute('data-touch'),
  }));
  expect(attrs.tv && attrs.touch, `?tv is TV mode on the tablet layout (tv=${attrs.tv}, touch=${attrs.touch})`);

  await enter(p, ROOM);
  await p.waitForFunction(() => document.getElementById('padlegend')?.hidden === false);
  const panel = await p.evaluate(() => {
    const c = document.getElementById('panelcol');
    return c ? getComputedStyle(c).display : 'missing';
  });
  expect(panel === 'none', `the faithful panel is hidden (${panel})`);
  const bar = await p.evaluate(() => document.getElementById('touchbar')?.hidden);
  expect(bar === true, 'the tablet buttons stay down');
  const roomLegend = await legend(p);
  expect(
    roomLegend?.join('|') === 'LLittle|RBig|BMap|LBSave|RBLoad|XRestart|☰Options|YUndo',
    `the room legend names every verb (${roomLegend?.join(', ')})`,
  );

  // ── The sticks: left is the little fish, right the big one ─────────────────
  const r0 = await record(p);
  await stick(p, [1, 0, 0, 0]);
  await p.waitForFunction((n) => window.__ff.record().length > n, r0.length);
  await stick(p, [0, 0, 0, 0]);
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  const r1 = await record(p);
  const added1 = r1.slice(r0.length);
  expect(/^[IJKL]+$/.test(added1), `left stick moved the little fish ("${added1}")`);
  await stick(p, [0, 0, -1, 0]);
  await p.waitForFunction((n) => window.__ff.record().length > n, r1.length);
  await stick(p, [0, 0, 0, 0]);
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  const r2 = await record(p);
  const added2 = r2.slice(r1.length);
  expect(/^[WASD]+$/.test(added2), `right stick moved the big fish ("${added2}")`);

  // ── Ⓨ takes back one move, without asking ──────────────────────────────────
  const before = await p.evaluate(() => window.__ff.moves());
  await press(p, 'y');
  await p.waitForFunction((n) => window.__ff.moves() < n, before);
  expect(true, 'Y took back a move');

  // ── Save asks first; Ⓑ says no, Ⓐ says yes ───────────────────────────────
  const saveKey = `ff.save.${ROOM}`;
  await press(p, 'lb');
  let prompt = await p.evaluate(() => ({
    up: document.getElementById('pad-confirm')?.hidden === false,
    title: document.getElementById('pad-confirm-title')?.textContent,
    legend: document.getElementById('padlegend')?.hidden,
  }));
  expect(prompt.up && prompt.title === 'Save the game?', `LB asks "${prompt.title}"`);
  expect(prompt.legend === true, 'the legend steps aside for the prompt');
  await press(p, 'b');
  const declined = await p.evaluate((k) => localStorage.getItem(k), saveKey);
  expect(declined === null, 'B declined: nothing saved');
  await press(p, 'lb');
  await press(p, 'a');
  await p.waitForFunction((k) => localStorage.getItem(k) !== null, saveKey);
  expect(true, 'LB then A saved the game');

  // ── Restart asks first, then throws the attempt away ────────────────────────
  await press(p, 'x');
  prompt = await p.evaluate(() => document.getElementById('pad-confirm-title')?.textContent);
  expect(prompt === 'Restart the room?', `X asks "${prompt}"`);
  await press(p, 'a');
  await p.waitForFunction(() => window.__ff.moves() === 0);
  expect(true, 'X then A restarted the room');

  // ── Load asks first, and brings the save back ──────────────────────────────
  await press(p, 'rb');
  await press(p, 'a');
  await p.waitForFunction(() => window.__ff.moves() > 0);
  expect(true, 'RB then A loaded the saved game');

  // ── ☰ opens the tablet Options; the pad works its controls ─────────────────
  await press(p, 'menu');
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchopts'));
  const optLegend = await legend(p);
  expect(optLegend?.join('|') === '✚Change|ASelect|BDone', `Options legend (${optLegend?.join(', ')})`);
  const subsBefore = await p.evaluate(() => document.querySelector('input[name="topt-subs"]:checked')?.value);
  // Down one row at a time — push until the highlight moves, then let go — until the
  // subtitles. Each step waits on the highlight rather than a clock, so a starved loop
  // cannot turn one push into a held repeat.
  const focusedRow = () =>
    p.evaluate(() => {
      const el = document.querySelector('#touchopts .pad-focus');
      return el ? [...document.querySelectorAll('#touchopts input[type=range], #touchopts fieldset, #touchopts button')].indexOf(el) : -1;
    });
  let steps = 0;
  for (let row = await focusedRow(); row !== 3 && steps < 6; steps++) {
    await stick(p, [0, 1, 0, 0]);
    await p.waitForFunction((r) => {
      const el = document.querySelector('#touchopts .pad-focus');
      return el && [...document.querySelectorAll('#touchopts input[type=range], #touchopts fieldset, #touchopts button')].indexOf(el) !== r;
    }, row);
    await stick(p, [0, 0, 0, 0]);
    await polls(p);
    row = await focusedRow();
  }
  const focused = await p.evaluate(() => document.querySelector('#touchopts .pad-focus')?.tagName);
  expect(focused === 'FIELDSET' && steps === 3, `down three times reaches the subtitles (${focused}, ${steps} steps)`);
  await press(p, 'dright');
  const subsAfter = await p.evaluate(() => document.querySelector('input[name="topt-subs"]:checked')?.value);
  expect(subsAfter !== subsBefore, `right changes the subtitles (${subsBefore} -> ${subsAfter})`);
  await press(p, 'b');
  const optsClosed = await p.evaluate(() => !document.documentElement.hasAttribute('data-touchopts'));
  expect(optsClosed, 'B closes Options');

  // ── Help, from Options: LB/RB page it, and only Ⓑ closes it ─────────────────
  await press(p, 'menu');
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchopts'));
  await p.click('#topt-help');
  await p.waitForFunction(() => window.__ff.helpOpen());
  await polls(p);
  const helpLegend = await legend(p);
  expect(helpLegend?.join('|') === 'LBRBPage|BClose', `help legend (${helpLegend?.join(', ')})`);
  await press(p, 'rb');
  let help = await p.evaluate(() => [window.__ff.helpOpen(), window.__ff.helpPage()]);
  expect(help[0] && help[1] === 1, `RB turns to the next help page (open=${help[0]}, page=${help[1]})`);
  await press(p, 'lb');
  help = await p.evaluate(() => [window.__ff.helpOpen(), window.__ff.helpPage()]);
  expect(help[0] && help[1] === 0, `LB turns back (open=${help[0]}, page=${help[1]})`);
  // What the Xbox WebView2 also sends for a controller button: a keydown with a
  // VK_GAMEPAD_* code. The help closes on any key, so this must not count as one.
  await p.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'GamepadRightShoulder', keyCode: 0xc7, bubbles: true })),
  );
  expect(await p.evaluate(() => window.__ff.helpOpen()), 'a native controller keydown leaves the help open');
  await press(p, 'b');
  expect(!(await p.evaluate(() => window.__ff.helpOpen())), 'B closes the help');

  // ── Ⓑ leaves for the map, where a room is already selected ─────────────────
  await press(p, 'b');
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await p.waitForFunction(() => document.getElementById('padlegend')?.hidden === false);
  const mapLegend = await legend(p);
  expect(mapLegend?.join('|') === 'LChoose|AOpen|☰Options', `map legend (${mapLegend?.join(', ')})`);
  const first = await p.evaluate(() => window.__ff.mapSelectRoom());
  expect(typeof first === 'number' && first > 0, `a room is selected on arrival (${first})`);

  // Ⓑ on the plain map is not Escape: it must not drop the player back into a room.
  await press(p, 'b');
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'B on the plain map stays on the map');

  // Ⓐ on an unsolved room enters it, through the map's own launch.
  await press(p, 'a');
  await p.waitForFunction(
    (n) => window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.roomNum() === n,
    first,
  );
  expect(true, `A on the selected room entered it (${first})`);

  // Back on the map, the room just played is the selection — resuming is one press.
  await press(p, 'b');
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await p.waitForFunction(() => window.__ff.mapSelectRoom() !== null);
  const again = await p.evaluate(() => window.__ff.mapSelectRoom());
  expect(again === first, `the room just played is selected again (${again})`);

  // The stick moves the selection on, to a node or a corner button.
  await stick(p, [-1, 0, 0, 0]);
  await polls(p);
  await stick(p, [0, 0, 0, 0]);
  await polls(p);
  const moved = await p.evaluate(() => [window.__ff.mapSelectRoom(), window.__ff.mapHover()]);
  expect(moved[0] !== first || moved[1] !== null, `the stick moved the selection (${moved})`);

  // ── The credits: only Ⓑ leaves, and the legend shows only Ⓑ ─────────────────
  await p.evaluate(() => window.__ff.openCredits());
  await p.waitForFunction(() => window.__ff.mapOverlay() === 'credits');
  await polls(p);
  const creditsLegend = await legend(p);
  expect(creditsLegend?.join('|') === 'BClose', `credits legend (${creditsLegend?.join(', ')})`);
  await press(p, 'a');
  expect((await p.evaluate(() => window.__ff.mapOverlay())) === 'credits', 'A does nothing on the credits');
  await press(p, 'b');
  expect((await p.evaluate(() => window.__ff.mapOverlay())) === 'none', 'B closes the credits');

  await p.context().close();

  // ── First run: the intro's start splash answers Ⓐ ──────────────────────────
  // It only answers a pointer otherwise, and `skip()` is deliberately inert on it — so a
  // controller used to be stuck on the very first screen of the console build.
  const q = await open('?tv', true);
  await q.waitForFunction(() => document.getElementById('intro-start')?.hidden === false);
  const label = await q.evaluate(() => document.getElementById('intro-start')?.textContent);
  expect(label === '▶ Press Ⓐ to start', `the splash names the controller (${label})`);
  await press(q, 'a');
  const started = await q.evaluate(() => document.getElementById('intro-start')?.hidden);
  expect(started === true, 'A started the intro');
  await q.context().close();
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
}

if (errs.length) {
  ok = false;
  console.log('  console errors:', errs);
}
await browser.close().catch(() => {});
console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
