/**
 * FFNG solution slug -> ORIGINAL room number (1-based, matches roomTable.ts).
 *
 * The clean rows are the auto-derived unique physics-win mapping (corpus/mapping.tsv,
 * `note=clean`). Ambiguous rows (a solution that reaches the exit in more than one
 * room) and the script-gated rows (which have no physics-only win at all) are pinned
 * explicitly below, choosing the room the solution is actually FOR and keeping
 * coverage distinct.
 *
 * Every playable room is now mapped. The only rooms without a solution are ZAVER #71 and
 * SCORE #72, which are the ending and results screens and are not puzzles.
 *
 * That was not true until the corpus gained a second source. `alfonz19/ff-ng-saves` is one
 * player's collection and simply never had seven of the levels; the gap was long recorded
 * here as "no known solution exists", and for CHODBA #56 the corpus even shipped a
 * corrupted recording that got the room filed as a port bug for months (see the note at
 * the bottom of this file). Brian Raiter's archive has all of them. See
 * `test/fixtures/solutions/README.md` for both sources.
 *
 * LODE/GRAL were separately labelled "loose geometric catch-all rooms many strings reach".
 * That was an artifact of `tools/map-ffng.ts` replaying physics only: it ignored
 * `gspec` and let fish exit rooms the original forbids them to exit
 * (`if (gspec<>9)and(kontroluj_okraje>0)`, URoom.pas:24295), so unrelated move strings
 * appeared to win them. The tool now honours gspec and they no longer swallow anything.
 * Both are mapped now (`gods`, `grail`) and both replay clean.
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

  // --- from Brian Raiter's archive; the seven ff-ng-saves never had ---
  gods: 19, // LODE    — gspec=9 push-out
  atlantis: 29, // SPUNT
  turtle: 37, // ZELVA   — telepathic turtle; needs the hrac_nespi reset, see solutionsHarness
  barrel: 44, // BARELY
  corridor: 56, // CHODBA
  propulsion: 58, // POHON
  grail: 64, // GRAL    — gspec=9 push-out
  // NOTE: `rush` is intentionally NOT mapped — see the note below.
};

/**
 * `rush` — recorded, and correctly unmapped, but NOT because "FFNG redesigned POHON",
 * which is what this file used to say. FFNG ships a faithful POHON: `script/propulsion/`
 * is 41×38 with `fish_small` at (32,26) and `fish_big` at (14,12) — cell-for-cell the
 * port's #58 — and `worlddesc.lua:787` names it en "The Real Propulsion" / cs "Skutečný
 * pohon" under the chapter "UFO", which is roomTable.ts:82 verbatim. It is mapped above
 * and replays clean in 1964 moves.
 *
 * `rush` is a different level altogether: `worlddesc.lua:990` calls it "Filled Car Park" /
 * "Zaplněné parkoviště" in the chapter "Branch of the New Generation" — one of the nine
 * levels FFNG added that the 1998 original never had, so this port does not contain it.
 * `rush.moves` stays in the corpus for the record.
 *
 * Reading that chapter name as the level name is what kept POHON written off. **Match a
 * recording to a room on the level TITLE, not the slug.**
 */

/**
 * Rooms whose port physics/script genuinely diverge from the FFNG reference solution for
 * the SAME level (verified: FFNG's level layout matches the port's original `.ffr`). The
 * harness FLAGS these (its core value) rather than silently skipping them; the main test
 * asserts every OTHER room stays clean while these remain a documented, tracked gap.
 *
 * It is EMPTY, and every playable room replays clean. Keep the set — it is the right place
 * for the next one — but a slug belongs here only with a measurement showing the RECORDING
 * is sound and the PORT is what disagrees. All three entries it ever held failed that test
 * rather than passing it, each in a different way, which is the reason for the caution:
 *
 *   - WIN #68 (`windoze`) — a Delphi-vs-FFNG control-handover difference. Fixed by
 *     re-cutting the recording at a point Delphi accepts.
 *   - CHODBA #56 (`corridor`) — a corrupt recording (see the note below).
 *   - ZELVA #37 (`turtle`) — a gap in the REPLAY HARNESS, not in the port. `DalsiPrikaz`
 *     calls `hrac_nespi` as it reads each recorded command (URoom.pas:26985); the headless
 *     harness did not, so the idle timers only ever grew, and ZELVA's telepathic turtle —
 *     which seizes a fish once both have idled 40 ticks (`zelva.ts:85`) — possessed the big
 *     fish partway through every replay, walked it off the recorded route and killed the
 *     little fish. See the comment at the call site in `solutionsHarness.ts`.
 */
export const KNOWN_DIVERGENT = new Set<string>([]);

/**
 * A note kept because it cost months: CHODBA #56 sat in KNOWN_DIVERGENT with a confident
 * write-up ("the divergence is deep in the 3669-move solution, once the dark/light switch
 * and the two autonomous robo-dogs come into play") and was never a port bug at all. The
 * `corridor.moves` that produced it — from `alfonz19/ff-ng-saves` — was corrupt: replayed
 * as pure kinematics its little fish swept **1398 columns of a 34-column room**, in ~50
 * repeats of an `l r×24 d×18` block that never returned left. FFNG could not have replayed
 * it either (`Room::makeMove` throws `LoadException("load error - bad move")` on the first
 * refused symbol). The port was right the whole time: the 523-move recording now in the
 * corpus replays it won, no death, 0 blocked.
 *
 * `test/solutionsCorpus.test.ts` now checks every recording for that class of defect before
 * the replay ever runs, which takes ~1 ms per recording and would have said so immediately.
 */
