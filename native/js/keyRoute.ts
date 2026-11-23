/**
 * The host's key stream to the screen that is up (`__native.events()`: `+Code` down,
 * `-Code` up, `!blur`), as the browser's keydown/keyup listeners route by `ui.screen`. Each
 * event goes to the screen up when it arrives — one can change the screen. Shared by the
 * interactive loop (`main.ts`) and the smoke gates, so a gate sees the routing a player does.
 *
 * A key-up off the room always reaches the map's router, the intro included: a direction
 * held while Ⓐ starts a movie and let go during it must not stay held on the map
 * (`mapKeyUp` only forgets a held key, so it is harmless anywhere else).
 */
import { ui } from '../../src/app/screenState.js';
import { blur, keyDown, keyUp } from './game.js';
import { introKeyDown } from './introScreen.js';
import { mapBlur, mapKeyDown, mapKeyUp } from './mapScreen.js';

export function routeEvent(ev: string): void {
  const onRoom = ui.screen === 'room';
  if (ev === '!blur') {
    blur();
    mapBlur();
  } else if (ev[0] === '-') {
    if (onRoom) keyUp(ev.slice(1));
    else mapKeyUp(ev.slice(1));
  } else if (onRoom) keyDown(ev.slice(1));
  else if (ui.screen === 'intro') introKeyDown(ev.slice(1));
  else mapKeyDown(ev.slice(1));
}
