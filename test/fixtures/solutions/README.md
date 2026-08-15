# Room solution corpus (test fixtures)

Known-good FFNG solution move-strings, one per level, replayed by the solutions
harness (`test/solutions.test.ts`) to verify each room is solvable in the port.

- **Source:** the GPL Fish Fillets NG remake's community solution repo
  [`alfonz19/ff-ng-saves`](https://github.com/alfonz19/ff-ng-saves) → `solved/*.lua`.
- **Licence:** GPL-2.0-or-later — the same licence as this port, so the corpus is
  safe to commit here.
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
| `LLLLLR` (after it) | turn, four steps back to (15,8), turn back to facing right |
| `l` | `VypniBonuslevel` (`URoom.pas:23723`) forces BOTH fish to face right; the corpus expects the little fish still facing left, so turn it back |

783 → 794 characters. The corpus original is recoverable exactly: delete the eleven
inserted characters and put the 214-character bonus block back between the `…lllluuuU`
and the `uuuuuuuuuuuuuuuu` that follow it.
