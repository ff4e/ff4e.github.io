/**
 * Build `public/restored/restored.fft` + `.ffs` — the two dialogue lines the 1998
 * release referenced but shipped without.
 *
 *   npx tsx tools/build-restored-sounds.ts
 *
 * Why a separate package rather than patching 025/063: the committed
 * `public/data/**` is the 1998 release byte-for-byte, and it stays that way. The
 * restored lines live in their own file, loaded like the x00/x02/x03 globals, so
 * what is original and what is not stays trivially auditable.
 *
 * Provenance of each field:
 *   audio     fillets-ng-data (GPL) — see public/restored/README.md. Its PCM length
 *             matches the authors' own master index EXACTLY (71936 / 46848 samples),
 *             which is what identifies it as the original recording rather than a
 *             remake.
 *   Czech     the authors' master FFT in the GPL Delphi source release
 *             (delphi-src/Fillets/Titl/{Pyramida,jeskyne}.fft).
 *   English   fillets-ng's dialogs_en.lua (the 1998 release has no English text for
 *             a sound it does not contain).
 *
 * Needs ffmpeg on PATH, the FFNG install, and the Delphi source tree:
 *   FF_FFNG_DIR   /Applications/Fillets.app/.../fillets-ng
 *   FF_DELPHI_SRC ~/.cache/ffng-orig/delphi-src/Fillets
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { encodeSound, quantize } from './lib/ffsEncode.js';
import { decodeSound, FFS_SAMPLE_RATE } from '../src/audio/ffs.js';

const FFNG =
  process.env.FF_FFNG_DIR ??
  '/Applications/Fillets.app/Contents/Resources/fillets/share/games/fillets-ng';
const DELPHI =
  process.env.FF_DELPHI_SRC ?? join(homedir(), '.cache', 'ffng-orig', 'delphi-src', 'Fillets');
const OUT = 'public/restored';

interface Want {
  name: string;
  /** FFNG sound dir + the master FFT that holds the Czech subtitle. */
  ffngRoom: string;
  masterFft: string;
  /** Expected sample count, from the master index — a hard check, not a hint. */
  delka: number;
}

const WANT: Want[] = [
  { name: 'pyr-m-nudi', ffngRoom: 'pyramid', masterFft: 'Pyramida.fft', delka: 71936 },
  { name: 'jes-v-potvora2', ffngRoom: 'cave', masterFft: 'jeskyne.fft', delka: 46848 },
];

const REC = 48;
const cp1250 = new TextDecoder('windows-1250');
/** Inverse of the windows-1250 table, built from the decoder (no dependency). */
const toCp1250 = new Map<string, number>();
for (let b = 0; b < 256; b++) {
  const ch = cp1250.decode(Uint8Array.of(b));
  if (!toCp1250.has(ch)) toCp1250.set(ch, b);
}
function encodeCp1250(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const b = toCp1250.get(s[i]!);
    if (b === undefined) throw new Error(`not representable in cp1250: ${JSON.stringify(s[i])}`);
    out[i] = b;
  }
  return out;
}

/** Read one sound's raw (colour-coded) Czech subtitle out of a master FFT. */
function masterSubtitle(fftPath: string, want: string): string {
  const b = readFileSync(fftPath);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getInt32(0, true);
  const blob = b.subarray(4 + count * REC);
  for (let k = 0; k < count; k++) {
    const o = 4 + k * REC;
    const name = String.fromCharCode(...b.subarray(o + 1, o + 1 + b[o]!));
    if (name !== want) continue;
    const off = dv.getInt16(o + 26, true);
    const len = dv.getInt16(o + 28, true);
    if (len <= 0) throw new Error(`${want}: master FFT has no Czech subtitle`);
    return cp1250.decode(blob.subarray(off, off + len));
  }
  throw new Error(`${want}: not in ${fftPath}`);
}

/** Read one sound's English line out of an FFNG dialogs_en.lua. */
function ffngEnglish(room: string, want: string): string {
  const src = readFileSync(join(FFNG, 'script', room, 'dialogs_en.lua'), 'utf8');
  const m = new RegExp(`dialogId\\("${want}",\\s*"[^"]*",\\s*"([^"]*)"\\)`).exec(src);
  if (!m) throw new Error(`${want}: no English line in ${room}/dialogs_en.lua`);
  return m[1]!;
}

function oggToPcm(room: string, name: string): Int16Array {
  const path = join(FFNG, 'sound', room, 'cs', `${name}.ogg`);
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', String(FFS_SAMPLE_RATE), '-'],
    { maxBuffer: 1 << 28 },
  );
  return new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
}

const bodies: Uint8Array[] = [];
const rows: Array<{ name: string; cz: string; en: string; zvuk: number; kompr: number; delka: number }> = [];
let zvuk = 0;

for (const w of WANT) {
  const pcm = oggToPcm(w.ffngRoom, w.name);
  if (pcm.length !== w.delka) {
    throw new Error(`${w.name}: ${pcm.length} samples, the master index says ${w.delka}`);
  }
  const body = encodeSound(quantize(pcm));
  // The encoder is the exact inverse of the runtime decoder; prove it per build.
  const back = decodeSound(body, 0, w.delka);
  const q = quantize(pcm);
  for (let i = 0; i < q.length; i++) {
    if (back[i] !== q[i]) throw new Error(`${w.name}: codec round-trip differs at sample ${i}`);
  }
  const cz = masterSubtitle(join(DELPHI, 'Titl', w.masterFft), w.name);
  // Keep the Czech colour code (URoom.pas Talk reads s[1]) for the English line too,
  // exactly as every shipped package does.
  const en = `${cz.slice(0, 2)} ${ffngEnglish(w.ffngRoom, w.name)}`;
  rows.push({ name: w.name, cz, en, zvuk, kompr: body.length, delka: w.delka });
  bodies.push(body);
  zvuk += body.length;
  console.log(`${w.name.padEnd(16)} ${w.delka} samples -> ${body.length} B`);
  console.log(`   CZ ${cz}`);
  console.log(`   EN ${en}`);
}

// --- FFT: [int32 count][count x 48-byte record][text blob] (RSound.pas:789-817)
const texts: Uint8Array[] = [];
let tOff = 0;
const spans = rows.map((r) => {
  const cz = encodeCp1250(r.cz);
  const en = encodeCp1250(r.en);
  const s = { cz: tOff, czLen: cz.length, en: tOff + cz.length, enLen: en.length };
  texts.push(cz, en);
  tOff += cz.length + en.length;
  return s;
});

const head = new Uint8Array(4 + rows.length * REC);
const hv = new DataView(head.buffer);
hv.setInt32(0, rows.length, true);
rows.forEach((r, k) => {
  const o = 4 + k * REC;
  const nm = encodeCp1250(r.name);
  if (nm.length > 24) throw new Error(`${r.name}: name longer than the 24-char field`);
  head[o] = nm.length;
  head.set(nm, o + 1);
  hv.setInt16(o + 26, spans[k]!.cz, true);
  hv.setInt16(o + 28, spans[k]!.czLen, true);
  hv.setInt16(o + 30, spans[k]!.en, true);
  hv.setInt16(o + 32, spans[k]!.enLen, true);
  // o+34 Blok is assigned by the loader (MemAll), not stored.
  hv.setInt32(o + 36, r.zvuk, true);
  hv.setInt32(o + 40, r.kompr, true);
  hv.setInt32(o + 44, r.delka, true);
});

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'restored.fft'), concat([head, ...texts]));
writeFileSync(join(OUT, 'restored.ffs'), concat(bodies));
console.log(`\nwrote ${OUT}/restored.fft + restored.ffs`);
