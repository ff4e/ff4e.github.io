import { applyRusticIcons } from '../platform/nativeMenuIcons.js';
import { menuPalette } from '../platform/nativeMenuPalette.js';
import { NATIVE_MENU_HUES } from '../data/nativeMenuHues.js';
import { curNum, roomArtPending } from './art.js';
import { graphics } from './renderSettings.js';
import { roomLoading } from './framePacing.js';
import { fatalShown } from './loadingUi.js';
import { ui } from './screenState.js';

let enabled = false;
let lastRoom = 0;
let lastTier = '';
const colorKeys = ['glass', 'edge', 'popup', 'pressed', 'symbol', 'highlight', 'shade', 'detail', 'outline'] as const;

/** Called only by the native boot path (or explicitly by the browser UI probe). */
export function initNativeMenu(): void {
  applyRusticIcons(document);
  document.documentElement.setAttribute('data-native-menu', '');
  enabled = true;
  syncNativeMenu();
}

/** No work in browsers; native accents use the reviewed, static room palette. */
export function syncNativeMenu(): void {
  if (!enabled || curNum === 0 || ui.screen !== 'room' || roomLoading || roomArtPending() || fatalShown()) return;
  if (curNum === lastRoom && graphics === lastTier) return;
  const hue = NATIVE_MENU_HUES[curNum - 1];
  if (hue === undefined) throw new Error(`Missing native menu palette for room ${curNum}`);
  const palette = menuPalette(hue);
  const root = document.documentElement;
  for (const key of colorKeys) {
    const value = palette[key];
    if (value === null) root.style.removeProperty(`--menu-${key}`);
    else root.style.setProperty(`--menu-${key}`, value);
  }
  root.dataset.nativeMenuRoom = String(curNum);
  root.dataset.nativeMenuHue = String(palette.hue);
  root.dataset.nativeMenuTier = graphics;
  lastRoom = curNum;
  lastTier = graphics;
}
