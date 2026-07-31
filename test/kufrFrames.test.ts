/**
 * The briefcase cutscene's frame indexing.
 *
 * The AI tier ships one upscaled image per VISIBLE frame and the runtime looks it up by
 * KufrDemo.framesShown. That only works if the staging tool recorded the sequence by the
 * same counter — and it originally did not: it keyed off framesDrawn, which counts
 * DECODES. One tick of this cutscene decodes two frames and displays only the second, so
 * from that tick onward the runtime asked for the frame after the one on screen, and at
 * the end it ran off the array entirely and dropped the whole hi-res path back to the
 * faithful renderer mid-cutscene.
 *
 * These drive the REAL decoder over the REAL demo.pck, so they measure the actual
 * relationship rather than restating it.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KufrDemo } from '../src/intro/kufrDemo.js';

const INTRO = join(process.cwd(), 'public/data/Intro');
const have = ['kufr256.BMP', 'demo.pck', 'script.txt'].every((f) => existsSync(join(INTRO, f)));

function runDemo(): KufrDemo {
  const d = new KufrDemo(
    new Uint8Array(readFileSync(join(INTRO, 'kufr256.BMP'))),
    new Uint8Array(readFileSync(join(INTRO, 'demo.pck'))),
    readFileSync(join(INTRO, 'script.txt'), 'utf8'),
  );
  let ticks = 0;
  while (!d.done && ticks++ < 20000) d.tick(() => 1, () => false);
  return d;
}

describe('KufrDemo frame counters', () => {
  it.runIf(have)('decodes MORE frames than it shows (the two are not interchangeable)', () => {
    const d = runDemo();
    expect(d.done, 'the cutscene runs to completion').toBe(true);
    expect(d.framesShown).toBeGreaterThan(200);
    // If these were ever equal the distinction would look redundant and invite a
    // "simplification" back to one counter — which is exactly the bug.
    expect(d.framesDrawn).toBeGreaterThan(d.framesShown);
  });

  it.runIf(have)('advances framesShown at most once per tick', () => {
    const d = new KufrDemo(
      new Uint8Array(readFileSync(join(INTRO, 'kufr256.BMP'))),
      new Uint8Array(readFileSync(join(INTRO, 'demo.pck'))),
      readFileSync(join(INTRO, 'script.txt'), 'utf8'),
    );
    let ticks = 0, last = 0;
    while (!d.done && ticks++ < 20000) {
      d.tick(() => 1, () => false);
      expect(d.framesShown - last, 'one visible state per tick').toBeLessThanOrEqual(1);
      last = d.framesShown;
    }
  });
});

describe('shipped cutscene manifest matches the decoder', () => {
  const man = join(process.cwd(), 'public/enhanced-ai/_kufr/ai.json');
  const shipped = existsSync(man);

  it.runIf(have && shipped)('ships exactly one ordered entry per VISIBLE frame', () => {
    const { order } = JSON.parse(readFileSync(man, 'utf8')) as { order: string[] };
    const d = runDemo();
    // The runtime reads order[framesShown - 1], so the array must cover every visible
    // state — one short is a silent fallback to the faithful renderer at the end.
    expect(order.length, 'one entry per visible frame').toBe(d.framesShown);
  });
});
