/**
 * Touch-only illustrations of the original tutorial dialogue, not new game actions.
 * Both room scripts and KUFRIK's recorded helptext reach scriptTalk. Nothing here
 * changes their queues, timing, subtitles, or the player's input.
 */
import { wrap } from './dom.js';
import { cutscene, replaymode, room, showmode } from './gameState.js';
import { roomLoading } from './framePacing.js';
import { ui } from './screenState.js';
import { touchUi } from './touchButtons.js';
import { touchOptionsOpen } from './touchOptions.js';
import { tetrisModal } from './cheats.js';
import { TOUCH_REGIONS } from './keyTables.js';

type Hint = 'gesture' | 'save' | 'load';
const HINTS: ReadonlyMap<string, Hint> = new Map([
  ['1st-v-navod1', 'gesture'],
  ['help2', 'save'],
  ['help7', 'load'],
  ['help11', 'load'],
]);

const GESTURE = `
<svg viewBox="0 0 200 160" aria-hidden="true">
  <g class="hint-track hint-horizontal">
    <path d="M40 70H160 M48 62L40 70L48 78 M152 62L160 70L152 78"/>
  </g>
  <g class="hint-track hint-vertical">
    <path d="M100 26V114 M92 34L100 26L108 34 M92 106L100 114L108 106"/>
  </g>
  <g transform="translate(100 70)">
    <circle class="hint-tap" r="15"/>
    <g class="hint-finger">
      <path d="M-6 26V0C-6-8 6-8 6 0V17
        C6 10 17 10 17 18V21C17 14 28 15 28 23V26
        C28 20 39 22 39 30V40C39 56 29 64 16 64H9
        C0 64-5 57-10 50L-23 32C-28 24-20 18-14 24L-6 32Z"/>
    </g>
  </g>
</svg>`;

let current: {
  owner: typeof room;
  demo: typeof showmode;
  until: number;
  overlay: HTMLDivElement | null;
  button: HTMLElement | null;
} | null = null;

function allowed(): boolean {
  return touchUi() && ui.screen === 'room' && room !== null && !roomLoading &&
    !cutscene && !replaymode && !ui.helpOpen && !touchOptionsOpen() &&
    !tetrisModal() && !document.hidden;
}

export function clearDialogueHint(): void {
  if (!current) return;
  current.overlay?.remove();
  current.button?.classList.remove('dialogue-hint-pulse');
  current = null;
}

/** Called only when the line starts, including when voices or subtitles are muted. */
export function showDialogueHint(name: string, durationMs: number): void {
  clearDialogueHint();
  const hint = HINTS.get(name);
  if (!hint || !allowed()) return;
  // Missing audio has a 960ms dialogue fallback, too short for three gestures.
  const hintMs = hint === 'gesture' ? Math.max(durationMs, 2500) : durationMs;
  let overlay: HTMLDivElement | null = null;
  let button: HTMLElement | null = null;
  if (hint === 'gesture') {
    overlay = document.createElement('div');
    overlay.id = 'dialogue-gesture-hint';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.setProperty('--hint-duration', `${hintMs}ms`);
    overlay.innerHTML = GESTURE;
    wrap.appendChild(overlay);
  } else {
    button = document.querySelector<HTMLElement>(`#touchbar [data-region="${TOUCH_REGIONS[hint]}"]`);
    if (!button) throw new Error(`Missing tutorial ${hint} button`);
    // Restart even if the very same line is spoken twice before the next paint.
    void button.offsetWidth;
    button.classList.add('dialogue-hint-pulse');
  }
  current = { owner: room, demo: showmode, until: performance.now() + hintMs, overlay, button };
}

/** Derived beside the touch bar so no room/screen transition must know about hints. */
export function syncDialogueHint(now: number): void {
  if (!current) return;
  // A recorded F3 rebuilds the room without ending the narration. Only that same
  // demo may carry a hint across a rebuild; player restart/load must clear it.
  const sameRoom = current.owner === room || (current.demo !== null && current.demo === showmode);
  if (!allowed() || !sameRoom || current.demo !== showmode || now >= current.until) clearDialogueHint();
}
