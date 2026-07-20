/**
 * Hacky (URoom.pas:23749) — the "xfisher" easter-egg: fishing hooks descend from
 * the ceiling, track a fish, and — if they reach it — catch and kill it (yanking
 * it up and off-screen). A global tick-loop system gated by `count > 0`; hooks are
 * spawned by the `xfisher` cheat (or the `ultraviolence` mode, not ported).
 *
 * Faithful to the original `hacek[]` record + Hacky procedure. Pixel coordinates
 * (x is a CELL column, y is a PIXEL offset from the ceiling) match the engine.
 */
import type { Room } from './room.js';

/** A hooked-death sink: the host wires this to kill a fish + run gravity. */
export interface HookHost {
  /** Kill `which` fish by hook (zije:=false, kostra:=false) and trigger a fall. */
  killByHook(which: 'little' | 'big'): void;
}

interface Hook {
  /** 0 = idle, 1 = descending, 2 = retracting (missed), 3 = caught (pulling up). */
  stav: number;
  /** true = the target is facing right (natoceni=smer_vpravo). */
  facingRight: boolean;
  cil: 'little' | 'big';
  /** Cell column of the hook line. */
  x: number;
  /** Pixel depth of the hook tip below the ceiling. */
  y: number;
  rychlost: number;
}

const FSIZE = 15;

export class HookSystem {
  private readonly hooks: Hook[] = [];

  constructor(private readonly host: HookHost) {}

  /** nhacku — number of active hooks (0..10). */
  get count(): number {
    return this.hooks.length;
  }

  /** True while any hook is still dragging a caught fish up (stav 3). */
  get busy(): boolean {
    return this.hooks.some((h) => h.stav === 3);
  }

  /** Read-only snapshot for the renderer. */
  get snapshot(): ReadonlyArray<Readonly<Hook>> {
    return this.hooks;
  }

  /** xfisher (URoom.pas:24601): add a hook if under the cap and a fish is alive. */
  add(room: Room): void {
    if (this.hooks.length < 10 && (room.alive.little || room.alive.big)) {
      this.hooks.push({ stav: 0, facingRight: false, cil: 'little', x: 0, y: 0, rychlost: 0 });
    }
  }

  /** Drop all hooks (nhacku:=0) — the host calls this on room enter/restart. */
  clear(): void {
    this.hooks.length = 0;
  }

  /** The fish's leading-edge cell column, per facing + footprint (little 3, big 4). */
  private edgeX(room: Room, which: 'little' | 'big'): number {
    const it = room.items[which === 'little' ? room.littleIdx : room.bigIdx]!;
    const w = which === 'little' ? 3 : 4;
    return room.facingRight[which] ? it.x + w : it.x;
  }

  /** Hacky (URoom.pas:23752): advance every hook one tick. `rnd(n)` = 0..n-1. */
  tick(room: Room, rnd: (n: number) => number): void {
    for (const h of this.hooks) {
      switch (h.stav) {
        case 0: {
          const la = room.alive.little;
          const ba = room.alive.big;
          if (!la && !ba) break;
          // Prefer the little fish if it is alive and (the big is dead OR a coin-flip).
          if (la && (!ba || rnd(2) === 0)) h.cil = 'little';
          else h.cil = 'big';
          h.facingRight = room.facingRight[h.cil];
          h.x = this.edgeX(room, h.cil);
          h.y = 0;
          h.stav = 1;
          h.rychlost = rnd(8) + 3;
          break;
        }
        case 1: {
          const px = this.edgeX(room, h.cil);
          // Missed if the target died, moved (column changed), or turned.
          if (!room.alive[h.cil] || px !== h.x || room.facingRight[h.cil] !== h.facingRight) {
            h.stav = 2;
            break;
          }
          h.y += h.rychlost;
          const it = room.items[h.cil === 'little' ? room.littleIdx : room.bigIdx]!;
          const bodyPx = h.cil === 'little' ? FSIZE : 2 * FSIZE; // little 1 cell tall, big 2
          if (h.y + 8 > it.y * FSIZE + bodyPx) {
            h.y = it.y * FSIZE - bodyPx;
            h.stav = 3;
            this.host.killByHook(h.cil);
          }
          break;
        }
        case 2:
          h.y -= h.rychlost + 2;
          if (h.y < 0) h.stav = 0;
          break;
        case 3:
          h.y -= FSIZE;
          if (h.y < -60) h.stav = 0;
          break;
      }
    }
  }
}
