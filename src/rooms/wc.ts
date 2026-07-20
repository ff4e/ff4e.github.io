/**
 * WC ("Closed in the Closet") room script — a faithful port of WC_InitProgramky /
 * WC_Programky (URoom.pas:7380-7404, 17882-17934).
 *
 * A light dialogue room: an intro remark, then a delayed second conversation
 * (picked at load), plus a "climb in" hint when the little fish gets high enough.
 * Constants are the generated r_WC_* values (URoom.pas:4336-4341); the little
 * fish is item 5.
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_druha: 2,
  room_timerdruhe: 3,
  room_omise: 4,
  malar: 5, // little fish
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  if (s.pokus === 1 || s.random(100) < 50) {
    v[R.room_uvod] = 1;
    v[R.room_druha] = s.random(2) + 2; // 2 or 3
  } else {
    v[R.room_uvod] = 2;
    v[R.room_druha] = s.random(2) * 2 + 1; // 1 or 3
  }
  v[R.room_omise] = 0;
  v[R.room_timerdruhe] = s.random(1000) + 500;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_timerdruhe]! > 0) v[R.room_timerdruhe]!--;

    let pom1 = 0;
    if (v[R.room_uvod]! > 0) {
      pom1 = v[R.room_uvod]!;
      v[R.room_uvod] = 0;
      if (s.pokus !== 1) s.adddel(s.random(500) + 20);
      else s.adddel(s.random(20) + 20);
    } else if (v[R.room_timerdruhe] === 0) {
      pom1 = v[R.room_druha]!;
      v[R.room_timerdruhe] = -1;
      s.adddel(30);
    } else if (v[R.room_omise] === 0 && s.item(R.malar).y >= 19) {
      v[R.room_omise] = 1;
      s.addm(10 + s.random(30), 'wc-m-vlezt');
    }

    if (pom1 > 0) {
      switch (pom1) {
        case 1:
          s.addm(0, 'wc-m-prasecinky');
          s.addv(s.random(10), 'wc-v-hygiena');
          break;
        case 2:
          s.addm(0, 'wc-m-hrbitov');
          s.addv(s.random(5), 'wc-v-coze');
          s.addm(s.random(10) + 5, 'wc-m-nevis');
          break;
        case 3:
          s.addv(0, 'wc-v-oblibene');
          s.addm(0, 'wc-m-coze');
          s.addv(5, 'wc-v-neznas');
          s.addm(5, 'wc-m-sochar');
          s.addv(10, 'wc-v-zmatek');
          break;
      }
    }
  }
}

export const WC: RoomScript = { name: 'WC', init, prog };
