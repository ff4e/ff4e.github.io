/**
 * World-map data (USoutez.pas / UMain.pas): the branch tree, environment names,
 * room-node positions, and the unlock logic that gates which branches are open.
 *
 * The 72 rooms are grouped into 10 branches (environments). A branch opens once
 * its feeder room (the specific room that leads into it) has been solved; branch
 * 0 (Fish House) is always open. This mirrors Vetev[].enabv/enabm (the feeder
 * branch + room-in-branch) driving Vetev[].enab/ready in UMain.pas:933-946.
 */

/** Environment names [CZ, EN] (Prostredi, zaklad.pas:32). */
export const PROSTREDI: readonly (readonly [string, string])[] = [
  ['Rybí domeček', 'Fish House'],
  ['Vrakoviště', 'Ship Wrecks'],
  ['Město v hlubinách', 'City In the Deep'],
  ['Korálový útes', 'Coral Reef'],
  ['Smetiště', 'Dump'],
  ["Silverova loď", "Silver's Ship"],
  ['Ztroskotané UFO', 'UFO'],
  ['Jeskyně pokladů', 'Treasure Cave'],
  ['Tajný počítač', 'Secret Computer'],
  ['', ''],
];

export interface Branch {
  /** Number of rooms in the branch (delka). */
  readonly length: number;
  /** Global room number (1-based) of the branch's first room (zac). */
  readonly start: number;
  /** Feeder branch index (enabv), or 255 if the branch is always open. */
  readonly feederBranch: number;
  /** Feeder room-in-branch index (enabm). */
  readonly feederRoom: number;
}

/** Vetev (USoutez.pas:128): branch table. Fields (delka, zac, enabv, enabm). */
export const BRANCHES: readonly Branch[] = [
  { length: 8, start: 1, feederBranch: 255, feederRoom: 255 }, // 0 Fish House
  { length: 11, start: 9, feederBranch: 0, feederRoom: 3 }, // 1 Ship Wrecks
  { length: 10, start: 20, feederBranch: 0, feederRoom: 4 }, // 2 City
  { length: 8, start: 30, feederBranch: 0, feederRoom: 6 }, // 3 Coral Reef
  { length: 7, start: 38, feederBranch: 0, feederRoom: 7 }, // 4 Dump
  { length: 7, start: 45, feederBranch: 1, feederRoom: 3 }, // 5 Silver's Ship
  { length: 7, start: 52, feederBranch: 2, feederRoom: 2 }, // 6 UFO
  { length: 6, start: 59, feederBranch: 3, feederRoom: 1 }, // 7 Cave
  { length: 6, start: 65, feederBranch: 4, feederRoom: 0 }, // 8 Computer
  { length: 2, start: 71, feederBranch: 0, feederRoom: 0 }, // 9 final/score
];

/** Registered (playable) branches — the last (score/final) is excluded (nregvetvi=9). */
export const N_BRANCHES = 9;

/**
 * The global 1-based numbers of every registered room (nregrooms=70): all rooms in
 * branches 0..8. The final/score branch (9: rooms 71 ZAVER, 72 SCORE) is excluded.
 * Used to decide when the whole game is finished (the ZAVER finale trigger).
 */
export const REGISTERED_ROOMS: readonly number[] = (() => {
  const rooms: number[] = [];
  for (let i = 0; i < N_BRANCHES; i++) {
    const b = BRANCHES[i]!;
    for (let j = 0; j < b.length; j++) rooms.push(b.start + j);
  }
  return rooms;
})();

/**
 * The map-mask value tagging each branch's region on maska.bmp (UMain.pas:1465).
 * `dest = RTable[mask] ? mapa1 : mapa0`, and RTable[maskOfBranch[b]] = branch b open.
 */
export const BRANCH_MASK: readonly number[] = [0, 1, 13, 7, 2, 8, 3, 11, 6];

/** Room-node centres (KulXY, UMain.pas:109): [x0,y0, x1,y1, ...] for rooms 1..72. */
export const KULXY: readonly number[] = [
  320, 121, 329, 153, 320, 189, 301, 224, 285, 252, 279, 286, 292, 315, 314, 338, // 1-8 Fish House
  340, 228, 381, 224, 422, 210, 456, 189, 483, 158, 491, 119, 477, 84, 446, 58, 402, 61, 372, 88, 391, 124, // 9-19 Ship Wrecks
  247, 234, 219, 217, 192, 192, 171, 161, 161, 125, 175, 81, 207, 52, 244, 44, 266, 77, 251, 115, // 20-29 City
  329, 294, 367, 296, 401, 314, 418, 346, 412, 383, 386, 406, 352, 408, 337, 375, // 30-37 Coral Reef
  289, 368, 257, 397, 217, 415, 170, 415, 138, 385, 154, 342, 192, 351, // 38-44 Dump
  464, 227, 487, 256, 521, 271, 558, 254, 571, 210, 550, 175, 510, 199, // 45-51 Silver's Ship
  167, 222, 132, 238, 95, 236, 70, 210, 78, 169, 111, 159, 118, 192, // 52-58 UFO
  407, 282, 441, 291, 469, 319, 494, 341, 529, 334, 558, 318, // 59-64 Cave
  254, 349, 226, 317, 198, 290, 162, 279, 129, 290, 97, 314, // 65-70 Computer
  320, 240, 320, 240, // 71-72 final/score
];

/**
 * Hloubka (UMain.pas:328-337): each room's "depth" (distance from the start of
 * the tree). Fish House room j has depth j+1; a later branch's room j has depth
 * = its feeder room's depth + j + 1. Drives the map "reveal" animation, which
 * fades nodes in from the start outward (a node shows once Depth >= its Hloubka).
 */
export function computeHloubka(): number[][] {
  const H: number[][] = BRANCHES.map((b) => new Array<number>(b.length).fill(-1));
  for (let i = 0; i < N_BRANCHES; i++) {
    const b = BRANCHES[i]!;
    for (let j = 0; j < b.length; j++) {
      H[i]![j] = i === 0 ? j + 1 : H[b.feederBranch]![b.feederRoom]! + j + 1;
    }
  }
  return H;
}

/** The deepest room depth — once the reveal reaches it, the whole map is shown. */
export const MAX_HLOUBKA: number = (() => {
  const H = computeHloubka();
  let m = 0;
  for (const row of H) for (const d of row) if (d > m) m = d;
  return m;
})();

/**
 * The Depth (Hloubka) of a room by its global 1-based number (UMain.pas Depth,
 * set from hloubka[av,am] on room entry). Used by death commentary (StdSmrt) to
 * pick the line mix. Returns -1 for an unknown room number.
 */
export function depthOfRoom(roomNum: number): number {
  const H = computeHloubka();
  for (let i = 0; i < BRANCHES.length; i++) {
    const b = BRANCHES[i]!;
    if (roomNum >= b.start && roomNum < b.start + b.length) return H[i]![roomNum - b.start]!;
  }
  return -1;
}

/** The global room number (1-based) that feeds a branch, or -1 if always open. */
export function feederRoomNumber(branch: number): number {
  const b = BRANCHES[branch]!;
  if (b.feederBranch === 255) return -1;
  return BRANCHES[b.feederBranch]!.start + b.feederRoom;
}

/** Per-room map state (Resena, USoutez.pas): 0 hidden, 1 solved, 2 reachable/next, 3 cheat. */
export const RES_HIDDEN = 0;
export const RES_SOLVED = 1;
export const RES_REACHABLE = 2;
export const RES_CHEAT = 3;

/**
 * updatuj_soutez (USoutez.pas:227-259): compute each room's Resena state from the
 * sets of genuinely-solved and cheat-solved (1-based) room numbers.
 *  - solved  (1): completed for real.
 *  - reachable (2): playable now — the first room of a branch whose feeder room is
 *    solved, or a later room whose PREVIOUS room in the branch is solved (so a
 *    branch's rooms unlock strictly in order).
 *  - cheat   (3): completed only via the cheat (counts as solved for unlocking,
 *    but shown differently).
 *  - hidden  (0): not yet reachable; not drawn on the map.
 * Returns resena[branchIndex][roomInBranch].
 */
export function computeResena(
  solved: ReadonlySet<number>,
  cheated: ReadonlySet<number> = new Set(),
): number[][] {
  const completed = (n: number): boolean => solved.has(n) || cheated.has(n);
  const R: number[][] = BRANCHES.map(() => []);
  for (let i = 0; i < N_BRANCHES; i++) {
    const b = BRANCHES[i]!;
    for (let j = 0; j < b.length; j++) {
      R[i]![j] = completed(b.start + j) ? RES_SOLVED : RES_HIDDEN;
    }
  }
  // The very first room is always at least reachable.
  if (R[0]![0] === RES_HIDDEN) R[0]![0] = RES_REACHABLE;
  // Reachability propagation (a cheated room still counts as solved here).
  for (let i = 0; i < N_BRANCHES; i++) {
    const b = BRANCHES[i]!;
    for (let j = 0; j < b.length; j++) {
      if (R[i]![j] !== RES_HIDDEN) continue;
      const reachable =
        j === 0
          ? b.feederBranch !== 255 && R[b.feederBranch]?.[b.feederRoom] === RES_SOLVED
          : R[i]![j - 1] === RES_SOLVED;
      if (reachable) R[i]![j] = RES_REACHABLE;
    }
  }
  // Display-only: a room completed ONLY via the cheat shows the cheat sprite.
  for (let i = 0; i < N_BRANCHES; i++) {
    const b = BRANCHES[i]!;
    for (let j = 0; j < b.length; j++) {
      if (R[i]![j] === RES_SOLVED && !solved.has(b.start + j) && cheated.has(b.start + j)) {
        R[i]![j] = RES_CHEAT;
      }
    }
  }
  return R;
}

/** Is a branch enabled (its first room reachable-or-solved)? Vetev[i].enab. */
export function branchEnabled(resena: number[][], branch: number): boolean {
  return (resena[branch]?.[0] ?? RES_HIDDEN) > RES_HIDDEN;
}

/** Is a branch open, given the set of solved (1-based) room numbers? */
export function branchOpen(branch: number, solved: ReadonlySet<number>): boolean {
  return branchEnabled(computeResena(solved), branch);
}

/** The branch index a (1-based) room belongs to, or -1. */
export function branchOfRoom(room: number): number {
  for (let i = 0; i < BRANCHES.length; i++) {
    const b = BRANCHES[i]!;
    if (room >= b.start && room < b.start + b.length) return i;
  }
  return -1;
}
