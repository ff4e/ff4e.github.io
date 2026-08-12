/**
 * The live room, and how it is currently being played.
 *
 * ── Why these are exported bindings and not a state bag ──────────────────────
 * `screenState.ts` gave the screen globals an owner as a plain mutable object, `ui`,
 * because that region is read about 655 times and a three-character prefix was the
 * cheapest honest thing. This region is read **1 237 times** — `room` alone accounts for
 * 588 of them — and the same treatment would have added ~1 500 tokens of `game.` to the
 * most-read file in the repository to save ~1 300 tokens of declarations. Worse than
 * doing nothing.
 *
 * The asymmetry that decides the shape: of those 1 237 references, **74 are writes.**
 * ESM live bindings make the other 1 163 free — an importer sees `room` change under it,
 * with no accessor, no prefix and no diff at the point of use. So the reads are exported
 * directly and only the assignments become calls.
 *
 * This is the pattern `art.ts` already uses (`export let aiPanel`, mutated through
 * operations), applied to the state that was making extraction expensive.
 *
 * ── Setters, rather than operations ──────────────────────────────────────────
 * Each writable value gets a plain `setX`. Collapsing several into one operation the way
 * `art.ts` does with `beginRoomArt()` is better where the invariant is known — those
 * flags are only correct when set together — but the invariants binding *these* values
 * are spread across `buildRoom`, `loadRoom`, the cutscene and the replay modes and are
 * not established yet. Inventing an operation would be inventing an invariant, so the
 * setters stay dumb until a real one is written down.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * Module scope is side-effect-free — every declaration below is a literal or `null`.
 * `main.ts` refuses to run on a phone before any other side effect, and an imported
 * module is evaluated before any statement of its importer (AGENTS.md, "the
 * module-evaluation trap"). Nothing here touches the DOM, `localStorage` or the network.
 */
import type { CapAction } from '../intro/helpCap.js';
import type { ChatterState } from '../core/chatter.js';
import type { DeathState } from '../core/deathlines.js';
import type { FfrRoom } from '../data/ffr.js';
import type { FftEntry } from '../data/fft.js';
import type { FontData } from '../render/font.js';
import type { KufrDemo } from '../intro/kufrDemo.js';
import type { RecordStep } from '../core/record.js';
import type { Room } from '../core/room.js';
import type { RoomScript, Script, ScriptSnapshot } from '../core/script.js';
import type { StepEngine } from '../core/stepEngine.js';
import type { SubtitleSystem } from '../render/subtitles.js';

// ── The room ────────────────────────────────────────────────────────────────
export let ffr: FfrRoom | null = null;
export let room: Room | null = null;
export let font: FontData | null = null;
export let subs: SubtitleSystem | null = null;
/**
 * The current room's FFT, in file order. Only the order-sensitive uses need this:
 * every by-name lookup goes through `audio.entry()`, which already indexes every
 * loaded package and so needs no per-package copy here.
 */
export let fftEntries: FftEntry[] = [];

export function setFfr(v: FfrRoom | null): void {
  ffr = v;
}
export function setRoom(v: Room | null): void {
  room = v;
}
export function setFont(v: FontData | null): void {
  font = v;
}
export function setSubs(v: SubtitleSystem | null): void {
  subs = v;
}
export function setFftEntries(v: FftEntry[]): void {
  fftEntries = v;
}

// ── The engine, the script and the tick ─────────────────────────────────────
export let activeScript: { def: RoomScript; s: Script } | null = null;
export let chatter: ChatterState | null = null; // StdKecej ambient-chatter timer for the current room
export let deathState: DeathState | null = null; // StdSmrt death-commentary state for the current room
export let roomDepth = 0; // the current room's Hloubka (Depth), for death-line selection
export let pokus = 1; // attempt number, incremented on death-restart
export let count = 0;
// The shared step-engine drives all deterministic move/tick/win logic (created per
// room build in buildRoom). Its fields (phase, animFrame, active, exiting, swim,
// corkExit, winCountdown, srecord, …) are the authoritative game state that the
// renderer, panel and input read — the same engine the headless solutions harness runs.
export let engine: StepEngine | null = null;
export let alpha = 0; // sub-tick interpolation fraction (0..1) for smooth rendering
export let linesSpoken = 0; // debug: total dialogue lines fired
export let lastLine: { name: string; count: number } | null = null;

export function setActiveScript(v: { def: RoomScript; s: Script } | null): void {
  activeScript = v;
}
export function setChatter(v: ChatterState | null): void {
  chatter = v;
}
export function setDeathState(v: DeathState | null): void {
  deathState = v;
}
export function setRoomDepth(v: number): void {
  roomDepth = v;
}
export function setPokus(v: number): void {
  pokus = v;
}
export function setCount(v: number): void {
  count = v;
}
export function setEngine(v: StepEngine | null): void {
  engine = v;
}
export function setAlpha(v: number): void {
  alpha = v;
}
export function setLinesSpoken(v: number): void {
  linesSpoken = v;
}
export function setLastLine(v: { name: string; count: number } | null): void {
  lastLine = v;
}

// ── Per-fish tick state ─────────────────────────────────────────────────────
// Mutable contents, never reassigned, so they need no setter — but they were declared at
// the top level of main.ts, which is exactly what made them unreachable from anywhere
// else. That is the whole problem this module exists to remove, and it applies to a
// `const` object every bit as much as to a `let`.
export const talkIdx = { little: 0, big: 0 };
export const prevKostra = { little: false, big: false };
// posl_mluv (URoom.pas:264): current talking mouth frame per fish (-1 = not talking,
// else 0..2 indexing hl_mluvi / tl_mluvi_na). Voice-priorities: little=mluvi_mala=1,
// big=mluvi_velka=2 (URoom.pas:435-436).
export const poslMluv: { little: number; big: number } = { little: -1, big: -1 };
export const blink = { little: 0, big: 0 };
// gspec=2 darkness flicker (KresliRybu, URoom.pas:25747): each tick a fish has a
// ~6% chance to wink out (random(100)<6). Kept tick-stable like `blink`.
export const darkFlicker = { little: false, big: false };

// ── The three playback modes, and the cutscene ──────────────────────────────
export let cutscene: KufrDemo | null = null;
export let cutsceneSubs: SubtitleSystem | null = null;
export let cutsceneAssets: { bmp: Uint8Array; pck: Uint8Array; script: string } | null = null;
// showmode (KUFRIK automatic demonstration, URoom.pas:19932/26971): the recorded
// help.cap input stream auto-plays — the fish move themselves and the tutorial
// subtitles appear. One recorded action is consumed per logic tick; player input is
// blocked (except restart/exit, which end it). `showmodeLoading` covers the async
// fetch of help.cap; `showmodeHelptext` is the tutorial-subtitle counter (helptext).
export let showmode: { actions: CapAction[]; idx: number } | null = null;
export let showmodeLoading = false;
export let showmodeHelptext = 0;
// Guards a recorded restart RUN (the ~12 consecutive akce_restart entries the demo's
// death-restart produces) so the room is rebuilt only once per run.
export let showmodeRestarted = false;
// The demo's own save slot (akce_save/akce_load, URoom.pas:24480). The demonstration
// saves a checkpoint (help7: "we can load a saved position with F3") and reloads it
// after each death — kept in memory so it never touches the player's real save.
export let showmodeSave: { rec: string; snapshot: ScriptSnapshot | null } | null = null;
// Fast-forward load animation (TRoom.Load loadmode, URoom.pas:24102): a load replays
// the saved move record over several ticks at LoadSpeed moves/tick (a visible rewind-
// and-replay), rather than teleporting. Drives both player F3 and the demo's reload.
export let loadmode: {
  steps: RecordStep[];
  idx: number;
  speed: number;
  snapshot: ScriptSnapshot | null;
} | null = null;
// Debug replay trace (opt-in via __ff.showmodeTraceOn).
export let showmodeTraceOn = false;
export const showmodeTrace: Array<Record<string, number | boolean | string>> = [];
// Map "Replay" playback (daReplay, UMain.pas:1023): the room's best solution is
// re-played move-by-move as a real swim animation (one move per idle tick), then
// the normal win path returns to the map. Distinct from loadmode (teleport-fast
// F3 load) and showmode (the KUFRIK demo's recorded-action format).
export let replaymode: { moves: { which: 'little' | 'big'; dir: number }[]; idx: number } | null = null;
// KAJUTA1 gspec=3/4 "screen-shove" easter egg: the big fish pushing a wall slides the
// whole view (the original moves the OS window Left±5; the port shifts the canvas). In
// display px, reset per room, clamped so the gag stays on-screen.
export let screenShoveX = 0;

export function setCutscene(v: KufrDemo | null): void {
  cutscene = v;
}
export function setCutsceneSubs(v: SubtitleSystem | null): void {
  cutsceneSubs = v;
}
export function setCutsceneAssets(
  v: { bmp: Uint8Array; pck: Uint8Array; script: string } | null,
): void {
  cutsceneAssets = v;
}
export function setShowmode(v: { actions: CapAction[]; idx: number } | null): void {
  showmode = v;
}
export function setShowmodeLoading(v: boolean): void {
  showmodeLoading = v;
}
export function setShowmodeHelptext(v: number): void {
  showmodeHelptext = v;
}
export function setShowmodeRestarted(v: boolean): void {
  showmodeRestarted = v;
}
export function setShowmodeSave(v: { rec: string; snapshot: ScriptSnapshot | null } | null): void {
  showmodeSave = v;
}
export function setLoadmode(
  v: { steps: RecordStep[]; idx: number; speed: number; snapshot: ScriptSnapshot | null } | null,
): void {
  loadmode = v;
}
export function setShowmodeTraceOn(v: boolean): void {
  showmodeTraceOn = v;
}
export function setReplaymode(
  v: { moves: { which: 'little' | 'big'; dir: number }[]; idx: number } | null,
): void {
  replaymode = v;
}
export function setScreenShoveX(v: number): void {
  screenShoveX = v;
}
