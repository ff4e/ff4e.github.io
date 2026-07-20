/**
 * UI test: lip-sync. While a fish's voice plays, its head cycles the hl_mluvi
 * mouth frames (0/5/6); both click-to-talk (UTES) and scripted dialogue (PRVNI)
 * animate the talking head.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  // Click-to-talk on UTES.
  await p.selectOption('#room', '7');
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.waitForTimeout(300);
  await p.evaluate(() => window.__ff.talk('little'));
  const heads = new Set();
  for (let i = 0; i < 40; i++) {
    heads.add(await p.evaluate(() => window.__ff.heads().little));
    await p.waitForTimeout(80);
  }
  expect(heads.has(5) || heads.has(6), `UTES click-talk shows an open-mouth frame (saw ${[...heads].sort()})`);

  // Scripted dialogue on PRVNI.
  await p.selectOption('#room', '1');
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  const h2 = new Set();
  for (let i = 0; i < 120; i++) {
    const s = await p.evaluate(() => ({ l: window.__ff.heads().little, b: window.__ff.heads().big }));
    h2.add(s.l);
    h2.add(s.b);
    await p.waitForTimeout(80);
  }
  expect(h2.has(5) || h2.has(6), `PRVNI scripted dialogue animates a head (saw ${[...h2].sort()})`);
});
