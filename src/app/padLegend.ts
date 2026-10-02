/**
 * The controller legend: on a TV, which button does what, where the tablet has buttons.
 *
 * A TV derives its UI from the tablet's (`touchMode.ts`), and the tablet's in-room verbs
 * are a strip of buttons along whichever edge covers less of the room. A controller
 * cannot press those, so on a TV that strip becomes a LEGEND instead: the same verbs, each
 * labelled with the controller button that does it (`padInput.ts` owns the mapping). It is
 * placed by the very same rule as the tablet strip (`touchBarPlacement`), and the items
 * carry the same `data-region` as the buttons they stand for, which is what lets the
 * tutorial's Save/Load pulse (`dialogueHints.ts`) find them.
 *
 * Unlike the tablet strip it is not only for a room: every screen a controller can be on
 * gets the few lines that matter there (the map, the record panel, Options, help, the
 * briefcase demo, the story page). Derived per frame from the screen, like the strip, and
 * rewritten only when its content or placement actually changes.
 */
import '../styles/pad.css';
import { cutscene, room } from './gameState.js';
import { intro } from './introOverlay.js';
import { roomLoading } from './framePacing.js';
import { mapLaunching } from './roomLaunch.js';
import { tetrisModal } from './cheats.js';
import { settings } from './playerSettings.js';
import { ui } from './screenState.js';
import { touchOptionsOpen } from './touchOptions.js';
import { tvUi } from './touchButtons.js';
import { touchBarPlacement, TOUCHBAR_LEAD } from './touchBarEdge.js';
import { TOUCH_REGIONS } from './keyTables.js';
import { padConfirmOpen } from './padInput.js';
import { roomScreenSize } from '../render/renderRoom.js';
import { MAP_H, MAP_W } from '../render/worldMap.js';

type Glyph = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'menu' | 'view' | 'ls' | 'rs' | 'dpad';
type Entry = { glyphs: Glyph[]; label: string; region?: number };
type Context = 'room' | 'cutscene' | 'map' | 'mapinfo' | 'options' | 'help' | 'credits' | 'continue';

const GLYPH_TEXT: Record<Glyph, string> = {
  a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', menu: '☰', view: '⧉', ls: 'L', rs: 'R', dpad: '✚',
};

/** What each screen shows. The room's order is the tablet strip's, sticks first. */
export const LEGEND: Record<Context, Entry[]> = {
  room: [
    { glyphs: ['ls'], label: 'Little' },
    { glyphs: ['rs'], label: 'Big' },
    { glyphs: ['b'], label: 'Map', region: TOUCH_REGIONS.map },
    { glyphs: ['lb'], label: 'Save', region: TOUCH_REGIONS.save },
    { glyphs: ['rb'], label: 'Load', region: TOUCH_REGIONS.load },
    { glyphs: ['x'], label: 'Restart', region: TOUCH_REGIONS.restart },
    { glyphs: ['menu'], label: 'Options', region: TOUCH_REGIONS.options },
    { glyphs: ['y'], label: 'Undo', region: TOUCH_REGIONS.undo },
  ],
  cutscene: [{ glyphs: ['b'], label: 'Skip' }],
  map: [
    { glyphs: ['ls'], label: 'Choose' },
    { glyphs: ['a'], label: 'Open' },
    { glyphs: ['menu'], label: 'Options' },
  ],
  mapinfo: [
    { glyphs: ['ls'], label: 'Choose' },
    { glyphs: ['a'], label: 'Select' },
    { glyphs: ['b'], label: 'Cancel' },
  ],
  options: [
    { glyphs: ['dpad'], label: 'Change' },
    { glyphs: ['a'], label: 'Select' },
    { glyphs: ['b'], label: 'Done' },
  ],
  help: [
    { glyphs: ['lb', 'rb'], label: 'Page' },
    { glyphs: ['b'], label: 'Close' },
  ],
  credits: [{ glyphs: ['b'], label: 'Close' }],
  continue: [{ glyphs: ['a'], label: 'Continue' }],
};

let el: HTMLElement | null = null;
let shown: Context | null = null;
let edge: 'left' | 'top' | null = null;
let inset = -1;

function glyphHtml(g: Glyph): string {
  return `<span class="pg pg-${g}">${GLYPH_TEXT[g]}</span>`;
}

function render(ctx: Context): void {
  el!.innerHTML = LEGEND[ctx]
    .map((e) =>
      `<div class="pl-item"${e.region !== undefined ? ` data-region="${e.region}"` : ''}>` +
      `<span class="pl-glyphs">${e.glyphs.map(glyphHtml).join('')}</span><span>${e.label}</span></div>`)
    .join('');
}

/**
 * Build the legend and the confirm prompt. Called once from `main.ts` at boot, whatever
 * the device: two hidden elements cost nothing, and creating them later would be a second
 * place that decides whether this is a TV.
 */
export function initPadLegend(): void {
  el = document.createElement('div');
  el.id = 'padlegend';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  const confirm = document.createElement('div');
  confirm.id = 'pad-confirm';
  confirm.hidden = true;
  confirm.setAttribute('role', 'alertdialog');
  confirm.setAttribute('aria-labelledby', 'pad-confirm-title');
  confirm.innerHTML =
    `<div class="pc-card"><div id="pad-confirm-title"></div>` +
    `<div class="pc-keys"><span>${glyphHtml('a')}Yes</span><span>${glyphHtml('b')}No</span></div></div>`;
  document.body.appendChild(confirm);
}

/** Which legend this frame wants, or null for none. */
function context(): Context | null {
  if (!tvUi() || intro.playing || ui.feedback?.isOpen() || tetrisModal() || padConfirmOpen()) return null;
  if (touchOptionsOpen()) return 'options';
  if (ui.helpOpen) return 'help';
  if (ui.mapOverlay === 'credits') return 'credits';
  if (ui.screen === 'legimage') return 'continue';
  if (ui.screen === 'map') {
    if (mapLaunching() !== null) return null;
    return ui.mapInfoRoom !== null ? 'mapinfo' : 'map';
  }
  if (ui.screen === 'room') return cutscene ? 'cutscene' : 'room';
  return null;
}

/** The size of what is on screen, for the placement rule: the room, else the map. */
function contentSize(): { w: number; h: number } {
  if (ui.screen === 'room' && room && !roomLoading) {
    const s = roomScreenSize(room);
    if (s.w > 0 && s.h > 0) return s;
  }
  return { w: MAP_W, h: MAP_H };
}

/** Put the legend up, change it, or take it down. Called from the frame loop. */
export function syncPadLegend(): void {
  if (!el) return;
  const want = context();
  if (want !== shown) {
    shown = want;
    el.hidden = want === null;
    if (want !== null) render(want);
  }
  if (want === null) return;
  const { w, h } = contentSize();
  const p = touchBarPlacement(
    w,
    h,
    window.innerWidth,
    window.innerHeight,
    settings.fitMode,
    window.devicePixelRatio || 1,
    0,
    TOUCHBAR_LEAD,
  );
  if (p.inset !== inset) {
    inset = p.inset;
    el.style.setProperty('--legend-inset', `${inset}px`);
  }
  if (p.edge !== edge) {
    edge = p.edge;
    document.documentElement.setAttribute('data-padlegend-edge', edge);
  }
}
