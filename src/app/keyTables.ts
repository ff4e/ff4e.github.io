/**
 * The constant tables: which key moves which fish, the minigame's key map, and the two
 * small constants the room scripts read.
 *
 * Pure data — no state, no side effects, nothing to initialise. They live here because
 * they were carrying edges out of `main.ts`'s core purely by being declared there:
 * the keyboard, the pointer and the room loader all reach for them, and a constant
 * table is the cheapest possible thing to stop reaching into `main.ts` for.
 */
import { Dir } from '../core/dir.js';
import type { RoomScript } from '../core/script.js';
import type { TetrisKey } from '../core/tetris.js';

/** Which fish speaks over which when both have a line queued (mluvi priorities). */
export const MLUVI_PRIOR = { little: 1, big: 2 } as const;

/** A no-op room script for rooms without ported Programky (the dialog scheduler still runs). */
export const NOOP_SCRIPT: RoomScript = { name: '', init: () => {}, prog: () => {} };

export const KEYS: Record<string, { which: 'little' | 'big'; dir: number }> = {
  KeyI: { which: 'little', dir: Dir.up },
  KeyK: { which: 'little', dir: Dir.down },
  KeyJ: { which: 'little', dir: Dir.left },
  KeyL: { which: 'little', dir: Dir.right },
  KeyW: { which: 'big', dir: Dir.up },
  KeyS: { which: 'big', dir: Dir.down },
  KeyA: { which: 'big', dir: Dir.left },
  KeyD: { which: 'big', dir: Dir.right },
};

/** The minigame's key map (Ttr.pas:458: 37/100 left, 39/102 right, 12/40/98/101
 *  rotate, 32/45/96 slam). Down rotates; there is no soft drop. */
export const TETRIS_KEYS: Record<string, TetrisKey> = {
  ArrowLeft: 'left',
  Numpad4: 'left',
  ArrowRight: 'right',
  Numpad6: 'right',
  ArrowDown: 'rotate',
  Numpad2: 'rotate',
  Numpad5: 'rotate',
  Space: 'drop',
  Insert: 'drop',
  Numpad0: 'drop',
};

/** Arrow keys move the *active* fish (ZaznamenejPrikazKlavesou #37..#40, kdo:=sys). */
export const ARROWS: Record<string, number> = {
  ArrowLeft: Dir.left,
  ArrowUp: Dir.up,
  ArrowRight: Dir.right,
  ArrowDown: Dir.down,
};
