/**
 * The lines the 1998 release referenced but could not play.
 *
 * Two distinct causes, and this file pins both:
 *
 *   - a name that does not match the packaged one (`z-c-tisic` for `z-c-tisíc`,
 *     `pot-v-pohnu` for `pot-v-nehnu`, `bot-m-lebka` for `bot-v-lebka`). The engine
 *     resolves sounds by exact name (RSound.pas:246-253) with no usable file
 *     fallback, so these were silent. The port uses the packaged name.
 *   - a name that is right but whose audio was cut from the release packages
 *     (`pyr-m-nudi`, `jes-v-potvora2`). Those come from `public/restored/`.
 *
 * The sweep behind all of it is `tools/sweep-sounds.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { pinRandomHighest, pinRandomLowest } from './rng.js';
import { Script } from '../src/core/script.js';
import { parseFft } from '../src/data/fft.js';
import { decodeSound } from '../src/audio/ffs.js';
import { AudioEngine } from '../src/audio/audio.js';
import { depthOfRoom } from '../src/data/world.js';
import { ROOMS } from '../src/data/roomTable.js';
import { encodeSound, quantize } from '../tools/lib/ffsEncode.js';
import { BOTTLES } from '../src/rooms/bottles.js';
import { POTOPENA } from '../src/rooms/potopena.js';
import { ZAVER } from '../src/rooms/zaver.js';

/** Build a script whose queued dialogue is recorded rather than played. */
function spied(items: ItemSpec[], w = 40, h = 30): { s: Script; said: string[] } {
  const said: string[] = [];
  const s = new Script(makeRoom({ w, h, items }), (name) => {
    said.push(name);
    return 0;
  });
  return { s, said };
}

/** Flush the dialogue queue so every enqueued line reaches the talk hook. */
function drain(s: Script, ticks = 400): void {
  for (let i = 0; i < ticks; i++) s.dialogy(i);
}

function filler(count: number, little: number, big: number, place: (i: number) => ItemSpec): ItemSpec[] {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= count; i++) {
    if (i === little) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === big) items.push({ kind: 'big', x: 6, y: 2 });
    else items.push(place(i));
  }
  return items;
}

// ---------------------------------------------------------------- BOTTLES (59)

describe('BOTTLES skull remark (URoom.pas:14493)', () => {
  const room = (): ItemSpec[] => filler(31, 1, 2, (i) => ({ kind: 'static', x: i % 20, y: 20 }));

  /** Put the little fish on the skull (lebzna = 31) so the `olebce` branch opens. */
  function armed(): { s: Script; said: string[] } {
    const r = spied(room());
    BOTTLES.init(r.s);
    const v = r.s.vars(0);
    v[1] = 0; // room_uvod: skip the intro branch
    v[2] = 0; // room_olebce: not yet remarked
    v[4] = 1; // room_osklebakovi: the totem is not due
    const skull = r.s.item(31);
    r.s.item(1).x = skull.x;
    r.s.item(1).y = skull.y;
    return r;
  }

  it('says the recorded big-fish line, never the unrecorded bot-m-lebka', () => {
    pinRandomLowest(); // random(2) -> 0, the restored branch
    const { s, said } = armed();
    BOTTLES.prog(s);
    drain(s);
    expect(said).toContain('bot-v-lebka');
    expect(said).not.toContain('bot-m-lebka');
  });

  it('keeps the other half of the coin flip untouched', () => {
    pinRandomHighest(); // random(2) -> 1
    const { s, said } = armed();
    BOTTLES.prog(s);
    drain(s);
    expect(said).toContain('bot-m-vidim');
  });
});

// -------------------------------------------------------------- POTOPENA (12)

describe('POTOPENA steel-door remark (URoom.pas:11587)', () => {
  const room = (): ItemSpec[] => filler(10, 5, 6, (i) => ({ kind: 'static', x: i, y: 25 }));

  function armed(): { s: Script; said: string[] } {
    const r = spied(room(), 40, 30);
    POTOPENA.init(r.s);
    const v = r.s.vars(0);
    v[1] = 2; // potop_uvod: intro already done
    v[2] = 0; // potop_ooceli: the remark is still pending
    v[3] = 1; // potop_maladole
    v[4] = 1; // potop_velkadole
    const big = r.s.item(6);
    big.x = 15; // x < 16 and y == 4 opens the branch without needing a facing
    big.y = 4;
    return r;
  }

  it('says pot-v-nehnu, never the unrecorded pot-v-pohnu', () => {
    pinRandomLowest();
    const { s, said } = armed();
    POTOPENA.prog(s);
    drain(s);
    expect(said).toContain('pot-v-nehnu');
    expect(said).not.toContain('pot-v-pohnu');
  });

  it('keeps the other half of the coin flip untouched', () => {
    pinRandomHighest();
    const { s, said } = armed();
    POTOPENA.prog(s);
    drain(s);
    expect(said).toContain('pot-v-trub');
  });
});

// ----------------------------------------------------------------- ZAVER (71)

describe('ZAVER spoken hour count (URoom.pas:23493, :23499)', () => {
  const room = (): ItemSpec[] => filler(8, 4, 5, (i) => ({ kind: 'static', x: i, y: 25 }));

  /**
   * Run the narrator's word-by-word count for `hours` and collect what it says.
   * ZAVER derives the number itself from cas_hry (URoom.pas:23472), so the input is
   * the play time, not the var; each prog() speaks the next token and the room
   * clears zaver_hlaska when the sentence is done.
   */
  function count(hours: number): string[] {
    const { s, said } = spied(room());
    ZAVER.init(s);
    const v = s.vars(0);
    v[1] = 2; // zaver_uvod: the arrival scene is done
    v[2] = 1; // zaver_hlaska: start the count
    s.casHry = hours / 24; // cas_hry is in Delphi day units
    for (let k = 0; k < 40 && v[2] !== 0; k++) {
      ZAVER.prog(s);
      drain(s);
    }
    return said;
  }

  it('uses the packaged, accented names for "thousand"', () => {
    expect(count(1500)).toContain('z-c-tisíc'); // singular: 1000-1999
    expect(count(3200)).toContain('z-c-tisíce'); // 2000-4999
  });

  it('never asks for the unspellable ASCII forms the Delphi source has', () => {
    for (const said of [count(1500), count(3200)]) {
      expect(said).not.toContain('z-c-tisic');
      expect(said).not.toContain('z-c-tisice');
    }
  });

  it('leaves the rest of the count alone', () => {
    const said = count(3200);
    expect(said).toContain('z-c-3'); // "three"
    expect(said).toContain('z-c-200'); // "two hundred"
  });
});

// ------------------------------------------------- the restored package itself

describe('public/restored', () => {
  const fft = parseFft(readFileSync('public/restored/restored.fft'));
  const ffs = readFileSync('public/restored/restored.ffs');

  it('is exactly the bytes tools/build-restored-sounds.ts produced', () => {
    // The only human-reviewable surface a committed binary has. If a rebuild drifts —
    // a different ffmpeg, a different FFNG copy, an encoder change — this fails and
    // the new hashes have to be justified rather than slipping through as "Bin ... bytes".
    const sha = (f: string): string =>
      createHash('sha256').update(readFileSync(join('public/restored', f))).digest('hex');
    expect(sha('restored.fft')).toBe('46eceead4e916dac9d2fb4085dab20c3757c99cad2d5ae0dabd7bc274fea47a0');
    expect(sha('restored.ffs')).toBe('d9bccf820ff349075e73a37ecd329c1014462b7316ed6f9bdc45cedce42d425a');
  });

  it('carries exactly the two lines the release packages are missing', () => {
    expect(fft.map((e) => e.name)).toEqual(['pyr-m-nudi', 'jes-v-potvora2']);
  });

  it('matches the sample counts in ALTAR‘s own master index', () => {
    // Titl/Pyramida.fft and Titl/jeskyne.fft in the GPL Delphi source release. This is
    // what identifies the audio as the original recording rather than a remake.
    expect(fft[0]!.delka).toBe(71936);
    expect(fft[1]!.delka).toBe(46848);
  });

  it('carries both subtitle languages, colour-coded like every shipped package', () => {
    expect(fft[0]!.cz).toMatchObject({ color: 'M', text: ' Podívej, ta ženská se snad nudí!' });
    expect(fft[0]!.en).toMatchObject({ color: 'M', text: ' Look, the woman is bored!' });
    expect(fft[1]!.cz).toMatchObject({ color: 'V', text: ' To je hlavoun duhový.' });
    expect(fft[1]!.en).toMatchObject({ color: 'V', text: ' It is called the Politician fish.' });
  });

  it('is a contiguous FFS the runtime decoder can read end to end', () => {
    let cursor = 0;
    for (const e of fft) {
      expect(e.zvuk).toBe(cursor);
      const pcm = decodeSound(ffs, e.zvuk, e.delka);
      expect(pcm.length).toBe(e.delka);
      // Real speech, not a silent or clipped stub.
      let peak = 0;
      for (const v of pcm) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(8000);
      cursor += e.kompr;
    }
    expect(cursor).toBe(ffs.length);
  });
});

describe('FFS codec', () => {
  it('encodes back to exactly what the runtime decoder produced', () => {
    const fft = parseFft(readFileSync('public/restored/restored.fft'));
    const ffs = readFileSync('public/restored/restored.ffs');
    for (const e of fft) {
      const pcm = decodeSound(ffs, e.zvuk, e.delka);
      const again = decodeSound(encodeSound(pcm), 0, e.delka);
      expect(Array.from(again)).toEqual(Array.from(pcm));
    }
  });

  it('quantizes by masking, exactly as PrZvuku/Uprevod.pas:293 does', () => {
    // `hodn and $FFFC` on a smallint: truncate toward -inf, never round. Rounding
    // would turn -6 into -4 and 32766 into 32768 (which wraps to the negative rail).
    const q = quantize(Int16Array.from([0, 1, 3, 4, 6, -1, -3, -4, -6, 32767, 32766, -32768, -32765]));
    expect(Array.from(q)).toEqual([0, 0, 0, 4, 4, -4, -4, -4, -8, 32764, 32764, -32768, -32768]);
  });

  it('refuses unquantized input instead of emitting a corrupt stream', () => {
    // The literal branch stores t>>2 but tracks clast=t, so one bad sample desyncs
    // every sample after it. This must throw, not "mostly work".
    expect(() => encodeSound(Int16Array.from([0, 4, 5, 8]))).toThrow(/not quantized/);
  });

  it('caps a delta run at 127 samples, as the original does', () => {
    // A constant second difference of 0 is delta-codable forever; the only thing that
    // can break the stream up is the 7-bit run length. 300 samples => runs of
    // 127+127+46, i.e. 3 control bytes, not 1.
    const ramp = quantize(Int16Array.from({ length: 300 }, (_, i) => i * 4));
    const enc = encodeSound(ramp);
    const controls: number[] = [];
    for (let i = 0; i < enc.length; ) {
      const c = enc[i]!;
      if (c & 0x80) { controls.push(c & 0x7f); i += 1 + (c & 0x7f); } else i += 2;
    }
    expect(controls).toEqual([127, 127, 46]);
    expect(Array.from(decodeSound(enc, 0, ramp.length))).toEqual(Array.from(ramp));
  });

  it('round-trips synthetic signal, including the transients that force literals', () => {
    const pcm = new Int16Array(4096);
    for (let i = 0; i < pcm.length; i++) {
      // A slow ramp (delta-codable) with periodic full-scale steps (not codable).
      pcm[i] = i % 512 === 0 ? (i % 1024 === 0 ? 32764 : -32768) : Math.round(8000 * Math.sin(i / 40));
    }
    const q = quantize(pcm);
    const back = decodeSound(encodeSound(q), 0, q.length);
    expect(Array.from(back)).toEqual(Array.from(q));
  });
});

// ------------------------------------------------- no regression to the dead names

describe('no room script asks for a name nothing can answer', () => {
  // Comments are stripped: every deviation comment quotes the dead Delphi call
  // verbatim, and quoting it is exactly what we want to keep allowing.
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
  const rooms = readdirSync('src/rooms')
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ f, src: strip(readFileSync(join('src/rooms', f), 'utf8')) }));

  // The exact strings the Delphi source uses, each of which resolves to nothing in
  // any build of the game. They may appear in a comment explaining the deviation,
  // never inside a call. Keyed to their URoom.pas site by tools/sweep-sounds.ts.
  const dead = ['bot-m-lebka', 'pot-v-pohnu', 'z-c-tisic', 'z-c-tisice', 'chob-p'];

  // Every name-taking call on Script (see src/core/script.ts). `sndvol` is easy to
  // forget and is genuinely used (src/rooms/steel.ts:50).
  const CALLS = 'addm|addv|addd|addset|snd|sndcyc|sndvol|talkNow|music|musiccyc';

  it.each(dead)('never passes %s to a dialogue call', (name) => {
    for (const { f, src } of rooms) {
      // Anchored per line: `[^)\n]` cannot run past the end of the statement into a
      // neighbouring one, so the result does not depend on comment-stripping having
      // removed a nearby quotation of the dead name.
      const called = new RegExp(`(?:${CALLS})\\(\\s*[^)\\n]*?'${name}'`).test(src);
      expect(called, `${f} calls '${name}'`).toBe(false);
    }
  });

  it('the call list covers every name-taking Script method', () => {
    // If a new one is added and not listed above, the dead-name guard silently stops
    // covering it — so derive the truth from Script itself.
    const script = readFileSync('src/core/script.ts', 'utf8');
    const declared = [...script.matchAll(/^  (?:readonly )?(\w+)\(name: string/gm)].map((m) => m[1]!);
    const listed = new Set(CALLS.split('|'));
    expect(declared.filter((d) => !listed.has(d))).toEqual([]);
  });

  it('still asks for the two restored names, which public/restored now answers', () => {
    const all = rooms.map((r) => r.src).join('\n');
    for (const name of ['pyr-m-nudi', 'jes-v-potvora2']) {
      expect(all).toContain(`'${name}'`);
      expect(parseFft(readFileSync('public/restored/restored.fft')).some((e) => e.name === name)).toBe(true);
    }
  });
});

// ------------------------------------------------------- x01, the border remarks

describe('x01 border lines (URoom.pas:1018-1021)', () => {
  const x01 = parseFft(readFileSync('public/data/Title/x01.fft'));

  it('holds exactly the eight names stdKrajniHlaska can build', () => {
    // `'cil-' + (m|v) + '-hlaska' + chr(cislo + 48)`, cislo 0..3 (src/core/script.ts).
    const wanted = ['m', 'v'].flatMap((who) => [0, 1, 2, 3].map((n) => `cil-${who}-hlaska${n}`));
    expect(x01.map((e) => e.name).sort()).toEqual(wanted.sort());
    for (const e of x01) expect(e.delka).toBeGreaterThan(0);
  });

  it('is the only package that has them — so it must be loaded, not assumed', () => {
    // The regression this guards: x01 was never fetched, so all eight resolved to
    // nothing and the border remark was silent in every leg-final room.
    for (const id of ['x00', 'x02', 'x03']) {
      const other = parseFft(readFileSync(join('public/data/Title', `${id}.fft`))).map((e) => e.name);
      expect(other.filter((n) => n.startsWith('cil-'))).toEqual([]);
    }
  });

  it('is asked for by exactly the rooms the original loads it in', () => {
    // This is what lets the port keep x01 for the session while the original scopes it
    // to depth-15 rooms: the set of rooms that can speak a border line IS the set of
    // depth-15 rooms, so nothing else can ever resolve a `cil-*` name. If a future room
    // starts calling stdKrajniHlaska without being a leg-final, that equivalence breaks
    // and x01 has to become room-scoped again — hence this test rather than a comment.
    const legFinals = Array.from({ length: 72 }, (_, i) => i + 1).filter((n) => depthOfRoom(n) === 15);
    expect(legFinals).toEqual([19, 29, 37, 44, 51, 58, 64, 70]);
    const callers = readdirSync('src/rooms')
      .filter((f) => f.endsWith('.ts') && readFileSync(join('src/rooms', f), 'utf8').includes('stdKrajniHlaska'))
      .map((f) => f.replace('.ts', '').toUpperCase())
      .sort();
    expect(callers).toEqual(legFinals.map((n) => ROOMS[n - 1]!.jmeno).sort());
  });
});

describe('AudioEngine package lifetimes', () => {
  const roomFft = readFileSync('public/data/Title/025.fft');
  const roomFfs = readFileSync('public/data/Sound/025.ffs');
  const globFft = readFileSync('public/data/Title/x01.fft');
  const globFfs = readFileSync('public/data/Sound/x01.ffs');

  it('resolves a name to its FFT record, room package first', async () => {
    const a = new AudioEngine();
    expect(a.entry('cil-m-hlaska0')).toBeUndefined();
    await a.loadGlobal('x01', globFft, globFfs);
    await a.setRoom('025', roomFft, roomFfs);
    expect(a.entry('cil-m-hlaska0')?.name).toBe('cil-m-hlaska0');
    expect(a.entry('pyr-m-kam')?.name).toBe('pyr-m-kam');
    expect(a.entryCount('x01')).toBe(8);
  });

  it('drops the room package with the room, and keeps the globals', async () => {
    // The reason clearRoom exists: a line spoken before the next room's package lands
    // must be silent, never the PREVIOUS room's sample.
    const a = new AudioEngine();
    await a.loadGlobal('x01', globFft, globFfs);
    await a.setRoom('025', roomFft, roomFfs);
    expect(a.roomLoaded).toBe(true);
    a.clearRoom();
    expect(a.roomLoaded).toBe(false);
    expect(a.entry('pyr-m-kam')).toBeUndefined();
    expect(a.entry('cil-m-hlaska0')?.name).toBe('cil-m-hlaska0');
  });

  it('carries the subtitle on the same record as the sample', async () => {
    // Why nothing needs a second parsed copy of an FFT to render a line.
    const a = new AudioEngine();
    await a.setRoom('025', roomFft, roomFfs);
    const e = a.entry('pyr-m-kam');
    expect(e?.cz.text).toBe(' Kam jsme se to dostali?');
    expect(e?.delka).toBeGreaterThan(0);
  });
});
