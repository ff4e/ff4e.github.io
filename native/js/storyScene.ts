/**
 * Pictures of KUFRIK's briefcase story at fixed ticks, for native/compare-media.mjs: the
 * story's script run headless from its first tick — the same `KufrDemo` the game plays, with
 * no sound, so a caption holds nothing and a voice wait passes at once (the browser reference
 * runs it the same way) — and at each tick the picture `cutsceneScreen.ts` presents, once the
 * upscaled art for it is in.
 *
 *   ff4e-native <bundle.js> --root public --headless --story-scene T1,T2,… --out PREFIX
 *
 * Writes `PREFIX-<i>.rgba` (as `saveTexture` writes it) and prints, per tick, the frame the
 * picture shows (`f0094.webp`, or `pixels` for the original's), so the comparison can check
 * both sides picked the same one.
 */
import { setCutscene } from '../../src/app/gameState.js';
import { KufrDemo } from '../../src/intro/kufrDemo.js';
import { cutsceneFrame, disposeKufrArt, kufrArtState } from './cutsceneScreen.js';
import { readBytes } from './shims.js';

const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
};

/** The story's script, as `preloadCutscene` reads it. */
export async function loadStory(): Promise<KufrDemo> {
  const [bmp, pck, script] = await Promise.all([
    readBytes('/data/Intro/kufr256.BMP'),
    readBytes('/data/Intro/demo.pck'),
    readBytes('/data/Intro/script.txt'),
  ]);
  return new KufrDemo(bmp, pck, new TextDecoder().decode(script));
}

/** The silent tick both sides run: no caption holds a tick, no voice is ever sounding. */
export const silentTick = (demo: KufrDemo): void => demo.tick(() => 1, () => false);

export async function renderStoryScene(ticks: readonly number[], out: string): Promise<void> {
  const demo = await loadStory();
  setCutscene(demo);
  let t = 0;
  for (const [i, at] of ticks.entries()) {
    while (t < at) {
      silentTick(demo);
      t++;
    }
    // Ask until the art for this frame is in: the draw path reads it, as in the game.
    let name = 'pixels';
    for (let k = 0; k < 2000; k++) {
      cutsceneFrame();
      const st = kufrArtState();
      const want = st.order[Math.max(0, demo.framesShown - 1)] ?? '';
      if (st.art && (want === '' || st.frames.includes(want) || st.original.has(want))) {
        name = want && st.frames.includes(want) ? want : 'pixels';
        break;
      }
      await settle();
    }
    const pic = cutsceneFrame()!;
    __native.saveTexture(pic.id, `${out}-${i}.rgba`);
    console.log(`story tick ${at}: frame ${demo.framesShown} ${name}`);
  }
  setCutscene(null);
  disposeKufrArt();
}
