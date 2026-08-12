/**
 * The boot sequence, in load order: fonts, the panel and map graphics, the global sound
 * packages, room 7, then the first frame. (The save store is opened earlier, in
 * `main.ts`, because `migrateSaves()` has to precede every `ff.*` read.)
 *
 * What is critical and what is optional is documented inline — nearly all of it is
 * optional, and the pattern is the same each time: a failed fetch costs its feature,
 * never the game.
 *
 * This is a function rather than module-scope top-level await on purpose. An imported
 * module is evaluated before any statement of its importer, so at module scope this
 * would run before `main.ts`'s device gate and before `migrateSaves()`. `runBoot()` is
 * awaited from `main.ts` at exactly the point these statements used to sit.
 */
import { beginMapArt, curNum, mapArtHolding } from './art.js';
import { audio } from './audioEngine.js';
import { loadingEl } from './dom.js';
import { initFeedback } from './feedback.js';
import { startFrames } from './frameClock.js';
import { engine, setFont } from './gameState.js';
import { maybeShowWebglNote, setLoadingMsg, showFatal } from './loadingUi.js';
import { ensureDeskyData } from './mapDraw.js';
import { playFirstRunIntro, startMenuMusic } from './mapNav.js';
import { graphics, renderer } from './renderSettings.js';
import { settings } from './playerSettings.js';
import { loadParchment } from './roomLaunch.js';
import { loadRoom, loadSoundPkg } from './roomLoad.js';
import { ui } from './screenState.js';
import { setBooted, setSubFontReady } from './stageState.js';
import { lengthOfRecord } from '../core/record.js';
import { parseBmp } from '../data/bmp.js';
import { parseFfp } from '../data/ffp.js';
import { roomByNumber } from '../data/roomTable.js';
import { initAnalytics } from '../platform/analytics.js';
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

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initBoot(h: BootHost): void {
  host = h;
}

/** Run the boot sequence. Awaited once, from `main.ts`. */
export async function runBoot(): Promise<void> {
  setFont(await FontData.load('/data/Intro'));
  setLoadingMsg('Loading fonts…');
  // Enhanced subtitle font (FreeSans Bold, the FFNG subtitle face). Optional: if it
  // fails to load, enhanced mode silently falls back to the baked bitmap subtitles.
  // Enhanced subtitle fonts — all bundled + OFL/GPL so they render identically on
  // every platform. Mulish/Manrope/Jost are variable (weight axis 100-900);
  // FFSubtitle is the original FreeSans Bold. If loading fails, enhanced mode
  // silently falls back to the baked bitmap subtitles.
  {
    const faces: ReadonlyArray<[string, string, string]> = [
      ['FFSubtitle', '/enhanced/subtitle.ttf', '700'],
      ['Mulish', '/fonts/Mulish.ttf', '100 900'],
      ['Manrope', '/fonts/Manrope.ttf', '100 900'],
      ['Jost', '/fonts/Jost.ttf', '100 900'],
    ];
    let anyLoaded = false;
    await Promise.all(
      faces.map(async ([family, url, weight]) => {
        try {
          const face = new FontFace(family, `url(${url})`, { weight });
          await face.load();
          document.fonts.add(face);
          anyLoaded = true;
        } catch {
          /* this face is unavailable; others / bitmap fallback still work */
        }
      }),
    );
    setSubFontReady(anyLoaded);
  }
  // Control-panel overlay graphic (TOvl / panel.ffp).
  setLoadingMsg('Loading graphics…');
  try {
    const pf = await fetch('/data/Menu/panel.ffp').then((r) => r.arrayBuffer());
    ui.panel = parseFfp(new Uint8Array(pf));
  } catch {
    /* panel optional */
  }
  // World map assets (mapa-0/mapa-1/maska + node sprites n0..n4).
  try {
    const files = ['mapa-0.BMP', 'mapa-1.BMP', 'maska.BMP', 'n0.BMP', 'n1.BMP', 'n2.BMP', 'n3.BMP', 'n4.BMP'];
    const bmps = await Promise.all(
      files.map((f) => fetch(`/data/Menu/${f}`).then((r) => r.arrayBuffer()).then((b) => parseBmp(new Uint8Array(b)))),
    );
    ui.worldMap = new WorldMap(bmps[0]!, bmps[1]!, bmps[2]!, bmps.slice(3));
    // The AI-upscaled map (Phase B) is NOT loaded here: it is fetched lazily the first
    // time the map is about to be shown in the `ai` tier (beginMapArt), so other tiers
    // pay nothing for it.
  } catch {
    /* map optional */
  }
  await loadParchment(); // the room-entry parchment; optional, never fatal (roomLaunch.ts)
  // World-map record info panel assets (krokoměr background, button icons, digit
  // glyphs) + the level name-plaque data for the current language (UMain.pas:341).
  try {
    const [krokomer, ikonky, cisla] = await Promise.all(
      ['krokomer.BMP', 'ikonky.BMP', 'cisla.BMP'].map((f) =>
        fetch(`/data/Menu/${f}`).then((r) => r.arrayBuffer()).then((b) => parseBmp(new Uint8Array(b))),
      ),
    );
    ui.infoPanelAssets = { krokomer: krokomer!, ikonky: ikonky!, cisla: cisla! };
  } catch {
    /* info panel optional */
  }
  await ensureDeskyData();

  setLoadingMsg('Loading sound…');
  // The persistent global packages, in the order the original loads them: x00 effects,
  // x03 ambient chatter (the "ob-*" idle lines, StdKecej / vyber_hlasku) and x02 death
  // commentary (the "smrt-*" lines, StdSmrt). Each is optional — a missing one costs
  // its lines, never the game. Kept sequential, as before: they are large, and the boot
  // path is what the UI probes' 5 s budget is measured against.
  for (const id of ['x00', 'x03', 'x02']) {
    await loadSoundPkg(id, `/data/Title/${id}.fft`, `/data/Sound/${id}.ffs`);
  }
  setLoadingMsg('Loading the world…');
  await loadRoom(7);
  // Critical assets: without the control panel or the world map the game is
  // unplayable, so a missing/broken deploy of these is a fatal error (rather than
  // the silent graceful-degradation the optional audio packages get).
  if (!ui.panel || !ui.worldMap) {
    showFatal('Some core game files are missing. Please try again, or check the installation.');
    throw new Error('missing critical assets: ' + (!ui.panel ? 'panel ' : '') + (!ui.worldMap ? 'worldMap' : ''));
  }
  // The two lines the 1998 release referenced but shipped without (public/restored/,
  // built by tools/build-restored-sounds.ts) — `pyr-m-nudi` and `jes-v-potvora2`. A
  // package of its own rather than a patched 025/063, so the committed 1998 data stays
  // byte-for-byte what ALTAR released.
  //
  // Fetched AFTER boot and off the critical path: each awaited package above is another
  // serialized round trip before the game can start, and loading this one inline was
  // measured pushing UI probes past their 5 s boot budget. The cost of that choice is
  // real but small — if a player reaches room 25 or 63 before it lands, that one line
  // keeps the 1998 silence, so the failure mode is the status quo ante, not a break.
  void loadSoundPkg('restored', '/restored/restored.fft', '/restored/restored.ffs', true).then(
    (ok) => {
      if (!ok) console.warn('[audio] restored package unavailable — PYRAMIDA/JESKYNE keep the 1998 silence');
    },
  );

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
}
