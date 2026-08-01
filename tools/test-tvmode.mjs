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

    // The picture is drawn full-bleed: title-safe applies to text and controller
    // chrome, not the image. A 4:3 room is already pillarboxed on a 16:9 panel, so
    // insetting it as well threw away another 10% of both dimensions for nothing.
    // It must therefore reach the top and bottom edges, and be centred horizontally.
    // Measured against the stage's own container, not the window: the automation
    // harness leaves the developer bar visible, and that chrome is not part of the
    // area the picture is allowed to use.
    const safe = await p.evaluate(() => {
      const box = document.getElementById('stagebox');
      const row = box?.parentElement;
      if (!box || !row) return null;
      const r = box.getBoundingClientRect();
      const c = row.getBoundingClientRect();
      return {
        left: r.left - c.left,
        right: c.right - r.right,
        top: r.top - c.top,
        bottom: c.bottom - r.bottom,
        vw: c.width,
        vh: c.height,
      };
    });
    expect(safe !== null, 'stagebox present');
    if (safe) {
      // Fills the constrained axis edge to edge (a couple of px for rounding).
      expect(
        safe.top <= 2 && safe.bottom <= 2,
        `picture reaches the top and bottom edges (T=${safe.top | 0} B=${safe.bottom | 0})`,
      );
      // Pillarboxed by aspect ratio, but symmetric — never off-centre.
      expect(
        Math.abs(safe.left - safe.right) <= 2,
        `picture is centred horizontally (L=${safe.left | 0} R=${safe.right | 0})`,
      );
      // The remaining side margins are aspect ratio alone, so the picture must be as
      // wide as filling the height allows — no additional inset hiding in there.
      const usedH = (safe.vh - safe.top - safe.bottom) / safe.vh;
      expect(usedH >= 0.99, `picture uses the full height (${(usedH * 100) | 0}%)`);
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
