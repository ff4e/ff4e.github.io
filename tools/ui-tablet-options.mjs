/**
 * Use the original's image-space regions, independent of CSS scale and art tier.
 *
 * A landscape phone shows the panel cut at row 197, the lower half beside the upper and
 * overlapping it by five columns (optionsLayout.ts), so a face wider than it is tall is
 * read as that 305x198 layout.
 */
export async function panelPoint(p, x, y) {
  await p.locator('#panel').waitFor({ state: 'visible' });
  return p.locator('#panel').evaluate((el, [x, y]) => {
    const r = el.getBoundingClientRect();
    const [fx, fy, w, h] = r.width <= r.height ? [x, y, 155, 395]
      : y < 197 ? [x, y, 305, 198] : [x + 150, y - 197, 305, 198];
    return { x: r.left + fx * r.width / w, y: r.top + fy * r.height / h };
  }, [x, y]);
}

export async function tapPanel(p, x, y, touch = false) {
  const point = await panelPoint(p, x, y);
  if (touch) await p.touchscreen.tap(point.x, point.y);
  else await p.mouse.click(point.x, point.y);
}

/** Called with Options open; ends back in the room with the column hidden again. */
export async function checkTabletOptions(p, expect, touch = false) {
  await p.locator('#touchopts #panel').waitFor({ state: 'visible' });
  expect(await p.evaluate(() => window.__ff.optionsOpen()), 'tablet: the original Options face is open');
  expect(await p.locator('#panel').evaluate(el => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.width / r.height - 155 / 395) < 0.01;
  }), 'tablet: the whole original face is shown, never the phone\'s landscape cut');
  const backdrop = await p.locator('#touchopts').evaluate(el => {
    const style = getComputedStyle(el);
    return { color: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity };
  });
  expect(backdrop.color === 'rgba(11, 11, 18, 0.65)' && backdrop.image === 'none',
    'tablet: the backdrop is translucent, without an opaque stone texture');
  expect(backdrop.opacity === '1' && await p.locator('#panel').evaluate(el => getComputedStyle(el).opacity) === '1',
    'tablet: the Options artwork stays fully opaque');
  const before = await p.locator('#screen').boundingBox();
  const bounds = await p.locator('#panel').boundingBox();
  const viewport = p.viewportSize();
  expect(bounds.width > 100 && bounds.height > 250 && bounds.x >= 0 && bounds.y >= 0 &&
    bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height,
  'tablet: the canvas settings have usable, on-screen dimensions');
  expect(await p.locator('#feedbar-privacy').isVisible(), 'tablet: Privacy policy remains reachable');

  for (const [bus, y, level] of [['effect', 85, 3], ['voice', 134, 9], ['music', 183, 12]]) {
    await tapPanel(p, 15 + 10 * level, y, touch);
    expect(await p.evaluate(bus => window.__ff.volumes()[bus], bus) === level,
      `tablet: the original ${bus} slider changes the correct bus`);
  }
  if (touch) {
    const cdp = await p.context().newCDPSession(p);
    try {
      const start = await panelPoint(p, 15, 85);
      const end = await panelPoint(p, 135, 120); // Off the slider, still captured.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] });
      expect(await p.evaluate(() => window.__ff.volumes().effect) === 12,
        'tablet: a real finger drag updates volume before release, even outside the slider');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await p.mouse.move(start.x, start.y);
      expect(await p.evaluate(() => window.__ff.volumes().effect) === 12,
        'tablet: cancelling a drag releases the slider');
    } finally {
      await cdp.detach();
    }
  }
  for (const [x, mode] of [[120, 'off'], [28, 'cz'], [75, 'en']]) {
    await tapPanel(p, x, 266, touch);
    expect(await p.evaluate(() => window.__ff.subtitleMode()) === mode, `tablet: subtitles ${mode}`);
  }
  await tapPanel(p, 50, 338, touch);
  await p.waitForFunction(() => window.__ff.helpOpen() && document.getElementById('touchopts').hidden);
  expect(await p.locator('#panelcol').isHidden(), 'tablet: Help replaces Options completely');
  await p.locator('#help-close').click();
  await p.waitForFunction(() => !window.__ff.helpOpen());
  await p.locator('#touchbar [data-region="16"]').click();
  await p.locator('#touchopts #panel').waitFor({ state: 'visible' });
  await tapPanel(p, 135, 370, touch);
  await p.locator('#touchopts').waitFor({ state: 'hidden' });
  expect(await p.locator('.stage > #panelcol').count() === 1 && await p.locator('#panelcol').isHidden(),
    'tablet: the original corner closes Options and returns the hidden column to the stage');
  const after = await p.locator('#screen').boundingBox();
  expect(JSON.stringify(before) === JSON.stringify(after), 'tablet: Options never changes the room layout');
}

/** Replay must not turn the tablet's only settings/close controls into an input trap. */
export async function checkTabletReplayOptions(p, expect) {
  await p.evaluate(() => {
    window.__ff.markSolved(1);
    window.__ff.markBest(1, 'I'.repeat(200)); // Same long-running Replay fixture as test-mapinfo.
    window.__ff.showMap();
    window.__ff.openMapInfo(1);
  });
  await p.waitForFunction(() => window.__ff.mapPresented() && window.__ff.mapInfoRoom() === 1);
  const replay = await p.locator('#screen').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + 322 * r.width / 640, y: r.top + 244 * r.height / 480 };
  });
  await p.touchscreen.tap(replay.x, replay.y);
  await p.waitForFunction(() => window.__ff.replayActive() && window.__ff.screen() === 'room' &&
    !window.__ff.roomLoading() && document.getElementById('loading').hidden);
  await p.locator('#touchbar [data-region="16"]').tap();
  await p.locator('#touchopts #panel').waitFor({ state: 'visible' });

  await tapPanel(p, 15, 85, true);
  expect(await p.evaluate(() => window.__ff.volumes().effect) === 0,
    'tablet Replay: the canvas volume slider remains usable');
  await tapPanel(p, 28, 266, true);
  expect(await p.evaluate(() => window.__ff.subtitleMode()) === 'cz',
    'tablet Replay: the canvas subtitle buttons remain usable');
  await tapPanel(p, 135, 370, true);
  expect(await p.locator('#touchopts').isHidden() && await p.evaluate(() => window.__ff.replayActive()),
    'tablet Replay: Exit Options closes the dialog before playback ends');

  await p.locator('#touchbar [data-region="16"]').tap();
  await p.locator('#touchopts #panel').waitFor({ state: 'visible' });
  await tapPanel(p, 50, 338, true);
  expect(await p.evaluate(() => window.__ff.helpOpen() && window.__ff.replayActive()),
    'tablet Replay: Help opens without cancelling playback');
  await p.locator('#touchopts').waitFor({ state: 'hidden' });
  await p.locator('#help-close').tap();
  await p.waitForFunction(() => !window.__ff.helpOpen());
  expect(await p.evaluate(() => window.__ff.replayActive()),
    'tablet Replay: closing Help returns to playback');

  await p.evaluate(() => {
    window.__ff.setLang('en');
    window.__ff.showMap();
    return window.__ff.enterRoomAwait(7);
  });
  await p.waitForFunction(() => !window.__ff.roomLoading() && document.getElementById('loading').hidden);
}
