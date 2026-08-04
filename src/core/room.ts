/**
 * Room runtime state + the movement core, ported from URoom.pas.
 *
 * Physics ported line-by-line:
 *   priprav_pole    (URoom.pas:26375) -> buildGrid
 *   posun_objekt    (URoom.pas:26514) -> pushObject   (recursive push)
 *   posun_ryby      (URoom.pas:26564) -> pushFish
 *   posun_predmety  (URoom.pas:1890)  -> commitMove
 * plus the helpers priprav_prvni_pohyb / nastav_hybnosti / priprav_dalsi_pohyb.
 *
 * Grid sentinels (URoom.pas:47-51): item_water=255 (empty), item_wall=0.
 * Item "kind" codes (URoom.pas:38-42): static/light/heavy/little/big.
 *
 * This module is pure logic (no DOM, no rendering) so it stays deterministic
 * and headless-testable, per the PLAN's logic/render split.
 */
import {
  type FfrRoom,
  type FfrBitmap,
  type FfrPaletteEntry,
  Kind,
  FFR_EXTRA,
  markBitmapPixelsChanged,
} from '../data/ffr.js';
import { Dir, DX_DIR, DY_DIR } from './dir.js';

export const ITEM_WATER = 255;
export const ITEM_WALL = 0;
/** Pathfinding sentinels (URoom.pas:49-51): destination / blocked / visited. */
export const ITEM_DEST = 250;
export const ITEM_BLOCK = 251;
export const ITEM_MARK = 252;

export interface Field {
  readonly x: number;
  readonly y: number;
}

/** A live item; X/Y are the current cell position (start = XStart/YStart). */
export interface Item {
  x: number;
  y: number;
  xStart: number;
  yStart: number;
  bmp: number;
  afaze: number; // current animation frame offset
  mask: number;
  kind: number;
  dir: number; // pending move direction this step
  moved: number; // "hybnost" — movement history used by gravity
  spec: number;
  /**
   * The item's spec captured right after the room's init script (its static
   * configuration). Used only by the enhanced art source to decide sprite
   * mirroring: an item that is statically spec=10 (e.g. DRAKAR1's band) has its
   * FFNG art staged pre-mirrored, whereas an item whose spec toggles to 10 at
   * runtime (PARTY1's window figures) has base-oriented art that must be
   * mirrored for spec=10 to match the classic KresliRev flip. Set by the host on
   * room load; undefined until then.
   */
  initSpec?: number;
  visible: boolean;
  stoned: boolean; // "Stoned": anchored to the floor (zkameneni_pevnych)
  onBig: number; // support code w.r.t. the big fish (zavislosti_nezkamenelych)
  onLittle: number; // support code w.r.t. the little fish
  /** Per-object script variables (Vars^[1..nVars]); index 0 unused. */
  vars: number[];
  /** Current animation string being played by the script (Anim/PosAnim). */
  anim: string;
  posAnim: number;
  delAnim: number;
  labelAnim: number;
  readonly fields: readonly Field[];
}

/** One destructive KresliLod ship/background swap pass (URoom.pas:26296-26361). */
export interface WreckSwap {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly width: number;
  /** Linear ship-bitmap offsets that the Delphi mask test actually swapped. */
  readonly pixels: readonly number[];
}

/**
 * The falling ship's object, given a tier's staged objects.
 *
 * KresliLod reads the LAST item as the ship and the one past it as the mask
 * (`applyWreckSwap` below), so every tier that replays the wreck has to bind to
 * `itemCount - 1`. One definition, because a tier that bound to the wrong item would
 * simply render an undamaged room — no error, nothing to notice.
 */
export function wreckObject<T>(
  objects: readonly { readonly item: number; readonly frames: readonly T[] }[],
  itemCount: number,
): { readonly item: number; readonly frames: readonly T[] } | null {
  return objects.find((o) => o.item === itemCount - 1) ?? null;
}

/**
 * The ship sprite a recorded swap's `phase` selects.
 *
 * `phase` indexes the wreck object's frames directly. Getting it wrong puts a
 * correctly-placed, correctly-sized wreck on screen painted from the wrong ship — which
 * no comparison of WHERE the damage landed can detect, only one of what it looks like.
 */
export function wreckFrame<T>(
  objects: readonly { readonly item: number; readonly frames: readonly T[] }[],
  itemCount: number,
  phase: number,
): T | null {
  return wreckObject(objects, itemCount)?.frames[phase] ?? null;
}

/**
 * Decode a recorded swap back into positions, and hand each one to `fn`.
 *
 * THE one definition of how a `WreckSwap` is read. Three things live here that a replay
 * must not restate, because getting any of them wrong is silent and this codebase has
 * shipped that class of bug before (see `dissolveKeeps`, render/aiTarget.ts):
 *
 *  - `pixels` are LINEAR offsets into the ship bitmap, row-major over `swap.width` — the
 *    recording bitmap's width, which is not necessarily the replaying sprite's;
 *  - the background is stored with `FFR_EXTRA` columns of padding on each side, so a
 *    background column `swap.x + j` is art column `swap.x + j - FFR_EXTRA`;
 *  - a pixel outside the replaying sprite is skipped.
 *
 * Callers own their own ART bounds, because those differ per tier — the faithful and
 * enhanced tiers clip in native pixels, the `ai` tier at ×S. They do NOT own Delphi's
 * `y > 436` fall cut-off either: `applyWreckSwap` applies it while RECORDING, so no swap
 * can carry a pixel past it and a replay that re-checked it would be adding a branch no
 * test can reach.
 *
 * `spriteW`/`spriteH` are the replaying sprite's size in NATIVE pixels whatever the
 * tier's own resolution, so the bounds test means the same thing everywhere.
 */
export function forEachWreckPixel(
  swap: WreckSwap,
  spriteW: number,
  spriteH: number,
  fn: (i: number, j: number, dx: number, dy: number) => void,
): void {
  for (const pixel of swap.pixels) {
    const i = Math.floor(pixel / swap.width);
    const j = pixel % swap.width;
    if (i >= spriteH || j >= spriteW) continue;
    fn(i, j, swap.x + j - FFR_EXTRA, swap.y + i);
  }
}

/** Disintegration counter set when a fish dies (zac_rozpad, URoom.pas:439). */
export const ZAC_ROZPAD = 400;

/**
 * Safety caps on the two gravity fixed-points. Neither has a bound in the Delphi —
 * both provably terminate on a sane room — but in a browser an unbounded spin is a
 * frozen tab with no diagnosis, so overrunning throws instead. Sized far above any
 * real room: nothing can fall further than the room is tall (51x36 at the largest),
 * and the crush fixed-point can only flip two booleans, so it settles in a pass or two.
 */
const MAX_SETTLE_PASSES = 1000;
const MAX_CRUSH_PASSES = 100;

/**
 * Grid mirroring the Pascal FArray[-1..maxfx, -1..maxfy]. Stored with a +1
 * offset so the -1 border index is valid; cells hold an item index, ITEM_WALL,
 * or ITEM_WATER. Sized to -1..RWidth+1 / -1..RHeight+1 so priprav_hledani's
 * RWidth+1 / RHeight+1 accesses (URoom.pas:26412-26413) stay in bounds.
 */
export class Grid {
  private readonly stride: number;
  private readonly data: Uint8Array;

  constructor(
    readonly rWidth: number,
    readonly rHeight: number,
  ) {
    this.stride = rWidth + 4; // indices -1..RWidth+2
    this.data = new Uint8Array(this.stride * (rHeight + 4));
  }

  get(x: number, y: number): number {
    return this.data[(y + 1) * this.stride + (x + 1)]!;
  }

  set(x: number, y: number, v: number): void {
    this.data[(y + 1) * this.stride + (x + 1)] = v;
  }

  fill(v: number): void {
    this.data.fill(v);
  }
}

export class Room {
  readonly width: number;
  readonly height: number;
  readonly items: Item[];
  readonly grid: Grid;
  readonly palette: readonly FfrPaletteEntry[];
  readonly bitmaps: (FfrBitmap | null)[];
  readonly wallItem: Item;
  bgBmp: FfrBitmap;
  wamp: number;
  wper: number;
  wspd: number;

  /** Item indices of the two fish (the first little/big items, as in TRoom.Start).
   *  Mutable because WIN's bonus level (ZapniBonusLevel) reassigns Little/Big to the
   *  "old fish" and back; startLittle/startBig keep the original young-fish indices. */
  littleIdx: number;
  bigIdx: number;
  readonly startLittle: number;
  readonly startBig: number;

  /** Facing per fish (natoceni := smer_start). true = right (smer_vpravo). */
  facingRight: { little: boolean; big: boolean };

  /** Alive flags (zije). A fish that dies becomes a skeleton (kostra). */
  alive: { little: boolean; big: boolean } = { little: true, big: true };
  /** Skeleton flags (kostra) — set when the matching fish is crushed. */
  kostra: { little: boolean; big: boolean } = { little: false, big: false };
  /** Exited flags (venku) — set when the fish has swum out of the room. */
  venku: { little: boolean; big: boolean } = { little: false, big: false };
  /** Disintegration counters (rozpad) for a dead fish's skeleton. */
  rozpad: { little: number; big: number } = { little: 0, big: 0 };
  /** Impact severity of the last settle (dopad): 0 none, 1 normal, 2 heavy. */
  dopad = 0;

  /** Set true by pushObject when a fish pushes a foreign object (tlaceno). */
  tlaceno = false;

  /** gspec=42 (ZX) render state: the loading-stripe band cycler + the four band colours
   *  (wall corners), sampled lazily on first use. Persists across frames within a room. */
  zx: { pruh: number; count: number; cur: number; colors: number[] | null } = {
    pruh: 0,
    count: 0,
    cur: 0,
    colors: null,
  };

  /** Ordered destructive swaps, retained so a newly-selected enhanced art source can replay them. */
  readonly wreckSwaps: WreckSwap[] = [];
  private readonly mutableBitmaps = new Set<number>();

  /** "busy" talking state per fish (set by dialog scripts; drives the talking head). */
  busy: { little: number; big: number } = { little: 0, big: 0 };
  /** Idle timers (delay[mala/velka]): frames since the last player action. */
  idle: { little: number; big: number } = { little: 0, big: 0 };
  /** Face expression (xicht): head-frame index a room sets; 0 = neutral (URoom.pas:25760). */
  xicht: { little: number; big: number } = { little: 0, big: 0 };
  /** aktivni (URoom.pas:264): which fish is currently controlled; the host keeps this in sync. */
  aktivni: 'little' | 'big' = 'little';

  /**
   * gspec (URoom.pas): the room "game-spec" mode. 0 = normal (win by getting both
   * fish out). 9 = "push an item out" room (SPUNT): win by shoving `vytlacit`
   * spec=9 items off the edge. Set by the room's InitProgramky.
   */
  gspec = 0;
  /** vytlacit (URoom.pas:1445): how many spec=9 items still need pushing out (gspec=9). */
  vytlacit = 1;
  /**
   * fazi_ven (URoom.pas:265): how many frames the current exit-slide runs for. It is
   * a ROOM field, not an item one — `TItem` (URoom.pas:95) has no `fazi_ven`, so
   * Spec9's `fazi_ven:=3*a` inside its `with Items[i]^ do` writes this, and marking
   * two items in one pass leaves the LAST one's value (URoom.pas:2449-2452).
   */
  faziVen = 0;

  /**
   * StdKrajniHlaska state (URoom.pas:2984): edge-of-room fish comments. `bylaukraje`
   * tracks whether each fish was at a room border last check; the other fields pace
   * how often (and which of 3+1) comment fires.
   */
  bylaukraje: { little: boolean; big: boolean } = { little: false, big: false };
  hlasitkraj = 0;
  kdyhlasitkraj = 1;
  poslhlaskakraje = -1;

  /** hrac_nespi: the player acted, reset the idle timers. */
  hracNespi(): void {
    this.idle.little = 0;
    this.idle.big = 0;
  }

  /** Fish body/head frame tables. Not readonly: the UNDEAD and MORPH cheats swap
   *  in transformed copies (never mutating the shared parsed FFR data, so the
   *  effect dies with the Room — as it does in the original, whose TRoom.Create
   *  reloads the sprites). */
  bodies: FfrRoom['bodies'];
  heads: FfrRoom['heads'];

  constructor(ffr: FfrRoom) {
    this.width = ffr.width;
    this.height = ffr.height;
    this.grid = new Grid(this.width, this.height);
    this.palette = ffr.palette;
    // Keep the bitmap table room-local. KresliLod mutates selected bitmap pixels,
    // but parsed FFR data may be reused when the room is rebuilt.
    this.bitmaps = [...ffr.bitmaps];
    this.wamp = ffr.wamp;
    this.wper = ffr.wper;
    this.wspd = ffr.wspd;
    this.bodies = ffr.bodies;
    this.heads = ffr.heads;

    this.items = ffr.items.map((it) => ({
      x: it.xStart,
      y: it.yStart,
      xStart: it.xStart,
      yStart: it.yStart,
      bmp: it.bmp,
      afaze: 0,
      mask: it.mask,
      kind: it.kind,
      dir: Dir.no,
      moved: 0,
      spec: 0,
      visible: true,
      stoned: false,
      onBig: 0,
      onLittle: 0,
      vars: [],
      anim: '',
      posAnim: 1,
      delAnim: 0,
      labelAnim: 1,
      fields: it.fields,
    }));

    this.wallItem = this.items[0]!;
    const bg = ffr.bitmaps[1];
    if (!bg) throw new Error('room missing background bitmap');
    this.bgBmp = bg;

    // Little/Big are the first items of the respective kind (TRoom.Start, URoom.pas:1395-1405).
    this.littleIdx = this.items.findIndex((it, i) => i > 0 && it.kind === Kind.little);
    this.bigIdx = this.items.findIndex((it, i) => i > 0 && it.kind === Kind.big);
    this.startLittle = this.littleIdx;
    this.startBig = this.bigIdx;
    this.facingRight = {
      little: ffr.startFacingRight.small,
      big: ffr.startFacingRight.big,
    };
  }

  get itemCount(): number {
    return this.items.length - 1;
  }

  /**
   * KresliLod (URoom.pas:26296-26361): where the mask bitmap permits it, swap each
   * non-mask ship pixel with the room background. Both buffers are deliberately
   * mutated, which makes the wreck erode as the same sprite is moved and swapped
   * again on later ticks.
   */
  applyWreckSwap(x: number, y: number, phase: number): void {
    const shipItem = this.items[this.itemCount - 1];
    const maskItem = this.items[this.itemCount];
    if (!shipItem || !maskItem) return;

    const shipIndex = shipItem.bmp + phase;
    const ship = this.mutableBitmap(shipIndex);
    const bg = this.mutableBitmap(1);
    const mask = this.bitmaps[maskItem.bmp];
    if (!ship || !bg || !mask) return;

    const maskColor = mask.pixels[0]!;
    const swapped: number[] = [];
    for (let i = 0; i < ship.h; i++) {
      const dy = y + i;
      if (dy < 0 || dy > 436) continue;
      const shipRow = i * ship.w;
      const bgRow = dy * bg.w + x;
      const maskRow = (dy > 435 ? 135 : dy < 306 ? 0 : dy - 306) * mask.w + x;
      for (let j = 0; j < ship.w; j++) {
        if (mask.pixels[maskRow + j] !== maskColor) continue;
        const sp = shipRow + j;
        const shipPixel = ship.pixels[sp]!;
        if (shipPixel === maskColor) continue;
        const bp = bgRow + j;
        const bgPixel = bg.pixels[bp]!;
        ship.pixels[sp] = bgPixel;
        bg.pixels[bp] = shipPixel;
        swapped.push(sp);
      }
    }
    this.wreckSwaps.push({ x, y, phase, width: ship.w, pixels: swapped });
    if (swapped.length > 0) markBitmapPixelsChanged(bg.pixels);
  }

  /** Clone a bitmap on its first destructive write so the parsed FFR stays immutable. */
  private mutableBitmap(index: number): FfrBitmap | null {
    const current = this.bitmaps[index];
    if (!current) return null;
    if (this.mutableBitmaps.has(index)) return current;
    const clone = { ...current, pixels: current.pixels.slice() };
    this.bitmaps[index] = clone;
    this.mutableBitmaps.add(index);
    if (index === 1) this.bgBmp = clone;
    return clone;
  }

  /**
   * A pushed-out item is gone: `odstran_vytlacene` (URoom.pas:24035) parks it at
   * (-100,-100) with spec=11, and every physics pass then skips it with
   * `(gspec<>9)or(spec<>11)` — priprav_pole (URoom.pas:26394), zkameneni_pevnych
   * (:26591), zavislosti_nezkamenelych (:26641) and all three item loops of padani
   * (:26690, :26705, :26739). Without that guard the -100 coordinates index the
   * occupancy grid far outside its bounds, so the next gravity pass reads a
   * non-existent cell and dies — the GRAL push-out hang (the game loop stops
   * rescheduling and the tab freezes).
   */
  private pushedOut(it: Item): boolean {
    return this.gspec === 9 && it.spec === 11;
  }

  /** priprav_pole (URoom.pas:26375): rebuild the occupancy grid from item positions. */
  buildGrid(): void {
    const g = this.grid;
    g.fill(ITEM_WATER);
    for (let i = -1; i <= this.width; i++) {
      g.set(i, -1, ITEM_WALL);
      g.set(i, this.height, ITEM_WALL);
    }
    for (let j = -1; j <= this.height; j++) {
      g.set(-1, j, ITEM_WALL);
      g.set(this.width, j, ITEM_WALL);
    }
    const wall = this.wallItem;
    for (const f of wall.fields) g.set(wall.x + f.x, wall.y + f.y, ITEM_WALL);
    for (let i = 1; i <= this.itemCount; i++) {
      const it = this.items[i]!;
      // A fish is on the grid while alive or as a skeleton; a fish that has
      // exited (venku) is gone (priprav_pole, URoom.pas:26394).
      const includeBig = this.alive.big || this.kostra.big;
      const includeLittle = this.alive.little || this.kostra.little;
      const includeFish =
        (i !== this.bigIdx || includeBig) && (i !== this.littleIdx || includeLittle);
      if (!includeFish) continue;
      if (this.pushedOut(it)) continue; // (gspec<>9)or(spec<>11), URoom.pas:26394
      for (const f of it.fields) g.set(it.x + f.x, it.y + f.y, i);
    }
  }

  /**
   * posun_objekt (URoom.pas:26514): try to move item `cislo` in direction `smer`,
   * pushed by a fish of kind `druh`. Recursively pushes obstacles. Sets each
   * moved item's `dir`; returns whether the move is possible.
   */
  private pushObject(druh: number, cislo: number, smer: number): boolean {
    const it = this.items[cislo]!;
    if (it.dir !== Dir.no) return true;
    if (it.kind === Kind.static) return false;

    it.dir = smer;

    // A fish cannot push the other fish; the little one cannot push a heavy object.
    let mozno: boolean;
    if (druh === Kind.big) mozno = it.kind !== Kind.little;
    else mozno = it.kind !== Kind.big && it.kind !== Kind.heavy;

    let i = 0;
    while (mozno && i < it.fields.length) {
      const f = it.fields[i]!;
      const pom = this.grid.get(it.x + f.x + DX_DIR[smer]!, it.y + f.y + DY_DIR[smer]!);
      if (pom === ITEM_WALL) mozno = false;
      else if (pom !== cislo && pom !== ITEM_WATER) mozno = this.pushObject(druh, pom, smer);
      i++;
    }

    if (!mozno) it.dir = Dir.no;
    else if (it.kind !== druh) this.tlaceno = true;
    return mozno;
  }

  private clearDirsAndMoved(): void {
    for (let i = 1; i <= this.itemCount; i++) {
      this.items[i]!.moved = 0;
      this.items[i]!.dir = Dir.no;
    }
  }

  private setHybnosti(h: number): void {
    for (let i = 1; i <= this.itemCount; i++) {
      if (this.items[i]!.dir !== Dir.no) this.items[i]!.moved = h;
    }
  }

  private clearDirs(): void {
    for (let i = 1; i <= this.itemCount; i++) this.items[i]!.dir = Dir.no;
  }

  /**
   * posun_ryby (URoom.pas:26564): attempt to move fish `cislo` in `smer`. On
   * success, all moved items have their `dir` set (apply with commitMove); on
   * failure, dirs are cleared. Returns whether the move happened.
   */
  pushFish(cislo: number, smer: number): boolean {
    this.buildGrid();
    this.clearDirsAndMoved();
    this.tlaceno = false;
    const druh = this.items[cislo]!.kind;
    const vysl = this.pushObject(druh, cislo, smer);
    if (!vysl) {
      this.clearDirs();
    } else if (smer === Dir.down) {
      this.setHybnosti(2);
    } else if (smer === Dir.left || smer === Dir.right) {
      this.setHybnosti(1);
    }
    return vysl;
  }

  /** posun_predmety (URoom.pas:1890): apply each item's pending `dir` to X/Y. */
  commitMove(): void {
    for (let i = 1; i <= this.itemCount; i++) {
      const it = this.items[i]!;
      if (it.dir !== Dir.no) {
        it.x += DX_DIR[it.dir]!;
        it.y += DY_DIR[it.dir]!;
      }
    }
  }

  /**
   * Attempt to move the given fish one cell; on success updates facing (for
   * horizontal moves) and commits the move immediately. Returns whether it
   * moved. Used by headless tests; the interactive host uses beginMoveFish +
   * finalizeStep so it can animate the slide before committing.
   */
  tryMoveFish(which: 'little' | 'big', smer: number): boolean {
    if (!this.beginMoveFish(which, smer)) return false;
    this.finalizeStep();
    return true;
  }

  /**
   * Phase 1 of an animated move: run the push physics and set facing, leaving
   * each moved item's `dir` set (positions NOT yet updated) so the host can
   * render the slide. Returns whether the move is possible.
   */
  beginMoveFish(which: 'little' | 'big', smer: number): boolean {
    const idx = which === 'little' ? this.littleIdx : this.bigIdx;
    if (idx < 0) return false;
    const ok = this.pushFish(idx, smer);
    if (!ok) return false;
    if (smer === Dir.left) this.facingRight[which] = false;
    else if (smer === Dir.right) this.facingRight[which] = true;
    return true;
  }

  /** Phase 2 of an animated move: apply the pending dirs to positions and clear them. */
  finalizeStep(): void {
    this.commitMove();
    this.clearDirs();
  }

  // ----- gravity / crushing / death (padani et al., URoom.pas:26582-26779) -----

  /**
   * zkameneni_pevnych (URoom.pas:26582): mark items "stoned" (fixed to the
   * floor). An item is stoned if any of its cells rests directly on a wall or an
   * already-stoned item. Fixed-point iteration; fish are never stoned.
   */
  private petrify(): void {
    for (let i = 1; i <= this.itemCount; i++) this.items[i]!.stoned = false;
    let changed: boolean;
    do {
      changed = false;
      for (let i = 1; i <= this.itemCount; i++) {
        const it = this.items[i]!;
        if (this.pushedOut(it)) continue; // URoom.pas:26591
        if (it.stoned || it.kind === Kind.little || it.kind === Kind.big) continue;
        let becomes = false;
        for (let j = 0; j < it.fields.length && !becomes; j++) {
          const f = it.fields[j]!;
          const pom = this.grid.get(it.x + f.x, it.y + f.y + 1);
          if (pom !== ITEM_WATER) becomes = pom === ITEM_WALL || this.items[pom]!.stoned;
        }
        if (becomes) {
          it.stoned = true;
          changed = true;
        }
      }
    } while (changed);
  }

  /**
   * zavislosti_nezkamenelych (URoom.pas:26613): propagate the onBig/onLittle
   * support codes (3=is the fish, 2=directly on it, 1=indirectly on it, 0=not).
   */
  private computeSupport(): void {
    for (let i = 1; i <= this.itemCount; i++) {
      const it = this.items[i]!;
      if (it.kind === Kind.big) {
        it.onBig = 3;
        it.onLittle = 0;
      } else if (it.kind === Kind.little) {
        it.onBig = 0;
        it.onLittle = 3;
      } else {
        it.onBig = 0;
        it.onLittle = 0;
      }
    }
    let changed: boolean;
    do {
      changed = false;
      for (let i = 1; i <= this.itemCount; i++) {
        const it = this.items[i]!;
        if (this.pushedOut(it)) continue; // URoom.pas:26641
        if (it.stoned || it.kind === Kind.little || it.kind === Kind.big) continue;
        for (const f of it.fields) {
          const pom = this.grid.get(it.x + f.x, it.y + f.y + 1);
          if (pom === ITEM_WATER || pom === ITEM_WALL || pom === i) continue;
          const below = this.items[pom]!;
          let pomMala = below.onLittle;
          if (pomMala > 1) pomMala--;
          if (pomMala > it.onLittle) {
            it.onLittle = pomMala;
            changed = true;
          }
          let pomVelka = below.onBig;
          if (pomVelka > 1) pomVelka--;
          if (pomVelka > it.onBig) {
            it.onBig = pomVelka;
            changed = true;
          }
        }
      }
    } while (changed);
  }

  /**
   * padani (URoom.pas:26670): one gravity/crush pass. Recomputes anchoring and
   * support, kills fish crushed by items, turns dead fish into skeletons, then
   * sets Dir:=down on every unsupported item. Returns whether anything fell
   * (drive with `while (padani) commitMove()`). Also updates `dopad` (impact).
   */
  padani(): boolean {
    const notFish = (it: Item) => it.kind !== Kind.little && it.kind !== Kind.big;
    this.buildGrid();
    this.clearDirs();

    const malaZila = this.alive.little;
    const velkaZila = this.alive.big;
    let malaPom: boolean;
    let velkaPom: boolean;
    // The crush fixed-point is bounded too (see fallToRest): only two fish can die,
    // so it converges in at most a couple of passes. A spin would hang the tab.
    let guard = 0;
    do {
      if (++guard > MAX_CRUSH_PASSES) {
        throw new Error(`padani crush loop did not converge after ${MAX_CRUSH_PASSES} passes`);
      }
      this.petrify();
      this.computeSupport();
      malaPom = this.alive.little;
      velkaPom = this.alive.big;

      for (let i = 1; i <= this.itemCount; i++) {
        const it = this.items[i]!;
        if (this.pushedOut(it)) continue; // URoom.pas:26690
        if (it.stoned || !notFish(it)) continue;
        if (it.onBig === 0) {
          if (it.onLittle > 0 && it.kind === Kind.heavy) this.alive.little = false;
          if (it.onLittle === 1 && it.moved === 2) this.alive.little = false;
          if (it.onLittle === 2 && it.moved > 0) this.alive.little = false;
        }
        if (it.onLittle === 0) {
          if (it.onBig === 1 && it.moved === 2) this.alive.big = false;
          if (it.onBig === 2 && it.moved > 0) this.alive.big = false;
        }
      }
      for (let i = 1; i <= this.itemCount; i++) {
        const it = this.items[i]!;
        if (this.pushedOut(it)) continue; // URoom.pas:26705
        if (it.stoned || !notFish(it)) continue;
        if (it.onBig > 0 && it.onLittle > 0) {
          if (it.kind === Kind.heavy && !this.alive.big) this.alive.little = false;
          if (
            it.moved === 2 ||
            (it.moved === 1 &&
              (it.onBig === 2 || !this.alive.big) &&
              (it.onLittle === 2 || !this.alive.little))
          ) {
            this.alive.little = false;
            this.alive.big = false;
          }
        }
      }

      if (malaZila !== this.alive.little) {
        this.items[this.littleIdx]!.kind = Kind.light;
        this.kostra.little = true;
        this.rozpad.little = ZAC_ROZPAD;
      }
      if (velkaZila !== this.alive.big) {
        this.items[this.bigIdx]!.kind = Kind.light;
        this.kostra.big = true;
        this.rozpad.big = ZAC_ROZPAD;
      }
    } while (!(this.alive.little === malaPom && this.alive.big === velkaPom));

    let vysl = false;
    this.dopad = 0;
    for (let i = 1; i <= this.itemCount; i++) {
      const it = this.items[i]!;
      if (this.pushedOut(it)) continue; // URoom.pas:26739
      if (it.stoned || !notFish(it)) continue;
      if ((it.onLittle === 0 || !this.alive.little) && (it.onBig === 0 || !this.alive.big)) {
        vysl = true;
        it.dir = Dir.down;
      }
    }
    for (let i = 1; i <= this.itemCount; i++) {
      const it = this.items[i]!;
      // NOTE: the Delphi deliberately has NO (gspec<>9)or(spec<>11) guard on this
      // last loop (URoom.pas:26749) — a pushed-out item still gets its Moved reset.
      if (it.moved === 2 && it.dir === Dir.no && notFish(it)) {
        if (this.dopad === 0) this.dopad = 1;
        if (it.kind === Kind.heavy) this.dopad = 2;
      }
      it.moved = it.dir === Dir.down ? 2 : 0;
    }
    return vysl;
  }

  /**
   * while padani do posun_predmety (URoom.pas:1937/24250): settle gravity.
   *
   * Bounded on purpose. Gravity always terminates (every pass moves at least one
   * item down a cell, and the room is finite), so overrunning means the physics
   * state is corrupt — and an unbounded spin here freezes the browser tab, the
   * worst failure mode a player can hit. Throw a diagnosable error instead.
   */
  fallToRest(): void {
    let guard = 0;
    while (this.padani()) {
      this.commitMove();
      if (++guard > MAX_SETTLE_PASSES) {
        throw new Error(
          `fallToRest did not settle after ${MAX_SETTLE_PASSES} passes ` +
            `(room ${this.width}x${this.height}, gspec=${this.gspec})`,
        );
      }
    }
  }

  /** priprav_dalsi_pohyb (URoom.pas:26505): clear every item's pending dir. */
  clearAllDirs(): void {
    this.clearDirs();
  }

  /**
   * Advance the disintegration of any crushed fish's skeleton (rozpad counts
   * down by rychlost_rozpadu=30 per game tick, URoom.pas:24330-24333). From
   * zac_rozpad=400 that erodes the skeleton in ~14 ticks. Returns true once every
   * dead fish has fully disintegrated (rozpad 0) — the cue to restart the room.
   */
  tickRozpad(amount = 30): boolean {
    let anyDead = false;
    let allGone = true;
    for (const which of ['little', 'big'] as const) {
      if (this.kostra[which]) {
        anyDead = true;
        this.rozpad[which] = Math.max(0, this.rozpad[which] - amount);
        if (this.rozpad[which] > 0) allGone = false;
      }
    }
    return anyDead && allGone;
  }

  /**
   * Remove any fully-disintegrated skeleton from the grid (URoom.pas:24421-24430:
   * `if kostra[r] and rozpad[r]=0 then kostra[r]:=false`, then `stav_ma_padat`).
   * Once a skeleton is gone it no longer supports objects, so the caller re-runs
   * gravity. Returns true if any skeleton was cleared.
   */
  clearErodedSkeletons(): boolean {
    let cleared = false;
    for (const which of ['little', 'big'] as const) {
      if (this.kostra[which] && this.rozpad[which] === 0) {
        this.kostra[which] = false;
        cleared = true;
      }
    }
    return cleared;
  }

  // ----- pathfinding (najdi_smer et al., URoom.pas:26400-26484) -----

  /** Fish footprint in cells: little = 3x1, big = 4x2 (URoom.pas:26403-26404). */
  private fishSize(which: 'little' | 'big'): { dx: number; dy: number } {
    return which === 'little' ? { dx: 3, dy: 1 } : { dx: 4, dy: 2 };
  }

  /**
   * priprav_hledani (URoom.pas:26400): clear the fish's own footprint, dilate
   * every obstacle by the fish size into ITEM_BLOCK (so BFS can work on the
   * fish's top-left corner), and mark the destination corner cells ITEM_DEST.
   */
  private preparePathfind(which: 'little' | 'big', cilx: number, cily: number): void {
    const { dx, dy } = this.fishSize(which);
    const idx = which === 'little' ? this.littleIdx : this.bigIdx;
    const fx = this.items[idx]!.x;
    const fy = this.items[idx]!.y;
    const g = this.grid;

    for (let i = 1; i <= dx; i++) for (let j = 1; j <= dy; j++) g.set(fx + i - 1, fy + j - 1, ITEM_WATER);

    for (let x = 1; x <= this.width + 1; x++) {
      for (let y = 1; y <= this.height + 1; y++) {
        if (g.get(x, y) === ITEM_WATER) continue;
        for (let i = 1; i <= dx; i++) {
          for (let j = 1; j <= dy; j++) {
            if (x + 1 - i >= 0 && y + 1 - j >= 0 && g.get(x + 1 - i, y + 1 - j) === ITEM_WATER) {
              g.set(x + 1 - i, y + 1 - j, ITEM_BLOCK);
            }
          }
        }
      }
    }

    for (let i = 1; i <= dx; i++) {
      for (let j = 1; j <= dy; j++) {
        if (cilx + 1 - i >= 0 && cily + 1 - j >= 0 && g.get(cilx + 1 - i, cily + 1 - j) === ITEM_WATER) {
          g.set(cilx + 1 - i, cily + 1 - j, ITEM_DEST);
        }
      }
    }
  }

  /**
   * najdi_smer (URoom.pas:26449): BFS from the fish toward (cilx,cily). Each
   * queued cell carries the FIRST step direction taken from the fish; the first
   * direction that reaches a destination cell is returned (dir_no if none). The
   * fish re-plans one step per tick, so this yields the next move to make.
   */
  findDir(which: 'little' | 'big', cilx: number, cily: number): number {
    this.buildGrid();
    if (this.grid.get(cilx, cily) !== ITEM_WATER) {
      return Dir.no;
    }
    this.preparePathfind(which, cilx, cily);

    const idx = which === 'little' ? this.littleIdx : this.bigIdx;
    const g = this.grid;
    const qx: number[] = [];
    const qy: number[] = [];
    const qs: number[] = [];
    qx.push(this.items[idx]!.x);
    qy.push(this.items[idx]!.y);
    qs.push(0);
    let head = 0;
    let vysl = 0;

    const zkus = (x: number, y: number, s: number, s1: number): void => {
      if (s === 0) s = s1;
      const cell = g.get(x, y);
      if (cell === ITEM_DEST) {
        if (vysl === 0) vysl = s;
      } else if (cell === ITEM_WATER) {
        g.set(x, y, ITEM_MARK);
        qx.push(x);
        qy.push(y);
        qs.push(s);
      }
    };

    while (head < qx.length && vysl === 0) {
      const x = qx[head]!;
      const y = qy[head]!;
      const s = qs[head]!;
      head++;
      zkus(x - 1, y, s, Dir.left);
      zkus(x + 1, y, s, Dir.right);
      zkus(x, y - 1, s, Dir.up);
      zkus(x, y + 1, s, Dir.down);
    }

    this.buildGrid(); // restore the occupancy grid
    return vysl;
  }

  /** Occupant of a cell on the current grid: an item index, ITEM_WALL, or ITEM_WATER. */
  cellOccupant(x: number, y: number): number {
    this.buildGrid();
    return this.grid.get(x, y);
  }

  /**
   * kontroluj_okraje (URoom.pas:23996): find an in-play fish touching a room
   * border and the direction it would exit (its footprint reaches x=0, y=0,
   * x+dx=RWidth or y+dy=RHeight). Returns null if neither fish is at an edge.
   */
  checkEdges(): { which: 'little' | 'big'; dir: number } | null {
    for (const which of ['little', 'big'] as const) {
      if (!this.alive[which]) continue;
      const idx = which === 'little' ? this.littleIdx : this.bigIdx;
      if (idx < 0) continue;
      const { dx, dy } = this.fishSize(which);
      const it = this.items[idx]!;
      let dir: number = Dir.no;
      if (it.x === 0) dir = Dir.left;
      else if (it.y === 0) dir = Dir.up;
      else if (it.x + dx === this.width) dir = Dir.right;
      else if (it.y + dy === this.height) dir = Dir.down;
      if (dir !== Dir.no) return { which, dir };
    }
    return null;
  }

  /** The fish has swum out (stav_ven end, URoom.pas:24920): venku:=true, leaves play. */
  exitFish(which: 'little' | 'big'): void {
    this.alive[which] = false;
    this.venku[which] = true;
  }

  /** True once either fish has been crushed (drives the room restart). */
  get anyFishDead(): boolean {
    return this.kostra.little || this.kostra.big;
  }

  /** Kill a fish outright (test/debug helper mirroring a crush: skeleton + rozpad). */
  killFish(which: 'little' | 'big'): void {
    const idx = which === 'little' ? this.littleIdx : this.bigIdx;
    if (idx < 0) return;
    this.alive[which] = false;
    this.kostra[which] = true;
    this.rozpad[which] = ZAC_ROZPAD;
    this.items[idx]!.kind = Kind.light;
  }

  /**
   * CanSave (URoom.pas:26900-26906): saving is only allowed from a recoverable
   * position — both fish alive, or one alive with the other already out of the
   * room (venku). A dead fish therefore blocks saving, which matters in the port
   * because a lone survivor deliberately keeps playing. A gspec=9 push-out room
   * additionally blocks it once the last item has been shoved out (vytlacit<=0),
   * i.e. while the win is resolving.
   */
  get canSave(): boolean {
    if (this.gspec === 9 && this.vytlacit <= 0) return false;
    return (
      (this.alive.big && this.alive.little) ||
      (this.alive.big && this.venku.little) ||
      (this.venku.big && this.alive.little)
    );
  }

  /** True once both fish have exited the room — the room is solved. */
  get won(): boolean {
    return this.venku.little && this.venku.big;
  }

  // ----- script geometry helpers (URoom.pas:2087-2147) -----

  /** minmax (URoom.pas:2087): bounding cell range of an item's footprint. */
  private minmax(obj: number): { minx: number; maxx: number; miny: number; maxy: number } {
    const it = this.items[obj]!;
    let minx = Infinity;
    let maxx = -1;
    let miny = Infinity;
    let maxy = -1;
    for (const f of it.fields) {
      const px = it.x + f.x;
      const py = it.y + f.y;
      if (px < minx) minx = px;
      if (px > maxx) maxx = px;
      if (py < miny) miny = py;
      if (py > maxy) maxy = py;
    }
    return { minx, maxx, miny, maxy };
  }

  /** xdist (URoom.pas:2108): horizontal gap between two items (0 if overlapping). */
  xdist(a: number, b: number): number {
    const m1 = this.minmax(a);
    const m2 = this.minmax(b);
    if (m1.maxx < m2.minx) return m1.maxx - m2.minx;
    if (m2.maxx < m1.minx) return m1.minx - m2.maxx;
    return 0;
  }

  /** ydist (URoom.pas:2118). */
  ydist(a: number, b: number): number {
    const m1 = this.minmax(a);
    const m2 = this.minmax(b);
    if (m1.maxy < m2.miny) return m1.maxy - m2.miny;
    if (m2.maxy < m1.miny) return m1.miny - m2.maxy;
    return 0;
  }

  /** dist (URoom.pas:2128): Chebyshev-style max of the axis gaps. */
  dist(a: number, b: number): number {
    return Math.max(Math.abs(this.xdist(a, b)), Math.abs(this.ydist(a, b)));
  }

  /** look_at (URoom.pas:2138): is a fish facing toward an object? */
  lookAt(fishIdx: number, obj: number): boolean {
    const which = fishIdx === this.littleIdx ? 'little' : fishIdx === this.bigIdx ? 'big' : null;
    if (!which) return false;
    const right = this.facingRight[which];
    const xd = this.xdist(fishIdx, obj);
    return (right && xd < 0) || (!right && xd > 0);
  }
}
