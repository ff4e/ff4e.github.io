/**
 * A room must not cue music it did not fetch on the way in.
 *
 * `extraMusicOfRoom` (audio/music.ts) is a hand-written table of three rooms, and a table
 * is only as good as the thing that notices when it should have grown. So this derives the
 * same set from the room scripts and fails if they disagree.
 *
 * The rule it encodes: a `music()` / `musiccyc()` call with a literal name resolves to a
 * PACKAGED sound if the room's `.ffs` has one (`musicSnd` checks `hasPackaged` first), and
 * otherwise falls through to `Music/<name>`. So "is there a file of that name in
 * `public/data/Music/`?" is exactly "will this cue hit the network?" — and if it will, the
 * room entry has to have fetched it. That is why the check is a file-existence test and not
 * a second list: a list would need the same maintenance as the table it is checking.
 *
 * The rooms this catches today were all real: KORALY fetched 740 kB at score-step 19,
 * DRAKAR1 5.75 MB from its own `init`, KUFRIK 1.11 MB when the cutscene started — every one
 * `mustHave`, `void`ed at the call site, and therefore a session ended mid-room by a
 * connection that dropped while the player was solving.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOMS } from '../src/data/roomTable.js';
import { MUSIC_EXT, extraMusicOfRoom, musicForCHud } from '../src/audio/music.js';

/** `s.music('name', …)` / `s.musiccyc('name', …)` with a LITERAL name, per room file. */
function cuedNames(text: string): string[] {
  return [...text.matchAll(/\bs\.music(?:cyc)?\(\s*'([^']+)'/g)].map((m) => m[1]!);
}

/** The room number a `src/rooms/<jmeno>.ts` file belongs to. */
function roomOf(file: string): number | null {
  const jmeno = file.replace(/\.ts$/, '').toUpperCase();
  return ROOMS.find((r) => r.jmeno === jmeno)?.num ?? null;
}

describe('music a room cues but does not enter with', () => {
  const cues: Array<{ room: number; name: string }> = [];
  for (const file of readdirSync(join('src', 'rooms')).filter((f) => f.endsWith('.ts'))) {
    const room = roomOf(file);
    if (room === null) continue;
    for (const name of cuedNames(readFileSync(join('src', 'rooms', file), 'utf8'))) {
      // A name with no file of its own is packaged with the room, and the room's `.ffs`
      // is already a must-have of the entry. Nothing to do.
      if (!existsSync(join('public', 'data', 'Music', `${name}.${MUSIC_EXT}`))) continue;
      cues.push({ room, name });
    }
  }

  it('finds the script cues at all — a regex that matched nothing would pass silently', () => {
    expect(cues.length).toBeGreaterThan(0);
  });

  for (const { room, name } of cues) {
    const jmeno = ROOMS[room - 1]?.jmeno ?? `room ${room}`;
    it(`${jmeno} enters with ${name}`, () => {
      // Either the room's own cHud track already fetches it (`startRoomMusic`), or it has
      // to be in the extra table. Both are room-entry fetches; neither is a mid-play one.
      const own = musicForCHud(ROOMS[room - 1]?.cHud ?? -1)?.name;
      expect(
        own === name || extraMusicOfRoom(room) === name,
        `${jmeno} cues '${name}' from its script, and '${name}.wav' is a file rather than a\n` +
          'packaged sound — so that cue is a network fetch in the middle of play. Add the room\n' +
          'to EXTRA_MUSIC in src/audio/music.ts so the entry fetches it and can fail on it.',
      ).toBe(true);
    });
  }

  it('KUFRIK enters with the cutscene theme, which is cued from cutscene.ts, not a script', () => {
    // The one cue the scan above cannot see: `startCutscene` plays 'kufrik' directly.
    expect(readFileSync(join('src', 'app', 'cutscene.ts'), 'utf8')).toContain("playMusic('kufrik'");
    expect(extraMusicOfRoom(2)).toBe('kufrik');
  });

  it('lists nothing a room does not actually cue', () => {
    // The other direction: a stale entry costs every visit to that room a download it
    // never uses, which is the same bug pointed the other way.
    const listed = ROOMS.map((r) => r.num).filter((n) => extraMusicOfRoom(n) !== null);
    for (const room of listed) {
      const cued = room === 2 || cues.some((c) => c.room === room && c.name === extraMusicOfRoom(room));
      expect(cued, `room ${room} is in EXTRA_MUSIC but nothing cues that track`).toBe(true);
    }
  });
});
