/**
 * What PLAYS the KUFRIK demo: the briefcase story's driver and the help.cap showmode's.
 *
 * Split from `cutscene.ts`, which keeps what the story LOOKS like on a page — the canvas,
 * the GL present, the DOM captions and the AI tier's frame cache. Everything here is state:
 * `gameState`, the audio engine, the room's movement, so a host without a document (the
 * native QuickJS build) runs it as it is rather than restating it. Keep it that way: an
 * import of `dom.ts`, `subtitleDom.ts` or `glPlumbing.ts` here undoes the point of the split.
 *
 * The one thing a skip has to do to the picture — release the AI tier's decoded frames —
 * is handed in with the rest of the host (`disposeAiKufr`), because the frames are the
 * page's.
 */
import { audio } from './audioEngine.js';
import { roomLoadSeq, roomLoading } from './framePacing.js';
import { activeScript, count, cutscene, cutsceneAssets, cutsceneSubs, engine, fftEntries, font, room, setCutscene, setCutsceneSubs, setLoadmode, setReplaymode, setShowmode, setShowmodeHelptext, setShowmodeLoading, setShowmodeHold, setShowmodeRestarted, setShowmodeSave, showmode, showmodeHelptext, showmodeHold, showmodeLoading, showmodeRestarted, showmodeSave, showmodeTrace, showmodeTraceOn, subs } from './gameState.js';
import { clearHeldKey, restore, tryStep } from './movement.js';
import { cancelSolve } from './solveMode.js';
import { subLang, subsOn } from './playerSettings.js';
import { preloadCutscene, showmodeRecording } from './roomPreload.js';
import { roomVoicesReady } from './roomLoad.js';
import { ui } from './screenState.js';
import { DEFAULT_LINE_TICKS, LOGIC_SEC } from './stageGeometry.js';
import { musicUrl } from '../audio/music.js';
import { Dir } from '../core/dir.js';
import { AKCE, KDO } from '../intro/helpCap.js';
import type { CapAction } from '../intro/helpCap.js';
import { KufrDemo } from '../intro/kufrDemo.js';
import { SubtitleSystem } from '../render/subtitles.js';
import { SHOWMODE_HOLDS } from './showmodeHolds.js';

/**
 * The five names this module needs from `main.ts` — all of them things a cutscene DOES
 * to the game when it starts, ends or is skipped.
 */
export interface CutsceneHost {
  readonly buildRoom: (carryPole?: boolean) => void;
  readonly hracNespi: () => void;
  readonly selectFish: (which: 'little' | 'big') => void;
  readonly swapActive: () => void;
  /** Release the AI tier's decoded story frames (`cutscene.ts`'s cache). */
  readonly disposeAiKufr: () => void;
}

let host!: CutsceneHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initCutscene(h: CutsceneHost): void {
  host = h;
}

export async function startCutscene(): Promise<void> {
  if (cutscene || !font) return;
  // The room this launch belongs to. Every await below is a window in which the
  // player can leave (or restart into another room), and what lands afterwards must
  // not be installed over whatever they went to — the same rule the room-change hold
  // enforces for the script clock.
  //
  // Three conditions, because none alone is enough: `screen` misses a room→room change
  // (it stays 'room'); `roomLoadSeq` only counts loads that COMPLETED, so it misses the
  // window where the next room's assets are still in flight; and `roomLoading` alone
  // misses a change that has already finished.
  const seq = roomLoadSeq;
  const stale = (): boolean =>
    cutscene !== null || !font || ui.screen !== 'room' || roomLoading || roomLoadSeq !== seq;
  // The demo is narration over pictures, and every caption's length comes from its
  // voice sample (cutsceneCaption -> audio.duration). Starting it before the room's
  // voice package has landed would run the whole story at the flat DEFAULT_LINE_TICKS
  // fallback — silent, and several times too fast to read.
  await roomVoicesReady;
  if (stale()) return;
  clearHeldKey(); // the briefcase cutscene takes over
  if (!cutsceneAssets) {
    // A BACKSTOP, not the path: entering room 2 preloads all of this and waits for it
    // (roomPreload.ts), so the briefcase sequence reaching `faze === 8` fetches nothing.
    // What is left here is the one route that skips the preload — `__ff.startCutscene()`,
    // which a probe or the dev bar can fire from any room.
    await preloadCutscene();
    // 5.3 MB of story assets: long enough to leave the room in. Without this the demo's
    // looping 'kufrik' music started AFTER showMap()'s KillSnd (and the cutscene installed
    // itself over the world map), because nothing in DoneKufrDemo ever stops that track —
    // it only restores music_volume (URoom.pas:2914).
    if (stale()) return;
  }
  // Either the branch above just published them or they were already there; an imported
  // binding is never narrowed, so the invariant is re-stated rather than inferred.
  const assets = cutsceneAssets;
  if (!assets) return;
  const demo = new KufrDemo(assets.bmp, assets.pck, assets.script);
  setCutsceneSubs(new SubtitleSystem(font, demo.palette, Math.floor(demo.width / 15), demo.width, demo.height));
  subs?.clear(); // ZrusTitulky (InitKufrDemo): clear the room's on-screen subtitle
  // Music (InitKufrDemo, URoom.pas:2867): start the looping 'kufrik' track with the
  // demo. The original loops at cycle 78660*2 *bytes*; playMusic wants the loop
  // point in *samples* (bytes/2 for 16-bit audio), i.e. 78660. It persists after
  // the demo — DoneKufrDemo never stops it — so it keeps playing in the room.
  void audio.playMusic('kufrik', musicUrl('kufrik'), 78660);
  cancelSolve(); // `step()` gives the tick to the cutscene: a run left armed here freezes
  setCutscene(demo);
}

/**
 * Start the KUFRIK automatic demonstration (showmode, URoom.pas:19923). The room's
 * prog fires this once both fish reach the demo spot: help.cap (a recorded input
 * stream) is replayed one action per tick, auto-driving the fish and the tutorial
 * subtitles. The big fish is turned to face left first (natoceni[velka]:=smer_vlevo).
 *
 * The recording is already in hand — entering room 2 fetched it (roomPreload.ts) — so this
 * is now SYNCHRONOUS, which is the point: reaching the tutorial spot is a moment of play,
 * and play does not touch the network. `showmodeLoading` survives for the one route that
 * skips the preload (`__ff.forceShowmode()` from another room), where it is what keeps
 * KUFRIK's dialogue and the re-trigger from firing while that fetch runs.
 */
export function startShowmode(): void {
  if (showmode || showmodeLoading || !room) return;
  clearHeldKey(); // the demo takes over — drop any held movement key
  cancelSolve(); // two playback drivers on one room derail both; the room's script wins
  setShowmodeLoading(true);
  setShowmodeHelptext(0);
  setShowmodeRestarted(false);
  setShowmodeHold(0);
  setShowmodeSave(null);
  if (activeScript) activeScript.s.showmode = true;
  room.facingRight.big = false; // natoceni[velka] := smer_vlevo
  if (engine) engine.swim = null;
  const recorded = showmodeRecording();
  if (recorded !== null) {
    setShowmode({ actions: recorded, idx: 0 });
    setShowmodeLoading(false);
    return;
  }
  void (async () => {
    try {
      await preloadCutscene();
      const late = showmodeRecording();
      // The demo may have been cancelled (room change/restart) while fetching.
      if (!showmodeLoading || late === null) return;
      setShowmode({ actions: late, idx: 0 });
    } finally {
      // `endShowmode()` on failure is gone with the catch: it put the room back and
      // said nothing, so a player who reached the tutorial spot simply never got the
      // tutorial. The flag still has to be cleared either way.
      setShowmodeLoading(false);
    }
  })();
}

/** End the demonstration (EOF, or the recording's/player's restart/exit). */
export function endShowmode(): void {
  setShowmode(null);
  setShowmodeLoading(false);
  setShowmodeRestarted(false);
  setShowmodeHold(0);
  setShowmodeSave(null);
  setLoadmode(null);
  setReplaymode(null); // a room change / exit also ends a best-solution replay
  cancelSolve(); // …and a dev solution replay: restart/load/room change all land here
  if (engine) engine.swim = null;
  if (activeScript) activeScript.s.showmode = false;
}

/** True while the KUFRIK demo is playing or its recording is still loading. */
export function inShowmode(): boolean {
  return showmode !== null || showmodeLoading;
}

/**
 * Consume one recorded action per tick (DalsiPrikaz replay, URoom.pas:26971). At
 * end-of-file the demo ends and control returns to the player.
 */
export function advanceShowmode(): void {
  if (!showmode || !room) return;
  if (showmode.idx >= showmode.actions.length) {
    endShowmode();
    return;
  }
  // A held tick is still the demo being active. Every replayed action calls `hracNespi`,
  // and that is the only thing keeping the idle-chatter clock quiet during the demo
  // (logicTick.ts:207), so a hold must call it too or the fish chat over the pause.
  if (showmodeHold > 0) {
    setShowmodeHold(showmodeHold - 1);
    host.hracNespi();
    return;
  }
  const at = showmode.idx;
  const a = showmode.actions[showmode.idx++]!;
  applyCapAction(a);
  // Armed AFTER the action, keyed on the index just consumed: arming before would re-arm
  // on every held tick (`idx` has not moved yet) and the replay would never advance.
  const hold = SHOWMODE_HOLDS.get(at);
  if (hold) setShowmodeHold(hold);
  host.hracNespi(); // DalsiPrikaz calls hrac_nespi after each replayed action (URoom.pas:26985)
  // Debug trace (enabled via __ff.showmodeTraceOn): one row per consumed action, with
  // the resulting fish cells / phase / alive, so a headless run can be replayed and
  // diffed against the recording to pinpoint where the demo diverges.
  if (showmodeTraceOn && room) {
    const l = room.items[room.littleIdx];
    const b = room.items[room.bigIdx];
    showmodeTrace.push({
      i: at,
      kdo: a.kdo,
      akce: a.akce,
      x: a.x,
      y: a.y,
      ht: showmodeHelptext,
      lx: l?.x ?? -1,
      ly: l?.y ?? -1,
      bx: b?.x ?? -1,
      by: b?.y ?? -1,
      aliveL: room.alive.little,
      aliveB: room.alive.big,
      act: engine?.active ?? 'little',
      phase: engine?.phase ?? 'idle',
    });
    if (showmodeTrace.length > 4000) showmodeTrace.shift();
  }
}

/**
 * Dispatch one recorded action (URoom.pas:24438-24501), consumed on an idle step.
 *
 * The recording encodes the demo's deliberate death-restart as a run of `akce_restart`
 * (kdo=0) entries — the engine's countdown auto-restart (countdown:=70 on both fish
 * dead, then akce_restart at 0; URoom.pas:24337/26911). We drive the restart straight
 * from the recording: on the first restart entry of a run we rebuild the room (fish
 * back to spawn, showmode preserved), which also re-syncs the fish to the recorded
 * positions and corrects any accumulated path drift. The rest of the run is a no-op.
 *
 * A system-issued directional move applies to the active fish (24440). `go` walks one
 * cell toward the recorded target (najdi_smer, re-issued each idle step by the
 * recording); `helptext` advances the tutorial subtitle. Recorded save/load/help/
 * natvrdo are ignored during replay.
 */
export function applyCapAction(a: CapAction): void {
  if (!room || !engine) return;
  // Recorded restart run: rebuild the room once (the demo's death-restart).
  if (a.akce === AKCE.restart) {
    if (!showmodeRestarted) {
      setShowmodeRestarted(true);
      host.buildRoom(true); // showmode + replay position are preserved across the rebuild
    }
    return;
  }
  setShowmodeRestarted(false); // a non-restart action ends the restart run
  // Recorded save / load (akce_save=20, akce_load=10, URoom.pas:24480): the demo saves
  // a checkpoint and reloads it after each death (help7). Only the system-issued copy
  // acts; the stale kdo=0 duplicates fall through to the no-op return below.
  if (a.kdo === KDO.sys && a.akce === AKCE.save) {
    if (room.alive.little && room.alive.big) {
      setShowmodeSave({ rec: engine.srecord, snapshot: activeScript?.s.snapshot() ?? null });
    }
    return;
  }
  if (a.kdo === KDO.sys && a.akce === AKCE.load) {
    if (showmodeSave) restore(showmodeSave.rec, showmodeSave.snapshot, true, true); // preserve showmode, animated
    return;
  }
  let kdo = a.kdo;
  if (kdo === KDO.none) return;
  if (kdo === KDO.sys && a.akce >= AKCE.up && a.akce <= AKCE.right) {
    kdo = engine.active === 'little' ? KDO.little : KDO.big; // sys move -> active fish
  }
  const which: 'little' | 'big' | null =
    kdo === KDO.little ? 'little' : kdo === KDO.big ? 'big' : null;
  switch (a.akce) {
    case AKCE.up:
    case AKCE.down:
    case AKCE.left:
    case AKCE.right:
      if (which) {
        engine.active = which;
        tryStep(which, a.akce); // Dir values equal akce 1-4
      }
      break;
    case AKCE.set: // akce_set: select the fish
      if (which) host.selectFish(which);
      break;
    case AKCE.switch: // akce_switch (no stav_kuk animation during showmode)
      host.swapActive();
      break;
    case AKCE.go: // akce_go: step one cell toward the recorded target (najdi_smer)
      if (which) {
        engine.active = which;
        const dir = room.findDir(which, a.x, a.y);
        if (dir !== Dir.no) tryStep(which, dir);
      }
      break;
    case AKCE.helptext:
      showHelpText();
      break;
    case AKCE.exit:
      endShowmode();
      break;
    default:
      break; // load/save/help/natvrdo: ignored
  }
}

/**
 * Tutorial subtitle (akce_helptext, URoom.pas:24495): show the next help line.
 * A fixed set of indices are spoken by the big fish (addv), the rest by the small
 * fish (addm). help1..help23 live in KUFRIK's caption bank.
 */
export function showHelpText(): void {
  setShowmodeHelptext(showmodeHelptext + 1);
  const n = showmodeHelptext;
  const bigVoiced = n === 2 || n === 4 || n === 7 || n === 8 || n === 11 || n === 14 || n === 20 || n === 22;
  if (!activeScript) return;
  if (bigVoiced) activeScript.s.addv(0, 'help' + n);
  else activeScript.s.addm(0, 'help' + n);
}

/**
 * Skip the briefcase demo (zrus_kufr, URoom.pas:2965): end it early and stop the
 * KD narration (KSnd(-1)). The 'kufrik' music keeps playing — only the demo ends.
 */
export function skipCutscene(): void {
  if (!cutscene) return;
  setCutscene(null);
  setCutsceneSubs(null);
  host.disposeAiKufr(); // release the upscaled frames (~37 MB at x4) on an early skip
  audio.killVoices(); // KSnd(-1): drop the narration; music (playMusic) is untouched
}

/** A KD-* narration caption during the cutscene; returns its length in game ticks. */
export function cutsceneCaption(name: string): number {
  const sound = `KD-${name}`;
  const entry = fftEntries.find((e) => e.name === sound);
  if (entry && cutsceneSubs && subsOn()) {
    const t = subLang() === 'cz' ? entry.cz : entry.en;
    if (t.text) cutsceneSubs.newSubtitle(t.text, t.color, count);
  }
  audio.play(sound, 1, -1, 'voice');
  const dur = audio.duration(sound);
  return dur > 0 ? Math.max(1, Math.round(dur / LOGIC_SEC)) : DEFAULT_LINE_TICKS;
}
