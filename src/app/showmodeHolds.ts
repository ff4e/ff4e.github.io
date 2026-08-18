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
 * Two rules for adding one:
 *
 *   - **Hold on a `kdo=0` wait.** Extending a pause the demo already takes cannot desync the
 *     replay: the fish are stationary, and every later `akce_go` names an absolute target
 *     cell, so positions re-converge regardless.
 *   - **Never hold in front of a recorded `akce_restart` or `akce_load` run.** Those rebuild
 *     the room and re-sync the fish; delaying one changes what the player sees on screen
 *     rather than merely when they see it.
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
  // pause 20 ticks (1.6 s); measured, the line's window grows from 92 ticks to 106.
  [498, 14],
  // idx 743-764 is a 22-tick pause after help13 — "A já, na rozdíl od většího kamaráda,
  // nejen že nepohnu s ocelovými předměty, ale nesmím je ani držet", 85 ticks — begins at
  // 734, and before the nine-cell `move left` run at 765-773 that demonstrates it and
  // crushes her. +18 makes the pause 40 ticks (3.2 s).
  [743, 18],
]);
