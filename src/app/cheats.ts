/**
 * The cheats: the typed codes, the sprite and film effects they switch on, and the
 * hidden Tetris minigame.
 *
 * ~6 % of main.ts by weight and almost none of its change traffic — 4 of the last 25
 * commits to that file touched any of it. Nothing a normal change needs to read, which
 * is exactly why it is worth moving out of the way.
 *
 * ── The seam ──────────────────────────────────────────────────────────────────
 * This module OWNS its state (which cheats are on, the reshaped sprites, the Tetris
 * board) and exports it with plain `export let`. Those are ES module LIVE bindings, so
 * a reader in main.ts still sees the current value of `silentFilm` with no getter and no
 * accessor, and cannot assign it back — which is what we want: the cheats own their
 * flags. That is why the references in main.ts are untouched by this move.
 *
 * What the cheats need FROM the game — the current room, the engine, the audio, a
 * handful of callbacks — arrives through `initCheats()` as a host of getters. One-way
 * by design: the game does not hand its state over, the cheats only look at it, and
 * the two values they write back go through setters.
 *
 * The host is injected rather than imported because main.ts is the entry module;
 * importing back into it would be a cycle. Every member is a GETTER, including the
 * ones that look constant: initCheats() is called early, at the point this code used
 * to sit, and `audio`/`hooks`/`MLUVI_PRIOR` are not declared until much further down
 * main.ts. Passing them by value would read them in their temporal dead zone.
 *
 * Module scope here is deliberately side-effect-free — a couple of `new CheatEntry()`
 * and some flags — so nothing jumps ahead of the boot order main.ts sequences.
 */
import { AudioEngine } from '../audio/audio.js';
import {
  CheatEntry,
  morphShrink,
  morphShrinkRgba,
  morphStretch,
  morphStretchRgba,
  pretoc,
  pretocRgba,
} from '../core/cheats.js';
import type { Cheat } from '../core/cheats.js';
import { HookSystem } from '../core/hooks.js';
import { Room } from '../core/room.js';
import { Script } from '../core/script.js';
import type { RoomScript } from '../core/script.js';
import { StepEngine } from '../core/stepEngine.js';
import { TetrisGame, parseShapes } from '../core/tetris.js';
import type { HiscoreStore, TetrisShapes } from '../core/tetris.js';
import { parseBmp } from '../data/bmp.js';
import { isAssetError, requiredBytes, requiredText } from '../render/assetFetch.js';
import { reportAssetError } from './loadingUi.js';
import type { FfrBitmap, FfrRoom } from '../data/ffr.js';
import type { EnhancedSprite, FishSprites } from '../render/enhancedArtSource.js';
import {
  INTERLACED_OFF,
  INTERLACED_START,
  INTERLACED_STOP,
  interlacedSounds,
  sum,
  zcernobilit,
  zpracujInterlaced,
} from '../render/filmEffects.js';
import type { RgbaScreen } from '../render/rgbaScreen.js';
import { SubtitleSystem } from '../render/subtitles.js';
import { renderTetris, tetrisRgba } from '../render/tetrisRender.js';
import type { TetrisArt } from '../render/tetrisRender.js';
import { select } from './dom.js';
import { armSolve, setSolvemode } from './solveMode.js';
import type { SolveArmError } from './solveMode.js';

/** What the cheats see of the running game. Read-only but for the two setters. */
export interface CheatsHost {
  readonly screen: "map" | "room" | "intro" | "legimage";
  readonly devEnabled: boolean;
  /** True while any other automated playback mode owns the room (replay / demo / load). */
  readonly playbackBusy: () => boolean;
  readonly engine: StepEngine | null;
  readonly room: Room | null;
  readonly ffr: FfrRoom | null;
  readonly subs: SubtitleSystem | null;
  readonly activeScript: { def: RoomScript; s: Script } | null;
  readonly fishSprites: FishSprites | null;
  readonly count: number;
  readonly audio: AudioEngine;
  readonly hooks: HookSystem;
  readonly EFFECT_VOL: number;
  readonly MLUVI_PRIOR: { readonly little: number; readonly big: number };
  readonly solved: Set<number>;
  readonly cheated: Set<number>;
  readonly scores: Map<number, number>;
  readonly saveCheated: () => void;
  readonly showMap: () => void;
  readonly enterRoom: (num: number, replay?: string) => Promise<void>;
  readonly wake: () => void;
  readonly clearHeldKey: () => void;
  readonly syncScriptMusicVolume: () => void;
  readonly applyVolumeSettings: () => void;
  /** The one value the cheats write back: force the next frame to repaint. */
  forceRoomRedraw: boolean;
}

/**
 * The live game, as the cheats see it. Assigned once by initCheats() during boot,
 * before anything here can run (the earliest trigger is a keypress), so the definite
 * assignment assertion holds and 30 null checks are avoided.
 */
let host!: CheatsHost;

/** Hand the cheats their view of the game. Called once, from main.ts, during boot. */
export function initCheats(h: CheatsHost): void {
  host = h;
}

/**
 * Clear the room-scoped cheats (URoom.pas:1430-1433). They survive a RESTART and die
 * on a room CHANGE, so buildRoom calls this only when it is not carrying state over.
 * Lives here rather than in buildRoom so that main.ts never assigns this module s
 * state — the live bindings are read-only to it by construction.
 */
export function resetRoomScopedCheats(): void {
  spriteCheats = [];
  oldWater = null;
  endSilentFilm(); // TRoom.Done also restores the volumes on the way out
  interlacedFaze = INTERLACED_OFF;
  roomCheats.reset();
}

/**
 * Restore/clear the megabomb one-shot flash.
 *
 * Only `__ff.roomEffectFrameHash` needs this: it snapshots the flag, renders the
 * effects frame, and puts it back, so merely ASKING for the hash cannot swallow a
 * flash the player is owed. Not for the game.
 */
export function setMegabombFlash(v: boolean): void {
  megabombFlash = v;
}

export function cheatSolveRoom(): void {
  if (host.screen !== 'room') return;
  const n = Number(select.value);
  if (Number.isFinite(n)) {
    if (!host.solved.has(n)) host.cheated.add(n); // genuinely-won rooms stay "solved", not "cheat"
    host.saveCheated();
    host.showMap();
  }
}

/**
 * Dev-only: genuinely win the current room. Unlike cheatSolveRoom (xwemaketherulez), which
 * jumps straight to the map and marks the room "cheated", this drives the real win path —
 * engine.triggerWin -> onWin bookkeeping (marks the room solved) -> the auto-return
 * countdown -> returnFromRoom — so an end-of-leg room reveals its story page exactly as a
 * real solve would. Armed only while the dev pane is enabled.
 *
 * It has NO button and no hotkey any more: the dev bar's button now plays the room's
 * recorded solution instead (`devSolveRoom`), which is the more useful thing to have a
 * button for. This survives as `__ff.winRoom()` because a solution replay cannot replace
 * it — reaching a story page is still the only way to spot-check that flow, and the room
 * that proves it is ZAVER #71, the endgame, which has no recorded solution at all because
 * it is not a puzzle. `tools/test-zaverpage.mjs` and `tools/test-legimage.mjs` are the
 * callers.
 */
export function devWinRoom(): void {
  if (!host.devEnabled || host.screen !== 'room' || !host.engine || !host.room) return;
  if (host.engine.phase !== 'idle' || host.room.won) return;
  host.engine.triggerWin();
}

/** Why a solution replay could not be started, if it could not. `null` means it is running. */
export type SolveStartResult = { error: SolveArmError | 'unavailable'; detail: string } | null;

/**
 * Dev-only: play the current room from its own recorded solution through the real game
 * loop — the live counterpart of the headless solvability net. The driver, the abort
 * conditions and the speed multiplier are `solveMode.ts`; this is only the dev gate and
 * the "which room am I in" lookup, kept beside `devWinRoom` because both are dev-bar
 * actions on the room currently on screen.
 *
 * `speed` shortens the logic tick so a 6 045-move recording is not minutes of watching;
 * 1 is real speed, which is the point of the mode and the default.
 */
export function devSolveRoom(speed = 1): SolveStartResult {
  if (!host.devEnabled || host.screen !== 'room' || !host.engine || !host.room) {
    return { error: 'unavailable', detail: 'needs the dev pane enabled and a room on screen' };
  }
  if (host.room.won) return { error: 'unavailable', detail: 'the room is already won' };
  // A recording starts from the room's SPAWN state and assumes it is the only thing
  // pressing keys. Refuse if another playback mode already owns the room, and refuse mid
  // animation — starting on a half-finished swim or fall replays the recording against a
  // room it does not describe, and every abort it then reports is a false one.
  if (host.playbackBusy()) {
    return { error: 'unavailable', detail: 'another playback mode (replay/demo/load) is running' };
  }
  if (host.engine.phase !== 'idle') {
    return { error: 'unavailable', detail: 'the room is still moving — wait for it to settle' };
  }
  if (host.room.anyFishDead) return { error: 'unavailable', detail: 'a fish is dead — restart first' };
  if (host.engine.srecord !== '') {
    return { error: 'unavailable', detail: 'the room has already been played — restart it first' };
  }
  const jmeno = host.activeScript?.def.name;
  if (!jmeno) return { error: 'unavailable', detail: 'the room has no script, so no solution to look up' };
  const armed = armSolve(jmeno, speed);
  if ('error' in armed) return armed;
  setSolvemode(armed);
  return null;
}

// ---------------------------------------------------------------------------
// Typed cheat codes (Uovl.pas:744 in a room, UMain.pas:1750 on the map).
// ---------------------------------------------------------------------------

/** `cheatstring` — the room's entry buffer. Armed by X, parked between codes. */
export const roomCheats = new CheatEntry();
/** `dircheat` (UMain.pas:1727) — the map's own buffer; the two never share state. */
export const mapCheats = new CheatEntry();

/** ultraviolence (USoutez.pas:24): every room entered from now on spawns a hook
 *  (TRoom.Start, URoom.pas:1503). Armed from the map and never cleared. */
export let ultraviolence = false;
/** oldamp/oldper/oldspd (URoom.pas:24607): the water params xstorm displaced. */
export let oldWater: { amp: number; per: number; spd: number } | null = null;
/**
 * The sprite cheats currently applied, in the order they were typed. Both are
 * toggles that rewrite the fish head/body frames, and both survive a restart in
 * the original (TRoom.Restart does not reload the sprites), so the port keeps the
 * state and recomputes the frames from the pristine parsed data whenever the Room
 * is rebuilt. The original's xmorph instead restores the bitmaps it saved when it
 * was switched on (Hlavy1/Tela1, URoom.pas:23832) — indistinguishable unless the
 * two cheats are interleaved, where recomputing is the better-behaved of the two.
 */
export let spriteCheats: ('UNDEAD' | 'MORPH')[] = [];
/** megabomb (URoom.pas:26192): blank the room white for exactly one painted frame. */
export let megabombFlash = false;
/** silentfilm (URoom.pas:181): the xsilent cheat's black-and-white movie mode. */
export let silentFilm = false;
/** interlacedfaze (URoom.pas:195): -1 off, -2 winding down, >=0 the collapse phase. */
export let interlacedFaze = INTERLACED_OFF;
/** The hidden SCORE bonus room (branch 9, `av:=9; am:=1` — UMain.pas:1774). */
const SCORE_ROOM = 72;

/**
 * xmegabomb (URoom.pas:24534): kill both fish where they float — light-kind
 * skeletons that erode away — then blank the room white for a frame. The original
 * counts both deaths, kills any speech, and drops whatever the fish were holding.
 */
function cheatMegabomb(): void {
  if (!host.room || !host.engine) return;
  for (const which of ['little', 'big'] as const) {
    if (host.room.alive[which]) host.room.killFish(which);
  }
  host.audio.snd('sp-smrt1', 3, false, host.EFFECT_VOL);
  host.audio.snd('sp-smrt2', 3, false, host.EFFECT_VOL);
  host.audio.killVoice(host.MLUVI_PRIOR.little); // KSnd(mluvi_mala)
  host.audio.killVoice(host.MLUVI_PRIOR.big); // KSnd(mluvi_velka)
  host.activeScript?.s.clearDialog(); // Zrus_dialogy
  host.room.clearAllDirs();
  if (host.room.padani()) {
    host.engine.phase = 'fall'; // gstav := stav_ma_padat
    host.engine.animFrame = 0;
  }
  megabombFlash = true;
  host.forceRoomRedraw = true;
}

/** A head/body frame table, as both `Room.heads` and `Room.bodies` are shaped. */
type FrameSet = { big: readonly (FfrBitmap | null)[]; small: readonly (FfrBitmap | null)[] };
/** One facing of the enhanced truecolor fish sprites (both sizes). */
type FishFacing = { small: Map<string, EnhancedSprite>; big: Map<string, EnhancedSprite> };
/** The reshaped enhanced sprites while a sprite cheat is on, else null. */
export let cheatFishSprites: FishSprites | null = null;

/** pretoc (URoom.pas:23892) over a whole frame table — the xundead flip. */
function undeadSet(set: FrameSet): FrameSet {
  const flip = (frames: readonly (FfrBitmap | null)[]): (FfrBitmap | null)[] =>
    frames.map((bm) => (bm ? pretoc(bm) : bm));
  return { big: flip(set.big), small: flip(set.small) };
}

/** morph (URoom.pas:23832) over a whole frame table — each fish takes the other's
 *  shape. Both halves derive from the ORIGINALS, as the Delphi does via
 *  bmmala1/bmvelka1, so the swap is a genuine exchange rather than a chain. */
function morphSet(set: FrameSet): FrameSet {
  return {
    small: set.small.map((bm, i) => (bm && set.big[i] ? morphShrink(set.big[i]!) : bm)),
    big: set.big.map((bm, i) => (bm && set.small[i] ? morphStretch(set.small[i]!) : bm)),
  };
}

/** The same two transforms over one facing of the enhanced truecolor fish, which
 *  the enhanced art source blits instead of the FFR frames. Sprites are paired by
 *  filename, so a frame present for only one fish is left alone. */
function undeadFacing(set: FishFacing): FishFacing {
  const out: FishFacing = { small: new Map(), big: new Map() };
  for (const size of ['small', 'big'] as const) {
    for (const [k, v] of set[size]) out[size].set(k, pretocRgba(v));
  }
  return out;
}

function morphFacing(set: FishFacing): FishFacing {
  const out: FishFacing = { small: new Map(set.small), big: new Map(set.big) };
  for (const [k, small] of set.small) {
    const big = set.big.get(k);
    if (!big) continue;
    out.small.set(k, morphShrinkRgba(big));
    out.big.set(k, morphStretchRgba(small));
  }
  return out;
}

/**
 * Recompute the fish sprites: the pristine art, then every active sprite cheat in
 * the order it was typed. Both art sources are covered — the FFR head/body frames
 * the classic renderer uses, and the enhanced truecolor set, which is a wholly
 * separate path (EnhancedArtSource.drawFish) that would otherwise ignore the
 * cheats entirely in the mode the game ships in. Nothing shared is mutated.
 */
export function applySpriteCheats(): void {
  if (host.room && host.ffr) {
    let heads: FrameSet = host.ffr.heads;
    let bodies: FrameSet = host.ffr.bodies;
    for (const c of spriteCheats) {
      const f = c === 'UNDEAD' ? undeadSet : morphSet;
      heads = f(heads);
      bodies = f(bodies);
    }
    host.room.heads = heads;
    host.room.bodies = bodies;
  }
  if (!host.fishSprites || spriteCheats.length === 0) {
    cheatFishSprites = null;
    return;
  }
  let left: FishFacing = { small: host.fishSprites.small.left, big: host.fishSprites.big.left };
  let right: FishFacing = { small: host.fishSprites.small.right, big: host.fishSprites.big.right };
  for (const c of spriteCheats) {
    const f = c === 'UNDEAD' ? undeadFacing : morphFacing;
    left = f(left);
    right = f(right);
  }
  cheatFishSprites = {
    small: { left: left.small, right: right.small },
    big: { left: left.big, right: right.big },
  };
}

/** Toggle one of the two sprite cheats (xundead URoom.pas:24573, xmorph :24588). */
function toggleSpriteCheat(which: 'UNDEAD' | 'MORPH'): void {
  spriteCheats = spriteCheats.includes(which)
    ? spriteCheats.filter((c) => c !== which)
    : [...spriteCheats, which];
  applySpriteCheats();
  host.forceRoomRedraw = true;
}

/** xstorm (URoom.pas:24607): whip the water up (wamp/wspd/wper = 10/4/6), or put
 *  it back if it is already storming — the original toggles on those exact values. */
function cheatStorm(): void {
  if (!host.room) return;
  if (host.room.wamp === 10 && host.room.wspd === 4 && host.room.wper === 6 && oldWater) {
    host.room.wamp = oldWater.amp;
    host.room.wper = oldWater.per;
    host.room.wspd = oldWater.spd;
    oldWater = null;
  } else {
    oldWater = { amp: host.room.wamp, per: host.room.wper, spd: host.room.wspd };
    host.room.wamp = 10;
    host.room.wspd = 4;
    host.room.wper = 6;
  }
  host.forceRoomRedraw = true;
}

/**
 * xsilent (URoom.pas:24641): silent-movie mode — the sound is cut, the picture
 * goes sepia, film grain scratches over it, and every spoken line becomes an
 * intertitle card instead of a subtitle. Typing it again restores the volumes and
 * the colour; so does leaving the room (TRoom.Done, URoom.pas:1513).
 */
function cheatSilent(): void {
  if (silentFilm) {
    endSilentFilm();
    return;
  }
  for (const bus of ['effect', 'voice', 'music'] as const) host.audio.setBusGain(bus, 0);
  silentFilm = true;
  host.syncScriptMusicVolume(); // music_volume := 0, which room scripts can see (VES)
  if (host.subs) {
    host.subs.silentFilm = true;
    host.subs.silentTime = 0; // cassilenttit := 0
  }
  host.forceRoomRedraw = true;
}

/**
 * Undo silent-film mode — on a second xsilent, and on leaving the room, which is
 * where the original does it (TRoom.Done, URoom.pas:1513-1518).
 *
 * The original restores its `oldmusic`/`oldsnd`/`oldtalk` snapshot; the port
 * restores the persisted settings instead. They are the same thing unless the
 * player moved a slider while the film was running, in which case restoring the
 * snapshot would leave what you HEAR disagreeing with where the slider SITS —
 * the original re-derives its slider from the volume, so it has no such split.
 */
export function endSilentFilm(): void {
  if (!silentFilm) return;
  silentFilm = false;
  host.applyVolumeSettings();
  host.syncScriptMusicVolume();
  if (host.subs) {
    host.subs.silentFilm = false;
    host.subs.silentTime = 0;
  }
  host.forceRoomRedraw = true;
}

/** xinterlaced (URoom.pas:24627): start the screen collapsing in on itself, or —
 *  if it already is — ask it to wind down (faze -2 runs one last frame). */
function cheatInterlaced(): void {
  interlacedFaze = interlacedFaze >= 0 ? INTERLACED_STOP : INTERLACED_START;
  host.forceRoomRedraw = true;
}

/**
 * Advance the film effects' own counters, once per game tick.
 *
 * These live in `KresliMistnost` in the original (URoom.pas:26200-26205, 26079),
 * which is driven from `Jedeme` — i.e. once per ~80ms logic tick, not once per
 * painted frame. The port paints at up to 60fps, so running them from the render
 * path made the intertitle cards and the interlaced collapse play roughly five
 * times too fast.
 */
export function tickFrameEffects(): void {
  if (silentFilm && host.subs && host.subs.silentTime > 0) host.subs.silentTime--;
  if (interlacedFaze !== INTERLACED_OFF) {
    // `sp-smrt` fires on the phase whose shift passes -10 (URoom.pas:26058).
    if (interlacedSounds(interlacedFaze)) host.audio.snd('sp-smrt', -10, false, host.EFFECT_VOL);
    interlacedFaze++;
  }
}

/** True while a cheat needs the whole finished frame post-processed, which the
 *  GPU path cannot do — those frames render on the CPU instead. */
export function frameEffectsActive(): boolean {
  return megabombFlash || silentFilm || interlacedFaze !== INTERLACED_OFF || tetris !== null;
}

/** Blit the minigame's 150x300 board into the middle of an RGBA frame. It has its
 *  own palette, so it goes straight into the colour plane. */
export function blitTetris(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): void {
  if (!tetris || !tetrisArt) return;
  const bw = tetrisArt.hole.w;
  const bh = tetrisArt.hole.h;
  const src = tetrisRgba(renderTetris(tetris, tetrisArt), tetrisArt);
  const ox = Math.floor((w - bw) / 2);
  const oy = Math.floor((h - bh) / 2);
  for (let y = 0; y < bh; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= h) continue;
    for (let x = 0; x < bw; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= w) continue;
      const s = (y * bw + x) * 4;
      const d = (dy * w + dx) * 4;
      rgba[d] = src[s]!;
      rgba[d + 1] = src[s + 1]!;
      rgba[d + 2] = src[s + 2]!;
      rgba[d + 3] = 255;
    }
  }
}

/**
 * The tail of KresliMistnost (URoom.pas:26192-26281): the megabomb flash, the
 * silent-film intertitle card, the grain, and the interlaced collapse — in the
 * original's order, over the finished frame.
 */
export function applyFrameEffects(screen: RgbaScreen, useVecSubs: boolean, grain = true): void {
  const rnd = (n: number): number => Math.floor(Math.random() * n);
  const scratch = (s: RgbaScreen): void => {
    if (grain) sum(s, rnd); // probes disable the random grain to get a stable hash
  };
  if (tetris && tetrisArt) {
    // The minigame sits over the (frozen) room, as its modal window does.
    blitTetris(screen.rgba, screen.width, screen.height);
    return;
  }
  if (megabombFlash) {
    // VyplnMistnost(fontcol['w',1]); KresliTitulky — one white frame, then back.
    megabombFlash = false;
    host.forceRoomRedraw = true;
    screen.fillIndex(host.subs?.fontcolIndex('w', 1) ?? 255);
    host.subs?.draw(screen, host.count);
    return;
  }
  if (silentFilm && host.subs?.silentActive) {
    // The card replaces the room entirely while it runs.
    screen.fillIndex(host.subs.fontcolIndex('w', 4));
    host.subs.drawSilentTitle(screen);
    scratch(screen);
    zcernobilit(screen.rgba);
    return;
  }
  if (!useVecSubs) host.subs?.draw(screen, host.count); // baked subtitles (palette-coloured, on top)
  if (silentFilm) scratch(screen);
  if (interlacedFaze !== INTERLACED_OFF) {
    zpracujInterlaced(screen, interlacedFaze, host.subs?.fontcolIndex('w', 4) ?? 255);
  }
  if (silentFilm) zcernobilit(screen.rgba);
}

/**
 * xtetris (URoom.pas:24564, UMain.pas:1764): the Tetris minigame. The original
 * opens it as a modal window over the game (`Tetris.ShowModal`), which freezes
 * the room's timer until it closes; the port has no windows, so it draws the
 * 150x300 board centred over the frozen room and takes the keyboard until Escape.
 */
export let tetris: TetrisGame | null = null;
export let tetrisArt: TetrisArt | null = null;
let tetrisLoading = false;
let tetrisAcc = 0; // ms accumulated toward the next 55ms game tick (Ttr.dfm)
export let tetrisTick = 0; // ticks run, so the map's paint cache knows the board moved
let tetrisPending = false; // the cheat fired and the board art is still loading
const TETRIS_TICK_MS = 55;

/** ttr.pic (Ttr.pas:339) — the persistent top-ten, in localStorage here. */
const tetrisHiscores: HiscoreStore = {
  load: () => {
    try {
      const raw = localStorage.getItem('ff.tetris');
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  },
  save: (scores) => {
    try {
      localStorage.setItem('ff.tetris', JSON.stringify(scores));
    } catch {
      /* storage unavailable */
    }
  },
};

/** Load the minigame's atlas + well bitmaps and shape table (nacti, Ttr.pas:89). */
async function ensureTetrisArt(): Promise<TetrisArt | null> {
  if (tetrisArt || tetrisLoading) return tetrisArt;
  tetrisLoading = true;
  try {
    const what = 'the minigame';
    const bytes = (url: string): Promise<Uint8Array> => requiredBytes(url, what, 'shouldHave');
    const txtUrl = '/data/Intro/all.txt';
    const [all, hole, txt] = await Promise.all([
      bytes('/data/Intro/all.BMP'),
      bytes('/data/Intro/dira.BMP'),
      requiredText(txtUrl, what, 'shouldHave'),
    ]);
    const shapes = parseShapes(txt);
    tetrisArt = {
      all: parseBmp(all),
      hole: parseBmp(hole),
      xfont: shapes.xfont,
      yfont: shapes.yfont,
    };
    tetrisShapes = shapes;
  } finally {
    tetrisLoading = false;
  }
  return tetrisArt;
}
let tetrisShapes: TetrisShapes | null = null;

/**
 * Open the minigame (Tetris.Create + ShowModal). The original's launch is
 * synchronous; the port has to fetch the board art first, so `tetrisPending`
 * makes the game modal from the instant the code fires — otherwise the room kept
 * running and taking input during the fetch, and the board could pop open on a
 * screen the player had since moved to.
 */
function openTetris(): void {
  if (tetris || tetrisPending) return;
  const screenAtLaunch = host.screen;
  tetrisPending = true;
  host.wake();
  void ensureTetrisArt()
    .then(() => {
      if (!tetrisPending) return; // cancelled (Escape) while the art was loading
      tetrisPending = false;
      if (!tetrisArt || !tetrisShapes || tetris || host.screen !== screenAtLaunch) return;
      tetris = new TetrisGame(tetrisShapes, (n) => Math.floor(Math.random() * n), tetrisHiscores);
      tetrisAcc = 0;
      host.forceRoomRedraw = true;
      host.wake();
    })
    .catch((e: unknown) => {
      if (!isAssetError(e)) throw e;
      // `tetrisPending` makes the game MODAL from the instant the code fires, and the
      // only thing that clears it is the `then` above. A failed load therefore used to
      // be harmless only because it ended the session; at `shouldHave` it would leave
      // the player in a modal with no minigame in it and no way out. The flag has to
      // come down here.
      tetrisPending = false;
      host.wake();
      reportAssetError(e, () => openTetris());
    });
}

/** Close it (modalresult := mrCancel): the room resumes with no key held
 *  (gstav := stav_klid; keyroom := 0; keyovl := 0 — URoom.pas:24568). */
export function closeTetris(): void {
  if (!tetris && !tetrisPending) return;
  tetris = null;
  tetrisPending = false;
  host.clearHeldKey();
  if (host.engine) host.engine.swim = null;
  host.forceRoomRedraw = true;
  host.wake();
}

/** True while the minigame owns the game — including the moment between the cheat
 *  firing and its art arriving. */
export function tetrisModal(): boolean {
  return tetris !== null || tetrisPending;
}

/** Advance the minigame's own 55ms timer, independent of the game's logic tick. */
export function tickTetris(dtMs: number): void {
  if (!tetris) return;
  host.wake(); // the board animates on its own; never let the idle throttle stall it
  tetrisAcc += dtMs;
  let steps = 0;
  while (tetrisAcc >= TETRIS_TICK_MS && steps < 4) {
    tetrisAcc -= TETRIS_TICK_MS;
    steps++;
    tetrisTick++;
    tetris.tick();
  }
  host.forceRoomRedraw = true;
}

/**
 * The in-room cheat dispatch (URoom.pas:24534-24690). Codes 11/12 have no case
 * here — SCORE and ULTRAVIOLENCE only work from the map (UMain.pas:1773-1780).
 */
export function applyRoomCheat(cheat: Cheat): void {
  if (host.screen !== 'room' || !host.room) return;
  switch (cheat) {
    case 'MEGABOMB':
      cheatMegabomb();
      break;
    case 'UNDEAD':
      toggleSpriteCheat('UNDEAD');
      break;
    case 'MORPH':
      toggleSpriteCheat('MORPH');
      break;
    case 'FISHER':
      host.hooks.add(host.room);
      break;
    case 'TETRIS':
      openTetris();
      break;
    case 'STORM':
      cheatStorm();
      break;
    case 'INTERLACED':
      cheatInterlaced();
      break;
    case 'SILENT':
      cheatSilent();
      break;
    case 'WEMAKETHERULEZ':
      cheatSolveRoom();
      break;
    case 'IAMACHEATER':
      // Deliberately nothing: the original's body is `{soutez:=not soutez;}` —
      // commented out, so the retail build just swallows the code.
      break;
    default:
      break;
  }
}

/** The map-screen cheat dispatch (UMain.pas:1760-1782). Only three codes act here. */
export function applyMapCheat(cheat: Cheat): void {
  switch (cheat) {
    case 'SCORE':
      // `av:=9; am:=1; doAkce:=daRun` — run the hidden SCORE bonus room, which is
      // kept off the map and out of the finale, so this code is the only way in.
      void host.enterRoom(SCORE_ROOM);
      break;
    case 'TETRIS':
      // The map screen launches the minigame too (UMain.pas:1764).
      openTetris();
      break;
    case 'ULTRAVIOLENCE':
      ultraviolence = true;
      break;
    default:
      break;
  }
}


