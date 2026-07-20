/**
 * Shared harness for the Playwright UI tests: launches headless Chromium (audio
 * autoplay allowed), opens the app, collects console errors, and exits non-zero
 * if any assertion fails or the page logged an error. Deterministic, no AI.
 */
import { chromium } from 'playwright';

export async function withApp(fn, opts = {}) {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push('PE:' + e.message));
  // By default, boot as a returning player (skip the first-run intro): the intro
  // is a full-screen overlay that swallows input, so tests that drive keys/mouse
  // must not sit behind it. The intro test opts into first-run via { firstRun: true }.
  if (!opts.firstRun) {
    await p.addInitScript(() => {
      try {
        const raw = localStorage.getItem('ff.options');
        const o = raw ? JSON.parse(raw) : {};
        o.introSeen = true; // merge, so a test's persisted volume/subtitle settings survive
        localStorage.setItem('ff.options', JSON.stringify(o));
      } catch {
        /* storage unavailable */
      }
    });
  }
  // Probes that read pixels off #screen (the CPU 2D canvas) must pin the CPU
  // backend: it is the deterministic oracle surface. In WebGL mode the room is
  // presented on the stacked #screen-gl canvas and #screen is left blank, so a
  // getImageData read there would see nothing. WebGL parity is covered separately
  // by the test-gl-* probes (byte-exact vs this CPU path).
  if (opts.cpu) {
    await p.addInitScript(() => {
      try {
        localStorage.setItem('ff.renderer', 'cpu');
      } catch {
        /* storage unavailable */
      }
    });
  }
  // The tuning chrome (room dropdown + fit/renderer/saver controls) and the one-key
  // dev toggles (E/R/P/F/G) are gated behind the developer pane, which is off for
  // players and enabled with Ctrl+Alt+D (persisted as ff.devEnabled). Enable it for
  // automation so selectOption('#room') and the dev hotkeys work; set it in
  // localStorage before boot so it survives reloads (test-options reloads mid-run).
  await p.addInitScript(() => {
    try {
      localStorage.setItem('ff.devEnabled', '1');
    } catch {
      /* storage unavailable */
    }
  });
  const port = process.env.FF_UI_PORT ?? '5173';
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

  let ok = true;
  const expect = (cond, msg) => {
    if (!cond) ok = false;
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  };
  try {
    await fn({ p, expect });
  } catch (e) {
    ok = false;
    console.log('  FAIL threw: ' + (e?.message ?? e));
  }
  if (errs.length) {
    ok = false;
    console.log('  console errors:', errs);
  }
  await b.close();
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

/** Wait until a fish move settles back to the idle phase. */
export async function idle(p) {
  await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 5000 });
}
