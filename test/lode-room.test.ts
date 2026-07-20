/**
 * LODE room — the match loops forever (win → banter → restart).
 *
 * The gods' battleship game is ambient theatre with no end state: when one god sinks
 * all 7 of the opponent's ships (`lodi = 0`), the room's `stavhry` state machine
 * announces a winner ("b?-vyhral"), the two exchange "again?"/"alright" banter, then
 * after a pause one says "b1-zacinam" and a BRAND-NEW game starts (initLode, both
 * `lodi` reset to 7). This drives the room's Programky through that end-of-game
 * transition and asserts the full loop, mirroring URoom.pas LODE stavhry 2→3→0.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { LODE_ROOM } from '../src/rooms/lode.js';

// r_LODE_* item indices (URoom.pas:4537-4576): buh2=1, buh1=2, palka=7, hul=11,
// kriketak=12, malar=13, velkar=14, objekty=15, maska=16.
const BUH2 = 1;
const BUH1 = 2;
const BUH1_LODI = 4;
const BUH2_LODI = 4;
const ROOM_STAVHRY = 8;

function lodeScript(): { s: Script; spoken: string[] } {
  const item = (kind: 'static' | 'little' | 'big', x: number, y: number) => ({ kind, x, y });
  const room = makeRoom({
    w: 30,
    h: 24,
    items: [
      item('static', 3, 3), // 1 buh2
      item('static', 6, 3), // 2 buh1
      item('static', 1, 1), // 3 filler
      item('static', 1, 2), // 4 filler
      item('static', 1, 3), // 5 filler
      item('static', 1, 4), // 6 filler
      item('static', 23, 2), // 7 palka
      item('static', 1, 5), // 8 filler
      item('static', 1, 6), // 9 filler
      item('static', 1, 7), // 10 filler
      item('static', 20, 20), // 11 hul
      item('static', 26, 21), // 12 kriketak
      item('little', 12, 12), // 13 malar
      item('big', 15, 15), // 14 velkar
      item('static', 2, 20), // 15 objekty
      item('static', 4, 20), // 16 maska
    ],
  });
  const spoken: string[] = [];
  const s = new Script(
    room,
    (name) => {
      spoken.push(name);
      return 1; // 1-tick voices so the dialogue queue drains quickly
    },
    () => false,
    { talkNow: (name) => (spoken.push(name), 1) },
  );
  LODE_ROOM.init(s);
  return { s, spoken };
}

/** Advance the room one logic tick (Programky + dialogy), as the host loop does. */
function tick(s: Script, count: number): void {
  s.count = count;
  LODE_ROOM.prog!(s);
  s.dialogy(count);
}

describe('LODE room — end-of-game loops into a fresh match', () => {
  it('announces a winner, then restarts a new game (lodi reset to 7)', () => {
    const { s, spoken } = lodeScript();
    const room = s.room;

    // Silence the fish commentary so it can't interleave with the game dialogue.
    const rv = s.vars(0);
    rv[1] = 1; // room_uvod done
    rv[2] = -1; // room_costim done
    rv[3] = 1; // room_oholi done
    rv[4] = 1; // room_opalce done
    rv[5] = 1_000_000; // room_omicich far off

    // Stage a finished game: buh1 has sunk all of buh2's ships, ready to be detected.
    s.vars(BUH1)[BUH1_LODI] = 0;
    s.vars(BUH2)[BUH2_LODI] = 7;
    rv[ROOM_STAVHRY] = 2;

    let sawVyhral = false;
    let sawStav3 = false;
    let sawZacinam = false;
    let sawReset = false;

    for (let count = 1; count <= 2000 && !sawReset; count++) {
      const before = spoken.length;
      tick(s, count);
      for (const line of spoken.slice(before)) {
        if (line === 'b1-vyhral') sawVyhral = true;
        if (line === 'b1-zacinam') sawZacinam = true;
      }
      if (rv[ROOM_STAVHRY] === 3) sawStav3 = true;
      // A new game began: stavhry cycled back through 0 and reset the ship counts.
      if (sawZacinam && s.vars(BUH1)[BUH1_LODI] === 7 && s.vars(BUH2)[BUH2_LODI] === 7) {
        sawReset = true;
      }
    }

    expect(sawVyhral, 'the winner announced "b1-vyhral"').toBe(true);
    expect(sawStav3, 'the room entered the post-game state (stavhry=3)').toBe(true);
    expect(sawZacinam, 'buh1 announced the next game ("b1-zacinam")').toBe(true);
    expect(sawReset, 'a fresh game started (both lodi reset to 7)').toBe(true);
    // And the loop keeps going — after the reset the match is live again.
    expect(room.items[BUH1]!.vars[BUH1_LODI]).toBe(7);
  });

  it('detects a buh2 win symmetrically ("b2-vyhral")', () => {
    const { s, spoken } = lodeScript();
    const rv = s.vars(0);
    rv[1] = 1;
    rv[2] = -1;
    rv[3] = 1;
    rv[4] = 1;
    rv[5] = 1_000_000;
    s.vars(BUH2)[BUH2_LODI] = 0; // buh2 sank everything
    s.vars(BUH1)[BUH1_LODI] = 7;
    rv[ROOM_STAVHRY] = 2;

    let sawVyhral = false;
    for (let count = 1; count <= 1000 && !sawVyhral; count++) {
      const before = spoken.length;
      tick(s, count);
      if (spoken.slice(before).includes('b2-vyhral')) sawVyhral = true;
    }
    expect(sawVyhral).toBe(true);
  });
});
