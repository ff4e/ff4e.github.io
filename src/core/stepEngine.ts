/**
 * The deterministic, DOM-free core of the game loop (URoom.pas gstav/gfaze state
 * machine): the per-move push/turn, the per-tick phase advance (move/fall/turn/
 * exit/cork), the room `prog()` run with its scalar sync, and the win hooks
 * (fish-exit -> triggerWin, gspec=9 push-out -> triggerWin, script onWin, the
 * auto-return countdown). BOTH the browser host (`src/app/main.ts`) and the
 * headless solutions harness drive this one module so a physics/script regression
 * shows up identically in the game and in the test net.
 *
 * All side effects (sound, DOM, restart, the KAJUTA1 wall-shove) are injected via
 * `EngineHooks`; the engine itself only mutates `Room`/`Script` and its own phase
 * state, so it runs unchanged under Node with no browser.
 */
import { Dir } from './dir.js';
import { Room } from './room.js';
import type { RoomScript, Script } from './script.js';
import { exitCheer } from './ambient.js';
import { moveChar } from './record.js';

export type Which = 'little' | 'big';
export type Phase = 'idle' | 'move' | 'fall' | 'turn' | 'exit' | 'cork' | 'kuk';

// Animation frame budgets (URoom.pas fazi_*). Shared with the renderer via main.ts.
export const MOVE_FRAMES = 3; // stav_vlevo/nahoru: fazi_vlevo = fazi_nahoru = 3 ticks/cell
export const FALL_FRAMES = 1; // stav_padani: fazi_padani = 1 tick/cell
export const TURN_FRAMES = 3; // stav_otocka: fazi_otocky = 3 ticks
export const KUK_FRAMES = 2; // stav_kuk: fazi_kuk = 2 ticks (peek-at-player on switch/select)
export const FAZI_VEN_LR = { little: 6, big: 8 } as const;
export const FAZI_VEN_UD = { little: 2, big: 4 } as const;

/** Exit-slide length (fazi_ven) for a fish leaving through a given edge. */
export function exitFramesFor(which: Which, dir: number): number {
  return dir === Dir.left || dir === Dir.right ? FAZI_VEN_LR[which] : FAZI_VEN_UD[which];
}

export interface EngineHooks {
  /** random(n) -> 0..n-1 (host: Math.random; tests: seedable). */
  random: (n: number) => number;
  /** Landing thud (dopad 1 = soft, 2 = steel). */
  onLanding?: (kind: 1 | 2) => void;
  /** Play a cheer/effect sound by name (exit cheer). */
  playSound?: (name: string) => void;
  /** A blocked player push (host: KAJUTA1 screen-shove / gspec latch). */
  onBlockedMove?: (which: Which, dir: number) => void;
  /** Win bookkeeping (host: mark solved, record score). `countdown` = auto-return ticks. */
  onWin?: (countdown: number) => void;
  /** The auto-return countdown reached 0 (host: return to the world map). */
  onReturnToMap?: () => void;
}

/**
 * The shared step-engine. One instance owns a `Room` (+ optional `Script`) and the
 * animated phase machine. Construct a fresh one per room build / per replay.
 */
export class StepEngine {
  phase: Phase = 'idle';
  animFrame = 0;
  activeAnimFish: Which = 'little';
  active: Which = 'little';
  exiting: { which: Which; dir: number } | null = null;
  exitFrames = 8; // stav_ven length for the fish currently exiting (fazi_ven)
  corkExit: { idx: number; total: number } | null = null;
  swim: { which: Which; tx: number; ty: number } | null = null;
  winCountdown = 0;
  /** Set once a win is triggered (fish exit / gspec=9 push-out / script onWin). The
   *  harness asserts this — `room.won` alone misses gspec=9 rooms, where the fish
   *  never leave and only the pushed item wins. */
  won = false;
  /** The move-command log (srecord); appended on each accepted move. */
  srecord = '';
  /** Count of decoded moves the engine rejected — a harness regression signal. */
  blocked = 0;
  /** jizda (Priprav, URoom.pas:26169): ticks of continuous, unobstructed movement. It
   *  drives the move speed-up (holding a direction accelerates) and resets whenever the
   *  fish stops or is pushing an object. */
  jizda = 0;
  /** The ticks-per-cell locked in when the current move started, so the slide divisor
   *  never changes mid-cell (a jizda tier change 3->2->1 applies to the NEXT cell, not
   *  the one in flight — otherwise the fish jumps at the transition). */
  cellFrames = MOVE_FRAMES;

  /** Ticks-per-cell for the current move, from the jizda speed-up (URoom.pas:26176-26186):
   *  jizda 0..6 → 3, 7..10 → 2, 11+ → 1 — so a sustained hold accelerates 3→2→1. */
  moveFrames(): number {
    return this.jizda <= 6 ? MOVE_FRAMES : this.jizda <= 10 ? 2 : 1;
  }

  constructor(
    public room: Room,
    public script: Script | null,
    public def: RoomScript | null,
    private readonly hooks: EngineHooks,
  ) {}

  /** ToRecord (URoom.pas:1969): append an accepted move to the record log. */
  private recordMove(which: Which, dir: number): void {
    const ch = moveChar(which, dir);
    if (ch) this.srecord += ch;
  }

  /**
   * A player push (tryStep, URoom.pas ZaznamenejPrikaz). A horizontal press while
   * facing away first TURNS in place (stav_otocka, no cell); otherwise it starts a
   * move if the push is legal. Returns the resulting phase kind; a rejected push
   * increments `blocked` and fires the host's blocked-move hook (KAJUTA1 shove).
   */
  press(which: Which, dir: number): 'moving' | 'turning' | 'blocked' | 'busy' {
    const room = this.room;
    // DalsiPrikaz busy gate (URoom.pas:27002-27016): a fish command is dropped while
    // that fish is busy (mid-dialogue, turned to face the player). Not counted as a
    // blocked push — the command is simply never dispatched.
    if (room.busy[which] > 0) return 'busy';
    if ((dir === Dir.left && room.facingRight[which]) || (dir === Dir.right && !room.facingRight[which])) {
      this.phase = 'turn';
      this.animFrame = 0;
      this.activeAnimFish = which;
      this.recordMove(which, dir);
      return 'turning';
    }
    if (room.beginMoveFish(which, dir)) {
      this.phase = 'move';
      this.animFrame = 0;
      this.cellFrames = this.moveFrames(); // lock the speed tier for this cell
      this.activeAnimFish = which;
      this.recordMove(which, dir);
      return 'moving';
    }
    this.blocked++;
    this.hooks.onBlockedMove?.(which, dir);
    return 'blocked';
  }

  /**
   * stav_kuk (URoom.pas:24459 akce_switch / 24712 akce_set): the newly-active fish
   * briefly turns to face the player (tl_otocka[1], fazi_kuk = 2 ticks) after a switch
   * or select. Only starts from rest, so it never clobbers an in-flight animation; the
   * host suppresses it during recording/showmode/load (the original's `not (capturemode
   * or showmode)` guard). While it plays, the fish is not idle, so the next command is
   * deferred for those 2 ticks — matching the original's at-rest command dispatch.
   */
  startKuk(which: Which): void {
    this.active = which;
    if (this.phase !== 'idle') return;
    this.phase = 'kuk';
    this.animFrame = 0;
    this.activeAnimFish = which;
  }

  /**
   * Apply one recorded move instantly (no animation): the same deterministic turn/
   * push/settle/exit logic as the live path, used for undo/load re-simulation.
   * Returns false if the move was blocked (so it isn't recorded).
   */
  applyMoveInstant(which: Which, dir: number): boolean {
    const room = this.room;
    if ((dir === Dir.left && room.facingRight[which]) || (dir === Dir.right && !room.facingRight[which])) {
      room.facingRight[which] = dir === Dir.right;
      this.recordMove(which, dir);
      return true;
    }
    if (!room.beginMoveFish(which, dir)) return false;
    room.commitMove();
    room.clearAllDirs();
    room.fallToRest(); // settle gravity fully, instantly
    const edge = room.gspec === 9 ? null : room.checkEdges();
    if (edge && !room.won) {
      room.exitFish(edge.which);
      if (edge.dir === Dir.left) room.facingRight[edge.which] = false;
      else if (edge.dir === Dir.right) room.facingRight[edge.which] = true;
    }
    this.recordMove(which, dir);
    return true;
  }

  /**
   * completeStep (URoom.pas:24883): a move's slide finished — commit the cell, settle
   * one gravity pass; if something is still falling, animate the fall, else check for
   * a fish reaching an exit edge (kontroluj_okraje). gspec=9 rooms never exit fish.
   */
  private completeStep(): void {
    const room = this.room;
    room.commitMove();
    room.clearAllDirs();
    const fell = room.padani();
    if (room.dopad === 1) this.hooks.onLanding?.(1);
    else if (room.dopad === 2) this.hooks.onLanding?.(2);
    if (fell) {
      this.animFrame = 0;
      this.phase = 'fall';
      return;
    }
    const edge = room.gspec === 9 ? null : room.checkEdges();
    if (edge && !room.won) {
      this.exiting = edge;
      this.exitFrames = exitFramesFor(edge.which, edge.dir);
      const idx = edge.which === 'little' ? room.littleIdx : room.bigIdx;
      room.items[idx]!.dir = edge.dir; // drives the exit slide
      if (edge.dir === Dir.left) room.facingRight[edge.which] = false;
      else if (edge.dir === Dir.right) room.facingRight[edge.which] = true;
      this.phase = 'exit';
      this.animFrame = 0;
    } else {
      this.phase = 'idle';
    }
  }

  /** Common win bookkeeping (triggerWin): latch `won`, start the auto-return countdown. */
  triggerWin(countdown = 30): void {
    this.won = true;
    this.winCountdown = countdown; // 30 fish exit / 20 gspec=9 push-out (URoom.pas:24341/24051)
    this.hooks.onWin?.(countdown);
  }

  /**
   * Sync the room-script scalars from the current motion state and run one `prog()`
   * tick (Programky) plus any falling-ship motion. Mirrors the pre-`prog` block of
   * main.ts's step(). The host runs its cosmetic StdSmrt/chatter/dialogy AFTER this.
   */
  runScript(count: number, casHry: number): void {
    const room = this.room;
    if (!this.script || !this.def || room.won) return;
    room.idle.little++; // inc(delay[r]) — idle timers
    room.idle.big++;
    room.aktivni = this.active; // keep the room's active-fish in sync for Programky
    const s = this.script;
    s.count = count;
    s.casHry = casHry;
    s.gfaze = this.phase === 'move' ? this.animFrame : 0;
    s.atRest = this.phase === 'idle'; // gstav===stav_klid (gates Spec9)
    s.turning = this.phase === 'turn'; // gstav===stav_otocka (KAJUTA2 parrot)
    if (this.phase === 'move') {
      const d = room.items[this.activeAnimFish === 'little' ? room.littleIdx : room.bigIdx]!.dir;
      s.gstav = d === Dir.left ? 2 : d === Dir.right ? 3 : d === Dir.up ? 4 : d === Dir.down ? 5 : 0;
    } else {
      s.gstav = this.phase === 'fall' ? 1 : this.phase === 'turn' ? 6 : this.phase === 'exit' ? 7 : this.phase === 'kuk' ? 8 : 0;
    }
    this.def.prog(s);
    s.tickShodLod(); // advance any falling ship (ShodLod/VyresLode motion)
  }

  /**
   * Advance the phase machine one tick: set up a gspec=9 cork exit if a spec=9 item
   * was pushed to the edge, drive move/fall/turn/exit/cork animations to completion
   * (firing the exit cheer + triggerWin), then run any pending auto-swim / possession
   * step while idle. Mirrors main.ts's step() phase block (URoom.pas:24375-24950).
   */
  advance(): void {
    const room = this.room;
    // jizda (Priprav, URoom.pas:26169-26174): count a tick of movement, reset otherwise.
    // A move state increments it; a turn leaves it; anything else (idle/fall) resets it;
    // and pushing an object (tlaceno) resets it too — so only a free, uninterrupted hold
    // builds up speed. Updated here, before the phase advances, mirroring Priprav running
    // ahead of the state machine each tick.
    if (this.phase === 'move') this.jizda++;
    else if (this.phase !== 'turn') this.jizda = 0;
    if (room.tlaceno) this.jizda = 0;
    // gspec=9 (SPUNT/MAPA/POHON/DISKETA): a spec=9 item shoved to the edge starts its
    // exit-slide (kontroluj_vytlaceni, URoom.pas:24375).
    if (room.gspec === 9 && !this.corkExit && this.phase === 'idle') {
      for (let i = 1; i <= room.itemCount; i++) {
        if (room.items[i]!.spec === 9) {
          this.corkExit = { idx: i, total: Math.max(1, room.items[i]!.faziVen) };
          this.phase = 'cork';
          this.animFrame = 0;
          break;
        }
      }
    }
    if (this.phase === 'move' || this.phase === 'fall') {
      this.animFrame++;
      if (this.animFrame >= (this.phase === 'fall' ? FALL_FRAMES : this.cellFrames)) this.completeStep();
    } else if (this.phase === 'turn') {
      this.animFrame++;
      if (this.animFrame >= TURN_FRAMES) {
        room.facingRight[this.activeAnimFish] = !room.facingRight[this.activeAnimFish];
        this.phase = 'idle';
      }
    } else if (this.phase === 'exit') {
      this.animFrame++;
      if (this.animFrame >= this.exitFrames && this.exiting) {
        const which = this.exiting.which;
        const idx = which === 'little' ? room.littleIdx : room.bigIdx;
        room.items[idx]!.dir = Dir.no;
        room.exitFish(which);
        const other: Which = which === 'little' ? 'big' : 'little';
        const cheer = exitCheer(
          which,
          {
            aliveOther: room.alive[other],
            venkuOther: room.venku[other],
            venkuLittle: room.venku.little,
            zvykacka: this.script?.zvykacka ?? false,
          },
          this.hooks.random,
        );
        if (cheer.sound) this.hooks.playSound?.(cheer.sound);
        if (cheer.clearGum && this.script) this.script.zvykacka = false;
        this.exiting = null;
        this.phase = 'idle';
        if (room.won) this.triggerWin();
      }
    } else if (this.phase === 'cork' && this.corkExit) {
      // gspec=9 exit-slide (URoom.pas:24899): the pushed item slides off over its
      // faziVen frames, is removed, and the room is won once vytlacit hits 0.
      this.animFrame++;
      if (this.animFrame >= this.corkExit.total) {
        const it = room.items[this.corkExit.idx]!;
        it.spec = 11; // hidden / gone
        it.x = -100;
        it.y = -100;
        it.dir = Dir.no;
        room.vytlacit--;
        this.corkExit = null;
        this.phase = 'idle';
        if (room.vytlacit <= 0) this.triggerWin(20); // gspec=9 push-out win: countdown:=20
      }
    } else if (this.phase === 'kuk') {
      // stav_kuk (URoom.pas:24817): the peek-at-player pose plays for fazi_kuk ticks,
      // then the fish returns to rest (stav_nic -> idle).
      this.animFrame++;
      if (this.animFrame >= KUK_FRAMES) this.phase = 'idle';
    } else if (this.phase === 'idle' && !room.anyFishDead && !room.won && this.script && this.script.natvrdo === 1) {
      // natvrdo (URoom.pas:26924 + 24697): ZELVA's telepathic possession — force-swim
      // the seized fish to (tvrdex, tvrdey), releasing once it arrives / is blocked.
      const sc = this.script;
      const which: Which = sc.tvrdaryba === 1 ? 'little' : 'big';
      this.active = which; // aktivni := kdo (the possessed fish)
      const dir = room.findDir(which, sc.tvrdex, sc.tvrdey);
      if (dir === Dir.no) sc.natvrdo = 0; // arrived / unreachable → release
      else this.press(which, dir); // a blocked step just stays put and retries next tick
    } else if (this.phase === 'idle' && !room.anyFishDead && !room.won && this.swim) {
      const dir = room.findDir(this.swim.which, this.swim.tx, this.swim.ty);
      if (dir === Dir.no) this.swim = null;
      else {
        const r = this.press(this.swim.which, dir);
        // 'busy' pauses the auto-swim (najdi_smer dir_* dropped by DalsiPrikaz while
        // busy); the target is kept and retried once the fish stops talking. A real
        // 'blocked' push cancels it.
        if (r === 'blocked') this.swim = null;
      }
    }
  }

  /** The auto-return countdown (checked at the top of a tick, before `prog`). Returns
   *  true if the countdown consumed this tick (host: skip the rest of the frame). */
  tickCountdown(): boolean {
    if (this.winCountdown > 0) {
      this.winCountdown--;
      if (this.winCountdown === 0) this.hooks.onReturnToMap?.();
      return true;
    }
    return false;
  }
}
