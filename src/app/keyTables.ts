/**
 * The constant tables: which key moves which fish, the minigame's key map, which panel
 * region each touch button sends, and the two small constants the room scripts read.
 *
 * Pure data — no state, no side effects, nothing to initialise. They live here because
 * they were carrying edges out of `main.ts`'s core purely by being declared there:
 * the keyboard, the pointer and the room loader all reach for them, and a constant
 * table is the cheapest possible thing to stop reaching into `main.ts` for.
 *
 * `TOUCH_REGIONS` arrived for the same reason one step removed: it was declared in
 * `touchButtons.ts`, which reaches the DOM through `loadingUi.ts`, so the unit test that
 * checks the markup against it could not import it without a document. Pure data that
 * only a DOM module happens to use is exactly what this file is for.
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

/**
 * Which panel region each in-room touch button sends (`src/app/touchButtons.ts`), by the
 * name of its verb. The regions are Uovl's, dispatched through `main.ts`'s `panelAction`
 * exactly as a mouse click on the faithful panel is.
 *
 * The buttons themselves are driven by the `data-region` attributes in `index.html`, not
 * by this table — reading the DOM is what lets the markup own the order and the labels.
 * The table exists so that the pairing can be CHECKED: `test/touchButtons.test.ts`
 * asserts the markup against it, which is the only thing standing between a transposed
 * digit and a Save button that quietly loads. Delete one and the other is decoration.
 */
export const TOUCH_REGIONS = {
  map: 14,
  save: 12,
  load: 13,
  options: 16,
  restart: 15,
  // Undo has no counterpart in the original's panel — the 1998 game has no undo at all,
  // so there is no `Uovl.pas` region to be faithful to. 24 is the first number past the
  // whole range the panel uses (1-23, the Options sub-panel taking 17-23), which keeps it
  // clear of `hud.ts`'s `hitTest` — hard-capped at NOBLMYSI = 23 — by construction.
  undo: 24,
} as const;
