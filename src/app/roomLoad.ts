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
import { audio } from './audioEngine.js';
import { beginRoomArt, curNum, ensureAiRoom, ensureEnhancedArt } from './art.js';
import { booted } from './stageState.js';
import { count, fftEntries, setFfr, setFftEntries, setPokus, subs, talkIdx } from './gameState.js';
import { depthOfRoom } from '../data/world.js';
import { enhancedArtActive, graphics } from './renderSettings.js';
import { mapLaunching } from './roomLaunch.js';
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
    const [ffrRes, fftRes] = await Promise.all([
      fetch(host.ffrUrl(num)),
      fetch(`/data/Title/${nnn}.fft`),
    ]);
    if (!ffrRes.ok) throw new Error(`failed to load room ${num}: ${ffrRes.status}`);
    const parsed = parseFfr(new Uint8Array(await ffrRes.arrayBuffer()));
    // WIN "Favorites" palette gag (URoom.pas:1312-1355): swap the pink placeholder colours
    // for the Windows system theme, so the fake windows look like a real desktop.
    setFfr(
      ROOMS[num - 1]?.jmeno === 'WIN'
        ? { ...parsed, palette: applyWinDesktopPalette(parsed.palette) }
        : parsed,
    );
    const fftBytes = fftRes.ok ? new Uint8Array(await fftRes.arrayBuffer()) : new Uint8Array(4);
    setFftEntries(fftRes.ok ? parseFft(fftBytes) : []);
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
    const enhanced = ensureEnhancedArt(num);
    const art = enhancedArtActive()
      ? Promise.all([enhanced, graphics === 'ai' ? ensureAiRoom(num) : Promise.resolve()])
      : Promise.resolve();
    // Audio is the bulk of a room entry's bytes and none of it is needed to DRAW the
    // room: 4.30 MB of .ffs voices plus a 5.75 MB music track for PRVNI, against
    // ~2.14 MB of room-specific core+art bytes. On a capped link they simply crowd the
    // art out, so both wait for it — a low-priority hint was measured and is not enough
    // (KOSTE's first frame: 35.5s with the hint, 27.4s with the wait).
    //
    // The cost is a short window after the room appears in which a room-specific line
    // is silent (subtitles still show; audio.clearRoom() keeps it silent rather than
    // wrong). That is a much better trade than the black stage it replaces, and it
    // closes as soon as the package lands.
    const afterArt = (): void => {
      if (bootLoad) return;
      loadRoomVoices(num, nnn, fftBytes);
      startRoomMusic(num);
    };
    // Both arms: nothing in `art` rejects today, but if a future edit made it throw,
    // a fulfilment-only handler would leave the room permanently silent AND strand the
    // loading overlay over a playable game.
    void art.then(afterArt, afterArt);
  } finally {
    // Always drop the guard, even if a fetch/parse threw: on error we fall back to
    // the pre-existing behaviour (the previous room stays shown) rather than leaving
    // the stage wedged black with no recovery. On success it runs once the room is
    // built, so the next frame paints the new room.
    setRoomLoading(false);
    setRoomLoadSeq(roomLoadSeq + 1);
    setForceRoomRedraw(true);
    wake();
  }
}

/**
 * Fetch one sound package: its .fft index and its .ffs bodies. Null if either is
 * missing — every package is optional, and losing one costs its lines, never the game.
 */
export async function fetchSoundPkg(
  fftUrl: string,
  ffsUrl: string,
  deferred = false,
): Promise<{ fft: Uint8Array; ffs: Uint8Array } | null> {
  // A `deferred` package holds chatter, never anything the player is waiting on, so it
  // asks the browser to schedule it behind everything else: x01 alone is 0.74 MB, and
  // it must not compete with the room art or the next room's voices. `priority` is an
  // optional RequestInit field — browsers that lack it ignore it.
  const init = deferred ? ({ priority: 'low' } as RequestInit) : undefined;
  try {
    const [fft, ffs] = await Promise.all([
      fetch(fftUrl, init).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(fftUrl)))),
      fetch(ffsUrl, init).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(ffsUrl)))),
    ]);
    return { fft: new Uint8Array(fft), ffs: new Uint8Array(ffs) };
  } catch {
    return null;
  }
}

/**
 * Fetch a package and keep it for the whole session (x00/x02/x03, x01, restored). The
 * audio engine then holds the only parsed copy: an FFT record carries both the sample
 * and its subtitle, so nothing else needs to index it to render a line.
 */
export async function loadSoundPkg(
  id: string,
  fftUrl: string,
  ffsUrl: string,
  deferred = false,
): Promise<boolean> {
  const pkg = await fetchSoundPkg(fftUrl, ffsUrl, deferred);
  if (!pkg) return false;
  audio.loadGlobal(id, pkg.fft, pkg.ffs);
  return true;
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
let borderLinesLoading = false;
function loadBorderLines(num: number): void {
  if (borderLinesLoading || depthOfRoom(num) !== 15) return;
  borderLinesLoading = true;
  void loadSoundPkg('x01', '/data/Title/x01.fft', '/data/Sound/x01.ffs', true).then((ok) => {
    if (ok) return;
    borderLinesLoading = false; // let the next leg-final room try again
    console.warn('[audio] x01 unavailable — the leg-final border remarks stay silent');
  });
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
const voiceLoads = new Map<string, Promise<ArrayBuffer | null>>();
/**
 * False from room entry until the room's .ffs has SETTLED — arrived, or failed/absent.
 * Gates the dialogue queue (see SoundFns.voicesReady) so an opening conversation is not
 * consumed silently while the package is still downloading. "Settled" rather than
 * "loaded" on purpose: a room with no voice package, or a failed fetch, must let the
 * queue run rather than stall it forever.
 */
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

export function loadRoomVoices(num: number, nnn: string, fftBytes: Uint8Array): void {
  if (!enteringRoom(num)) return;
  loadBorderLines(num);
  let pending = voiceLoads.get(nnn);
  if (pending === undefined) {
    pending = fetch(`/data/Sound/${nnn}.ffs`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    voiceLoads.set(nnn, pending);
    void pending.then(() => voiceLoads.delete(nnn));
  }
  void pending.then((buf) => {
    if (curNum !== num) return;
    if (buf) audio.setRoom(nnn, fftBytes, new Uint8Array(buf));
    roomVoicesSettled = true;
    markVoicesSettled();
    wake(); // the dialogue queue was held on this; let it run on the next frame
  });
}

/** Room music (MusicCycle, URoom.pas:1568): loop the room's track, or silence it. */
export function startRoomMusic(num: number): void {
  if (!enteringRoom(num)) return;
  const music = musicForCHud(ROOMS[num - 1]?.cHud ?? -1);
  if (music) void audio.playMusic(music.name, `/data/Music/${music.name}.wav`, music.loopSample);
  else audio.stopMusic();
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

/** Turn-first-then-move; horizontal turns animate (stav_otocka), moves slide. */
