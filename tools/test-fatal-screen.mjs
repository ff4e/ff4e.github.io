/**
 * UI test: the failure screen appears, and it does not need the thing that failed.
 *
 * The screen this asserts on is the one the player sees when the game could not boot —
 * so it is reached the way a player reaches it: by breaking a critical asset and letting
 * boot fail. Not by calling `showFatal()` through a debug hook, which would prove the
 * markup exists and nothing about whether the failure path still runs.
 *
 * Two things are asserted, and the second is the one that matters:
 *
 *  1. The screen comes up, with its heading, its message and a working Reload button.
 *  2. **The parrot is drawn even though the asset pipeline is broken.** It is inlined in
 *     index.html as a data URI precisely so that a screen reporting "art would not load"
 *     is not itself blank. This probe blocks EVERY request under /enhanced/ as well as
 *     the critical asset, so a sprite fetched from public/ could not possibly render —
 *     if the bird has size and paints here, it is genuinely independent of the pipeline.
 *
 * The oracle is the PAINTED PIXELS, read back off a canvas: `getComputedStyle` would
 * report the background-image the CSS asks for whether or not the data URI decodes, and
 * that decode is exactly the thing that could silently break (a truncated base64 blob in
 * index.html looks perfectly fine in the source).
 */
import { launchBrowser, exitProbe, gotoApp } from './ui-lib.mjs';

const b = await launchBrowser();
const p = await b.newPage({ viewport: { width: 1200, height: 640 } });

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

// Boot's critical assets: without the panel or the world map the game is unplayable, and
// boot.ts calls showFatal rather than degrading. 404 the map so boot really does fail.
await p.route('**/data/Menu/mapa-0.BMP', (r) => r.fulfill({ status: 404, body: '' }));
// ...and cut off the art tier entirely, so nothing on this screen could have come from it.
await p.route('**/enhanced/**', (r) => r.abort('connectionfailed'));
await p.route('**/enhanced-ai/**', (r) => r.abort('connectionfailed'));

await p.addInitScript(() => {
  try {
    const o = JSON.parse(localStorage.getItem('ff.options') || '{}');
    o.introSeen = true;
    localStorage.setItem('ff.options', JSON.stringify(o));
  } catch { /* storage unavailable */ }
});

try {
  await gotoApp(p).catch(() => {}); // boot is EXPECTED to fail here
  // No explicit timeout: gotoApp sets WAIT_BACKSTOP as the page default before it
  // navigates, so it is already in force even though the boot it awaits is the thing
  // failing here. (test/uiProbeWaits.test.ts enforces that rule.)
  await p.waitForFunction(() => document.getElementById('fatal')?.hidden === false);

  expect(true, 'a broken critical asset brings up the failure screen');

  // 1. The text-only content the screen has always had is intact.
  const text = await p.evaluate(() => ({
    heading: document.querySelector('#fatal h1')?.textContent?.trim() ?? '',
    msg: document.getElementById('fatal-msg')?.textContent?.trim() ?? '',
    reload: document.getElementById('fatal-reload')?.offsetParent !== null,
  }));
  expect(text.heading.length > 0, `the heading is shown ("${text.heading}")`);
  expect(text.msg.length > 0, 'the message is shown');
  expect(text.reload, 'the Reload button is visible and clickable');

  // 2. The parrot: laid out, and actually PAINTED.
  const bird = await p.evaluate(async () => {
    const el = document.getElementById('fatal-bird');
    const first = el?.querySelector('i');
    if (!el || !first) return { present: false };
    const r = el.getBoundingClientRect();
    const url = getComputedStyle(first).backgroundImage;
    const m = /url\("(data:image\/png;base64,[^"]+)"\)/.exec(url);
    if (!m) return { present: true, w: r.width, h: r.height, inline: false };
    // Decode the data URI the CSS actually resolved to, and count the pixels it paints.
    // A blank or undecodable sprite is the failure mode worth catching, and it is
    // invisible to every other check.
    const img = new Image();
    img.src = m[1];
    try {
      await img.decode();
    } catch {
      return { present: true, w: r.width, h: r.height, inline: true, decoded: false };
    }
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) opaque++;
    return {
      present: true, w: r.width, h: r.height, inline: true, decoded: true,
      nw: img.naturalWidth, nh: img.naturalHeight, opaque, total: d.length / 4,
    };
  });

  expect(bird.present, 'the failure screen has a creature');
  expect(bird.inline === true, 'its art is inlined in the page, not fetched');
  expect(bird.w > 0 && bird.h > 0, `it takes up space (${bird.w}x${bird.h})`);
  expect(bird.decoded === true, 'the inlined PNG decodes');
  expect(bird.nw === 45 && bird.nh === 30, `it is the 45x30 sprite (${bird.nw}x${bird.nh})`);
  // Not just "an image" — an image with a parrot in it. A transparent or blank PNG
  // would satisfy every check above.
  const filled = bird.opaque / bird.total;
  expect(filled > 0.1 && filled < 0.95, `it draws a sprite, not a blank or a slab (${(filled * 100).toFixed(0)}% opaque)`);

  // The animation is CSS-only, so it keeps running with no JS and no assets.
  const anim = await p.evaluate(() => {
    const layers = [...document.querySelectorAll('#fatal-bird i')];
    if (layers.length < 2) return { name: 'none', layers: layers.length };
    const cs = layers.map((l) => getComputedStyle(l));
    return {
      name: cs[0].animationName,
      timing: cs[0].animationTimingFunction,
      inline: cs.every((c) => /^url\("data:/.test(c.backgroundImage)),
      layers: layers.length,
      // Distinct images: two layers showing the SAME frame would animate nothing.
      distinct: cs[0].backgroundImage !== cs[1].backgroundImage,
    };
  });
  expect(anim.name !== 'none' && anim.name.length > 0, `it animates without JS (animation: ${anim.name})`);
  expect(anim.inline === true, "the second frame is inlined too, so the flap survives a dead network");
  // step-end is what makes it CUT between frames. Without it opacity interpolates and
  // the parrot cross-fades, which the game never does.
  // `step-end` computes to `steps(1)` — same function, and browsers report the
  // normalised form. Both spellings are accepted; anything else means it interpolates.
  expect(
    anim.timing === 'step-end' || anim.timing === 'steps(1)' || anim.timing === 'steps(1, end)',
    `frames cut rather than cross-fade (timing: ${anim.timing})`,
  );
  expect(anim.distinct === true, 'the two layers hold different frames');

  // EXACTLY ONE frame visible, at every point in the cycle.
  //
  // The frames are sprites with holes, so two layers both visible at once shows the
  // old beak through the new frame's transparent gaps — 16 px of ghost that looks
  // like nothing in particular. The animation is SEEKED rather than watched, so this
  // samples the whole cycle deterministically instead of racing it.
  const ghost = await p.evaluate(() => {
    const layers = [...document.querySelectorAll('#fatal-bird i')];
    const anims = layers.map((l) => l.getAnimations()[0]).filter(Boolean);
    if (anims.length < 2) return { seekable: false };
    const bad = [];
    // Every 80 ms tick of the 2400 ms cycle, plus a nudge either side of each flip.
    for (let t = 0; t <= 2400; t += 40) {
      for (const a of anims) a.currentTime = t;
      const o = layers.map((l) => Number(getComputedStyle(l).opacity));
      const visible = o.filter((v) => v > 0.01).length;
      if (visible !== 1) bad.push(`${t}ms:[${o.join(',')}]`);
    }
    for (const a of anims) a.play();
    return { seekable: true, bad };
  });
  expect(ghost.seekable === true, 'the flap is a real animation the page can seek');
  expect(
    ghost.bad?.length === 0,
    `exactly one frame is visible throughout the cycle${ghost.bad?.length ? ` — ${ghost.bad.slice(0, 3).join(' ')}` : ''}`,
  );
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
}

await b.close().catch(() => {});
console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
