/**
 * `--startup-probe`: everything the game needs at start that is not the GPU, checked and
 * reported on one line, then quit. It is what can be run where SDL GPU cannot start — the
 * Apple TV Simulator (native/README.md, "Apple TV") — and it runs in `npm run native:check` too, so
 * it cannot rot: the bundle evaluated (it is running), the platform it was built for, the
 * store opened and written through the same shim and host calls the game uses, the assets
 * readable from the asset root, and the sound — the mixer opened on the system's output and
 * a music track decoded by the platform's AAC decoder. Exits non-zero on the first failure.
 */
import { initAudio, mixer } from './seams/audioEngine.js';
import { loadStore, readBytes } from './shims.js';

export async function runStartupProbe(): Promise<number> {
  const t0 = __native.now();
  const facts: string[] = [`tv ${__native.tv}`];
  try {
    loadStore();
    const key = 'ff.startupProbe';
    localStorage.setItem(key, String(Date.now()));
    if (!localStorage.getItem(key)) throw new Error('the store did not keep a write');
    localStorage.removeItem(key);
    facts.push(`store ${__native.storePath()}`);
    const room = await readBytes('/data/Graphic/001.ffr');
    const font = await readBytes('/fonts/Mulish.ttf');
    facts.push(`assets ${room.length + font.length} bytes read`);
    initAudio();
    facts.push(`sound ${mixer.mode}`);
    const music = await readBytes('/data/Music/menu.m4a');
    const [id, frames] = __native.audioDecode(music.slice().buffer, 0);
    __native.audioRelease(id);
    if (frames <= 0) throw new Error('the menu music decoded to nothing');
    facts.push(`menu music ${(frames / 22050).toFixed(1)} s decoded`);
    const win = __native.windowSize();
    facts.push(win ? `window ${win[0]}×${win[1]}` : 'no window');
  } catch (e) {
    console.log(`startup probe FAILED after ${facts.join(', ')}: ${(e as Error).message}`);
    return 1;
  }
  console.log(`startup probe: ok — ${facts.join(', ')} in ${(__native.now() - t0).toFixed(0)} ms`);
  return 0;
}
