/**
 * Every room's native size, for the layout lab and the layout sweeps — DEV ONLY.
 *
 * For layout purposes a room IS just a rectangle: nothing about its contents can change
 * where it is placed or how big it is drawn. That is what lets `tools/layout-lab.html`
 * model the whole problem with coloured boxes and no game data at all, and it is why this
 * table exists as a checked-in constant rather than a call into `dump-ffr`: the lab runs
 * in a browser, and the sweeps must be runnable on a machine that does not have the
 * commercial 1998 MAINDIR.
 *
 * Generated once from `npm run dump-ffr -- --all` (cells x 15 px), which is the only
 * authority for these numbers. Regenerate the same way if the room set ever changes.
 *
 * 72 rooms, 63 DISTINCT sizes, 285x210 to 795x585. The duplicates are deliberate — a
 * sweep that de-duplicates is measuring 63 rectangles, while a player walks through 72
 * rooms, and the two give different means.
 */
export interface LabRoom {
  /** 1-based room number, as `dump-ffr` prints it. */
  n: number;
  name: string;
  /** Native px (cells x 15). */
  w: number;
  h: number;
}

/** The world map is not a room but is laid out by exactly the same code. */
export const LAB_MAP: LabRoom = { n: 0, name: "MAP", w: 640, h: 480 };

export const LAB_ROOMS: readonly LabRoom[] = [
  { n: 1, name: "PRVNI", w: 435, h: 405 },
  { n: 2, name: "KUFRIK", w: 720, h: 555 },
  { n: 3, name: "PRAVIDLA", w: 600, h: 525 },
  { n: 4, name: "VRAK", w: 315, h: 555 },
  { n: 5, name: "SCHODY", w: 600, h: 450 },
  { n: 6, name: "KOSTE", w: 540, h: 495 },
  { n: 7, name: "UTES", w: 780, h: 225 },
  { n: 8, name: "WC", w: 345, h: 330 },
  { n: 9, name: "ZRC", w: 555, h: 225 },
  { n: 10, name: "PARTY1", w: 780, h: 495 },
  { n: 11, name: "DEUTSCHE", w: 675, h: 480 },
  { n: 12, name: "POTOPENA", w: 420, h: 300 },
  { n: 13, name: "DRAKAR1", w: 540, h: 435 },
  { n: 14, name: "LETADLO", w: 675, h: 405 },
  { n: 15, name: "BATYSKAF", w: 690, h: 300 },
  { n: 16, name: "SVATBA", w: 750, h: 555 },
  { n: 17, name: "DRAKAR", w: 795, h: 435 },
  { n: 18, name: "PARTY2", w: 780, h: 495 },
  { n: 19, name: "LODE", w: 690, h: 570 },
  { n: 20, name: "ZDVIZ1", w: 510, h: 540 },
  { n: 21, name: "VITEJTE1", w: 750, h: 345 },
  { n: 22, name: "UFO", w: 720, h: 450 },
  { n: 23, name: "SLOUPY", w: 600, h: 450 },
  { n: 24, name: "DIRY", w: 705, h: 540 },
  { n: 25, name: "PYRAMIDA", w: 645, h: 420 },
  { n: 26, name: "VES", w: 600, h: 450 },
  { n: 27, name: "SECRET", w: 585, h: 480 },
  { n: 28, name: "ZDVIZ2", w: 510, h: 540 },
  { n: 29, name: "SPUNT", w: 750, h: 525 },
  { n: 30, name: "RECYCLED", w: 420, h: 375 },
  { n: 31, name: "BLUDISTE", w: 645, h: 570 },
  { n: 32, name: "NCP", w: 705, h: 585 },
  { n: 33, name: "MIKRO", w: 360, h: 210 },
  { n: 34, name: "KORALY", w: 645, h: 525 },
  { n: 35, name: "KANKAN", w: 615, h: 525 },
  { n: 36, name: "JEDNICKY", w: 495, h: 480 },
  { n: 37, name: "ZELVA", w: 750, h: 555 },
  { n: 38, name: "POCITAC", w: 540, h: 405 },
  { n: 39, name: "NOGROUND", w: 285, h: 285 },
  { n: 40, name: "BATHROOM", w: 465, h: 480 },
  { n: 41, name: "ODPADKY", w: 405, h: 315 },
  { n: 42, name: "PUCLIK", w: 795, h: 585 },
  { n: 43, name: "SMETAK", w: 645, h: 480 },
  { n: 44, name: "BARELY", w: 750, h: 585 },
  { n: 45, name: "KAJUTA1", w: 360, h: 330 },
  { n: 46, name: "TRUP", w: 435, h: 330 },
  { n: 47, name: "DELA", w: 450, h: 405 },
  { n: 48, name: "KUCHYNE", w: 765, h: 510 },
  { n: 49, name: "KAJUTA2", w: 420, h: 360 },
  { n: 50, name: "VLADOVA", w: 615, h: 435 },
  { n: 51, name: "MAPA", w: 720, h: 495 },
  { n: 52, name: "REAKTOR", w: 660, h: 450 },
  { n: 53, name: "PAPRSKY", w: 525, h: 465 },
  { n: 54, name: "MOTOR", w: 615, h: 405 },
  { n: 55, name: "STEEL", w: 630, h: 375 },
  { n: 56, name: "CHODBA", w: 510, h: 555 },
  { n: 57, name: "BANKA", w: 720, h: 525 },
  { n: 58, name: "POHON", w: 615, h: 570 },
  { n: 59, name: "BOTTLES", w: 720, h: 585 },
  { n: 60, name: "ZAVAL", w: 435, h: 270 },
  { n: 61, name: "TRUHLA", w: 585, h: 465 },
  { n: 62, name: "KNIHOVNA", w: 600, h: 450 },
  { n: 63, name: "JESKYNE", w: 480, h: 420 },
  { n: 64, name: "GRAL", w: 765, h: 540 },
  { n: 65, name: "TETRIS", w: 765, h: 480 },
  { n: 66, name: "ZX", w: 705, h: 540 },
  { n: 67, name: "WARCR2", w: 780, h: 555 },
  { n: 68, name: "WIN", w: 675, h: 495 },
  { n: 69, name: "PUZZLE", w: 600, h: 405 },
  { n: 70, name: "DISKETA", w: 765, h: 525 },
  { n: 71, name: "ZAVER", w: 435, h: 405 },
  { n: 72, name: "SCORE", w: 600, h: 450 },
];

/** The 63 distinct sizes, smallest area first — the rectangle set the sweeps care about. */
export const LAB_SIZES: readonly { w: number; h: number; rooms: string[] }[] = (() => {
  const by = new Map<string, { w: number; h: number; rooms: string[] }>();
  for (const r of LAB_ROOMS) {
    const k = `${r.w}x${r.h}`;
    const e = by.get(k);
    if (e) e.rooms.push(r.name);
    else by.set(k, { w: r.w, h: r.h, rooms: [r.name] });
  }
  return [...by.values()].sort((a, b) => a.w * a.h - b.w * b.h);
})();
