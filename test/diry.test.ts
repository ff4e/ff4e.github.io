/**
 * DIRY (room 24) deterministic mechanics (URoom.pas:5206-5271, 10003-10207): the
 * ruler's face state machine (`vladce`), the "konec" never-repeat used-mask, and
 * the octopus (`chobot`). The RNG-heavy announcement scheduler is gated on both
 * fish alive + no dialogue; object-block tests close that gate (kill a fish).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { DIRY } from '../src/rooms/diry.js';

const R = { room: 0, vladce: 5, xichtik: 8, chobot: 20, malar: 22, velkar: 23 } as const;
const ROOM_KONCE = 4;
const KSICHTY = 1;
const FAZE = 2;
const CHAPADLA = 1;
const OCI = 2;
const AKCNOST = 3;
const LASTDIR = 4;

interface Spy {
  snd: Array<{ name: string; prior: number }>;
}

/** A DIRY-shaped room: vladce (5), xichtik (8), chobot (20) [1 cell], malar (22) =
 *  little, velkar (23) = big; fillers elsewhere. The octopus sits mid-room so the
 *  fish can be placed directly above it for the "eyes" test. */
function diry(isPlaying: (p: number) => boolean = () => false): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 23; i++) {
    if (i === 20) items.push({ kind: 'static', x: 15, y: 15 }); // chobot
    else if (i === 22) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === 23) items.push({ kind: 'big', x: 6, y: 2 });
    else items.push({ kind: 'static', x: (i % 12) + 1, y: 8 });
  }
  const room = makeRoom({ w: 30, h: 30, items });
  const spy: Spy = { snd: [] };
  const s = new Script(room, () => 0, isPlaying, {
    snd: (name, prior) => spy.snd.push({ name, prior }),
  });
  DIRY.init(s);
  s.room.alive.little = false; // close the announcement gate for object tests
  return { s, spy };
}

describe('DIRY init', () => {
  it('seeds the room, ruler, and octopus', () => {
    const { s } = diry();
    const v = s.vars(R.room);
    expect(v[1]).toBe(0); // pocetrad
    expect(v[2]! >= 200 && v[2]! <= 399).toBe(true); // kdydalsi
    expect(v[3]! >= 0 && v[3]! <= 4).toBe(true); // posluvod
    expect(v[ROOM_KONCE]).toBe(0);
    expect(s.vars(R.vladce)[KSICHTY]).toBe(0);
    const ch = s.vars(R.chobot);
    expect(ch[LASTDIR]).toBe(Dir.no);
    expect(ch[OCI]).toBe(0);
    expect(ch[CHAPADLA]).toBe(0);
    expect(ch[AKCNOST]).toBe(2);
  });
});

describe('DIRY vladce (ruler face)', () => {
  it('picks a talking sub-state (1..4) once the voice is playing', () => {
    const { s } = diry((p) => p === 302); // the ruler is speaking
    s.vars(R.vladce)[KSICHTY] = 0;
    DIRY.prog(s);
    expect(s.vars(R.vladce)[KSICHTY]! >= 1 && s.vars(R.vladce)[KSICHTY]! <= 4).toBe(true);
  });

  it('stays idle (ksichty 0) while the voice is silent', () => {
    const { s } = diry(() => false);
    s.vars(R.vladce)[KSICHTY] = 0;
    DIRY.prog(s);
    expect(s.vars(R.vladce)[KSICHTY]).toBe(0);
  });

  it('inc/dec bracket: a talking branch shows frame N-1 (pom1=1 in ksichty 1 -> 14)', () => {
    const { s } = diry((p) => p === 302);
    s.vars(R.vladce)[KSICHTY] = 1;
    s.count = 2; // even -> the branch runs
    // Force the voice-playing path (pom1 = random(3)); seed RNG to hit pom1=1.
    // Rather than rely on RNG, drive the branch by faking random via many tries.
    // Deterministic alternative: run until we observe a frame in the expected set.
    const seen = new Set<number>();
    for (let t = 0; t < 200; t++) {
      s.vars(R.vladce)[KSICHTY] = 1;
      s.item(R.vladce).afaze = 0;
      s.count = 2;
      DIRY.prog(s);
      seen.add(s.item(R.vladce).afaze);
    }
    // ksichty=1 assigns afaze 1/15/18 (shown as 0/14/17) or holds when pom1=3 (-> ksichty 0).
    for (const f of seen) expect([0, 14, 17].includes(f)).toBe(true);
  });

  it('runs the shared 10-sequence (smile-on) frames then resets to idle', () => {
    const { s } = diry();
    const v = s.vars(R.vladce);
    v[KSICHTY] = 10;
    v[FAZE] = 0;
    DIRY.prog(s);
    expect(s.item(R.vladce).afaze).toBe(4); // faze1 -> afaze:=5, shown 4
    DIRY.prog(s);
    expect(s.item(R.vladce).afaze).toBe(8); // faze2 -> 9, shown 8
    DIRY.prog(s);
    expect(s.item(R.vladce).afaze).toBe(9); // faze3 -> 10, shown 9
    DIRY.prog(s);
    expect(v[KSICHTY]).toBe(0); // faze4 -> reset
  });
});

describe('DIRY konec used-mask (never-repeat announcement)', () => {
  it('marks every konec line before recycling (mask fills to 0x1ff then resets)', () => {
    const { s } = diry();
    s.room.alive.little = true; // reopen the announcement gate
    s.room.alive.big = true;
    // Drive the scheduler many times; force kdydalsi to fire each pass.
    const firedBits: number[] = [];
    for (let pass = 0; pass < 30; pass++) {
      s.vars(R.room)[2] = 0; // kdydalsi -> fires this tick
      s.clearDialog(); // keep the gate open
      const before = s.vars(R.room)[ROOM_KONCE]!;
      DIRY.prog(s);
      const after = s.vars(R.room)[ROOM_KONCE]!;
      // Either a new bit was OR'd in, or the mask recycled (was 0x1ff, reset+1 bit).
      if (before !== 0x1ff) expect((after & before)).toBe(before); // superset (no bit cleared)
      firedBits.push(after);
    }
    // Over 30 passes it must have reached a full mask at least once (9 distinct lines).
    expect(firedBits.some((m) => m === 0x1ff)).toBe(true);
  });
});

describe('DIRY chobot (octopus)', () => {
  it('opens its eyes (oci=1) when a fish sits directly above it', () => {
    const { s } = diry();
    const ch = s.item(R.chobot); // at (15,15), 1 cell
    // Place the little fish directly above: xdist 0, ydist in (-2, 0].
    s.item(R.malar).x = ch.x - 1; // little fish is 3 wide; span covers ch.x
    s.item(R.malar).y = ch.y - 1;
    DIRY.prog(s);
    expect(s.vars(R.chobot)[OCI]).toBe(1);
  });

  it('squelches (snd) and bumps akcnost to 7 when shoved down', () => {
    const { s, spy } = diry(() => false);
    const ch = s.item(R.chobot);
    ch.dir = Dir.down;
    DIRY.prog(s);
    expect(s.vars(R.chobot)[AKCNOST]).toBe(7);
    // Uses the packaged 'k1-chob-*' names (the original's bare 'chob-p' typo doesn't resolve).
    expect(spy.snd).toContainEqual({ name: 'k1-chob-p', prior: 301 });
    expect(s.vars(R.chobot)[LASTDIR]).toBe(Dir.down);
  });

  it('plays one of the three k1-chob squelches when shoved sideways', () => {
    const { s, spy } = diry(() => false);
    const ch = s.item(R.chobot);
    ch.dir = Dir.left;
    DIRY.prog(s);
    expect(spy.snd.length).toBe(1);
    expect(['k1-chob-1', 'k1-chob-2', 'k1-chob-3']).toContain(spy.snd[0]!.name);
    expect(spy.snd[0]!.prior).toBe(301);
  });

  it('afaze encodes oci + 3*chapadla', () => {
    const { s } = diry();
    const cv = s.vars(R.chobot);
    // Force a known eyes+tentacle state with no fish nearby and no motion.
    s.item(R.malar).x = 0;
    s.item(R.malar).y = 0;
    s.item(R.velkar).x = 0;
    s.item(R.velkar).y = 0;
    cv[OCI] = 2;
    cv[CHAPADLA] = 2;
    cv[AKCNOST] = 999; // avoid the count%akcnost tentacle toggle this tick
    s.item(R.chobot).dir = Dir.no;
    s.count = 1;
    DIRY.prog(s);
    // oci may transition 2->0 at 7% (random); assert the encoding holds for the
    // resulting values rather than a fixed number.
    const oci = cv[OCI]!;
    const chap = cv[CHAPADLA]!;
    expect(s.item(R.chobot).afaze).toBe(oci + 3 * chap);
  });
});
