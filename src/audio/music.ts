/**
 * Room-music table: maps a room's `cHud` index (RoomDesc.cHud, "Hudba" = music)
 * to its Music/ track and loop point. This reproduces the `hudbas` remapping in
 * `TDirect.Spust` (UMain.pas:226-242), where `IntToStr(cHud)` is rewritten to
 * `"<loopSample>:<name>"`. The room then loops that track from `loopSample`
 * (MusicCycle, URoom.pas:1568), so the intro plays once and only the body repeats.
 *
 * The rybky/kufrik/menu originals are 22050 Hz mono 16-bit; loopSample is in samples,
 * at that rate. `frames` is the original's sample count — see MUSIC_RATE below for why
 * the table now carries both, and `test/musicStaging.test.ts` for what checks them.
 */
export interface MusicDesc {
  readonly name: string;
  readonly loopSample: number;
  /** Sample count of the 22050 Hz original — the loop's end (see `musicSeconds`). */
  readonly frames: number;
}

/**
 * The rate every Music/ original was recorded at, and the rate `loopSample` and `frames`
 * are counted in.
 *
 * This used to be read out of the WAV header at byte offset 24 on every load, in three
 * places, because `loopStart` is `loopSample / rate` in SECONDS and getting the rate
 * wrong makes a track repeat its intro instead of only its body. The shipped tracks are
 * AAC in MP4 now and have no such header — but the number was never variable in the first
 * place: all 17 originals are `fmt=1`, 1 channel, 22050 Hz, 16-bit, which
 * `test/musicStaging.test.ts` asserts against the committed WAVs file by file.
 *
 * So the rate is stated once, here, next to the sample counts it belongs to, and the
 * header read is gone. It is deliberately NOT `FFS_SAMPLE_RATE`: that one is the rate of
 * the raw PCM inside a `.ffs` package, and the two being equal is a coincidence of the
 * 1998 data, not a fact either should inherit from the other.
 */
export const MUSIC_RATE = 22050;

/** cHud index (1..17) -> music. cHud = -1 means the room has no music. */
const MUSIC: Record<number, MusicDesc> = {
  1: { name: 'rybky01', loopSample: 1411498, frames: 2822518 },
  2: { name: 'rybky02', loopSample: 300850, frames: 2839069 },
  3: { name: 'rybky03', loopSample: 98155, frames: 2449790 },
  4: { name: 'rybky04', loopSample: 169239, frames: 2876696 },
  5: { name: 'rybky05', loopSample: 440994, frames: 2864684 },
  6: { name: 'rybky06', loopSample: 716075, frames: 3536354 },
  7: { name: 'rybky07', loopSample: 1058241, frames: 3174734 },
  8: { name: 'rybky08', loopSample: 0, frames: 370094 },
  9: { name: 'rybky09', loopSample: 92765, frames: 2690385 },
  10: { name: 'rybky10', loopSample: 0, frames: 1143102 },
  11: { name: 'rybky11', loopSample: 0, frames: 255602 },
  12: { name: 'rybky12', loopSample: 162762, frames: 651270 },
  13: { name: 'rybky13', loopSample: 652710, frames: 1189735 },
  14: { name: 'rybky14', loopSample: 35911, frames: 2152376 },
  15: { name: 'rybky15', loopSample: 650052, frames: 3063588 },
  16: { name: 'kufrik', loopSample: 78660, frames: 552656 },
  17: { name: 'menu', loopSample: 419772, frames: 826781 },
};

/** The music for a room's cHud index, or null if it has none. */
export function musicForCHud(cHud: number): MusicDesc | null {
  return MUSIC[cHud] ?? null;
}

/** Every track in the table, by name. The 17 entries are the 17 Music/ files. */
const BY_NAME: ReadonlyMap<string, MusicDesc> = new Map(Object.values(MUSIC).map((m) => [m.name, m]));

/** The table entry for a track name, or null if the name is not a Music/ file. */
export function musicByName(name: string): MusicDesc | null {
  return BY_NAME.get(name) ?? null;
}

/** Every Music/ track name (staging tools and the drift tests enumerate these). */
export function musicNames(): readonly string[] {
  return [...BY_NAME.keys()];
}

/** A sample offset in the 22050 Hz original, as seconds — what `AudioBuffer` wants. */
export function musicSeconds(samples: number): number {
  return samples / MUSIC_RATE;
}

/** The extension every shipped Music/ track has. See `tools/stage-music.ts`. */
export const MUSIC_EXT = 'm4a';

/**
 * The URL the game fetches a Music/ track from.
 *
 * One function rather than seven `\`/data/Music/${name}.wav\`` template literals, which is
 * what this was: room entry, the extra-music preload, the room-preload manifest, the
 * script-cue bridge in `main.ts` (twice), the cutscene and two map screens each built the
 * same string, so the compression change would have had to find all of them and a future
 * one still would.
 */
export function musicUrl(name: string): string {
  return `/data/Music/${name}.${MUSIC_EXT}`;
}

/**
 * Music a room's PLAY cues that its own `cHud` track does not cover.
 *
 * The rest of a room's sound is packaged with it: the voices are in `0NN.ffs` and the
 * `cHud` track is fetched by the room entry (`startRoomMusic`). These three are neither.
 * They are cued mid-room, from a `Music/<name>` track that is in no sound package —
 * `musicSnd` resolves a packaged name first and only falls through to a file for these
 * (audio.ts) — and all three rooms have `cHud: -1`, so nothing else ever asks for them:
 *
 *   KUFRIK  `kufrik`   1.11 MB — started with the briefcase cutscene (cutscene.ts).
 *   DRAKAR1 `rybky04`  5.75 MB — cued by the room script's own `init` (drakar1.ts:52).
 *   KORALY  `rybky08`  0.74 MB — cued at score-step 19 (koraly.ts:373), well into the room.
 *
 * (Those are the uncompressed sizes the three cost when this comment was written; they are
 * ~5x smaller as shipped now — see `tools/stage-music.ts`. The point the sizes are making
 * is about which room pays them, and that has not changed.)
 *
 * Every one was a `mustHave` fetch issued while the room was being played, `void`ed at the
 * call site, so a connection that dropped during the room ended the session. They are
 * fetched by the room entry now, like every other sound the room will make.
 *
 * `test/extra-music.test.ts` derives this same set from the room scripts and fails if a
 * script cues a track that is not here — the table is small enough to state, and too easy
 * to forget to grow.
 */
const EXTRA_MUSIC: Readonly<Record<number, string>> = {
  2: 'kufrik',
  13: 'rybky04',
  34: 'rybky08',
};

/** The non-packaged track this room's play will cue beyond its `cHud` one, or null. */
export function extraMusicOfRoom(room: number): string | null {
  return EXTRA_MUSIC[room] ?? null;
}
