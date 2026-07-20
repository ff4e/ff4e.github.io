/**
 * FFT (per-room subtitles, both languages) loader.
 *
 * Faithful to the layout read by RSound.pas `MemAll` (RSound.pas:789-817) and
 * extracted by `GetTit` (RSound.pas:882-915):
 *
 *   [int32 count]
 *   [count × TMemSound record]        (48 bytes each, Delphi-aligned)
 *   [text blob]                       (all remaining bytes)
 *
 * TMemSound (RSound.pas:97-102), record-relative field offsets (aligned):
 *   0  : name        string[24]   (1 length byte + 24 chars = 25 bytes)
 *   26 : TitCz       smallint     offset of the Czech subtitle in the text blob
 *   28 : TitCzLen    smallint     its length
 *   30 : TitEng      smallint     offset of the English subtitle
 *   32 : TitEngLen   smallint     its length
 *   34 : Blok        byte         (runtime; ignored)
 *   36 : zvuk        int32        sound-data offset (ignored here)
 *   40 : kompr       int32
 *   44 : delka       int32
 *
 * A subtitle string begins with a one-character colour code followed by a space,
 * then the text (URoom.pas Talk: `c:=s[1]; delete(s,1,2)`). "@" marks where a
 * global substring (globtit) is spliced in.
 */
const REC_SIZE = 48;
const cp1250 = new TextDecoder('windows-1250');

export interface FftEntry {
  /** Sound id, e.g. "uts-m-otresy" (room-prefix + m|v|x + name). */
  readonly name: string;
  /** Czech subtitle: colour code, text, and any "@" splice marker. */
  readonly cz: FftSubtitle;
  /** English subtitle. */
  readonly en: FftSubtitle;
  /** Byte offset of this sound's compressed data within the matching FFS. */
  readonly zvuk: number;
  /** End offset of the compressed data (next sound's zvuk); a cross-check. */
  readonly kompr: number;
  /** Decompressed sample count (16-bit mono @ 22050 Hz). */
  readonly delka: number;
}

export interface FftSubtitle {
  /** Colour code character (URoom.pas font colour table key), or '' if empty. */
  readonly color: string;
  /** The subtitle text (colour code + leading space stripped). */
  readonly text: string;
  /** Raw string including the colour code, as stored. */
  readonly raw: string;
}

function ascii(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function toSubtitle(raw: string): FftSubtitle {
  if (raw.length === 0) return { color: '', text: '', raw };
  const color = raw[0]!;
  // Talk deletes the colour char + the following space (delete(s,1,2)).
  const text = raw.slice(2);
  return { color, text, raw };
}

/** Parse a complete FFT file into its per-sound subtitle entries. */
export function parseFft(data: Uint8Array): FftEntry[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = dv.getInt32(0, true);
  const textStart = 4 + count * REC_SIZE;
  const text = data.subarray(textStart);

  const readTit = (off: number, len: number): FftSubtitle => {
    if (len <= 0 || off < 0 || off + len > text.length) return toSubtitle('');
    return toSubtitle(cp1250.decode(text.subarray(off, off + len)));
  };

  const entries: FftEntry[] = [];
  for (let k = 0; k < count; k++) {
    const base = 4 + k * REC_SIZE;
    const nameLen = data[base]!;
    const name = ascii(data.subarray(base + 1, base + 1 + nameLen));
    const titCz = dv.getInt16(base + 26, true);
    const titCzLen = dv.getInt16(base + 28, true);
    const titEng = dv.getInt16(base + 30, true);
    const titEngLen = dv.getInt16(base + 32, true);
    // Blok @ base+34; sound fields (URoom.pas TMemSound) at aligned offsets:
    const zvuk = dv.getInt32(base + 36, true);
    const kompr = dv.getInt32(base + 40, true);
    const delka = dv.getInt32(base + 44, true);
    entries.push({
      name,
      cz: readTit(titCz, titCzLen),
      en: readTit(titEng, titEngLen),
      zvuk,
      kompr,
      delka,
    });
  }
  return entries;
}

/** Index subtitle entries by sound name for quick lookup (GetTit/Search). */
export function indexFft(entries: readonly FftEntry[]): Map<string, FftEntry> {
  const m = new Map<string, FftEntry>();
  for (const e of entries) m.set(e.name, e);
  return m;
}
