/**
 * Seam for `src/audio/webAudioBackend.ts`, the browser's Web Audio. `audio.ts` imports it for
 * its default backend, but the native host always hands the policy its own
 * (`seams/audioEngine.ts`), so the browser's is never built here — and with this stand-in,
 * none of it (nor the Capacitor decode bridge it imports) reaches the bundle. Constructing
 * it would mean a native path has started making a policy without the native backend.
 */
import type { AudioBackendEvents } from '../../../src/audio/audioBackend.js';

export class WebAudioBackend {
  constructor(_events: AudioBackendEvents) {
    throw new Error('the native host has no Web Audio: build AudioEngine with the SDL backend (native/js/seams/audioEngine.ts)');
  }
}
