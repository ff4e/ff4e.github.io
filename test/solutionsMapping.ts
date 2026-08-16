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
 * and CHODBA #56 (see the two notes at the bottom of this file); SCORE #72 (results
 * screen, non-playable); LODE #19, GRAL #64 (gspec=9 push-out rooms with no corpus
 * solution — see below).
 *
 * LODE/GRAL were long labelled "loose geometric catch-all rooms many strings reach".
 * That was an artifact of `tools/map-ffng.ts` replaying physics only: it ignored
 * `gspec` and let fish exit rooms the original forbids them to exit
 * (`if (gspec<>9)and(kontroluj_okraje>0)`, URoom.pas:24295), so unrelated move strings
 * appeared to win them. The tool now honours gspec and they no longer swallow anything;
 * they are simply unmapped because the FFNG corpus ships no solution for either.
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
  floppy: 70, // DISKETA — gspec=9 push the giant floppy off the edge
  // NOTE: `corridor` and `rush` are intentionally NOT mapped — see the two notes below.
};

/**
 * `corridor` — recorded, but NOT a usable solution for CHODBA #56, and not evidence of a
 * port bug either. The room is the right one: FFNG's `corridor` is 34×37 like the port's
 * #56, `script/corridor/models.lua` puts `fish_small` at (27,6) and `fish_big` at (4,5),
 * and the port's `.ffr` puts its little/big fish on exactly those cells. The RECORDING is
 * what does not fit.
 *
 * A fish's X only ever changes through its own recorded left/right move — nothing in this
 * engine pushes a fish sideways — so the horizontal span of a recording's little-fish
 * track is a lower bound on the width of the room it was recorded in. Replayed as pure
 * kinematics (turn-in-place semantics, no collisions), `corridor`'s little fish sweeps
 * **1398 columns** of a **34**-column room, in ~50 repeats of a `l r×24 d×18` block that
 * never comes back left. No geometry, no script and no dog/darkness timing can make that
 * replay; it is not a port divergence, it is a recording that never happened. FFNG could
 * not replay it either: `Room::makeMove` (fillets-ng 1.0.1, `src/level/Room.cpp:420`)
 * throws `LoadException("load error - bad move")` the moment a loaded symbol is refused,
 * and `Unit::goRight` (`src/level/Unit.cpp:189`) only ever records a symbol for a move
 * that succeeded or a turn — so a faithful FFNG log cannot contain a rejected move.
 *
 * The port replays the string's BIG-fish channel perfectly for its first 24 moves and the
 * big track spans a plausible 24×33; only the little-fish channel is impossible. What
 * corrupted it upstream is unknown. `test/solutionsCorpus.test.ts` pins the measurement so
 * this file can never again call it a port bug.
 *
 * CHODBA #56 therefore has NO known solution and needs one hand-recorded, exactly like
 * SPUNT/ZELVA/BARELY. `corridor.moves` stays in the corpus for the record.
 */

/**
 * `rush` — recorded, and correctly unmapped, but NOT because "FFNG redesigned POHON".
 * FFNG ships a faithful POHON: `script/propulsion/` is 41×38 with `fish_small` at (32,26)
 * and `fish_big` at (14,12) — cell-for-cell the port's #58 — and `worlddesc.lua:787`
 * names it en "The Real Propulsion" / cs "Skutečný pohon" under the chapter "UFO", which
 * is roomTable.ts:82 verbatim. `rush` is a different level altogether:
 * `worlddesc.lua:990` calls it "Filled Car Park" / "Zaplněné parkoviště" in the chapter
 * "Branch of the New Generation" — one of the nine levels FFNG added that the 1998
 * original never had.
 *
 * So POHON is uncovered for the ordinary reason: `alfonz19/ff-ng-saves` ships no
 * `propulsion` save. `rush.moves` solves an FFNG-only level this port does not contain
 * and stays in the corpus for the record.
 */

/**
 * Rooms whose port physics/script genuinely diverge from the FFNG reference solution for
 * the SAME level (verified: FFNG's level layout matches the port's original `.ffr`). The
 * harness FLAGS these (its core value) rather than silently skipping them; the main test
 * asserts every OTHER room stays clean while these remain a documented, tracked gap.
 *
 * It is currently EMPTY, and that is a real result rather than an oversight: both entries
 * it ever held turned out not to be port bugs. WIN #68 (`windoze`) was a handover-timing
 * difference between Delphi and FFNG, fixed by re-cutting the recording where Delphi
 * accepts it (see `test/fixtures/solutions/README.md`). CHODBA #56 (`corridor`) was a
 * corrupt recording, not a divergence at all (see the note above). Keep the set — it is
 * the right place for the next one — but a slug belongs here only with a measurement
 * showing the RECORDING is sound and the PORT is what disagrees.
 */
export const KNOWN_DIVERGENT = new Set<string>([]);
