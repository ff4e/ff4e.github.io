/**
 * UI test: the faithful input map (ZaznamenejPrikazKlavesou / ZaznamenejPrikazRoom).
 * Verifies the controls added by the fidelity audit — arrow keys move the active
 * fish, Space swaps the active fish, 1/2 select a fish, right-click steps the
 * active fish toward the click — and that clicking a fish only *selects* it (no
 * talk trigger). Drives real DOM key/mouse events plus the __ff hooks.
 */
import { withApp, idle } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.state, { timeout: 5000 });
  await p.selectOption('#room', '7'); // UTES — both fish alive, open water
  await p.waitForFunction(() => window.__ff.state() && window.__ff.count() > 0, { timeout: 5000 });
  await p.waitForTimeout(200);
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

  // --- arrow keys move the active fish ---
  await p.keyboard.press('Digit1'); // active = little
  await idle(p); // wait out the stav_kuk peek so the move isn't deferred
  const lx0 = (await state()).little.x;
  await p.keyboard.press('ArrowLeft');
  // The held-key rework dispatches the move on the next rest tick, so wait for it to
  // start and settle rather than sampling the instant the key is released.
  await p.waitForFunction((x0) => window.__ff.state().little.x !== x0 || window.__ff.phase() !== 'idle', lx0, {
    timeout: 3000,
  });
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
  await p.waitForTimeout(150);
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
});
