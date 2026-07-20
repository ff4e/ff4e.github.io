/**
 * FFNG solution slug -> ORIGINAL room number (1-based, matches roomTable.ts).
 *
 * The clean rows are the auto-derived unique physics-win mapping (corpus/mapping.tsv,
 * `note=clean`). Ambiguous rows (a solution that reaches the exit in more than one
 * room) and the script-gated rows (which have no physics-only win at all) are pinned
 * explicitly below, choosing the room the solution is actually FOR and keeping
 * coverage distinct.
 *
 * Not covered by any committed solution (out of scope for this net): SPUNT #29,
 * ZELVA #37, BARELY #44 (playable, no corpus solution — hand-record later); POHON #58
 * (FFNG's `rush` is a redesigned 37×37 level with colored pistons, NOT the original
 * 41×38 beast-push room — verified via fillets-ng-data 1.0.1 models.lua — so its moves
 * do not fit the port and it is unmapped); SCORE #72 (results screen, non-playable);
 * LODE #19, GRAL #64 (loose geometric catch-all rooms many strings reach).
 */
export const SOLUTION_ROOMS: Record<string, number> = {
  // --- clean auto-derived (unique physics-win) ---
  airplane: 14,
  aztec: 59,
  bathroom: 40,
  bathyscaph: 15,
  briefcase: 2,
  broom: 6,
  cabin1: 45,
  cabin2: 49,
  cancan: 35,
  cannons: 47,
  captain: 50,
  cave: 63,
  cellar: 3,
  chest: 61,
  city: 21,
  columns: 23,
  computer: 38,
  corals: 30,
  crabshow: 27,
  creatures: 34,
  duckie: 41,
  dump: 43,
  elevator1: 20,
  elevator2: 28,
  elk: 11,
  emulator: 66,
  engine: 54,
  experiments: 57,
  gems: 60,
  hardware: 69,
  imprisoned: 32,
  kitchen: 48,
  labyrinth: 31,
  library: 4,
  magnet: 53,
  music: 26,
  noground: 39,
  party1: 10,
  pavement: 24,
  pearls: 36,
  puzzle: 42,
  pyramid: 25,
  reactor: 52,
  reef: 7,
  snowman: 46,
  society: 33,
  stairs: 5,
  steel: 55,
  submarine: 9,
  tank: 16,
  tetris: 65,
  ufo: 22,
  viking1: 13,
  viking2: 17,
  warcraft: 67,
  wc: 8,
  windoze: 68,
  wreck: 12,

  // --- ambiguous rows, pinned to the distinct intended room ---
  alibaba: 62, // KNIHOVNA (viking1 already covers #13 DRAKAR1)
  start: 1, // PRVNI (the opening room; also reaches #71 ZAVER geometrically)

  // --- script-gated rows (no physics-only win; need prog() during replay) ---
  party2: 18, // PARTY2  — window-guest frees the exit window
  map: 51, // MAPA    — gspec=9 push the treasure map off the edge
  corridor: 56, // CHODBA  — dark corridor + robo-dog (KNOWN DIVERGENCE, see harness test)
  floppy: 70, // DISKETA — gspec=9 push the giant floppy off the edge
  // NOTE: `rush` is intentionally NOT mapped. FFNG redesigned that level (37×37 with
  // colored pistons); it is not the original 41×38 POHON #58, so its moves cannot solve
  // the port's POHON. See the header comment; rush.moves stays in the corpus for the record.
};

/**
 * Rooms whose port physics/script genuinely diverge from the FFNG reference solution
 * for the SAME level (verified: FFNG's level layout matches the port's original .ffr).
 * The harness FLAGS these (its core value) rather than silently skipping them; the main
 * test asserts every OTHER room stays clean while these remain a documented, tracked
 * gap. Each is a real port bug to fix (not a cadence artifact, not a layout mismatch):
 *   - corridor → CHODBA #56 (34×37, layout matches fillets-ng-data): the early moves
 *     replay fine; the divergence appears DEEP in the 3669-move solution once the dark/
 *     light switch + the two autonomous robo-dogs (item_light robright/robleft) come
 *     into play — their patrol desyncs from the recorded cadence. Resolving it needs a
 *     behaviour comparison against the DELPHI original (not FFNG), since the port targets
 *     1998 fidelity and FFNG's dog/tick timing may legitimately differ.
 *   - windoze  → WIN    #68 (45×33, layout matches): the gspec=5 bonus level. win.ts
 *     flags the gspec=5 control-swap path as partly deferred, AND the solution uses a
 *     second w/x/y/z control-symbol set for the bonus (elderly) fish that the port does
 *     not model — both fish die in the bonus. Fix = model the elderly-fish control set
 *     and the gspec=5 rescue. (Physics-only "won" only by skipping the bonus entirely.)
 */
export const KNOWN_DIVERGENT = new Set(['corridor', 'windoze']);
