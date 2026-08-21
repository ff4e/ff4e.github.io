/**
 * Record a short gameplay clip of the real, running game — `out/clip.mp4` and `out/clip.gif`.
 *
 *     node tools/capture-clip.mjs                                # PYRAMIDA, 20 s, English
 *     node tools/capture-clip.mjs --room 12 --seconds 25
 *     node tools/capture-clip.mjs --room UTES --lang cz --speed 2 --gif-seconds 8
 *
 * Every channel a link gets posted to wants a clip, and twenty seconds of a room being
 * solved says more than any paragraph beside it. The point of recording it from the built
 * site rather than from a screen capture is that it cannot drift: what it shows is what a
 * visitor gets on that commit, at the graphics tier the site actually defaults to, with
 * the dialogue and the panel and the timing the browser really produces.
 *
 * The moves are the room's OWN recorded solution, played through `solvemode` — the same
 * move-string `test/solutions.test.ts` replays headlessly, driven through the real
 * `tryStep`, so nothing here is a staged path that the game does not otherwise take. Two
 * rooms are deliberately poor choices: `corridor` and `windoze` are the pair the solvability
 * net marks KNOWN_DIVERGENT, and their replays are not expected to end well.
 *
 * `solvemode` is dev-gated, so the run arms `ff.devEnabled` — which also reveals the dev
 * bar and the perf HUD. Those are hidden again with a stylesheet injected before the app
 * boots, so the layout is sized for the player's view and not for a taller one that then
 * had chrome removed.
 *
 * Outputs land in `out/` (git-ignored) because the clip is a promotional asset with a
 * short shelf life, not something the site serves. The MP4 is what most places want; the
 * GIF is for the few that take nothing else, and is deliberately shorter and smaller —
 * a GIF of the full clip at full width is tens of megabytes for the same twenty seconds.
 *
 * Requires ffmpeg on PATH (`brew install ffmpeg`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { appReady } from './ui-lib.mjs';
import { buildApp, root, startPreview, stopPreview, urlFor } from './preview-server.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const ROOM = arg('room', 'PYRAMIDA');
const SECONDS = Number(arg('seconds', 20));
const SPEED = Number(arg('speed', 1));
const LANG = arg('lang', 'en');
const GIF_SECONDS = Number(arg('gif-seconds', 8));
const OUT = join(root, 'out');
const RAW = join(OUT, 'clip-raw');

// 967x600 is the stage+panel in native pixels (src/app/layout.ts); x1.5 fills the frame
// exactly, so the recording has no letterbox to crop back off afterwards.
const WIDTH = 1450;
const HEIGHT = 900;

const log = (m) => console.log(`[clip] ${m}`);

const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed: ${r.error?.message ?? r.status}`);
};

const kB = (f) => `${Math.round(statSync(f).size / 1024)} kB`;

/** Record the raw webm Playwright produces, and return its path. */
async function record() {
  rmSync(RAW, { recursive: true, force: true });
  mkdirSync(RAW, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: RAW, size: { width: WIDTH, height: HEIGHT } },
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ff.devEnabled', '1');
    } catch {}
    const hideChrome = () => {
      const s = document.createElement('style');
      s.textContent = 'body.dev .controls, body.dev #info, body.dev #perfhud { display: none !important; }';
      document.head.appendChild(s);
    };
    if (document.head) hideChrome();
    else document.addEventListener('DOMContentLoaded', hideChrome);
  });

  const page = await ctx.newPage();
  const recordStart = Date.now();
  page.setDefaultTimeout(60000);
  await page.goto(urlFor(Number(process.env.FF_UI_PORT)), { waitUntil: 'domcontentloaded' });
  await appReady(page);

  // The splash is gated on a real click (browsers will not start audio without one) and
  // the two movies behind it are their own thing, so start and skip through to the map.
  // Everything before the map is trimmed off the clip below rather than recorded around,
  // because the timing of a movie skip is not worth making deterministic for a video.
  await page.click('#intro-start');
  await page.waitForFunction(() => window.__ff.screen() === 'intro');
  await page.evaluate(() => window.__ff.skipIntro()); // logo -> intro
  await page.evaluate(() => window.__ff.skipIntro()); // intro -> map
  await page.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
  // Czech is the default, and the clip is for an English-speaking audience by default.
  await page.evaluate((l) => window.__ff.setLang(l), LANG);
  const trim = (Date.now() - recordStart) / 1000;

  // Open on the world map for a moment: it is where a visitor starts, and it is the one
  // screen that says "72 rooms" without a word of text.
  await page.waitForTimeout(2500);

  // The room is named rather than numbered on the command line, and the dev dropdown is
  // already the canonical `NN — JMENO (English)` listing, so resolve it there instead of
  // importing the room table into a plain-node script.
  const roomNum = await page.evaluate((want) => {
    const sel = /** @type {HTMLSelectElement} */ (document.getElementById('room'));
    if (/^\d+$/.test(want)) return Number(want);
    const opt = [...sel.options].find((o) => o.textContent.toUpperCase().includes(` ${want} (`));
    return opt ? Number(opt.value) : null;
  }, ROOM.toUpperCase());
  if (!roomNum) throw new Error(`no room named ${ROOM}`);

  await page.evaluate((n) => window.__ff.enterRoomAwait(n), roomNum);
  await page.waitForFunction(
    (n) => window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.roomNum() === n,
    roomNum,
  );
  await page.waitForTimeout(1200);

  const refused = await page.evaluate((s) => window.__ff.solveRoom(s), SPEED);
  if (refused) throw new Error(`solvemode refused to start: ${refused.error} — ${refused.detail}`);

  const deadline = Date.now() + SECONDS * 1000;
  let status = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    status = await page.evaluate(() => window.__ff.solveStatus());
    if (status?.abort) throw new Error(`solvemode aborted: ${status.abort.detail}`);
    if (status && !status.running) break; // the room was won before the clip ran out
  }
  log(`solve ${status?.won ? 'won' : 'still running'} at ${status?.idx ?? '?'}/${status?.total ?? '?'} moves`);
  await page.waitForTimeout(800);

  const video = page.video();
  await ctx.close(); // flushes the video file
  await browser.close();
  const path = await video.path();
  return { raw: path ?? join(RAW, readdirSync(RAW).find((f) => f.endsWith('.webm'))), trim };
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  let ownServer = false;
  if (!process.env.FF_UI_PORT) {
    await buildApp(log);
    process.env.FF_UI_PORT = String(await startPreview({ log }));
    ownServer = true;
  }
  log(`serving ${urlFor(Number(process.env.FF_UI_PORT))}`);

  let raw;
  let trim = 0;
  try {
    ({ raw, trim } = await record());
  } finally {
    if (ownServer) stopPreview();
  }

  const webm = join(OUT, 'clip.webm');
  renameSync(raw, webm);
  rmSync(RAW, { recursive: true, force: true });
  log(`trimming the boot and the two intro movies: first ${trim.toFixed(1)}s`);

  const mp4 = join(OUT, 'clip.mp4');
  ffmpeg(['-ss', String(trim), '-i', webm, '-vf', 'scale=1160:-2:flags=lanczos', '-r', '30', '-c:v', 'libx264',
    '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);

  // Two-pass palette: a global palette on this art (flat cel colours) is the difference
  // between a clean GIF and a dithered mess several times the size.
  const palette = join(OUT, 'clip-palette.png');
  const gifFilters = `fps=12,scale=720:-2:flags=lanczos`;
  ffmpeg(['-ss', String(trim), '-t', String(GIF_SECONDS), '-i', webm, '-vf', `${gifFilters},palettegen=stats_mode=diff`, palette]);
  const gif = join(OUT, 'clip.gif');
  ffmpeg(['-ss', String(trim), '-t', String(GIF_SECONDS), '-i', webm, '-i', palette,
    '-lavfi', `${gifFilters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`, '-loop', '0', gif]);
  rmSync(palette, { force: true });

  log(`${webm} ${kB(webm)}`);
  log(`${mp4} ${kB(mp4)}`);
  log(`${gif} ${kB(gif)} (${GIF_SECONDS}s)`);
}

await main();
