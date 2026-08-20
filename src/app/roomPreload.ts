/**
 * Everything a room's PLAY can demand that is neither its art nor its sound — fetched on
 * the deliberate act of ENTERING the room, and held for.
 *
 * ── The rule this file exists to enforce ──────────────────────────────────────
 *
 *   **No asset is fetched while a room is being played.**
 *
 * PR #104 established the principle for a room's art, voices, music and subtitles:
 * entering a room is a player-initiated act, so everything that room will use is fetched
 * up front, the entry WAITS for it, and a failure ends the session there rather than in
 * the middle of play. It left three places where that was not true, all of them assets
 * fetched at the moment the room asked for them — which is to say minutes into a room,
 * where a connection drop takes the session with it:
 *
 *  1. **KUFRIK's briefcase cutscenes**, 5.32 MB, fetched when the briefcase sequence
 *     reaches `faze === 8` and when both fish reach the tutorial spot.
 *  2. **The leg story page**, ~301 kB (+~667 kB in the `ai` tier), fetched when a
 *     depth-15 room is won and the win countdown lapses.
 *  3. **ZAVER**, ~3.7 MB, chained out of the last leg's page at the end of a playthrough.
 *
 * The first two are closed by this module: `preloadRoomPlayAssets` is awaited by the room
 * entry, so the room does not appear until they are in and does not appear at all if they
 * do not. The precedent for the shape is `loadBorderLines` (roomLoad.ts), which has done
 * exactly this for the leg-final fish remarks since #103.
 *
 * ── ZAVER is the third, and it is deliberately NOT held for ───────────────────
 * The judgement call the task left open, decided here so it is not re-litigated by
 * inference from the code.
 *
 * ZAVER is not a mid-play fetch. Entering it is a ROOM ENTRY like any other — it shows
 * the loading parchment, it is held by `roomLoading`/`roomArtPending`/`roomAudioPending`,
 * and every byte of it is already `mustHave`, so a failure is reported and offers Reload
 * exactly where the player can see it. The rule above is not violated by it, and blocking
 * on it would buy no guarantee that the room's own entry does not already give.
 *
 * What it does have is bad TIMING: 3.7 MB arriving at the emotional end of a playthrough,
 * one dismissal after the last story page. So it is WARMED — started when the player
 * enters the final leg's last room, unawaited, at `niceToHave`, and only once the entry
 * that would otherwise be competing with it has already settled. If it lands, the finale
 * is instant; if it does not, ZAVER's own entry fetches it and behaves exactly as it does
 * today.
 *
 * Blocking on it instead was the alternative, and the reason against is that the player
 * may not WIN that room. Holding a ~20 s download (at the 1.5 Mbps this game is measured
 * against) at the front of every attempt at the hardest room in the game, for a room that
 * only a win reaches, charges the failures for the success.
 *
 * The warm deliberately stops at the network. It does not touch `ensureAiRoom`, whose
 * cache is a three-room LRU of DECODED art: warming it would evict art for a room the
 * player is standing in, to hold ~20 MB of decoded frames for a room they may not reach.
 */
import { ROOMS } from '../data/roomTable.js';
import { ZAVER_ROOM, storyPageOfRoom } from '../data/world.js';
import { finaleFollows } from './mapNav.js';
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
 * A hold of its own, alongside `roomArtPending()` and `roomAudioPending()`, rather than an
 * extension of either — the room is still BUILT at exactly the moment it always was, and
 * the two existing holds keep meaning precisely what their names say. What it adds is that
 * the room is not handed the stage until the things its PLAY can demand are in hand too.
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
 * ── KUFRIK, 5.32 MB ───────────────────────────────────────────────────────────
 * The briefcase story (kufr256.BMP + demo.pck + script.txt, 5.31 MB) used to be fetched
 * when the briefcase sequence reached `faze === 8`, and the tutorial recording (help.cap,
 * 17 kB) when both fish reached the tutorial spot. Both are now in hand before the room
 * is on screen, so `startCutscene` and `startShowmode` issue no request at all.
 *
 * The recording is PARSED here so that starting the demonstration can be synchronous, and
 * kept rather than re-parsed: `advanceShowmode` only ever reads it (`actions[idx++]`), so
 * a second demonstration replaying the same array shares nothing mutable.
 *
 * Single-flighted for the reason `loadBorderLines` is (roomLoad.ts): a die-and-restart can
 * put two entries to one room in flight, and two concurrent cache writes of one 4.92 MB
 * entry fail with net::ERR_CACHE_WRITE_FAILURE — a transient error that would end the
 * session over a file the first entry was fetching successfully. Retracted on failure, so
 * the next entry retries rather than joining a rejected promise for the whole session.
 *
 * NOT included: the `ai` tier's upscaled frames (`enhanced-ai/_kufr`, 46 MB). They are
 * prefetched from the cutscene's DRAW path at `niceToHave` with a shipped per-frame
 * fallback, and preloading 46 MB for one cutscene is not a trade worth making. That is the
 * one thing KUFRIK still fetches while it is being played, and the one that can afford to.
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
 * ── The leg story page, ~301 kB (+~667 kB in the `ai` tier) ────────────────────
 * `showLegImage` is the ONLY thing that runs when the win countdown lapses, so its fetch
 * happened during play, at the moment the player had just won. Entering a depth-15 room
 * (or ZAVER) now fetches that room's page and the entry waits for it.
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

/** Once per session: a warm that failed is not worth a second 3.7 MB attempt. */
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
export function warmFinaleRoom(num: number, ffrUrl: (n: number) => string): void {
  if (finaleWarmed || !finaleFollows(num)) return;
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
    // own entry asks for it. Holding the buffers instead would be ~3.7 MB retained for a
    // room the player may never reach, to save a cache read that costs milliseconds.
    void requiredBytes(url, 'the ending', 'niceToHave', { init: { priority: 'low' } as RequestInit }).catch(
      () => {},
    );
  }
}
