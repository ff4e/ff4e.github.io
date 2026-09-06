/**
 * The boot sequence, in load order: fonts, the panel and map graphics, the global sound
 * packages, room 7, then the first frame. (The save store is opened earlier, in
 * `main.ts`, because `migrateSaves()` has to precede every `ff.*` read.)
 *
 * Nothing here is optional any more. Every asset boot fetches is one the 1998 game
 * shipped, so a failure ends the session on the failure screen and names the file (see
 * `loadingUi.ts`) rather than costing its feature quietly. That is the whole of the
 * all-or-nothing rule as it applies to boot, and it is why none of these loaders catch.
 *
 * This is a function rather than module-scope top-level await on purpose. An imported
 * module is evaluated before any statement of its importer, so at module scope this
 * would run ahead of everything `main.ts` sequences, `migrateSaves()` included. `runBoot()` is
 * awaited from `main.ts` at exactly the point these statements used to sit.
 */
import { beginMapArt, curNum, mapArtHolding } from './art.js';
import { audio } from './audioEngine.js';
import { loadingEl } from './dom.js';
import { initFeedback } from './feedback.js';
import { startFrames } from './frameClock.js';
import { engine, setFont } from './gameState.js';
import { maybeShowWebglNote, setLoadingMsg } from './loadingUi.js';
import { ensureDeskyData } from './mapDraw.js';
import { playFirstRunIntro, startMenuMusic } from './mapNav.js';
import { graphics, renderer } from './renderSettings.js';
import { settings } from './playerSettings.js';
import { voiceUrl } from '../audio/ffs2.js';
import { loadParchment } from './roomLaunch.js';
import { loadRoom, requireSoundPkg } from './roomLoad.js';
import { ui } from './screenState.js';
import { setBooted, setSubFontReady } from './stageState.js';
import { lengthOfRecord } from '../core/record.js';
import { parseBmp, type Bmp } from '../data/bmp.js';
import { parseFfp } from '../data/ffp.js';
import { roomByNumber } from '../data/roomTable.js';
import { initAnalytics } from '../platform/analytics.js';
import { initHaptics } from '../platform/haptics.js';
import { decodeAsset, requiredBytes } from '../render/assetFetch.js';
import { FontData } from '../render/font.js';
import { webgl2Available } from '../render/glScreen.js';
import { WorldMap } from '../render/worldMap.js';

/**
 * The one name this module needs from `main.ts`: the info line under the room, which
 * boot refreshes once room 7 is up.
 */
export interface BootHost {
  readonly setInfo: () => void;
}

let host!: BootHost;

/** Fetch + parse one of boot's 1998 bitmaps. Every one of them is required. */
async function bootBmp(url: string, what: string): Promise<Bmp> {
  return parseBmp(await requiredBytes(url, what, 'mustHave'));
}

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initBoot(h: BootHost): void {
  host = h;
}

/** Run the boot sequence. Awaited once, from `main.ts`. */
export async function runBoot(): Promise<void> {
  setFont(await FontData.load('/data/Intro'));
  setLoadingMsg('Loading fonts…');
  // Enhanced subtitle fonts — all bundled + OFL/GPL so they render identically on every
  // platform. Mulish/Manrope/Jost are variable (weight axis 100-900); FFSubtitle is the
  // original FreeSans Bold (the FFNG subtitle face).
  //
  // Loaded from BYTES rather than by handing `FontFace` a `url()`. That form is a third
  // network door: it retries nothing, applies no deadline, and its rejection cannot tell
  // a 404 from a dropped connection — so this loop used to catch per face and carry on,
  // and four shipped fonts could quietly become baked bitmap subtitles with nothing said.
  // Through the door they are required like everything else.
  //
  // `subFontReady` stays a live flag rather than becoming a constant: the renderer's
  // bitmap path is still reachable at runtime (the probes toggle it), and that is a
  // drawing decision, not a loading one.
  {
    const faces: ReadonlyArray<[string, string, string]> = [
      ['FFSubtitle', '/enhanced/subtitle.ttf', '700'],
      ['Mulish', '/fonts/Mulish.ttf', '100 900'],
      ['Manrope', '/fonts/Manrope.ttf', '100 900'],
      ['Jost', '/fonts/Jost.ttf', '100 900'],
    ];
    await Promise.all(
      faces.map(async ([family, url, weight]) => {
        const bytes = await requiredBytes(url, 'the subtitle fonts', 'mustHave');
        const face = new FontFace(family, bytes.buffer as ArrayBuffer, { weight });
        // A font that arrived and will not parse is a broken build, but it is
        // indistinguishable here from a truncated download — the same guess `decodeAsset`
        // makes for images, and for the same reason.
        document.fonts.add(await decodeAsset(url, 'mustHave', () => face.load()));
      }),
    );
    setSubFontReady(true);
  }
  // Control-panel overlay graphic (TOvl / panel.ffp).
  setLoadingMsg('Loading graphics…');
  const panelUrl = '/data/Menu/panel.ffp';
  ui.panel = parseFfp(await requiredBytes(panelUrl, 'the control panel', 'mustHave'));
  // World map assets (mapa-0/mapa-1/maska + node sprites n0..n4).
  {
    const files = ['mapa-0.BMP', 'mapa-1.BMP', 'maska.BMP', 'n0.BMP', 'n1.BMP', 'n2.BMP', 'n3.BMP', 'n4.BMP'];
    const bmps = await Promise.all(files.map((f) => bootBmp(`/data/Menu/${f}`, 'the world map')));
    ui.worldMap = new WorldMap(bmps[0]!, bmps[1]!, bmps[2]!, bmps.slice(3));
    // The AI-upscaled map (Phase B) is NOT loaded here: it is fetched lazily the first
    // time the map is about to be shown in the `ai` tier (beginMapArt), so other tiers
    // pay nothing for it.
  }
  await loadParchment(); // the room-entry parchment (roomLaunch.ts)
  // World-map record info panel assets (krokoměr background, button icons, digit
  // glyphs) + the level name-plaque data for the current language (UMain.pas:341).
  {
    const [krokomer, ikonky, cisla] = await Promise.all(
      ['krokomer.BMP', 'ikonky.BMP', 'cisla.BMP'].map((f) => bootBmp(`/data/Menu/${f}`, 'the world map info panel')),
    );
    ui.infoPanelAssets = { krokomer: krokomer!, ikonky: ikonky!, cisla: cisla! };
  }
  await ensureDeskyData();

  setLoadingMsg('Loading sound…');
  // The persistent global packages, in the order the original loads them: x00 effects,
  // x03 ambient chatter (the "ob-*" idle lines, StdKecej / vyber_hlasku) and x02 death
  // commentary (the "smrt-*" lines, StdSmrt). 2.4 MB — it was 8.3 before the speech
  // packages were staged as AAC — and boot no longer tolerates
  // losing any of it: a game with no death commentary is a quieter game than the one
  // ALTAR shipped, and the player is the last person able to notice that. Kept
  // sequential, as before: they are large, and the boot path is what the UI probes'
  // 5 s budget is measured against. Each is also DECODED here (x00 excepted, which is
  // still the 1998 `.ffs` and decodes per sound on use) — see `decodeFfs2`
  // (src/audio/ffs2Decode.ts) for why every segment, up front, rather than on first play,
  // and for what it retains: x03 + x02 are ~45 MB of AudioBuffers held for the session.
  const GLOBAL_PKGS: ReadonlyArray<[string, string]> = [
    ['x00', 'the sound effects'],
    ['x03', 'the fish chatter'],
    ['x02', 'the death commentary'],
  ];
  for (const [id, what] of GLOBAL_PKGS) {
    await requireSoundPkg(id, `/data/Title/${id}.fft`, voiceUrl(id), what);
  }
  setLoadingMsg('Loading the world…');
  await loadRoom(7);
  // The two lines the 1998 release referenced but shipped without (public/restored/,
  // built by tools/build-restored-sounds.ts) — `pyr-m-nudi` and `jes-v-potvora2`. A
  // package of its own rather than a patched 025/063, so the committed 1998 data stays
  // byte-for-byte what ALTAR released.
  //
  // Fetched AFTER boot and off the critical path: each awaited package above is another
  // serialized round trip before the game can start, and loading this one inline was
  // measured pushing UI probes past their 5 s boot budget. Off the critical path is not
  // the same as optional, though — it used to warn to the console and leave the two
  // rooms silent, and a console warning is not a thing a player reads. Unhandled on
  // purpose: the post-boot trap in `loadingUi.ts` turns an asset failure into the
  // failure screen wherever it happens, so this needs no catch of its own.
  void requireSoundPkg('restored', '/restored/restored.fft', voiceUrl('restored', '/restored'), 'the restored 1998 lines', true);

  // Boot: on first run, auto-play the intro (logo → intro) before the map, then
  // flip the persisted flag so later runs go straight to the map (the original's
  // START→NO first-run gate, UMain.pas:677-682). The intro is always replayable
  // from the map's top-left corner.
  if (settings.introSeen) {
    ui.screen = 'map'; // the game opens on the world map
    ui.mapRevealStart = performance.now(); // animate the map in from the start
    // Start the `ai` tier's map art HERE rather than leaving it to the loop's first
    // frame, so the hide below already sees the wait: on this path the map's loading
    // state is boot's loading state, and the overlay simply never comes down between
    // them. Left to the loop it would hide for a frame and re-show.
    beginMapArt();
    startMenuMusic(); // menu music (silent until the first user gesture unlocks audio)
  } else {
    playFirstRunIntro();
  }
  host.setInfo();
  // Boot complete — hide the loading overlay, stop treating errors as fatal, and
  // (if applicable) surface the software-renderer note.
  setBooted(true);
  console.info(`Fish Fillets 4ever v${__APP_VERSION__} (${__BUILD_HASH__} · ${__BUILD_DATE__})`);
  initAnalytics(); // web analytics (platform layer): no-op in dev / without a token
  initHaptics(); // warm the Taptic plugin on the native host; no-op in a browser
  // The feedback form. Reads the live game state only when the player opens it — there is
  // no collection before that, and nothing is ever sent without a click (see feedback.ts).
  ui.feedback = initFeedback({
    build: { version: __APP_VERSION__, hash: __BUILD_HASH__, date: __BUILD_DATE__ },
    webgl2: () => webgl2Available(),
    game: () => {
      const inRoom = ui.screen === 'room' && curNum > 0;
      const desc = inRoom ? roomByNumber(curNum) : undefined;
      return {
        screen: ui.screen,
        roomNum: inRoom ? curNum : null,
        roomName: desc?.jmeno ?? null,
        roomTitle: desc?.en ?? null,
        graphics,
        renderer,
        subtitles: settings.subtitles,
        moves: lengthOfRecord(engine?.srecord ?? ''),
        record: engine?.srecord ?? '',
      };
    },
  });
  // ...unless the map is still waiting for the art it will be presented in, in which case
  // boot is not over from the player's side and the overlay stays up (see syncLoadingUi).
  if (loadingEl && !mapArtHolding()) loadingEl.hidden = true;
  maybeShowWebglNote();
  startFrames();

  // Browsers gate audio behind a user gesture: on the first interaction, resume the
  // context and (re)start the menu music if we're on the map.
  const unlockAudio = (): void => {
    audio.resume();
    if (ui.screen === 'map') startMenuMusic();
  };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // The fallback half of surviving the app switcher. iOS interrupts the audio context when
  // the app leaves the screen, and the repair is driven from inside the engine, off the
  // interruption iOS announces (`onStateChange`) — not from here, because there is no
  // reliable event out here to hang it on: `visibilitychange` fires too early to act on,
  // which is what the first attempt at this bug got wrong.
  //
  // This is what remains for the case where the announcement that iOS has finished never
  // arrives: the interruption stays remembered and the next touch acts on it. A touch is
  // also the only moment iOS honours a plain `resume()`, which is what every non-iOS
  // browser needs after parking a context. Note the game gives no gesture of its own —
  // sounds are played from the logic tick, long after the touch that caused them has
  // expired — so this listener is the only touch the audio ever sees.
  //
  // Not `{ once: true }`: an interruption can happen any number of times — the app
  // switcher, a phone call, Siri — and this has to work on every one of them. On a context
  // that is already running it costs a state read.
  const wakeAudio = (): void => audio.handleGesture();
  window.addEventListener('pointerdown', wakeAudio);
  window.addEventListener('keydown', wakeAudio);
}
