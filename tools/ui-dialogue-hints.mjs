/**
 * Browser-only hint checks, sharing test-touchbar's already-booted context.
 * Lifecycle/expiry cases live in the unit suite. Here we seek CSS animations rather
 * than sleeping through each gesture; speakLine still uses the real scriptTalk hook.
 */
export async function checkDialogueHints(p, expect) {
  const enter = async (n) => {
    await p.evaluate((room) => window.__ff.enterRoomAwait(room), n);
    await p.waitForFunction(() => !window.__ff.roomLoading() && window.__ff.roomAudioReady() &&
      document.getElementById('loading').hidden);
  };
  const speak = (line) => p.evaluate((name) => window.__ff.speakLine(name), line);
  const absent = () => p.waitForFunction(() =>
    !document.getElementById('dialogue-gesture-hint') && !document.querySelector('.dialogue-hint-pulse'));

  await enter(1);
  await p.selectOption('#touchmode', 'off');
  await speak('1st-v-navod1');
  expect(await p.locator('#dialogue-gesture-hint').count() === 0, 'desktop dialogue has no finger hint');
  await p.selectOption('#touchmode', 'on');
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchbar') &&
    getComputedStyle(document.getElementById('panelcol')).display === 'none');
  const gesture = await p.evaluate(() => {
    const before = window.__ff.state();
    const keys = [];
    const onKey = (e) => keys.push(e.code);
    window.addEventListener('keydown', onKey, true);
    window.__ff.speakLine('1st-v-navod1');
    const el = document.getElementById('dialogue-gesture-hint');
    const finger = el.querySelector('.hint-finger');
    const animation = finger.getAnimations()[0];
    animation.pause();
    const duration = animation.effect.getTiming().duration;
    const sample = (fraction) => {
      animation.currentTime = duration * fraction;
      const matrix = new DOMMatrix(getComputedStyle(finger).transform);
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    };
    const poses = [0.18, 0.32, 0.50, 0.64, 0.84].map(sample);
    const box = el.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const hitThrough = target !== el && !el.contains(target);
    const after = window.__ff.state();
    const noActions = keys.length === 0 && before.active === after.active &&
      before.little.x === after.little.x && before.big.x === after.big.x;
    const pointer = (type, x) => target.dispatchEvent(new PointerEvent(type, {
      pointerType: 'touch', pointerId: 41, bubbles: true, cancelable: true,
      clientX: box.x + box.width / 2 + x, clientY: box.y + box.height / 2,
    }));
    pointer('pointerdown', 0);
    pointer('pointerup', 0);
    pointer('pointerdown', 0);
    pointer('pointermove', 60);
    pointer('pointerup', 60);
    window.removeEventListener('keydown', onKey, true);
    window.__ff.speakLine('1st-v-navod1');
    return {
      poses, duration, hitThrough, noActions, keys, hitTarget: target.id || target.tagName,
      replaced: !el.isConnected && !!document.getElementById('dialogue-gesture-hint'),
      decorative: el.getAttribute('aria-hidden') === 'true',
      line: window.__ff.lastLine().name,
    };
  });
  expect(gesture.line === '1st-v-navod1' && gesture.duration > 0, 'the real dialogue hook starts a timed gesture');
  expect(gesture.poses[0].x < -40 && gesture.poses[1].x > 40, 'the finger demonstrates left and right');
  expect(gesture.poses[2].y < -30 && gesture.poses[3].y > 30, 'then up and down');
  expect(gesture.poses[4].scale < 0.9, 'then a tap');
  expect(gesture.hitThrough && gesture.decorative, 'the illustration is decorative and pointer-transparent');
  expect(gesture.noActions, 'the animation itself emits no input and moves neither fish');
  expect(gesture.keys.includes('Space') && gesture.keys.includes('ArrowRight'),
    `real tap/swipe input passes through the hint (${gesture.hitTarget}: ${gesture.keys.join(', ')})`);
  expect(gesture.replaced, 'hearing the same line again starts a fresh illustration');

  const originalViewport = p.viewportSize();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await p.setViewportSize(viewport);
    await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const fits = await p.evaluate(() => {
      window.__ff.speakLine('1st-v-navod1');
      const box = document.getElementById('dialogue-gesture-hint').getBoundingClientRect();
      const room = document.getElementById('screen').getBoundingClientRect();
      return box.width > 50 && box.left >= room.left && box.right <= room.right &&
        box.top >= room.top && box.bottom <= room.bottom;
    });
    expect(fits, `the gesture stays inside the room at ${viewport.width}x${viewport.height}`);
  }
  await p.setViewportSize(originalViewport);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const originalSubtitles = await p.evaluate(() => window.__ff.subtitleMode());
  await p.evaluate(() => window.__ff.setLang('off'));
  try {
    const staticGesture = await p.evaluate(() => {
      window.__ff.speakLine('1st-v-navod1');
      const el = document.getElementById('dialogue-gesture-hint');
      return el && getComputedStyle(el.querySelector('.hint-finger')).animationName === 'none' &&
        el.getAnimations({ subtree: true }).length === 0;
    });
    expect(staticGesture, 'reduced motion keeps a static illustration, even with subtitles off');
  } finally {
    await p.evaluate((mode) => window.__ff.setLang(mode), originalSubtitles);
  }
  expect(await p.evaluate(() => window.__ff.subtitleMode()) === originalSubtitles,
    'the hint checks restore the original subtitle mode');
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await speak('1st-m-navod2');
  await absent();
  expect(true, 'the next unrelated dialogue clears the illustration');

  await enter(2);
  for (const [name, region] of [['help2', '12'], ['help7', '13'], ['help11', '13']]) {
    await p.locator(`#touchbar [data-region="${region}"]`).focus();
    await p.keyboard.press('Tab');
    await p.keyboard.press('Shift+Tab');
    const pulse = await p.evaluate(({ name, region }) => {
      window.__ff.speakLine('help1', 'little');
      const target = document.querySelector(`#touchbar [data-region="${region}"]`);
      const border = getComputedStyle(target).border;
      window.__ff.speakLine(name);
      const lit = [...document.querySelectorAll('.dialogue-hint-pulse')];
      const button = lit[0];
      const animation = button?.getAnimations()[0];
      if (!animation) return { target: false, visibleChange: false, sameBox: false };
      animation.pause();
      animation.currentTime = 0;
      const base = getComputedStyle(button).backgroundColor;
      const size = button.getBoundingClientRect();
      animation.currentTime = 600;
      const bright = getComputedStyle(button).backgroundColor;
      const end = button.getBoundingClientRect();
      window.__ff.speakLine('help1', 'little');
      const restored = getComputedStyle(button);
      return {
        target: lit.length === 1 && button.dataset.region === region,
        visibleChange: base !== bright,
        sameBox: size.width === end.width && size.height === end.height,
        focusRestored: button.matches(':focus-visible') && restored.border === border &&
          restored.boxShadow === 'none' && restored.outlineStyle === 'solid' &&
          restored.outlineColor === 'rgb(170, 238, 238)' && restored.outlineOffset === '2px',
      };
    }, { name, region });
    expect(pulse.target && pulse.visibleChange && pulse.sameBox, `${name} visibly pulses only button ${region}, without changing layout`);
    expect(pulse.focusRestored, `${name} restores the border with a visible, separate keyboard-focus outline`);
  }
  const save = p.locator('#touchbar [data-region="12"]');
  await save.click();
  await p.keyboard.press('Shift');
  expect(await save.evaluate((el) => document.activeElement !== el && !el.matches(':focus-visible')),
    'clicking Save does not leave a focus ring that reappears on the next game key');
  const focusSave = async () => {
    await save.focus();
    await p.keyboard.press('Tab');
    await p.keyboard.press('Shift+Tab');
  };
  await focusSave();
  await p.keyboard.press('Enter');
  expect(await save.evaluate((el) => document.activeElement === el && el.matches(':focus-visible')),
    'keyboard activation keeps visible focus on Save');
  await p.locator('#screen').click({ position: { x: 2, y: 2 } });
  expect(await save.evaluate((el) => document.activeElement !== el),
    'clicking the game releases button focus despite the canvas cancelling mousedown');
  await focusSave();
  await p.locator('#screen').dispatchEvent('pointerdown', {
    pointerType: 'touch', pointerId: 42, clientX: 400, clientY: 300,
  });
  expect(await save.evaluate((el) => document.activeElement !== el),
    'starting a touch gesture also releases button focus');
  await p.locator('#screen').dispatchEvent('pointerup', {
    pointerType: 'touch', pointerId: 42, clientX: 400, clientY: 300,
  });
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Start and sample together: the real room's next line may clear this hint.
  const staticPulse = await p.evaluate(() => {
    window.__ff.speakLine('help2');
    const el = document.querySelector('.dialogue-hint-pulse');
    return el && getComputedStyle(el).animationName === 'none' &&
      el.getAnimations().length === 0 && getComputedStyle(el).boxShadow !== 'none';
  });
  expect(staticPulse, 'reduced motion keeps a static button highlight');
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.selectOption('#touchmode', 'off');
  await absent();
  await speak('help7');
  expect(await p.locator('.dialogue-hint-pulse').count() === 0, 'desktop narration has no button pulse');
  await p.selectOption('#touchmode', 'on');
  await speak('help2');
  await p.evaluate(() => window.__ff.showMap());
  await absent();
  expect(true, 'leaving the room removes the highlight');
}
