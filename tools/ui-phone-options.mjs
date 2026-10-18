/**
 * The phone's touch Options: the original face, whole in portrait and cut in two in
 * landscape (optionsLayout.ts). Every tap goes through `panelPoint`, which reads the layout
 * from the canvas's own shape, so the mapping under test is not the one doing the tapping.
 */
import { panelPoint, tapPanel } from './ui-tablet-options.mjs';

const FACE = { portrait: [155, 395], landscape: [305, 198] };

/** Rotation can update the viewport, dialog and native insets in separate frames. */
export async function rotatePhoneOptions(p, expect, label, landscape) {
  const dialog = p.locator('#touchopts');
  await p.locator('#touchopts #panel').waitFor({ state: 'visible' });
  await p.waitForFunction(landscape => {
    const el = document.getElementById('panel');
    return landscape ? el.width < el.height : el.width > el.height;
  }, landscape);
  await dialog.evaluate(el => { el.style.minHeight = getComputedStyle(el).height; });
  await p.setViewportSize(landscape ? { width: 852, height: 393 } : { width: 393, height: 852 });
  await p.waitForFunction(landscape => {
    const el = document.getElementById('panel');
    return landscape ? el.width > el.height : el.width < el.height;
  }, landscape);
  await dialog.evaluate(el => { el.style.minHeight = ''; });
  await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const [top, right, bottom, left] = landscape ? [0, 0, 20, 62] : [62, 0, 34, 0];
  await p.evaluate(insets => {
    for (const [i, side] of ['top', 'right', 'bottom', 'left'].entries())
      document.documentElement.style.setProperty(`--sa-${side}`, `${insets[i]}px`);
  }, [top, right, bottom, left]);
  await p.waitForFunction(() => {
    const panel = document.getElementById('panel').getBoundingClientRect();
    const bar = document.getElementById('feedbar').getBoundingClientRect();
    const dlg = document.getElementById('touchopts');
    const cs = getComputedStyle(dlg);
    const slack = Math.min(dlg.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - panel.width,
      dlg.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (bar.bottom - panel.top));
    return panel.top >= 0 && bar.bottom <= innerHeight && slack > -1 && slack < 2;
  });
  expect(await p.evaluate(() => window.__ff.optionsOpen()), `${label}: rotation keeps Options open and refits it`);
}

/** Called with Options open. `landscape` is the face the caller expects; ends with it closed. */
export async function checkPhoneOptions(p, expect, label, landscape) {
  await p.locator('#touchopts #panel').waitFor({ state: 'visible' });
  const [fw, fh] = FACE[landscape ? 'landscape' : 'portrait'];
  const face = await p.locator('#panel').evaluate(el => el.getBoundingClientRect().toJSON());
  const privacy = await p.locator('#feedbar-privacy').evaluate(el => el.getBoundingClientRect().toJSON());
  const vp = p.viewportSize();
  expect(await p.evaluate(() => window.__ff.optionsOpen()) && Math.abs(face.width / face.height - fw / fh) < 0.01,
    `${label}: the ${landscape ? 'cut landscape' : 'whole portrait'} Options face is open`);
  expect(await p.locator('#panel').evaluate(el => getComputedStyle(el).webkitTapHighlightColor) === 'rgba(0, 0, 0, 0)',
    `${label}: a press does not tint the whole face with the browser's tap highlight`);
  const scale = face.width / fw;
  expect(face.x >= 0 && face.y >= 0 && face.right <= vp.width && face.bottom <= vp.height &&
    privacy.bottom <= vp.height && privacy.height > 0 && 17 * scale >= 22,
  `${label}: the face and Privacy fit on screen, scaled to ${scale.toFixed(2)}x with finger-sized sliders`);
  expect(Math.abs(face.left + face.width / 2 - vp.width / 2) < 1,
    `${label}: the face is horizontally centred on the whole screen`);
  // As large as the dialog allows, judged by the strip as it wraps NOW: a strip measured at
  // a stale width (the face's previous size) left a landscape face about 3/4 size.
  const slack = await p.evaluate(() => {
    const dlg = document.getElementById('touchopts');
    const cs = getComputedStyle(dlg);
    const bar = document.getElementById('feedbar');
    const face = document.getElementById('panel').getBoundingClientRect();
    const barH = bar.offsetHeight + parseFloat(getComputedStyle(bar).marginTop);
    return Math.min(
      dlg.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - face.width,
      dlg.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - barH - face.height);
  });
  expect(slack > -1 && slack < 2, `${label}: the face fills the dialog (${slack.toFixed(1)}px to spare)`);
  if (landscape) {
    expect(await p.locator('#touchopts').evaluate(el => {
      const cs = getComputedStyle(el);
      const bar = document.getElementById('feedbar');
      return parseFloat(cs.paddingBottom) === 10 && parseFloat(getComputedStyle(bar).marginTop) === 4;
    }), `${label}: the compact footer uses a 4px gap and 10px bottom margin`);
  }

  const volumes = await p.evaluate(() => window.__ff.volumes());
  const subtitles = await p.evaluate(() => window.__ff.subtitleMode());
  for (const [bus, y, level] of [['effect', 85, 3], ['voice', 134, 9], ['music', 183, 12]]) {
    await tapPanel(p, 15 + 10 * level, y, true);
    expect(await p.evaluate(bus => window.__ff.volumes()[bus], bus) === level,
      `${label}: the original ${bus} slider changes the correct bus`);
  }
  for (const [x, mode] of [[120, 'off'], [28, 'cz'], [75, 'en']]) {
    await tapPanel(p, x, 266, true);
    expect(await p.evaluate(() => window.__ff.subtitleMode()) === mode, `${label}: subtitles ${mode}`);
  }
  if (landscape) {
    // Across the seam and well into the lower half's picture: still the slider, clamped.
    const cdp = await p.context().newCDPSession(p);
    try {
      const start = await panelPoint(p, 15, 85);
      const end = await panelPoint(p, 75, 266);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await cdp.detach();
    }
    expect(await p.evaluate(() => window.__ff.volumes().effect) === 12 &&
      await p.evaluate(() => window.__ff.subtitleMode()) === 'en',
    `${label}: a slider drag carried past the seam stays on the slider and reads loudest`);
  }
  for (const [bus, y] of [['effect', 85], ['voice', 134], ['music', 183]]) await tapPanel(p, 15 + 10 * volumes[bus], y, true);
  await tapPanel(p, { cz: 28, en: 75, off: 120 }[subtitles], 266, true);
  expect(JSON.stringify(await p.evaluate(() => window.__ff.volumes())) === JSON.stringify(volumes) &&
    await p.evaluate(() => window.__ff.subtitleMode()) === subtitles, `${label}: settings restored`);

  await tapPanel(p, 135, 370, true);
  await p.locator('#touchopts').waitFor({ state: 'hidden' });
  expect(await p.locator('.stage > #panelcol').count() === 1 && await p.locator('#panelcol').isHidden(),
    `${label}: the original corner closes Options and returns the hidden column to the stage`);
}

/** Help sits in the lower half, so on a landscape phone it is reached through the cut. */
export async function checkPhoneOptionsHelp(p, expect, label) {
  await p.locator('#touchopts #panel').waitFor({ state: 'visible' });
  await tapPanel(p, 50, 338, true);
  await p.waitForFunction(() => window.__ff.helpOpen() && document.getElementById('touchopts').hidden);
  expect(await p.locator('#panelcol').isHidden(), `${label}: Help replaces Options completely`);
  await p.locator('#help-close').tap();
  await p.waitForFunction(() => !window.__ff.helpOpen());
}
