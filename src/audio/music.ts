/**
 * Room-music table: maps a room's `cHud` index (RoomDesc.cHud, "Hudba" = music)
 * to its Music/ WAV and loop point. This reproduces the `hudbas` remapping in
 * `TDirect.Spust` (UMain.pas:226-242), where `IntToStr(cHud)` is rewritten to
 * `"<loopSample>:<name>"`. The room then loops that track from `loopSample`
 * (MusicCycle, URoom.pas:1568), so the intro plays once and only the body repeats.
 *
 * The rybky/kufrik/menu WAVs are 22050 Hz mono 16-bit; loopSample is in samples.
 */
export interface MusicDesc {
  readonly name: string;
  readonly loopSample: number;
}

/** cHud index (1..17) -> music. cHud = -1 means the room has no music. */
const MUSIC: Record<number, MusicDesc> = {
  1: { name: 'rybky01', loopSample: 1411498 },
  2: { name: 'rybky02', loopSample: 300850 },
  3: { name: 'rybky03', loopSample: 98155 },
  4: { name: 'rybky04', loopSample: 169239 },
  5: { name: 'rybky05', loopSample: 440994 },
  6: { name: 'rybky06', loopSample: 716075 },
  7: { name: 'rybky07', loopSample: 1058241 },
  8: { name: 'rybky08', loopSample: 0 },
  9: { name: 'rybky09', loopSample: 92765 },
  10: { name: 'rybky10', loopSample: 0 },
  11: { name: 'rybky11', loopSample: 0 },
  12: { name: 'rybky12', loopSample: 162762 },
  13: { name: 'rybky13', loopSample: 652710 },
  14: { name: 'rybky14', loopSample: 35911 },
  15: { name: 'rybky15', loopSample: 650052 },
  16: { name: 'kufrik', loopSample: 78660 },
  17: { name: 'menu', loopSample: 419772 },
};

/** The music for a room's cHud index, or null if it has none. */
export function musicForCHud(cHud: number): MusicDesc | null {
  return MUSIC[cHud] ?? null;
}

/**
 * Music a room's PLAY cues that its own `cHud` track does not cover.
 *
 * The rest of a room's sound is packaged with it: the voices are in `0NN.ffs` and the
 * `cHud` track is fetched by the room entry (`startRoomMusic`). These three are neither.
 * They are cued mid-room, from a `Music/<name>.wav` that is in no sound package —
 * `musicSnd` resolves a packaged name first and only falls through to a file for these
 * (audio.ts) — and all three rooms have `cHud: -1`, so nothing else ever asks for them:
 *
 *   KUFRIK  `kufrik`   1.11 MB — started with the briefcase cutscene (cutscene.ts).
 *   DRAKAR1 `rybky04`  5.75 MB — cued by the room script's own `init` (drakar1.ts:52).
 *   KORALY  `rybky08`  0.74 MB — cued at score-step 19 (koraly.ts:373), well into the room.
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
