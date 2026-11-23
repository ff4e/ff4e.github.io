/**
 * Seam for `src/app/audioEngine.ts`: the native host has no audio yet, so the engine the
 * flow modules talk to is a silent one. Nothing is ever playing and nothing ever talks,
 * which is what the room scripts and `logicTick` see when the browser's audio is muted.
 *
 * Only the members the bundled flow modules call. The loaders are on `roomLoad`'s audio
 * path, which a native entry never takes (see `stageState.ts` here): they reject, so a
 * src/ change that starts taking it fails loudly instead of loading into nothing.
 */
import type { AudioEngine } from '../../../src/audio/audio.js';

type Used =
  | 'play' | 'playing' | 'talking' | 'clearRoom' | 'stopMusic' | 'hasMusic' | 'musicLoad'
  | 'beginMusicLoad' | 'decodeMusic' | 'playMusic' | 'prepare' | 'installRoom' | 'loadGlobal'
  | 'currentMusic';

const noAudio = (what: string): Promise<never> => Promise.reject(new Error(`native host has no audio (${what})`));

export const audio: Pick<AudioEngine, Used> = {
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
