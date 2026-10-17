/**
 * Which rooms does an undo strand? A scan, not a gate: it runs only with `FF_UNDO_SCAN`
 * set (`1` for every room with a solution, or a comma list of room names), e.g.
 *
 *     FF_UNDO_SCAN=1 npx vitest run test/undo-stuck-scan.test.ts
 *
 * An undo rebuilds the room, re-runs `init`, drops the dialogue queue and restores the
 * target point's script Vars. A room whose Vars at that point were waiting for a queued
 * `addset` (or an `addd` callback) to move them on is left waiting for ever, unless the
 * room carries its queue (`Script.adoptDialogue`).
 *
 * Pass 1 plays the room's recorded solution through the real undo path
 * (`undoRoomHarness.ts`) with every queued callback wrapped, noting which callbacks are
 * pending at each banked undo point — queued, or the end-of-line call of the line being
 * spoken — and what each one writes when it fires. Pass 2, for each distinct pending
 * callback and phase, replays to the first point it was pending at, plays the next move,
 * undoes onto the point, idles, and then plays out the rest of the solution. A write the
 * room never makes again is reported in `out/undo-stuck-scan/`. `firedBeforeUndo` marks a
 * callback that already ran during the next move: in a room that carries its queue that is
 * not a strand. Whether a finding matters is a reading of the room's script; this only
 * finds candidates, and it cannot see a state the solution never reaches, nor the middle
 * of a sequence it first met at the start.
 *
 * Options: `FF_TEST_SEED`, `FF_UNDO_SCAN_WAIT` (ticks to sit still after each move, so
 * idle-triggered sequences get a chance to start), `FF_UNDO_SCAN_IDLE` (ticks after the
 * undo, default 3000), `FF_UNDO_SCAN_PER_ROOM` (signatures per room, default 40),
 * `FF_UNDO_SCAN_SKIP` (rooms to leave out: LODE's endless match exhausts memory with a
 * wait), and `FF_UNDO_SCAN_NOADOPT` (disable `adoptDialogue`, to see the scan find the
 * strands the carrying rooms fixed).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as game from '../src/app/gameState.js';
import { undoMove } from '../src/app/undo.js';
import { Script } from '../src/core/script.js';
import { decodeMoves } from '../src/core/solutionMoves.js';
import { ROOMS } from '../src/data/roomTable.js';
import { roomScript } from '../src/rooms/index.js';
import { roomHarness } from './undoRoomHarness.js';
import { seedRandom } from './rng.js';

vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));
vi.mock('../src/app/framePacing.js', () => ({ roomLoading: false }));
vi.mock('../src/app/phoneViewport.js', () => ({ continuePhoneRoom: vi.fn() }));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => false }));
vi.mock('../src/app/solveMode.js', () => ({ inSolvemode: () => false }));
vi.mock('../src/platform/haptics.js', () => ({ hapticBlocked: vi.fn() }));

const SCAN = process.env.FF_UNDO_SCAN ?? '';
const IDLE = Number(process.env.FF_UNDO_SCAN_IDLE ?? 3000);
const PER_ROOM = Number(process.env.FF_UNDO_SCAN_PER_ROOM ?? 40);
/** Ticks to sit still after each move, so idle-triggered callbacks get a chance to queue. */
const WAIT = Number(process.env.FF_UNDO_SCAN_WAIT ?? 0);
const OUT = join(process.cwd(), 'out', 'undo-stuck-scan', `seed${process.env.FF_TEST_SEED ?? 1}-wait${WAIT}`);

type SetFn = (val: number, s: Script) => void;
interface Entry { delay: number; zvuk: string; prior: number; promSet?: SetFn }
interface Internals { queue: Entry[]; aktdialzvuk: number; lastprom: SetFn | undefined }
interface Tag { id: number; src: string; zvuk: string; value: number }
type State = Map<string, number | string>;

// ---- callback instrumentation -------------------------------------------------------
const tags = new WeakMap<SetFn, Tag>();
let nextId = 0;
let onFire: (tag: Tag, writes: [string, number | string][]) => void = () => {};

function capture(s: Script): State {
  const m: State = new Map();
  s.room.items.forEach((it, i) => {
    it.vars.forEach((v, k) => m.set(`v${i}.${k}`, v));
    m.set(`anim${i}`, it.anim);
  });
  s.roompole.forEach((v, k) => m.set(`r${k}`, v));
  s.globpole.forEach((v, k) => m.set(`g${k}`, v));
  m.set('zvykacka', s.zvykacka ? 1 : 0);
  m.set('natvrdo', s.natvrdo);
  m.set('padalod', s.padalod);
  m.set('gspec', s.room.gspec);
  return m;
}
function read(s: Script, slot: string): number | string {
  let m: RegExpMatchArray | null;
  if ((m = slot.match(/^v(\d+)\.(\d+)$/))) return s.room.items[+m[1]!]?.vars[+m[2]!] ?? 0;
  if ((m = slot.match(/^anim(\d+)$/))) return s.room.items[+m[1]!]?.anim ?? '';
  if ((m = slot.match(/^r(\d+)$/))) return s.roompole[+m[1]!] ?? 0;
  if ((m = slot.match(/^g(\d+)$/))) return s.globpole[+m[1]!] ?? 0;
  if (slot === 'zvykacka') return s.zvykacka ? 1 : 0;
  if (slot === 'natvrdo') return s.natvrdo;
  if (slot === 'padalod') return s.padalod;
  if (slot === 'gspec') return s.room.gspec;
  throw new Error(slot);
}

const addd = Script.prototype.addd;
if (SCAN) Script.prototype.addd = function (this: Script, delay: number, zvuk: string, prior: number, promSet?: SetFn): void {
  if (!promSet) return addd.call(this, delay, zvuk, prior);
  const tag: Tag = { id: nextId++, src: promSet.toString().replace(/\s+/g, ' ').slice(0, 160), zvuk, value: prior };
  const wrapped: SetFn = (val, sc) => {
    const before = capture(sc);
    promSet(val, sc);
    const after = capture(sc);
    const writes: [string, number | string][] = [];
    for (const [k, v] of after) if (before.get(k) !== v) writes.push([k, v]);
    onFire(tag, writes);
  };
  tags.set(wrapped, tag);
  return addd.call(this, delay, zvuk, prior, wrapped);
};
if (SCAN && process.env.FF_UNDO_SCAN_NOADOPT) Script.prototype.adoptDialogue = () => {};

/** Callbacks still to run: queued ones, and the end-of-line call of the line being spoken.
 *  The phase is part of what is tested — a point banked mid-line restores the speaker's
 *  "talking" Var with nothing left to clear it. */
function pending(s: Script): { tag: Tag; speaking: boolean }[] {
  const q = s as unknown as Internals;
  const out = new Map<Tag, boolean>();
  if (q.aktdialzvuk > 0 && q.aktdialzvuk < 10000 && q.lastprom) {
    const t = tags.get(q.lastprom);
    if (t) out.set(t, true);
  }
  for (const d of q.queue) {
    const t = d.promSet ? tags.get(d.promSet) : undefined;
    if (t && !out.has(t)) out.set(t, false);
  }
  return [...out].map(([tag, speaking]) => ({ tag, speaking }));
}

// ---- a solution driver over the harness (mirrors solutionsHarness's tick loop) ------
function drive(jmeno: string, label: string) {
  seedRandom(label);
  nextId = 0;
  const h = roomHarness(jmeno, () => 25);
  const steps = decodeMoves(roomScript(jmeno)!.solution!);
  let mi = 0;
  let banks = game.undoHistory.length;
  let banked = false;
  let wait = 0;
  const step = (): void => {
    const idleAtStart = game.engine!.phase === 'idle';
    h.tick();
    banked = game.undoHistory.length > banks;
    banks = game.undoHistory.length;
    if (banked) wait = WAIT;
    const room = game.room!;
    if (game.engine!.won || room.won || room.anyFishDead) return;
    if (game.engine!.phase !== 'idle' || !idleAtStart || banked) return;
    if (wait > 0 && wait-- > 0) return;
    if (mi >= steps.length) return;
    const st = steps[mi]!;
    game.engine!.active = st.which;
    room.hracNespi();
    if (game.engine!.press(st.which, st.dir) === 'busy') return;
    mi++;
  };
  const over = () => game.engine!.won || game.room!.won || game.room!.anyFishDead;
  return {
    h, steps, step, over,
    get mi() { return mi; },
    set mi(v: number) { mi = v; },
    get banked() { return banked; },
    resync() { banks = game.undoHistory.length; },
  };
}

type Value = number | string;
interface Candidate { sig: string; tag: Tag; move: number; bankTick: number; writes: [string, Value][]; firedAfter: number }
interface Finding {
  sig: string;
  phase: string;
  src: string;
  zvuk: string;
  value: number;
  move: number;
  firedAfterTicks: number;
  undo: boolean;
  landed: boolean;
  firedBeforeUndo: boolean;
  atUndo: Record<string, Value>;
  stuck: { slot: string; want: Value; atUndo: Value; final: Value }[];
  wonControl: boolean;
  wonAfterUndo: boolean;
  linesControl: number;
  linesAfterUndo: number;
}
interface RoomResult { room: string; moves: number; won: boolean; candidates: number; findings: Finding[] }

function scanRoom(jmeno: string): RoomResult {
  const label = `undo-stuck-scan ${jmeno}`;
  // Pass 1: which callbacks are pending at which points, and what they write.
  const fired = new Map<number, { tick: number; writes: [string, number | string][] }[]>();
  let tick = 0;
  onFire = (tag, writes) => {
    const l = fired.get(tag.id) ?? [];
    l.push({ tick, writes });
    fired.set(tag.id, l);
  };
  const d = drive(jmeno, label);
  const seen: { tag: Tag; speaking: boolean; move: number; tick: number }[] = [];
  const seenIds = new Set<string>();
  const guard = d.steps.length * (80 + WAIT) + 20_000;
  for (; tick < guard && !d.over(); tick++) {
    d.step();
    if (d.banked && d.mi < d.steps.length)
      for (const { tag: t, speaking } of pending(d.h.s())) {
        const key = `${t.id}${speaking}`;
        if (!seenIds.has(key)) { seenIds.add(key); seen.push({ tag: t, speaking, move: d.mi, tick }); }
      }
    if (d.mi >= d.steps.length && game.engine!.phase === 'idle' && d.h.s().noDialog()) break;
  }
  for (let i = 0; i < 300 && !d.over(); i++, tick++) d.step();
  const won = game.engine!.won || game.room!.won;
  const linesControl = d.h.mix.started.length;
  const bySig = new Map<string, Candidate>();
  for (const { tag, speaking, move, tick: at } of seen) {
    const sig = `${speaking ? 'speaking' : 'queued'}|${tag.zvuk}|${tag.value}|${tag.src}`;
    if (bySig.has(sig)) continue;
    const after = (fired.get(tag.id) ?? []).filter((f) => f.tick >= at);
    const writes = after.flatMap((f) => f.writes);
    if (writes.length === 0) continue;
    bySig.set(sig, { sig, tag, move, bankTick: at, writes, firedAfter: after[0]!.tick - at });
  }
  const candidates = [...bySig.values()].slice(0, PER_ROOM);
  onFire = () => {};

  // Pass 2: undo onto each point, idle, play on; which writes never happen again?
  const findings: Finding[] = [];
  for (const c of candidates) {
    const e = drive(jmeno, label);
    let t = 0;
    for (; t <= c.bankTick && !e.over(); t++) e.step();
    const here = pending(e.h.s()).map((x) => x.tag.id);
    expect(here, `${jmeno}: replay to move ${c.move} is not deterministic`).toContain(c.tag.id);
    const rec = game.engine!.srecord;
    // A callback that already ran during the next move is not one the undo dropped; a room
    // that carries its queue (`adoptDialogue`) keeps what it did.
    let firedBeforeUndo = false;
    onFire = (tag) => { if (tag.id === c.tag.id) firedBeforeUndo = true; };
    // the next move, settled
    for (let i = 0; i < 2000 + WAIT * 2 && !e.over() && !(e.banked && game.engine!.srecord !== rec); i++) e.step();
    const undone = !e.over() && undoMove();
    // Only an undo that lands on the point the callback was pending at tests it; a blocked
    // next move banks nothing new, and the undo then goes one point further back.
    const landed = undone && game.engine!.srecord === rec;
    onFire = () => {};
    e.resync();
    e.mi = c.move;
    const want = new Map<string, number | string>();
    for (const [k, v] of c.writes) if (!want.has(k)) want.set(k, v);
    const atUndo = new Map([...want.keys()].map((k) => [k, read(e.h.s(), k)]));
    const reached = new Set<string>();
    const check = () => {
      for (const [k, v] of want) if (!reached.has(k) && read(e.h.s(), k) === v) reached.add(k);
    };
    check();
    const start = e.h.mix.started.length;
    for (let i = 0; i < IDLE; i++) { e.h.tick(); e.resync(); check(); }
    const guard2 = (e.steps.length - c.move) * (80 + WAIT) + 20_000;
    for (let i = 0; i < guard2 && !e.over(); i++) {
      e.step(); check();
      if (e.mi >= e.steps.length && game.engine!.phase === 'idle' && e.h.s().noDialog()) break;
    }
    for (let i = 0; i < 300 && !e.over(); i++) { e.step(); check(); }
    const stuck = [...want]
      .filter(([k]) => !reached.has(k))
      .map(([slot, v]) => ({ slot, want: v, atUndo: atUndo.get(slot)!, final: read(e.h.s(), slot) }));
    findings.push({
      sig: c.sig,
      phase: c.sig.split('|')[0]!,
      src: c.tag.src,
      zvuk: c.tag.zvuk,
      value: c.tag.value,
      move: c.move,
      firedAfterTicks: c.firedAfter,
      undo: undone,
      landed,
      firedBeforeUndo,
      atUndo: Object.fromEntries(atUndo),
      stuck,
      wonControl: won,
      wonAfterUndo: game.engine!.won || game.room!.won,
      linesControl,
      linesAfterUndo: e.h.mix.started.length - start,
    });
  }
  return { room: jmeno, moves: d.steps.length, won, candidates: candidates.length, findings };
}

const wanted = SCAN === '1' ? null : new Set(SCAN.split(',').map((x) => x.trim().toUpperCase()));
const skip = new Set((process.env.FF_UNDO_SCAN_SKIP ?? '').split(',').map((x) => x.trim().toUpperCase()));
const rooms = ROOMS.map((r) => r.jmeno).filter(
  (j) => roomScript(j)?.solution && (!wanted || wanted.has(j)) && !skip.has(j),
);

describe.skipIf(!SCAN)('undo stuck scan', () => {
  for (const jmeno of rooms) {
    it(jmeno, () => {
      mkdirSync(OUT, { recursive: true });
      let res: RoomResult;
      try {
        res = scanRoom(jmeno);
      } catch (err) {
        writeFileSync(join(OUT, `${jmeno}.json`), JSON.stringify({ room: jmeno, error: String((err as Error).stack ?? err) }));
        console.log(`${jmeno}: ERROR`);
        return;
      }
      writeFileSync(join(OUT, `${jmeno}.json`), JSON.stringify(res, null, 1));
      const real = res.findings.filter((x) => x.landed && !x.firedBeforeUndo && x.stuck.length > 0);
      console.log(`${jmeno}: won=${res.won} candidates=${res.candidates} stuck=${real.length}`);
    }, 3_600_000);
  }
});
