/**
 * Touch-only illustrations of the original tutorial dialogue, not new game actions.
 * Both room scripts and KUFRIK's recorded helptext reach scriptTalk. Nothing here
 * changes their queues, timing, subtitles, or the player's input — except that a phone's
 * Save/Load cue opens the "..." menu, whose usual rules then apply (an outside tap closes
 * it). Those lines come only from KUFRIK's demonstration, which blocks play anyway.
 */
import { wrap } from './dom.js';
import { cutscene, replaymode, room, showmode } from './gameState.js';
import { roomLoading } from './framePacing.js';
import { ui } from './screenState.js';
import { phoneUi, touchUi } from './touchButtons.js';
import { phoneMenuOpen, setPhoneMenuOpen } from './phoneControls.js';
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

// Drawn pointing right; placeArrow() turns it towards its button.
const ARROW = `
<svg viewBox="0 0 56 28" aria-hidden="true">
  <path d="M2 9H32V2L54 14L32 26V19H2Z"/>
</svg>`;
/** Where the arrow sits relative to its button, and the turn that makes it point there. */
type Side = 'left' | 'right' | 'above' | 'below';
const ANGLE: Readonly<Record<Side, number>> = { left: 0, right: 180, above: 90, below: -90 };
// Clear of the pulse's 3px ring.
const ARROW_GAP = 8;

let current: {
  owner: typeof room;
  demo: typeof showmode;
  until: number;
  overlay: HTMLDivElement | null;
  button: HTMLElement | null;
  arrow: HTMLDivElement | null;
  /** The button is inside the phone's "..." menu, which must stay open for it. */
  phone: boolean;
  /** This hint opened the menu, so it closes it again; one the player opened stays open. */
  openedMenu: boolean;
  /** The room the menu was last opened in; a demo rebuild closes it with the room. */
  menuRoom: typeof room;
} | null = null;

function allowed(): boolean {
  return touchUi() && ui.screen === 'room' && room !== null && !roomLoading &&
    !cutscene && !replaymode && !ui.helpOpen && !touchOptionsOpen() &&
    !tetrisModal() && !document.hidden;
}

export function clearDialogueHint(): void {
  if (!current) return;
  current.overlay?.remove();
  current.arrow?.remove();
  current.button?.classList.remove('dialogue-hint-pulse');
  if (current.openedMenu && phoneMenuOpen()) setPhoneMenuOpen(false);
  current = null;
}

/** Re-placed every frame: rotation, the bar changing edge or the menu scrolling all move the button. */
function placeArrow(): void {
  const arrow = current?.arrow;
  const button = current?.button;
  if (!arrow || !button) return;
  const box = button.getBoundingClientRect();
  const visible = box.width > 0 && box.height > 0;
  if (arrow.hidden === visible) arrow.hidden = !visible;
  if (!visible) return;
  const bar = button.parentElement?.getBoundingClientRect() ?? box;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  // Across the bar, never along it, so the arrow cannot lie over a neighbouring button;
  // and from the side facing the middle of the screen, where the room is.
  const side: Side = bar.height > bar.width ?
    (cx < innerWidth / 2 ? 'right' : 'left') :
    (cy < innerHeight / 2 ? 'below' : 'above');
  const x = side === 'left' ? box.left - ARROW_GAP : side === 'right' ? box.right + ARROW_GAP : cx;
  const y = side === 'above' ? box.top - ARROW_GAP : side === 'below' ? box.bottom + ARROW_GAP : cy;
  const transform = `translate(${x}px, ${y}px) rotate(${ANGLE[side]}deg)`;
  if (arrow.style.transform !== transform) arrow.style.transform = transform;
  if (arrow.dataset.side !== side) arrow.dataset.side = side;
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
  let arrow: HTMLDivElement | null = null;
  const phone = hint !== 'gesture' && phoneUi();
  let openedMenu = false;
  if (hint === 'gesture') {
    overlay = document.createElement('div');
    overlay.id = 'dialogue-gesture-hint';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.setProperty('--hint-duration', `${hintMs}ms`);
    overlay.innerHTML = GESTURE;
    wrap.appendChild(overlay);
  } else {
    // On a phone Save/Load hide under "...": open it, so the cue lands on the real button.
    if (phone && !phoneMenuOpen()) {
      setPhoneMenuOpen(true);
      openedMenu = true;
    }
    button = document.querySelector<HTMLElement>(
      `${phone ? '#phone-menu' : '#touchbar'} [data-region="${TOUCH_REGIONS[hint]}"]`);
    if (!button) throw new Error(`Missing tutorial ${hint} button`);
    // Restart even if the very same line is spoken twice before the next paint.
    void button.offsetWidth;
    button.classList.add('dialogue-hint-pulse');
    arrow = document.createElement('div');
    arrow.id = 'dialogue-button-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = ARROW;
    document.body.appendChild(arrow);
  }
  current = {
    owner: room, demo: showmode, until: performance.now() + hintMs, overlay, button, arrow,
    phone, openedMenu, menuRoom: room,
  };
  placeArrow();
}

/** Derived beside the touch bar so no room/screen transition must know about hints. */
export function syncDialogueHint(now: number): void {
  if (!current) return;
  // A recorded F3 rebuilds the room without ending the narration. Only that same
  // demo may carry a hint across a rebuild; player restart/load must clear it.
  const sameRoom = current.owner === room || (current.demo !== null && current.demo === showmode);
  if (!allowed() || !sameRoom || current.demo !== showmode || now >= current.until ||
    (current.button !== null && current.phone !== phoneUi())) {
    clearDialogueHint();
    return;
  }
  if (current.phone && !phoneMenuOpen()) {
    // The player closing the menu (or pressing Save/Load in it) is done with the cue.
    // A demo restart/F3 rebuild closes it with the room instead (phoneControls.ts).
    if (current.menuRoom === room) {
      clearDialogueHint();
      return;
    }
    setPhoneMenuOpen(true);
    current.menuRoom = room;
  }
  placeArrow();
}
