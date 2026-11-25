/**
 * The tutorial's Save/Load cue on a TV: the browser's `dialogueHints.ts` pulses the touch
 * Save or Load button while KUFRIK's demonstration says how to use it (help2: save, help7 and
 * help11: load). A TV has no such buttons; the legend's item for the verb pulses instead (the
 * controller spec's A4) — the pad's Save (LB) or Load (RB), or, with the remote, whose Save
 * and Load are in the top bar, its Menu item, as a phone's cue opens its "..." menu.
 *
 * The lifecycle is the browser's: the cue starts with the line (whether or not it is voiced
 * or captioned) and lasts as long as it does; it goes with the room, with the demonstration
 * that said it (a recorded F3 rebuilds the room without ending the narration, so the same
 * demonstration may carry it across a rebuild), over a cutscene or a Replay, and when time
 * is up. The swipe illustration (`1st-v-navod1`) is touch-only and has no TV counterpart.
 */
import { cutscene, replaymode, room, showmode } from '../../src/app/gameState.js';
import { ui } from '../../src/app/screenState.js';
import { roomLoading } from './seams/framePacing.js';

export type HintVerb = 'save' | 'load';

// restates src/app/dialogueHints.ts `const HINTS: ReadonlyMap<string, Hint> =` @ bb63d88f0e9c
const HINTS: ReadonlyMap<string, HintVerb> = new Map([
  ['help2', 'save'],
  ['help7', 'load'],
  ['help11', 'load'],
]);

let current: { verb: HintVerb; owner: typeof room; demo: typeof showmode; until: number } | null = null;

/** `allowed()`, minus what is the touch UI's (touch mode, its Options, Tetris, a hidden page). */
const allowed = (): boolean => ui.screen === 'room' && room !== null && !roomLoading && !cutscene && !replaymode;

/** A line starts (`game.ts`'s talk hook), lasting `durationMs`. */
export function showTutorialHint(name: string, durationMs: number): void {
  current = null;
  const verb = HINTS.get(name);
  if (!verb || !allowed()) return;
  current = { verb, owner: room, demo: showmode, until: performance.now() + durationMs };
}

/**
 * The verb whose legend item pulses now, or null.
 * restates src/app/dialogueHints.ts `export function syncDialogueHint(` @ 900d10a62e4e
 */
export function tutorialHintVerb(now: number = performance.now()): HintVerb | null {
  if (!current) return null;
  const sameRoom = current.owner === room || (current.demo !== null && current.demo === showmode);
  if (!allowed() || !sameRoom || current.demo !== showmode || now >= current.until) {
    current = null;
    return null;
  }
  return current.verb;
}

/**
 * How far into its pulse a cue is at `now`, 0..1: the browser's `dialogue-hint-pulse`, 1.2 s
 * ease-in-out, out at the ends and fully lit (a 3 px ring) half way.
 */
export function pulsePhase(now: number = performance.now()): number {
  const t = (now % 1200) / 1200;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
}
