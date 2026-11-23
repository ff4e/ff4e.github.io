/**
 * Seam for `src/app/audioEngine.ts`: the native host has no audio yet, so the engine the
 * flow modules talk to is a silent one. Nothing is ever playing and nothing ever talks,
 * which is what the room scripts and `logicTick` see when the browser's audio is muted.
 *
 * Only the members the bundled flow modules call. The loaders are on `roomLoad`'s audio
 * path, which a native entry never takes (see `stageState.ts` here): they reject, so a
 * src/ change that starts taking it fails loudly instead of loading into nothing.
 *
 * The `Pick` is a promise about today's callers that the type checker cannot hold the
 * bundled flow modules to (they are checked against the real engine). So the object is
 * wrapped: reading any member this seam does not define throws, naming it, at the call
 * — rather than a bare "not a function" somewhere later.
 */
import type { AudioEngine } from '../../../src/audio/audio.js';

type Used =
  | 'play' | 'playing' | 'talking' | 'clearRoom' | 'stopMusic' | 'hasMusic' | 'musicLoad'
  | 'beginMusicLoad' | 'decodeMusic' | 'playMusic' | 'prepare' | 'installRoom' | 'loadGlobal'
  | 'currentMusic';

const noAudio = (what: string): Promise<never> => Promise.reject(new Error(`native host has no audio (${what})`));

const silent: Pick<AudioEngine, Used> = {
  play: () => {},
  playing: () => false,
  talking: () => false,
  clearRoom: () => {},
  stopMusic: () => {},
  hasMusic: () => false,
  musicLoad: () => undefined,
  beginMusicLoad: () => {},
  decodeMusic: () => noAudio('decodeMusic'),
  playMusic: () => noAudio('playMusic'),
  prepare: () => noAudio('prepare'),
  installRoom: () => {},
  loadGlobal: () => noAudio('loadGlobal'),
  currentMusic: '',
};

export const audio: Pick<AudioEngine, Used> = new Proxy(silent, {
  get(target, key, receiver) {
    if (typeof key === 'symbol' || key in target) return Reflect.get(target, key, receiver) as unknown;
    throw new Error(`the native audio seam has no audio.${key} (native/js/seams/audioEngine.ts)`);
  },
});
