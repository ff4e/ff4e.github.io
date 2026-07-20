# Room solution corpus (test fixtures)

Known-good FFNG solution move-strings, one per level, replayed by the solutions
harness (`test/solutions.test.ts`) to verify each room is solvable in the port.

- **Source:** the GPL Fish Fillets NG remake's community solution repo
  [`alfonz19/ff-ng-saves`](https://github.com/alfonz19/ff-ng-saves) → `solved/*.lua`.
- **Licence:** GPL-2.0-or-later — the same licence as this port, so the corpus is
  safe to commit here.
- `*.moves` — one file per FFNG level, containing just the move string.
  Encoding: lowercase = little (small) fish, UPPERCASE = big; `u/d/l/r` = up/down/
  left/right. (`windoze` additionally uses a second `w/x/y/z` control-symbol set for
  the bonus-level elderly fish, which the port does not model — see `KNOWN_DIVERGENT`.)
- `mapping.tsv` — auto-derived slug → original room number + Jmeno (see
  `test/solutionsMapping.ts` for the pinned, disambiguated mapping actually used).
