/**
 * UI test: the control-panel Options sub-panel (Uovl.pas o_options). Covers the
 * scroll open/close state machine, the three volume sliders, the subtitle
 * cz/en/off buttons, the help overlay, and cross-reload persistence.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.selectOption('#room', '7'); // enter UTES
  await p.waitForFunction(() => window.__ff && window.__ff.hasPanel && window.__ff.hasPanel(), { timeout: 8000 });
  await p.waitForTimeout(200);

  // Starts on the normal panel (o_normal).
  expect((await p.evaluate(() => window.__ff.panelOstav())) === 0, 'starts in o_normal');
  expect((await p.evaluate(() => window.__ff.optionsOpen())) === false, 'options closed initially');

  // Click the corner button -> scrolls up to the options sub-panel.
  await p.evaluate(() => window.__ff.panelAction(16));
  await p.waitForFunction(() => window.__ff.optionsOpen(), { timeout: 3000 });
  expect(true, 'corner button scrolls to options (o_options)');

  // Volume sliders: a click at the right edge maxes the index, left edge zeroes it.
  await p.evaluate(() => window.__ff.panelAction(17, 141)); // sound slider, far right
  expect((await p.evaluate(() => window.__ff.volumes().effect)) === 12, 'sound slider -> 12 at x=141');
  await p.evaluate(() => window.__ff.panelAction(17, 12)); // sound slider, far left
  expect((await p.evaluate(() => window.__ff.volumes().effect)) === 0, 'sound slider -> 0 at x=12');
  await p.evaluate(() => window.__ff.panelAction(18, 82)); // voices slider mid
  expect((await p.evaluate(() => window.__ff.volumes().voice)) === 7, 'voices slider -> 7 at x=82');
  await p.evaluate(() => window.__ff.panelAction(19, 141)); // music slider far right
  expect((await p.evaluate(() => window.__ff.volumes().music)) === 12, 'music slider -> 12');

  // Subtitle buttons switch / turn off subtitles (obltitcz/eng/no).
  await p.evaluate(() => window.__ff.panelAction(22)); // off
  expect((await p.evaluate(() => window.__ff.subtitleMode())) === 'off', 'subtitles OFF');
  await p.evaluate(() => window.__ff.panelAction(20)); // czech
  expect((await p.evaluate(() => window.__ff.subtitleMode())) === 'cz', 'subtitles CZ');
  await p.evaluate(() => window.__ff.panelAction(21)); // english
  expect((await p.evaluate(() => window.__ff.subtitleMode())) === 'en', 'subtitles EN');
  expect((await p.evaluate(() => window.__ff.titDef())) === 'en', 'tit_def follows last cz/en choice');

  // Help button opens the help overlay; pages load; arrows page; a key closes it.
  await p.evaluate(() => window.__ff.panelAction(23));
  expect((await p.evaluate(() => window.__ff.helpOpen())) === true, 'help overlay opens');
  await p.waitForFunction(() => window.__ff.helpPageCount() > 0, { timeout: 5000 });
  const pages = await p.evaluate(() => window.__ff.helpPageCount());
  expect(pages === 10, `help has 10 pages (got ${pages})`);
  expect((await p.evaluate(() => window.__ff.helpPage())) === 0, 'help starts on page 0');
  await p.keyboard.press('ArrowRight');
  expect((await p.evaluate(() => window.__ff.helpPage())) === 1, 'ArrowRight advances the help page');
  await p.keyboard.press('ArrowLeft');
  expect((await p.evaluate(() => window.__ff.helpPage())) === 0, 'ArrowLeft goes back');
  await p.keyboard.press('Escape');
  expect((await p.evaluate(() => window.__ff.helpOpen())) === false, 'a key closes help');

  // Corner button again -> scrolls back down to the normal panel.
  await p.evaluate(() => window.__ff.panelAction(16));
  await p.waitForFunction(() => window.__ff.panelOstav() === 0, { timeout: 3000 });
  expect(true, 'corner button scrolls back to o_normal');

  // Persistence: settings survive a reload.
  await p.evaluate(() => window.__ff.panelAction ? window.__ff.toggleOptions() : null);
  await p.reload({ waitUntil: 'networkidle' });
  await p.selectOption('#room', '7');
  await p.waitForFunction(() => window.__ff && window.__ff.hasPanel && window.__ff.hasPanel(), { timeout: 8000 });
  const v = await p.evaluate(() => window.__ff.volumes());
  expect(v.effect === 0 && v.voice === 7 && v.music === 12, `volumes persisted (${JSON.stringify(v)})`);
  expect((await p.evaluate(() => window.__ff.subtitleMode())) === 'en', 'subtitle mode persisted');
});
