/**
 * The menu smoke's part for the colour grade (`grade.ts`): the present pass, run into a
 * texture rather than the window (`__native.presentProbe`, headless as the smoke is), against
 * the Filter Effects arithmetic in JS (`cssGrade`).
 *
 * In a room, the composite presented graded must be the ungraded one put through
 * `contrast() saturate() brightness()` at the web's shipped numbers, every pixel within one
 * step of 255 (the GPU's float against the reference's); and it must change the picture. The
 * numbers are the web's: `AI_FILTER_DEFAULT` with an empty store, and a deviation the web's
 * dev bar stored in `ff.aiFilter` is read the same way.
 */
import { AI_FILTER_DEFAULT, AI_FILTER_KEYS } from '../../src/app/aiFilter.js';
import { cssGrade, initGrade } from './grade.js';

export interface GradeSmoke {
  check(ok: boolean, what: string): void;
  /** Composite the room as a frame does; whether it drew. */
  drawRoom(): boolean;
  /** The composite's size. */
  compositeSize(): [number, number];
  /** `--smoke-out`, to keep the room ungraded and graded (`grade-off.rgba`, `grade-on.rgba`). */
  outDir: string | undefined;
}

const STRIDE = 5;

export function checkGrade(s: GradeSmoke): void {
  const stored = localStorage.getItem('ff.aiFilter');
  localStorage.setItem('ff.aiFilter', JSON.stringify({ saturate: 0.5 }));
  const tuned = initGrade();
  if (stored === null) localStorage.removeItem('ff.aiFilter');
  else localStorage.setItem('ff.aiFilter', stored);
  const v = initGrade();
  s.check(tuned.saturate === 0.5 && tuned.contrast === AI_FILTER_DEFAULT.contrast &&
    AI_FILTER_KEYS.every((k) => v[k] === AI_FILTER_DEFAULT[k]),
  `the grade is the web's: ${AI_FILTER_KEYS.map((k) => `${k}(${v[k]})`).join(' ')} by default, and a channel stored in ff.aiFilter is read as the web reads it`);

  s.check(s.drawRoom(), 'a room is composited to grade');
  // At the composite's own size, one tap a pixel: the ungraded probe is the composite's texels
  // exactly, so the reference grades the very values the shader did.
  const [W, H] = s.compositeSize();
  const t0 = __native.now();
  const off = new Uint8Array(__native.presentProbe(0, W, H, false));
  const on = new Uint8Array(__native.presentProbe(0, W, H, true));
  // Every fifth pixel (five does not divide the width, so every column is reached): the
  // arithmetic is the same at each, and the whole picture in the interpreter took 5 s.
  let worst = 0, changed = 0, n = 0;
  for (let p = 0; p < W * H * 4; p += 4 * STRIDE, n++) {
    const want = cssGrade([off[p]!, off[p + 1]!, off[p + 2]!], v);
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(on[p + c]! - want[c]!));
    if (on[p] !== off[p] || on[p + 1] !== off[p + 1] || on[p + 2] !== off[p + 2]) changed++;
  }
  const share = changed / n;
  s.check(worst <= 1 && share > 0.5,
    `presented graded, the room (${W}×${H}) is the CSS filter's arithmetic to within ${worst.toFixed(2)} of 255 at every ${STRIDE}th pixel, and ${(share * 100).toFixed(0)} % of them change (${((__native.now() - t0) / 1000).toFixed(1)} s)`);
  if (s.outDir) {
    for (const [name, px] of [['grade-off', off], ['grade-on', on]] as const) {
      const file = new Uint8Array(8 + px.length);
      new DataView(file.buffer).setUint32(0, W, true);
      new DataView(file.buffer).setUint32(4, H, true);
      file.set(px, 8);
      __native.writeFile(`${s.outDir}/${name}.rgba`, file.buffer);
    }
  }
}
