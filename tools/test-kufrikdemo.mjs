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
      const out = { dom: 0, room: 0, sawSomething: false };
      for (let i = 0; i < 300; i++) {
        const dom = document.getElementById('domsubs-cut')?.children.length ?? 0;
        // The room's layer is a different element and must never carry the captions;
        // kept as a max across the whole window so one bad frame is still caught.
        out.room = Math.max(out.room, document.getElementById('domsubs')?.children.length ?? 0);
        if (dom > 0) {
          out.dom = dom;
          out.sawSomething = true;
          return out;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return out;
    });

  // The captions are real DOM text, and the room's own layer stays empty underneath —
  // they are separate layers precisely because they stand down on different conditions.
  await startDemo();
  await p.waitForFunction(() => window.__ff.cutSubsActive());
  const shown = await captionsShow();
  expect(shown.sawSomething, 'the cutscene captions reach the screen');
  expect(shown.dom > 0, `the cutscene captions are real DOM text (${shown.dom} lines)`);
  expect(shown.room === 0, "the room's subtitle layer stays empty during a cutscene");

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

  // Leaving the ROOM with a cutscene still live. The draw dispatch tests the map / intro
  // / story-page branches BEFORE the cutscene one, so on that path drawCutscene() never
  // runs and the captions have no owner to take them down. Every ordinary way out
  // (Escape, clicking the stage) calls skipCutscene() first, so this is the narrow case
  // the loop's own guard has to cover rather than the cutscene's draw path.
  await startDemo();
  await p.waitForFunction(() => window.__ff.cutSubsActive());
  await p.waitForFunction(() => (document.getElementById('domsubs-cut')?.children.length ?? 0) > 0);
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await p.waitForFunction(() => (document.getElementById('domsubs-cut')?.children.length ?? 0) === 0);
  expect(
    (await p.evaluate(() => document.getElementById('domsubs-cut')?.children.length ?? 0)) === 0,
    'leaving the room with a cutscene live takes its captions off the map',
  );
  await p.evaluate(() => window.__ff.skipCutscene());
});
