/** Native phone presentation is landscape; a visible room leaves rotation to the player. */
import { roomArtPending } from './art.js';
import { roomLoading } from './framePacing.js';
import { cutscene, room } from './gameState.js';
import { roomEntryHeld } from './roomLoad.js';
import { ui } from './screenState.js';
import { booted } from './stageState.js';

export type PhoneOrientation = 'landscape' | 'unlocked';

export function currentPhoneOrientation(previous: PhoneOrientation): PhoneOrientation {
  // Options and Help keep ui.screen, so they inherit the underlying screen's policy.
  if (!booted || ui.screen !== 'room' || !room || cutscene) return 'landscape';
  // Keep the map locked until entry finishes, but never force a turn on a room restart.
  if (roomLoading || roomArtPending() || roomEntryHeld()) return previous;
  return 'unlocked';
}
