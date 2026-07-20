/**
 * talking() vs playing() — the RSound `mez` lip-sync cutoff.
 *
 * The original distinguishes `Playing(prior)` (true for the whole sample) from
 * `Talking(prior)` (false ~0.4535s before the sample ends). Mouths and the dialogue
 * queue-advance key off `Talking`, so a mouth stops a beat before the trailing tail.
 * The port routes `s.playing` → the isPlaying hook and `s.talking` → the isTalking
 * hook; this guards that wiring (and the fish `'little'`/`'big'` → prior 1/2 mapping)
 * so a mouth check can't silently regress from the cutoff back to full duration.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';

describe('talking() vs playing() (RSound mez cutoff)', () => {
  it('routes talking→isTalking, playing→isPlaying, and maps little/big to prior 1/2', () => {
    const room = makeRoom({
      w: 10,
      h: 10,
      items: [
        { kind: 'little', x: 2, y: 2 },
        { kind: 'big', x: 5, y: 5 },
      ],
    });
    // A voice can be "playing" (still sounding) yet not "talking" (in its trailing
    // ~0.45s lead) — that's exactly the state the cutoff models.
    const playing = new Set([1, 2, 260]);
    const talking = new Set([1]); // only the little fish (prior 1) is still "talking"
    const s = new Script(
      room,
      () => 0,
      (p) => playing.has(p),
      {},
      (p) => talking.has(p),
    );

    expect(s.playing(2)).toBe(true); // big voice still sounding
    expect(s.talking(2)).toBe(false); // ...but past the cutoff → no longer "talking"
    expect(s.talking('big')).toBe(false); // 'big' → prior 2
    expect(s.talking('little')).toBe(true); // 'little' → prior 1
    expect(s.talking(260)).toBe(false); // an NPC voice: playing but past the cutoff
    expect(s.playing(260)).toBe(true);
  });

  it('talking defaults to false when no isTalking hook is provided (headless)', () => {
    const room = makeRoom({ w: 10, h: 10, items: [{ kind: 'little', x: 2, y: 2 }] });
    const s = new Script(room, () => 0);
    expect(s.talking('little')).toBe(false);
    expect(s.talking(260)).toBe(false);
  });
});
