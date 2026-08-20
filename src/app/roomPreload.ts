/**
 * What a room's PLAY can demand beyond its art and its sound — fetched on the deliberate
 * act of ENTERING the room, and held for.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 *
 *   **Nothing a room's play can DEMAND is fetched while that room is played.** A later
 *   room may be warmed once this entry has settled, at `niceToHave`, where it cannot fail
 *   anything; and one thing that has a shipped fallback is still fetched from the draw
 *   path. Both exceptions are named below.
 *
 * The strong form of that sentence — "no asset is fetched while a room is played" — is
 * what this file used to claim, and it was false in this very module: `warmFinaleRoom`
 * downloads ZAVER while the last leg-final room is on screen. A rule a file breaks is
 * worse than a rule with an exception in it, because the next reader "fixes" the code to
 * match the slogan.
 *
 * PR #104 established the principle for a room's art, voices, music and subtitles.
 * Entering a room is player-initiated, so everything that room will use is fetched up
 * front, the entry WAITS for it, and a failure ends the session THERE — on the parchment,
 * with nothing in progress and Reload costing the player nothing — instead of in the
 * middle of a room they were solving. What was left:
 *
 *  1. **KUFRIK's briefcase cutscene**, 5.32 MB. Not, as this comment used to say, "minutes
 *     into a room": the briefcase falls and opens in the room's opening seconds
 *     (`kufrik.ts`, faze 0 -> 8), so every player already paid this download a beat after
 *     the room appeared. Preloading does not ADD ~28 s at 1.5 Mbps — it MOVES it, off a
 *     room the player had started and onto the parchment, and makes it survivable.
 *  2. **The leg story page**, ~301 kB (+~667 kB in the `ai` tier), fetched when a depth-15
 *     room is won and the win countdown lapses.
 *  3. **ZAVER**, chained out of the last leg's page at the end of a playthrough — the one
 *     that is warmed rather than held for, below.
 *
 * The room's own extra music was a fourth (`extraMusicOfRoom`, audio/music.ts); it is
 * sound, so it is preloaded with the rest of the sound in `roomLoad.ts`.
 *
 * `loadBorderLines` (roomLoad.ts) is the precedent for the shape — it has done exactly
 * this for the leg-final fish remarks since #103.
 *
 * ── Exception 1: ZAVER is warmed, not held for ────────────────────────────────
 * A ~9.6 MB download (FFR 451 kB + voices 3.22 MB + `rybky04` 5.75 MB) started when the
 * player enters the last leg-final room left unsolved: unawaited, `niceToHave`, and only
 * once that entry has settled so it never competes with the room being waited for.
 *
 * This is a real fetch during play, and it is here for TIMING, not safety. The safety is
 * already there: entering ZAVER is an ordinary room entry, with a parchment, the entry
 * holds, and every byte `mustHave`, so it fails loudly and survivably on its own. What the
 * warm buys is that the finale does not stall one dismissal after the last story page.
 *
 * It is not held for because the player may not WIN that room. Holding a ~50 s download at
 * the front of every attempt at the hardest room in the game, for a room only a win
 * reaches, charges the failures for the success.
 *
 * The warm stops at the network. It does not touch `ensureAiRoom`, whose cache is a
 * three-room LRU of DECODED art: warming it would evict art for the room the player is
 * standing in, to hold ~20 MB of frames for a room they may never see.
 *
 * ── Exception 2: the `ai` tier's cutscene frames ──────────────────────────────
 * `enhanced-ai/_kufr`, 46 MB, still prefetched from the cutscene's DRAW path at
 * `niceToHave`. A frame that has not arrived plays as the original region, which is a
 * shipped fallback and not a degradation anyone is misled by. 46 MB of room entry for one
 * cutscene is not a trade worth making.
 *
 * ── Known limitation ──────────────────────────────────────────────────────────
 * The entry holds are only consulted where the room is HANDED OVER (`roomLaunch.ts`) and
 * where the spinner is decided (`loadingUi.ts`). The logic tick and the input gates test
 * `roomLoading`/`roomArtPending()` only, so on the entry routes that do not go through the
 * map launch — the dev picker, a story-page Run/Replay, the ZAVER chain, and a map launch
 * with no parchment — the room ticks and accepts input under the spinner while these loads
 * are still in flight. That predates this module (`roomAudioPending` has the same gap) and
 * is not fixed here; see the `fish_fillets_entry_holds_direct_routes` task.
 */
import { ROOMS } from '../data/roomTable.js';
import { ZAVER_ROOM, finaleFollows, storyPageOfRoom } from '../data/world.js';
import { cutsceneAssets, setCutsceneAssets } from './gameState.js';
import { graphics } from './renderSettings.js';
import { musicForCHud } from '../audio/music.js';
import { parseBmp } from '../data/bmp.js';
import type { Bmp } from '../data/bmp.js';
import { parseHelpCap } from '../intro/helpCap.js';
import type { CapAction } from '../intro/helpCap.js';
import { requiredBlob, requiredBytes, requiredText } from '../render/assetFetch.js';

/** KUFRIK ("Briefcase Message"): the one room whose play runs a cutscene. */
const KUFRIK_ROOM = 2;

/**
 * False from room entry until everything below has SETTLED.
 *
 * Its own flag rather than an extension of `roomAudioPending`, so each still names one
 * thing and a failure can be told apart in a probe — but the two are always consulted
 * TOGETHER, through `roomEntryHeld()` in roomLoad.ts. Reading one without the other is the
 * mistake that flag would otherwise invite: a caller that treats `!roomAudioPending()` as
 * "the entry is done" proceeds while the story assets are still coming.
 */
let preloadPendingNum = 0;
export const roomPreloadPending = (): boolean => preloadPendingNum !== 0;

/**
 * Arm or release the hold, scoped to the room that owns it — for the same reason
 * `clearRoomAudioPending` is scoped: these loads outlive the entry that started them, so
 * an outcome for room A must not release a hold room B has since armed.
 */
export function setRoomPreloadPending(num: number): void {
  preloadPendingNum = num;
}
export function clearRoomPreloadPending(num: number): void {
  if (preloadPendingNum === num) preloadPendingNum = 0;
}

/**
 * Fetch everything `num`'s play can demand beyond its art and its sound. Awaited by the
 * room entry, which does not complete until this does — and fails if it does not.
 *
 * In parallel, and for the same reason `loadRoomAudio` is: the room does not appear until
 * all of it is in, so the only figure that matters is when the LAST byte lands, and a
 * serial chain would only waste the link. In practice no room is in both branches.
 */
export async function preloadRoomPlayAssets(num: number): Promise<void> {
  const leg = storyPageOfRoom(num);
  await Promise.all([
    num === KUFRIK_ROOM ? preloadCutscene() : null,
    leg !== 0 ? preloadLegPage(leg) : null,
  ]);
}

/**
 * KUFRIK's briefcase story (kufr256.BMP + demo.pck + script.txt, 5.31 MB) and its tutorial
 * recording (help.cap, 17 kB), so that `startCutscene` and `startShowmode` issue no request.
 *
 * The recording is PARSED here so starting the demonstration can be synchronous, and kept
 * rather than re-parsed: `advanceShowmode` only ever reads it (`actions[idx++]`), so a
 * second demonstration replaying the same array shares nothing mutable.
 *
 * Single-flighted for the reason `loadBorderLines` is (roomLoad.ts): a die-and-restart can
 * put two entries to one room in flight, and two concurrent cache writes of one 4.92 MB
 * entry fail with net::ERR_CACHE_WRITE_FAILURE — a transient error that would end the
 * session over a file the first entry was fetching successfully. Retracted on failure, so
 * the next entry retries rather than joining a rejected promise for the whole session.
 */
let showmodeCap: CapAction[] | null = null;
let cutscenePreload: Promise<void> | null = null;

/** The parsed tutorial recording, or null if this session has not fetched it yet. */
export const showmodeRecording = (): CapAction[] | null => showmodeCap;

export async function preloadCutscene(): Promise<void> {
  if (cutscenePreload === null) {
    const done = Promise.all([loadCutsceneAssets(), loadShowmodeCap()]).then(() => {});
    cutscenePreload = done;
    void done.catch(() => {
      if (cutscenePreload === done) cutscenePreload = null;
    });
  }
  await cutscenePreload;
}

/** The briefcase story's three files, published to `cutsceneAssets` for the demo to find. */
async function loadCutsceneAssets(): Promise<void> {
  if (cutsceneAssets) return;
  const what = 'the briefcase demonstration';
  const bytes = (u: string): Promise<Uint8Array> => requiredBytes(u, what, 'mustHave');
  const [bmp, pck, script] = await Promise.all([
    bytes('/data/Intro/kufr256.BMP'),
    bytes('/data/Intro/demo.pck'),
    requiredText('/data/Intro/script.txt', what, 'mustHave'),
  ]);
  setCutsceneAssets({ bmp, pck, script });
}

async function loadShowmodeCap(): Promise<void> {
  if (showmodeCap) return;
  showmodeCap = parseHelpCap(await requiredBytes('/data/Intro/help.cap', 'the KUFRIK demonstration', 'mustHave'));
}

/**
 * The leg story page, ~301 kB (+~667 kB in the `ai` tier). `showLegImage` is the ONLY
 * thing that runs when the win countdown lapses, so its fetch happened during play, at the
 * moment the player had just won.
 *
 * One slot, replaced on each such entry, rather than a map of all nine: only the leg being
 * PLAYED can be reached from play, and keeping all nine would hold 8.7 MB for the sake of
 * a re-entry that reads the browser's own cache in milliseconds.
 *
 * In the `ai` tier the upscaled page is fetched too — as a BLOB, not a decoded bitmap. The
 * promise being made is that nothing is FETCHED while the room is played, and decoding is
 * not fetching; a 2560x1920 page is ~20 MB decoded, and holding that from room entry until
 * the win would be a real cost for no gain.
 *
 * Single-flighted PER LEG: a bare single-flight would have handed an entry to leg 5's room
 * the load for leg 3.
 */
let legPage: { leg: number; bmp: Bmp; ai: Blob | null } | null = null;
let legPageLoad: { leg: number; done: Promise<void> } | null = null;

/** The preloaded page for `leg`, or null if this entry did not preload one. */
export const preloadedLegPage = (leg: number): { bmp: Bmp; ai: Blob | null } | null =>
  legPage?.leg === leg ? legPage : null;

export async function preloadLegPage(leg: number): Promise<void> {
  if (legPage?.leg === leg && (legPage.ai !== null || graphics !== 'ai')) return;
  if (legPageLoad?.leg !== leg) {
    const done = (async () => {
      const aiUrl = `/enhanced-ai/_story/leg${leg}.webp`;
      const [bytes, ai] = await Promise.all([
        requiredBytes(`/data/Menu/00${leg}.$dv`, `the story page for leg ${leg}`, 'mustHave'),
        graphics === 'ai' ? requiredBlob(aiUrl, `the AI story page for leg ${leg}`, 'mustHave') : null,
      ]);
      legPage = { leg, bmp: parseBmp(bytes), ai };
    })();
    const entry = { leg, done };
    legPageLoad = entry;
    // Dropped whatever happens, so a failure is not what the next entry joins. The
    // identity check matters for the same reason `aiRoomCache`'s does: by the time this
    // runs, a later entry may already have installed a replacement under the same key.
    void done.catch(() => {}).then(() => {
      if (legPageLoad === entry) legPageLoad = null;
    });
  }
  await legPageLoad.done;
}

/** Once per session: a warm that failed is not worth a second 9.6 MB attempt. */
let finaleWarmed = false;

/**
 * Warm the browser cache for ZAVER, if winning the room just entered would finish the
 * game. See the header for why this is a warm and not a hold.
 *
 * Called AFTER the entry has settled, so it never competes with the room the player is
 * waiting for, and every request asks to be scheduled behind everything else. Every
 * failure is swallowed: at `niceToHave` there is nothing to report, and ZAVER's own entry
 * will ask again — loudly, and where it matters.
 */
export function warmFinaleRoom(num: number, ffrUrl: (n: number) => string, solved: ReadonlySet<number>): void {
  if (finaleWarmed || !finaleFollows(num, solved)) return;
  finaleWarmed = true;
  const nnn = String(ZAVER_ROOM).padStart(3, '0');
  const music = musicForCHud(ROOMS[ZAVER_ROOM - 1]?.cHud ?? -1);
  const urls = [
    ffrUrl(ZAVER_ROOM),
    `/data/Title/${nnn}.fft`,
    `/data/Sound/${nnn}.ffs`,
    ...(music ? [`/data/Music/${music.name}.wav`] : []),
  ];
  for (const url of urls) {
    // The bytes are read and dropped: nothing here decodes or installs anything, because
    // the point is only to have the response in the browser's cache by the time ZAVER's
    // own entry asks for it. Holding the buffers instead would be ~9.6 MB retained for a
    // room the player may never reach, to save a cache read that costs milliseconds.
    void requiredBytes(url, 'the ending', 'niceToHave', { init: { priority: 'low' } as RequestInit }).catch(
      () => {},
    );
  }
}
