/**
 * Phone-only layout integration: real multi-touch, both backends, room transitions,
 * corner dispatch and detached subtitles. Geometry/state-machine permutations are unit tests.
 */
import { chromium } from 'playwright';
import { exitProbe, WAIT_BACKSTOP } from './ui-lib.mjs';

const base = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;
const browser = await chromium.launch();
let ok = true;
const expect = (value, message) => {
  if (!value) ok = false;
  console.log(`  ${value ? 'ok  ' : 'FAIL'} ${message}`);
};
const errors = [];
const context = await browser.newContext({
  viewport: { width: 852, height: 393 }, screen: { width: 393, height: 852 },
  hasTouch: true, isMobile: true, deviceScaleFactor: 3,
});
const p = await context.newPage();
p.setDefaultTimeout(WAIT_BACKSTOP);
p.on('pageerror', (e) => errors.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem('ff.options', JSON.stringify({ introSeen: true }));
  localStorage.setItem('ff.devEnabled', '0');
  window.phoneKeys = [];
  window.phonePointers = [];
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    window.addEventListener(type, (e) => {
      if (e.pointerType !== 'touch') return;
      window.phonePointers.push([type, e.pointerId, e.clientX, e.clientY,
        e.target.id || e.target.className, window.__ff?.roomNum()]);
      if (window.phonePointers.length > 24) window.phonePointers.shift();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) window.phoneKeys.push(e.code);
  }, true);
});
const scale = () => p.evaluate(() =>
  new DOMMatrix(getComputedStyle(document.getElementById('screen').parentElement).transform).a);
const enter = async (n) => {
  await p.evaluate((num) => window.__ff.enterRoomAwait(num), n);
  await p.waitForFunction((num) =>
    window.__ff.roomNum() === num && !window.__ff.roomLoading() &&
    !window.__ff.roomAudioPending() && !window.__ff.roomPreloadPending() &&
    !window.__ff.throttleInfo().roomArtPending && window.__ff.roomAudioReady() &&
    document.getElementById('loading').hidden &&
    Math.abs(document.getElementById('screen').clientWidth - window.__ff.roomGeom().cssW) <= 1, n);
  const loop = await p.evaluate(() => window.__ff.throttleInfo().loops);
  await p.waitForFunction((previous) => window.__ff.throttleInfo().loops > previous, loop);
};
const waitZoom = (z) => p.waitForFunction((zoom) =>
  zoom === 1 ? document.getElementById('screen').parentElement.style.transform === '' :
    Math.abs(new DOMMatrix(getComputedStyle(document.getElementById('screen').parentElement).transform).a - zoom) < 0.0001, z);
const near = (a, b, tolerance = 0.001) => Math.abs(a - b) < tolerance;
const pose = () => p.evaluate(() => {
  const matrix = new DOMMatrix(getComputedStyle(document.getElementById('screen').parentElement).transform);
  return { zoom: matrix.a, x: matrix.e, y: matrix.f };
});
const waitStill = async () => {
  await p.evaluate(() => { window.phoneLastPose = null; });
  await p.waitForFunction(() => {
    const transform = document.getElementById('screen').parentElement.style.transform;
    if (transform !== window.phoneLastPose) {
      window.phoneLastPose = transform;
      window.phonePoseChanged = performance.now();
    }
    return performance.now() - window.phonePoseChanged >= 450;
  });
};
const cdp = await context.newCDPSession(p);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })),
});
const nextFrame = () => p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const beginTouch = async () => {
  const g = await p.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2, span: Math.min(160, innerWidth / 4) }));
  g.points = [[1, g.x - g.span / 2, g.y], [2, g.x + g.span / 2, g.y]];
  await touch('touchStart', [g.points[0]]);
  await touch('touchStart', g.points);
  return g;
};
const moveTouch = async (g, ratio, dx = 0, dy = 0) => {
  g.points = [[1, g.x + dx - g.span * ratio / 2, g.y + dy], [2, g.x + dx + g.span * ratio / 2, g.y + dy]];
  await touch('touchMove', g.points);
  await nextFrame();
};
const pinch = async (ratio) => {
  const g = await beginTouch();
  for (const fraction of [0.25, 0.5, 0.75, 1]) await moveTouch(g, 1 + (ratio - 1) * fraction);
  await touch('touchEnd', [g.points[0]]);
  // The remaining finger must not become a swipe or a tap.
  await touch('touchMove', [[2, g.points[1][1] + 25, g.points[1][2]]]);
  await touch('touchEnd', []);
};
const animatedPinch = async (ratio, target) => {
  const before = await scale();
  const out = target > before;
  await p.evaluate(() => {
    window.phoneZoomSamples = [];
    window.phoneZoomSampling = true;
    const sample = () => {
      if (!window.phoneZoomSampling) return;
      const screen = document.getElementById('screen');
      const room = screen.getBoundingClientRect();
      const viewport = document.getElementById('stagebox').getBoundingClientRect();
      window.phoneZoomSamples.push({
        zoom: new DOMMatrix(getComputedStyle(screen.parentElement).transform).a,
        buffer: document.getElementById('screen-gl')?.width,
        bounded: (room.width <= viewport.width || (room.left <= viewport.left + 2 && room.right >= viewport.right - 2)) &&
          (room.height <= viewport.height || (room.top <= viewport.top + 2 && room.bottom >= viewport.bottom - 2)),
      });
      window.phoneZoomRaf = requestAnimationFrame(sample);
    };
    window.phoneZoomRaf = requestAnimationFrame(sample);
  });
  await pinch(ratio);
  await waitZoom(target);
  const frames = await p.evaluate(() => {
    window.phoneZoomSampling = false;
    cancelAnimationFrame(window.phoneZoomRaf);
    return window.phoneZoomSamples;
  });
  const between = frames.filter((f) => f.zoom > Math.min(before, target) + 0.001 &&
    f.zoom < Math.max(before, target) - 0.001);
  const smooth = new Set(between.map((f) => f.zoom)).size >= 3 &&
    frames.every((f, i) => !i || (out ? f.zoom >= frames[i - 1].zoom : f.zoom <= frames[i - 1].zoom));
  expect(smooth,
  `zoom ${out ? 'in' : 'out'} animates through multiple monotonic intermediate frames`);
  if (!smooth) console.log('zoom samples:', frames.filter((f, i) => !i || f.zoom !== frames[i - 1].zoom));
  expect(frames.every((f) => f.bounded), 'animated camera never exposes a panned room edge');
  expect(new Set(frames.map((f) => f.buffer)).size <= 2,
    'zoom does not resize the WebGL backing store every animation frame');
};
const pointerStream = (events) => p.evaluate((events) => {
  const stage = document.querySelector('.stage');
  const heldStates = [];
  for (const [type, id, x = 400] of events) {
    stage.dispatchEvent(new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, clientX: x, clientY: 180, bubbles: true, cancelable: true,
    }));
    heldStates.push(window.__ff.throttleInfo().heldState);
  }
  return {
    heldStates, count: window.__ff.count(), hash: window.__ff.posHash(), moves: window.__ff.moves(),
  };
}, events);
const subtitle = () => p.evaluate(() => {
  const host = document.getElementById('domsubs');
  const r = host?.getBoundingClientRect();
  return {
    detached: host?.parentElement === document.body,
    bottom: r?.bottom, left: r?.left, right: r?.right, width: r?.width,
    font: host?.firstElementChild?.style.font,
    sizes: [...new Set([...host?.querySelectorAll('.subtitle-glyph') ?? []].map((el) => getComputedStyle(el).fontSize))],
    scale: host ? new DOMMatrix(getComputedStyle(host).transform).a : null,
  };
});
const longCaption = 'Readable captions keep the same size while the player inspects a room, even when a longer sentence wraps across several lines.';
const captionMetrics = async (text) => {
  const loop = await p.evaluate((text) => {
    window.previousCaptionGlyph = document.querySelector('#domsubs .subtitle-glyph');
    window.__ff.clearSubtitles();
    window.__ff.pushSubtitle(text, 'M');
    return window.__ff.throttleInfo().loops;
  }, text);
  await p.waitForFunction(({ loop, ink }) => {
    const glyphs = [...document.querySelectorAll('#domsubs .subtitle-glyph')];
    return window.__ff.throttleInfo().loops > loop &&
      !window.previousCaptionGlyph?.isConnected &&
      glyphs.map((g) => g.lastElementChild.textContent).join('').includes(ink);
  }, { loop, ink: text.replaceAll(' ', '') });
  return p.evaluate((ink) => {
    const host = document.getElementById('domsubs');
    // These assertions measure resting typography, not the separately-tested wave.
    for (const animation of host.getAnimations({ subtree: true })) animation.finish();
    const all = [...host.querySelectorAll('.subtitle-glyph')];
    const start = all.map((g) => g.lastElementChild.textContent).join('').indexOf(ink);
    const glyphs = all.slice(start, start + [...ink].length);
    const box = host.getBoundingClientRect();
    const rects = glyphs.map((g) => g.getBoundingClientRect());
    const lineTops = [...new Set(rects.map((r) => r.top))].sort((a, b) => a - b);
    const rows = [...host.children].map((row) => row.getBoundingClientRect());
    const wordsPerLine = new Map();
    for (const word of host.querySelectorAll('.subtitle-word')) {
      const y = Math.round(word.getBoundingClientRect().top);
      wordsPerLine.set(y, (wordsPerLine.get(y) ?? 0) + 1);
    }
    return {
      fonts: [...new Set(glyphs.map((g) => getComputedStyle(g).fontSize))],
      height: rects[0]?.height,
      bottomGap: innerHeight - Math.max(...rects.map((r) => r.bottom)),
      linePitches: lineTops.slice(1).map((top, i) => top - lineTops[i]),
      messageGap: parseFloat(getComputedStyle(host).rowGap),
      scale: new DOMMatrix(getComputedStyle(host).transform).a,
      complete: start >= 0 && glyphs.length === [...ink].length,
      inside: rects.every((r) => r.left >= box.left && r.right <= box.right &&
        r.top >= box.top && r.bottom <= box.bottom),
      waveInside: glyphs.every((g, i) => {
        const stroke = parseFloat(getComputedStyle(g.firstElementChild).webkitTextStrokeWidth) / 2;
        return g.getAnimations()[0].effect.getKeyframes().every((frame) => {
          const dy = new DOMMatrix(frame.transform).m42;
          return rects[i].top + dy - stroke >= box.top && rects[i].bottom + dy + stroke <= box.bottom;
        });
      }),
      wrapped: [...host.children].some((row) =>
        new Set([...row.querySelectorAll('.subtitle-glyph')].map((g) => Math.round(g.getBoundingClientRect().top))).size > 1),
      visualLines: new Set(rects.map((r) => Math.round(r.top))).size,
      wordsPerLine: [...wordsPerLine.values()],
      waveStarts: [...new Set(glyphs.map((g) =>
        new DOMMatrix(g.getAnimations()[0].effect.getKeyframes()[0].transform).m42))],
      waveDelays: glyphs.map((g) => g.getAnimations()[0]?.effect.getTiming().delay),
      separateRows: rows.every((r, i) => !i || r.top >= rows[i - 1].bottom),
      wholeWords: [...host.querySelectorAll('.subtitle-word')].every((word) =>
        new Set([...word.children].map((g) => Math.round(g.getBoundingClientRect().top))).size === 1),
    };
  }, text.replaceAll(' ', ''));
};

try {
  await p.goto(`${base}?graphics=enhanced`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff);
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await enter(7);
  await p.waitForFunction(() => !document.getElementById('phone-controls').hidden);
  expect(await scale() === 1, 'first room starts standard');
  const chrome = await p.evaluate(() => {
    const root = document.documentElement;
    const stage = getComputedStyle(document.querySelector('.stage'));
    return {
      phone: root.hasAttribute('data-phone'),
      tabletHidden: document.getElementById('touchbar').hidden,
      reserved: root.hasAttribute('data-touchbar'),
      margins: [stage.marginLeft, stage.marginTop],
      buttons: document.querySelectorAll('#phone-controls > button').length,
    };
  });
  expect(chrome.phone && chrome.tabletHidden && !chrome.reserved &&
    chrome.margins.every((m) => m === '0px') && chrome.buttons === 4,
  'phone has four overlay buttons including the fish switch and reserves no bar space');
  for (const [width, height, top, right, bottom, left] of [
    [852, 393, 0, 0, 20, 62],
    [874, 402, 0, 62, 20, 0],
    [956, 440, 0, 0, 20, 62],
    [844, 390, 0, 47, 21, 0],
    [812, 375, 0, 50, 21, 0],
    [568, 320, 0, 0, 0, 0],
    [393, 852, 62, 0, 34, 0],
    [402, 874, 62, 0, 34, 0],
    [390, 844, 47, 0, 34, 0],
    [390, 844, 0, 0, 0, 0],
    [414, 896, 96, 0, 34, 0],
    [375, 812, 50, 0, 34, 0],
    [320, 568, 0, 0, 0, 0],
  ]) {
    await p.setViewportSize({ width, height });
    await p.evaluate(({ top, right, bottom, left }) => {
      for (const [side, value] of Object.entries({ top, right, bottom, left })) {
        document.documentElement.style.setProperty(`--sa-${side}`, `${value}px`);
      }
    }, { top, right, bottom, left });
    const layout = await p.evaluate(() => {
      const ids = ['phone-map', 'phone-more', 'phone-undo'];
      return ids.map((id) => {
        const button = document.getElementById(id);
        const svg = button.querySelector('svg').getBoundingClientRect();
        return { ...button.getBoundingClientRect().toJSON(), iconW: svg.width, iconH: svg.height,
          radius: parseFloat(getComputedStyle(button).borderTopLeftRadius) };
      });
    });
    const [map, more, undo] = layout;
    const corners = width > height && height >= 390;
    const portraitCorners = height > width && width >= 390;
    const edgeFloor = portraitCorners || width > height ? 24 : 16;
    expect(map.left === (corners ? 24 : Math.max(edgeFloor, left + 8)) &&
      more.right === width - (corners ? 24 : Math.max(edgeFloor, right + 8)) &&
      undo.right === more.right &&
      map.top === (portraitCorners ? Math.max(24, (top - 56) / 2) : Math.max(edgeFloor, top + 8)) &&
      undo.bottom === height - (portraitCorners ? 24 : Math.max(edgeFloor, bottom + 8)),
    `${width}x${height}: ${portraitCorners ? 'beside-island row' : corners ? 'edge corners' : 'full safe-area fallback'} places all three controls`);
    expect(layout.every((b) => b.width === 56 && b.height === 56 && b.iconW === 32 && b.iconH === 32 &&
      b.left >= 0 && b.right <= width && b.top >= 0 && b.bottom <= height),
    `${width}x${height}: all targets are 56px with unclipped 32px icons`);
    // A conservative 200px central housing envelope. Browser emulation cannot prove
    // physical device occlusion; the native-device check remains a release gate.
    if (width > height && (left || right)) {
      const housing = {
        left: left ? 0 : width - right, right: left ? left : width,
        top: height / 2 - 100, bottom: height / 2 + 100,
      };
      expect(layout.every((b) => b.right <= housing.left || b.left >= housing.right ||
        b.bottom <= housing.top || b.top >= housing.bottom),
      `${width}x${height}: corners avoid the modeled housing on the ${left ? 'left' : 'right'}`);
    }
    if (portraitCorners) {
      expect(map.right + 8 <= width / 2 - 107 && more.left - 8 >= width / 2 + 107,
        `${width}x${height}: top buttons leave 8px beside a modeled 214px central housing`);
      // Rounded button ink must remain within a 64px rounded display corner.
      const inside = (x, y, radius) =>
        Math.hypot(Math.max(0, 64 - x - radius), Math.max(0, 64 - y - radius)) + radius <= 64;
      expect(inside(map.left, map.top, map.radius) && inside(width - more.right, more.top, more.radius) &&
        inside(width - undo.right, height - undo.bottom, undo.radius),
        `${width}x${height}: all corner buttons still clear the curved glass`);
      expect(undo.left - 8 >= width / 2 + 107,
        `${width}x${height}: low Undo stays beside a modeled 214px home-indicator area`);
    }
    await p.locator('#phone-more').tap();
    const menu = await p.locator('#phone-menu').boundingBox();
    expect(menu && menu.x >= left + 8 && menu.x + menu.width <= width - Math.max(16, right + 8) &&
      menu.y >= Math.max(top + 8, more.bottom + 8) && menu.y + menu.height <= undo.top - 8,
    `${width}x${height}: the menu clears the top/side insets and both larger buttons`);
    for (const button of await p.locator('#phone-menu button').all()) await button.tap({ trial: true });
    expect(true, `${width}x${height}: every overflow action remains reachable, including when scrolling`);
    await p.keyboard.press('Escape');
  }
  await p.setViewportSize({ width: 852, height: 393 });
  await p.evaluate(() => {
    const s = document.documentElement.style;
    s.setProperty('--sa-left', '62px');
    s.setProperty('--sa-right', '12px');
    s.setProperty('--sa-top', '10px');
    s.setProperty('--sa-bottom', '34px');
  });
  const corners = await p.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect().toJSON();
    return { map: box('phone-map'), more: box('phone-more'), undo: box('phone-undo') };
  });
  expect(corners.map.x === 24 && corners.map.y === 24 && corners.more.right === 828 &&
    corners.undo.right === 828 && corners.undo.bottom === 351 &&
    corners.undo.width === 56 && corners.undo.height === 56, '56px corner targets use 24px side margins without losing vertical safe areas');
  await p.locator('#phone-more').tap();
  expect(await p.locator('#phone-menu').isVisible(), 'More opens the four-action menu');
  expect(await p.locator('#phone-menu').evaluate((el) => {
    const menu = el.getBoundingClientRect();
    const more = document.getElementById('phone-more').getBoundingClientRect();
    const undo = document.getElementById('phone-undo').getBoundingClientRect();
    return menu.right === innerWidth - 24 && menu.top >= more.bottom + 8 && menu.bottom <= undo.top - 8;
  }), 'overflow retains the full side inset and stays between the larger More and Undo buttons');
  await p.evaluate(() => { window.phoneKeys = []; });
  await p.touchscreen.tap(400, 200);
  expect(await p.locator('#phone-menu').isHidden() &&
    await p.evaluate(() => window.phoneKeys.length === 0), 'outside tap dismisses the menu without swapping fish');
  await p.locator('#phone-more').tap();
  await p.keyboard.press('Escape');
  expect(await p.locator('#phone-menu').isHidden() &&
    await p.locator('#phone-more').evaluate((el) => document.activeElement === el),
  'Escape closes only the menu and restores keyboard focus');
  const activeBeforeMenu = await p.evaluate(() => window.__ff.state().active);
  await p.keyboard.press('Space');
  await p.locator('#phone-menu').waitFor({ state: 'visible' });
  expect(await p.evaluate(() => window.__ff.state().active) === activeBeforeMenu,
    'keyboard activation of More does not also swap the fish');
  await p.keyboard.press('Escape');
  await p.locator('#phone-more').tap();
  await p.locator('#phone-menu [data-region="16"]').tap();
  await p.locator('#touchopts').waitFor({ state: 'visible' });
  expect(true, 'overflow Options reaches the existing panel action');
  await p.locator('#topt-close').tap();
  await p.locator('#touchopts').waitFor({ state: 'hidden' });

  await p.evaluate(() => { window.phoneKeys = []; });
  await p.evaluate(() => window.__ff.setRenderer('webgl'));
  await p.waitForFunction(() => window.__ff.glActive());
  await animatedPinch(1.375, 1.375);
  expect(near(await scale(), 1.375), 'pinch chooses an arbitrary zoom, not the former two-level toggle');
  expect(await p.evaluate(() => window.phoneKeys.length === 0), 'real pinch and trailing finger emit no movement or swap');
  const framing = await p.evaluate(() => {
    const r = document.getElementById('screen').getBoundingClientRect();
    const v = document.getElementById('stagebox').getBoundingClientRect();
    return {
      full: Math.abs(v.width - innerWidth) <= 1,
      x: r.width <= v.width || (r.left <= v.left + 2 && r.right >= v.right - 2),
      y: r.height <= v.height || (r.top <= v.top + 2 && r.bottom >= v.bottom - 2),
    };
  });
  expect(framing.full && framing.x && framing.y, 'zoom uses the full stage and clamps the visible room edges');
  await p.evaluate(() => window.__ff.talk('little'));
  await p.waitForFunction(() => document.getElementById('domsubs')?.children.length > 0);
  const zoomedSub = await subtitle();
  expect(zoomedSub.detached && Math.abs(zoomedSub.bottom - 359) < 1,
    'enhanced subtitles sit at the screen bottom above the home indicator');
  expect(zoomedSub.scale === 1 && zoomedSub.sizes.length === 1 && zoomedSub.sizes[0] === '20px',
    'enhanced phone captions use a true screen-sized 20px font');
  await animatedPinch(0.8, 1.1);
  const normalSub = await subtitle();
  expect(normalSub.detached && normalSub.width === zoomedSub.width &&
    normalSub.bottom === zoomedSub.bottom && normalSub.font === zoomedSub.font,
  'subtitle position, width and font do not change with camera zoom');
  await pinch(0.5);
  await waitZoom(1);
  const landscapeCaption = await captionMetrics(longCaption);
  expect(landscapeCaption.complete && landscapeCaption.inside && landscapeCaption.waveInside &&
    landscapeCaption.linePitches.length > 0 && landscapeCaption.linePitches.every((pitch) => near(pitch, 26)) &&
    landscapeCaption.bottomGap >= 42 && landscapeCaption.bottomGap <= 46 && landscapeCaption.messageGap === 2,
  `landscape captions use 26px lines near the safe bottom edge (${landscapeCaption.bottomGap}px bottom gap)`);
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/iphone-landscape-captions.png` });

  await p.evaluate(() => {
    for (const name of ['left', 'right', 'top', 'bottom']) document.documentElement.style.removeProperty(`--sa-${name}`);
  });
  const edgeCaption = await captionMetrics('A fresh caption for the safe-area layout check.');
  expect(edgeCaption.bottomGap >= 8 && edgeCaption.bottomGap <= 12 && edgeCaption.waveInside,
    `zero-inset landscape keeps the full wave and outline inside the screen (${edgeCaption.bottomGap}px bottom gap)`);
  await p.waitForFunction(() => {
    const host = document.getElementById('domsubs');
    return host && Math.abs(host.getBoundingClientRect().width - (innerWidth - 176)) < 1;
  });
  expect(await p.evaluate(() => {
    const more = document.getElementById('phone-more').getBoundingClientRect();
    const undo = document.getElementById('phone-undo').getBoundingClientRect();
    const subtitles = document.getElementById('domsubs').getBoundingClientRect();
    const radius = 64, buttonRadius = 14;
    // The button itself is rounded; its transparent bounding-box corner is not ink.
    const inside = (x, y) => [0, 15, 30, 45, 60, 75, 90].every((degrees) => {
      const a = degrees * Math.PI / 180;
      return Math.hypot(radius - x - buttonRadius + buttonRadius * Math.cos(a),
        radius - y - buttonRadius + buttonRadius * Math.sin(a)) <= radius;
    });
    return inside(innerWidth - more.right, more.top) && inside(innerWidth - undo.right, innerHeight - undo.bottom) &&
      subtitles.right <= undo.left - 8;
  }), 'zero cutout insets still clear rounded corners and keep subtitles out of Undo');
  await enter(6);
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  expect(await scale() === 1, 'a new room starts unzoomed without reapplying the previous room zoom');
  await pinch(1.375);
  await waitZoom(1.375);
  await waitStill();
  const beforeSwap = await p.evaluate(() => ({
    active: window.__ff.state().active,
    transform: document.getElementById('screen').parentElement.style.transform,
  }));
  await p.touchscreen.tap(425, 196);
  await p.waitForFunction((active) => window.__ff.state().active !== active, beforeSwap.active);
  await p.waitForFunction((old) => document.getElementById('screen').parentElement.style.transform !== old, beforeSwap.transform);
  expect(near(await scale(), 1.375), 'a normal tap switches fish and retargets the zoomed camera');

  const selectActive = async (which) => {
    await p.keyboard.press(which === 'big' ? '2' : '1');
    await p.waitForFunction((which) => window.__ff.state().active === which && window.__ff.phase() === 'idle', which);
    await waitStill();
  };
  const turnForUndo = async (which) => {
    await selectActive(which);
    const before = await p.evaluate((which) => ({
      which, moves: window.__ff.moves(), right: window.__ff.state()[which].facingRight,
    }), which);
    before.pose = await pose();
    await p.keyboard.press(before.right ? 'ArrowLeft' : 'ArrowRight');
    await p.waitForFunction((n) => window.__ff.moves() === n + 1 && window.__ff.phase() === 'idle', before.moves);
    return before;
  };
  const undoTurn = async (before, keyboard = false) => {
    await selectActive(before.which === 'big' ? 'little' : 'big');
    if (keyboard) await p.keyboard.press('-');
    else await p.locator('#phone-undo').tap();
    await p.waitForFunction((n) => window.__ff.moves() === n && window.__ff.phase() === 'idle', before.moves);
    await waitStill();
    const state = await p.evaluate(() => ({ ...window.__ff.state(), info: document.getElementById('info').textContent }));
    const restored = await pose();
    expect(state.active === before.which && state[before.which].facingRight === before.right &&
      state.info.includes(`active: ${before.which}`) && near(restored.zoom, 1.375) &&
      near(restored.x, before.pose.x, 1) && near(restored.y, before.pose.y, 1),
    `${keyboard ? 'keyboard' : 'corner'} Undo selects and follows the ${before.which} fish whose move was reversed`);
  };
  const bigTurn = await turnForUndo('big');
  const littleTurn = await turnForUndo('little');
  await undoTurn(littleTurn);
  await undoTurn(bigTurn);
  await undoTurn(await turnForUndo('big'), true);

  await p.evaluate(() => { window.phoneKeys = []; });
  await pointerStream([['pointerdown', 41], ['pointercancel', 41]]);
  expect(await p.evaluate(() => window.phoneKeys.length === 0), 'cancelled phone touch never becomes a tap');
  const takeover = await pointerStream([['pointerdown', 41], ['pointermove', 41, 450], ['pointerdown', 42, 550]]);
  expect(takeover.heldStates[1] === 1 && takeover.heldStates[2] === 0,
    'pinch takeover cancels an unprocessed swipe instead of leaving a released move queued');
  await p.waitForFunction((n) => window.__ff.count() > n && window.__ff.phase() === 'idle', takeover.count);
  expect(await p.evaluate((before) => window.__ff.moves() === before.moves &&
    window.__ff.posHash() === before.hash, takeover),
  'the next logic tick dispatches no fish move while both inspection fingers remain down');
  await pointerStream([['pointerup', 41], ['pointerup', 42, 550]]);
  await p.keyboard.down('ArrowRight');
  const physicalStates = await pointerStream([['pointerdown', 61], ['pointermove', 61, 450], ['pointerdown', 62, 550]]);
  expect([1, 2].includes(physicalStates.heldStates[2]), 'pinch cancellation preserves a physical hold of the same arrow');
  await pointerStream([['pointerup', 61], ['pointerup', 62, 550]]);
  await p.keyboard.up('ArrowRight');

  await enter(5);
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  expect(await scale() === 1, 'changing from a zoomed room resets both scale and camera framing');
  const initialHash = await p.evaluate(() => window.__ff.posHash());
  const stepRight = async () => {
    const moves = await p.evaluate(() => window.__ff.moves());
    await pointerStream([['pointerdown', 51], ['pointermove', 51, 440], ['pointerup', 51, 440]]);
    await p.waitForFunction((n) => window.__ff.moves() === n + 1 && window.__ff.phase() === 'idle', moves);
  };
  await pinch(2.2);
  await waitZoom(2.2);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await stepRight();
    await p.locator('#phone-undo').tap();
    await p.waitForFunction((hash) => window.__ff.posHash() === hash && window.__ff.moves() === 0, initialHash);
    await waitStill();
    expect(near(await scale(), 2.2), `corner Undo ${attempt} reverses one move without resetting the chosen zoom`);
  }
  await stepRight();
  await p.waitForFunction(() => window.__ff.canSave());
  const savedHash = await p.evaluate(() => window.__ff.posHash());
  const savedMoves = await p.evaluate(() => window.__ff.moves());
  const choose = async (region) => {
    await p.locator('#phone-more').tap();
    await p.locator(`#phone-menu [data-region="${region}"]`).tap();
  };
  await choose(12);
  await p.waitForFunction(() => window.__ff.hasSave());
  await choose(15);
  await p.waitForFunction(() => window.__ff.moves() === 0 && window.__ff.phase() === 'idle');
  await waitZoom(1);
  expect(true, 'overflow Save and Restart save the run and start a fresh attempt');
  await choose(13);
  await p.waitForFunction((n) => !window.__ff.loading() && !window.__ff.roomLoading() &&
    window.__ff.moves() === n && window.__ff.phase() === 'idle', savedMoves);
  expect(await p.evaluate(() => window.__ff.posHash()) === savedHash, 'overflow Load restores the saved position');

  await enter(33);
  expect(await p.evaluate(() => window.__ff.roomGeom().scale * 15 >= 20), 'MIKRO is readable at standard phone-landscape size');
  await waitZoom(1);
  await pinch(1.5);
  expect(await scale() === 1, 'pinch does not enlarge an already-readable small room');
  await enter(7);
  await waitZoom(1);
  expect(true, 'returning to an eligible room does not zoom automatically');
  await pinch(2.2);
  await waitZoom(2.2);
  await waitStill();
  const followPose = await pose();
  const positionBeforePan = await p.evaluate(() => { window.phoneKeys = []; return window.__ff.posHash(); });
  const inspection = await beginTouch();
  const dx = followPose.x > 0 ? -80 : 80;
  const dy = followPose.y > 0 ? -20 : 20;
  await moveTouch(inspection, 1, dx, dy);
  await waitStill();
  const heldPose = await pose();
  expect(near(heldPose.zoom, 2.2) && near(heldPose.x, followPose.x + dx, 1) &&
    near(heldPose.y, followPose.y + dy, 1), 'two fingers pan the zoomed room without changing zoom');
  await touch('touchEnd', [inspection.points[0]]);
  await touch('touchMove', [[2, inspection.points[1][1] + 30, inspection.points[1][2] - 20]]);
  await waitStill();
  const oneFingerPose = await pose();
  expect(near(oneFingerPose.x, heldPose.x, 1) && near(oneFingerPose.y, heldPose.y, 1),
    'lifting one finger freezes inspection; the remaining finger neither pans nor moves a fish');
  await p.evaluate(() => window.addEventListener('pointerup', () => {
    window.phoneReleaseAt = performance.now();
  }, { once: true }));
  await touch('touchEnd', []);
  const returnFrame = await p.waitForFunction((held) => {
    const m = new DOMMatrix(getComputedStyle(document.getElementById('screen').parentElement).transform);
    return Math.abs(m.e - held.x) > 1 && {
      x: m.e, y: m.f, zoom: m.a, elapsed: performance.now() - window.phoneReleaseAt,
    };
  }, heldPose);
  const returning = await returnFrame.jsonValue();
  expect(returning.elapsed >= 340, 'inspection pauses for about 350ms after the last finger lifts');
  expect(!near(returning.x, followPose.x, 1) && near(returning.zoom, 2.2),
    'releasing both fingers eases back rather than snapping or resetting zoom');
  await waitStill();
  const returned = await pose();
  expect(near(returned.x, followPose.x, 1) && near(returned.y, followPose.y, 1) &&
    await p.evaluate((hash) => window.__ff.posHash() === hash && window.phoneKeys.length === 0, positionBeforePan),
  'the view returns to the active fish without issuing gameplay commands');

  const upperBounce = await beginTouch();
  await moveTouch(upperBounce, 2);
  await p.waitForFunction(() =>
    new DOMMatrix(getComputedStyle(document.getElementById('screen').parentElement).transform).a > 3.02);
  expect(await scale() <= 3.24, 'upper zoom limit stretches with bounded resistance');
  await touch('touchEnd', []);
  await waitZoom(3);
  expect(near(await scale(), 3), 'upper overshoot settles back to 3x on release');
  const lowerBounce = await beginTouch();
  await moveTouch(lowerBounce, 0.25);
  await p.waitForFunction(() =>
    new DOMMatrix(getComputedStyle(document.getElementById('screen').parentElement).transform).a < 0.99);
  expect(await scale() >= 0.92, 'lower zoom limit gives a small, bounded undershoot');
  await touch('touchEnd', []);
  await waitZoom(1);
  expect(await scale() === 1, 'lower overshoot settles to the exact full-room view');
  await pinch(2.2);
  await waitZoom(2.2);

  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.waitForFunction(() => (window.__ff.paintedRoomSig() || '').includes('|ai|'));
  await p.evaluate(() => window.__ff.setRenderer('webgl'));
  await p.waitForFunction(() => window.__ff.glActive());
  const gpu = await p.evaluate(() => {
    const gl = document.getElementById('screen-gl');
    const g = window.__ff.roomGeom();
    return { actual: gl.width, wanted: Math.round(g.cssW * devicePixelRatio * 2.5) };
  });
  expect(gpu.actual === gpu.wanted, 'WebGL uses a stable 2.5x backing bucket for the arbitrary 2.2x view');
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/iphone-landscape.png` });
  await p.evaluate(() => window.__ff.setRenderer('cpu'));
  await p.waitForFunction(() => !window.__ff.glActive());
  expect(near(await scale(), 2.2), 'CPU fallback shares the same arbitrary zoomed camera');
  await p.setViewportSize({ width: 393, height: 852 });
  await p.waitForFunction(() => Math.abs(window.__ff.roomGeom().cssW - document.getElementById('screen').clientWidth) <= 1);
  expect(near(await scale(), 2.2), 'rotation retains zoom for an eligible room');
  await p.evaluate(() => {
    document.documentElement.style.setProperty('--sa-top', '62px');
    document.documentElement.style.setProperty('--sa-bottom', '34px');
  });
  expect(await p.evaluate(() => {
    const map = document.getElementById('phone-map').getBoundingClientRect();
    const more = document.getElementById('phone-more').getBoundingClientRect();
    const undo = document.getElementById('phone-undo').getBoundingClientRect();
    return map.left === 24 && map.top === 24 && more.top === 24 &&
      more.right === innerWidth - 24 && undo.right === more.right &&
      undo.bottom === innerHeight - 24 && map.width === 56 && undo.height === 56;
  }), 'phone browsers get the shared portrait clearance without preview hooks or smaller targets');
  await p.evaluate(() => window.__ff.talk('little'));
  await p.waitForFunction(() => document.getElementById('domsubs')?.children.length > 0);
  expect((await subtitle()).detached, 'AI portrait subtitles are also detached');
  await p.waitForFunction(() => {
    const host = document.getElementById('domsubs');
    return host?.children.length > 0 && host.getAnimations({ subtree: true })
      .every((animation) => animation.playState === 'finished');
  });
  const glyphs = await p.evaluate(() => {
    const host = document.getElementById('domsubs');
    const box = host.getBoundingClientRect();
    const rects = [...host.querySelectorAll('.subtitle-glyph')]
      .filter((el) => el.textContent.trim()).map((el) => el.getBoundingClientRect());
    return {
      visible: rects.length > 0 && rects.every((r) => r.height >= 18 &&
        r.left >= box.left - 1 && r.right <= box.right + 1 &&
        r.top >= box.top && r.bottom <= box.bottom + 1),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      viewport: innerHeight,
    };
  });
  expect(glyphs.visible && glyphs.viewport - glyphs.bottom < 120,
    'settled portrait subtitle glyphs are readable and unclipped above the Undo row');
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/iphone-portrait.png` });
  const shortCaption = 'Clear captions.';
  const aiShort = await captionMetrics(shortCaption);
  const aiLong = await captionMetrics(longCaption);
  expect(aiLong.linePitches.length > 0 && aiLong.linePitches.every((pitch) => near(pitch, 30)) &&
    aiLong.messageGap === 4,
  'portrait retains its 30px line pitch and 4px message spacing');
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/iphone-wrapped-captions.png` });
  const longWord = await captionMetrics('SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious');
  expect([aiShort, aiLong, longWord].every((m) => m.complete && m.inside && m.separateRows &&
    m.fonts.length === 1 && m.fonts[0] === '20px' && m.scale === 1) &&
    aiLong.wrapped && aiLong.wholeWords && longWord.wrapped && !longWord.wholeWords &&
    near(aiShort.height, aiLong.height, 0.1),
  'short captions, long sentences and overlong words remain 20px and wrap without losing glyphs');
  await pinch(0.25);
  await waitZoom(1);
  const aiUnzoomed = await captionMetrics(shortCaption);
  expect(near(aiUnzoomed.height, aiShort.height, 0.1) && aiUnzoomed.fonts[0] === '20px',
    'actual AI glyph height is identical at full-room and zoomed scales');
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.waitForFunction(() => (window.__ff.paintedRoomSig() || '').includes('|enhanced|'));
  const enhancedLong = await captionMetrics(longCaption);
  expect(enhancedLong.complete && enhancedLong.inside && enhancedLong.wrapped &&
    enhancedLong.fonts[0] === '20px' && near(enhancedLong.height, aiShort.height, 0.1),
  'enhanced and AI phone captions have the same fixed size, without the AI shrink');

  // The reported KUFRIK caption used to wrap twice: once at the game's bitmap width,
  // then independently within each row in a phone column only 250px wide.
  await enter(1);
  await p.setViewportSize({ width: 402, height: 874 });
  const tutorialCaption = 'Můžeš nás ovládat kurzorovými šipkami a mezerníkem mezi námi přepínat.';
  const tutorial = await captionMetrics(tutorialCaption);
  expect(tutorial.complete && tutorial.inside && tutorial.wholeWords && tutorial.visualLines <= 3,
    `portrait tutorial flows as at most three complete lines, not five fragments (${tutorial.visualLines})`);
  expect(tutorial.wordsPerLine.every((n) => n >= 2),
    'portrait tutorial balances its lines without leaving a single-word tail');
  expect(tutorial.waveStarts.length === 1 && tutorial.waveStarts[0] === 6,
    `every wrapped source row uses the same gentle downward wave (${tutorial.waveStarts})`);
  expect(tutorial.waveDelays.every((delay, i, all) => !i || delay > all[i - 1]) &&
    tutorial.waveDelays.at(-1) - tutorial.waveDelays[0] <= 800,
  'the phone wave follows reading order across bitmap row breaks within an 800ms reveal');
  expect(await p.evaluate(() => {
    const host = document.getElementById('domsubs');
    const box = host.getBoundingClientRect();
    const undo = document.getElementById('phone-undo').getBoundingClientRect();
    const message = host.firstElementChild;
    return box.left === 16 && box.width === innerWidth - 32 && box.bottom <= undo.top - 8 &&
      host.children.length === 1 && message.children.length > 1;
  }), 'portrait uses the safe screen width above Undo and flows source rows inside one message');
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/iphone-tutorial-captions.png` });

  // Other room dialogue can push the whole message up while we wait. Its internal
  // positions must not change when one of its own source rows expires.
  await p.evaluate(() => {
    window.expiringCaption = [...document.querySelectorAll('#domsubs .subtitle-glyph')].map(glyph => {
      const message = glyph.closest('[data-subtitle-block]');
      const box = glyph.getBoundingClientRect(), origin = message.getBoundingClientRect();
      return { glyph, message, x: box.x - origin.x, y: box.y - origin.y, wave: glyph.getAnimations()[0] };
    });
  });
  await p.waitForFunction(() => window.expiringCaption.some(({ glyph }) =>
    !glyph.isConnected || getComputedStyle(glyph).visibility === 'hidden'));
  const expiryMetrics = await p.evaluate(() => {
    const visualRows = new Map();
    for (const { glyph, y } of window.expiringCaption) {
      const key = Math.round(y), row = visualRows.get(key) ?? [];
      row.push(glyph.isConnected && getComputedStyle(glyph).visibility !== 'hidden');
      visualRows.set(key, row);
    }
    const survivors = window.expiringCaption.filter(({ glyph }) =>
      glyph.isConnected && getComputedStyle(glyph).visibility !== 'hidden');
    const moved = survivors.map(({ glyph, message, x, y }) => {
      const now = glyph.getBoundingClientRect(), origin = message.getBoundingClientRect();
      return { text: glyph.lastElementChild.textContent, dx: now.x - origin.x - x, dy: now.y - origin.y - y };
    }).filter(({ dx, dy }) => Math.abs(dx) >= 0.1 || Math.abs(dy) >= 0.1);
    return { survivors: survivors.length, moved,
      wholeRows: [...visualRows.values()].every(row => row.every(Boolean) || row.every(visible => !visible)),
      sameWaves: survivors.every(({ glyph, wave }) => glyph.getAnimations()[0] === wave),
      states: survivors.map(({ wave }) => wave.playState),
    };
  });
  const still = expiryMetrics.survivors > 0 && expiryMetrics.wholeRows && expiryMetrics.moved.length === 0 &&
    expiryMetrics.sameWaves && expiryMetrics.states.every(state => state === 'finished');
  expect(still, 'whole displayed lines expire together without moving or replaying surviving text');
  if (!still) console.log('expiry metrics:', JSON.stringify(expiryMetrics));
  await captionMetrics(tutorialCaption);
  await p.evaluate(() => {
    window.captionGlyphs = [...document.querySelectorAll('#domsubs .subtitle-glyph')];
    window.captionWaves = window.captionGlyphs.map((g) => g.getAnimations()[0]);
  });
  await p.setViewportSize({ width: 320, height: 568 });
  await p.waitForFunction(() => parseFloat(document.getElementById('domsubs')?.style.width) <= 288);
  expect(await p.evaluate(() => window.captionGlyphs.every((g, i) =>
    g.isConnected && g.getAnimations()[0] === window.captionWaves[i])),
  'phone reflow preserves glyphs and their compositor animations instead of restarting them');
  const narrowTutorial = await captionMetrics(tutorialCaption);
  expect(narrowTutorial.complete && narrowTutorial.inside && narrowTutorial.wholeWords &&
    narrowTutorial.fonts[0] === '20px' && narrowTutorial.visualLines <= 4,
  'a narrow portrait keeps all words readable without inheriting the bitmap row breaks');
  await p.evaluate(() => {
    window.captionGlyphs = [...document.querySelectorAll('#domsubs .subtitle-glyph')];
    window.captionWaves = window.captionGlyphs.map((g) => g.getAnimations()[0]);
  });
  for (const [width, height, lineHeight, gap] of [[852, 393, '26px', '2px'], [320, 568, '30px', '4px']]) {
    await p.setViewportSize({ width, height });
    await p.waitForFunction(({ lineHeight, gap }) => {
      const host = document.getElementById('domsubs');
      const row = host?.querySelector('[data-subtitle-block] > div');
      return row && getComputedStyle(row).lineHeight === lineHeight && getComputedStyle(host).rowGap === gap;
    }, { lineHeight, gap });
    expect(await p.evaluate(() => window.captionGlyphs.every((g, i) =>
      g.isConnected && g.getAnimations()[0] === window.captionWaves[i])),
    `rotation to ${width}x${height} updates subtitle spacing without rebuilding glyphs or waves`);
  }
  await p.evaluate(() => {
    window.__ff.clearSubtitles();
    window.__ff.pushSubtitle('Echo.', 'M');
    window.__ff.pushSubtitle('Echo.', 'M');
  });
  await p.waitForFunction(() => document.querySelectorAll('#domsubs .subtitle-glyph').length === 10);
  expect(await p.evaluate(() => document.getElementById('domsubs').children.length === 2),
    'two identical phone messages on the same tick remain separate blocks');
  await p.evaluate(() => {
    document.documentElement.style.removeProperty('--sa-top');
    document.documentElement.style.removeProperty('--sa-bottom');
  });

  await p.evaluate(() => window.__ff.setGraphics('classic'));
  await p.waitForFunction(() => (window.__ff.paintedRoomSig() || '').includes('|classic|'));
  expect(await p.locator('#domsubs').count() === 0, 'classic keeps baked room subtitles, not the detached layer');
  await p.setViewportSize({ width: 852, height: 393 });
  await enter(2);
  expect(await p.evaluate(() => {
    const map = document.getElementById('phone-map').getBoundingClientRect();
    const more = document.getElementById('phone-more').getBoundingClientRect();
    const undo = document.getElementById('phone-undo').getBoundingClientRect();
    return map.left === 24 && map.top === 24 && more.right === innerWidth - 24 &&
      undo.right === more.right && undo.bottom === innerHeight - 24 &&
      map.width === 56 && undo.height === 56;
  }), 'rotating back to shared landscape keeps 24px corner margins and full-sized targets');
  await p.evaluate(() => window.__ff.speakLine('help2'));
  expect(await p.locator('#phone-more.dialogue-hint-pulse').count() === 1 &&
    await p.locator('#phone-menu').isHidden(), 'Save tutorial highlights More without opening the menu');
  await p.locator('#phone-map').tap();
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await waitZoom(1);
  await p.locator('#phone-controls').waitFor({ state: 'hidden' });
  expect(await p.locator('#phone-controls').isHidden(), 'map navigation removes camera and corner controls');
  await enter(7);
  await waitZoom(1);
  await pinch(1.375);
  await waitZoom(1.375);
  await enter(5);
  expect(await scale() === 1, 'room entry resets zoom even after returning through the map');
  await pinch(1.375);
  await waitZoom(1.375);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff);
  await enter(7);
  expect(await scale() === 1, 'relaunch resets the zoom preference');
  expect(errors.length === 0, `no page errors (${errors.join('; ')})`);
} catch (e) {
  ok = false;
  console.error(e);
  console.error('phone state:', await p.evaluate(() => ({
    room: window.__ff?.roomNum(), geometry: window.__ff?.roomGeom(),
    transform: document.getElementById('screen')?.parentElement.style.transform,
    viewport: [innerWidth, innerHeight], pacing: window.__ff?.throttleInfo(),
    pointers: window.phonePointers,
  })));
  if (process.env.FF_UI_SHOTS) await p.screenshot({ path: `${process.env.FF_UI_SHOTS}/iphone-failure.png` });
} finally {
  await browser.close();
}
console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
