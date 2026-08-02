/**
 * Controller-correct tutorial captions.
 *
 * KUFRIK's demonstration names PC keys the console does not have (F2/F3/F1), so those
 * captions are rewritten for the controller build. The risk is silent drift — a caption
 * that keeps the old wording, loses its speaker colour, or gets rewritten on the web
 * build — so assert against the real shipped data rather than a fixture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFft } from '../src/data/fft.js';
import { applyPadCaptions, hasPadCaption } from '../src/platform/padCaptions.js';

const entries = parseFft(new Uint8Array(readFileSync('public/data/Title/002.fft')));
const REWRITTEN = ['help2', 'help7', 'help11', 'help22'];

describe('controller tutorial captions', () => {
  it('the shipped tutorial really does name PC keys (the reason this exists)', () => {
    const keyed = entries.filter((e) => /\bF[123]\b/.test(e.en.text) || /\bF[123]\b/.test(e.cz.text));
    expect(keyed.map((e) => e.name).sort()).toEqual([...REWRITTEN].sort());
  });

  it('leaves the web build completely untouched', () => {
    const web = applyPadCaptions(entries, false);
    expect(web).toBe(entries); // same reference: no copying, no cost
  });

  it('removes every PC key reference on a controller, in both languages', () => {
    const pad = applyPadCaptions(entries, true);
    for (const e of pad) {
      expect(e.cz.text).not.toMatch(/\bF[123]\b/);
      expect(e.en.text).not.toMatch(/\bF[123]\b/);
    }
  });

  it('names the controller buttons the game actually binds', () => {
    const by = new Map(applyPadCaptions(entries, true).map((e) => [e.name, e]));
    // LB saves and RB loads in-room; Help is reached from the Menu button's Options.
    expect(by.get('help2')!.en.text).toMatch(/\bLB\b/);
    expect(by.get('help7')!.en.text).toMatch(/\bRB\b/);
    expect(by.get('help11')!.en.text).toMatch(/\bRB\b/);
    expect(by.get('help22')!.en.text).toMatch(/Menu/);
    expect(by.get('help2')!.cz.text).toMatch(/\bLB\b/);
    expect(by.get('help7')!.cz.text).toMatch(/\bRB\b/);
  });

  it('keeps the speaker colour, so the right fish still says it', () => {
    const orig = new Map(entries.map((e) => [e.name, e]));
    for (const e of applyPadCaptions(entries, true)) {
      expect(e.cz.color).toBe(orig.get(e.name)!.cz.color);
      expect(e.en.color).toBe(orig.get(e.name)!.en.color);
      // Untouched captions must keep their stored `raw` byte for byte; only the ones we
      // rewrite are rebuilt, and those must come back as "<colour> <text>".
      if (hasPadCaption(e.name)) {
        expect(e.cz.raw).toBe(`${e.cz.color} ${e.cz.text}`);
        expect(e.en.raw).toBe(`${e.en.color} ${e.en.text}`);
      } else {
        expect(e.cz.raw).toBe(orig.get(e.name)!.cz.raw);
      }
    }
    // All four are the big fish — only one voice has to be reproduced.
    for (const n of REWRITTEN) expect(orig.get(n)!.en.color).toBe('V');
  });

  it('changes only the four captions, leaving the rest of the tutorial alone', () => {
    const orig = new Map(entries.map((e) => [e.name, e]));
    const changed = applyPadCaptions(entries, true)
      .filter((e) => e.en.text !== orig.get(e.name)!.en.text || e.cz.text !== orig.get(e.name)!.cz.text)
      .map((e) => e.name);
    expect(changed.sort()).toEqual([...REWRITTEN].sort());
    expect(REWRITTEN.every(hasPadCaption)).toBe(true);
  });
});
