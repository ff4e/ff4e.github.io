/**
 * help.cap parser — the recorded input stream that drives KUFRIK's automatic
 * demonstration (showmode, URoom.pas:19932/26971). The file is a Pascal `file of
 * integer`: a flat sequence of 32-bit little-endian ints. Each recorded step is
 * `(kdo, akce)`, plus `(x, y)` when `akce = akce_go` (7). One entry per game tick;
 * `kdo=0` marks a no-op tick (animation/idle continuation).
 */

/** Action codes (Uovl.pas:140-160). */
export const AKCE = {
  up: 1,
  down: 2,
  left: 3,
  right: 4,
  set: 5, // select a fish
  switch: 6, // swap the active fish
  go: 7, // swim to a cell (carries x,y)
  natvrdo: 8,
  load: 10,
  save: 20,
  restart: 30,
  exit: 40,
  help: 70,
  helptext: 103, // show the next tutorial subtitle
} as const;

/** Who issued the command (Uovl.pas:92-94): 0 = none, 1 = little, 2 = big, 3 = system. */
export const KDO = { none: 0, little: 1, big: 2, sys: 3 } as const;

export interface CapAction {
  kdo: number;
  akce: number;
  x: number;
  y: number;
}

export function parseHelpCap(bytes: Uint8Array): CapAction[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.length / 4);
  const int = (i: number): number => dv.getInt32(i * 4, true);
  const actions: CapAction[] = [];
  let i = 0;
  while (i + 2 <= n) {
    const kdo = int(i++);
    const akce = int(i++);
    let x = 0;
    let y = 0;
    if (akce === AKCE.go) {
      if (i + 2 > n) break;
      x = int(i++);
      y = int(i++);
    }
    actions.push({ kdo, akce, x, y });
  }
  return actions;
}
