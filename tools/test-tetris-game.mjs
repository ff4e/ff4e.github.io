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
  /** Wait for `n` of the minigame's own 55ms ticks. Returns the ticks that elapsed. */
  const tetrisTicks = async (n) => {
    const t0 = await p.evaluate(() => window.__ff.tetris().tick);
    await p
      .waitForFunction(([s, k]) => window.__ff.tetris() && window.__ff.tetris().tick >= s + k, [t0, n], {
        timeout: 30000,
      })
      .catch(() => {});
    return (await p.evaluate(() => window.__ff.tetris().tick)) - t0;
  };

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
  // Wait for the minigame's OWN clock to run, not for 900ms of wall time — on a
  // loaded machine the two are not the same thing, and it is the ticks the piece
  // falls on.
  await tetrisTicks(16);
  const fell = await p.evaluate(() => window.__ff.tetris());
  expect(fell.y > spawned.y || fell.score > spawned.score, 'the piece falls on its own');

  // ---- the board is actually PAINTED, not just simulated ----------------------
  // Without this the whole render path (tile orientations, digit atlas, the well)
  // could be broken or blank and every state assertion above would still pass.
  const board = await p.evaluate(() => window.__ff.tetrisBoardHash());
  expect(board !== null && board.w === 150 && board.h === 300, 'the 150x300 board composes');
  const boardBefore = await p.evaluate(() => window.__ff.tetrisBoardHash());
  await p.evaluate(() => {
    window.__ff.tetrisKey('left');
    window.__ff.tetrisKey('left');
  });
  expect(
    (await p.evaluate(() => window.__ff.tetrisBoardHash())).hash !== boardBefore.hash,
    'moving the piece changes the painted board',
  );
  // And it reaches the canvas: the room frame carries the board over its middle.
  const withBoard = await p.evaluate(() => window.__ff.roomEffectFrameHash('classic'));
  const roomOnly = await p.evaluate(() => window.__ff.roomFrameHash('classic'));
  expect(withBoard !== roomOnly, 'the board is composited over the room frame');

  // ---- the room is frozen underneath (ShowModal blocks TRoom's timer) ---------
  // Anchored on the MINIGAME's clock: it keeps running while the room's is frozen, so
  // waiting for it proves real game time passed. A wall-clock sleep proves nothing —
  // under load it can contain almost no game time at all, and the room's clock would
  // "not advance" for the wrong reason.
  const roomCount = await p.evaluate(() => window.__ff.count());
  const modalTicks = await tetrisTicks(9);
  expect(
    (await p.evaluate(() => window.__ff.count())) === roomCount,
    `the room's clock does not advance while the minigame is modal (over ${modalTicks} minigame ticks)`,
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
  await tetrisTicks(4);
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
  await p
    .waitForFunction((n) => window.__ff.count() > n, resumed, { timeout: 30000 })
    .catch(() => {});
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

  // ---- the game-over blink runs on the 55ms game clock, not the paint rate ----
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
  // Not at paint rate: over a stretch of RENDERED FRAMES, the board may only change
  // on frames where the minigame's own 55ms tick counter moved. Checking the pairing
  // directly is both load-independent and far stronger than sleeping ~2 ticks' worth
  // of wall time and hoping the machine delivered exactly that.
  const paint = await p.evaluate(
    (want) =>
      new Promise((done) => {
        let prev = null;
        let frames = 0;
        let sameTickFrames = 0;
        let changedWithoutTick = 0;
        const step = () => {
          const s = window.__ff.tetris();
          const h = window.__ff.tetrisBoardHash();
          if (s && h) {
            if (prev && s.tick === prev.tick) {
              sameTickFrames++;
              if (h.hash !== prev.hash) changedWithoutTick++;
            }
            prev = { tick: s.tick, hash: h.hash };
          }
          if (++frames >= want) done({ frames, sameTickFrames, changedWithoutTick });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    60,
  );
  expect(paint.sameTickFrames > 3, `saw frames without a minigame tick (${paint.sameTickFrames}/${paint.frames})`);
  expect(
    paint.changedWithoutTick === 0,
    `the hiscore blink does not run at paint rate (${paint.changedWithoutTick} board changes with no tick)`,
  );
  // But it does blink on the 55ms clock: the phase counter cycles 0..17 and the earned
  // row is drawn while `blikani % 18 < 9` (tetrisRender.ts:136), so the board must
  // change as that predicate flips. Waiting for the flip itself — rather than for
  // 700ms and assuming ~13 ticks fit in it — is exact at any frame rate.
  const blinkState = () =>
    p.evaluate(() => ({ hash: window.__ff.tetrisBoardHash().hash, blik: window.__ff.tetris().blikani }));
  const blinkA = await blinkState();
  await p
    .waitForFunction((b) => window.__ff.tetris() && (window.__ff.tetris().blikani % 18 < 9) !== (b % 18 < 9), blinkA.blik, {
      timeout: 30000,
    })
    .catch(() => {});
  const blinkC = await blinkState();
  expect(
    blinkC.hash !== blinkA.hash,
    `but it does blink on the 55ms game clock (blikani ${blinkA.blik} -> ${blinkC.blik})`,
  );
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.tetris() === null, { timeout: 5000 });

  console.log('Tetris OK: launch from room + map, own clock, room frozen, controls, painting, hiscore, close');
});
