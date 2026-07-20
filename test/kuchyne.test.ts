/**
 * KUCHYNE (room 48) mechanics (URoom.pas:8792-8846, 23210-23419): the big-fish
 * position tracking (`pryc` when off, `dole` when low) and the `stoji` standstill reset.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { KUCHYNE } from '../src/rooms/kuchyne.js';

const R = { velkar: 1, malar: 2 } as const;
const VELKAR_PRYC = 1;
const VELKAR_DOLE = 2;
const ROOM_STOJI = 11;

function kuchyne(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 12; i++) {
    if (i === R.velkar) items.push({ kind: 'big', x: 34, y: 8 });
    else if (i === R.malar) items.push({ kind: 'little', x: 5, y: 5 });
    else items.push({ kind: 'static', x: i, y: 20 });
  }
  const s = new Script(makeRoom({ w: 42, h: 30, items }), () => 0);
  KUCHYNE.init(s);
  s.room.alive.little = false; // close the dialogue gate
  return s;
}

describe('KUCHYNE big-fish tracking', () => {
  it('flags pryc when the big fish is off its post (x<32)', () => {
    const s = kuchyne();
    s.item(R.velkar).x = 10; // < 32
    KUCHYNE.prog(s);
    expect(s.vars(R.velkar)[VELKAR_PRYC]).toBe(1);
  });

  it('flags dole when the big fish is low-right (x>15 && y>20)', () => {
    const s = kuchyne();
    s.item(R.velkar).x = 34; // stays on post (x>=32) so pryc doesn't fire
    s.item(R.velkar).y = 8;
    KUCHYNE.prog(s);
    expect(s.vars(R.velkar)[VELKAR_DOLE]).toBe(0);
    s.item(R.velkar).x = 20;
    s.item(R.velkar).y = 25;
    KUCHYNE.prog(s);
    expect(s.vars(R.velkar)[VELKAR_DOLE]).toBe(1);
  });

  it('resets the standstill counter when a fish moves', () => {
    const s = kuchyne();
    s.vars(0)[ROOM_STOJI] = 500;
    s.item(R.malar).dir = Dir.left;
    KUCHYNE.prog(s);
    expect(s.vars(0)[ROOM_STOJI]).toBe(0);
  });
});
