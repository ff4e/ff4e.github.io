/**
 * ODPADKY ("Adventure with Pink Duckie", room 41) — a faithful port of
 * ODPADKY_InitProgramky / ODPADKY_Programky (URoom.pas:6316-6339, 14070-14129).
 *
 * A rubbish-dump dialogue room. Timed/positional remarks fire: spotting a snowman
 * (both fish facing left), a joke by the faucet (velkar = 2 next to kohoutek = 7),
 * and the rubber-duckie line. A shared `oanim` trigger sometimes queues a follow-up
 * "what's that object?" exchange that makes the big fish pull faces (`xichtit` →
 * random head frames 0..hl_max). No creature state machines.
 */
import type { RoomScript, Script } from '../core/script.js';

const HL_MAX = 10;

const R = {
  room: 0,
  room_osneh: 1,
  room_okach: 2,
  room_okoh: 3,
  room_oanim: 4,
  velkar: 2, // big fish
  velkar_xichtit: 1,
  kohoutek: 7,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  v[R.room_osneh] = 0;
  v[R.room_okach] = 0;
  v[R.room_okoh] = 0;
  v[R.room_oanim] = 0;
  s.vars(R.velkar, 1)[R.velkar_xichtit] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_oanim] === 1) {
      v[R.room_oanim] = 3;
      s.addm(s.random(50) + 20, 'odp-m-predmet');
      switch (s.random(4)) {
        case 0:
          s.addv(5, 'odp-v-pozadi');
          break;
        case 1:
          s.addv(5, 'odp-v-pohni');
          break;
        case 2:
        case 3:
          s.addv(5, 'odp-v-coja');
          s.addset((val, cur) => (cur.vars(R.velkar)[R.velkar_xichtit] = val), 1);
          s.adddel(s.random(20) + 15);
          s.addset((val, cur) => (cur.vars(R.velkar)[R.velkar_xichtit] = val), 0);
          s.addv(3, 'odp-v-nestacim');
          break;
      }
    } else if (
      v[R.room_osneh] === 0 &&
      !s.facingRight('big') &&
      !s.facingRight('little') &&
      s.random(1000) < 2
    ) {
      s.addv(5, 'odp-v-snehulak');
      s.addm(s.random(10), 'odp-m-blaznis');
      v[R.room_osneh] = 1;
      if (v[R.room_oanim] === 0 && s.random(100) < 60) v[R.room_oanim] = 1;
    } else if (
      v[R.room_okoh] === 0 &&
      Math.abs(s.xdist(R.kohoutek, R.velkar)) <= 1 &&
      s.random(1000) < 3
    ) {
      s.addm(10, 'odp-m-kohout');
      s.addv(10, 'odp-v-vtip');
      v[R.room_okoh] = 1;
    } else if (v[R.room_okach] === 0 && s.random(1000) < 1) {
      s.addv(100, 'odp-v-kachna');
      s.addm(5, 'odp-m-zda' + digit(s.random(2)));
      v[R.room_okach] = 1;
      if (v[R.room_oanim] === 0 && s.random(100) < 90) v[R.room_oanim] = 1;
    }
  }

  // ---- velkar: pull random faces while the "what's that?" exchange plays ----
  if (s.vars(R.velkar)[R.velkar_xichtit] === 1) s.setXicht('big', s.random(HL_MAX + 1));
  else s.setXicht('big', 0);
}

/**
 * Undo (a port addition) and the remarks. They all run on time, so an undo leaves them
 * where they are, pending lines included, and the big fish's faces with them. Before, the
 * rebuild dropped the queue: a point banked while the big fish pulled faces after
 * `odp-v-coja` kept `xichtit` = 1 without the `set` that ends it, so it pulled faces for
 * the rest of the visit.
 *
 * With a fish dead, the fish's own lines (the death lines) are not carried. A load has no
 * queue, so it stops the faces, as the `set` would have.
 */
function restorePresentation(s: Script, previous?: Script): void {
  if (!previous) {
    s.vars(R.velkar)[R.velkar_xichtit] = 0;
    return;
  }
  s.item(R.room).vars = [...previous.item(R.room).vars];
  s.vars(R.velkar)[R.velkar_xichtit] = previous.vars(R.velkar)[R.velkar_xichtit]!;
  const dead = previous.room.anyFishDead ? [1, 2] : [];
  for (const p of dead) s.ksnd(p);
  s.adoptDialogue(previous, dead);
}

export const ODPADKY: RoomScript = { name: 'ODPADKY', init, prog, restorePresentation, carriedSounds: [1, 2] };
