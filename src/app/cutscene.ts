/**
 * The KUFRIK demo, the intro/ending cutscenes and the recorded-solution replay.
 *
 * Three different drivers over one presentation. What they share is the frame: a movie
 * painted per logic tick with its own subtitle overlay, and one skip path. What differs
 * is what feeds it — KUFRIK runs `KufrDemo`, showmode steps a `CapAction` queue parsed
 * from help.cap, and replay walks a recorded move list.
 *
 * The AI-tier upscaled frames (`aiKufr`) are cached here too, because nothing else looks
 * at them and the cache has to be dropped when the cutscene ends.
 */
import { audio } from './audioEngine.js';
import { canvas, ctx, glCanvas } from './dom.js';
import { perfPaint, roomLoadSeq, roomLoading, setPerfPaint } from './framePacing.js';
import { activeScript, count, cutscene, cutsceneAssets, cutsceneSubs, engine, fftEntries, font, replaymode, room, setCutscene, setCutsceneAssets, setCutsceneSubs, setLoadmode, setReplaymode, setShowmode, setShowmodeHelptext, setShowmodeLoading, setShowmodeHold, setShowmodeRestarted, setShowmodeSave, showmode, showmodeHelptext, showmodeHold, showmodeLoading, showmodeRestarted, showmodeSave, showmodeTrace, showmodeTraceOn, subs } from './gameState.js';
import { glCompositor, glFailed, markGlFailed } from './glPlumbing.js';
import { clearDomSubtitles, syncDomSubtitles } from './subtitleDom.js';
import { clearHeldKey, restore, tryStep } from './movement.js';
import { cancelSolve } from './solveMode.js';
import { subLang, subsOn } from './playerSettings.js';
import { enhancedArtActive, graphics, renderer } from './renderSettings.js';
import { roomVoicesReady } from './roomLoad.js';
import { ui } from './screenState.js';
import { DEFAULT_LINE_TICKS, LOGIC_SEC, contentScaleFor, scalingFilterFor } from './stageGeometry.js';
import { subFontFamily, subFontReady, subFontWeight } from './stageState.js';
import { Dir } from '../core/dir.js';
import { AKCE, KDO, parseHelpCap } from '../intro/helpCap.js';
import type { CapAction } from '../intro/helpCap.js';
import { KufrDemo } from '../intro/kufrDemo.js';
import type { AiKufr } from '../intro/kufrDemo.js';
import { IndexedScreen } from '../render/framebuffer.js';
import { AI_ROOM_SCALE } from '../render/roomAi.js';
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
  readonly showMap: () => void;
  readonly swapActive: () => void;
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
    const [bmp, pck, scr] = await Promise.all([
      fetch('/data/Intro/kufr256.BMP').then((r) => r.arrayBuffer()),
      fetch('/data/Intro/demo.pck').then((r) => r.arrayBuffer()),
      fetch('/data/Intro/script.txt').then((r) => r.text()),
    ]);
    setCutsceneAssets({ bmp: new Uint8Array(bmp), pck: new Uint8Array(pck), script: scr });
    // 5.3 MB of story assets (demo.pck alone is 4.9 MB), fetched once per session: the
    // first launch is easily long enough to leave the room in. Without this the demo's
    // looping 'kufrik' music started AFTER showMap()'s KillSnd (and the cutscene
    // installed itself over the world map), because nothing in DoneKufrDemo ever stops
    // that track — it only restores music_volume (URoom.pas:2914).
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
  void audio.playMusic('kufrik', '/data/Music/kufrik.wav', 78660);
  cancelSolve(); // `step()` gives the tick to the cutscene: a run left armed here freezes
  setCutscene(demo);
}

/**
 * Start the KUFRIK automatic demonstration (showmode, URoom.pas:19923). The room's
 * prog fires this once both fish reach the demo spot: help.cap (a recorded input
 * stream) is fetched and then replayed one action per tick, auto-driving the fish
 * and the tutorial subtitles. The big fish is turned to face left first
 * (natoceni[velka]:=smer_vlevo). s.showmode is set immediately so KUFRIK's normal
 * dialogue and the re-trigger both stop while help.cap loads asynchronously.
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
  void (async () => {
    try {
      const res = await fetch('/data/Intro/help.cap');
      if (!res.ok) {
        endShowmode();
        return;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      // The demo may have been cancelled (room change/restart) while fetching.
      if (!showmodeLoading) return;
      setShowmode({ actions: parseHelpCap(buf), idx: 0 });
    } catch {
      endShowmode();
    } finally {
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

/** True while a map "Replay" is running. The SILENCE predicate (`scriptTalk`, `Zvuky_okoli`;
 *  faithful, `loadtype=nej`); the input lockout is `inAutoPlay()` in `solveMode.ts`. */
export function inReplay(): boolean {
  return replaymode !== null;
}

/**
 * Play back one move of the room's best solution per idle tick (daReplay, the
 * animated LoadSpeed:=1 replay, URoom.pas:1932). Each move drives the real swim
 * animation via tryStep; on the last move the normal win → winCountdown → showMap
 * path returns to the map. A death aborts back to the map.
 */
export function advanceReplay(): void {
  if (!replaymode || !room || !engine) return;
  if (room.anyFishDead) {
    // The best solution shouldn't kill a fish, but abort safely to the map if it does.
    setReplaymode(null);
    host.showMap();
    return;
  }
  if (replaymode.idx >= replaymode.moves.length) {
    setReplaymode(null); // ran dry without a win (defensive) — hand control back
    return;
  }
  const m = replaymode.moves[replaymode.idx++]!;
  engine.active = m.which;
  tryStep(m.which, m.dir);
  host.hracNespi();
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
  disposeAiKufr(); // release the upscaled frames (~37 MB at x4) on an early skip
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

/**
 * Reconcile the cutscene's KD-* caption layer.
 *
 * Shared by the faithful and the AI cutscene paths: the captions are their own layer, so
 * they are identical in both and must not be duplicated per path. The cutscene's own box
 * and content scale are handed over, not the room's — a cutscene is 720x555 whatever room
 * it was started from.
 *
 * Which is also why a caption is still sized from its own content scale while a ROOM
 * subtitle is now sized from the stage (framePainter): a cutscene has exactly one size,
 * so there is no room-to-room variation here to normalise, and pinning captions to the
 * stage would resize the briefcase intro to fix a symptom it does not have.
 * The readable band still applies (it lives in `syncDomSubtitles`, not at either call
 * site): a cutscene tracks the same viewport, so only room-to-room is cutscene-exempt.
 */
export function updateCutsceneCaptions(cssW: number, cssH: number, cs: number): void {
  if (!cutsceneSubs?.active) return;
  syncDomSubtitles('cut', cutsceneSubs, count, cssW, cssH, cs, cs, subFontFamily, subFontWeight);
}

/**
 * The AI-upscaled briefcase cutscene: the static suitcase/TV canvas plus one upscaled
 * image per DECODED animation frame (see tools/studio/stage-kufr.ts).
 *
 * The deltas in demo.pck cannot be upscaled — they are per-pixel palette writes — so the
 * frames are materialised offline. The script still drives playback: this only swaps the
 * PIXEL SOURCE, so the audio-dependent timeline, the KD-* narration, the captions and
 * the Escape skip are all untouched.
 */
export let aiKufr: AiKufr | null = null;
let aiKufrTried = false;
/** Decoded frames, bounded — all 284 at ×4 would be ~37 MB resident. */
export const aiKufrFrames = new Map<string, ImageBitmap>();
const AI_KUFR_CACHE_MAX = 24;
const aiKufrLoading = new Set<string>();
let aiKufrRangeWarned = false;

export async function ensureAiKufr(): Promise<void> {
  if (aiKufrTried) return;
  aiKufrTried = true;
  try {
    const res = await fetch('/enhanced-ai/_kufr/ai.json');
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
    const man = (await res.json()) as { scale: number; region: AiKufr['region']; order: string[] };
    const bres = await fetch('/enhanced-ai/_kufr/base.webp');
    if (!bres.ok || !(bres.headers.get('content-type') ?? '').startsWith('image/')) return;
    aiKufr = {
      base: await createImageBitmap(await bres.blob()),
      scale: Number(man.scale) || AI_ROOM_SCALE,
      region: man.region,
      order: man.order ?? [],
    };
  } catch (e) {
    console.warn('AI briefcase cutscene unavailable:', e);
  }
}

/** Fetch a cutscene frame (and prefetch the next few, since playback is linear). */
export function loadAiKufrFrame(name: string): void {
  if (!name || aiKufrFrames.has(name) || aiKufrLoading.has(name)) return;
  aiKufrLoading.add(name);
  void (async () => {
    try {
      const res = await fetch(`/enhanced-ai/_kufr/frames/${name}`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return;
      const bmp = await createImageBitmap(await res.blob());
      aiKufrFrames.set(name, bmp);
      while (aiKufrFrames.size > AI_KUFR_CACHE_MAX) {
        const oldest = aiKufrFrames.keys().next().value as string | undefined;
        if (oldest === undefined || oldest === name) break;
        aiKufrFrames.get(oldest)?.close();
        aiKufrFrames.delete(oldest);
      }
    } catch {
      /* this frame stays on the faithful path */
    } finally {
      aiKufrLoading.delete(name);
    }
  })();
}

/** Release the cutscene's decoded art (~37 MB of frames at ×4). */
export function disposeAiKufr(): void {
  aiKufrRangeWarned = false;
  for (const b of aiKufrFrames.values()) b.close();
  aiKufrFrames.clear();
  aiKufr?.base.close();
  aiKufr = null;
  aiKufrTried = false;
}

export function drawCutscene(): void {
  if (!cutscene) return;
  ui.mapSig = null; // cutscene paints #screen — invalidate the map cache
  const w = cutscene.width;
  const h = cutscene.height;
  const cs = contentScaleFor(w, h); // scaled + centered in the stage like the room it plays over (KUFRIK)
  const cssW = w * cs;
  const cssH = h * cs;
  const dpr = window.devicePixelRatio || 1;
  // Enhanced: render the KD-* captions in the bundled Mulish font on the vector
  // overlay (like room subtitles). Classic: keep the faithful baked bitmap font
  // composited into the 256-colour frame.
  const useVec = enhancedArtActive() && cutsceneSubs !== null && subFontReady;
  // The hi-res path draws bitmaps, so it cannot composite BAKED captions into the
  // indexed frame. When the vector overlay is unavailable (no subtitle font) it stands
  // down entirely rather than drop the narration text — same rule as the room gate.
  if (graphics === 'ai' && !aiKufrTried) void ensureAiKufr();
  const aiFrameIdx = Math.max(0, cutscene.framesShown - 1);
  const aiFrameName = aiKufr ? aiKufr.order[aiFrameIdx] ?? '' : '';
  // Running past the end means the shipped sequence and the decoder disagree. The
  // consequence is a silent mid-cutscene drop back to the faithful renderer, which is
  // exactly how the framesDrawn/framesShown mix-up hid, so say it once.
  if (aiKufr && !aiFrameName && !aiKufrRangeWarned) {
    aiKufrRangeWarned = true;
    console.warn(`AI cutscene: frame ${aiFrameIdx} is past the shipped sequence (${aiKufr.order.length}); falling back`);
  }
  if (aiKufr && aiFrameName) {
    loadAiKufrFrame(aiFrameName);
    for (let i = 1; i <= 4; i++) loadAiKufrFrame(aiKufr.order[cutscene.framesShown - 1 + i] ?? '');
  }
  const aiBmp = graphics === 'ai' && useVec && aiKufr ? aiKufrFrames.get(aiFrameName) ?? null : null;
  if (aiBmp && aiKufr) {
    const S = aiKufr.scale;
    glCanvas.style.display = 'none';
    if (canvas.width !== w * S || canvas.height !== h * S) { canvas.width = w * S; canvas.height = h * S; }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.style.transform = '';
    const wantSmooth = scalingFilterFor(w * S, cssW);
    if (canvas.style.imageRendering !== wantSmooth) canvas.style.imageRendering = wantSmooth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(aiKufr.base, 0, 0);
    ctx.drawImage(aiBmp, aiKufr.region.x * S, aiKufr.region.y * S);
    updateCutsceneCaptions(cssW, cssH, cs);
    setPerfPaint(perfPaint + 1);
    return;
  }
  if (canvas.style.imageRendering) canvas.style.imageRendering = '';
  const frame = new IndexedScreen(w, h);
  frame.px.set(cutscene.pixels);
  if (!useVec) cutsceneSubs?.draw(frame, count); // baked bitmap captions
  // Enhanced upgrade: bilinear-upscale the 256-colour frame on the GPU so it isn't
  // blocky on hi-DPI displays. Classic stays crisp (faithful) via the 2D path.
  const smoothGpu = enhancedArtActive() && renderer === 'webgl' && !glFailed;
  // #screen is the layout anchor of the wrap even when the GL canvas covers it, so
  // it must carry the cutscene's CSS box (native backing, SCALE-sized on screen —
  // the same box the KUFRIK room used, so entering/leaving the cutscene doesn't
  // shift the layout). Its backing also backs the 2D fallback blit below.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.transform = '';
  let presented = false;
  if (smoothGpu) {
    const comp = glCompositor();
    if (comp) {
      try {
        comp.renderIndexed(frame.px, w, h, cutscene.palette);
        // Back the GL canvas at the on-screen device resolution so the shader's
        // LINEAR upscale (not CSS scaling) does the smoothing; present + show it.
        const bw = Math.round(cssW * dpr);
        const bh = Math.round(cssH * dpr);
        if (glCanvas.width !== bw || glCanvas.height !== bh) {
          glCanvas.width = bw;
          glCanvas.height = bh;
        }
        glCanvas.style.width = `${cssW}px`;
        glCanvas.style.height = `${cssH}px`;
        glCanvas.style.transform = '';
        comp.present(bw, bh, true);
        glCanvas.style.display = 'block';
        presented = true;
      } catch {
        markGlFailed(); // fall through to the CPU blit for this frame
      }
    }
  }
  if (!presented) {
    glCanvas.style.display = 'none';
    const rgba = frame.toRgba(cutscene.palette);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  }
  // Mulish captions, in the same coordinate convention as the room's subtitles: the
  // layer spans the on-screen box and is placed from native (720x555) game pixels.
  if (useVec && cutsceneSubs!.active) {
    updateCutsceneCaptions(cssW, cssH, cs);
  } else {
    // Baked captions, or none at all: the layer stands down.
    clearDomSubtitles('cut');
  }
}
