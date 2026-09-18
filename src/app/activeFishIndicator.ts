import littlePicture from '../../public/enhanced-ai/_fish/x4/small/right/body_rest_00.webp?inline';
import bigPicture from '../../public/enhanced-ai/_fish/x4/big/right/body_rest_00.webp?inline';
import { roomArtPending } from './art.js';
import { wake } from './frameClock.js';
import { roomLoading } from './framePacing.js';
import { cutscene, engine, loadmode, replaymode, room, showmode } from './gameState.js';
import { fatalShown, showFatal } from './loadingUi.js';
import { roomEntryHeld } from './roomLoad.js';
import { inSolvemode } from './solveMode.js';
import { switchFishFromTouch } from './touchSwipe.js';

let badge: HTMLButtonElement | null = null;
let pictures: Record<'little' | 'big', HTMLImageElement>;

/** One switch button shared by the phone corners and tablet bar, including live mode changes. */
export function initActiveFishIndicator(controlsId: 'phone-controls' | 'touchbar' = 'phone-controls'): void {
  const controls = document.getElementById(controlsId);
  if (!controls) throw new Error(`Active fish indicator requires ${controlsId}`);
  if (badge) {
    if (badge.parentElement !== controls) controls.append(badge);
    return;
  }
  const button = document.createElement('button');
  badge = button;
  button.type = 'button';
  badge.id = 'active-fish-indicator';
  badge.className = 'tbtn';
  badge.hidden = true;
  button.title = 'Switch fish';
  button.addEventListener('click', (e) => {
    if (button.hidden) return;
    const keepFocus = e.detail === 0 && document.activeElement === button;
    // Phone controls reserve Space/Enter while focused. Let the shared tap's
    // synthetic Space through, then restore keyboard focus after activation.
    button.blur();
    switchFishFromTouch();
    if (keepFocus) button.focus({ preventScroll: true });
  });
  button.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') e.stopPropagation();
  });
  const picture = (source: string): HTMLImageElement => {
    const img = document.createElement('img');
    img.alt = '';
    img.hidden = true;
    img.draggable = false;
    img.addEventListener('load', wake);
    img.addEventListener('error', () => showFatal('The active fish picture could not be loaded. Please reload the game.'));
    img.src = source;
    return img;
  };
  pictures = { little: picture(littlePicture), big: picture(bigPicture) };
  badge.append(pictures.little, pictures.big);
  controls.append(badge);
}

/** Read the same selection as movement/undo/exit handover; never select a fish here. */
export function syncActiveFishIndicator(controlsVisible: boolean): void {
  if (!badge) return;
  const active = engine?.active;
  const want = controlsVisible && !!room && !!active && room.alive[active] &&
    !roomLoading && !roomArtPending() && !roomEntryHeld() && !fatalShown() &&
    !cutscene && !loadmode && !replaymode && !showmode && !inSolvemode() &&
    pictures[active].complete && pictures[active].naturalWidth > 0;
  if (badge.hidden === want) badge.hidden = !want;
  if (!want || !active) return;
  if (badge.dataset.fish !== active) {
    badge.dataset.fish = active;
    badge.setAttribute('aria-label', active === 'little'
      ? 'Active fish: small orange fish. Switch fish'
      : 'Active fish: big blue fish. Switch fish');
    pictures.little.hidden = active !== 'little';
    pictures.big.hidden = active !== 'big';
  }
}
