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

  // ---- the sprite cheats must show in BOTH art paths --------------------------
  // Enhanced (truecolor) mode draws the fish from its own RGBA sprites, not from
  // the FFR head/body frames, so a cheat that only rewrote the latter would be
  // invisible in the mode the game ships in. Assert the rendered frame itself.
  for (const mode of ['classic', 'enhanced']) {
    const plain = await p.evaluate((m) => window.__ff.roomFrameHash(m), mode);
    await typeCode(p, 'xmorph');
    expect(
      (await p.evaluate((m) => window.__ff.roomFrameHash(m), mode)) !== plain,
      `xmorph changes the ${mode} picture`,
    );
    await typeCode(p, 'xmorph');
    await typeCode(p, 'xundead');
    expect(
      (await p.evaluate((m) => window.__ff.roomFrameHash(m), mode)) !== plain,
      `xundead changes the ${mode} picture`,
    );
    await typeCode(p, 'xundead');
  }
  // The enhanced sprite set itself: reshaped on, restored off. (The whole-frame
  // hash above cannot check the restore — the room animates between samples.)
  const encPlain = await p.evaluate(() => window.__ff.enhancedFishSprite('little'));
  const encBig = await p.evaluate(() => window.__ff.enhancedFishSprite('big'));
  expect(encPlain !== null, 'the enhanced fish sprites are loaded');
  await typeCode(p, 'xmorph');
  const encMorph = await p.evaluate(() => window.__ff.enhancedFishSprite('little'));
  expect(encMorph.hash !== encPlain.hash, 'xmorph reshapes the enhanced little fish');
  expect(encMorph.h === Math.floor(encBig.h / 2), 'to half the enhanced big fish height');
  await typeCode(p, 'xmorph');
  expect(
    (await p.evaluate(() => window.__ff.enhancedFishSprite('little'))).hash === encPlain.hash,
    'and puts the enhanced sprites back',
  );
  await typeCode(p, 'xundead');
  const encUndead = await p.evaluate(() => window.__ff.enhancedFishSprite('little'));
  expect(encUndead.hash !== encPlain.hash, 'xundead flips the enhanced sprite');
  expect(encUndead.h === encPlain.h && encUndead.w === encPlain.w, 'keeping its size');
  await typeCode(p, 'xundead');
  expect(
    (await p.evaluate(() => window.__ff.enhancedFishSprite('little'))).hash === encPlain.hash,
    'and flips it back',
  );

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

  // ---- xsilent: silent-movie mode -------------------------------------------
  await p.evaluate(() => window.__ff.enterRoomAwait(7));
  await waitRoom(p, 0);
  expect((await p.evaluate(() => window.__ff.silentFilm())).on === false, 'silent film starts off');
  const loudVolumes = await p.evaluate(() => window.__ff.volumes());
  const plainFrame = {
    classic: await p.evaluate(() => window.__ff.roomEffectFrameHash('classic')),
    enhanced: await p.evaluate(() => window.__ff.roomEffectFrameHash('enhanced')),
  };
  await typeCode(p, 'xsilent');
  expect((await p.evaluate(() => window.__ff.silentFilm())).on === true, 'xsilent turns the film on');
  // The effects must reach PIXELS, not just set a flag. roomEffectFrameHash runs
  // the finished frame through the same applyFrameEffects the paint path uses;
  // grain is left off so the hash is stable between calls.
  for (const mode of ['classic', 'enhanced']) {
    const tinted = await p.evaluate((m) => window.__ff.roomEffectFrameHash(m), mode);
    expect(tinted !== plainFrame[mode], `xsilent tints the ${mode} frame`);
  }
  // Grain is additive on top of the tint, and random, so two grained frames differ.
  const g1 = await p.evaluate(() => window.__ff.roomEffectFrameHash('classic', true));
  const g2 = await p.evaluate(() => window.__ff.roomEffectFrameHash('classic', true));
  const tintOnly = await p.evaluate(() => window.__ff.roomEffectFrameHash('classic', false));
  expect(g1 !== tintOnly && g2 !== tintOnly, 'the film grain is scratched onto the frame');
  expect(g1 !== g2, 'and it moves every frame');
  // A spoken line becomes an intertitle card instead of a scrolling subtitle.
  await p.evaluate(() => window.__ff.pushSubtitle('Ahoj rybicko', 'M'));
  const card = await p.evaluate(() => window.__ff.silentFilm());
  expect(card.time > 0, 'a spoken line starts an intertitle card');
  expect(card.lines.length > 0, 'the card holds the wrapped line(s)');
  // The card REPLACES the room, so its frame differs from the plain tinted one.
  const cardFrame = await p.evaluate(() => window.__ff.roomEffectFrameHash('classic'));
  const tinted = await p.evaluate(() => window.__ff.roomEffectFrameHash('classic'));
  expect(cardFrame === tinted, 'the card frame is stable while it holds');
  expect(cardFrame !== plainFrame.classic, 'the intertitle card is actually drawn');
  // It counts down on the GAME tick (~12.5/s), not the paint rate (~60/s): over
  // ~400ms it must lose roughly 5 frames, not 25.
  const t1 = (await p.evaluate(() => window.__ff.silentFilm())).time;
  await p.waitForTimeout(400);
  const t2 = (await p.evaluate(() => window.__ff.silentFilm())).time;
  const spent = t1 - t2;
  expect(spent > 0, `the card counts down (${t1} -> ${t2})`);
  expect(spent < 15, `on the game clock, not the paint rate (spent ${spent} in 400ms)`);
  // The effects force the CPU renderer, since they post-process the whole frame.
  await p.waitForTimeout(200);
  expect(
    (await p.evaluate(() => window.__ff.roomBackend())) !== 'webgl',
    'silent film renders on the CPU path (the frame is post-processed)',
  );
  await typeCode(p, 'xsilent');
  expect((await p.evaluate(() => window.__ff.silentFilm())).on === false, 'xsilent typed again ends it');
  const afterVolumes = await p.evaluate(() => window.__ff.volumes());
  expect(
    afterVolumes.music === loudVolumes.music && afterVolumes.voice === loudVolumes.voice,
    'the volume sliders come back',
  );

  // Leaving the room ends silent film too (TRoom.Done / TRoom.Init).
  await typeCode(p, 'xsilent');
  expect((await p.evaluate(() => window.__ff.silentFilm())).on === true, 'silent film on again');
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await waitRoom(p, 0);
  expect(
    (await p.evaluate(() => window.__ff.silentFilm())).on === false,
    'silent film dies with the room',
  );

  // ---- xinterlaced: the screen collapses in on itself -------------------------
  expect((await p.evaluate(() => window.__ff.interlacedFaze())) === -1, 'interlaced starts off (-1)');
  const beforeCollapse = await p.evaluate(() => window.__ff.roomEffectFrameHash('classic'));
  await typeCode(p, 'xinterlaced');
  await p.waitForTimeout(300);
  const faze = await p.evaluate(() => window.__ff.interlacedFaze());
  expect(faze > 0, `the collapse advances its phase (got ${faze})`);
  // ~300ms on the ~12.5fps game clock is ~4 phases, not ~18 as it would be if the
  // counter were still being advanced from the render path.
  expect(faze < 12, `on the game clock, not the paint rate (phase ${faze} after 300ms)`);
  expect(
    (await p.evaluate(() => window.__ff.roomEffectFrameHash('classic'))) !== beforeCollapse,
    'the collapse reaches the frame',
  );
  await typeCode(p, 'xinterlaced');
  await p.waitForTimeout(300);
  expect(
    (await p.evaluate(() => window.__ff.interlacedFaze())) === -1,
    'typing it again winds the collapse down to -1',
  );

  // ---- lifetime: room-scoped means BOTH ways, for every cheat -----------------
  // TRoom.Init clears these in the same block that zeroes roompole
  // (URoom.pas:1430-1433); TRoom.Restart leaves them alone. So each must survive a
  // restart and die on a room change — and both halves need testing, or a
  // regression in either direction goes unnoticed.
  await p.evaluate(() => window.__ff.enterRoomAwait(7));
  await waitRoom(p, 0);
  const pristine = {
    sprite: (await p.evaluate(() => window.__ff.enhancedFishSprite('little'))).hash,
    water: await p.evaluate(() => window.__ff.water()),
  };

  const cheatState = async () => ({
    sprite: (await p.evaluate(() => window.__ff.enhancedFishSprite('little'))).hash,
    storming: (await p.evaluate(() => window.__ff.water())).wamp === 10,
    silent: (await p.evaluate(() => window.__ff.silentFilm())).on,
    interlaced: (await p.evaluate(() => window.__ff.interlacedFaze())) !== -1,
  });

  for (const code of ['xundead', 'xmorph', 'xstorm', 'xsilent', 'xinterlaced']) {
    await typeCode(p, code);
  }
  const armed = await cheatState();
  expect(armed.sprite !== pristine.sprite, 'sprite cheats are on');
  expect(armed.storming, 'the storm is on');
  expect(armed.silent, 'silent film is on');
  expect(armed.interlaced, 'the collapse is running');

  // (a) a RESTART keeps them all.
  await p.evaluate(() => window.__ff.restart());
  await p.waitForTimeout(300);
  const afterRestart = await cheatState();
  expect(afterRestart.sprite === armed.sprite, 'the sprite cheats survive a restart');
  expect(afterRestart.storming, 'the storm survives a restart');
  expect(afterRestart.silent, 'silent film survives a restart');
  expect(afterRestart.interlaced, 'the collapse survives a restart');

  // (b) a ROOM CHANGE clears them all.
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await waitRoom(p, 0);
  await p.waitForTimeout(200);
  const afterChange = await cheatState();
  expect(afterChange.sprite === pristine.sprite, 'the sprite cheats die with the room');
  expect(!afterChange.storming, 'the storm dies with the room');
  expect(!afterChange.silent, 'silent film dies with the room (again)');
  expect(!afterChange.interlaced, 'the collapse dies with the room');
  // ...and leaving to the map un-mutes the game (TRoom.Done, URoom.pas:1513).
  await typeCode(p, 'xsilent');
  expect((await p.evaluate(() => window.__ff.silentFilm())).on === true, 'silent film on');
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect(
    (await p.evaluate(() => window.__ff.silentFilm())).on === false,
    'returning to the map ends silent film (so the menu is not left muted)',
  );

  console.log(
    'cheats OK: entry machine, all room codes, film effects on-screen, lifetimes, map score+ultraviolence',
  );
});
