/**
 * UI test: the Tetris minigame (Ttr/Ttr.pas), launched by the xtetris cheat from
 * a room (URoom.pas:24564) and from the world map (UMain.pas:1764).
 *
 * The original opens it as a modal window, which freezes the room's timer until
 * it closes; the port draws the 150x300 board over the frozen room and takes the
 * keyboard until Escape. This checks the launch, the freeze, the controls, the
 * persistent hiscore table and the close.
 */
import { selectRoom, waitRoom, withApp } from './ui-lib.mjs';

async function typeCode(p, code) {
  for (const ch of code) await p.keyboard.press(ch);
  await p.waitForTimeout(120);
}

await withApp(async ({ p, expect }) => {
  await p.evaluate(() => localStorage.removeItem('ff.tetris'));
  await selectRoom(p, 7); // UTES
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  // ---- launch from a room -----------------------------------------------------
  expect((await p.evaluate(() => window.__ff.tetris())) === null, 'the minigame starts closed');
  await typeCode(p, 'xtetris');
  await p.waitForFunction(() => window.__ff.tetris() !== null, { timeout: 5000 });
  const t0 = await p.evaluate(() => window.__ff.tetris());
  expect(t0.rychlost === 11, 'it opens at the slowest speed');
  expect(t0.gameover === false, 'and not already over');

  // It runs its own 55ms clock: a piece appears and starts falling.
  await p.waitForFunction(() => window.__ff.tetris().druh > 0, { timeout: 5000 });
  const spawned = await p.evaluate(() => window.__ff.tetris());
  expect(spawned.filled === 4, 'a four-cell piece is on the board');
  await p.waitForTimeout(900);
  const fell = await p.evaluate(() => window.__ff.tetris());
  expect(fell.y > spawned.y || fell.score > spawned.score, 'the piece falls on its own');

  // ---- the room is frozen underneath (ShowModal blocks TRoom's timer) ---------
  const roomCount = await p.evaluate(() => window.__ff.count());
  await p.waitForTimeout(500);
  expect(
    (await p.evaluate(() => window.__ff.count())) === roomCount,
    "the room's clock does not advance while the minigame is modal",
  );

  // ---- controls ---------------------------------------------------------------
  const before = await p.evaluate(() => window.__ff.tetris());
  await p.keyboard.press('ArrowLeft');
  expect(
    (await p.evaluate(() => window.__ff.tetris())).x === before.x - 1,
    'ArrowLeft moves the piece left',
  );
  await p.keyboard.press('ArrowRight');
  expect((await p.evaluate(() => window.__ff.tetris())).x === before.x, 'ArrowRight moves it back');
  await p.keyboard.press('ArrowDown');
  expect(
    (await p.evaluate(() => window.__ff.tetris())).smer !== before.smer,
    'ArrowDown ROTATES (the original has no soft drop)',
  );
  await p.keyboard.press('Space');
  expect((await p.evaluate(() => window.__ff.tetris())).rychle === true, 'Space slams it down');

  // Game keys must not leak through to the fish while the minigame owns them.
  const roomBefore = await p.evaluate(() => window.__ff.state());
  await p.keyboard.press('KeyI');
  await p.waitForTimeout(150);
  const roomAfter = await p.evaluate(() => window.__ff.state());
  expect(
    roomAfter.little.x === roomBefore.little.x && roomAfter.little.y === roomBefore.little.y,
    'fish keys do not reach the room while the minigame is open',
  );

  // ---- close ------------------------------------------------------------------
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.tetris() === null, { timeout: 5000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'Escape returns to the room');
  const resumed = await p.evaluate(() => window.__ff.count());
  await p.waitForTimeout(400);
  expect(
    (await p.evaluate(() => window.__ff.count())) > resumed,
    "the room's clock runs again after closing",
  );

  // ---- launch from the map, and persist a hiscore -----------------------------
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  await typeCode(p, 'xtetris');
  await p.waitForFunction(() => window.__ff.tetris() !== null, { timeout: 5000 });
  expect(
    (await p.evaluate(() => window.__ff.tetris())) !== null,
    'xtetris opens the minigame from the map too',
  );

  // Play it out to a game over without ever moving sideways: every piece stacks
  // in the middle, so no row completes and the well fills.
  const end = await p.evaluate(() => {
    for (let i = 0; i < 20000; i++) {
      const s = window.__ff.tetris();
      if (!s || s.gameover) break;
      window.__ff.tetrisKey('drop');
      window.__ff.tetrisTick();
    }
    return window.__ff.tetris();
  });
  expect(end.gameover === true, 'the well fills and the game ends');
  expect(end.score > 0, 'it scored on the way down');
  expect(end.umisteni === 1, 'the first game takes the top hiscore row');
  const saved = await p.evaluate(() => localStorage.getItem('ff.tetris'));
  expect(saved !== null, 'the hiscore table is persisted (the original ttr.pic)');
  expect(JSON.parse(saved).length === 10, 'ten rows are stored');
  expect(JSON.parse(saved)[0] === end.score, 'with this game at the top');

  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.tetris() === null, { timeout: 5000 });

  // A later game sees the stored table.
  await typeCode(p, 'xtetris');
  await p.waitForFunction(() => window.__ff.tetris() !== null, { timeout: 5000 });
  await p.evaluate(() => {
    for (let i = 0; i < 20000; i++) {
      const s = window.__ff.tetris();
      if (!s || s.gameover) break;
      window.__ff.tetrisKey('drop');
      window.__ff.tetrisTick();
    }
  });
  const second = await p.evaluate(() => window.__ff.tetris());
  expect(
    second.hiscore.filter((v) => v > 0).length >= 2,
    'the second game sees the first one in the table',
  );
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.tetris() === null, { timeout: 5000 });

  console.log('Tetris OK: launch from room + map, own clock, room frozen, controls, hiscore, close');
});
