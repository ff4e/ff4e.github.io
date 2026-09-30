/**
 * The briefcase demo's ✕ button: the one pointer way out of the KUFRIK story.
 *
 * A deliberate departure from the original, where any click skips the demo (zrus_kufr,
 * URoom.pas:2965). Martin (2026-09-30): skip it with a close button instead of any tap or
 * click, on every target. Nothing on screen said that a tap would end the story, and the
 * tap that ended it was the same one that moves a fish a moment later. The canvas now
 * swallows clicks while the demo plays (main.ts); Escape still skips it, as in the original.
 *
 * The room controls stand aside for the demo in touch mode (touchButtons.ts,
 * phoneControls.ts), so in touch mode this is the only button on screen — it takes the
 * phone's top-right corner, where its "more" button sits in a room.
 */
import { cutsceneClose } from './dom.js';
import { skipCutscene } from './cutscene.js';
import { wake } from './frameClock.js';
import { cutscene } from './gameState.js';
import { ui } from './screenState.js';

/** Arm the button. Called once, from `main.ts`, during boot. */
export function initCutsceneClose(): void {
  cutsceneClose.addEventListener('click', (e) => {
    if (e.detail > 0) cutsceneClose.blur(); // see touchButtons.ts: game keys must not land on it
    if (cutscene) skipCutscene();
    wake();
  });
}

/**
 * Up while the demo is what #screen shows, down everywhere else. Derived per frame beside
 * the help overlay's close button, for the same reason (renderLoop.ts).
 */
export function syncCutsceneClose(): void {
  const want = cutscene !== null && ui.screen === 'room' && !ui.helpOpen;
  if (cutsceneClose.hidden === want) cutsceneClose.hidden = !want;
}
