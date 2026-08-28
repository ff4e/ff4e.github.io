/**
 * UI test: the touch gestures on the play area — swipe to move, tap to swap.
 *
 * A probe rather than a unit test because the thing under test is a real pointer stream
 * and the browser's own behaviour around it: which compatibility mouse events a moved
 * touch produces, and whether the page tries to scroll instead of reporting the drag.
 *
 * It builds its own context with `hasTouch` — the pattern `tools/test-phone-boots.mjs`
 * uses,
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
    // Did a mousedown SURVIVE the gesture layer's capture-phase eater? Registered on
    // `document` in the bubble phase, which is downstream of it: a swallowed event
    // (stopPropagation at window-capture) never gets here, an untouched one does. This is
    // how the swallow's LIFETIME is observable at all — the assertion that only checks
    // "no swim started" passes whether or not the flag leaks past the gesture.
    window.__ffMouseThrough = 0;
    document.addEventListener('mousedown', () => { window.__ffMouseThrough += 1; }, false);
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
const gesture = (p, dx, dy, { compat = true, from = '#screen', pointerType = 'touch' } = {}) =>
  p.evaluate(
    ({ dx, dy, compat, from, pointerType }) => {
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
            pointerType,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      send('pointerdown', x0, y0);
      for (let i = 1; i <= 4; i++) send('pointermove', x0 + (dx * i) / 4, y0 + (dy * i) / 4);
      // Keep dragging from the same gesture, in absolute offsets from where it began —
      // which is how a turn has to be driven: the finger never lifts. It interpolates from
      // the LAST point, not from the origin: replaying from the origin every time would
      // yank the finger back and forth, which the layer would rightly read as a series of
      // reversals rather than as the one continuous drag being tested.
      let lx = dx;
      let ly = dy;
      window.__ffSwipeTo = (x, y) => {
        for (let i = 1; i <= 4; i++) {
          send('pointermove', x0 + lx + ((x - lx) * i) / 4, y0 + ly + ((y - ly) * i) / 4);
        }
        lx = x;
        ly = y;
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
    { dx, dy, compat, from, pointerType },
  );

const release = (p) => p.evaluate(() => window.__ffSwipeEnd());
/** Mousedowns that reached the game since the last check, and reset for the next one. */
const through = (p) =>
  p.evaluate(() => {
    const n = window.__ffMouseThrough;
    window.__ffMouseThrough = 0;
    return n;
  });

/** A press somewhere that is NOT the play area, as a finger: pointer pair + the
 *  compatibility mousedown a browser fires when nothing suppressed it. */
const pressOutside = (p, selector) =>
  p.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opts = { pointerId: 21, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, selector);

/**
 * Is a `touchstart` here cancelled? The one thing iOS's long-press magnifier honours.
 *
 * Asserted as `defaultPrevented` rather than by looking for the loupe, because the loupe
 * is drawn by the OS and is not in the DOM at all — this is the only observable the
 * browser gives us, and it is exactly the signal Safari's gesture recognizer reads.
 * Dispatched as a real `TouchEvent`: `PointerEvent` is a different event, and cancelling
 * that one is what was already happening while the bubble still came up.
 */
const touchStartCancelled = (p, selector) =>
  p.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const t = new Touch({ identifier: 31, target: el, clientX: x, clientY: y });
    const e = new TouchEvent('touchstart', {
      touches: [t],
      targetTouches: [t],
      changedTouches: [t],
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  }, selector);

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

  // ── iOS's selection loupe. Safari runs the long-press magnifier from a gesture
  // recognizer upstream of Pointer Events, so the `preventDefault()` on `pointerdown` that
  // kills the compatibility click above never reaches it, and neither does the body's
  // `-webkit-user-select: none` — Martin's report was the selection correctly dead and an
  // empty magnifying bubble on screen anyway. `touchstart` is the only event it honours.
  expect(
    (await touchStartCancelled(p, '#screen')) === true,
    'a touch on the room cancels touchstart, so iOS raises no selection loupe',
  );
  expect(
    (await touchStartCancelled(p, 'body')) === true,
    'and so does one on the black margin, which is most of a phone screen',
  );
  // The other half, and the reason this is not a blanket handler: cancelling `touchstart`
  // also cancels the compatibility `mousedown`/`click`. The touch bar is driven by `click`
  // and the world map by the canvas's `mousedown`, so suppressing it on either would leave
  // a phone unable to press a button or pick a level.
  expect(
    (await touchStartCancelled(p, '#touchbar [data-region="14"]')) === false,
    'a touch on the bar is left alone — its buttons need the click',
  );
  await p.evaluate(() => window.__ff.panelAction(14));
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  expect(
    (await touchStartCancelled(p, '#screen')) === false,
    'and so is one on the world map, which picks a level with that same mousedown',
  );
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), ROOM);
  await p.waitForFunction(
    (n) =>
      window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.roomNum() === n,
    ROOM,
  );

  // ── The swallow must not outlive its gesture. In a spec-compliant browser the
  // compatibility mousedown never arrives (preventDefault on pointerdown stopped it), so
  // the flag is never consumed — and a flag left set eats the next unrelated press. This
  // is driven exactly that way: a swipe with NO compatibility event, then an ordinary
  // press on the faithful panel, which is driven by `mousedown` (unlike the touch bar's
  // `click`, which is why the bar hid this for a while). Measured before the fix: the tap
  // did not reach the game at all.
  await p.evaluate(() => window.__ff.restart());
  await rest(p);
  await gesture(p, 60, 0, { compat: false });
  await release(p);
  await rest(p);
  await through(p);
  await pressOutside(p, '#panel');
  expect(
    (await through(p)) === 1,
    'a press after a swipe still reaches the game (the swallow does not outlive its gesture)',
  );

  // ── A near-diagonal hold must settle on one axis. Without the turn bias the dominant
  // axis alternates on jitter and every crossing is a release-and-press into the held-move
  // machine, so the fish turns on the spot instead of swimming.
  await arrows(p);
  await gesture(p, 60, 0);
  for (let i = 1; i <= 6; i++) await steer(p, 60 + i * 30, i * 30); // ~45 degrees, held
  await release(p);
  await rest(p);
  const diagonal = await arrows(p);
  expect(
    diagonal.length === 1,
    `a 45-degree drag commits to one direction (${diagonal.join(',') || 'nothing'})`,
  );

  // ── A MOUSE on a touch-capable device is left alone. `touchModeActive` is a property of
  // the DEVICE — true on a touchscreen laptop — so without a pointer-type check a single
  // mouse click would both swim (its own mousedown) and swap (a synthetic Space), and a
  // drag would inject arrows on top. This is the same page, in touch mode, on the mouse.
  await arrows(p);
  from = await cell(p);
  await gesture(p, 60, 0, { compat: false, pointerType: 'mouse' });
  await release(p);
  await rest(p);
  const byMouse = await arrows(p);
  to = await cell(p);
  expect(
    byMouse.length === 0 && to.x === from.x && to.y === from.y,
    `touch mode, mouse pointer: the gesture layer stays out of it (${byMouse.join(',') || 'nothing'})`,
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
