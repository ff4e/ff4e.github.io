/**
 * The loading overlay, the fatal-error screen and the resize handler: the chrome the game
 * shows when it is NOT yet showing the game.
 *
 * ── Why these three sit together ─────────────────────────────────────────────
 * They are the only things that write to the page OUTSIDE the canvases. The overlay covers
 * the stage while a room's art is fetched, the fatal screen replaces everything when boot
 * fails, and `relayout()` resizes the stage box they both sit in. Keeping them together is
 * what lets everything else treat the DOM as "the canvases and nothing else".
 *
 * The overlay is DERIVED, not pushed: `syncLoadingUi` is called from the frame loop after
 * the draw branch and decides from live state whether to show. The long comment on that
 * function explains why that matters — a push-based version has to remember every site
 * that changes the flags, and leaving the room screen has to be un-done by hand.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * The three listeners this file installs (the fatal-screen reload button, and the
 * boot-failure `error` / `unhandledrejection` traps) are registered from
 * `initLoadingUi()`, not at module scope: `main.ts` sequences its own side effects, and
 * an imported module is evaluated before any statement of its importer. See AGENTS.md, "the module-evaluation trap".
 */
import { mapArtHolding, mapPresented, roomArtPending } from './art.js';
import { roomEntryHeld } from './roomLoad.js';
import { fatalEl, loadingEl, loadingMsg, stageBox, stageRow } from './dom.js';
import { setForceRoomRedraw, roomLoading } from './framePacing.js';
import { wake } from './frameClock.js';
import { booted } from './stageState.js';
import { subLang, settings } from './playerSettings.js';
import { renderer } from './renderSettings.js';
import { ui } from './screenState.js';
import { computeStageLayout } from './layout.js';
import { setStage, stage } from './stageGeometry.js';
// `touchButtons.ts` imports `relayout` from this file, so this is a cycle — a safe one:
// neither module reads the other while it is being evaluated, only from functions called
// after boot. The alternative was re-deriving touch mode here, and the series' rule is
// that there is exactly one predicate for it.
import { touchUi } from './touchButtons.js';
import { ROOMS } from '../data/roomTable.js';
import type { MissingAssetError, TransientAssetError } from '../render/assetFetch.js';
import { isAssetError, isTransient } from '../render/assetFetch.js';
import { showLoadNote } from './loadNote.js';
import { webgl2Available } from '../render/glScreen.js';

export function setLoadingMsg(msg: string): void {
  if (loadingMsg) loadingMsg.textContent = msg;
}

// ── Post-boot room-loading overlay ────────────────────────────────────────────
// The same #loading markup boot uses, re-armed for room entry. Entering a cold room
// over a slow link takes 17-27s (measured, Slow 4G) and the stage is deliberately
// black for all of it, so the wait needs explaining. Armed on a DELAY: a cached or
// local entry is ready in a few ms and must never flash a spinner.
//
// Driven by the RENDER LOOP off the same `roomLoading || roomArtPending()` predicate
// the frame hold uses, rather than by notifications from every site that can change
// those flags. That is what keeps it honest: the hide happens after the loop has
// painted the frame the overlay was covering, and leaving the room screen (map,
// story page, cutscene) takes it down with no separate teardown call — both of which
// a push-based version had to hand-roll, and could get wrong by forgetting a site.
const LOADING_DELAY_MS = 200;
/** When the current room entry started, or 0 when no entry is in progress. */
let roomLoadingSince = 0;
/** When the map's overlay becomes visible, or 0 while the map is not waiting. */
let mapLoadingDueAt = 0;
/** When the credits' overlay becomes visible, or 0 while the credits are not loading. */
let creditsLoadingDueAt = 0;

/** Arm the overlay for a room entry (the loop reveals it if the wait is real). */
export function beginRoomLoadingUi(num: number): void {
  if (!booted || !loadingEl) return;
  roomLoadingSince = performance.now();
  const desc = ROOMS[num - 1];
  setLoadingMsg(desc ? `Loading ${subLang() === 'cz' ? desc.cz : desc.en}…` : 'Loading…');
  // The boot splash's title and attribution would read as a restart mid-game; the
  // spinner and the room name are the parts that belong to a room entry.
  loadingEl.classList.add('inroom');
}

/**
 * Show or hide the overlay for the frame that has just been painted. Called from
 * loop() AFTER the draw branch, so hiding it can never expose an unpainted stage.
 *
 * Serves BOTH holds — the room's art tier and the `ai` tier's world map — off their
 * own live-state predicates. There is one overlay, so it gets one owner: two syncs
 * writing `hidden` would fight over it on any frame where both had an opinion.
 *
 * The map's whole overlay state is DERIVED here, where the room's is pushed from
 * beginRoomLoadingUi(). That is not an inconsistency but the same principle applied
 * to a one-shot: a room entry re-runs its begin() every time, while the map's art
 * loads at most once per session, so a pushed arm could not re-arm anything when the
 * player leaves the `ai` tier (or the map screen) mid-load and comes back. Derived,
 * every return to the wait re-arms — and re-labels — for free. Note the room's begin()
 * can overwrite the message while the map's load is still in flight, which is exactly
 * the case a pushed map label would have got wrong.
 */
export function syncLoadingUi(now: number): void {
  if (!booted || !loadingEl) return;
  // A failed load leaves its holds ON — nothing releases them, because nothing is going
  // to arrive — so every predicate below stays true for ever. The fatal screen has taken
  // over the waiting; the spinner underneath would only sit there saying the opposite.
  if (fatalShown()) {
    if (!loadingEl.hidden) loadingEl.hidden = true;
    roomLoadingSince = 0;
    mapLoadingDueAt = 0;
    creditsLoadingDueAt = 0;
    return;
  }
  // The post-art entry holds count as waiting: since a room is not handed the stage until
  // its sound and its story assets are in, an entry that reaches the room screen with
  // either still coming would otherwise sit there explaining nothing.
  const roomWaiting = ui.screen === 'room' && (roomLoading || roomArtPending() || roomEntryHeld());
  const mapWaiting = mapArtHolding();
  // The credits are the third wait on this screen, and the last one that used to have no
  // overlay: `openCredits` fetches the roll for whichever tier is selected and nothing is
  // shown until it is in, so without this the player clicks the corner and the map simply
  // sits there. Live state like the other two — `openCredits` owns the flag and clears it
  // in a `finally`, so a failed or abandoned load releases the overlay by itself.
  const creditsWaiting = ui.screen === 'map' && ui.creditsLoading;
  if (!roomWaiting) roomLoadingSince = 0;
  if (!mapWaiting) mapLoadingDueAt = 0;
  else if (mapLoadingDueAt === 0) {
    // Delay the spinner only over a map that is ALREADY ON SCREEN — a switch into the
    // tier, where the player is looking at a perfectly good map and an instant (local)
    // load must not flash anything at them. When the map is not up yet the stage holds
    // black, or the room/intro we just left, so waiting 200ms to say so would only
    // present something the player is not being taken to.
    mapLoadingDueAt = now + (mapPresented ? LOADING_DELAY_MS : 0);
    setLoadingMsg('Loading the world map…');
    // The boot splash's title and attribution belong to boot — so keep them in the one
    // case where this IS boot still running: the overlay never came down between boot
    // and the map's first frame. Every other arm is a spinner being (re)shown mid-game,
    // where the splash would read as a restart, exactly as a room entry's does.
    if (loadingEl.hidden) loadingEl.classList.add('inroom');
  }
  if (!creditsWaiting) creditsLoadingDueAt = 0;
  else if (creditsLoadingDueAt === 0) {
    // Delayed like the map's, and for the same reason: the player is looking at a
    // perfectly good map, and a cached or local load is ready in a few ms — flashing the
    // parchment at them would be worse than the wait it explains.
    creditsLoadingDueAt = now + LOADING_DELAY_MS;
    setLoadingMsg('Loading the credits…');
    if (loadingEl.hidden) loadingEl.classList.add('inroom');
  }
  const show =
    (roomWaiting && roomLoadingSince !== 0 && now - roomLoadingSince >= LOADING_DELAY_MS) ||
    (mapWaiting && now >= mapLoadingDueAt) ||
    (creditsWaiting && now >= creditsLoadingDueAt);
  if (loadingEl.hidden === show) loadingEl.hidden = !show;
}

/**
 * An asset the game needed did not arrive: stop, and say so.
 *
 * ── The heaviest of three surfaces ────────────────────────────────────────────
 * This is where a `mustHave` failure lands. The other two are the note (`loadNote.ts`)
 * and silence; which one an asset gets is declared at its call site as a tier and routed
 * in `reportAssetError` below.
 *
 * It briefly WAS the only surface. That version deleted a modal (which held the room to
 * refetch its artwork) and a note, on the argument that a partial game lies about its own
 * state and that every recover-in-place needed its own retry closure, scoping rules and
 * probe. Half of that argument survives and is why the bottom two tiers are kept as small
 * as they are. The other half did not: a large class of assets is fetched as a side
 * effect of a GESTURE — the world map fetches a room's name plaque from the draw path —
 * so "every failure ends the session" meant moving the mouse could end it. The note came
 * back for the middle tier only, and the cost that argument warned about is real: see the
 * catches in `showLegImage` and `openTetris`, which exist because a tier alone cannot make
 * a caller carry on.
 *
 * ── What must NOT come here ───────────────────────────────────────────────────
 * ABSENT assets. The absent/failed split in `src/render/assetFetch.ts` is what makes this
 * safe, and it is not a nicety: SCORE ships with no enhanced art at all, CHODBA and WIN
 * draw a classic background by design, 21 object sprites are legitimately unstaged, and
 * every one of those is a 404 on a working, correctly deployed game. Route those here and
 * the game becomes unplayable in rooms that are behaving exactly as intended. Only a load
 * that FAILED — no answer at all, or a file a manifest promised and the server does not
 * have — belongs on this screen.
 */
export function failAssets(transient: boolean): void {
  // The two cases want opposite sentences. A request that got no answer is the player's
  // connection and is worth trying again; a 404 is an answer, and telling that player to
  // check their connection sends them to debug their own wifi over a broken deploy.
  //
  // ── Why this no longer names the asset ──────────────────────────────────────
  // It used to say "The music for room 7 didn't finish loading", and that is more
  // precision than the sentence can spend. The screen has exactly one action on it, and
  // it is the same action whichever file broke: reload. Naming the file changes nothing
  // the player can do, and it invites a sentence that is wrong in some other way —
  // "The help pages IS missing" — for every asset whose name happens to be plural.
  //
  // What the name is genuinely useful for is diagnosis, and that has a better home: every
  // asset failure is logged with its name and its tier by `reportAssetError`, at every
  // tier, so a bug report still says exactly which file it was. The probe asserts the LOG
  // names it, rather than the screen.
  //
  // The middle tier keeps its name, and the asymmetry is deliberate: a note says one
  // specific thing is missing while the rest of the game carries on, so "which thing" is
  // the entire content of the message. Here the answer is "the game", and saying so is
  // the whole truth.
  showFatal(
    transient
      ? `The game didn't finish loading. Check your connection and reload.`
      : `Some of the game's files are missing. This is a problem with the game, not with your connection.`,
  );
}

/** Is the fatal screen up? Read by the loading overlay, which must not fight it. */
export function fatalShown(): boolean {
  return fatalEl?.hidden === false;
}

/** What the fatal screen says. For the `__ff` hook the UI probes read. */
export function fatalText(): string {
  return fatalShown() ? (document.getElementById('fatal-msg')?.textContent ?? '') : '';
}

/** Reveal the fatal-error screen (missing/broken assets or a boot exception). */
export function showFatal(msg?: string): void {
  if (loadingEl) loadingEl.hidden = true;
  if (fatalEl) {
    const p = document.getElementById('fatal-msg');
    if (p && msg) p.textContent = msg;
    fatalEl.hidden = false;
  }
}
/** Software-renderer note when WebGL2 is unavailable (CPU fallback is automatic). */
export function maybeShowWebglNote(): void {
  const note = document.getElementById('webgl-note');
  if (!note) return;
  if (webgl2Available() || localStorage.getItem('ff.webglNoteDismissed') === '1') return;
  note.hidden = false;
  document.getElementById('webgl-note-x')?.addEventListener('click', () => {
    note.hidden = true;
    try {
      localStorage.setItem('ff.webglNoteDismissed', '1');
    } catch {
      /* ignore */
    }
  });
}


/**
 * Recompute the stage scale from the available game area and size the stage box +
 * side panel. Called on boot, window resize, and fullscreen change.
 *
 * Also on a FIT MODE change: the box's width ceiling depends on the mode
 * (`stageBoxCeiling`), so a mode switch that only repainted would leave the box at the
 * previous mode's width. The room/map/cutscene canvases are sized per-frame in their draw
 * functions from `stage`.
 */
export function relayout(): void {
  const availW = stageRow?.clientWidth || window.innerWidth;
  const availH = stageRow?.clientHeight || window.innerHeight;
  // Touch mode has no side panel to reserve room for (drawPanel hides the column), so the
  // 167 native px of panel + gap go back to the game, and the fit mode is forced to 'fill'
  // (layout.ts, effectiveFitMode). Measured at 393x852: the row used to overhang the
  // viewport by 22-93px depending on the room, then by 7px once the panel went, and now by
  // none — the 7 were the MIN_STAGE_SCALE floor, which no longer overruns the width.
  // Asked of `touchUi()` rather than worked out here — one predicate, one place
  // (touchMode.ts) — and the dev-bar override calls this straight after flipping it, so
  // switching modes resizes the game immediately.
  setStage(computeStageLayout(availW, availH, settings.fitMode, !touchUi()));
  // The box HUGS its content horizontally rather than being pinned to the full stage
  // width: `wrap` is the box's only in-flow child and is sized to the room/map/cutscene
  // canvas, so `width: auto` tracks the content for free — including room changes, which
  // never reach relayout(). `stage.stageW` stays as the ceiling the content is scaled
  // into, so nothing can grow past the logical box; `contentScale` still bounds every
  // room against `stage.boxW`, which is what keeps the box room-INDEPENDENT for scaling.
  // The HEIGHT is set outright, and it is now the elastic `stage.boxH` rather than a fixed
  // 600 native px (layout.ts, stageBoxHeight) — on a width-bound viewport that is what
  // stops the box throwing away the leftover height.
  //
  // Why hug at all: the panel sits beside the box, so a room narrower than the box was
  // pushed away from it by the box's slack — a median 230px and up to 593px of dead gap
  // at 2048x1017, paid by exactly the 44 rooms that gain nothing from the wider box.
  // Hugging moves ONLY the panel: the content's centre is
  // `availW/2 - (gap + panelW)/2` regardless of the box width, because the row is centred
  // and the gap and panel are constant.
  stageBox.style.width = '';
  stageBox.style.maxWidth = `${Math.ceil(stage.stageW)}px`;
  stageBox.style.height = `${Math.round(stage.stageH)}px`;
  if (stageRow) stageRow.style.gap = `${Math.round(stage.gap)}px`;
  setForceRoomRedraw(true); // the room canvas CSS size is set in draw() — repaint to rescale
  wake();
}

// Intro-movie overlay (UMain.pas daLogo/daIntro): full-screen <video> played
// before the map on first run, and replayable from the map's top-left corner.

/**
 * Register the fatal-screen handlers. Call once, from `main.ts`, during boot wiring.
 *
 * It took a one-member host until `booted` got an owner in `stageState.ts`; now there is
 * nothing to hand over, only listeners that must not be armed at import time.
 */
export function initLoadingUi(): void {
  document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload());
  // Any unhandled failure DURING boot means the game never became playable → fatal.
  //
  // After boot the rule NARROWS rather than stopping, and this is the layer that makes
  // the tiers true for code nobody has touched — and for code not yet written. An
  // unhandled ASSET error is routed by its tier at any time; everything else is still
  // ignored once the game is up, because a mid-game exception in the renderer or a room
  // script should not nuke play.
  //
  // The asymmetry is the whole point. Before any of this, forgetting to handle a load was
  // SILENT: the loader rejected, nothing caught it, and the player got a game quietly
  // missing its music or its death lines. Fourteen kinds of asset ended up that way and
  // nobody ever decided it — it was what the default did. Then everything became fatal,
  // which fixed the silence and broke the map: a plaque fetched on hover could end the
  // session. Now forgetting is as loud as the asset deserves and no louder, and WHICH is
  // a decision someone had to type at the call site.
  //
  // It is typed, not string-matched (`isAssetError`), so rewording an error message
  // cannot quietly disarm it.
  window.addEventListener('unhandledrejection', (ev) => {
    if (isAssetError(ev.reason)) reportAssetError(ev.reason);
    else if (!booted) {
      console.error('boot failed:', ev.reason);
      showFatal();
    }
  });
  // The same triage for a thrown error, which is not the same channel: `runBoot()` is
  // awaited at module scope in `main.ts`, so a loader that rejects during boot surfaces
  // as an uncaught module error rather than an unhandled rejection. Boot's assets used to
  // catch their own failures, so every boot failure looked alike and one generic sentence
  // was all there was to say; now that they do not, this is where most of them arrive.
  window.addEventListener('error', (ev) => {
    if (isAssetError(ev.error)) reportAssetError(ev.error);
    else if (!booted) {
      console.error('boot failed:', ev.error ?? ev.message);
      showFatal();
    }
  });
}

/**
 * Report an asset failure, as loudly as its tier allows — and no louder.
 *
 * The single place the three tiers become three surfaces, so "what does a `shouldHave`
 * failure look like" has one answer and a reviewer has one place to check it.
 *
 * Called from two directions, and it matters that they are the SAME function:
 *
 *  - the `unhandledrejection` / `error` traps below, for a failure nobody handled. That
 *    is the BACKSTOP, and it is what makes a floating rejection safe again;
 *  - a call site that caught its own failure in order to carry on, which passes a `retry`
 *    so the note can offer Try again (see `loadHelpPages`, `openTetris`).
 *
 * The second used to call `showLoadNote` directly, which quietly made the tier a lie: a
 * loader re-declared `niceToHave` still raised a note, because the note was the call
 * site's decision rather than the tier's. Routing both through here means re-tiering an
 * asset actually changes what the player sees — which is the whole point of declaring a
 * tier, and is now provable by the probe.
 *
 * What this cannot do is make the caller carry on: by the time an error is here, the
 * function that was loading has already been abandoned. So this is the floor, not the
 * whole contract — a `shouldHave` or `niceToHave` load that is AWAITED on a path the game
 * needs to finish still has to catch its own failure and fall back (see `loadParchment`).
 * This guarantees the player is never told MORE than the tier warrants; it cannot
 * guarantee they were told the right thing about what happens next.
 *
 * Everything is logged first, at every tier. A `niceToHave` failure is silent to the
 * PLAYER, never to the console — a tier that left no trace would be indistinguishable
 * from a loader that was never called, which is how a broken enhanced tier hid before.
 */
export function reportAssetError(
  e: TransientAssetError | MissingAssetError,
  retry?: () => void,
  /**
   * What to call this when the error cannot name itself.
   *
   * `optionalAsset` has no `what` by construction — it is the door for assets whose
   * absence is the design, and there is nothing to say to a player about a file that is
   * legitimately not there. But its FAILURE still has to be reported, and routing those
   * through here without this turned "the artwork for this room" into "an unnamed asset"
   * in the log — the one place the name still lives now that the screen is generic.
   * `decodeAsset` has the same gap for the same reason.
   */
  fallbackWhat?: string,
): void {
  // The name goes in the LOG line rather than being left inside the error's own message,
  // because this is now the only place it is written down: the failure screen is generic,
  // so a bug report's "which file was it" comes from here. `test-asset-tiers.mjs` asserts
  // this line names the asset for every must-have row it breaks.
  const named = e.what ?? fallbackWhat;
  console.error(`asset failed (${e.tier}): ${named ?? 'an unnamed asset'}`, e);
  switch (e.tier) {
    case 'mustHave':
      // Boot's loaders do not catch their own failures — there is nothing useful for them
      // to do — so this is still the only thing between a missing panel.ffp and a blank
      // page.
      failAssets(isTransient(e));
      return;
    case 'shouldHave':
      // No `retry` from the backstop path: it is reached precisely because nobody handled
      // the failure, so there is nothing there that knows how to re-run it. `loadNote`
      // hides the button rather than offering one that does nothing.
      showLoadNote({ subject: named ?? 'a game file', transient: isTransient(e), retry });
      return;
    case 'niceToHave':
      return;
  }
}
