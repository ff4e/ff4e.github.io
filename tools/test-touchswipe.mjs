/**
 * UI test: swipe to move.
 *
 * A probe rather than a unit test because the thing under test is a real pointer stream
 * and the browser's own behaviour around it: which compatibility mouse events a moved
 * touch produces, and whether the page tries to scroll instead of reporting the drag.
 *
 * It builds its own context with `hasTouch` — the pattern `tools/test-rotate.mjs` uses,
 * and for the same reason: touch capability is a browser-CONTEXT option, so `withApp`
 * cannot express it. That is also why this is not folded into `tools/test-touchbar.mjs`
 * despite the shared `?touch=on` setup: that probe runs on a plain desktop context on
 * purpose, so as not to be a test of Chromium's touch emulation as well as of the bar.
 *
 * What it pins is the three sentences of the requirement — one square per swipe,
 * continuous movement while the finger stays down, and nothing at all on a desktop —
 * plus the one thing the implementation had to add for the platform: a touch that MOVES
 * still fires a compatibility click, and without suppressing it the fish would swim to
 * the finger the moment it let go.
 */
import { chromium } from 'playwright';
import { exitProbe, tickSleep, WAIT_BACKSTOP } from './ui-lib.mjs';

const BASE = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/**
 * SCHODY (room 5), and the active fish swims RIGHT.
 *
 * Chosen by measurement, not by taste: a held direction needs somewhere to go, and this
 * is the run the fish has from its starting cell — eight clear squares, against two in
 * KOSTE, where the first draft of this probe could not tell a held gesture from a flick.
 * If a future edit to the room narrows that corridor this probe fails loudly, which is
 * the right outcome: the assertions below are about distance travelled.
 */
const ROOM = 5;

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const browser = await chromium.launch();

async function open(query, touch) {
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 620 },
    hasTouch: touch,
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(WAIT_BACKSTOP);
  await p.addInitScript(() => {
    try {
      const raw = localStorage.getItem('ff.options');
      const o = raw ? JSON.parse(raw) : {};
      o.introSeen = true;
      localStorage.setItem('ff.options', JSON.stringify(o));
      localStorage.setItem('ff.devEnabled', '1');
    } catch {
      /* storage unavailable */
    }
    // What the swipe layer actually EMITS. Recorded in the capture phase, before the
    // game's own router sees it, so the negative assertions ("no arrow was sent") are
    // about the gesture layer rather than about what the room did with it — which is the
    // difference between testing this module and testing the room it happens to drive.
    window.__ffArrows = [];
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code.startsWith('Arrow')) window.__ffArrows.push(e.code);
      },
      true,
    );
  });
  await p.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff !== undefined);
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), ROOM);
  await p.waitForFunction(
    (n) =>
      window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.roomNum() === n,
    ROOM,
  );
  return p;
}

/**
 * Drive one gesture as a finger would: down in the middle of the room, out past the
 * threshold in steps, optionally held there, then up.
 *
 * Dispatched as `PointerEvent`s rather than through `page.touchscreen`, which can only
 * tap. `pointerType: 'touch'` is the part that matters — it is what the suppression of
 * the compatibility click keys off.
 */
const gesture = (p, dx, dy, compat = true) =>
  p.evaluate(
    ({ dx, dy, compat }) => {
      const el = document.getElementById('screen');
      const r = el.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + r.height / 2;
      const send = (type, x, y) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      send('pointerdown', x0, y0);
      for (let i = 1; i <= 4; i++) send('pointermove', x0 + (dx * i) / 4, y0 + (dy * i) / 4);
      window.__ffSwipeEnd = () => {
        send('pointerup', x0 + dx, y0 + dy);
        // The compatibility mouse event a real finger leaves behind, fired explicitly
        // because synthetic PointerEvents do not generate one. A mouse is given `compat:
        // false` instead: its mousedown lands at the START of a drag, where there is
        // nothing yet to suppress.
        if (compat)
          el.dispatchEvent(
            new MouseEvent('mousedown', { button: 0, clientX: x0 + dx, clientY: y0 + dy, bubbles: true, cancelable: true }),
          );
      };
    },
    { dx, dy, compat },
  );

const release = (p) => p.evaluate(() => window.__ffSwipeEnd());
/** The arrows emitted since the last check, and reset for the next one. */
const arrows = (p) =>
  p.evaluate(() => {
    const a = window.__ffArrows;
    window.__ffArrows = [];
    return a;
  });
/** Where the ACTIVE fish is. `state()` carries both fish and which one is driving. */
const cell = (p) =>
  p.evaluate(() => {
    const s = window.__ff.state();
    return s ? s[s.active] : null;
  });
const settled = (p) => p.waitForFunction(() => window.__ff.state()?.phase === 'idle');
/**
 * Let the command land, then wait for the room to come to rest.
 *
 * `phase === 'idle'` is true the instant a gesture ends — the engine has not picked the
 * command up yet — so settling alone reads the position from BEFORE the move. Ticking
 * first is what makes "the fish did not move" an observation rather than a race, and it
 * is why the negative assertions below (a tap, a desktop) can be trusted at all.
 */
const rest = async (p) => {
  await tickSleep(p, 8);
  await settled(p);
};

try {
  const p = await open('?touch=on', true);
  await rest(p);

  // ── One swipe, one square. It has to be exactly one, and on the swiped axis: a flick
  // that moved the fish two would mean the release never reached the held machine.
  let from = await cell(p);
  await gesture(p, 60, 0);
  await release(p);
  await rest(p);
  let to = await cell(p);
  expect(
    to.x === from.x + 1 && to.y === from.y,
    `a swipe moves the fish exactly one square that way (${from.x},${from.y} -> ${to.x},${to.y})`,
  );
  const sent = await arrows(p);
  expect(
    sent.length === 1 && sent[0] === 'ArrowRight',
    `and it is delivered as one held ArrowRight (${sent.join(',') || 'nothing'})`,
  );

  // ── Held: the finger stays down and the fish keeps going. This is the half a
  // per-gesture implementation would miss — it is `movement.ts`'s KeyRoom machine, which
  // the swipe reaches by being delivered as a held arrow key.
  await p.evaluate(() => window.__ff.restart());
  await rest(p);
  from = await cell(p);
  await gesture(p, 60, 0);
  await p.waitForFunction(
    ({ x, n }) => {
      const s = window.__ff.state();
      return s && s[s.active].x - x >= n;
    },
    { x: from.x, n: 3 },
  );
  expect(true, 'holding the finger down keeps the fish moving');

  // ── And letting go stops it, rather than leaving a key stuck down. Asserted with the
  // fish still short of the wall, so "it stopped" cannot be the corridor running out.
  await release(p);
  await rest(p);
  const stopped = await cell(p);
  await rest(p);
  const after = await cell(p);
  expect(
    after.x === stopped.x && after.y === stopped.y,
    `lifting the finger stops the fish (rested at ${stopped.x}, still at ${after.x})`,
  );

  // ── The compatibility click at the end of a swipe is swallowed. A touch that MOVES
  // still produces one, at the point the finger left the glass, and the room's own mouse
  // handler would read it as click-to-swim — the fish would carry on by itself towards
  // where the player let go. `gesture` fires that mousedown explicitly, because synthetic
  // PointerEvents do not generate the compatibility events a real finger does.
  expect(
    (await p.evaluate(() => window.__ff.state().swimming)) === false,
    'and the click behind the swipe did not start a swim',
  );

  // ── A tap is not a swipe: under the threshold nothing is sent, and the room's own
  // mouse handling is left exactly as it was.
  await p.evaluate(() => window.__ff.restart());
  await rest(p);
  await arrows(p);
  await gesture(p, 8, 0);
  await release(p);
  await rest(p);
  expect((await arrows(p)).length === 0, 'a short drag is a tap: no arrow is sent');
  // ...and its click is NOT swallowed, so the room's own mouse handling is exactly as it
  // was. Tap-to-swim is pre-existing behaviour, deliberately neither extended nor removed
  // here (Martin: tap-to-select is revisited after swipe has been tried on hardware), so
  // what this pins is that the swipe layer left it alone.
  expect(
    (await p.evaluate(() => window.__ff.state().swimming)) === true,
    'and its click still reaches the room underneath',
  );

  // ── A desktop is untouched: the same gesture on a page without the override does
  // nothing at all. The guarantee the whole touch series rests on.
  const desktop = await open('', false);
  await rest(desktop);
  await arrows(desktop);
  await gesture(desktop, 60, 0, false);
  await release(desktop);
  await rest(desktop);
  const onDesktop = await arrows(desktop);
  expect(
    onDesktop.length === 0,
    `desktop: a drag on the room sends nothing (${onDesktop.join(',') || 'nothing'})`,
  );
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
} finally {
  await browser.close().catch(() => {});
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
