/**
 * UI test: the control-panel HUD (panel.ffp). Asserts the panel loaded, the
 * mouse hit-regions map correctly, and buttons dispatch (fish-select/swap/move).
 */
import { withApp, idle } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.selectOption('#room', '7'); // enter UTES
  await p.waitForFunction(() => window.__ff && window.__ff.hasPanel && window.__ff.hasPanel(), { timeout: 8000 });
  await p.waitForTimeout(300);
  expect(await p.evaluate(() => window.__ff.hasPanel()), 'panel.ffp loaded');

  // Hit-test the known regions (panel coords) -> region ids (Uovl.pas oblmysi).
  const cases = [
    ['little-up', 75, 197, 1],
    ['big-up', 75, 25, 6],
    ['swap', 76, 158, 11],
    ['save', 30, 326, 12],
    ['load', 30, 344, 13],
    ['exit', 30, 362, 14],
    ['restart', 30, 382, 15],
    ['empty', 150, 8, 0],
  ];
  for (const [name, x, y, want] of cases) {
    const got = await p.evaluate(({ x, y }) => window.__ff.panelHit(x, y), { x, y });
    expect(got === want, `hit ${name} @(${x},${y}) = ${got} (want ${want})`);
  }

  // Swap toggles the active fish; a D-pad button moves the fish.
  const a0 = (await p.evaluate(() => window.__ff.state())).active;
  await p.evaluate(() => window.__ff.panelAction(11)); // swap
  const a1 = (await p.evaluate(() => window.__ff.state())).active;
  expect(a0 !== a1, `swap toggles active (${a0} -> ${a1})`);

  await p.evaluate(() => window.__ff.panelAction(5)); // select little
  await idle(p); // wait out the stav_kuk peek (swap + select) before the move
  const m0 = await p.evaluate(() => window.__ff.moves());
  await p.evaluate(() => window.__ff.panelAction(3)); // little left
  await idle(p);
  const m1 = await p.evaluate(() => window.__ff.moves());
  expect(m1 > m0, `panel D-pad move recorded (${m0} -> ${m1})`);
});
