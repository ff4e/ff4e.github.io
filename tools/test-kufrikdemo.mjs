/**
 * UI test: the briefcase demo (KUFRIK) — skip + music. The 'kufrik' music starts
 * with the demo and *persists* after it ends (InitKufrDemo/DoneKufrDemo), and the
 * demo is skippable by clicking or pressing Escape (zrus_kufr).
 */
import { tickSleep, waitRoom, waitTicks, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {

  async function startDemo() {
    await p.evaluate(() => window.__ff.enterRoomAwait(2)); // KUFRIK
    await waitRoom(p, 0);
    await p.evaluate(() => window.__ff.startCutscene());
    await p.waitForFunction(() => window.__ff.cutsceneActive());
  }

  // 1) The looping 'kufrik' music starts with the demo.
  await startDemo();
  await p.waitForFunction(() => window.__ff.music() === 'kufrik').catch(() => {});
  expect((await p.evaluate(() => window.__ff.music())) === 'kufrik', "the 'kufrik' music plays during the demo");

  // 2) A click skips the demo, and the music keeps playing afterward.
  await p.evaluate(() =>
    document.getElementById('screen').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })),
  );
  await p.waitForFunction(() => !window.__ff.cutsceneActive()).catch(() => {});
  expect(!(await p.evaluate(() => window.__ff.cutsceneActive())), 'clicking skips the demo');
  await tickSleep(p, 4);
  expect((await p.evaluate(() => window.__ff.music())) === 'kufrik', 'the music keeps playing after the demo is skipped');

  // 3) Escape also skips the demo.
  await startDemo();
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !window.__ff.cutsceneActive()).catch(() => {});
  expect(!(await p.evaluate(() => window.__ff.cutsceneActive())), 'Escape skips the demo');
  expect((await p.evaluate(() => window.__ff.music())) === 'kufrik', 'the music still plays after an Escape skip');

  // 4) The idle-chatter timer does NOT accrue during the demo, so the fish don't
  // immediately "call you" the moment it ends (StdKecej sync).
  await startDemo();
  await waitTicks(p, await p.evaluate(() => window.__ff.count()), 25); // 25 ticks of demo
  const info = await p.evaluate(() => window.__ff.chatterInfo());
  const cnt = await p.evaluate(() => window.__ff.count());
  expect(
    info !== null && cnt - info.last < 12,
    `the idle-chatter timer stays synced during the demo (elapsed ${info ? cnt - info.last : 'n/a'} ticks)`,
  );
  await p.evaluate(() => window.__ff.skipCutscene()); // clean up the running demo

  // ── the KD-* narration captions ──
  //
  // They are a SEPARATE SubtitleSystem from the room's, painted into a separate layer,
  // because a cutscene is a 720x555 screen with its own palette — same code, different
  // box. What is asserted here is that the layer follows the same renderer choice the
  // room's subtitles follow, and that it stands down when the cutscene does. The second
  // half is the one that bites: nothing outside the cutscene's own draw path would take
  // DOM captions off the screen, so a skipped demo could leave them over the room.
  /**
   * Watch both layers until the captions appear, and report what was on screen AT THAT
   * MOMENT. Sampled inside the page rather than "wait, then read": a KD-* line is only
   * up for as long as its narration lasts, so a separate read can arrive after it has
   * gone — which is exactly how this failed under full-suite load the first time.
   */
  const captionsShow = () =>
    p.evaluate(async () => {
      const inked = () => {
        const c = document.getElementById('subs');
        if (!c || !c.width) return false;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
        return false;
      };
      const out = { dom: 0, canvas: false, room: 0, sawSomething: false };
      for (let i = 0; i < 300; i++) {
        const dom = document.getElementById('domsubs-cut')?.children.length ?? 0;
        const canvas = inked();
        // The room's layer is a different element and must never carry the captions;
        // kept as a max across the whole window so one bad frame is still caught.
        out.room = Math.max(out.room, document.getElementById('domsubs')?.children.length ?? 0);
        if (dom > 0 || canvas) {
          out.dom = dom;
          out.canvas = canvas;
          out.sawSomething = true;
          return out;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return out;
    });

  // The DOM renderer: captions are real text, and the canvas overlay is left alone.
  await p.evaluate(() => window.__ff.setSubRenderer('dom'));
  await startDemo();
  await p.waitForFunction(() => window.__ff.cutSubsActive());
  const dom = await captionsShow();
  expect(dom.sawSomething, 'the cutscene captions reach the screen');
  expect(dom.dom > 0, `the cutscene captions are real DOM text (${dom.dom} lines)`);
  expect(!dom.canvas, 'the canvas overlay stays empty while DOM captions are up');
  expect(dom.room === 0, "the room's subtitle layer stays empty during a cutscene");

  // Skipping takes them down. Without this the captions outlive the cutscene that owns
  // them, and sit over the room the player lands back in. (The wait IS the assertion:
  // it times out if they are still there.)
  await p.evaluate(() => window.__ff.skipCutscene());
  await p.waitForFunction(() => !window.__ff.cutsceneActive()).catch(() => {});
  await p.waitForFunction(() => (document.getElementById('domsubs-cut')?.children.length ?? 0) === 0);
  expect(
    (await p.evaluate(() => document.getElementById('domsubs-cut')?.children.length ?? 0)) === 0,
    'skipping the demo takes the DOM captions down',
  );

  // The canvas renderer still draws them — the path the no-Web-Animations fallback and
  // anyone forcing 'canvas' goes through.
  await p.evaluate(() => window.__ff.setSubRenderer('canvas'));
  await startDemo();
  await p.waitForFunction(() => window.__ff.cutSubsActive());
  const cv = await captionsShow();
  expect(cv.sawSomething, 'the cutscene captions reach the screen with the canvas renderer');
  expect(cv.canvas, 'the canvas renderer paints the captions on the overlay');
  expect(cv.dom === 0, 'no DOM captions when the canvas renderer is asked for');
  await p.evaluate(() => window.__ff.skipCutscene());
  await p.evaluate(() => window.__ff.setSubRenderer('auto')); // leave no persisted choice
});
