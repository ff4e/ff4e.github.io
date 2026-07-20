/**
 * TRUHLA ("Giant's Chest", room 61) — a faithful port of TRUHLA_InitProgramky /
 * TRUHLA_Programky (URoom.pas:7141-7202, 16942-17056).
 *
 * A treasure chest overflowing with loot: 10 twinkling gems (items 1..10, globpole
 * timers), a flickering ring (prsten), and two lightning-sparking crowns (koruna1/2).
 * The intro banter (whether the fish "found" the chest) is chosen once in init; during
 * play the room rotates ambient chatter via `posl` (never the same line twice).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_posl: 1,
  drahokamy: 1,
  prsten: 21,
  koruna1: 23,
  koruna1_blesk: 1,
  koruna2: 24,
  koruna2_blesk: 1,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 1);
  v[R.room_posl] = 2;
  let pom1 = 0;
  switch (s.random(s.pokus + 1)) {
    case 0:
    case 2:
    case 4:
    case 10:
    case 20:
    case 30:
    case 50:
      s.addv(s.random(30), 'tru-v-nasly');
      s.addm(7, 'tru-m-co');
      if (s.random(2) === 1) s.addv(10 + s.random(6), 'tru-v-poklad');
      else s.addv(10 + s.random(6), 'tru-v-gral');
      if (s.random(5) === 1) s.addm(7, 'tru-m-zrada');
      pom1 = 1;
      break;
    case 1:
    case 3:
    case 5:
    case 11:
    case 43:
      s.addv(s.random(30), 'tru-v-vkupe');
      if (s.random(3) > 0) s.addm(8, 'tru-m-zrada');
      pom1 = 1;
      break;
  }
  if (pom1 === 1) {
    s.addm(10 + s.random(10), 'tru-m-oznamit');
    if (s.pokus < 3 || s.random(6) > 0) {
      s.addv(5 + s.random(5), 'tru-v-stacit');
      s.addm(7 + s.random(6), 'tru-m-zpochybnit');
    }
    s.addv(8 + s.random(9), 'tru-v-nejspis');
    if (s.random(2) === 1) s.addm(9, 'tru-m-nejistota');
  }

  for (let i = 1; i <= 10; i++) s.globpole[i] = -s.random(100);
  s.item(R.prsten).afaze = 3;
  s.vars(R.koruna1, 1)[R.koruna1_blesk] = 0;
  s.vars(R.koruna2, 1)[R.koruna2_blesk] = 0;
}

/** A gem/crown lightning FSM shared by koruna1 and koruna2. */
function korunaProg(s: Script, idx: number, bleskI: number): void {
  const it = s.item(idx);
  const v = s.vars(idx);
  switch (v[bleskI]) {
    case 0:
      switch (s.random(20)) {
        case 1:
          v[bleskI] = 1;
          it.afaze = 1;
          break;
        case 2:
          v[bleskI] = 1;
          it.afaze = 4;
          break;
      }
      break;
    case 1:
      switch (it.afaze) {
        case 1: it.afaze = 2; break;
        case 2: it.afaze = 3; break;
        case 3: v[bleskI] = 2; break;
        case 4: it.afaze = 5; break;
        case 5: v[bleskI] = 2; break;
      }
      break;
    case 2:
      switch (it.afaze) {
        case 1:
        case 4: it.afaze = 0; break;
        case 0: v[bleskI] = 0; break;
        case 2: it.afaze = 1; break;
        case 3: it.afaze = 2; break;
        case 5: it.afaze = 4; break;
      }
      break;
  }
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    let pom1 = v[R.room_posl]!;
    while (pom1 === v[R.room_posl]) pom1 = s.random(4);
    v[R.room_posl] = pom1;
    switch (pom1) {
      case 0:
        s.addm(500 + s.random(1000), 'tru-m-truhla' + digit(s.random(2)));
        s.addv(10 + s.random(14), 'tru-v-truhla' + digit(s.random(2)));
        break;
      case 1:
        s.addm(500 + s.random(1000), 'tru-m-vzit' + digit(s.random(3)));
        s.addv(10, 'tru-v-vzit' + digit(s.random(3)));
        break;
      case 2:
        s.addv(500 + s.random(1000), 'tru-v-zrak');
        break;
      case 3:
        s.addm(500 + s.random(1000), 'tru-m-trpyt');
        break;
    }
  }

  // Twinkling gems 1..10.
  for (let i = 1; i <= 10; i++) {
    s.globpole[i]!++;
    switch (s.globpole[i]) {
      case 1:
      case 2:
      case 3:
        s.item(i).afaze++;
        break;
      case 4:
      case 5:
      case 6:
        s.item(i).afaze--;
        break;
      case 7:
        s.globpole[i] = -s.random(100) - 10;
        break;
    }
  }

  // The ring's random glint FSM.
  {
    const it = s.item(R.prsten);
    switch (it.afaze) {
      case 0: it.afaze = s.random(5) < 2 ? 3 : 1; break;
      case 1: it.afaze = s.random(4) < 2 ? 0 : 2; break;
      case 2: if (s.random(3) < 2) it.afaze = 1; break;
      case 4: it.afaze = s.random(5) < 2 ? 3 : 5; break;
      case 5: if (s.random(4) < 2) it.afaze = 4; break;
      case 3:
        switch (s.random(20)) {
          case 1: it.afaze = 0; break;
          case 2: it.afaze = 4; break;
        }
        break;
    }
  }

  korunaProg(s, R.koruna1, R.koruna1_blesk);
  korunaProg(s, R.koruna2, R.koruna2_blesk);
}

export const TRUHLA: RoomScript = { name: 'TRUHLA', init, prog };
