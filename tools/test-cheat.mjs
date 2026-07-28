/**
 * UI test: the typed cheat codes (Uovl.pas:744 entry, URoom.pas:24534-24690 and
 * UMain.pas:1750-1786 dispatch). Drives them through the real keyboard, so it
 * covers the entry machine (X arms it, a dead-end letter parks it), the room
 * codes, and the two codes that only work from the map.
 */
import { selectRoom, waitRoom, withApp } from './ui-lib.mjs';

/** Type a code as a player would — the leading X arms the machine. */
async function typeCode(p, code) {
  for (const ch of code) await p.keyboard.press(ch);
  await p.waitForTimeout(80);
}

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // UTES (Fish House room index 6 -> global 7)
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => {
    localStorage.removeItem('ff.solved');
    localStorage.removeItem('ff.cheated');
  });
  await p.waitForTimeout(200);

  // ---- xfisher: drop a fishing hook -------------------------------------------
  expect((await p.evaluate(() => window.__ff.hookCount())) === 0, 'no hooks before xfisher');
  await typeCode(p, 'xfisher');
  expect((await p.evaluate(() => window.__ff.hookCount())) === 1, 'xfisher spawns a hook');

  // ---- entry machine: no X, no cheat ------------------------------------------
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await waitRoom(p, 0);
  await typeCode(p, 'fisher');
  expect((await p.evaluate(() => window.__ff.hookCount())) === 0, 'a code without its X does nothing');

  // ---- xstorm: whip the water up, and toggle it back --------------------------
  const calm = await p.evaluate(() => window.__ff.water());
  await typeCode(p, 'xstorm');
  const storm = await p.evaluate(() => window.__ff.water());
  expect(
    storm.wamp === 10 && storm.wspd === 4 && storm.wper === 6,
    'xstorm sets the storm water params',
  );
  await typeCode(p, 'xstorm');
  const back = await p.evaluate(() => window.__ff.water());
  expect(
    back.wamp === calm.wamp && back.wspd === calm.wspd && back.wper === calm.wper,
    'xstorm typed again restores the room water',
  );

  // The water is per-room state, so leaving resets it even while storming.
  await typeCode(p, 'xstorm');
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await waitRoom(p, 0);
  const fresh = await p.evaluate(() => window.__ff.water());
  expect(fresh.wamp === calm.wamp && fresh.wper === calm.wper, 'the storm dies with the room');

  // ---- xundead: flip the sprites (same size, different pixels) ---------------
  const size0 = await p.evaluate(() => window.__ff.fishSpriteSize('little'));
  await typeCode(p, 'xundead');
  const size1 = await p.evaluate(() => window.__ff.fishSpriteSize('little'));
  expect(size1.w === size0.w && size1.h === size0.h, 'xundead keeps the sprite size');
  expect(size1.hash !== size0.hash, 'xundead flips the sprite pixels');
  await typeCode(p, 'xundead');
  const unflipped = await p.evaluate(() => window.__ff.fishSpriteSize('little'));
  expect(unflipped.hash === size0.hash, 'xundead typed again turns the fish back up');

  // ---- xmorph: each fish takes the other's shape, and toggles back ------------
  // The reshaped sprite lands on the SAME pixel size (that is the joke: a shrunk
  // big fish is exactly little-fish sized), so only the pixels give it away.
  const bigSize = await p.evaluate(() => window.__ff.fishSpriteSize('big'));
  await typeCode(p, 'xmorph');
  const morphed = await p.evaluate(() => window.__ff.fishSpriteSize('little'));
  expect(morphed.hash !== size0.hash, 'xmorph reshapes the little fish');
  expect(morphed.h === Math.floor(bigSize.h / 2), 'the little fish is a half-height big fish');
  expect(morphed.w === bigSize.w - Math.floor(bigSize.w / 4), 'and 3/4 of its width');
  const morphedBig = await p.evaluate(() => window.__ff.fishSpriteSize('big'));
  expect(morphedBig.h === size0.h * 2, 'the big fish is a double-height little fish');
  await typeCode(p, 'xmorph');
  const restored = await p.evaluate(() => window.__ff.fishSpriteSize('little'));
  expect(restored.hash === size0.hash, 'xmorph typed again restores the sprites');

  // ---- xiamacheater: accepted, but deliberately does nothing ------------------
  const beforeCheater = await p.evaluate(() => window.__ff.state());
  await typeCode(p, 'xiamacheater');
  const afterCheater = await p.evaluate(() => window.__ff.state());
  expect(
    afterCheater.alive.little === beforeCheater.alive.little &&
      afterCheater.alive.big === beforeCheater.alive.big,
    'xiamacheater is a no-op (its Delphi body is commented out)',
  );

  // ---- xmegabomb: kills both fish --------------------------------------------
  expect(beforeCheater.alive.little && beforeCheater.alive.big, 'both fish alive before the bomb');
  await typeCode(p, 'xmegabomb');
  const bombed = await p.evaluate(() => window.__ff.state());
  expect(!bombed.alive.little && !bombed.alive.big, 'xmegabomb kills both fish');

  // ---- xwemaketherulez: solve the room and return to the map ------------------
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await waitRoom(p, 0);
  await typeCode(p, 'xwemaketherules'); // the OLD, misspelt form must not work
  expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'the misspelt code does nothing');
  for (const ch of 'xwemaketherulez') await p.keyboard.press(ch);
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.cheatedRooms().includes(1)), 'xwemaketherulez solved room 1');

  // ---- xscore: map-screen only ------------------------------------------------
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  await typeCode(p, 'xscore');
  await waitRoom(p, 0);
  expect((await p.$eval('#room', (el) => el.value)) === '72', 'xscore opens the SCORE room (72)');
  expect(
    (await p.evaluate(() => window.__ff.zaverMode())) === false,
    'SCORE is not the ZAVER finale cutscene',
  );

  // In a room, xscore is not dispatched at all (URoom has no case for it).
  await p.evaluate(() => window.__ff.enterRoomAwait(7));
  await waitRoom(p, 0);
  await typeCode(p, 'xscore');
  expect((await p.$eval('#room', (el) => el.value)) === '7', 'xscore does nothing inside a room');

  // ---- xultraviolence: every later room opens with a hook already falling -----
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect((await p.evaluate(() => window.__ff.ultraviolence())) === false, 'ultraviolence starts off');
  await typeCode(p, 'xultraviolence');
  expect(
    (await p.evaluate(() => window.__ff.ultraviolence())) === true,
    'xultraviolence arms hooks mode',
  );
  await p.evaluate(() => window.__ff.enterRoomAwait(7));
  await waitRoom(p, 0);
  expect(
    (await p.evaluate(() => window.__ff.hookCount())) === 1,
    'ultraviolence spawns a hook on room entry',
  );

  console.log(
    'cheats OK: entry machine, fisher/storm/undead/morph/megabomb/wemaketherulez, map score+ultraviolence',
  );
});
