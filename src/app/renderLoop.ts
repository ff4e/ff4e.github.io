/**
 * The rAF callback: which screen paints, how many logic steps run, when to sleep.
 *
 * One frame's worth of decisions. It owns no state, and every branch delegates its
 * painting — except the one case with nothing to delegate to, where it clears the stage
 * to black because a room change is in flight and the previous room's frame is stale.
 * What the file actually holds is the ORDER, which is why most of it is comment: why
 * the map launch has to be driven before anything reads `screen`, why the simulation
 * pauses under an art hold, why the AI tier is render-on-dirty on canvas-2D but not on
 * the GPU.
 */
import { aiRoomRenderActive, beginMapArt, mapArtHolding, roomArtPending, setMapPresented } from './art.js';
import { frameEffectsActive, tetrisModal, tickTetris } from './cheats.js';
import { canvas, ctx, glCanvas, helpClose } from './dom.js';
import { scheduleNextFrame } from './frameClock.js';
import { acc, forceRoomRedraw, lastRoomBackend, lastRoomSig, lastTime, loopTicks, perfPaint, roomAnimating, roomLoading, roomPaints, setAcc, setForceRoomRedraw, setLastRoomSig, setLastTime, setLastWaterPaint, setLoopTicks, setPerfPaint, setRoomPaints, updatePerfHud, waterOwesRepaint } from './framePacing.js';
import { draw, updateRoomSubtitles } from './framePainter.js';
import { count, cutscene, room, setAlpha, subs } from './gameState.js';
import { glAiFailed, glFailed } from './glPlumbing.js';
import { clearDomSubtitles } from './subtitleDom.js';
import { drawCutscene } from './cutscene.js';
import { drawCredits, drawLegImage } from './mapNav.js';
import { syncLoadingUi } from './loadingUi.js';
import { syncRotatePrompt } from './rotatePrompt.js';
import { syncTouchButtons } from './touchButtons.js';
import { drawMap } from './mapDraw.js';
import { drawHelp, drawPanel, tickPanelScroll } from './panel.js';
import { enhancedArtActive, graphics, renderOnDirty, renderer } from './renderSettings.js';
import { tickMapLaunch } from './roomLaunch.js';
import { ui } from './screenState.js';
import { LOGIC_MS, MAX_STEPS_PER_FRAME, roomGeometry } from './stageGeometry.js';
import { solvemode, solveSpeed } from './solveMode.js';
import { syncSolveBtn } from './devBar.js';
import { subFontReady } from './stageState.js';
import { INFO_FAZE_MS, INFO_SETTLE_FAZE } from '../render/mapInfo.js';

/**
 * The one name this module needs from `main.ts`: a logic step. Everything it paints, it
 * imports.
 */
export interface RenderLoopHost {
  /** One 80 ms logic step. Returns true if the room was rebuilt under it. */
  readonly step: () => boolean;
}

let host!: RenderLoopHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initRenderLoop(h: RenderLoopHost): void {
  host = h;
}

export function loop(now: number): void {
  setLoopTicks(loopTicks + 1);
  // Refreshes dropped by the paint cap never reach here (frameClock.ts). `lastTime` is
  // left alone across them, so a skipped interval still accumulates into `acc` — the
  // simulation sees real elapsed time either way, so capping paint cannot change game
  // speed.
  if (lastTime === 0) setLastTime(now);
  const dt = now - lastTime;
  setAcc(acc + dt);
  setLastTime(now);
  tickPanelScroll(dt); // advance the options open/close animation (independent of game logic)
  // Drop a backlog (slow/backgrounded frame) instead of fast-forwarding: like
  // Jedeme, we run at most one step per frame and never batch-catch-up, so under
  // load the game just slows down.
  // The dev-only solution replay may ask for a faster wall-clock, purely so a 6 045-move
  // recording is not minutes of watching. It SHORTENS THE TICK rather than skipping ticks
  // or feeding extra moves: every 80 ms step still happens, in order, doing exactly what it
  // does at real speed, so the run being tested is the same run — only compressed. It is 1
  // (i.e. LOGIC_MS, untouched) in every player session; `solveSpeed()` is inert unless a
  // solution replay is actually running.
  //
  // It also lifts the one-step-per-frame cap, for the duration of the run and no longer.
  // `MAX_STEPS_PER_FRAME` is 1 because the PLAYER's game must never batch-catch-up — under
  // load it slows down instead, like Jedeme. A dev replay wants the opposite, and can have
  // it safely: every tick still runs, in order, doing exactly what it does at real speed,
  // so batching them into one frame changes only how many are drawn. Without this the
  // multiplier is silently capped by the frame rate (~4.8x at 60 fps) and collapses under
  // a loaded machine — the probe went 76 s alone to 263 s inside the suite before this.
  const speed = solveSpeed();
  const logicMs = LOGIC_MS / speed;
  const maxSteps = speed > 1 ? speed : MAX_STEPS_PER_FRAME;
  // Dropping the backlog is right for a player — the game slows down instead of
  // fast-forwarding — but during a dev replay it is what a slow frame uses to undo the
  // whole speed-up: with a 4 ms tick the threshold is ~84 ms, so any frame slower than that
  // threw the backlog away and left ONE step for the frame. Under a loaded machine that is
  // every frame, which is how the probe went 97 s to 475 s. Keep a frame's worth instead.
  //
  // Note what that means: during a run there IS bounded catch-up, up to `maxSteps` in the
  // frame after a stall or a hold — bounded, never unbounded, and still zero for a player,
  // where `speed` is 1 and this line behaves exactly as it always did.
  if (acc > logicMs * (maxSteps + 1)) setAcc(speed > 1 ? logicMs * maxSteps : logicMs);
  let steps = 0;
  // While a hold is active, pause the simulation too, so the room's
  // scripts/gravity/subtitle timers/audio don't advance under a frame the player was
  // never shown — keeping logic in sync with the first visible frame (as classic mode
  // inherently is). acc keeps accumulating but the backlog guard above drops it, so
  // there's no fast-forward catch-up when the hold releases. Two holds share this
  // predicate because they want the identical thing of the clock, though they present
  // differently (the art hold keeps the PREVIOUS frame; roomLoading paints black):
  //
  // roomArtPending() — the anti-flash hold, while draw() holds the previous frame until
  // this room's art lands. Expressed as roomArtPending() rather than
  // `graphics === 'enhanced'` because every tier that draws truecolor art needs the
  // identical hold, and the ai tier additionally waits for its upscale.
  // `roomLoading` is the same rule one step earlier, and it is a correctness one, not
  // just an anti-flash one. enterRoom() flips `screen` to 'room' and runs its KillSnd
  // synchronously, but loadRoom() then AWAITS the new room's core assets — and until
  // buildRoom() swaps them, `room`/`activeScript`/`engine` are still the room the
  // player just left. Ticking those is a window the original cannot have: Spust
  // disables the game timer BEFORE it kills the sound and builds the new room
  // (`Timer1.Enabled:=false; KillSnd; Room:=TRoom.Create(...)`, UMain.pas:247-249),
  // so no Programky runs across the swap. Here the outgoing room's Programky ran on
  // after the KillSnd that was supposed to silence it, and every script that re-arms a
  // loop on `!playing(p)` did exactly that — SMETAK's alarm clock (smetak.ts:204),
  // MOTOR's engine (motor.ts:84), BARELY, BATYSKAF — leaving a looping effect sounding
  // under the NEXT room, because that KillSnd is the only thing a room change ever does
  // about it (buildRoom only re-kills on a restart).
  const simPaused = ui.screen !== 'map' && !cutscene && (roomLoading || roomArtPending());
  // The minigame keeps its own 55ms clock, independent of the game's logic tick.
  tickTetris(dt);
  // Frozen while a modal overlay owns the game. Tetris is modal in the original
  // (Tetris.ShowModal, URoom.pas:24565); the help pages are NOT — ToggleHelp calls
  // FHelp.Show (Uovl.pas:252), and the original's help was a small separate window
  // that left the game visible and running beside it. This port draws help over the
  // whole play area and hides the panel behind it, so the game would otherwise run
  // unseen: scripts advancing and idle chatter speaking lines whose subtitles this
  // very loop suppresses (see clearDomSubtitles below). Freezing it is a deliberate
  // deviation, taken because the port's help covers what the original's did not.
  const frozen = tetrisModal() || ui.helpOpen;
  while (!simPaused && !frozen && acc >= logicMs && steps < maxSteps) {
    setAcc(acc - logicMs);
    steps++;
    if (host.step()) {
      setAcc(0); // room rebuilt: discard partial-tick interpolation
      break;
    }
  }
  setAlpha(Math.min(acc / logicMs, 1)); // clamp so a slow frame can't overshoot a cell
  // Show the solution replay's progress and its abort reason on its own button. Only while
  // a run exists — this is inert for every player session, and `syncSolveBtn` writes to the
  // DOM only when a string actually changed, so a 6 045-move run is not 6 045 relayouts.
  // Unconditional: the button has to be able to come back from "Solving …, disabled" when
  // a run ends by a path that never touches the dev bar. `syncSolveBtn` no-ops unless the
  // dev pane is actually showing.
  syncSolveBtn();
  // The WebGL room overlay (#screen-gl) is only ever shown by the room draw()
  // path or the (enhanced) cutscene. Hide it for every other screen
  // (map/menu/intro/credits/help), which repaint the 2D #screen underneath —
  // otherwise the last GPU-rendered frame stays visible on top of them (a
  // WebGL-only bug; the CPU path has no overlay so it never showed this). The
  // room-draw condition below mirrors the `else draw()` branch, so enhanced's
  // "hold previous frame" (screen==='room' while art loads) is untouched. The
  // cutscene is left out of the hide list because drawCutscene() manages the GL
  // canvas itself (it may present a smooth-upscaled frame there).
  // Drive an armed room launch (daRealyRun) BEFORE anything downstream of `screen` reads
  // it — the GL hide, the mapPresented derivation and the draw dispatch below — so the
  // frame that hands the stage over is the frame that PAINTS the room.
  //
  // Running it after the draw instead (where it started) handed over a frame early for
  // everything but the canvas: drawPanel() put the control panel back into the layout at
  // the end of that frame while #screen still held the map, so the map visibly jumped
  // 90px left with no room under it. Measured 1 frame / 12 ms in enhanced and 2 / 25 ms
  // in ai, and the panel is a layout change, so a single frame of it reads as a flinch.
  //
  // The original's ordering is unaffected: the load still cannot start until a frame
  // carrying the parchment has actually been painted, because drawMap() is what sets
  // `painted` (UMain.pas:1489-1493 — the paint sets daRealyRun, Spust runs after it).
  tickMapLaunch();
  if (ui.helpOpen || ui.screen !== 'room' || roomLoading) glCanvas.style.display = 'none';
  // The help overlay's close button, derived here for the same reason the layers below
  // are: nothing that paints #screen can take a sibling element down, and `drawHelp` only
  // runs while help is OPEN, so it could never hide it again. Guarded rather than assigned
  // every frame — this runs on an idle room too.
  if (helpClose.hidden === ui.helpOpen) helpClose.hidden = !ui.helpOpen;
  // The room's and the cutscene's subtitles are DOM layers of their own (subtitleDom.ts),
  // and no draw branch below clears them: a branch paints #screen, and a sibling element
  // is not something painting over #screen can touch. So a line still on screen when the
  // player opened the help page, went back to the map or walked into a cutscene stayed
  // sitting over it. Derived here in one place for the same reason mapPresented is.
  //
  // The two layers stand down on different conditions, which is the whole reason they
  // are separate layers: the ROOM's goes when a room frame is not what is being painted
  // (a cutscene included — it is drawing its own captions, not the room's), while the
  // CUTSCENE's goes when there is no cutscene left to caption.
  //
  // Both also go when a room frame is not being painted at all, and for the cutscene
  // that is NOT redundant with `!cutscene`: the map / intro / story-page branches below
  // are tested BEFORE `else if (cutscene)`, so with a cutscene still live on another
  // screen `drawCutscene()` never runs and nothing else would take its captions down.
  // A cutscene is only ever started from a room, so this cannot fire on the healthy
  // path — it catches the ways out that do not go through skipCutscene().
  if (ui.helpOpen || ui.screen !== 'room' || roomLoading || cutscene) clearDomSubtitles('room');
  if (ui.helpOpen || ui.screen !== 'room' || !cutscene) clearDomSubtitles('cut');
  // Exactly one branch below owns #screen for this frame, and every branch other than
  // the map's blits over whatever the map left there — help, the story page, the
  // credits roll, a cutscene, a room. So "is a map frame the thing on screen" is
  // derived here, in one place, rather than cleared at each of those sites; drawMap()
  // sets it back when it paints. During the map's own art hold this leaves it alone,
  // which is the point: it still says whether there is a map under the wait.
  if (ui.helpOpen || ui.screen !== 'map' || ui.mapOverlay === 'credits') setMapPresented(false);
  if (ui.helpOpen) {
    drawHelp();
    setPerfPaint(perfPaint + 1);
  } else if (ui.screen === 'intro') {
    // Deliberately empty: the <video> element covers the stage, so there is nothing to
    // paint. The branch still has to exist, or the intro would fall through to the room.
  } else if (ui.screen === 'legimage') {
    drawLegImage(); // the leg-completion story page (counts its own one-shot blit)
  } else if (ui.screen === 'map') {
    // Lazy, and here rather than inside drawMap(): every route onto the map runs
    // through this branch — boot, the intro ending, leaving a room, a tier switch — so
    // the load starts exactly once without a begin() call bolted onto each of them.
    beginMapArt();
    // Advance the record-panel odometer on wall-clock time (one faze per Timer1
    // tick, INFO_FAZE_MS) rather than per paint, so its ~2.7s roll is independent
    // of the frame rate. drawMap() only repaints when the faze (part of its sig)
    // changes, so this is cheap once settled.
    if (ui.mapInfoRoom !== null && ui.mapInfoFaze < INFO_SETTLE_FAZE) {
      ui.mapInfoFaze = Math.min(Math.floor((now - ui.mapInfoOpenAt) / INFO_FAZE_MS), INFO_SETTLE_FAZE);
    }
    if (ui.mapOverlay === 'credits') {
      drawCredits();
      setPerfPaint(perfPaint + 1);
    } else if (!mapArtHolding()) drawMap(); // counts its own paint (it skips when cached)
    // ...and when it IS holding, nothing is painted: the map is presented once, in the
    // tier's final art, with syncLoadingUi() below covering the wait. The 2.36 MB of
    // AI map art against 0.59 MB of faithful BMPs measured 28.0s of enhanced map on
    // screen before it swapped (Slow 4G, cold cache) — the same defect rooms had.
  } else if (cutscene) {
    drawCutscene(); // manages the GL canvas + subtitle overlay itself
    setPerfPaint(perfPaint + 1);
  } else if (roomLoading) {
    // A newly-entered room's assets are still loading (loadRoom is async). Don't
    // paint the previous room's stale frame held in `room`/`ffr` (e.g. the boot
    // room UTES) — clear the stage to black until buildRoom() swaps in the real
    // room and clears roomLoading. The GL overlay is hidden above, so no stale
    // GPU frame shows through either; the page background is black, so on a fast
    // (cached) load this is imperceptible.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setPerfPaint(perfPaint + 1);
  } else {
    // signature captures everything that changes on a logic tick (count → wobble/
    // anim/subtitles) plus the render-mode inputs; roomAnimating() forces 60fps
    // while motion is interpolating. forceRoomRedraw covers signature-invisible
    // transitions (room entry, resize, fit change, pointer). The ZX room repaints
    // every wake (its bands scroll per paint), the loop having chosen a ~30fps wake
    // rate for it. When skipped, the last painted frame persists on the canvas.
    const zxAnim = room?.gspec === 42;
    // Same shape as zxAnim: content that changes per PAINT, which `sig` cannot see —
    // but rate-limited, see waterOwesRepaint.
    const waterAnim = waterOwesRepaint(now);
    const sig = `${count}|${roomArtPending() ? 1 : 0}|${graphics}|${renderer}|${glFailed ? 1 : 0}${glAiFailed ? 1 : 0}`;
    // The AI compositor repaints a ×S backing store (1740×1620 for a 435×405 room).
    // On CANVAS-2D, doing that on every refresh when nothing changed is work the
    // browser cannot absorb: measured 35fps idle and 20fps with a subtitle on screen,
    // against 62fps in the enhanced tier — and the cost is in compositing, not JS (the
    // frame callback itself is 0.1ms in both). Its content only changes on a logic tick
    // or while motion interpolates, both of which are covered below, so that path
    // honours render-on-dirty even when the saver is off.
    //
    // On the GPU that constraint does not apply, and the reason is worth being precise
    // about, because the raw compositing cost is NOT where the difference is: on macOS
    // the browser already GPU-accelerates canvas-2D, and the marginal cost of one ×S
    // frame measures 0.26-0.51 ms there against 0.26-0.39 ms on GlAiScreen
    // (tools/bench-ai-room.mjs) — near parity. What the GPU path removes is the OTHER
    // half: the canvas-2D path hands the browser a ×S canvas to rescale into the room's
    // box on every presented frame, which is the cost the note above measured as frame
    // rate, while GlAiScreen presents straight into that box.
    //
    // So the restriction is tied to the backend that needs it rather than to the tier.
    // Note the saver is ON by default, so this only gives the GPU path back the user's
    // own choice when they have turned it off — it does not make the tier busier for
    // anyone who has not asked for that.
    const aiFrame = room !== null && aiRoomRenderActive(room);
    const dirtyOnly = renderOnDirty || (aiFrame && lastRoomBackend === 'cpu');
    if (!dirtyOnly || forceRoomRedraw || roomAnimating() || zxAnim || waterAnim || sig !== lastRoomSig) {
      draw();
      setLastWaterPaint(now); // any room paint satisfies the water for this interval
      setRoomPaints(roomPaints + 1);
      setPerfPaint(perfPaint + 1);
      setLastRoomSig(sig);
      // Clear the one-shot force, but keep repainting while a cheat effect is live:
      // the grain, the interlaced collapse and the minigame all animate on their own,
      // and `sig` cannot see them, so render-on-dirty would otherwise freeze them.
      setForceRoomRedraw(frameEffectsActive());
    } else if (enhancedArtActive() && subFontReady && subs?.active) {
      // The room is unchanged, but a subtitle may still be waving in or scrolling.
      // The text is its own layer, so reconcile it on its own — without paying for a
      // room repaint underneath.
      //
      // Gated on enhancedArtActive(), i.e. exactly the tiers that draw vector subtitles
      // (see useVecSubs in draw), not on the literal 'enhanced' tier. Checking
      // `graphics === 'enhanced'` excluded the `ai` tier, whose subtitles then only
      // advanced when the room itself repainted — measured, back when this layer was a
      // canvas, at 22 repaints/sec against enhanced's 40.7, which reads as juddering
      // text.
      updateRoomSubtitles(true);
    }
  }
  drawPanel();
  // After every draw branch: the overlay is a view of "is this screen still loading",
  // and hiding it here means the frame underneath has already been painted this tick.
  syncLoadingUi(now);
  // Same contract, same reason they are here and not pushed from the room/orientation
  // changes they depend on. Both leave immediately on anything that is not touch.
  syncRotatePrompt();
  syncTouchButtons();
  updatePerfHud(now);
  scheduleNextFrame();
}
