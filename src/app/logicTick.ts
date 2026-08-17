/**
 * One 80 ms game step: the room script, the engine, the dialogue queue, death handling
 * and the screensaver countdown.
 *
 * This is `Timer1Timer` — the original's game timer — and the ORDER inside it is the
 * behaviour. `renderLoop.ts` decides how many of these run per frame; this decides what
 * one of them does.
 */
import { audio } from './audioEngine.js';
import { tickFrameEffects } from './cheats.js';
import { advanceReplay, advanceShowmode, cutsceneCaption, disposeAiKufr, inReplay } from './cutscene.js';
import { activeScript, blink, chatter, count, cutscene, cutsceneSubs, darkFlicker, deathState, engine, loadmode, pokus, prevKostra, replaymode, room, roomDepth, setCount, setCutscene, setCutsceneSubs, setPokus, showmode, subs } from './gameState.js';
import { MLUVI_PRIOR } from './keyTables.js';
import { returnFromRoom } from './mapNav.js';
import { advanceLoadmode, dispatchHeldMove, tryStep } from './movement.js';
import { advanceSolve, inSolvemode, noteSolveWin, solvemode, tickSolveWatchdog } from './solveMode.js';
import { subsOn } from './playerSettings.js';
import { ui } from './screenState.js';
import { EFFECT_VOL, LOGIC_MS } from './stageGeometry.js';
import { maybeBubble } from '../core/ambient.js';
import { tickChatter } from '../core/chatter.js';
import { stdSmrt } from '../core/deathlines.js';
import type { HookSystem } from '../core/hooks.js';

/**
 * The four names this module needs from `main.ts`.
 */
export interface LogicTickHost {
  /** Rebuild the room (a death restart takes this path). */
  readonly buildRoom: (carryPole?: boolean) => void;
  /** The play clock's elapsed seconds, for the script's `cas` variable. */
  readonly casHry: () => number;
  /** The fishing-hook easter egg, ticked with the room. */
  readonly hooks: HookSystem;
  /** Advance the talking fish's mouth animation. */
  readonly updateLipSync: () => void;
}

let host!: LogicTickHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initLogicTick(h: LogicTickHost): void {
  host = h;
}

export function tickBlink(): void {
  for (const w of ['little', 'big'] as const) {
    if (blink[w] > 0) blink[w]--;
    else if (Math.random() < 0.08) blink[w] = 1; // occasional ~1-tick (~140ms) blink
    darkFlicker[w] = Math.random() < 0.06; // gspec=2 per-tick wink-out (random(100)<6)
  }
}

/**
 * hrac_nespi (Uovl.pas:235): activity happened — the player moved, or the KUFRIK
 * demo replayed an action. Reset the fish idle timers AND the ambient-chatter idle
 * clock (casposlzmeny), so StdKecej only fires after ~60-120s of genuine inactivity.
 * This is why the original never chatters during the demo: every replayed action
 * resets the clock (DalsiPrikaz calls hrac_nespi, URoom.pas:26985).
 */
export function hracNespi(): void {
  room?.hracNespi();
  if (chatter) chatter.last = count; // casposlzmeny := now
}

/**
 * One game-logic step. Mirrors TRoom.Timer1Timer (URoom.pas:23986): it runs at
 * the fixed LOGIC_MS timestep, not per render frame. Returns true if it rebuilt
 * the room (death restart), so the catch-up loop discards leftover accumulation.
 */
export function step(): boolean {
  if (ui.screen !== 'room') return false; // the map/intro screens have no game clock
  setCount(count + 1);
  // Age a solution replay ONCE per tick, above every early return below. It used to be
  // aged next to where it advances, at the bottom — which meant any path that returned
  // early froze the run instead of failing it: KUFRIK's briefcase cutscene (the very next
  // branch) held one at 27/259 indefinitely, button stuck on "Solving", with no abort
  // because the watchdog that exists for exactly that was never reached. A watchdog behind
  // a `return` is not a watchdog.
  if (solvemode) tickSolveWatchdog();
  // Briefcase cutscene takes over while it plays.
  if (cutscene) {
    cutsceneSubs?.tick(count);
    cutscene.tick(cutsceneCaption, () => audio.playing(-1));
    // Keep the idle-chatter timer synced to `now` while the demo plays, so the
    // fish don't immediately "call" you the moment it ends (the demo isn't idle
    // time). The room idle timers are already frozen here (the script block that
    // increments them is skipped by the early return below).
    if (chatter) chatter.last = count;
    if (cutscene.done) {
      setCutscene(null);
      setCutsceneSubs(null);
      disposeAiKufr(); // the cutscene plays once; don't hold its frames afterwards
    }
    return false;
  }
  tickBlink();
  tickFrameEffects();
  subs?.tick(count);
  // Death cry when a fish is first crushed (sp-smrt1/2, URoom.pas:26767/26773).
  if (room) {
    for (const w of ['little', 'big'] as const) {
      if (room.kostra[w] && !prevKostra[w]) {
        audio.play(w === 'big' ? 'sp-smrt2' : 'sp-smrt1', EFFECT_VOL);
        prevKostra[w] = true;
      }
    }
  }
  if (!room || !engine) return false;
  // Latch a solution replay's win FIRST, before any of the early returns below. A win
  // starts the auto-return countdown and this function then returns for the whole tick, so
  // by the time the idle branch at the bottom would see it the run is already over — and a
  // gspec=9 push-out wins with the fish still inside, several ticks after its last move.
  if (solvemode) noteSolveWin(engine.won);
  // Fast-forward load animation (loadmode): replay the saved record at LoadSpeed
  // moves/tick while it plays, skipping normal gameplay + the showmode replay (the
  // original's DalsiPrikaz exits early during a load, URoom.pas:26930).
  if (loadmode) {
    advanceLoadmode();
    return false;
  }
  // After a win, hold on the solved room while the cheer plays, then auto-return
  // to the map (countdown:=30, URoom.pas:24341/24349). Enhancement over the original's
  // fixed timer (which would cut a long line): when the countdown lapses, if the exit
  // line is still being said — the fish's voice still sounding or its subtitle still
  // on screen — hold at 1 until it finishes, so the map transition never truncates it.
  if (engine.winCountdown > 0) {
    const stillSpeaking =
      audio.talking(MLUVI_PRIOR.little) ||
      audio.talking(MLUVI_PRIOR.big) ||
      (subsOn() && (subs?.active ?? false));
    if (engine.winCountdown === 1 && stillSpeaking) return false; // hold — line still playing
    engine.winCountdown--;
    if (engine.winCountdown === 0) {
      returnFromRoom();
      return true;
    }
    // The hold does not freeze the room: the original decrements countdown and then
    // still runs the gstav machine (`if countdown>0 then dec(countdown)` at
    // URoom.pas:24349, followed by its `repeat`), so anything still in motion when the
    // room was won finishes on screen. A gspec=9 push-out is the case that needs it —
    // it wins the room AND enters stav_ma_padat on the same tick (URoom.pas:24904), so
    // whatever the departed item held up would otherwise hang in the air until the map
    // came back. `advance()` is inert while idle: its swim/possession branches are all
    // gated on `!room.won`.
    engine.advance();
    return false;
  }
  // Zvuky_okoli (URoom.pas:23736): ambient bubbles — 5%/tick if none are sounding
  // on the bubble channel (priority 1000). Skipped during a best-solution replay
  // (loadtype=nej gates Zvuky_okoli, URoom.pas:24937) so the playback stays silent.
  if (!inReplay()) {
    const bubble = maybeBubble((n) => Math.floor(Math.random() * n), audio.playing(1000));
    if (bubble) audio.play(bubble, EFFECT_VOL, 1000);
  }
  // gspec=5 (WIN's bonus level): a rescued elderly fish is parked at X=1 and is out of
  // the level, so control moves off it — two sequential guards, transcribed from the
  // same pair of lines as the died-fish switch below (URoom.pas:26997-26998):
  //   if (aktivni=mala) and (… or (gspec=5) and (Items[Little]^.X=1)) then aktivni:=velka;
  //   if (aktivni=velka) and (… or (gspec=5) and (Items[Big]^.X=1))    then aktivni:=mala;
  // Sequential, not exclusive: with BOTH rescued the second guard runs on the result of
  // the first, so control ends on the little fish — which is where VypniBonuslevel then
  // finds it. Without this the player is left steering a fish that has left the level.
  if (room.gspec === 5) {
    const r = room;
    const parked = (which: 'little' | 'big'): boolean =>
      r.items[which === 'little' ? r.littleIdx : r.bigIdx]!.x === 1;
    if (engine.active === 'little' && parked('little')) engine.active = 'big';
    if (engine.active === 'big' && parked('big')) engine.active = 'little';
  }
  // Death: skeletons erode; if the active fish died, control passes to the
  // survivor (URoom.pas:26998). Auto-restart only when *both* fish are out of play
  // and it is not a win (URoom.pas:24337) — a lone survivor keeps playing until the
  // player restarts, which is what lets the death commentary (StdSmrt) be heard.
  if (room.anyFishDead) {
    const eroded = room.tickRozpad();
    const other = engine.active === 'little' ? 'big' : 'little';
    if (!room.alive[engine.active] && room.alive[other]) engine.active = other;
    if (!room.alive.little && !room.alive.big && !room.won && eroded && !showmode) {
      setPokus(pokus + 1); // another attempt
      host.buildRoom(true);
      return true;
    }
    // A fully-eroded skeleton leaves the grid; anything it was holding up now
    // falls (stav_ma_padat, URoom.pas:24421-24430). This runs during showmode too so
    // the demo's deliberate deaths look right (e.g. the thrown bottle drops once the
    // crushed fish disintegrates); the replay simply pauses while things fall (its
    // branch is gated on phase==='idle') and resumes when the room settles.
    if (room.clearErodedSkeletons() && engine.phase === 'idle') {
      if (room.padani()) {
        engine.phase = 'fall';
        engine.animFrame = 0;
      } else {
        room.clearAllDirs();
      }
    }
  }
  // Run the room script (Programky) each unresolved tick. During the win hold,
  // StepEngine still advances VyresLode so an in-flight wreck finishes falling.
  if (activeScript) {
    const wasWon = room.won;
    engine.runScript(count, host.casHry()); // idle timers + scalar sync + prog + tickShodLod
    if (!wasWon) {
      // StdSmrt: death commentary (the survivor comments ~8 ticks after a partner dies).
      // Gated on StdHlaskySmrti (URoom.pas:24942) — rooms like TRUP/VLADOVA disable it.
      // Suppressed during the KUFRIK demonstration and during a best-solution replay
      // (the original's silent loadmode replay speaks nothing): the recorded help
      // subtitles are the demo's own narration of the deliberate death.
      if (deathState && activeScript.s.stdHlaskySmrti && !showmode && !inReplay()) {
        stdSmrt(activeScript.s, deathState, count, roomDepth, {
          aliveLittle: room.alive.little,
          aliveBig: room.alive.big,
          venkuLittle: room.venku.little,
          venkuBig: room.venku.big,
        });
      }
      // StdKecej: ambient idle chatter, gated on no active dialogue + both fish alive.
      // No showmode special-case: the demo keeps quiet on its own because every replayed
      // action calls hracNespi (resets casposlzmeny), exactly like the original. A replay
      // is silent (original loadmode replay runs no Programky/chatter).
      if (chatter && room.alive.little && room.alive.big && !inReplay()) {
        const depth15 = roomDepth === 15;
        tickChatter(activeScript.s, chatter, count, 1000 / LOGIC_MS, activeScript.s.isDialog(), depth15);
      }
      activeScript.s.dialogy(count);
    }
  }
  host.updateLipSync(); // cycle talking-mouth frames from live voice playback
  // Hacky (URoom.pas:24950): the xfisher fishing hooks. A hook can catch+kill a fish
  // (killByHook sets alive=false/kostra=false and drops what it held). If the active
  // fish is hooked, control passes to the survivor; when both fish are out of play
  // (and no hook is still dragging one up), the room restarts — mirroring the crush
  // path but keyed on `alive` since a hooked fish leaves no skeleton to erode.
  if (host.hooks.count > 0) {
    host.hooks.tick(room, (n) => Math.floor(Math.random() * n));
    const other = engine.active === 'little' ? 'big' : 'little';
    if (!room.alive[engine.active] && room.alive[other]) engine.active = other;
    if (
      !room.alive.little &&
      !room.alive.big &&
      !room.won &&
      !room.kostra.little &&
      !room.kostra.big &&
      !host.hooks.busy &&
      engine.phase === 'idle'
    ) {
      setPokus(pokus + 1);
      host.buildRoom(true);
      return true;
    }
  }
  // The shared step-engine drives the whole phase machine (gspec=9 cork setup, move/
  // fall/turn/exit/cork animation with its exit cheer + triggerWin, and the pending
  // auto-swim / ZELVA possession step) — the same path the headless harness runs.
  engine.advance();
  // Engine-level held-key repeat (DalsiPrikaz, URoom.pas:26941): re-issue the held
  // movement key on a rest tick. Run AFTER advance() so a cell that just completed
  // immediately starts the next one on the SAME tick — no stationary gap between cells
  // (holding flows continuously) — while jizda still accumulates (advance saw phase=move
  // this tick before completing). Gated to the same rest conditions the original
  // dispatches under (stav_klid, not possessed/finale/demo/dead/won).
  if (
    engine.phase === 'idle' &&
    !room.won &&
    !room.anyFishDead &&
    !showmode &&
    !replaymode &&
    // `inSolvemode()`, not `solvemode` — the two must agree with the input lockout, which
    // is also `inSolvemode()`. Gating on the raw object kept held-key repeat suppressed
    // after a run ABORTED, while the lockout had already lifted: the player got their keys
    // back and the fish would not move, which reads as a wedged engine rather than as the
    // diagnosable stopped-room the abort is meant to leave behind.
    !inSolvemode() &&
    activeScript?.s.natvrdo !== 1 &&
    !activeScript?.s.zavermode
  ) {
    dispatchHeldMove();
  }
  // KUFRIK automatic demonstration: with no swim/possession pending, the recorded
  // help.cap stream is consumed one action per idle step (DalsiPrikaz in stav_klid,
  // URoom.pas:24438). It keeps advancing while both fish are DEAD (the demo's
  // deliberate death countdown), so it checks phase directly rather than idle().
  if (engine.phase === 'idle' && !room.won && showmode) advanceShowmode();
  // Map "Replay": play back the best solution one move per idle tick (daReplay).
  if (engine.phase === 'idle' && !room.won && replaymode) advanceReplay();
  // Dev-only solution replay: the same one-move-per-idle-tick shape, off the room's own
  // recorded solution, aborting loudly on trouble instead of slipping back to the map.
  // The win is NOT excluded here the way it is above — `advanceSolve` needs the tick the
  // room was won on to latch `won`, which is what tells the dev bar the run succeeded
  // rather than merely stopped. It plays no move on that tick.
  if (solvemode) {
    const eng = engine;
    if (eng.phase === 'idle') {
      advanceSolve({
        anyFishDead: room.anyFishDead,
        won: eng.won, // engine.won, not room.won — gspec=9 wins with the fish still inside
        play: (which, dir) => {
          eng.active = which;
          return tryStep(which, dir);
        },
        wake: hracNespi,
      });
    }
  }
  return false;
}
