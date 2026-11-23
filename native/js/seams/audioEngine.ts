/**
 * Seam for `src/app/audioEngine.ts`: the same one `AudioEngine` (src/audio/audio.ts, the
 * browser's sound policy, unchanged), built with the native backend — the C mixer behind
 * an SDL audio stream (`native/js/sdlAudioBackend.ts`) — instead of Web Audio.
 */
import type * as Real from '../../../src/app/audioEngine.js';
import { AudioEngine } from '../../../src/audio/audio.js';
import { SdlAudioBackend } from '../sdlAudioBackend.js';

export let audio!: typeof Real.audio;
/** The backend under `audio`, for the host's own calls: its poll, and the headless clock. */
export let mixer!: SdlAudioBackend;

export const initAudio: typeof Real.initAudio = () => {
  audio = new AudioEngine((events) => (mixer = new SdlAudioBackend(events)));
  // The browser logs every sound to the console by default; here that is stdout.
  audio.logToConsole = __native.args().includes('--audio-log');
};
