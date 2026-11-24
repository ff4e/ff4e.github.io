/**
 * UI test: the faithful input map (ZaznamenejPrikazKlavesou / ZaznamenejPrikazRoom).
 * Verifies the controls added by the fidelity audit — arrow keys move the active
 * fish, Space (or Tab) swaps the active fish, 1/2 select a fish, right-click steps the
 * active fish toward the click — and that clicking a fish only *selects* it (no
 * talk trigger). Drives real DOM key/mouse events plus the __ff hooks.
 */
import { idle, selectRoom, tickSleep, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.state);
  await selectRoom(p, 7); // UTES — both fish alive, open water
  await p.waitForFunction(() => window.__ff.state() && window.__ff.count() > 0);
  await tickSleep(p, 3);
  const state = () => p.evaluate(() => window.__ff.state());

  // --- 1/2 select a fish (akce_set) ---
  await p.keyboard.press('Digit2');
  expect((await state()).active === 'big', '2 selects the big fish');
  await p.keyboard.press('Digit1');
  expect((await state()).active === 'little', '1 selects the little fish');

  // --- Space swaps the active fish (akce_switch) ---
  const before = (await state()).active;
  await p.keyboard.press('Space');
  expect((await state()).active !== before, `Space swaps the active fish (${before} -> other)`);
  // Tab is a port-only alias; Shift+Tab stays focus navigation.
  const afterSpace = (await state()).active;
  await p.keyboard.press('Tab');
  expect((await state()).active === before, `Tab swaps the active fish back (${afterSpace} -> ${before})`);
  await p.keyboard.press('Shift+Tab');
  expect((await state()).active === before, 'Shift+Tab does not swap the fish');
  await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

  // --- arrow keys move the active fish ---
  await p.keyboard.press('Digit1'); // active = little
  await idle(p); // wait out the stav_kuk peek so the move isn't deferred
  const lx0 = (await state()).little.x;
  await p.keyboard.press('ArrowLeft');
  // The held-key rework dispatches the move on the next rest tick, so wait for it to
  // start and settle rather than sampling the instant the key is released.
  await p.waitForFunction((x0) => window.__ff.state().little.x !== x0 || window.__ff.phase() !== 'idle', lx0);
  await idle(p);
  const lx1 = (await state()).little.x;
  expect(lx1 === lx0 - 1, `ArrowLeft moves the active (little) fish left (${lx0} -> ${lx1})`);

  // --- clicking a fish only selects it (no talk) ---
  await p.evaluate(() => window.__ff.state()); // ensure idle
  const lines0 = await p.evaluate(() => window.__ff.lines());
  await p.evaluate(() => {
    const s = window.__ff.state();
    window.__ff.click(s.big.x, s.big.y); // click the big fish
  });
  // Ticks, not milliseconds: "no dialogue line fired" is only a real claim if the
  // dialogue scheduler actually got some game time to fire one in.
  await tickSleep(p, 3);
  const lines1 = await p.evaluate(() => window.__ff.lines());
  expect((await state()).active === 'big', 'clicking the big fish selects it');
  expect(lines1 === lines0, 'selecting a fish does not trigger a dialogue line');

  // --- right-click steps the active fish toward the click ---
  await p.keyboard.press('Digit1'); // active = little
  await idle(p);
  const rect = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, cw: c.width, ch: c.height };
  });
  const fsize = await p.evaluate(() => window.__ff.fsize());
  const lx2 = (await state()).little.x;
  const ly2 = (await state()).little.y;
  const targetCx = lx2 - 2; // well to the left of the fish
  const clientX = rect.left + (targetCx + 0.5) * fsize * (rect.width / rect.cw);
  const clientY = rect.top + (ly2 + 0.5) * fsize * (rect.height / rect.ch);
  await p.mouse.click(clientX, clientY, { button: 'right' });
  await idle(p);
  await p.waitForTimeout(30);
  const lx3 = (await state()).little.x;
  expect(lx3 === lx2 - 1, `right-click left of the fish steps it left (${lx2} -> ${lx3})`);

  // --- a Tab while the swap is blocked (load fast-forward) must not move focus off the
  // game, or every later Tab arrives from a focused control and stops swapping ---
  //
  // Replaying one recorded move is a single game tick (~80ms), so waiting to SEE the load
  // from here was a race that the probe lost under load: the load could finish before the
  // poll ever caught it. Instead, hold the page's frames between F3 and the Tab. F3 sets
  // `loadmode` synchronously and the keydown's `wake()` puts the loop on
  // requestAnimationFrame, so with that held no tick can advance the load in between.
  // The keys stay real: a synthetic Tab never moves focus, so the check would pass vacuously.
  await p.keyboard.press('F2');
  // As with ArrowLeft above: the move starts on a later tick, so `idle` alone can return
  // before it has begun, and an F3 that then lands mid-move is refused (it needs rest).
  const ax0 = await p.evaluate(() => window.__ff.state()[window.__ff.state().active].x);
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(
    (x0) => window.__ff.state()[window.__ff.state().active].x !== x0 || window.__ff.phase() !== 'idle',
    ax0,
  );
  await idle(p);
  await p.evaluate(() => {
    const real = window.requestAnimationFrame;
    const held = [];
    window.requestAnimationFrame = (cb) => held.push(cb);
    window.__probeHeldFrames = () => held.length;
    window.__probeReleaseFrames = () => {
      window.requestAnimationFrame = real;
      for (const cb of held) real.call(window, cb);
      return held.length;
    };
  });
  let heldFrames = 0;
  try {
    // A frame requested before the hold went in is still real, and would run one more
    // tick — enough to finish this load — after F3. So wait until the loop is parked:
    // either on a held frame, or asleep on the idle timer, which F3's `wake()` swaps for
    // a held frame. Interval polling, because 'raf' polling would wait on the hold itself.
    await p.waitForFunction(
      () => window.__probeHeldFrames() > 0 || window.__ff.throttleInfo().onTimer,
      null,
      { polling: 20 },
    );
    const phaseAtF3 = await p.evaluate(() => window.__ff.phase());
    await p.keyboard.press('F3');
    const loadingBeforeTab = await p.evaluate(() => window.__ff.loading());
    await p.keyboard.press('Tab');
    const afterTab = await p.evaluate(() => ({
      loading: window.__ff.loading(),
      onGame: document.activeElement === document.body,
    }));
    expect(loadingBeforeTab && afterTab.loading,
      `the Tab arrived during the load fast-forward (phase at F3 ${phaseAtF3}, ` +
        `loading before ${loadingBeforeTab}, after ${afterTab.loading})`);
    expect(afterTab.onGame, 'a Tab during the load fast-forward leaves focus on the game');
  } finally {
    heldFrames = await p.evaluate(() => window.__probeReleaseFrames());
  }
  expect(heldFrames > 0, `the game loop was parked on a held frame during the load (${heldFrames})`);
  await p.waitForFunction(() => !window.__ff.loading());
  await idle(p);
  const beforeTab = (await state()).active;
  await p.keyboard.press('Tab');
  expect((await state()).active !== beforeTab, 'Tab still swaps once the load has finished');
});
