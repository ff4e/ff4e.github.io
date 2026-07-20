/**
 * UI test: the briefcase demo (KUFRIK) — skip + music. The 'kufrik' music starts
 * with the demo and *persists* after it ends (InitKufrDemo/DoneKufrDemo), and the
 * demo is skippable by clicking or pressing Escape (zrus_kufr).
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  async function startDemo() {
    await p.evaluate(() => window.__ff.enterRoomAwait(2)); // KUFRIK
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
    await p.evaluate(() => window.__ff.startCutscene());
    await p.waitForFunction(() => window.__ff.cutsceneActive(), { timeout: 5000 });
  }

  // 1) The looping 'kufrik' music starts with the demo.
  await startDemo();
  await p.waitForFunction(() => window.__ff.music() === 'kufrik', { timeout: 20000 }).catch(() => {});
  expect((await p.evaluate(() => window.__ff.music())) === 'kufrik', "the 'kufrik' music plays during the demo");

  // 2) A click skips the demo, and the music keeps playing afterward.
  await p.evaluate(() =>
    document.getElementById('screen').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })),
  );
  await p.waitForFunction(() => !window.__ff.cutsceneActive(), { timeout: 5000 }).catch(() => {});
  expect(!(await p.evaluate(() => window.__ff.cutsceneActive())), 'clicking skips the demo');
  await p.waitForTimeout(300);
  expect((await p.evaluate(() => window.__ff.music())) === 'kufrik', 'the music keeps playing after the demo is skipped');

  // 3) Escape also skips the demo.
  await startDemo();
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !window.__ff.cutsceneActive(), { timeout: 5000 }).catch(() => {});
  expect(!(await p.evaluate(() => window.__ff.cutsceneActive())), 'Escape skips the demo');
  expect((await p.evaluate(() => window.__ff.music())) === 'kufrik', 'the music still plays after an Escape skip');

  // 4) The idle-chatter timer does NOT accrue during the demo, so the fish don't
  // immediately "call you" the moment it ends (StdKecej sync).
  await startDemo();
  await p.waitForTimeout(2000); // ~25 ticks of demo
  const info = await p.evaluate(() => window.__ff.chatterInfo());
  const cnt = await p.evaluate(() => window.__ff.count());
  expect(
    info !== null && cnt - info.last < 12,
    `the idle-chatter timer stays synced during the demo (elapsed ${info ? cnt - info.last : 'n/a'} ticks)`,
  );
  await p.evaluate(() => window.__ff.skipCutscene()); // clean up the running demo
});
