/** One first-entry pinch illustration per tutorial room, only where zoom works. */
import { curNum, roomArtPending } from './art.js';
import { tetrisModal } from './cheats.js';
import { stageBox } from './dom.js';
import { roomLoading } from './framePacing.js';
import { cutscene, loadmode, replaymode, room, showmode } from './gameState.js';
import { fatalShown } from './loadingUi.js';
import { phoneMenuOpen } from './phoneControls.js';
import { roomBenefitsFromZoom } from './phoneZoom.js';
import { subLang } from './playerSettings.js';
import { roomEntryHeld } from './roomLoad.js';
import { ui } from './screenState.js';
import { inSolvemode } from './solveMode.js';
import { roomGeometry } from './stageGeometry.js';
import { phoneUi } from './touchButtons.js';
import { touchOptionsOpen } from './touchOptions.js';
import '../styles/zoomHint.css';

const DURATION_MS = 5000;
const seen = new Map<number, boolean>();
const GESTURE = `
<svg viewBox="0 0 200 130" aria-hidden="true">
  <path class="zoom-hint-arrows" d="M75 38H25L35 28M25 38L35 48
    M125 38H175L165 28M175 38L165 48"/>
  <g class="zoom-hint-left">
    <circle cx="75" cy="38" r="12"/>
    <path transform="translate(-50 0)" d="M130 82V38C130 31 120 31 120 38V65
      C120 58 110 58 110 65V69C110 62 100 62 100 69V86
      C100 104 110 114 123 114H128C136 114 142 107 146 100L156 84
      C160 77 152 72 147 78L130 92Z"/>
  </g>
  <g class="zoom-hint-right">
    <circle cx="125" cy="38" r="12"/>
    <path transform="translate(50 0)" d="M70 82V38C70 31 80 31 80 38V65
      C80 58 90 58 90 65V69C90 62 100 62 100 69V86
      C100 104 90 114 77 114H72C64 114 58 107 54 100L44 84
      C40 77 48 72 53 78L70 92Z"/>
  </g>
</svg>`;

let current: { owner: typeof room; overlay: HTMLDivElement; until: number } | null = null;

function alreadySeen(num: number): boolean {
  if (!seen.has(num)) {
    let value = false;
    try {
      value = localStorage.getItem(`ff.zoomHint.${num}`) === '1';
    } catch (error) {
      console.warn('[zoom hint] Could not read tutorial progress; using this session only', error);
    }
    seen.set(num, value);
  }
  return seen.get(num)!;
}

function remember(num: number): void {
  seen.set(num, true);
  try {
    localStorage.setItem(`ff.zoomHint.${num}`, '1');
  } catch (error) {
    console.warn('[zoom hint] Could not save tutorial progress; remembered for this session only', error);
  }
}

function allowed(): boolean {
  return phoneUi() && ui.screen === 'room' && room !== null && (curNum === 2 || curNum === 3) &&
    !roomLoading && !roomArtPending() && !roomEntryHeld() && !fatalShown() &&
    !cutscene && !showmode && !replaymode && !loadmode && !inSolvemode() &&
    !ui.helpOpen && !touchOptionsOpen() && !phoneMenuOpen() && !tetrisModal() &&
    !document.hidden && roomBenefitsFromZoom(roomGeometry(room).scale);
}

export function clearZoomHint(): void {
  current?.overlay.remove();
  current = null;
}

/** Called after the room and its controls have been presented, never during a load. */
export function syncZoomHint(now: number): void {
  const canShow = allowed();
  if (current) {
    if (!canShow || current.owner !== room || now >= current.until) clearZoomHint();
    else return;
  }
  if (!canShow || alreadySeen(curNum)) return;
  const overlay = document.createElement('div');
  overlay.id = 'phone-zoom-hint';
  overlay.setAttribute('role', 'img');
  const label = subLang() === 'cz' ? 'Přiblížení dvěma prsty' : 'Pinch to zoom';
  overlay.setAttribute('aria-label', label);
  overlay.innerHTML = GESTURE;
  const caption = document.createElement('span');
  caption.textContent = label;
  caption.setAttribute('aria-hidden', 'true');
  overlay.appendChild(caption);
  // Outside wrap: the illustration must not zoom or pan with the room it teaches.
  stageBox.appendChild(overlay);
  current = { owner: room, overlay, until: now + DURATION_MS };
  remember(curNum);
}
