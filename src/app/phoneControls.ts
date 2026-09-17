/** Phone corner controls. The tablet bar and its reserved-space layout stay separate. */
import { phoneUi, type TouchButtonsHost } from './touchButtons.js';
import { ui } from './screenState.js';
import { room } from './gameState.js';
import { touchOptionsOpen } from './touchOptions.js';
import { wake } from './frameClock.js';
import { initActiveFishIndicator, syncActiveFishIndicator } from './activeFishIndicator.js';

let controls: HTMLElement;
let more: HTMLButtonElement;
let menu: HTMLElement;
let owner: typeof room = null;
let expanded = false;

export function phoneMenuOpen(): boolean {
  return expanded;
}

function setExpanded(want: boolean, focus = false): void {
  if (want === expanded) return;
  expanded = want;
  menu.hidden = !want;
  more.setAttribute('aria-expanded', String(want));
  if (focus) {
    if (want) menu.querySelector<HTMLButtonElement>('button')?.focus();
    else more.focus();
  }
  wake();
}

export function initPhoneControls(host: TouchButtonsHost): void {
  controls = document.getElementById('phone-controls')!;
  more = document.getElementById('phone-more') as HTMLButtonElement;
  menu = document.getElementById('phone-menu')!;
  more.addEventListener('click', (e) => {
    if (e.detail > 0) more.blur();
    setExpanded(!expanded, e.detail === 0);
  });
  for (const el of controls.querySelectorAll<HTMLButtonElement>('[data-region]')) {
    const region = Number(el.dataset.region);
    if (!Number.isFinite(region)) throw new Error('Invalid phone control region');
    el.addEventListener('click', (e) => {
      if (e.detail > 0) el.blur();
      setExpanded(false, e.detail === 0);
      host.panelAction(region);
    });
  }
  // Dismissing the menu must not also swap/move a fish underneath it.
  window.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Node)) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && controls.contains(focused) && !focused.contains(e.target)) focused.blur();
    if (!expanded || controls.contains(e.target)) return;
    setExpanded(false);
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  window.addEventListener('keydown', (e) => {
    const onControl = controls.contains(document.activeElement);
    if (!expanded && !onControl) return;
    if (e.code === 'Escape' && expanded) {
      setExpanded(false, true);
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (e.code === 'Space' || e.code === 'Enter' || (expanded && e.code.startsWith('Arrow'))) {
      // Let native button activation happen, but never route menu keys into the game.
      e.stopImmediatePropagation();
    }
  }, true);
  controls.addEventListener('focusout', (e) => {
    if (expanded && e.relatedTarget instanceof Node && !controls.contains(e.relatedTarget)) setExpanded(false);
  });
  window.addEventListener('blur', () => setExpanded(false));
}

export function syncPhoneControls(): void {
  const want = phoneUi() && ui.screen === 'room' && !ui.helpOpen && !touchOptionsOpen();
  if (want) initActiveFishIndicator();
  if (expanded && (!want || owner !== room)) setExpanded(false);
  owner = room;
  if (controls.hidden === want) controls.hidden = !want;
  syncActiveFishIndicator(want && !expanded);
}
