/**
 * Record a video of what a player sees when art fails to load.
 *
 * Evidence for the asset-resilience series (#64-#69), not a test: nothing here asserts,
 * and it is not part of the gate. It drives the real game through the real failure paths
 * with Playwright's video recorder running, and captions each scene so the recording
 * explains itself without someone narrating it.
 *
 *   node tools/record-failures.mjs [out.mp4]
 *
 * Serving is delegated to tools/preview-server.mjs — the same production build and the
 * same per-run free port as `npm run test:ui`, so this can never end up recording another
 * worktree's dev server on 5173.
 */
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { buildApp, startPreview, stopPreview, urlFor } from './preview-server.mjs';

const OUT = resolve(process.argv[2] ?? 'failures.mp4');
const SIZE = { width: 1280, height: 720 };
const log = (m) => console.log(`[record] ${m}`);

/** Put a caption on screen. Injected into the page so it is burned into the video. */
async function say(p, title, sub = '') {
  await p.evaluate(
    ([t, s]) => {
      let el = document.getElementById('__cap');
      if (!el) {
        el = document.createElement('div');
        el.id = '__cap';
        el.style.cssText =
          'position:fixed;left:0;right:0;top:0;z-index:9999;padding:10px 16px;' +
          'background:#0b0b12e8;color:#cdd;font:15px/1.45 system-ui,sans-serif;' +
          'border-bottom:1px solid #334;pointer-events:none;text-align:center';
        document.body.appendChild(el);
      }
      el.innerHTML = `<b style="color:#8cf">${t}</b>${s ? ` — <span style="color:#9ab">${s}</span>` : ''}`;
    },
    [title, sub],
  );
}

const beat = (p, ms = 1600) => p.waitForTimeout(ms);

await buildApp(log);
const port = await startPreview({ log });
const videoDir = mkdtempSync(join(tmpdir(), 'ff4e-video-'));
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: SIZE,
  recordVideo: { dir: videoDir, size: SIZE },
});
const p = await ctx.newPage();

// A returning player: the first-run intro is a full-screen video and would fill the
// recording with something that is not the subject.
await p.addInitScript(() => {
  try {
    const o = JSON.parse(localStorage.getItem('ff.options') || '{}');
    o.introSeen = true;
    localStorage.setItem('ff.options', JSON.stringify(o));
    localStorage.setItem('ff.graphics', 'ai');
    // Deliberately NOT enabling the developer pane: this is what a player's screen
    // looks like, and the dev bar would sit behind the captions as noise. The
    // scenarios below drive the game through `window.__ff` instead.
  } catch {
    /* storage unavailable */
  }
});

try {
  // ── 1. A room whose AI art fails ────────────────────────────────────────────
  // SCHODY's manifest is aborted for longer than the retry budget, so this is the
  // failure retry cannot paper over: the room really does come up one tier down.
  let left = 4; // the initial request + 2 retries, + 1 of headroom
  await p.route('**/enhanced-ai/SCHODY/**', async (r) => {
    if (left > 0) {
      left--;
      await r.abort('connectionfailed');
    } else {
      await r.continue().catch(() => {});
    }
  });

  await p.goto(urlFor(port), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff !== undefined, null, { timeout: 60000 });
  await say(p, 'The game is set to AI-upscaled art', 'starting from the world map');
  await beat(p, 2200);

  await say(p, 'Entering a room whose AI art will not load', 'the network drops every request for it');
  await p.evaluate(() => window.__ff.enterRoomAwait(5));
  await p.waitForFunction(() => window.__ff.artFailShown(), null, { timeout: 60000 });
  await beat(p, 1600);

  await say(
    p,
    'The game stops and says so',
    'it does NOT quietly draw the room in lower-quality art — a downgrade the player cannot see and did not choose',
  );
  await beat(p, 4600);

  await say(p, '“Try again” — and the failure was never remembered', 'so it really refetches');
  await beat(p, 1600);
  await p.click('#art-fail-retry');
  await p.waitForFunction(() => window.__ff.aiRoomLoaded() && !window.__ff.artFailShown(), null, { timeout: 60000 });
  await beat(p, 900);
  await say(p, 'Recovered', 'the room opens in the art that was asked for — no reload, no restart');
  await beat(p, 3400);

  // ── 2. The world map's own art failing ──────────────────────────────────────
  await say(p, 'Next: the world map', 'its hi-res art is blocked entirely');
  await beat(p, 1800);
  await p.route('**/data/Menu/*_ai.webp', (r) => r.abort('connectionfailed'));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff !== undefined, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__ff.artFailShown(), null, { timeout: 60000 });
  await beat(p, 1400);
  await say(p, 'Same rule for the map', 'held, not quietly swapped for the 1998 art under an “AI” setting');
  await beat(p, 4200);

  // ── 3. Boot itself failing ──────────────────────────────────────────────────
  await say(p, 'Last: a failure with nothing left to retry', 'a core file is missing at boot');
  await beat(p, 2200);
  await p.route('**/data/Menu/mapa-0.BMP', (r) => r.fulfill({ status: 404, body: '' }));
  // Everything under the art tiers is cut off too, so nothing on the screen that
  // follows could have come from the pipeline it is reporting on.
  await p.route('**/enhanced/**', (r) => r.abort('connectionfailed'));
  await p.route('**/enhanced-ai/**', (r) => r.abort('connectionfailed'));
  await p.goto(urlFor(port), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForFunction(() => document.getElementById('fatal')?.hidden === false, null, { timeout: 60000 });
  await beat(p, 1000);
  await say(p, 'The failure screen', 'the parrot is inlined in the page — with the whole art pipeline blocked, it still draws');
  await beat(p, 5200);
} finally {
  await p.close(); // flushes the video
  const src = await p.video()?.path();
  await ctx.close();
  await browser.close();
  stopPreview();

  if (src) {
    try {
      // webm out of Playwright; mp4 so it plays anywhere without a codec argument.
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT]);
      log(`wrote ${OUT}`);
    } catch {
      const fallback = OUT.replace(/\.mp4$/, '.webm');
      renameSync(src, fallback);
      log(`ffmpeg unavailable — wrote ${fallback}`);
    }
  }
  rmSync(videoDir, { recursive: true, force: true });
}
