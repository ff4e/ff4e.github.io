/**
 * Getting on and off the world map, and the pages that sit between rooms: the leg
 * completion story image, the first-run intro, the options overlay and the credits roll.
 *
 * It decides where the player goes, and it draws the pages that are not the map and not
 * a room — the story image and the credits roll, which have nowhere else to live. What
 * it does NOT draw is the map itself (`mapDraw.ts`) or a room (`framePainter.ts`), which
 * is why a change to how the MAP looks never reads this file.
 */
import { aiCredits, ensureAiCredits } from './art.js';
import { audio } from './audioEngine.js';
import { endSilentFilm } from './cheats.js';
import { endShowmode } from './cutscene.js';
import { canvas, ctx, select, wrap } from './dom.js';
import { wake } from './frameClock.js';
import { perfPaint, setPerfPaint } from './framePacing.js';
import { activeScript, engine, poslMluv, subs } from './gameState.js';
import { intro, introMovie, logoMovie } from './introOverlay.js';
import { clearHeldKey } from './movement.js';
import { settings } from './playerSettings.js';
import { graphics } from './renderSettings.js';
import { O_NORMAL, O_OPTIONS, SCMAX, ui } from './screenState.js';
import { contentScaleFor, scalingFilterFor } from './stageGeometry.js';
import { musicUrl } from '../audio/music.js';
import { saveSettings } from '../core/settings.js';
import { bmpToRgba, parseBmp } from '../data/bmp.js';
import type { Bmp } from '../data/bmp.js';
import { REGISTERED_ROOMS, ZAVER_LEG, ZAVER_ROOM, branchOfRoom, depthOfRoom } from '../data/world.js';
import { CREDIT_SPEED, CREDIT_TICK_MS, Credits } from '../render/credits.js';
import { assetBlob, decodeAsset, isAssetError, optionalAsset, requiredBlob, requiredBytes } from '../render/assetFetch.js';
import { decodeCreditsImage } from '../render/creditsAsset.js';
import { preloadedLegPage } from './roomPreload.js';
import { hideLoadNote } from './loadNote.js';
import { reportAssetError } from './loadingUi.js';
import type { MapAction } from '../render/worldMap.js';

/**
 * The five names this module needs from `main.ts`.
 */
export interface MapNavHost {
  /** Hand the stage over to a room (the map -> room transition). */
  readonly enterRoom: (num: number, replay?: string) => void;
  /** Take down the AI credits overlay. */
  readonly hideAiCredits: () => void;
  /** Refresh the info line. */
  readonly setInfo: () => void;
  /** Which rooms the player has genuinely solved (cheated ones are a separate set). */
  readonly solved: ReadonlySet<number>;
  /** Stop the in-room play clock. */
  readonly stopRoomClock: () => void;
}

let host!: MapNavHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initMapNav(h: MapNavHost): void {
  host = h;
}

export function startMenuMusic(): void {
  // Unhandled on purpose. This used to swallow the failure — "menu music is non-critical,
  // and during boot an unhandled rejection would otherwise trip the boot-fatal handler" —
  // which is the game's first impression disappearing without a word. Tripping
  // the handler is now the intended outcome, and the trap in `loadingUi.ts` names the
  // asset instead of showing boot's generic sentence.
  void audio.playMusic('menu', musicUrl('menu'), 419772);
}

/**
 * Show the world map, tearing down the room's audio faithfully (Jedeme end
 * KillSnd + zrus_dialogy + ZrusTitulky, UMain.pas): stop the room music and all
 * voices, clear the dialogue queue and subtitles, then start the menu music.
 */
export function showMap(): void {
  host.stopRoomClock(); // bank this visit's play time before the room goes away
  endSilentFilm(); // TRoom.Done (URoom.pas:1513): leaving the room un-mutes the game
  ui.screen = 'map';
  select.value = 'map'; // keep the dev-bar Room picker in sync with the screen
  clearHeldKey(); // drop any held movement key when leaving the room
  endShowmode(); // leaving the room ends any KUFRIK demonstration
  if (engine) {
    engine.swim = null;
    engine.winCountdown = 0;
  }
  ui.mapRevealStart = performance.now(); // restart the reveal animation (Depth := -3)
  audio.killAll(); // KillSnd: stop room music + every voice/effect
  activeScript?.s.clearDialog(); // zrus_dialogy: drop the pending speech queue
  subs?.clear(); // ZrusTitulky: clear any on-screen subtitle
  poslMluv.little = -1;
  poslMluv.big = -1;
  startMenuMusic();
  host.setInfo();
}

/**
 * chybi=0 (USoutez.pas:729): every registered room (1..70) is genuinely solved. Cheat-
 * solved rooms live in a separate `cheated` set and do NOT count — the original only
 * treats a room as finished when it holds a real best-solution record (savy[nej].dat<>0).
 */
export function allRegisteredSolved(): boolean {
  return REGISTERED_ROOMS.every((r) => host.solved.has(r));
}

/**
 * Return to the world map after a room is won. Winning the last room of a leg (a
 * depth-15 room, one per branch 1..8) first shows that leg's story "case file" page
 * (zobraz_obrazek, UMain.pas:958/991/1030); every other room returns straight to the
 * map. Cheat-solves bypass this (they call showMap directly), matching the intent
 * that only a genuine finish reveals the page.
 *
 * The ZAVER finale auto-launches only when this win is of a *leg-final* room (depth 15)
 * AND it completes the game — pustitzaver := (hloubka=15) and (chybi=0), USoutez.pas:729
 * → av:=9 daRun, UMain.pas:948. So it always chains out of that final leg's story page;
 * winning an ordinary (non-leg-final) room when everything is already solved just returns
 * to the map. SCORE (room 72) is deliberately never auto-launched — it stays a hidden secret.
 */
export function returnFromRoom(): void {
  const roomNum = Number(select.value);
  // pustitzaver: hloubka=15 and chybi=0 — the finale fires only when a genuine win of a
  // *registered leg-final* room (depth 15) leaves no registered room unsolved. A non-leg-
  // final win (even with everything solved) must NOT launch it; nor can the ZAVER win
  // itself (room 71, unregistered, depth −1) re-trigger the finale.
  const finale =
    REGISTERED_ROOMS.includes(roomNum) && depthOfRoom(roomNum) === 15 && allRegisteredSolved();
  if (host.solved.has(roomNum) && depthOfRoom(roomNum) === 15) {
    const leg = branchOfRoom(roomNum);
    if (leg >= 1 && leg <= 8) {
      // Show the leg page first; if the game is now finished, chain into ZAVER on dismiss.
      void showLegImage(leg, finale ? { room: ZAVER_ROOM } : undefined);
      return;
    }
  }
  if (finale) {
    void host.enterRoom(ZAVER_ROOM);
    return;
  }
  // ZAVER has just ended: close the game on its story page (009.$dv), then the map.
  //
  // DELIBERATE DEVIATION from the original, which shows this page when the room is
  // LAUNCHED — UMain.pas's daRealyRun runs `if Hloubka[av,am]=16 then zobraz_obrazek(av)`
  // immediately after Spust(), alongside the score screen. The page is a congratulation
  // on finishing the game, so it reads as an ending rather than a title card.
  //
  // It is unreachable in the port otherwise: computeHloubka only covers the nine
  // REGISTERED branches, so room 71 has depth −1 and the original's Hloubka=16 branch
  // can never fire. (The score screen that accompanies it upstream is not ported.)
  if (roomNum === ZAVER_ROOM) {
    void showLegImage(ZAVER_LEG); // no `pending` ⇒ dismisses to the map
    return;
  }
  showMap();
}

/**
 * zobraz_obrazek (UMain.pas:831): show a leg's full-screen story page over a frozen
 * map, with the rybky11 theme. The page is a plain 640×480 8-bit BMP (Menu/00N.$dv);
 * a click or key dismisses it (zrus_obrazek) back to the map.
 *
 * ── The catch is load-bearing, and it is not about the picture ────────────────
 * This is the ONLY thing that runs when the win countdown lapses (`returnFromRoom`,
 * logicTick.ts), and the transition off the won room happens INSIDE it — `ui.screen`
 * is not reassigned until after the page has loaded. While every asset failure was
 * fatal that was safe by accident: the session ended, so there was nowhere to be
 * stranded. At `shouldHave` a failed page would abandon the function before the
 * transition, leaving the player standing in a room they have already won with no
 * automatic way out, and dropping the `pending` chain into ZAVER — so finishing the
 * whole game would silently not play the ending.
 *
 * So the failure completes the transition WITHOUT the page: exactly what dismissing it
 * would have done. The player loses one chapter of story and is told so; they do not
 * lose the win. That is the middle tier's contract — the tier says how loudly it may be
 * reported, and the call site has to say what happens next.
 *
 * ── The win no longer fetches: the page was preloaded on entry ────────────────
 * The cache hit below is the path a win takes (preloadLegPage, roomPreload.ts). The fetch
 * remains for the route with no entry to have preloaded it — clicking an already-solved
 * leg-final room on the MAP shows its page BEFORE entering (daClickAndRun, main.ts) — and
 * keeps `shouldHave` there because that is a gesture, and #104's rule is that a
 * gesture-driven fetch is never fatal. Both tiers are pinned in
 * `test/asset-tier-discipline.test.ts`; the tier follows the ACT, not the file.
 */
export async function showLegImage(leg: number, pending?: { room: number; replay?: string }): Promise<void> {
  const url = `/data/Menu/00${leg}.$dv`;
  let bmp = preloadedLegPage(leg)?.bmp;
  if (!bmp) {
    try {
      bmp = parseBmp(await requiredBytes(url, `the story page for leg ${leg}`, 'shouldHave'));
    } catch (e) {
      if (!isAssetError(e)) throw e;
      // Reported with a retry that re-runs the whole transition, `pending` and all, so
      // Try again is a genuine second attempt at the story page rather than a way back
      // into a room the player has already left.
      reportAssetError(e, () => void showLegImage(leg, pending));
      if (pending) void host.enterRoom(pending.room, pending.replay);
      else showMap();
      return;
    }
  }
  ui.legImagePending = pending ?? null;
  ui.legImage = { w: bmp.w, h: bmp.h, rgba: bmpToRgba(bmp) };
  ui.legImageNum = leg;
  ui.legImageDrawn = false;
  ui.screen = 'legimage';
  // Swap in the upscaled page when it is available; the native one shows meanwhile.
  ui.legImageAi?.close();
  ui.legImageAi = null;
  void ensureLegImageAi(leg);
  clearHeldKey();
  endShowmode();
  if (engine) {
    engine.swim = null;
    engine.winCountdown = 0;
  }
  activeScript?.s.clearDialog(); // zrus_dialogy: drop any pending speech
  subs?.clear(); // ZrusTitulky: clear any on-screen subtitle
  audio.killAll(); // Killsnd
  void audio.playMusic('rybky11', musicUrl('rybky11'), 0); // Music('rybky11')
  wake();
}

/**
 * zrus_obrazek (UMain.pas:847): dismiss the leg story page. If it was shown on re-entry
 * (Run/Replay of a solved room, daClickAndRun UMain.pas:966), continue into that room;
 * otherwise (the after-win case) return to the map.
 */
export function dismissLegImage(): void {
  ui.legImage = null;
  ui.legImageNum = -1;
  ui.legImageAi?.close();   // a 2560x1920 page is ~20MB decoded; don't hold it after dismissal
  ui.legImageAi = null;
  const pending = ui.legImagePending;
  ui.legImagePending = null;
  if (pending) void host.enterRoom(pending.room, pending.replay);
  else showMap();
}

/** Blit the current leg story page full-screen, sized like the map (fit-mode aware). */
export function drawLegImage(): void {
  if (!ui.legImage) return;
  const { w, h, rgba } = ui.legImage;
  const cs = contentScaleFor(w, h);
  // The CSS box always follows the NATIVE page size; only the BACKING STORE grows when
  // the upscaled page is in use. Deriving the box from the backing store instead is the
  // mistake that mis-sized the subtitle overlay (see roomGeometry).
  const backW = ui.legImageAi ? ui.legImageAi.width : w;
  const backH = ui.legImageAi ? ui.legImageAi.height : h;
  if (canvas.width !== backW || canvas.height !== backH) {
    canvas.width = backW;
    canvas.height = backH;
    ui.legImageDrawn = false; // the resize cleared the backing store
  }
  const cssW = `${w * cs}px`;
  const cssH = `${h * cs}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  // The ×4 page is displayed smaller than it is, where the stylesheet's global
  // pixelated rule would point-sample the detail away (same rule as the AI room).
  const wantSmooth = ui.legImageAi ? scalingFilterFor(backW, w * cs) : '';
  if (canvas.style.imageRendering !== wantSmooth) canvas.style.imageRendering = wantSmooth;
  if (ui.legImageDrawn) return; // static page — blit once, then let the loop idle
  ui.legImageDrawn = true;
  if (ui.legImageAi) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backW, backH);
    ctx.drawImage(ui.legImageAi, 0, 0);
  } else {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  }
  setPerfPaint(perfPaint + 1);
}

/**
 * Load the AI-upscaled story page for `leg`, when the `ai` tier is selected.
 *
 * Resolves to nothing on any failure, leaving the original page in place — the same
 * fallback contract as the rest of the tier. `legImageNum` is re-checked after the
 * await so a page dismissed (or replaced) mid-load cannot install itself late.
 *
 * The blob is the preloaded one when there is one: entering the room fetched it, so what
 * is left here is the DECODE, which is not a fetch and may happen when the page is shown.
 *
 * TWO routes still reach the fetch, and the second is the reason this is not `mustHave`.
 * One is the map click on a solved leg-final room (as `showLegImage`). The other is a tier
 * SWITCH inside the room: `preloadLegPage` reads `graphics` once, at entry, so a player who
 * enters in `classic` and presses E for `ai` before winning has no preloaded blob, and this
 * fetches at the win. `retargetArtForTier` deliberately does not re-run the preload — a
 * tier switch is itself a gesture that fetches (it re-fetches the whole room's art), and
 * the native page is already on screen here, so the upscale arriving late or not at all is
 * the degradation this tier exists to describe.
 */
export async function ensureLegImageAi(leg: number): Promise<void> {
  if (graphics !== 'ai') return;
  const url = `/enhanced-ai/_story/leg${leg}.webp`;
  const blob =
    preloadedLegPage(leg)?.ai ?? (await requiredBlob(url, `the AI story page for leg ${leg}`, 'shouldHave'));
  const bmp = await decodeAsset(url, 'shouldHave', () => createImageBitmap(blob));
  if (ui.legImageNum !== leg || ui.screen !== 'legimage') { bmp.close(); return; }
  ui.legImageAi?.close();
  ui.legImageAi = bmp;
  ui.legImageDrawn = false; // repaint at the new resolution
  wake();
}

/**
 * Play the intro movie sequence over the stage, then return to the map (the
 * original's daLogo/daIntro chain, UMain.pas:1064-1112). `gated` shows the
 * "click to start" splash first (first-run auto-play). The game audio is torn
 * down before playback (KillSnd/FinishSound) — the movie carries its own sound.
 * Each `resolver` is called at the moment its movie starts, so the source tracks
 * the graphics level chosen right then (e.g. AI-upscaled picked on the splash).
 */
export function playIntroMovies(resolvers: Array<() => string>, gated: boolean, onFinish: () => void): void {
  if (intro.playing) return;
  ui.screen = 'intro';
  audio.killAll();
  intro.start(resolvers, onFinish, gated);
}

/** The first-run intro (logo → intro), after which the flag flips so it won't auto-play again. */
export function playFirstRunIntro(): void {
  playIntroMovies([logoMovie, introMovie], true, () => {
    settings.introSeen = true;
    saveSettings(settings);
    showMap();
  });
}

/** Replay just the intro movie from the map's top-left corner (daIntro plays FilmAvi only). */
export function replayIntro(): void {
  playIntroMovies([introMovie], false, () => showMap());
}

/**
 * Handle a click on one of the map's corner "buttons" (UMain.pas daIntro/
 * daCredits/daOptions dispatch, 1064-1135). Exit is intentionally unwired — a
 * browser tab can't quit — so its corner is inert.
 */
export function dispatchMapCorner(action: MapAction | null): void {
  switch (action) {
    case 'intro':
      replayIntro();
      break;
    case 'options':
      openMapOptions();
      break;
    case 'credits':
      void openCredits();
      break;
    case 'exit':
    case null:
      break; // Exit: no-op on the web; empty corner otherwise
  }
}

/** Open the Options panel over the map (daOptions modal Ovl, UMain.pas:1120-1135). */
export function openMapOptions(): void {
  ui.mapOverlay = 'options';
  ui.ostav = O_OPTIONS; // open straight to the options face (no in-room scroll)
  ui.scroll = SCMAX;
}

/** Close whichever menu overlay is open over the map, back to the plain map. */
export function closeMapOverlay(): void {
  host.hideAiCredits();   // the credits overlay replaces the canvas — always restore it
  ui.mapOverlay = 'none';
  ui.ostav = O_NORMAL;
  ui.panelDragBus = null;
  ui.panelPressed = 0;
  ui.creditMode = -1;
}

/**
 * Open the scrolling credits over the map (daCredits → InitCredits, UMain.pas:
 * 1114-1119,761). Lazily loads CredStat1 (static frame) + CredMov (scroll strip)
 * once; the roll then advances off wall-clock and auto-closes at the end.
 *
 * ── Failing to load them is not failing to run the game ──────────────────────
 * `shouldHave`: the player asked for the credits from the map's corner, and without a
 * note they would simply get nothing and conclude the button is broken. The game behind
 * the map is untouched, so the note carries a Try again that re-runs this function —
 * nothing is cached until both bitmaps resolve, so it is a real second attempt.
 *
 * The success path takes the note down BY SUBJECT, which matters for the retry the player
 * improvises rather than the one on the button: closing the corner menu and clicking
 * Credits again is the obvious thing to do, and without this a note about a load that has
 * since succeeded would sit there until it was dismissed by hand. Scoped, because an
 * answer about the credits says nothing about a story page that also failed.
 *
 * ── Why the map is checked twice ─────────────────────────────────────────────
 * The note OUTLIVES the map: it is a page-level element, so its Try again is still there
 * after the player has given up and walked into a room. Both checks exist because of that
 * one button — the first refuses a retry pressed from a room outright, and the second
 * catches the player leaving DURING the refetch, which is reachable because the commit
 * below happens after an await (roomLaunch.ts says the same thing about this function).
 * Without them a retry pressed anywhere would set `mapOverlay = 'credits'`, nothing
 * clears that on a screen change, and the roll would ambush the player mid-scroll on their
 * next visit to the map — and block a room launch while it was up (mapWillDraw).
 *
 * This is `showLegImage`'s rule in a second place: a retry must be a genuine second
 * attempt at the thing that failed, never a way back onto a screen that has been left.
 */
export async function openCredits(): Promise<void> {
  if (ui.screen !== 'map' || ui.mapOverlay !== 'none') return;
  // A load is already in flight, so this click is a no-op: the parchment is up and the
  // roll opens when the art lands. The guard above cannot cover this — `mapOverlay` is
  // deliberately not armed until the art is in, which is the whole point of the hold, so
  // every click during the wait passes it. Without this, three clicks fetch the `ai`
  // strip three times (1.2 MB each, measured).
  //
  // It is also what the deleted `ui.aiCreditsTried` latch was quietly doing: that flag
  // was set synchronously in the draw branch, so it throttled the per-frame re-request
  // AND deduplicated concurrent opens. Only the first job moved to the gesture; this is
  // the second, and it belongs here rather than in `ensureAiCredits` because the faithful
  // path had the same hole (three opens, three fetches) before any of this.
  if (ui.creditsLoading) return;
  // ── One tier's art, fetched before anything is shown ─────────────────────────
  // The `ai` tier used to load the faithful bitmaps here and kick its own art off from
  // the DRAW, so the low-res roll went up first and visibly swapped a beat later. That is
  // the defect rooms had before `roomArtPending()` and the world map had before
  // `mapArtHolding()`, and it gets the same three pieces here: the load starts from this
  // gesture (never from the draw), nothing is shown until the art this tier will actually
  // paint is in, and `syncLoadingUi` puts the room-entry parchment over the wait.
  //
  // So each tier fetches ONLY its own roll. On `ai` that means the faithful pair is not
  // fetched at all, and there is deliberately no quiet fallback to it — `creditsAi.ts`
  // already made that call for this asset, on the grounds that a fallback nobody can see
  // is indistinguishable from the tier working. A failure lands on the note with a Try
  // again, like any other `shouldHave`.
  const wantAi = graphics === 'ai';
  if (wantAi ? !aiCredits : !ui.credits) {
    ui.creditsLoading = true;
    try {
      if (wantAi) {
        await ensureAiCredits();
      } else {
        await loadFaithfulCredits();
      }
      // Whatever arrived, any note still up about the credits is now stale. Scoped to
      // this subject so a note about something else is left alone.
      hideLoadNote('the credits');
    } catch (e) {
      if (!isAssetError(e)) throw e;
      reportAssetError(e, () => void openCredits());
      return; // the map is untouched behind it; the corner button still works
    } finally {
      // Released on every exit, including the failure above: the flag only says a fetch
      // is in flight, and the parchment must not outlive one that has stopped.
      ui.creditsLoading = false;
    }
  }
  // Re-checked after the load: the guard at the top ran before an await, and the player
  // may have left the map while the art was arriving. See the header.
  if (ui.screen !== 'map' || ui.mapOverlay !== 'none') return;
  ui.mapOverlay = 'credits';
  ui.creditMode = 0;
  ui.creditsStart = performance.now();
}

/** The faithful roll: the static frame plus a scroll strip, as indexed bitmaps. */
async function loadFaithfulCredits(): Promise<void> {
  const bmp = async (f: string, what: string): Promise<Bmp> => {
    const url = `/data/Menu/${f}`;
    return decodeCreditsImage(url, await requiredBlob(url, what, 'shouldHave'), 'shouldHave');
  };
  // CredMov_port is the shipped strip with the web-port card prepended
  // (tools/build-credits-port.py). It is a drop-in in the same palette, and since
  // the strip's height defines `delka`, the roll extends to cover it by itself.
  // Falls back to the untouched original when the port variant isn't built.
  //
  // Both are lossless WebP re-encodings of the 8-bit BMPs (2.41 MB -> 0.12 MB,
  // tools/build-credits-webp.py) and decode back to the identical index plane, so
  // everything below this line — and all of credits.ts — is unchanged by that.
  //
  // The ONE place a 404 is asked for on purpose outside the art tiers, so it is the
  // one place `optionalAsset` appears here: a build without the tool's output is a
  // legitimate build, and this is how the code asks which one it is running on. The
  // fallback itself is required — one of the two must exist.
  //
  // A FAILURE is treated as an absence here, which is the one place in the codebase
  // that is right. Everywhere else the distinction is the whole point: not knowing
  // must not be recorded as knowing. Here the question being asked is only "which
  // build is this?", and both answers are already handled — so an unanswered probe
  // costs nothing but the port card, while letting it throw would abandon
  // `openCredits` entirely and the player would get no credits at all rather than
  // the untouched original. `niceToHave` says the same thing to the reporter.
  const portUrl = '/data/Menu/CredMov_port.webp';
  const port = await optionalAsset(portUrl, 'niceToHave', { expect: 'image' }).catch(() => null);
  // The body read and the DECODE get the same treatment as the request: a strip that
  // started arriving and stopped — or one whose colours the palette does not contain,
  // which is how a re-encode would announce itself — is still just "no port card",
  // and must not cost the player the credits roll itself.
  const portBmp = port
    ? await assetBlob(portUrl, port, 'niceToHave', 'the credits')
        .then((b) => decodeCreditsImage(portUrl, b, 'niceToHave'))
        .catch(() => null)
    : null;
  const mov = portBmp ?? (await bmp('CredMov.webp', 'the credits'));
  ui.credits = new Credits(await bmp('CredStat1.webp', 'the credits'), mov);
}

/** Render the scrolling credits full-screen on the main canvas (PaintBox1Paint, UMain.pas:1420). */
export function drawCredits(): void {
  // Whichever roll this tier loaded — `openCredits` fetches one, never both, and the
  // overlay is not armed until it is in. The draw no longer starts any load: the hold is
  // the thing the draw suppresses, so it must not also be the thing that triggers it
  // (the same rule `beginMapArt` states for the world map).
  //
  // The second term is the tier changing WHILE the roll is up, which only the dev pane's
  // E can do (the options panel and the credits are both `mapOverlay`, so a player cannot
  // hold one open and reach the other). Since each tier now loads only its own art, the
  // new tier's roll may simply not exist — and returning here would freeze the roll on
  // screen and skip the auto-close below with no way out but a click. So the roll that IS
  // loaded keeps drawing, which is what happened before the tiers were split apart.
  const ai = graphics === 'ai' ? aiCredits : ui.credits ? null : aiCredits;
  const roll = ai ?? ui.credits;
  if (!roll) return;
  const nativeW = ai ? ai.nativeW : ui.credits!.w;
  const nativeH = ai ? ai.nativeH : ui.credits!.h;
  ui.mapSig = null; // credits paint #screen — invalidate the map cache
  // Advance the scroll off wall-clock (CreditMode += CreditSpeed every 100ms);
  // auto-close once it has settled and held (UMain.pas:867-869).
  // The original advances in whole CREDIT_SPEED steps once per CREDIT_TICK_MS, which is
  // a 4px jump at 10Hz. `creditMode` keeps that stepped value because it drives game
  // logic (the auto-close) and is exposed for tests; `creditScroll` is the same ramp
  // left CONTINUOUS, so the AI renderer — which positions a bitmap rather than indexing
  // pixels — can roll smoothly. Same speed, same total duration, just not quantised.
  const creditElapsed = (performance.now() - ui.creditsStart) / CREDIT_TICK_MS;
  ui.creditMode = Math.floor(creditElapsed) * CREDIT_SPEED;
  const creditScroll = creditElapsed * CREDIT_SPEED;
  if (ui.creditMode > roll.closeAt) {
    closeMapOverlay();
    return;
  }
  // Display size follows the SAME fit rule as the map and the story pages
  // (contentScaleFor on the NATIVE size). It used to be pinned at 640x480 CSS px, so
  // the credits stayed a small window in the middle of a large viewport while every
  // other screen filled it.
  const cs = contentScaleFor(nativeW, nativeH);
  const dispW = Math.round(nativeW * cs);
  const dispH = Math.round(nativeH * cs);

  if (ai) {
    // GPU path: two stacked <img> layers replace the canvas, and the roll is a CSS
    // transform the compositor animates. Per frame this is one style write — the
    // canvas version cost ~2.4ms of JS for the same picture (see creditsAi.ts).
    // #screen lives inside `wrap` (centred in the stage box); mount the overlay there
    // so it inherits the same centring and letterboxing the canvas gets.
    if (!ai.el.isConnected) wrap.appendChild(ai.el);
    if (ui.creditsLayoutW !== dispW || ui.creditsLayoutH !== dispH) {
      ui.creditsLayoutW = dispW;
      ui.creditsLayoutH = dispH;
      ai.layout(dispW, dispH);
    }
    canvas.style.display = 'none';
    ai.show();
    ai.setScroll(creditScroll);
    return;
  }

  host.hideAiCredits();
  const faithful = ui.credits!;
  if (canvas.width !== faithful.w || canvas.height !== faithful.h) {
    canvas.width = faithful.w;
    canvas.height = faithful.h;
  }
  const cssW = `${dispW}px`;
  const cssH = `${dispH}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  const rgba = faithful.render(ui.creditMode);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), faithful.w, faithful.h), 0, 0);
}
