/**
 * The subtitle faces natively: the browser's four candidates (`SUB_FONT_CANDIDATES`), read
 * from the same files and loaded into the host's FreeType (native/host/text.c) at the weight
 * the browser asks for. The player's pick is the browser's key, `ff.subfont`.
 */
import type { SubtitleFace } from './subtitleLayout.js';

interface Candidate {
  readonly name: string;
  readonly file: string;
  readonly weight: number;
}

/**
 * The candidates in the browser's order, by the name `ff.subfont` stores, with the file
 * `boot.ts` loads each family from and the weight `SUB_FONT_CANDIDATES` draws it at.
 * restates src/app/stageState.ts `export const SUB_FONT_CANDIDATES:` @ 6b477ad25321
 */
export const SUB_FACES: readonly Candidate[] = [
  { name: 'Mulish Medium', file: '/fonts/Mulish.ttf', weight: 500 },
  { name: 'Manrope Medium', file: '/fonts/Manrope.ttf', weight: 500 },
  { name: 'Jost Medium', file: '/fonts/Jost.ttf', weight: 500 },
  { name: 'FreeSans Bold', file: '/enhanced/subtitle.ttf', weight: 700 },
];

/** A face loaded into the host, measured the way a browser measures it. */
export class NativeFace implements SubtitleFace {
  private readonly em = new Map<string, number>();
  private readonly vmetrics: readonly [number, number, number];

  constructor(
    readonly id: number,
    readonly name: string,
  ) {
    this.vmetrics = __native.fontMetrics(id);
  }

  advances(chars: readonly string[], fontPx: number): number[] {
    const missing = chars.filter((c) => !this.em.has(c));
    if (missing.length) {
      const uniq = [...new Set(missing)];
      const em = __native.fontAdvances(this.id, uniq.map((c) => c.codePointAt(0)!));
      uniq.forEach((c, i) => this.em.set(c, em[i]!));
    }
    return chars.map((c) => this.em.get(c)! * fontPx);
  }

  metrics(fontPx: number): readonly [number, number, number] {
    const [a, d, g] = this.vmetrics;
    return [a * fontPx, d * fontPx, g * fontPx];
  }
}

const loaded = new Map<string, NativeFace>();

/** The face named `name` (a `SUB_FACES` name; anything else is the default, as in the browser). */
export async function loadFace(name: string | null, bytes: (url: string) => Promise<Uint8Array>): Promise<NativeFace> {
  const c = SUB_FACES.find((f) => f.name === name) ?? SUB_FACES[0]!;
  const hit = loaded.get(c.name);
  if (hit) return hit;
  const face = new NativeFace(__native.fontLoad((await bytes(c.file)).slice().buffer, c.weight), c.name);
  loaded.set(c.name, face);
  return face;
}
