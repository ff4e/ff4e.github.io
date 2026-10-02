/**
 * Which of the two audio tiers this build plays: the AAC-staged one (`.ffs2` voices,
 * `.m4a` music — tools/stage-voices.ts, tools/stage-music.ts) or the 1998 originals they
 * were encoded from (`.ffs` voices, `.wav` music).
 *
 * The site plays the staged tier: it is what keeps `public/` inside GitHub Pages' 1 GB
 * (tools/stage-pages-assets.mjs). The console package plays the ORIGINALS, because the
 * Xbox WebView2 cannot decode AAC through `decodeAudioData` at all. Found on an Xbox
 * Series X: boot died on `EncodingError: Unable to decode audio data` for whichever x03
 * segment rejected first. Its name moved with the decode order across five builds, and
 * once decoding was serial it was always segment #0, however it was retried and
 * whichever context ran it — a decoder that rejects every AAC file, not one bad file
 * (each one named was extracted and is an ordinary AAC-LC MP4 to ffprobe).
 *
 * The originals need no platform codec at all: `.ffs` is decoded in JS (`ffs.ts`) and
 * `.wav` is PCM. They are also the source of truth both tiers are measured against, so
 * this costs nothing in fidelity — only package size, and the console reads its package
 * from local storage (tools/stage-xbox-wwwroot.mjs ships them in place of the staged files).
 */

/** Does this build play the 1998 originals instead of the AAC-staged tier? */
export function playsOriginals(): boolean {
  try {
    return import.meta.env.VITE_TARGET === 'xbox';
  } catch {
    return false; // no import.meta.env outside Vite — the staging tools import this
  }
}
