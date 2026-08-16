/**
 * Decoding a recorded solution move-string (`RoomScript.solution`).
 *
 * One character is one move: lowercase drives the little (small) fish, UPPERCASE the big
 * one, and `u`/`d`/`l`/`r` are up/down/left/right.
 *
 * There is a SECOND control set, `w`/`x`/`y`/`z`, for WIN #68's bonus level. FFNG models
 * the two elderly fish as extra units whose control symbols are spelled out in the model
 * kind — `fish_extra-wxyz` / `fish_EXTRA-WXYZ` in `script/windoze/models.lua` — and
 * `ModelFactory::parseExtraControlSym` reads those four characters as (up, down, left,
 * right) in that order. So `w`=up, `x`=down, `y`=left, `z`=right, lowercase = `staramala`
 * and uppercase = `staravelka`. The Delphi original has no second set: `ZapniBonuslevel`
 * (`URoom.pas:23700`) re-points Little/Big at the elderly pair, so the SAME two slots are
 * driven and the letters simply map onto little/big — which is why both sets decode the
 * same way here.
 *
 * This lives in `src/core/` rather than in the test harness because the harness is no
 * longer the only reader: the dev-bar solution replay decodes the same strings in the
 * browser, and an alphabet defined twice is an alphabet that will eventually differ. WIN
 * #68 is the standing proof — the second set was missing for months and quietly shortened
 * that replay instead of failing it.
 */
import { Dir } from './dir.js';

export type Which = 'little' | 'big';

/** Direction letters per control set: the standard fish pair, then WIN's elderly pair. */
const MOVE_LETTERS: Readonly<Record<string, number>> = {
  u: Dir.up,
  d: Dir.down,
  l: Dir.left,
  r: Dir.right,
  w: Dir.up,
  x: Dir.down,
  y: Dir.left,
  z: Dir.right,
};

/** One recorded character, or null if it is not a move character at all. */
export function decodeMove(ch: string): { which: Which; dir: number } | null {
  const l = ch.toLowerCase();
  const dir = MOVE_LETTERS[l];
  if (dir === undefined) return null;
  return { which: ch === l ? 'little' : 'big', dir };
}

/**
 * A whole move-string. Throws on an undecodable character rather than skipping it: a
 * shortened replay that still reports "played to the end" is the failure mode this
 * refuses to have.
 */
export function decodeMoves(moves: string): { which: Which; dir: number }[] {
  return [...moves].map((ch, i) => {
    const m = decodeMove(ch);
    if (!m) throw new Error(`undecodable move character ${JSON.stringify(ch)} at index ${i}`);
    return m;
  });
}
