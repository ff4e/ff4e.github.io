/**
 * UI test: the map/room audio lifecycle (faithful KillSnd + zrus_dialogy +
 * SpustHudbu). The map plays the menu music; entering a room switches to the room
 * track; leaving to the map kills all voices, clears the dialogue queue, and
 * restores the menu music.
 *
 * It also checks the LOOP POINT of each track it starts, which needs a real browser and
 * has no cheaper home: `loopStart` is `loopSample / 22050` SECONDS into a buffer the
 * browser decoded, and every input to that sum stopped being checkable from the file when
 * the music was compressed. The tracks ship as AAC (tools/stage-music.ts) and carry no WAV
 * header to read a rate out of, so the rate now comes from the table — and the failure a
 * wrong one produces is not an error but a track quietly looping back into its own intro,
 * in one room, forever. The unit test (test/musicStaging.test.ts) can prove the table
 * matches the originals; only this can prove what `playMusic` installed.
 */
import { withApp } from './ui-lib.mjs';

/**
 * Record what every LOOPING music source was started with. Patched onto the prototype in
 * the page the probe is already on — NOT through an init script, which would need a reload
 * and make this probe boot the app twice, re-fetching the world map for nothing. It is
 * installed before the probe cues any music, so it sees the real node `playMusic` built
 * rather than anything re-derived from the table this is supposed to be checking.
 *
 * Named from the engine's own sound log, not from `__ff.music()`: that reads
 * `currentMusic`, which is `musicSrc ? musicName : ''`, and `musicSrc` is assigned AFTER
 * `start()` — so at the only moment the node can be inspected it reports ''. `playMusic`
 * logs `<name> (music-loop)` on the line above `createBufferSource`, which makes the last
 * such entry the track being started, and also excludes a looping SndCyc effect from being
 * mistaken for music.
 */
const LOOP_SPY = () => {
  window.__loops = {};
  const proto = AudioBufferSourceNode.prototype;
  const start = proto.start;
  proto.start = function (...args) {
    if (this.loop && this.buffer) {
      const log = window.__ff?.soundLog?.() ?? [];
      const last = [...log].reverse().find((e) => e.name.endsWith(' (music-loop)'));
      if (last) {
        window.__loops[last.name.replace(' (music-loop)', '')] = {
          loopStart: this.loopStart,
          loopEnd: this.loopEnd,
          duration: this.buffer.duration,
        };
      }
    }
    return start.apply(this, args);
  };
};

/** The loop point a track is meant to have: `loopSample` of `src/audio/music.ts`, in seconds. */
const RATE = 22050;
const WANT = {
  menu: { loopSample: 419772, frames: 826781 },
  rybky04: { loopSample: 169239, frames: 2876696 },
};

/** Assert one track's loop region, in seconds, against the table. */
function checkLoop(expect, name, got) {
  const want = WANT[name];
  expect(got !== undefined && got !== null, `${name}: a looping source was started`);
  if (!got) return;
  // Exact to a sample: this is a division, not a measurement, and the whole point is that
  // nothing rounds it. A tolerance here would pass the bug it exists to catch.
  const wantStart = want.loopSample / RATE;
  expect(
    Math.abs(got.loopStart - wantStart) < 1 / RATE,
    `${name}: loops back at ${wantStart.toFixed(6)}s (loopSample ${want.loopSample} @ ${RATE}Hz), got ${got.loopStart.toFixed(6)}s`,
  );
  // The loop ENDS at the music's end, not at the decoded buffer's. A lossy decode need not
  // return the sample count it was given — ffmpeg's returns 70-1000 samples of encoder
  // padding (tools/stage-music.ts --verify), and a browser that did the same would splice
  // that silence into every repeat. Chromium honours the container's gapless metadata and
  // hands back the original length, so this passes by agreement rather than by clamping —
  // which is exactly why it is worth asserting: it is the case that would go unnoticed.
  const wantEnd = want.frames / RATE;
  expect(
    got.loopEnd <= wantEnd + 1 / RATE && got.loopEnd > wantStart,
    `${name}: loop ends at the music's end, not past it (want <= ${wantEnd.toFixed(6)}s, got ${got.loopEnd.toFixed(6)}s)`,
  );
  expect(got.loopEnd <= got.duration, `${name}: loop end is inside the decoded buffer`);
}

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());
  await p.evaluate(LOOP_SPY);
  await p.mouse.click(450, 600); // a gesture to unlock the AudioContext
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.music() === 'menu').catch(() => {});
  expect((await p.evaluate(() => window.__ff.music())) === 'menu', 'map plays the menu music');

  // Enter PRVNI (cHud=4 -> rybky04): room music replaces the menu music.
  await p.evaluate(() => window.__ff.enterRoom(1));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.music() === 'rybky04').catch(() => {});
  expect((await p.evaluate(() => window.__ff.music())) === 'rybky04', 'room plays its own track');

  // Let PRVNI queue its opening dialogue.
  await p.waitForFunction(() => window.__ff.voicePlaying() || window.__ff.script()?.dialog).catch(() => {});

  // Leave to the map: voices killed, dialogue queue cleared, menu music restored.
  await p.evaluate(() => window.__ff.showMap());
  await p
    .waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.music() === 'menu')
    .catch(() => {});
  expect(!(await p.evaluate(() => window.__ff.voicePlaying())), 'voices killed on leaving');
  expect(!(await p.evaluate(() => window.__ff.script()?.dialog)), 'dialogue queue cleared on leaving');
  expect((await p.evaluate(() => window.__ff.music())) === 'menu', 'menu music restored on the map');

  const loops = await p.evaluate(() => window.__loops);
  checkLoop(expect, 'menu', loops.menu);
  checkLoop(expect, 'rybky04', loops.rybky04);
});
