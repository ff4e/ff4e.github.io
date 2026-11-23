/**
 * The record panel (krokoměr) enlarged on a phone — see INFO_PHONE_ZOOM in
 * `render/mapInfo.ts` for why, and `infoPanelCutout` there for how the panel is lifted
 * off the map so it can be scaled at all.
 *
 * The faithful 1:1 panel is still `mapDraw.ts`'s; the enlarged one is drawn by
 * `render/zoomedInfoPanel.ts`, which takes over when the zoom is not 1. What is left here
 * is the page's half: whether the zoom applies (only on the phone UI), and the hit test the
 * pointer routers use either way, so the buttons are hit where they are drawn.
 */
import { INFO_PHONE_ZOOM, hitInfoButton, type InfoButton } from '../render/mapInfo.js';
import { phoneUi } from './touchButtons.js';

/** How big the record panel is drawn: enlarged on a phone, the original's 1:1 elsewhere. */
export function infoPanelZoom(): number {
  return phoneUi() ? INFO_PHONE_ZOOM : 1;
}

/** The panel button under map coordinate (mx,my), on the panel as it is drawn now. */
export function hitZoomedInfoButton(mx: number, my: number): InfoButton | null {
  return hitInfoButton(mx, my, infoPanelZoom());
}
