/**
 * NCP (room 32) deterministic creature machines (URoom.pas:4942-5006, 8958-9275):
 * the snail's poke-out sequence (`snek_stav`), the seahorse's neigh on a downward
 * shove + its blink cadence, and the sea-anemone's composed afaze (noha*4+kvet).
 * The RNG dialogue is gated on both fish alive + no dialogue; these object tests
 * drive the creatures directly.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { NCP } from '../src/rooms/ncp.js';

const R = { sasanka: 8, snek: 10, malar: 21, velkar: 22, konik: 23 } as const;
const SNEK_STAV = 1;
const SASANKA_NOHA = 3;
const SASANKA_KVET = 4;
const KONIK_STAV = 1;

interface Spy {
  snd: Array<{ name: string; prior: number }>;
}

/** An NCP-shaped room (items 1..24): malar (21) little, velkar (22) big, the rest
 *  single-cell static fillers spread out so no fish sits on a creature by default. */
function ncp(): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 24; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 30, y: 2 });
    else items.push({ kind: 'static', x: (i % 10) * 3 + 1, y: 20 });
  }
  const room = makeRoom({ w: 40, h: 40, items });
  const spy: Spy = { snd: [] };
  const s = new Script(room, () => 0, () => false, {
    snd: (name, prior) => spy.snd.push({ name, prior }),
  });
  NCP.init(s);
  s.room.alive.little = false; // close the dialogue gate
  return { s, spy };
}

describe('NCP snail (snek)', () => {
  it('pokes out when nudged then advances its afaze sequence', () => {
    const { s } = ncp();
    const sn = s.vars(R.snek);
    const it = s.item(R.snek);
    expect(sn[SNEK_STAV]).toBe(0);

    it.dir = Dir.left; // nudged
    NCP.prog(s);
    expect(sn[SNEK_STAV]).toBe(1);

    it.dir = Dir.no;
    NCP.prog(s); // stav 1 → 2, shows poke frame
    expect(it.afaze).toBe(3);
    expect(sn[SNEK_STAV]).toBe(2);

    NCP.prog(s); // stav 2 → 3
    expect(it.afaze).toBe(1);
    expect(sn[SNEK_STAV]).toBe(3);
  });
});

describe('NCP seahorse (konik)', () => {
  it('neighs and freezes (stav 2, afaze 3) when shoved downward', () => {
    const { s, spy } = ncp();
    s.item(R.konik).dir = Dir.down;
    NCP.prog(s);
    expect(spy.snd.some((c) => c.name === 'ncp-x-ihaha')).toBe(true);
    expect(s.vars(R.konik)[KONIK_STAV]).toBe(2);
    expect(s.item(R.konik).afaze).toBe(3);
  });
});

describe('NCP sea-anemone (sasanka)', () => {
  it('composes its afaze as noha*4 + kvet', () => {
    const { s } = ncp();
    NCP.prog(s);
    const sa = s.vars(R.sasanka);
    expect(s.item(R.sasanka).afaze).toBe(sa[SASANKA_NOHA]! * 4 + sa[SASANKA_KVET]!);
  });
});
