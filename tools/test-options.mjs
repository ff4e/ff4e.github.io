/**
 * UI test: the control-panel Options sub-panel (Uovl.pas o_options). Covers the
 * scroll open/close state machine, the three volume sliders, the subtitle
 * cz/en/off buttons, the help overlay, and cross-reload persistence.
 */
import { reloadApp, selectRoom, tickSleep, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // enter UTES
  await p.waitForFunction(() => window.__ff && window.__ff.hasPanel && window.__ff.hasPanel());
  await tickSleep(p, 3);

  // Starts on the normal panel (o_normal).
  expect((await p.evaluate(() => window.__ff.panelOstav())) === 0, 'starts in o_normal');
  expect((await p.evaluate(() => window.__ff.optionsOpen())) === false, 'options closed initially');

  // Click the corner button -> scrolls up to the options sub-panel.
  await p.evaluate(() => window.__ff.panelAction(16));
  await p.waitForFunction(() => window.__ff.optionsOpen());
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
  // The slider index is mapped back to the original's 0..64 music_volume for room
  // scripts (VES's quiet-music easter egg reads it — URoom.pas:12190).
  expect(
    (await p.evaluate(() => window.__ff.scriptMusicVolume())) === 64,
    'music_volume tracks the slider (index 12 -> Volumes[12] = 64)',
  );
  await p.evaluate(() => window.__ff.panelAction(19, 72)); // music slider -> index 6
  expect(
    (await p.evaluate(() => window.__ff.scriptMusicVolume())) === 11,
    'music_volume follows a drag down (index 6 -> Volumes[6] = 11)',
  );
  await p.evaluate(() => window.__ff.panelAction(19, 141)); // restore for the persistence check

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
  await p.waitForFunction(() => window.__ff.helpPageCount() > 0);
  const pages = await p.evaluate(() => window.__ff.helpPageCount());
  expect(pages === 10, `help has 10 pages (got ${pages})`);
  expect((await p.evaluate(() => window.__ff.helpPage())) === 0, 'help starts on page 0');
  await p.keyboard.press('ArrowRight');
  expect((await p.evaluate(() => window.__ff.helpPage())) === 1, 'ArrowRight advances the help page');
  await p.keyboard.press('ArrowLeft');
  expect((await p.evaluate(() => window.__ff.helpPage())) === 0, 'ArrowLeft goes back');

  // The panel is hidden while help is up, and the close button is the way back.
  //
  // The help page is drawn at its own unscaled size and the stage box hugs its content
  // (app/loadingUi.ts), so a panel left visible slid a long way sideways the moment help
  // opened — measured 541px at 2048x1017. It is hidden instead, which takes away the only
  // discoverable way out (Help.pas closes on any key or a right-click, neither of which
  // announces itself), so the button is a deliberate addition. Both halves are asserted
  // here because either one alone is a trap.
  const helpLayout = await p.evaluate(() => {
    const pc = document.getElementById('panelcol');
    const hc = document.getElementById('help-close');
    const cv = document.getElementById('screen').getBoundingClientRect();
    const hr = hc.getBoundingClientRect();
    return {
      panelShown: getComputedStyle(pc).display !== 'none',
      btnShown: !hc.hidden,
      btnInsidePage: hr.left >= cv.left && hr.top >= cv.top && hr.right <= cv.right && hr.bottom <= cv.bottom,
    };
  });
  expect(!helpLayout.panelShown, 'the control panel is hidden while help is open');
  expect(helpLayout.btnShown, 'the help close button is shown while help is open');
  expect(helpLayout.btnInsidePage, 'the help close button sits inside the help page');
  await p.click('#help-close');
  expect((await p.evaluate(() => window.__ff.helpOpen())) === false, 'the close button closes help');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('panelcol')).display !== 'none');
  expect(
    await p.evaluate(() => document.getElementById('help-close').hidden),
    'the close button goes away with the help page',
  );

  await p.evaluate(() => window.__ff.panelAction(23));
  await p.keyboard.press('Escape');
  expect((await p.evaluate(() => window.__ff.helpOpen())) === false, 'a key closes help');

  // Corner button again -> scrolls back down to the normal panel.
  await p.evaluate(() => window.__ff.panelAction(16));
  await p.waitForFunction(() => window.__ff.panelOstav() === 0);
  expect(true, 'corner button scrolls back to o_normal');

  // Persistence: settings survive a reload.
  await p.evaluate(() => window.__ff.panelAction ? window.__ff.toggleOptions() : null);
  await reloadApp(p);
  await selectRoom(p, 7);
  await p.waitForFunction(() => window.__ff && window.__ff.hasPanel && window.__ff.hasPanel());
  const v = await p.evaluate(() => window.__ff.volumes());
  expect(v.effect === 0 && v.voice === 7 && v.music === 12, `volumes persisted (${JSON.stringify(v)})`);
  expect((await p.evaluate(() => window.__ff.subtitleMode())) === 'en', 'subtitle mode persisted');

  // On the world map, the Options overlay floats centred over the map. Opening Help
  // from it must CLOSE the Options overlay first (it would otherwise render on top of
  // the full-screen help pages, hiding them). Faithful analogue of the original where
  // FHelp shows as its own top-level window over the panel.
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await p.evaluate(() => window.__ff.openMapOptions());
  expect((await p.evaluate(() => window.__ff.mapOverlay())) === 'options', 'map Options overlay opens');
  expect((await p.evaluate(() => window.__ff.optionsOpen())) === true, 'panel is on the options face over the map');

  await p.evaluate(() => window.__ff.panelAction(23)); // help button (oblhelp)
  expect((await p.evaluate(() => window.__ff.helpOpen())) === true, 'help overlay opens from the map Options panel');
  expect(
    (await p.evaluate(() => window.__ff.mapOverlay())) === 'none',
    'opening Help closes the map Options overlay (no longer drawn over Help)',
  );
  await p.keyboard.press('Escape');
  expect((await p.evaluate(() => window.__ff.helpOpen())) === false, 'a key closes help');
  expect(
    (await p.evaluate(() => window.__ff.screen())) === 'map',
    'closing Help returns to the plain map (Options was closed)',
  );
});
