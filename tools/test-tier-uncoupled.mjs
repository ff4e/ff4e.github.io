/**
 * UI test: the two art tiers are independent at LOAD time.
 *
 * The `ai` tier used to fetch — and WAIT for — the enhanced art of every room it
 * entered, 0.3-2.1 MB a room that the AI compositor does not draw. This probe pins the
 * three things that change, in the order they matter:
 *
 *  1) An `ai` room entry requests nothing under `/enhanced/<JMENO>/`.
 *  2) It still gets its AI art (`aiRoomLoaded()`), so 1 is not "the room broke".
 *  3) When the AI art is NOT available, the enhanced art is fetched after all — the
 *     tier is not self-sufficient (ZX, cheats, a room with no AI set) and
 *     ensureEnhancedFallback() is what covers that. This is the assertion that stops
 *     1 from being satisfiable by simply never loading enhanced art again.
 *
 * The oracle for 1 and 3 is the REQUEST LOG, which is unusual for this suite and is the
 * point: what changed here is *what is fetched*, not what is drawn. What is drawn is
 * covered by tools/capture-digest.mjs across the two revisions (identical), and 2 reads
 * `__ff.aiRoomLoaded()` — never canvas width, which varies by room size.
 *
 * PRVNI is used for 1/2 because it is small (472 kB enhanced / 1 228 kB AI) and has a
 * complete AI set. KOSTE is used for 3, so the two halves cannot contaminate each
 * other through the enhanced cache — an entry that legitimately loaded PRVNI's art
 * would otherwise make the second half pass for the wrong reason.
 *
 * `allowErrors` covers the 404s this probe SERVES ON PURPOSE in part 3. It is scoped to
 * that one message rather than being a blanket flag, so a real error alongside it still
 * fails the probe.
 */
import { waitFrames, waitRoom, withApp } from './ui-lib.mjs';

await withApp(
  async ({ p, expect }) => {
    // Every request the page makes, in order. Recorded rather than routed: routing
    // changes what the browser does, and the first assertion is about what it does
    // unprompted.
    const urls = [];
    p.on('request', (r) => urls.push(r.url()));
    const asked = (frag) => urls.filter((u) => u.includes(frag)).length;

    // === 1 + 2: an `ai` room entry loads the AI art and not the enhanced art ===
    urls.length = 0;
    await p.evaluate(() => window.__ff.enterRoomAwait(1));
    await waitRoom(p, 0);
    // Give any load that was merely not AWAITED a chance to show up: the bug being
    // pinned would otherwise pass simply by being slower than the assertion.
    await waitFrames(p, 30);

    expect(asked('/enhanced-ai/PRVNI/') > 0, 'ai tier: PRVNI AI art was requested');
    expect(asked('/enhanced/PRVNI/') === 0, `ai tier: PRVNI enhanced art was NOT requested (saw ${asked('/enhanced/PRVNI/')})`);
    expect(await p.evaluate(() => window.__ff.aiRoomLoaded()), 'ai tier: PRVNI presents its AI art');

    // === 3: with no AI art, the enhanced art is fetched on demand ===
    // 404 the whole AI set for KOSTE. A 404 is the "absent" case the renderer already
    // handles by falling back a tier — which is exactly the state that needs the
    // enhanced art, and the state in which the old code got it for free.
    await p.route('**/enhanced-ai/KOSTE/**', (route) => route.fulfill({ status: 404, body: '' }));

    urls.length = 0;
    await p.evaluate(() => window.__ff.enterRoomAwait(6));
    await waitRoom(p, 0);
    await waitFrames(p, 30);

    expect(!(await p.evaluate(() => window.__ff.aiRoomLoaded())), 'no-AI-art: KOSTE has no AI art to present');
    expect(asked('/enhanced/KOSTE/') > 0, 'no-AI-art: KOSTE enhanced art WAS requested on demand');
    expect(await p.evaluate(() => window.__ff.enhancedLoaded()), 'no-AI-art: KOSTE falls back to loaded enhanced art');
  },
  { graphics: 'ai', allowErrors: /404 \(Not Found\)/ },
);
