/**
 * KUFRIK demonstration: pauses lengthened by hand.
 *
 * The automatic demonstration replays `help.cap`, a recorded input stream from 1998, one
 * action per idle tick (DalsiPrikaz in `stav_klid`, `URoom.pas:24435-24438`). This table is
 * the **only** deliberate departure from that recording; everything else about showmode is
 * a straight port.
 *
 * ## Why deviate at all
 *
 * The recording was made by a person playing along, and it does not wait for the lines. The
 * demo narrates a hazard and then performs it, and wherever the player was quicker than the
 * voice, the fish dies part-way through its own warning. That is faithful — the 1998 game
 * does the same, and it is not a port bug — but it reads as a defect rather than as a period
 * detail. So individual pauses are lengthened, one at a time and by hand, to let a line land
 * before the thing it describes happens.
 *
 * ## What a hold does, and does not, change
 *
 * The key is the `help.cap` index of the entry **after** which the extra idle ticks are
 * spent, and the value is how many ticks (80 ms each, `LOGIC_MS`). A hold spends idle ticks
 * in front of the next entry, exactly as a longer run of recorded `kdo=0` no-ops would have:
 * it never skips, reorders or rewrites an action, so the recording is still played in full.
 *
 * **The one rule: a hold key must name an entry that does nothing.** That is an entry with
 * `kdo = 0` whose `akce` is neither `akce_restart` (30) nor `akce_load` (10). Those two are
 * the exceptions to "kdo=0 means no-op": `applyCapAction` tests `akce === restart` before it
 * tests `kdo` at all, so a `kdo=0` restart still rebuilds the room, and all three restart
 * runs in the recording are `kdo=0`. Keying a hold on a no-op entry cannot desync anything —
 * the fish are stationary, and every later `akce_go` names an absolute target cell, so
 * positions re-converge regardless. `test/showmodeHolds.test.ts` enforces this against the
 * real `help.cap` rather than leaving it to be remembered.
 *
 * Delaying a room rebuild is fine, and is sometimes the whole point: `[302, 10]` exists
 * precisely to push the recorded `akce_load` at 364 later, so help7 can finish describing
 * the F3 load before the F3 load kills it. What must not happen is keying the hold *on* one
 * of those entries, where it would sit inside the run rather than in front of it.
 *
 * The indices are chosen from a listing of the recording — every helptext, move, wait,
 * save, load and restart with its index. `npx tsx tools/dump-showmode.ts` prints it, reads
 * this table, and folds each hold into the row it extends, so the listing always shows what
 * the demo actually does. Regenerate it after changing anything here.
 */

/** Extra idle ticks to spend after consuming the `help.cap` entry at this index. */
export const SHOWMODE_HOLDS = new Map<number, number>([
  // idx 302-363 is a 62-tick pause between help7 — "Nyní začínáme znovu - můžeme však
  // nahrát uloženou pozici klávesou F3", 74 ticks — and the recorded `akce_load` at 364
  // that the line is announcing. The load rebuilds the room and kills every voice
  // (TRoom.Load → KillExcept(-999), URoom.pas:1905-1912), so the line describing F3 was
  // cut off by F3 with 13 of its 74 ticks still to run. +10 makes the pause 72 ticks.
  [302, 10],
  // idx 498-503 is a 6-tick pause. help10 — "Některé předměty mají takový tvar, že bych je
  // mohla zároveň držet i posouvat - ale to také nesmím" — starts at 485 and runs 75 ticks,
  // and the `move left` at 504 is the one that gets the little fish crushed. Six ticks is
  // 0.48 s, so she was flattened with most of her own warning still unsaid. +14 makes the
  // pause 20 ticks (1.6 s); measured with all three holds in place, the line's window grows
  // from 92 ticks to 105.
  [498, 14],
  // idx 743-764 is a 22-tick pause after help13 — "A já, na rozdíl od většího kamaráda,
  // nejen že nepohnu s ocelovými předměty, ale nesmím je ani držet", 85 ticks — begins at
  // 734, and before the nine-cell `move left` run at 765-773 that demonstrates it and
  // crushes her. +18 makes the pause 40 ticks (3.2 s).
  [743, 18],
]);
