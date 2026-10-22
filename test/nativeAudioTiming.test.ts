import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nativeAudioTiming } from '../src/platform/nativeAudioTiming.js';
import { parseFfs2 } from '../src/audio/ffs2.js';
import { parseFft } from '../src/data/fft.js';
import { musicNames } from '../src/audio/music.js';
import { voicePackages } from '../tools/stage-voices.js';
import { readWav } from '../tools/stage-music.js';

function transform(input: Buffer): Buffer {
  return Buffer.from(nativeAudioTiming(new Uint8Array(input).buffer));
}

function atom(name: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8);
  head.write(name, 4);
  return Buffer.concat([head, body]);
}

function fixture(): Buffer {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(2520, 16);
  const tkhd = Buffer.alloc(24);
  tkhd.writeUInt32BE(2520, 20);
  const mdhd = Buffer.alloc(20);
  mdhd.writeUInt32BE(22050, 12);
  mdhd.writeUInt32BE(56576, 16);
  const elst = Buffer.alloc(20);
  elst.writeUInt32BE(1, 4);
  elst.writeUInt32BE(2519, 8);
  elst.writeUInt32BE(1024, 12);
  elst.writeUInt32BE(0x10000, 16);
  return atom('moov', atom('mvhd', mvhd), atom('trak', atom('tkhd', tkhd),
    atom('mdia', atom('mdhd', mdhd)), atom('edts', atom('elst', elst))));
}

/** Read the result independently; restore the four permitted fields and compare every byte. */
function check(input: Buffer, frames: number, rate: number): void {
  const output = transform(input);
  const fields = [
    [input.indexOf('mvhd') + 16, rate],
    [input.indexOf('mvhd') + 20, frames],
    [input.indexOf('tkhd') + 24, frames],
    [input.indexOf('elst') + 12, frames],
  ];
  for (const [offset, expected] of fields) {
    expect(output.readUInt32BE(offset!)).toBe(expected);
    output.writeUInt32BE(input.readUInt32BE(offset!), offset!);
  }
  expect(output.equals(input), 'only movie timescale/durations change; priming and AAC stay intact').toBe(true);
}

describe('sample-exact native MP4 timing', () => {
  it('corrects millisecond rounding without modifying input or the priming edit', () => {
    const input = fixture();
    const before = Buffer.from(input);
    const bytes = new Uint8Array(input).buffer;
    const exact = Buffer.from(nativeAudioTiming(bytes));
    expect(Buffer.from(bytes).equals(before)).toBe(true);
    check(input, 55552, 22050);
    expect(input.equals(before)).toBe(true);
    expect(transform(exact).equals(exact)).toBe(true);
  });

  it.each([
    ['empty input', () => Buffer.alloc(0)],
    ['truncated box', () => fixture().subarray(0, -1)],
    ['trailing bytes', () => Buffer.concat([fixture(), Buffer.alloc(1)])],
    ['invalid size', () => { const b = fixture(); b.writeUInt32BE(0); return b; }],
    ['missing track', () => atom('moov', atom('mvhd', Buffer.alloc(20)))],
    ['multiple tracks', () => atom('moov', atom('trak'), atom('trak'))],
  ])('rejects %s', (_label, make) => {
    expect(() => transform(make())).toThrow('Native audio timing:');
  });

  it.each([
    ['mvhd', 0, 0x01000000],
    ['elst', 4, 2],
    ['elst', 16, 0x20000],
    ['mvhd', 12, 0],
    ['mdhd', 12, 0],
    ['mdhd', 16, 1024],
    ['elst', 12, 0xffffffff],
    ['elst', 8, 1000],
  ])('refuses unsupported timing in %s + %i', (name, offset, value) => {
    const input = fixture();
    input.writeUInt32BE(value, input.indexOf(name) + 4 + offset);
    expect(() => transform(input)).toThrow('Native audio timing:');
  });

  for (const pkg of voicePackages()) {
    it(`${pkg.id}: preserves every AAC payload and matches the original voice sample counts`, () => {
      const body = readFileSync(pkg.ffs2);
      const { segments, rate } = parseFfs2(body);
      const entries = parseFft(readFileSync(pkg.fft)).filter(entry => entry.delka > 0);
      for (const entry of entries) {
        const segment = segments.get(entry.zvuk)!;
        const input = body.subarray(segment.offset, segment.offset + segment.length);
        check(input, entry.delka, rate);
      }
    });
  }

  for (const name of musicNames()) {
    it(`${name}: preserves AAC and matches the original WAV duration`, () => {
      const original = readWav(`public/data/Music/${name}.wav`);
      check(readFileSync(`public/data/Music/${name}.m4a`), original.pcm.length, original.rate);
    });
  }
});
