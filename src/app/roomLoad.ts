/**
 * Getting a room onto the screen and giving it a voice: fetch its FFR/FFT, build it,
 * then — once its art has landed — its .ffs voice package and its music track.
 *
 * The ordering in `loadRoom` is the point of the file. Audio is the bulk of a room
 * entry's bytes and none of it is needed to DRAW the room, so it waits behind the art
 * rather than competing with it; everything that lands late is guarded on the player
 * still going to that room.
 *
 * It needs three names from `main.ts`: where a room's FFR lives, how to end a running
 * demonstration, and how to turn parsed data into a live room.
 */
import { MLUVI_PRIOR } from './keyTables.js';
import { ROOMS } from '../data/roomTable.js';
import { applyWinDesktopPalette } from '../data/winPalette.js';
import { assetBytes, requiredAsset } from '../render/assetFetch.js';
import { audio } from './audioEngine.js';
import { beginRoomArt, curNum, ensureAiRoom, ensureEnhancedArt } from './art.js';
import { booted } from './stageState.js';
import { count, fftEntries, setFfr, setFftEntries, setPokus, subs, talkIdx } from './gameState.js';
import { depthOfRoom } from '../data/world.js';
import { enhancedArtActive, graphics } from './renderSettings.js';
import { failRoomEntry, mapLaunching } from './roomLaunch.js';
import { musicForCHud } from '../audio/music.js';
import { parseFfr } from '../data/ffr.js';
import { parseFft } from '../data/fft.js';
import {
  roomLoadSeq,
  setForceRoomRedraw,
  setRoomLoadSeq,
  setRoomLoading,
} from './framePacing.js';
import { subLang, subsOn } from './playerSettings.js';
import { ui } from './screenState.js';
import { wake } from './frameClock.js';

/**
 * The three names this module needs from `main.ts`.
 */
export interface RoomLoadHost {
  /** Turns the freshly parsed FFR into a live `Room` + `StepEngine`. */
  readonly buildRoom: () => void;
  /** Ends any running KUFRIK demonstration — a room change always does. */
  readonly endShowmode: () => void;
  /** Where a room number's FFR lives (the tier's art pack can move it). */
  readonly ffrUrl: (num: number) => string;
}

let host!: RoomLoadHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initRoomLoad(h: RoomLoadHost): void {
  host = h;
}

export async function loadRoom(num: number): Promise<void> {
  host.endShowmode(); // a room change ends any KUFRIK demonstration
  setForceRoomRedraw(true); // repaint the first frame of the new room
  setRoomLoading(true); // hide the stale previous room until the new one is built
  // Boot loads room 7 before the map/intro takes over, and its audio was always
  // discarded by the killAll() that follows. Deferring the audio (below) would let it
  // start AFTER the menu music instead, so skip it outright for the boot load.
  const bootLoad = !booted;
  try {
    const nnn = String(num).padStart(3, '0');
    // Only the two assets the room cannot be BUILT without are on this path. The
    // .ffs voice package and the room music used to ride along here; see below.
    //
    // Both go through `requiredAsset`, so both are RETRIED on a transport failure and both
    // are classified (src/render/assetFetch.ts). They used to be bare `fetch` calls, and
    // that is the whole of the bug this replaces: offline, the FFR fetch rejected, the
    // launch caught it and handed the player the PREVIOUS room, silently, still accepting
    // input for it. Nothing here can be allowed to fail quietly.
    const ffrUrl = host.ffrUrl(num);
    const fftUrl = `/data/Title/${nnn}.fft`;
    // The subtitle index is no longer tolerated when it fails. It used to fall back to an
    // empty table, which loses every line the room speaks — a room that plays through in
    // silence with no indication anything went wrong. All 72 rooms ship a .fft (plus the
    // four x0n packages), so there is no legitimate absence to protect here: a missing one
    // is a broken deploy and a failed one is the network, and the player is told either way.
    const [ffrRes, fftRes] = await Promise.all([
      requiredAsset(ffrUrl, `room ${num}`),
      requiredAsset(fftUrl, `the subtitles for room ${num}`),
    ]);
    const parsed = parseFfr(await assetBytes(ffrUrl, ffrRes));
    // WIN "Favorites" palette gag (URoom.pas:1312-1355): swap the pink placeholder colours
    // for the Windows system theme, so the fake windows look like a real desktop.
    setFfr(
      ROOMS[num - 1]?.jmeno === 'WIN'
        ? { ...parsed, palette: applyWinDesktopPalette(parsed.palette) }
        : parsed,
    );
    const fftBytes = await assetBytes(fftUrl, fftRes);
    setFftEntries(parseFft(fftBytes));
    // The outgoing room's samples must not be audible under the new room while its
    // own package is still in flight (see loadRoomVoices) — a lookup that misses now
    // falls back to the global packages, i.e. silence for a room-specific line.
    audio.clearRoom();
    // The boot room fetches no voices at all, so its queue must not be held.
    armRoomVoices(bootLoad);
    setPokus(1); // fresh attempt on entering a room
    host.buildRoom();
    // Point the art layer at this room: clear the previous room's decoded art and arm
    // the two "hold the frame until it lands" flags (see beginRoomArt).
    beginRoomArt(num);
    // What the room is WAITING FOR must be the same thing roomArtPending() holds the
    // frame for — otherwise the two disagree. In `classic` nothing is awaited: the
    // enhanced art still loads (a later tier switch wants it cached) but the room does
    // not hold for it, so audio must not either. Gating audio on the raw
    // ensureEnhancedArt promise left a classic room playable and SILENT for the ~1.7 MB
    // of truecolor art that tier never displays.
    //
    // The `ai` tier does not load the enhanced art here AT ALL, which is the one thing
    // this block does differently from every earlier version of it. That art is 0.3-2.1
    // MB a room (51 MB over a playthrough) and the AI compositor does not draw it; it is
    // only ever wanted in the fallback cases, which are discrete events that fetch it
    // themselves (see ensureEnhancedFallback). Before this, an `ai` room entry both
    // downloaded it and WAITED for it.
    //
    // `classic` keeps its eager background load unchanged. The same argument would
    // apply to it, but that tier's behaviour is not what this change is about and its
    // probes are the oracle for the rest of the change.
    if (graphics === 'classic') void ensureEnhancedArt(num);
    const art =
      graphics === 'ai' ? ensureAiRoom(num) : graphics === 'enhanced' ? ensureEnhancedArt(num) : Promise.resolve();
    // Audio is the bulk of a room entry's bytes and none of it is needed to DRAW the
    // room: 2.43 MB of .ffs voices (8.94 MB worst) plus up to 6.75 MB of music, against
    // ~2.14 MB of room-specific core+art bytes. On a capped link they simply crowd the
    // art out, so audio still waits BEHIND the art — a low-priority hint was measured and
    // is not enough (KOSTE's first frame: 35.5s with the hint, 27.4s with the wait).
    //
    // What changed: the room no longer APPEARS while its audio is still coming. It used
    // to, and the window was silent-but-playable; the cost of that was that a voice
    // package which never arrived was never mentioned either, so a room could be played
    // through mute with nothing said. Now the entry holds until every sound the room
    // needs is in, and fails — the game stops and says so — if any of it does not arrive. The hold is `roomAudioPending()`, separate from `roomLoading` so that the
    // room is still BUILT at the same moment it always was.
    //
    // The wait is real and lands on slow links: ~6.2 MB typical, ~33 s at 1.5 Mbps. It is
    // almost entirely uncompressed PCM (22 kHz mono, 352.8 kbps) — see the
    // fish_fillets_audio_compression task, which takes it to ~0.9 MB.
    setRoomAudioPending(bootLoad ? 0 : num);
    const audioDone = bootLoad ? Promise.resolve() : art.then(() => loadRoomAudio(num, nnn, fftBytes));
    // Both arms release the hold — a hold that outlives its load is a room that never
    // appears — and both release it BY ROOM, so a late outcome cannot free a hold a later
    // entry has since armed.
    void audioDone.then(
      () => {
        clearRoomAudioPending(num);
        wake();
      },
      (e: unknown) => {
        clearRoomAudioPending(num);
        // `enteringRoom`, not `curNum`. `curNum` is not a liveness token: it keeps naming
        // the last room BUILT, so it still equals `num` after the player has gone back to
        // the map, and it still equals the OLD room while a superseding entry is in flight
        // (it only advances at `beginRoomArt`). Deciding on it would end the session over a
        // download for a room nobody is waiting for — observed as a failure screen raised
        // on the world map, minutes after the room it names was left.
        if (!enteringRoom(num)) return;
        // `warn`, matching art.ts's transient path: the player has been TOLD (the screen
        // is the report), and this is the breadcrumb beside it. It is also the difference
        // between a breadcrumb and noise — a page torn down mid-download truncates a
        // 2.43 MB package, which is not a fault to shout about.
        console.warn(`[audio] room ${num} could not be given its sound:`, e);
        failRoomEntry(num, e);
        wake();
      },
    );
  } catch (e) {
    // EVERY route into a room comes through here, which is why the report belongs here
    // and not in the launch. The map route had its own recovery (`abortMapLaunch`, via the
    // rejection this rethrows); the DIRECT route — the dev room picker, the story-page
    // chain, SCORE/ZAVER, an Escape restart, and the launch's own "the map was taken away"
    // fallback — had none at all, and after boot nothing hijacks unhandled rejections
    // (loadingUi.ts). So an FFR or FFT that failed on those routes left the player on a
    // room screen showing the room they came from, silently: the very bug this branch
    // exists to fix, reachable by a different door.
    //
    // Rethrown, because the callers that await an entry still have to see it fail.
    failRoomEntry(num, e);
    throw e;
  } finally {
    // Always drop the guard, even if a fetch/parse threw. On success it runs once the
    // room is built, so the next frame paints the new room.
    //
    // On FAILURE this used to be the whole recovery, and the comment here used to say so:
    // the guard came off, the launch flipped the screen to `room`, and the player was
    // handed the PREVIOUS room — built, live, accepting input, with nothing said. That is
    // no longer what happens; the catch above reports it and the game stops. What the drop
    // still does, and why it stays unconditional, is let
    // the next frame PAINT: `roomLoading` suppresses the room draw, and the map's own
    // repaint path runs through the same wake(). Leaving it set on the failure path would
    // strand a frozen frame over a game that is otherwise fine.
    setRoomLoading(false);
    setRoomLoadSeq(roomLoadSeq + 1);
    setForceRoomRedraw(true);
    wake();
  }
}

/**
 * Fetch one sound package: its .fft index and its .ffs bodies.
 *
 * Throws rather than returning null, so the caller decides what an absent package
 * means. Both requests go through `fetchAsset`, so both are retried on a transport
 * failure and both are classified — `isTransient` is what tells "the connection dropped"
 * from "this package is not on the server", and the two want different words.
 */
export async function fetchSoundPkg(
  fftUrl: string,
  ffsUrl: string,
  what: string,
  deferred = false,
): Promise<{ fft: Uint8Array; ffs: Uint8Array }> {
  // A `deferred` package holds chatter, never anything the player is waiting on, so it
  // asks the browser to schedule it behind everything else: x01 alone is 0.74 MB, and
  // it must not compete with the room art or the next room's voices. `priority` is an
  // optional RequestInit field — browsers that lack it ignore it.
  const init = deferred ? ({ priority: 'low' } as RequestInit) : undefined;
  // Both halves carry the SAME player-facing name. The split between an index and its
  // bodies is an implementation detail of the 1998 format, and "the sound package index
  // for the death lines is missing" is a sentence written for a developer.
  const [fftRes, ffsRes] = await Promise.all([
    requiredAsset(fftUrl, what, { init }),
    requiredAsset(ffsUrl, what, { init }),
  ]);
  const [fft, ffs] = await Promise.all([assetBytes(fftUrl, fftRes), assetBytes(ffsUrl, ffsRes)]);
  return { fft, ffs };
}

/** Fetch a package and keep it, failing loudly. The only kind there is now. */
export async function requireSoundPkg(
  id: string,
  fftUrl: string,
  ffsUrl: string,
  what: string,
  deferred = false,
): Promise<void> {
  const pkg = await fetchSoundPkg(fftUrl, ffsUrl, what, deferred);
  audio.loadGlobal(id, pkg.fft, pkg.ffs);
}

/**
 * x01: the eight "you are at the edge of the level" remarks (`cil-m/v-hlaska0..3`)
 * that StdKrajniHlaska speaks. `initsounds` (URoom.pas:1018-1021) loads it on top of
 * the room package, and only in a depth-15 room — the last room of a leg — releasing
 * it again with KillMem(3) when the room closes (:1583).
 *
 * So it is fetched on first entry to a leg-final room, and then KEPT rather than
 * reloaded per room. Keeping it is not a deviation: the eight rooms whose scripts call
 * stdKrajniHlaska are EXACTLY the eight depth-15 rooms (pinned by a test), so no other
 * room can ask for a `cil-*` name and the wider scope is unobservable — whereas
 * re-fetching 0.74 MB on every leg-final entry is not.
 *
 * Until this landed the port never fetched x01 at all, so all eight names resolved to
 * nothing and the border remark was silent, subtitles included, in every leg-final room.
 */
let borderLinesLoaded = false;
let borderLinesLoad: Promise<void> | null = null;
async function loadBorderLines(num: number): Promise<void> {
  if (borderLinesLoaded || depthOfRoom(num) !== 15) return;
  // Awaited now, and no longer swallowed: it used to warn to the console and leave the
  // eight border remarks silent, which is a room quietly missing lines it is supposed to
  // speak. The flag is set only on SUCCESS, so a failed entry re-fetches on the retry
  // rather than remembering the failure — the same rule as every other loader here.
  //
  // Single-flight, for the same reason the .ffs path is (see `voiceLoads`): two entries to
  // depth-15 rooms can overlap before the flag latches — a die-and-restart inside one is
  // enough, since the room is live and interactive while its audio is still coming — and
  // two concurrent writes of one 0.74 MB cache entry fail with ERR_CACHE_WRITE_FAILURE.
  // That is a transient error, so without this the second entry would end the session over
  // a package the first was already fetching successfully.
  if (borderLinesLoad === null) {
    borderLinesLoad = requireSoundPkg('x01', '/data/Title/x01.fft', '/data/Sound/x01.ffs', 'the fish remarks', true);
    // Retracted on failure so the next leg-final room retries rather than joining a
    // rejected promise for the rest of the session.
    void borderLinesLoad.then(
      () => {
        borderLinesLoaded = true;
      },
      () => {
        borderLinesLoad = null;
      },
    );
  }
  await borderLinesLoad;
}

/**
 * Fetch the room's voice package (.ffs).
 *
 * Fire-and-forget and guarded on `curNum`: the player can be in a different room by
 * the time it lands, and applying a stale package would give the new room the old
 * room's voices. Until it arrives, `audio.clearRoom()` has left only the global
 * packages, so a line that beats it is silent rather than wrong.
 *
 * Keyed on the PROMISE, like aiRoomCache: now that this download outlives the room
 * load that started it, re-entering the same room quickly used to put two fetches of
 * the same file in flight at once — and two concurrent writes of one (up to 9.37 MB)
 * cache entry fail with net::ERR_CACHE_WRITE_FAILURE. The entry is dropped once the
 * fetch settles, so nothing retains these buffers between entries.
 */
const voiceLoads = new Map<string, Promise<Uint8Array>>();
/**
 * False from room entry until the room's .ffs has SETTLED — arrived, or failed/absent.
 * Gates the dialogue queue (see SoundFns.voicesReady) so an opening conversation is not
 * consumed silently while the package is still downloading. "Settled" rather than
 * "loaded" on purpose: a room with no voice package, or a failed fetch, must let the
 * queue run rather than stall it forever.
 */
/**
 * Is the room still waiting for its SOUND?
 *
 * A hold of its own, alongside `roomArtPending()`, rather than an extension of
 * `roomLoading`. The distinction is load-bearing: the room is BUILT at exactly the
 * moment it always was (`roomLoading` drops there, and a dozen probes anchor on that),
 * but it is not handed the stage until it can be heard as well as seen. Cleared on both
 * arms of the audio load — a hold that outlives its load is a room that never appears.
 */
let audioPendingNum = 0;
export const roomAudioPending = (): boolean => audioPendingNum !== 0;
/**
 * Arm or release the hold, scoped to the room that owns it.
 *
 * Scoped for the same reason `clearAiPending` is (art.ts): these loads outlive the entry
 * that started them, so an outcome arriving for room A must not release a hold that room
 * B has since armed — which would present B before its sound was in, silently, and only
 * when the player happened to move fast enough.
 */
function setRoomAudioPending(num: number): void {
  audioPendingNum = num;
}
function clearRoomAudioPending(num: number): void {
  if (audioPendingNum === num) audioPendingNum = 0;
}

export let roomVoicesSettled = true;
/** Resolves when `roomVoicesSettled` next becomes true — for callers that can await. */
export let roomVoicesReady: Promise<void> = Promise.resolve();
let markVoicesSettled: () => void = () => {};

/** Begin a room's "voices not here yet" window (see roomVoicesSettled). */
export function armRoomVoices(settled: boolean): void {
  roomVoicesSettled = settled;
  if (settled) {
    roomVoicesReady = Promise.resolve();
    return;
  }
  roomVoicesReady = new Promise<void>((resolve) => { markVoicesSettled = resolve; });
}

/**
 * Is `num` the room the player is being taken to?
 *
 * Guards the two things a room load starts once its assets have landed — its voice
 * package and its music — against being installed over a room the player has since
 * left. `curNum` alone is not enough: they leave for the map (or a story page) and
 * `curNum` still names the room they came from.
 *
 * The screen test is not literally `screen === 'room'` because a launch off the world
 * map holds the map on screen for the whole load (see beginMapLaunch) — the same window
 * in which this resolves. Delphi starts the room's music inside the blocking Spust,
 * with the map still painted, so being on the map here means the entry is in progress,
 * not abandoned.
 */
function enteringRoom(num: number): boolean {
  if (curNum !== num) return false;
  return ui.screen === 'room' || mapLaunching() === num;
}

export async function loadRoomVoices(num: number, nnn: string, fftBytes: Uint8Array): Promise<void> {
  if (!enteringRoom(num)) return;
  let pending = voiceLoads.get(nnn);
  if (pending === undefined) {
    const url = `/data/Sound/${nnn}.ffs`;
    pending = requiredAsset(url, `the voices for room ${num}`).then(async (r) => assetBytes(url, r));
    voiceLoads.set(nnn, pending);
    // Dropped whatever happens, so a failure is not what the next entry joins. Kept
    // keyed on the PROMISE so two entries to the same room do not put two fetches of one
    // (up to 8.94 MB) cache entry in flight — concurrent writes fail with
    // net::ERR_CACHE_WRITE_FAILURE.
    void pending.catch(() => {}).then(() => voiceLoads.delete(nnn));
  }
  const buf = await pending;
  if (curNum !== num) return;
  audio.setRoom(nnn, fftBytes, buf);
  roomVoicesSettled = true;
  markVoicesSettled();
  wake(); // the dialogue queue was held on this; let it run on the next frame
}

/**
 * Room music (MusicCycle, URoom.pas:1568): loop the room's track, or silence it.
 *
 * The track is fetched and DECODED here rather than inside `playMusic`, so that a track
 * which does not arrive fails the room entry instead of leaving the room quietly silent.
 * `playMusic` then finds it in the engine's cache and starts it without a request of its
 * own; every other caller (the menu, the KUFRIK demo) keeps the tolerant path, where
 * silence really is the right answer.
 *
 * A room whose cHud has no track is not a failure — it is a room that is meant to be
 * quiet, and there is nothing to fetch.
 */
export async function startRoomMusic(num: number): Promise<void> {
  if (!enteringRoom(num)) return;
  const music = musicForCHud(ROOMS[num - 1]?.cHud ?? -1);
  if (!music) {
    audio.stopMusic();
    return;
  }
  // 17 tracks serve 72 rooms, so this is usually a cache hit and costs nothing; it is
  // paid once per leg. Uncompressed, the miss is up to 6.75 MB (see the
  // fish_fillets_audio_compression task).
  const url = `/data/Music/${music.name}.wav`;
  if (!audio.hasMusic(music.name)) {
    // What the channel was claimed for when this entry asked for its music. `playMusic`
    // takes the channel at CALL time, and the call now happens after the download rather
    // than before it — so without this, anything that legitimately claims music DURING
    // the download would be overridden when it finished. KUFRIK is exactly that case: its
    // demonstration starts `kufrik` the moment the room is entered, and an unguarded room
    // track landing a second later silenced it (caught by test-kufrikdemo).
    const claimed = audio.currentMusic;
    // Registered with the engine BEFORE the first await, so a script that re-cues the same
    // track while it is still coming joins this download instead of opening a second one.
    // KANKAN does exactly that on its first tick — `if (!s.playing(MUSIC_PRIOR))
    // s.musiccyc(...)` — and paid for its 1.24 MB track twice.
    const load = (async () => {
      const res = await requiredAsset(url, `the music for room ${num}`, { init: { priority: 'low' } as RequestInit });
      await audio.decodeMusic(music.name, await assetBytes(url, res));
    })();
    audio.beginMusicLoad(music.name, load);
    await load;
    if (audio.currentMusic !== claimed) return; // something else owns the channel now
  }
  if (!enteringRoom(num)) return; // they left while it downloaded
  void audio.playMusic(music.name, url, music.loopSample);
}

/**
 * Everything a room needs to SOUND right: its voices, the leg-final remarks if it is a
 * leg-final room, and its music. Awaited by the room entry, which does not complete
 * until this does — and fails if it does not.
 *
 * Fetched in parallel; the reasoning is in the comment on the call itself, which is where
 * the trade actually lives.
 */
async function loadRoomAudio(num: number, nnn: string, fftBytes: Uint8Array): Promise<void> {
  // In PARALLEL, and the reason is a change of metric. While the room appeared before its
  // audio, serializing kept a 6.75 MB track from crowding out the 2.43 MB the opening
  // conversation needs — first-sound was what mattered. Now the room does not appear until
  // all of it is in, so the only figure that matters is when the LAST byte lands, and for
  // that a serial chain simply wastes the link. It also keeps each load starting at the
  // moment it always did, which the music depends on (see startRoomMusic).
  //
  // `Promise.all` rejects on the first failure, which is what the entry wants — but the
  // others keep downloading rather than being cancelled. That is deliberate: they are
  // already in flight, the retry will want them, and aborting them would only guarantee
  // the retry starts from nothing.
  await Promise.all([loadBorderLines(num), loadRoomVoices(num, nnn, fftBytes), startRoomMusic(num)]);
}

/** Make a fish "talk": show the next subtitle of its colour code (M/V) and play its voice. */
export function talk(which: 'little' | 'big'): void {
  wake();
  if (!subs) return;
  const code = which === 'little' ? 'M' : 'V';
  const l = subLang();
  const lines = fftEntries.filter((e) => (l === 'cz' ? e.cz : e.en).color === code && (l === 'cz' ? e.cz : e.en).text);
  if (lines.length === 0) return;
  const entry = lines[talkIdx[which] % lines.length]!;
  talkIdx[which]++;
  const t = l === 'cz' ? entry.cz : entry.en;
  if (subsOn()) subs.newSubtitle(t.text, t.color, count);
  audio.play(entry.name, 1, MLUVI_PRIOR[which], 'voice'); // voice at the fish's mluvi priority (drives lip-sync)
}
