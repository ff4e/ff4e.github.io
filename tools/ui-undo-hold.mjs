/** Shared by the existing tablet and phone probes: real pointer holds, real undo history. */
export async function checkUndoHold(p, expect, selector, touch = null) {
  await p.keyboard.press('1');
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  const start = await p.evaluate(() => window.__ff.moves());
  const bank = [await p.evaluate(() => window.__ff.posHash())];
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => {
      const dir = window.__ff.state().little.facingRight ? 3 : 4;
      window.__ff.press('little', dir);
    });
    await p.waitForFunction((n) => window.__ff.moves() === n && window.__ff.phase() === 'idle', start + i + 1);
    bank.push(await p.evaluate(() => window.__ff.posHash()));
  }
  const box = await p.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const down = async () => {
    if (touch) await touch('touchStart', [[91, x, y]]);
    else {
      await p.mouse.move(x, y);
      await p.mouse.down();
    }
  };
  const up = async () => {
    if (touch) await touch('touchEnd', []);
    else await p.mouse.up();
  };

  await p.evaluate(() => {
    window.addEventListener('pointerup', () => {
      window.undoHoldRelease = window.__ff.moves();
    }, { once: true, capture: true });
  });
  await down();
  await p.waitForFunction((n) => window.__ff.moves() <= n - 2, start + 6);
  await up();
  await p.waitForTimeout(200);
  const released = await p.evaluate(() => ({
    moves: window.__ff.moves(), atRelease: window.undoHoldRelease, hash: window.__ff.posHash(),
  }));
  expect(released.moves <= start + 4 && released.moves === released.atRelease &&
    released.hash === bank[released.moves - start],
  `${selector}: holding reverses multiple real moves; release neither clicks nor keeps repeating`);

  await down();
  await p.waitForFunction((n) => window.__ff.moves() === n, start);
  await up();
  expect(await p.evaluate(() => window.__ff.posHash()) === bank[0],
    `${selector}: another hold reaches the original position without diverging`);
  // A stale repeater at empty history looks harmless until the next move.
  await p.evaluate(() => {
    window.__ff.press('little', window.__ff.state().little.facingRight ? 3 : 4);
    delete window.undoHoldRelease;
  });
  await p.waitForFunction((n) => window.__ff.moves() === n + 1 && window.__ff.phase() === 'idle', start);
  await p.waitForTimeout(200);
  expect(await p.evaluate(() => window.__ff.moves()) === start + 1,
    `${selector}: a move after release is not consumed by a lingering repeat`);
  if (touch) await p.locator(selector).tap();
  else await p.locator(selector).click();
  await p.waitForFunction((n) => window.__ff.moves() === n, start);
  expect(await p.evaluate(() => window.__ff.posHash()) === bank[0],
    `${selector}: a fresh tap still undoes exactly one move`);
}
