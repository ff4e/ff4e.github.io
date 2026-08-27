/**
 * UI test: the touch gestures on the play area — swipe to move, tap to swap.
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
 * What it pins is the requirement — one square per swipe, continuous movement while the
 * finger stays down, a tap swapping the fish, and nothing at all on a desktop — plus the
 * two things the platform forced: the gesture has to work on the black margin as well as
 * on the room, and the compatibility click a touch leaves behind has to be suppressed or
 * the fish swims off to wherever the finger let go.
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
const gesture = (p, dx, dy, { compat = true, from = '#screen' } = {}) =>
  p.evaluate(
    ({ dx, dy, compat, from }) => {
      const el = document.querySelector(from);
      const r = el.getBoundingClientRect();
      // The margin is sampled at its top-left corner plus a few px, because the middle of
      // `body` is the room. `#screen` is sampled at its centre.
      const x0 = from === 'body' ? r.left + 6 : r.left + r.width / 2;
      const y0 = from === 'body' ? r.top + 6 : r.top + r.height / 2;
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
      // Keep dragging from the same gesture, in absolute offsets from where it began —
      // which is how a turn has to be driven: the finger never lifts.
      window.__ffSwipeTo = (x, y) => {
        for (let i = 1; i <= 4; i++) send('pointermove', x0 + (x * i) / 4, y0 + (y * i) / 4);
      };
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
    { dx, dy, compat, from },
  );

const release = (p) => p.evaluate(() => window.__ffSwipeEnd());
/** Keep the same gesture going, to a new offset from where it started. */
const steer = (p, x, y) => p.evaluate(({ x, y }) => window.__ffSwipeTo(x, y), { x, y });
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

  // ── Steering: the finger turns without lifting, and the fish turns with it. Driven as
  // a reversal, which needs no knowledge of the room — the way back is the way it just
  // came. What it proves is the trailing anchor: measured from where the gesture STARTED,
  // 120 px back is still a net-rightward vector and nothing would turn.
  await p.evaluate(() => window.__ff.restart());
  await rest(p);
  await arrows(p);
  from = await cell(p);
  await gesture(p, 60, 0);
  await p.waitForFunction(
    ({ x }) => {
      const s = window.__ff.state();
      return s && s[s.active].x - x >= 2;
    },
    { x: from.x },
  );
  const peak = await cell(p);
  await steer(p, -60, 0);
  await p.waitForFunction(
    ({ x }) => {
      const s = window.__ff.state();
      return s && s[s.active].x < x;
    },
    { x: peak.x },
  );
  expect(true, `turning the finger round turns the fish round (out to ${peak.x}, then back)`);
  await release(p);
  await rest(p);
  const turned = await arrows(p);
  expect(
    turned.join(',') === 'ArrowRight,ArrowLeft',
    `and it is one press each way, in order (${turned.join(',') || 'nothing'})`,
  );

  // ── The black margin swipes too. A phone draws the room into a fraction of the glass,
  // and requiring the gesture to start on the canvas left most of the screen inert — the
  // first thing that felt wrong on the device. Started on `body`, which is what a finger
  // on the letterboxing actually hits.
  await p.evaluate(() => window.__ff.restart());
  await rest(p);
  await arrows(p);
  from = await cell(p);
  await gesture(p, 60, 0, { from: 'body' });
  await release(p);
  await rest(p);
  to = await cell(p);
  expect(
    to.x === from.x + 1 && to.y === from.y,
    `a swipe on the black margin moves the fish too (${from.x},${from.y} -> ${to.x},${to.y})`,
  );

  // ── A tap is not a swipe: under the threshold no arrow is sent, and the tap SWAPS the
  // fish. Martin's call after playing it — on a phone the mouse's click-to-swim reads as
  // the game wandering off on its own, while the other fish is what a thumb wants.
  await arrows(p);
  const wasActive = await p.evaluate(() => window.__ff.state().active);
  await gesture(p, 8, 0);
  await release(p);
  await rest(p);
  expect((await arrows(p)).length === 0, 'a short drag is a tap: no arrow is sent');
  expect(
    (await p.evaluate(() => window.__ff.state().active)) !== wasActive,
    `and the tap swaps the active fish (was ${wasActive})`,
  );
  // The other half of the same decision: the compatibility click a tap leaves behind is
  // suppressed, so click-to-swim is off on touch. It stays exactly as it is for a mouse.
  expect(
    (await p.evaluate(() => window.__ff.state().swimming)) === false,
    'and no click-to-swim is started behind it',
  );

  // ── A desktop is untouched: the same gesture on a page without the override does
  // nothing at all. The guarantee the whole touch series rests on.
  const desktop = await open('', false);
  await rest(desktop);
  await arrows(desktop);
  await gesture(desktop, 60, 0, { compat: false });
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
