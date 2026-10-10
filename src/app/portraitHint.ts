/** A one-time suggestion for VRAK, never an orientation lock or an input gate. */
import { curNum, roomArtPending } from './art.js';
import { tetrisModal } from './cheats.js';
import { stageBox } from './dom.js';
import { roomLoading } from './framePacing.js';
import { cutscene, loadmode, replaymode, room, showmode } from './gameState.js';
import { fatalShown } from './loadingUi.js';
import { phoneMenuOpen } from './phoneControls.js';
import { subLang } from './playerSettings.js';
import { roomEntryHeld } from './roomLoad.js';
import { ui } from './screenState.js';
import { inSolvemode } from './solveMode.js';
import { phoneUi } from './touchButtons.js';
import { touchOptionsOpen } from './touchOptions.js';
import { isOrientationUnlocked } from '../platform/orientationLock.js';
import '../styles/portraitHint.css';

const SEEN_KEY = 'ff.portraitHint.4';
const DURATION_MS = 5000;
// One full icon turn: an unlock-time portrait resize must not consume a fleeting hint.
const REMEMBER_AFTER_MS = 2400;
const ROTATE = `
<svg viewBox="0 0 72 72" aria-hidden="true">
  <path class="portrait-hint-arrow" d="M9 40V25A18 18 0 0 1 27 7h16m-6-6 6 6-6 6"/>
  <g class="portrait-hint-phone">
    <rect x="24" y="16" width="24" height="40" rx="4"/>
    <rect class="portrait-hint-screen" x="28" y="22" width="16" height="24" rx="1"/>
    <path d="M33 51h6"/>
  </g>
</svg>`;

let seen: boolean | null = null;
let current: {
  owner: typeof room; overlay: HTMLDivElement; rememberAt: number; until: number;
} | null = null;

function alreadySeen(): boolean {
  if (seen === null) {
    seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
    } catch (error) {
      console.warn('[portrait hint] Could not read tutorial progress; using this session only', error);
    }
  }
  return seen;
}

function remember(): void {
  seen = true;
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch (error) {
    console.warn('[portrait hint] Could not save tutorial progress; remembered for this session only', error);
  }
}

function allowed(): boolean {
  return phoneUi() && ui.screen === 'room' && room !== null && curNum === 4 &&
    window.innerWidth > window.innerHeight &&
    !roomLoading && !roomArtPending() && !roomEntryHeld() && !fatalShown() &&
    !cutscene && !showmode && !replaymode && !loadmode && !inSolvemode() &&
    !ui.helpOpen && !touchOptionsOpen() && !phoneMenuOpen() && !tetrisModal() &&
    !document.hidden && isOrientationUnlocked();
}

export function clearPortraitHint(): void {
  current?.overlay.remove();
  current = null;
}

/** Runs after the room, entry overlay and controls have been presented. */
export function syncPortraitHint(now: number): void {
  const canShow = allowed();
  if (current) {
    if (!canShow || current.owner !== room) clearPortraitHint();
    else {
      if (!seen && now >= current.rememberAt) remember();
      if (now < current.until) return;
      clearPortraitHint();
    }
  }
  if (!canShow || alreadySeen()) return;
  const overlay = document.createElement('div');
  overlay.id = 'phone-portrait-hint';
  overlay.setAttribute('role', 'img');
  const label = subLang() === 'cz'
    ? 'Zkuste telefon na výšku pro lepší přehled.'
    : 'Try portrait for a better view.';
  overlay.setAttribute('aria-label', label);
  overlay.innerHTML = ROTATE;
  // A sibling of wrap, so pinch zoom never magnifies or pans the hint.
  stageBox.appendChild(overlay);
  current = { owner: room, overlay, rememberAt: now + REMEMBER_AFTER_MS, until: now + DURATION_MS };
}
