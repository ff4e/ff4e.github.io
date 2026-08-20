/**
 * UI test: a room launched from the world map shows the ORIGINAL parchment, on the map.
 *
 * The 1998 game blits Menu/loading.BMP at (227,160) on the map when a room launches
 * (UMain.pas:1489-1493): doAkce:=daRun, the map repaints with RTable zeroed (fully unlit,
 * no room balls), the clicked room's name plaque over that, and the parchment over that —
 * and only then does Spust() run the blocking load. Delphi is single-threaded, so the
 * parchment sits on the map for the whole wait. The port used to flip `screen` to 'room'
 * synchronously instead, blacking the stage for the 17-27s a cold entry costs on a slow
 * link, with a full-screen overlay over the black.
 *
 * THE ORACLE IS PIXELS, and it is EXACT in BOTH tiers: the parchment is an opaque
 * pre-composited rectangle blitted with no colour key and no scaling, so the region of
 * #screen during a launch must equal the shipped file byte for byte — the BMP at 640x480,
 * loading_ai.webp at 2560x1920. A state-only check would keep passing with the blit
 * deleted, because `mapLaunching()` would still report a launch.
 *
 * The seam gets its own check, and it has to be made off the ASSET rather than off the
 * screen, because the pixels an opaque blit covers are by definition not on screen to
 * compare against. loading_ai.webp's border band is measured against BOTH map base layers
 * at those coordinates: it must match the dark one and not the lit one (4.84 against
 * mapa-0_ai, 9.77 against mapa-1_ai, measured in-page by this probe), which is the x4 form
 * of the 0.02/7.54 a one-pixel border of the native art measures, and pins the rectangle's
 * placement as well as the layer it belongs over.
 *
 * The room's .ffr is gated with p.route so the launch stays on screen long enough to read,
 * i.e. exactly the window the old code spent black. The gate is a switch rather than a
 * standing delay because only some of the probe's entries want it.
 *
 * Sections: 1 the faithful blit, byte-exact, and no overlay over it; 2 no black frame
 * between the map and the room, sampled every frame; 3 the entries with NO map to keep
 * still explain themselves; 4 an instant (cached) launch flashes nothing; 5 the same blit
 * in `classic`, which shares the faithful map path with `enhanced` but must be shown to;
 * 6 the `ai` tier's own upscale, and its seam.
 */
import { budget, waitFrames, withApp } from './ui-lib.mjs';

/** kresli(Obr,Loading,227,160,192,161,0,0) — UMain.pas:1489. */
const PX = 227;
const PY = 160;
const PW = 192;
const PH = 161;

/** The room to launch. Unsolved on a fresh profile, so a map click really would launch it. */
const ROOM = 1;

/** Packed for p.evaluate — the page has no access to the constants above. */
const RECT = [PX, PY, PW, PH];

/**
 * Compare #screen's parchment rectangle against the art the tier is supposed to blit.
 *
 * BYTE-EXACT in both tiers, which is what makes this an oracle rather than a plausibility
 * check: the faithful path blits Menu/loading.BMP with no colour key and no scaling, and
 * the ai path drawImage()s loading_ai.webp at 1:1 into the x4 backing store with smoothing
 * off. Either way the on-screen rectangle IS the file. Deleting the blit leaves the map
 * showing through and every channel of it disagrees.
 *
 * Scale-aware: the faithful map draws into a 640x480 backing store and the ai one into
 * 2560x1920, so which file to expect (and where to read) comes from the canvas width
 * rather than from an assumption.
 */
const COMPARE_RECT = async ([PX, PY, PW, PH]) => {
  const cv = document.getElementById('screen');
  const s = cv.width / 640;
  const got = cv
    .getContext('2d', { willReadFrequently: true })
    .getImageData(PX * s, PY * s, PW * s, PH * s).data;

  let want;
  if (s === 1) {
    // The shipped BMP, decoded from the same bytes the game loads.
    const d = new Uint8Array(await (await fetch('/data/Menu/loading.BMP')).arrayBuffer());
    const dv = new DataView(d.buffer);
    const off = dv.getUint32(10, true);
    const w = dv.getInt32(18, true);
    const hRaw = dv.getInt32(22, true);
    const h = Math.abs(hRaw);
    const palStart = 14 + dv.getUint32(14, true);
    const rowSize = (w + 3) & ~3;
    want = { w, h, rgb: new Uint8ClampedArray(w * h * 3) };
    for (let row = 0, o = 0; row < h; row++) {
      const src = off + (hRaw > 0 ? h - 1 - row : row) * rowSize;
      for (let x = 0; x < w; x++) {
        const pl = palStart + d[src + x] * 4;
        want.rgb[o++] = d[pl + 2];
        want.rgb[o++] = d[pl + 1];
        want.rgb[o++] = d[pl];
      }
    }
  } else {
    const bmp = await createImageBitmap(await (await fetch('/data/Menu/loading_ai.webp')).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    want = { w: bmp.width, h: bmp.height, rgb: new Uint8ClampedArray((px.length / 4) * 3) };
    for (let i = 0, o = 0; i < px.length; i += 4) {
      want.rgb[o++] = px[i];
      want.rgb[o++] = px[i + 1];
      want.rgb[o++] = px[i + 2];
    }
  }

  let diff = 0;
  for (let i = 0, o = 0; i < got.length; i += 4) {
    for (let c = 0; c < 3; c++) if (got[i + c] !== want.rgb[o++]) diff++;
  }
  return { scale: s, width: cv.width, art: [want.w, want.h], diff, total: PW * s * PH * s * 3 };
};

/**
 * Sample every frame: is #screen showing anything at all, which screen is up, and does
 * the control panel arrive with the room or before it?
 *
 * Every frame, because both defects here are a frame or two wide. The first was one frame
 * at the start and then HELD — enterRoom() blacked #screen and the room draw only landed
 * when its assets did. The second was purely transient: the handover used to be applied
 * AFTER the frame's draw, so drawPanel() put the panel column back into the layout while
 * #screen still held the map, and the map jumped ~90px left with no room under it for a
 * frame (enhanced) or two (ai). A before/after check sails through both.
 *
 * `panelEarly` counts frames where the panel is in the layout but no room frame has been
 * painted yet. "Painted" is read off the canvas rather than the state flags — the map
 * draws at its own backing width, so the first frame at a DIFFERENT width is the first
 * frame the room is really on screen. That width is taken from the first ENABLED frame
 * that is still on the map, not from when this is installed: the sampler is installed
 * from inside a room, whose canvas is a different size again.
 */
const SAMPLER = () => {
  window.__blk = { black: 0, frames: 0, screens: [], on: false, panelEarly: 0, mapW: 0, sawRoom: false };
  const step = () => {
    requestAnimationFrame(step);
    if (!window.__blk.on || !window.__ff) return;
    const cv = document.getElementById('screen');
    if (!cv || !cv.width) return;
    if (!window.__blkG) window.__blkG = cv.getContext('2d', { willReadFrequently: true });
    const s = window.__ff.screen();
    const list = window.__blk.screens;
    if (list[list.length - 1] !== s) list.push(s);
    window.__blk.frames++;
    if (s === 'map' && !window.__blk.mapW) window.__blk.mapW = cv.width;
    if (s === 'room' && window.__blk.mapW && cv.width !== window.__blk.mapW) window.__blk.sawRoom = true;
    const panelUp = getComputedStyle(document.getElementById('panelcol')).display !== 'none';
    if (panelUp && !window.__blk.sawRoom) window.__blk.panelEarly++;
    // A GRID of rows, strided within each — a full-width read every frame at x4 is the one
    // thing here that could perturb what it measures.
    for (let f = 1; f <= 7; f++) {
      const row = window.__blkG.getImageData(0, Math.floor((cv.height * f) / 8), cv.width, 1).data;
      for (let i = 0; i < row.length; i += 4 * 9) {
        if (row[i] > 16 || row[i + 1] > 16 || row[i + 2] > 16) return;
      }
    }
    window.__blk.black++;
  };
  requestAnimationFrame(step);
};

/**
 * The upscaled parchment's one-native-pixel border band against each of the two map base
 * layers at the same coordinates.
 *
 * This is the briefing's own fact, at x4: the parchment is a pre-composited rectangle with
 * the DARK map layer baked into its border (0.02 against mapa-0 and 7.54 against mapa-1
 * over a one-pixel border of the native art). So the band must agree with mapa-0_ai and disagree with
 * mapa-1_ai — which is what pins the rectangle to the right place AND confirms it belongs
 * over the unlit map a launch puts up. Decoded from the shipped assets in the page, because
 * the pixels under an opaque blit are by definition not on screen to read.
 */
const BORDER_VS_LAYERS = async ([PX, PY, PW, PH, S]) => {
  const bmp = async (f) => createImageBitmap(await (await fetch(`/data/Menu/${f}`)).blob());
  const cut = async (img, x, y, w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  };
  const w = PW * S;
  const h = PH * S;
  const par = await cut(await bmp('loading_ai.webp'), 0, 0, w, h);
  const band = (other) => {
    let tot = 0;
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= S && y >= S && x < w - S && y < h - S) continue;
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) tot += Math.abs(par[i + c] - other[i + c]);
        n += 3;
      }
    }
    return tot / n;
  };
  const at = async (f) => cut(await bmp(f), PX * S, PY * S, w, h);
  return { dark: band(await at('mapa-0_ai.webp')), lit: band(await at('mapa-1_ai.webp')) };
};

await withApp(
  async ({ p, expect }) => {
    // Room entry needs the .ffr, so gating that alone stalls a launch without touching the
    // map's own assets — the parchment has to be readable while the map is still what is
    // being drawn. A switch, not a standing delay: the reboots below want boot to be quick.
    let hold = 0;
    await p.route('**/data/Graphic/*.ffr', async (route) => {
      if (hold) await new Promise((r) => setTimeout(r, hold));
      await route.continue();
    });
    /** Arm a launch of ROOM from the map and wait until the parchment frame is up. */
    const launch = async () => {
      // Braces, not an expression body: p.evaluate AWAITS a returned promise, and this one
      // does not settle until the room takes the stage — which is the thing being measured.
      await p.evaluate((n) => {
        window.__ff.enterRoom(n);
      }, ROOM);
      await p.waitForFunction(() => window.__ff.mapLaunching() !== null);
      await waitFrames(p, 3);
    };

    console.log('1. the parchment is blitted on the map, byte for byte');
    expect(await p.evaluate(() => window.__ff.parchmentReady()), 'the parchment art loaded at boot');
    // The original's load is BLOCKING — Spust runs inside the timer handler, so no message
    // is dispatched until the room is up. The map's own hover is the cheapest reachable
    // proof of that: the corner buttons light under the cursor on any other map frame, and
    // must not while the parchment is on it.
    //
    // The CONTROL is taken first, here, on a map that has not launched anything yet — the
    // same cursor lighting the same corner — without which a guard that did nothing would
    // pass the negative below too. First rather than after the launch because the launch
    // leaves the game in a room, and coming back to the map for it made this flake.
    //
    // The corner pixel is FOUND rather than assumed, because the mask is shipped art. Three
    // things have to hold for the point to prove anything: it is well INSIDE its region (the
    // cursor lands on a CSS-scaled canvas, so an outermost pixel rounds off it), it is not
    // the Exit corner (unwired on the web — it deliberately does not light), and #screen is
    // the topmost element there (the dev bar covers the top-left one in this environment).
    const corner = await p.evaluate(() => {
      const r = document.getElementById('screen').getBoundingClientRect();
      const solid = (x, y) => {
        const a = window.__ff.mapCorner(x, y);
        if (!a || a === 'exit') return null;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) if (window.__ff.mapCorner(x + dx, y + dy) !== a) return null;
        const cx = r.left + ((x + 0.5) * r.width) / 640;
        const cy = r.top + ((y + 0.5) * r.height) / 480;
        return document.elementFromPoint(cx, cy)?.id === 'screen' ? a : null;
      };
      for (let y = 4; y < 476; y++) for (let x = 4; x < 636; x++) {
        const a = solid(x, y);
        if (a) return { x, y, a };
      }
      return null;
    });
    expect(corner !== null, `the map has a corner button to hover (${JSON.stringify(corner)})`);
    /**
     * Move the real cursor onto that corner and report what the map made of it.
     *
     * `wantLit` is not an assertion but a WAIT policy, and it is here because the two uses
     * are asymmetric. A corner lighting is an event: it arrives when the browser delivers
     * the move, which on a loaded machine is not within any fixed number of frames — so the
     * positive case waits for it. A corner NOT lighting cannot be waited for at all, so the
     * negative case settles for a few frames and then reads. Sampling both on a fixed wait
     * is what made this flake.
     */
    const hoverCorner = async (wantLit) => {
      const box = await p.evaluate(() => {
        const r = document.getElementById('screen').getBoundingClientRect();
        return { left: r.left, top: r.top, w: r.width, h: r.height };
      });
      await p.mouse.move(box.left + box.w / 2, box.top + box.h / 2);
      await p.mouse.move(box.left + ((corner.x + 0.5) * box.w) / 640, box.top + ((corner.y + 0.5) * box.h) / 480);
      if (wantLit) {
        await p.waitForFunction(() => window.__ff.mapHover() !== null, null, { timeout: budget(2000) }).catch(() => {});
      } else {
        await waitFrames(p, 4);
      }
      return p.evaluate(() => window.__ff.mapHover());
    };
    expect((await hoverCorner(true)) !== null, `the ${corner.a} corner lights under the cursor with no launch running`);
    // ...and off it again, so the reading during the launch cannot be a stale hover.
    await p.evaluate(() => {
      const r = document.getElementById('screen').getBoundingClientRect();
      window.__mid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const mid = await p.evaluate(() => window.__mid);
    await p.mouse.move(mid.x, mid.y);
    await p.waitForFunction(() => window.__ff.mapHover() === null, null, { timeout: budget(2000) });
    expect((await p.evaluate(() => window.__ff.mapHover())) === null, 'the corner goes dark when the cursor leaves');
    hold = 8000;
    await launch();
    expect(
      (await p.evaluate(() => window.__ff.screen())) === 'map',
      'the map is still the screen while the room loads (daRun, not a black stage)',
    );
    expect(!(await p.evaluate(() => window.__ff.loadingVisible())), 'no full-screen overlay over the map');
    const shot = await p.evaluate(COMPARE_RECT, RECT);
    expect(shot.scale === 1, `the faithful map draws at 640x480 (backing store ${shot.width})`);
    expect(
      shot.art[0] === PW && shot.art[1] === PH,
      `the shipped art is ${PW}x${PH} (got ${shot.art.join('x')})`,
    );
    expect(
      shot.diff === 0,
      `the rectangle at (${PX},${PY}) IS Menu/loading.BMP (${shot.diff} of ${shot.total} channels differ)`,
    );
    expect((await hoverCorner(false)) === null, 'the map ignores the cursor while the parchment is up');
    await p.waitForFunction(() => window.__ff.screen() === 'room', null, { timeout: budget(12000) });
    expect(
      (await p.evaluate(() => window.__ff.mapLaunching())) === null,
      'the launch is over once the room is on screen',
    );

    console.log('2. the stage is never black between the map and the room');
    await p.evaluate(SAMPLER);
    await p.keyboard.press('Escape'); // back to the map
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    hold = 4000;
    await p.evaluate(() => {
      window.__blk.on = true;
    });
    await launch();
    await p.waitForFunction(() => window.__ff.screen() === 'room', null, { timeout: budget(12000) });
    await waitFrames(p, 3);
    const blk = await p.evaluate(() => {
      window.__blk.on = false;
      return window.__blk;
    });
    expect(blk.frames > 20, `the sampler saw the transition (${blk.frames} frames)`);
    expect(blk.black === 0, `no black frame from the click to the room (${blk.black} of ${blk.frames})`);
    expect(
      blk.screens.join('>') === 'map>room',
      `the stage went straight from the map to the room (${blk.screens.join('>')})`,
    );
    // The control panel is a LAYOUT change — it pushes the stage sideways — so a frame of
    // it over a map that has not been replaced yet reads as a flinch, not as a transition.
    // It must arrive on the frame the room does, which is what running the handover before
    // the draw dispatch buys (see tickMapLaunch's call site in loop()).
    expect(
      blk.panelEarly === 0,
      `the control panel appears WITH the room, not before it (${blk.panelEarly} of ${blk.frames} frames had the panel over the map)`,
    );

    console.log('3. an entry with NO map to keep still explains itself');
    // From inside a room there is nothing to hold, so this route keeps the overlay it always
    // had — with the room's own name on it, which is the whole message there.
    hold = 8000;
    await p.evaluate(() => {
      window.__ff.enterRoom(12);
    });
    await p.waitForFunction(() => window.__ff.loadingVisible());
    const msg = await p.evaluate(() => document.getElementById('loading-msg').textContent);
    const cls = await p.evaluate(() => document.getElementById('loading').className);
    expect(/Loading .+…/.test(msg), `the overlay names the room ("${msg}")`);
    expect(cls.includes('inroom'), 'the overlay is in its room-entry mode, not the boot splash');
    expect(
      (await p.evaluate(() => window.__ff.mapLaunching())) === null,
      'no parchment for an entry that never had the map on screen',
    );
    await p.waitForFunction(() => window.__ff.screen() === 'room' && !window.__ff.roomLoading(), null, {
      timeout: budget(12000),
    });

    console.log('4. an instant (cached) launch flashes nothing');
    // The property LOADING_DELAY_MS was hard-won for (PR #10, #24): a room that is ready in
    // a few ms must not flash a spinner at the player. This route protects it structurally
    // rather than by timing — a launch off the map never calls beginRoomLoadingUi at all,
    // so there is no armed overlay to race — and that is exactly what is asserted here, on
    // an entry with nothing left to fetch: room 1's assets landed in section 1.
    //
    // Sampled EVERY frame, for the same reason the black check is: a flash is by definition
    // a state that is gone by the time you ask about it afterwards.
    hold = 0;
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    await p.evaluate(() => {
      window.__flash = { seen: 0, frames: 0, on: true };
      const step = () => {
        requestAnimationFrame(step);
        if (!window.__flash.on || !window.__ff) return;
        window.__flash.frames++;
        if (window.__ff.loadingVisible()) window.__flash.seen++;
      };
      requestAnimationFrame(step);
    });
    await p.evaluate((n) => {
      window.__ff.enterRoom(n);
    }, ROOM);
    await p.waitForFunction(() => window.__ff.screen() === 'room', null, { timeout: budget(12000) });
    await waitFrames(p, 3);
    const flash = await p.evaluate(() => {
      window.__flash.on = false;
      return window.__flash;
    });
    expect(flash.frames > 5, `the sampler saw the cached entry (${flash.frames} frames)`);
    expect(
      flash.seen === 0,
      `a cached launch never shows the loading overlay (${flash.seen} of ${flash.frames} frames)`,
    );

    console.log('5. the classic tier blits the same faithful rectangle');
    // classic and enhanced share the faithful map path (worldMap.render → the native BMPs),
    // so this is the same blit — but "the parchment is right in all three tiers" is a claim
    // about what is on screen, and the cheapest honest way to make it is to look.
    hold = 8000;
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    await p.evaluate(() => window.__ff.setGraphics('classic'));
    await p.waitForFunction(() => window.__ff.graphics() === 'classic' && window.__ff.mapPresented());
    await launch();
    expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'the map is still the screen in the classic tier');
    const shotClassic = await p.evaluate(COMPARE_RECT, RECT);
    expect(shotClassic.scale === 1, `the classic map draws at 640x480 (backing store ${shotClassic.width})`);
    expect(
      shotClassic.diff === 0,
      `the classic rectangle at (${PX},${PY}) IS Menu/loading.BMP ` +
        `(${shotClassic.diff} of ${shotClassic.total} channels differ)`,
    );
    await p.waitForFunction(() => window.__ff.screen() === 'room', null, { timeout: budget(12000) });

    console.log('6. the ai tier draws the upscaled parchment, seamlessly');
    // Switched in place rather than by reload: withApp pins the tier with an init script, so
    // a reload would put `enhanced` straight back. The map fetches its ai art the moment the
    // tier is on the map screen (beginMapArt), which is exactly what is wanted here.
    hold = 0;
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__ff.screen() === 'map');
    await p.evaluate(() => window.__ff.setGraphics('ai'));
    await p.waitForFunction(() => window.__ff.aiMapLoaded() && window.__ff.mapPresented());
    hold = 8000;
    await launch();
    expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'the map is still the screen in the ai tier');
    const shotAi = await p.evaluate(COMPARE_RECT, RECT);
    expect(shotAi.scale === 4, `the ai map draws at 2560x1920 (backing store ${shotAi.width})`);
    expect(
      shotAi.art[0] === PW * 4 && shotAi.art[1] === PH * 4,
      `the upscaled art is ${PW * 4}x${PH * 4} (got ${shotAi.art.join('x')})`,
    );
    expect(
      shotAi.diff === 0,
      `the rectangle at (${PX * 4},${PY * 4}) IS loading_ai.webp (${shotAi.diff} of ${shotAi.total} channels differ)`,
    );
    const layers = await p.evaluate(BORDER_VS_LAYERS, [PX, PY, PW, PH, 4]);
    // Measured on the shipped assets: 4.84 against the dark layer, 9.77 against the lit one.
    expect(
      layers.dark < layers.lit * 0.75,
      `the upscaled parchment's border is the DARK map layer, in place ` +
        `(${layers.dark.toFixed(2)} vs mapa-0_ai, ${layers.lit.toFixed(2)} vs mapa-1_ai)`,
    );
    await p.waitForFunction(() => window.__ff.screen() === 'room', null, { timeout: budget(12000) });

    console.log('7. a launch that throws cannot strand the player');
    // tickMapLaunch() is the one thing in loop() that STARTS a room, and loop() reschedules
    // itself on its last statement — so an exception escaping that path takes the game's
    // clock with it, and a launch swallows input, leaving a parchment that can never be
    // dismissed. Everywhere else this code is reached from an event handler, where a throw
    // costs that handler's turn and nothing more.
    //
    // Poisons the environment rather than the app: `select.value = String(num)` is a real
    // DOM write on the launch path, so redefining that property throws exactly where a
    // freak failure would. Last, and it puts the property back, because everything after
    // it would inherit a broken room picker.
    hold = 0;
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    const loops0 = await p.evaluate(() => window.__ff.throttleInfo().loops);
    await p.evaluate((n) => {
      const el = document.getElementById('room');
      Object.defineProperty(el, 'value', {
        set() { throw new Error('injected: the room picker blew up'); },
        get() { return String(n); },
        configurable: true,
      });
      // Caught, not awaited: the promise now REJECTS on this path (it used to hang, which
      // is what wedged an earlier version of this diagnostic), and an unhandled rejection
      // would fail the probe on its own.
      window.__ff.enterRoom(n).catch(() => {});
    }, ROOM);
    await waitFrames(p, 12);
    const after = await p.evaluate(() => ({
      loops: window.__ff.throttleInfo().loops,
      launching: window.__ff.mapLaunching(),
      screen: window.__ff.screen(),
    }));
    await p.evaluate(() => {
      delete document.getElementById('room').value; // back to the prototype's accessor
    });
    expect(
      after.launching === null,
      `a launch that throws ends instead of hanging (mapLaunching ${after.launching})`,
    );
    expect(
      after.loops > loops0 + 5,
      `the game loop survived it (${after.loops - loops0} iterations after the throw)`,
    );

    console.log('8. an overlay that commits mid-launch cannot strand the player');
    // An armed launch waits for drawMap() to set `painted`, and drawMap() is the only
    // thing that sets it — so a launch armed while the map stops being drawn would wait
    // forever, with the input guards swallowing every way out. The window is one frame,
    // but it is reachable: openCredits() and showLegImage() both commit AFTER an await.
    //
    // Warm the credits first so openCredits() commits synchronously, then arm the launch
    // and commit it in the same tick — the exact interleaving, made deterministic.
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    await p.evaluate(async () => {
      await window.__ff.openCredits();
    });
    await p.waitForFunction(() => window.__ff.mapOverlay() === 'credits');
    await p.evaluate(() => window.__ff.closeMapOverlay());
    await p.waitForFunction(() => window.__ff.mapOverlay() === 'none' && window.__ff.mapPresented());
    await p.evaluate((n) => {
      window.__ff.enterRoom(n).catch(() => {});
      window.__ff.openCredits(); // already loaded, so this commits before the next frame
    }, ROOM);
    await p
      .waitForFunction(() => window.__ff.mapLaunching() === null, null, { timeout: budget(8000) })
      .catch(() => {});
    expect(
      (await p.evaluate(() => window.__ff.mapLaunching())) === null,
      'a launch whose map is taken away still resolves instead of hanging',
    );
    expect(
      (await p.evaluate(() => window.__ff.screen())) === 'room',
      'it falls back to the ordinary entry, which is what this route did before',
    );
  },
  // Section 7 injects a throw into the room launch and asserts the game recovers from it.
  // The recovery path logs the exception (roomLaunch.ts tickMapLaunch), which is the
  // behaviour being tested — so those messages are expected. There are TWO because the
  // injected failure is a write to the room picker, and the recovery ALSO touches the
  // picker (abortMapLaunch points it back at the room still on screen): the second log is
  // the guard around that reporting doing its job, which is the property that keeps a DOM
  // failure from costing the frame loop. Every other console error still fails.
  { cpu: true, graphics: 'enhanced', allowErrors: /^(room entry failed:|room launch failed:|failed to report a failed room launch:)/ },
);
