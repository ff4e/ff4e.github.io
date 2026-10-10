/** Reuses the phone-layout probe's browser and room loader. */
export async function checkPortraitHint(p, expect, enter) {
  const hint = p.locator('#phone-portrait-hint');
  await p.setViewportSize({ width: 393, height: 852 });
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await enter(4);
  expect(await hint.count() === 0 &&
    await p.evaluate(() => localStorage.getItem('ff.portraitHint.4') === null),
  'VRAK in portrait neither shows nor consumes its rotation hint');
  await p.setViewportSize({ width: 852, height: 393 });
  await hint.waitFor({ state: 'visible' });
  const animation = await hint.evaluate((el) => {
    const phone = el.querySelector('.portrait-hint-phone');
    const turn = phone.getAnimations()[0];
    const running = turn?.playState === 'running';
    if (!turn) throw new Error('Portrait hint has no phone rotation animation');
    turn.pause();
    const frame = (time) => {
      turn.currentTime = time;
      const box = phone.querySelector('rect').getBoundingClientRect();
      const matrix = new DOMMatrix(getComputedStyle(phone).transform);
      return { width: box.width, height: box.height, a: matrix.a, b: matrix.b };
    };
    return {
      running, landscape: frame(0), turning: frame(900), portrait: frame(1800),
      textFree: el.textContent.trim() === '',
    };
  });
  expect(animation.running && animation.textFree &&
    animation.landscape.width > animation.landscape.height &&
    animation.turning.a > 0.1 && animation.turning.a < 0.9 && animation.turning.b < -0.1 &&
    animation.portrait.width < animation.portrait.height,
  'text-free hint animates the phone through a quarter-turn from landscape to portrait');
  await p.evaluate(() => {
    window.__ff.clearSubtitles();
    window.__ff.pushSubtitle('We can still read the conversation while the portrait suggestion is visible.', 'M');
  });
  await p.waitForFunction(() => document.querySelectorAll('#domsubs .subtitle-glyph').length > 0);
  for (const [width, height, left, right] of [[852, 393, 0, 0], [568, 320, 62, 0], [568, 320, 0, 62]]) {
    await p.setViewportSize({ width, height });
    await p.evaluate(([l, r]) => {
      document.documentElement.style.setProperty('--sa-left', `${l}px`);
      document.documentElement.style.setProperty('--sa-right', `${r}px`);
    }, [left, right]);
    const placement = await hint.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const overlaps = (r) => box.left < r.right && box.right > r.left &&
        box.top < r.bottom && box.bottom > r.top;
      const controls = [...document.querySelectorAll('#phone-controls > button')];
      const captions = [...document.querySelectorAll('#domsubs .subtitle-glyph')];
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        fits: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        separate: controls.every((button) => !overlaps(button.getBoundingClientRect())),
        clearCaptions: captions.length > 0 && captions.every((glyph) => !overlaps(glyph.getBoundingClientRect())),
        transparent: hit !== el && !el.contains(hit),
        accessible: el.getAttribute('role') === 'img' &&
          el.getAttribute('aria-label') === 'Try portrait for a better view.',
      };
    });
    expect(placement.fits && placement.separate && placement.clearCaptions &&
      placement.transparent && placement.accessible,
    `${width}x${height}, cutout ${left}/${right}: portrait hint clears controls/captions and is input-transparent`);
  }
  await p.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await hint.evaluate((el) => {
    const phone = el.querySelector('.portrait-hint-phone');
    const box = phone.querySelector('rect').getBoundingClientRect();
    return phone.getAnimations().length === 0 && box.width < box.height && el.textContent.trim() === '';
  });
  expect(reduced, 'reduced motion shows a static portrait phone without visible text');
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/vrak-portrait-hint.png` });
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.evaluate(() => {
    document.documentElement.style.removeProperty('--sa-left');
    document.documentElement.style.removeProperty('--sa-right');
  });
  await p.waitForFunction(() => localStorage.getItem('ff.portraitHint.4') === '1');
  expect(true, 'landscape display remembers the hint before rotation and restart');
  await p.setViewportSize({ width: 393, height: 852 });
  await hint.waitFor({ state: 'detached' });
  expect(true, 'rotating VRAK to portrait dismisses the suggestion');
  await p.setViewportSize({ width: 852, height: 393 });
  await enter(4);
  expect(await hint.count() === 0, 'restarting VRAK in landscape does not repeat the hint');
  await p.evaluate(() => window.__ff.setGraphics('classic'));
  await enter(2);
}
