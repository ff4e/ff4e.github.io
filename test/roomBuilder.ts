/**
 * Test helper: build a synthetic in-memory room for deterministic physics tests.
 *
 * The physics (push, gravity, crushing, exit) only needs each item's `kind` and
 * `fields` (occupied cells) plus the room size — no real bitmaps — so we can
 * construct tiny, named scenarios instead of loading FFR files.
 *
 * Item 0 is always the wall. Fish default to their real footprints (little 3x1,
 * big 4x2); other objects default to a single cell. Cells are (x,y) offsets from
 * the item's top-left.
 */
import { Room } from '../src/core/room.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

export type ItemKind = 'wall' | 'static' | 'light' | 'heavy' | 'little' | 'big';

export interface ItemSpec {
  kind: ItemKind;
  x: number;
  y: number;
  /** Occupied cells (x,y offsets); defaults per kind. */
  cells?: [number, number][];
}

const KIND: Record<ItemKind, number> = {
  wall: Kind.static,
  static: Kind.static,
  light: Kind.light,
  heavy: Kind.heavy,
  little: Kind.little,
  big: Kind.big,
};

function defaultCells(kind: ItemKind): [number, number][] {
  if (kind === 'little') return [[0, 0], [1, 0], [2, 0]];
  if (kind === 'big') return [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]];
  return [[0, 0]];
}

function toItem(spec: ItemSpec): FfrItem {
  const cells = spec.cells ?? defaultCells(spec.kind);
  return {
    xStart: spec.x,
    yStart: spec.y,
    bmp: 2,
    mask: 0,
    kind: KIND[spec.kind],
    fields: cells.map(([x, y]) => ({ x, y })),
  };
}

export interface RoomSpec {
  w: number;
  h: number;
  /** Interior wall cells (the outer border is always solid). */
  walls?: [number, number][];
  items: ItemSpec[];
  facing?: { small: boolean; big: boolean };
}

const STUB_BMP: FfrBitmap = { w: 1, h: 1, pixels: new Uint8Array(1), padded: 0 };

/** Build a Room from a compact scenario spec. */
export function makeRoom(spec: RoomSpec): Room {
  const wall: FfrItem = {
    xStart: 0,
    yStart: 0,
    bmp: 1,
    mask: 0,
    kind: Kind.static,
    fields: (spec.walls ?? []).map(([x, y]) => ({ x, y })),
  };
  const items: FfrItem[] = [wall, ...spec.items.map(toItem)];
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: spec.facing ?? { small: true, big: true },
    wamp: 0,
    wper: 0,
    wspd: 0,
    width: spec.w,
    height: spec.h,
    itemCount: items.length - 1,
    items,
    numBmp: 3,
    bitmaps: [null, STUB_BMP, STUB_BMP],
    heads: { big: [], small: [] },
    bodies: { big: [], small: [] },
    palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 })),
  };
  return new Room(ffr);
}

/** The (x,y) of an item index (1 = first non-wall item). */
export function pos(room: Room, i: number): { x: number; y: number } {
  const it = room.items[i]!;
  return { x: it.x, y: it.y };
}
