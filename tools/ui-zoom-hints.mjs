/** Uses the phone-layout probe's loaded room and real multi-touch driver. */
export async function checkZoomHints(p, expect, { enter, pinch, waitZoom }) {
  const hint = p.locator('#phone-zoom-hint');
  await hint.waitFor({ state: 'visible' });
  const illustration = await hint.evaluate((el) => {
    const left = el.querySelector('.zoom-hint-left');
    const right = el.querySelector('.zoom-hint-right');
    const animations = [left, right].map((hand) => hand.getAnimations()[0]);
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 1200;
    }
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const handOffset = (hand) => {
      const ink = hand.querySelector('path').getBoundingClientRect();
      const contact = hand.querySelector('circle').getBoundingClientRect();
      return (ink.left + ink.right - contact.left - contact.right) / 2;
    };
    return {
      left: new DOMMatrix(getComputedStyle(left).transform).e,
      right: new DOMMatrix(getComputedStyle(right).transform).e,
      handsFaceInward: handOffset(left) > 1 && handOffset(right) < -1,
      accessible: el.getAttribute('role') === 'img' && el.getAttribute('aria-label') === 'Pinch to zoom',
      transparent: hit !== el && !el.contains(hit),
      width: box.width, height: box.height,
      fits: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      remembered: localStorage.getItem('ff.zoomHint.2') === '1' && localStorage.getItem('ff.zoomHint.3') === null,
    };
  });
  expect(illustration.left < -30 && illustration.right > 30, 'two fingers animate apart to teach zoom');
  expect(illustration.handsFaceInward, 'swapped hand icons face inward');
  expect(illustration.transparent && illustration.accessible, 'zoom hint is accessible and input-transparent');
  expect(illustration.fits && illustration.width > 100 && illustration.height > 50, 'landscape zoom hint fits on screen');
  expect(illustration.remembered, 'room 2 is remembered without consuming room 3');
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/zoom-hint-landscape.png` });
  await pinch(1.375);
  await waitZoom(1.375);
  const zoomed = await hint.boundingBox();
  expect(zoomed && Math.abs(zoomed.width - illustration.width) < 1 &&
    Math.abs(zoomed.height - illustration.height) < 1, 'real pinch works through the hint without magnifying it');
  await p.setViewportSize({ width: 393, height: 852 });
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await enter(3);
  await hint.waitFor({ state: 'visible' });
  const portrait = await hint.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      static: el.getAnimations({ subtree: true }).length === 0,
      fits: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      remembered: localStorage.getItem('ff.zoomHint.3') === '1',
    };
  });
  expect(portrait.static && portrait.fits && portrait.remembered,
    'room 3 independently shows a portrait-safe, reduced-motion hint');
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/zoom-hint-portrait.png` });
  await p.locator('#phone-more').tap();
  await hint.waitFor({ state: 'detached' });
  expect(true, 'opening the phone menu dismisses the zoom hint');
  await p.keyboard.press('Escape');
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.setViewportSize({ width: 852, height: 393 });
  await enter(2);
  expect(await hint.count() === 0, 'returning to room 2 does not repeat its first-entry hint');
}

export async function checkZoomHintsAfterReload(p, expect, enter) {
  for (const room of [2, 3]) {
    await enter(room);
    expect(await p.locator('#phone-zoom-hint').count() === 0,
      `room ${room} hint remains seen after relaunch`);
  }
}
