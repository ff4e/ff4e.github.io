/**
 * UI test: TV / 10-foot (console) presentation, loaded with `?tv` (see
 * src/platform/tv.ts). Verifies the plain-web build is only altered under the TV
 * flag: the `body.tv` class is set, the PC control panel is hidden, the stage
 * reflows inside a title-safe overscan margin (equal insets on every edge), and
 * the intro's pointer/keyboard hints are relabelled with controller wording.
 */
import { withApp } from './ui-lib.mjs';

// TV mode (?tv). First-run so the intro overlay + its hint are present to inspect.
await withApp(
  async ({ p, expect }) => {
    // The TV body class gates all the 10-foot CSS (bigger controller overlays).
    const hasTv = await p.evaluate(() => document.body.classList.contains('tv'));
    expect(hasTv, 'body.tv class is set in TV mode');

    // The PC control panel is not rendered on a console (stage reflows full width).
    const panelHidden = await p.evaluate(() => {
      const el = document.getElementById('panel');
      if (!el) return true;
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || el.offsetParent === null;
    });
    expect(panelHidden, '#panel control panel is hidden in TV mode');

    // Title-safe overscan: the stage box sits inside a real margin on every edge
    // (≈5% inset). Measure the stagebox against the viewport.
    const safe = await p.evaluate(() => {
      const box = document.getElementById('stagebox');
      if (!box) return null;
      const r = box.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        left: r.left,
        right: vw - r.right,
        top: r.top,
        bottom: vh - r.bottom,
        vw,
        vh,
      };
    });
    expect(safe !== null, 'stagebox present');
    if (safe) {
      // A margin of at least ~3% of the viewport on every side (5% inset target,
      // minus rounding); the tight axis equals the inset, the loose axis exceeds it.
      const minX = safe.vw * 0.03;
      const minY = safe.vh * 0.03;
      expect(safe.left >= minX && safe.right >= minX, `horizontal title-safe margin (L=${safe.left|0} R=${safe.right|0})`);
      expect(safe.top >= minY && safe.bottom >= minY, `vertical title-safe margin (T=${safe.top|0} B=${safe.bottom|0})`);
    }

    // The intro's click/Esc hint is relabelled for the controller (no pointer on a TV).
    const introText = await p.evaluate(() => ({
      hint: document.getElementById('intro-hint')?.textContent ?? '',
      start: document.getElementById('intro-start')?.textContent ?? '',
    }));
    expect(!/click|esc/i.test(introText.hint), `intro hint has no mouse/keyboard wording ("${introText.hint}")`);
    expect(/Ⓐ|Ⓑ/.test(introText.hint), 'intro hint uses a controller glyph');
    expect(/Ⓐ/.test(introText.start), 'intro start button uses a controller glyph');
  },
  { query: 'tv', firstRun: true },
);
