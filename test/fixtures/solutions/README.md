# Room solution corpus — the STAGING area

Known-good FFNG solution move-strings, one per level. **This directory is no longer what
the game or the tests read.** A recording's home is the room it solves: `npm run
gen-solutions` resolves the ambiguous slug → room match once (via the pinned map in
`test/solutionsMapping.ts`) and writes `src/rooms/solutions.ts`, which `src/rooms/index.ts`
attaches to each `RoomScript` as `solution`. `test/solutionsData.test.ts` proves the two
agree byte-for-byte, so the two cannot drift apart in silence.

So this is the **import/staging area**: a newly recorded solution lands here as
`<slug>.moves`, gets a pin in `solutionsMapping.ts`, and is promoted into the room data by
the generator. One recording stays here for good — `rush` solves an FFNG level the 1998
original never had, so there is no room for it to move into.

**The licence and attribution below travel with the strings.** They are GPL-2.0-or-later,
the same licence as this port, and are now also compiled into `src/rooms/solutions.ts`,
whose header repeats this credit. Do not let it be dropped in a refactor.

`mapping.tsv` is **not** part of any of this and must not be removed with the `.moves`
files: it is the base jmeno → FFNG codename map for the enhanced-art pipeline
(`tools/lib/ffngCodename.ts` → `stage-enhanced*.ts`, `render-enhanced.ts`).

## Where the recordings came from

- **Source 1 — `alfonz19/ff-ng-saves`:** the Fish Fillets NG remake's community solution
  repo [`alfonz19/ff-ng-saves`](https://github.com/alfonz19/ff-ng-saves) → `solved/*.lua`.
  65 recordings. It is one player's collection, not a complete set: it has nothing for
  seven of the levels, and its `corridor` recording is corrupt (below).
- **Source 2 — Brian Raiter's Fish Fillets Solution Archive**
  (<https://www.muppetlabs.com/~breadbox/fillets/>), which has every level of both the
  original and FFNG, each recorded by a named player. The seven files taken from it are
  `gods`, `atlantis`, `turtle`, `barrel`, `corridor`, `propulsion`, `grail` — the six rooms
  the corpus had nothing for, plus a working replacement for the corrupt `corridor`.
- `*.moves` — one file per FFNG level, containing just the move string.
  Encoding: lowercase = little (small) fish, UPPERCASE = big; `u/d/l/r` = up/down/
  left/right. `windoze` additionally uses a second control-symbol set for the bonus
  level's two elderly fish: `w/x/y/z` drives `staramala` and `W/X/Y/Z` drives
  `staravelka`, spelled out in FFNG's model kinds (`fish_extra-wxyz` /
  `fish_EXTRA-WXYZ`, `script/windoze/models.lua`) and parsed as (up, down, left,
  right) in that order by `ModelFactory::parseExtraControlSym` — so `w`=up, `x`=down,
  `y`=left, `z`=right. The Delphi original has no second set: `ZapniBonuslevel`
  (`URoom.pas:23700`) re-points Little/Big at the elderly pair, so both sets drive the
  same two slots and `solutionsHarness.ts` decodes them identically.
- `mapping.tsv` — auto-derived slug → original room number + Jmeno (see
  `test/solutionsMapping.ts` for the pinned, disambiguated mapping actually used).

## The corrupt recording, and the one that is not a solution

- **`corridor` (replaced).** The `ff-ng-saves` version was 3669 moves and impossible:
  replayed as pure kinematics its little fish swept **1398 columns of a 34-column room**,
  in ~50 repeats of an `l r×24 d×18` block that never came back left. It got CHODBA #56
  filed as a port bug for months. The file here now is Brian Raiter's 523-move recording
  by Amic Frouvelle, which replays won / no death / 0 blocked. `test/solutionsCorpus.test.ts`
  checks every recording that is pinned to a room for that class of defect before the
  replay runs. (`rush` is not checked — with no room to check against, there is no bound.)
- **`rush` (kept, unmapped).** Solves FFNG's own "Filled Car Park", chapter "Branch of the
  New Generation" — one of nine levels the 1998 original never had, so this port does not
  contain it. It was long mistaken for POHON #58; POHON's counterpart is `propulsion`.

**Match a recording to a room on the level TITLE, not the slug.** FFNG groups levels under
chapter names, and reading the chapter as the level name is exactly how POHON spent a long
time recorded as "a level FFNG redesigned".

## The one edited recording: `windoze`

Every other file is the corpus string verbatim. `windoze` is the corpus string with the
bonus level moved to a different point in the sequence, because **FFNG and the 1998
Delphi original open the bonus at different moments** and the port targets Delphi:

- Delphi (`URoom.pas:17944`, ported in `src/rooms/win.ts`) opens it on a *position*:
  `velkar.X + 4 = bonuslevel.X` (i.e. the big fish standing in the column left of the
  window), facing right, `velkar.Y >= bonuslevel.Y - 1`.
- FFNG (`script/windoze/code.lua:64`) opens it on a *touch*:
  `big:getTouchDir() ~= dir_no and bonuslevel:getTouchDir() ~= dir_no`. `setTouched`
  (`Rules.cpp:615`) only fires when a move FAILS, and propagates through the blocked
  chain — so FFNG's trigger is a blocked push whose obstacle chain reaches the window,
  and a blocked push is never recorded. The corpus string therefore contains no
  characters at all for the handover, and hands control over with the big fish two
  columns short of where Delphi will accept it.

Replaying the string unedited makes the port spend the elderly fish's first two moves
walking the young big fish to Delphi's trigger, which strands the elderly pair two cells
short and kills them. Simply inserting those two moves is not neutral either: from where
the corpus leaves the big fish, moving right shoves a stack of objects and the rest of
the solution no longer fits the room.

So the bonus is entered **earlier**, at the one point in the corpus route where the big
fish can reach Delphi's trigger column through open water and walk back out again
without touching anything: after the 12-step rightward run along y=8 that leaves it at
(15,8). Eleven characters are inserted there and nothing else changes:

| inserted | what it does |
| --- | --- |
| `RRRR` (before the bonus block) | (15,8) → (19,8) through open water; Delphi's trigger fires |
| the corpus's 214 `w/x/y/z` moves, unchanged | the whole bonus level, verbatim |
| `z` (after it) | one turn-in-place for the rescued elderly little fish, see below |
| `LLLLLR` | turn, four steps back to (15,8), turn back to facing right |

Every inserted character is a command the original would have **accepted and recorded**:
`ToRecord` runs only on a successful `posun_ryby` or on a turn (`URoom.pas:24718-24738`),
so a recording never contains a rejected push — which is also why `blocked === 0` is the
right assertion here.

The lone `z` is the least obvious of them. `WIN_Programky` checks "both elderly fish are
home" (`URoom.pas:17971`) **before** the block that parks a rescued one at x=1
(`18078`/`18090`), so `VypniBonuslevel` can only run on the `prog` AFTER the second rescue
— one tick in which the bonus is over but control has not come back. A turn is accepted in
that tick where a push would not be, and it does a second job: `VypniBonuslevel`
(`URoom.pas:23723`) forces BOTH fish to face right, and the turn resolves after it
(`prog` runs before the state machine), so the little fish is left facing left — which is
how the corpus expects to find it.

783 → 794 characters. The corpus original is recoverable exactly: delete the eleven
inserted characters and put the 214-character bonus block back between the `…lllluuuU`
and the `uuuuuuuuuuuuuuuu` that follow it.
