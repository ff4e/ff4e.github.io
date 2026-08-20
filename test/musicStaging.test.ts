/**
 * The music table's numbers, checked against the files they describe.
 *
 * `src/audio/music.ts` carries three things the shipped tracks can no longer be asked for:
 * `MUSIC_RATE`, and each track's `loopSample` and `frames`. Until the audio was compressed
 * the rate was read out of the WAV header at byte offset 24 on every load — the shipped
 * tracks are AAC in MP4 and have no header to read, so the number moved into the table.
 *
 * That is a fine trade only if something notices when the table and the data disagree, and
 * the failure it would otherwise hide is quiet rather than loud: `loopStart` is
 * `loopSample / MUSIC_RATE` SECONDS into the decoded buffer, so a wrong rate does not throw
 * — it makes a track loop back into the middle of its own intro, forever, in one room.
 *
 * The originals are still in the repo (`public/data/Music/*.wav`) precisely so this check
 * has something to check against, so it costs one header read per track and no network.
 *
 * What each assertion is actually guarding:
 *
 *   - **format** — the assumption `MUSIC_RATE` encodes at all. All 17 originals are
 *     `fmt=1`, 1 channel, 22050 Hz, 16-bit. A track that was not would need its own rate,
 *     and the single constant would silently be wrong for it.
 *   - **frames** — the loop's END. AAC decodes ~70-1000 samples longer than the original
 *     (encoder padding, measured by `tools/stage-music.ts --verify`), so `playMusic` takes
 *     the end from here rather than from `buf.duration`; a stale `frames` splices padding
 *     or clips music into every repeat.
 *   - **loopSample inside the track** — a loop point past the end of its own file is the
 *     one wrong value that would be caught by nothing else, since `loopEnd < loopStart`
 *     simply plays on to the end and never repeats.
 *   - **a staged file exists per name** — the table is what enumerates the tracks for the
 *     staging tool, so a name in it with no `.m4a` beside it is a `mustHave` 404 at a room
 *     entry, and one the room-entry probes would only catch for the rooms they visit.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MUSIC_EXT, MUSIC_RATE, musicByName, musicNames } from '../src/audio/music.js';
import { readWav } from '../tools/stage-music.js';

const DIR = join('public', 'data', 'Music');

describe('music table vs the Music/ originals', () => {
  const names = musicNames();

  it('enumerates all 17 tracks — an empty list would pass every test below', () => {
    expect(names.length).toBe(17);
  });

  for (const name of names) {
    const desc = musicByName(name)!;

    it(`${name}: original is ${MUSIC_RATE} Hz mono 16-bit, and the table's frames match it`, () => {
      const wav = readWav(join(DIR, `${name}.wav`));
      expect(wav.rate).toBe(MUSIC_RATE);
      expect(wav.channels).toBe(1);
      expect(wav.bits).toBe(16);
      expect(wav.pcm.length).toBe(desc.frames);
    });

    it(`${name}: loops back inside its own length`, () => {
      expect(desc.loopSample).toBeGreaterThanOrEqual(0);
      expect(desc.loopSample).toBeLessThan(desc.frames);
    });

    it(`${name}: ships a staged .${MUSIC_EXT}`, () => {
      expect(existsSync(join(DIR, `${name}.${MUSIC_EXT}`))).toBe(true);
    });
  }
});
