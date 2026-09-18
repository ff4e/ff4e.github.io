import assert from 'node:assert/strict';
import { join } from 'node:path';
import { appReady, WAIT_BACKSTOP } from './ui-lib.mjs';

/** Real pointer and keyboard activation must switch once, never swim or lose keyboard focus. */
export async function checkFishSwitchButton(p, badge) {
  assert.equal(await badge.evaluate(el => el.tagName), 'BUTTON', 'fish indicator is a native button');
  for (const input of ['tap', 'click', 'Enter', 'Space']) {
    await p.waitForFunction(() => window.__ff.phase() === 'idle');
    const before = await p.evaluate(() => ({ fish: window.__ff.state().active, moves: window.__ff.moves() }));
    if (input === 'tap') await badge.tap();
    else if (input === 'click') await badge.click();
    else {
      await badge.focus();
      await p.keyboard.press(input);
    }
    await p.waitForFunction(fish => window.__ff.state().active !== fish, before.fish);
    await p.waitForFunction(() => window.__ff.phase() === 'idle');
    const after = await badge.evaluate(el => ({
      fish: el.dataset.fish, moves: window.__ff.moves(), focused: document.activeElement === el,
    }));
    assert.equal(after.fish, before.fish === 'little' ? 'big' : 'little', `${input}: selects the other fish once`);
    assert.equal(after.moves, before.moves, `${input}: switching must not swim`);
    assert.equal(after.focused, input === 'Enter' || input === 'Space', `${input}: appropriate focus retention`);
  }
}

/** Tablet coverage shares the indicator probe's browser and error reporting. */
export async function checkTabletFishIndicator(browser, base, evidence, errors) {
  const context = await browser.newContext({
    viewport: { width: 834, height: 1194 }, screen: { width: 834, height: 1194 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  try {
    const p = await context.newPage();
    p.setDefaultTimeout(WAIT_BACKSTOP);
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.addInitScript(() => {
      localStorage.setItem('ff.options', JSON.stringify({ introSeen: true }));
      localStorage.setItem('ff.graphics', 'enhanced');
      localStorage.setItem('ff.renderer', 'cpu');
    });
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await appReady(p);
    const badge = p.locator('#active-fish-indicator');
    const waitFish = (fish) => p.waitForFunction(fish => {
      const el = document.getElementById('active-fish-indicator');
      return !window.__ff.roomLoading() && !window.__ff.roomArtPending() &&
        el && !el.hidden && el.dataset.fish === fish && el.getBoundingClientRect().width > 0;
    }, fish);
    const cases = [
      { name: 'ipad-portrait', width: 834, height: 1194, room: 7, edge: 'top', insets: [24, 0, 20, 0] },
      { name: 'ipad-landscape-left', width: 1194, height: 834, room: 6, edge: 'left', insets: [24, 0, 20, 0] },
      { name: 'ipad-landscape-top', width: 1194, height: 834, room: 7, edge: 'top', insets: [24, 0, 20, 0] },
      { name: 'mini-portrait', width: 744, height: 1133, room: 6, edge: 'top', insets: [24, 0, 20, 0] },
      { name: 'tablet-browser', width: 768, height: 1024, room: 7, edge: 'top', insets: [0, 0, 0, 0] },
      { name: 'tablet-side-inset', width: 1194, height: 834, room: 6, edge: 'left', insets: [24, 0, 20, 32] },
    ];
    for (const c of cases) {
      await p.setViewportSize({ width: c.width, height: c.height });
      await p.evaluate(insets => {
        ['top', 'right', 'bottom', 'left'].forEach((side, i) =>
          document.documentElement.style.setProperty(`--sa-${side}`, `${insets[i]}px`));
      }, c.insets);
      await p.evaluate(room => window.__ff.enterRoomAwait(room), c.room);
      await waitFish('little');
      await p.waitForFunction(edge => {
        const root = document.documentElement;
        const actual = innerHeight >= innerWidth ? 'top' : root.dataset.touchbarEdge ?? 'left';
        const g = window.__ff.roomGeom();
        return root.hasAttribute('data-touchbar') && actual === edge &&
          g && Math.abs(document.getElementById('screen').clientWidth - g.cssW) <= 1;
      }, c.edge);
      // Layout can settle before the new room's art hold releases the button.
      await waitFish('little');
      const g = await badge.evaluate(el => {
        const rect = node => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
        };
        const buttons = [...document.querySelectorAll('#touchbar > button[data-region]')];
        const before = buttons.map(rect);
        el.style.display = 'none';
        const withoutBadge = buttons.map(rect);
        el.style.removeProperty('display');
        const style = node => {
          const s = getComputedStyle(node);
          return [s.backgroundColor, s.borderColor, s.borderRadius, s.boxShadow];
        };
        const image = el.querySelector('img:not([hidden])');
        return {
          parent: el.parentElement.id, badge: rect(el), bar: rect(el.parentElement), buttons: before,
          withoutBadge, regions: buttons.map(b => b.dataset.region), style: style(el), buttonStyle: style(buttons[0]),
          picture: rect(image), loaded: image.complete && image.naturalWidth > 0,
          focusable: el.tabIndex >= 0,
          intercepts: !!document.elementFromPoint(rect(el).x + 26, rect(el).y + 24)?.closest('#active-fish-indicator'),
        };
      });
      assert.equal(g.parent, 'touchbar', `${c.name}: badge is inside the existing bar`);
      assert.equal(g.badge.w, 52, `${c.name}: tablet shell width`);
      assert.equal(g.badge.h, 48, `${c.name}: tablet shell height`);
      assert.deepEqual(g.style, g.buttonStyle, `${c.name}: same room-colored surface`);
      assert.deepEqual(g.buttons, g.withoutBadge, `${c.name}: indicator does not shift the six buttons`);
      assert.deepEqual(g.regions, ['14', '12', '13', '15', '16', '24'], `${c.name}: button order unchanged`);
      assert(g.loaded && g.picture.w === 32 && g.picture.h === 32, `${c.name}: real 32px fish art`);
      assert.equal(g.badge.x, Math.max(14, c.insets[3]), `${c.name}: left corner follows bar/safe-area lead`);
      assert.equal(g.badge.y, c.edge === 'top' ? c.insets[0] + 3 : Math.max(16, c.insets[0] + 8),
        `${c.name}: top corner clears the safe area`);
      assert(g.badge.x >= g.bar.x && g.badge.y >= g.bar.y &&
        g.badge.right <= g.bar.right && g.badge.bottom <= g.bar.bottom, `${c.name}: entirely inside bar`);
      assert(g.buttons.every(r => g.badge.right + 8 <= r.x || g.badge.bottom + 8 <= r.y),
        `${c.name}: corner display clears every button by at least 8px`);
      assert(g.focusable && g.intercepts, `${c.name}: fish picture is a reachable switch button`);
      if (evidence) await p.screenshot({ path: join(evidence, `${c.name}.png`) });
    }
    await checkFishSwitchButton(p, badge);
    const cdp = await context.newCDPSession(p);
    for (const c of [
      { width: 375, height: 812, room: 6, insets: [24, 0, 20, 0] },
      { width: 375, height: 812, room: 6, insets: [24, 0, 20, 20] },
      { width: 320, height: 700, room: 6, insets: [24, 0, 20, 0] },
      { width: 844, height: 390, room: 6, insets: [24, 0, 20, 0] },
      { width: 844, height: 375, room: 6, insets: [24, 0, 20, 0] },
      { width: 575, height: 400, room: 6, insets: [24, 0, 20, 0] },
      { width: 575, height: 400, room: 7, insets: [24, 0, 20, 0] },
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: c.width, height: c.height, screenWidth: 834, screenHeight: 1194,
        deviceScaleFactor: 2, mobile: true,
      });
      await p.evaluate(insets => {
        ['top', 'right', 'bottom', 'left'].forEach((side, i) =>
          document.documentElement.style.setProperty(`--sa-${side}`, `${insets[i]}px`));
      }, c.insets);
      await p.evaluate(room => window.__ff.enterRoomAwait(room), c.room);
      await waitFish('little');
      const targets = await p.locator('#touchbar > button').evaluateAll(buttons => buttons.map(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { id: el.id || el.dataset.region, x: r.x, y: r.y, right: r.right, bottom: r.bottom,
          w: r.width, h: r.height, reachable: hit === el || el.contains(hit) };
      }));
      for (const [i, a] of targets.entries()) {
        assert(a.w >= 44 && a.h >= 44 && a.x >= 0 && a.y >= c.insets[0] &&
          a.right <= c.width && a.bottom <= c.height - c.insets[2],
        `${c.width}x${c.height}: ${a.id} stays in the safe area with a 44px target: ${JSON.stringify(a)}`);
        assert(a.reachable, `${c.width}x${c.height}: ${a.id} receives its own taps`);
        for (const b of targets.slice(i + 1)) {
          assert(a.right <= b.x + 0.1 || b.right <= a.x + 0.1 ||
            a.bottom <= b.y + 0.1 || b.bottom <= a.y + 0.1,
          `${c.width}x${c.height}: ${a.id} and ${b.id} do not overlap`);
        }
      }
      await p.locator('#touchbar [data-region="14"]').tap();
      await p.waitForFunction(() => window.__ff.screen() === 'map');
      await p.evaluate(room => window.__ff.enterRoomAwait(room), c.room);
      await waitFish('little');
      await badge.tap();
      await waitFish('big');
    }
    await p.setViewportSize({ width: 1194, height: 834 });
    await p.evaluate(() => window.__ff.enterRoomAwait(6));
    await waitFish('little');
    await p.waitForFunction(() => window.__ff.phase() === 'idle');
    await p.keyboard.press('Space');
    await waitFish('big');
    await p.click('#touchbar [data-region="16"]');
    await badge.waitFor({ state: 'hidden' });
    await p.click('#topt-close');
    await waitFish('big');

    await p.evaluate(() => { window.tabletFishBadge = document.getElementById('active-fish-indicator'); });
    for (const device of [
      { width: 402, height: 874, parent: 'phone-controls' },
      { width: 834, height: 1194, parent: 'touchbar' },
      { width: 874, height: 402, parent: 'phone-controls' },
      { width: 1194, height: 834, parent: 'touchbar' },
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: device.width, height: device.height, screenWidth: device.width, screenHeight: device.height,
        deviceScaleFactor: 2, mobile: true,
      });
      await p.waitForFunction(parent => {
        const el = document.getElementById('active-fish-indicator');
        return el && !el.hidden && el.parentElement.id === parent;
      }, device.parent);
      assert.equal(await badge.count(), 1, 'live tablet/phone transitions never duplicate the badge');
      assert.equal(await p.evaluate(() => document.getElementById('active-fish-indicator') === window.tabletFishBadge),
        true, 'live mode changes move the original badge, not a new display');
      await waitFish('big');
    }
    await p.evaluate(() => window.__ff.enterRoomAwait(7));
    await waitFish('little');
    await p.waitForFunction(() => window.__ff.phase() === 'idle');
    await p.evaluate(() => window.__ff.forceExit('little', 3));
    await p.waitForFunction(() => window.__ff.state().venku.little);
    await waitFish('big');
    await badge.tap();
    assert.equal(await p.evaluate(() => window.__ff.state().active), 'big',
      'like a room tap, the button cannot select the fish that already exited');
    await p.click('#touchbar [data-region="14"]');
    await badge.waitFor({ state: 'hidden' });
  } finally {
    await context.close();
  }
}
