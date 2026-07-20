/**
 * Bitmap font, loaded from the original Chars.dat / Chartab.dat / Charcol.dat
 * (IniFont, URoom.pas:457-503) and rendered like PisString/PisStringF
 * (URoom.pas:25526-25625).
 *
 * Chars.dat is a stream of glyphs; each glyph is [xoff, yoff, width, height]
 * (signed bytes) followed by width*height pixel bytes (0..5; value 4 =
 * transparent). Chartab.dat lists, in glyph order, the CP1250 byte of each
 * character. Charcol.dat maps colour-code chars to RGB (single ramp for letters,
 * two-tone for digits).
 */
const cp1250 = new TextDecoder('windows-1250');

export interface Glyph {
  /** 1-based address in `fontdat` of this glyph's header (Pascal convention). */
  addr: number;
  yoff: number;
  width: number;
  height: number;
}

export interface ColorEntry {
  r: number;
  g: number;
  b: number;
}

export class FontData {
  /** Signed glyph bytes; indexed 1-based to match the Pascal fontdat[1..]. */
  readonly fontdat: Int8Array;
  /** Unicode char -> glyph. */
  readonly glyphs = new Map<string, Glyph>();
  /** Single-ramp colour codes (letters), e.g. 'M','V','w'. */
  readonly coltab = new Map<string, ColorEntry>();
  /** Two-tone colour codes (digits '0'..'9'): [top, bottom]. */
  readonly coltab2 = new Map<string, [ColorEntry, ColorEntry]>();

  constructor(charsData: Uint8Array, chartabData: Uint8Array, charcolData: Uint8Array) {
    // fontdat[1..] = charsData bytes (signed).
    this.fontdat = new Int8Array(charsData.length + 1);
    for (let i = 0; i < charsData.length; i++) this.fontdat[i + 1] = charsData[i]! << 24 >> 24;

    // Walk the glyph stream in chartab order (IniFont).
    let adr = 1;
    for (const b of chartabData) {
      const ch = cp1250.decode(new Uint8Array([b]));
      const width = this.fontdat[adr + 2]!;
      const height = this.fontdat[adr + 3]!;
      this.glyphs.set(ch, { addr: adr, yoff: this.fontdat[adr + 1]!, width, height });
      adr += width * height + 4;
    }

    this.parseColors(charcolData);
  }

  private parseColors(data: Uint8Array): void {
    const text = cp1250.decode(data);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const code = line[0]!;
      const nums = line.slice(1).trim().split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
      if (code >= 'A' && code <= 'z') {
        if (nums.length >= 3) this.coltab.set(code, { r: nums[0]!, g: nums[1]!, b: nums[2]! });
      } else if (code >= '0' && code <= '9') {
        if (nums.length >= 6) {
          this.coltab2.set(code, [
            { r: nums[0]!, g: nums[1]!, b: nums[2]! },
            { r: nums[3]!, g: nums[4]!, b: nums[5]! },
          ]);
        }
      }
    }
  }

  /** DelkaTextu (URoom.pas:25627): pixel width of a string in this font. */
  textWidth(s: string): number {
    let w = 0;
    for (const ch of s) {
      const g = this.glyphs.get(ch);
      if (g) w += g.width;
      else if (ch === ' ') w += 8;
    }
    return w;
  }

  static async load(base: string): Promise<FontData> {
    const [chars, chartab, charcol] = await Promise.all([
      fetchBytes(`${base}/Chars.dat`),
      fetchBytes(`${base}/Chartab.dat`),
      fetchBytes(`${base}/Charcol.dat`),
    ]);
    return new FontData(chars, chartab, charcol);
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font load failed: ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
