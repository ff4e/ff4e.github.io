/**
 * Which control-panel button a KEYBOARD command lights.
 *
 * In the original the lit button is not a mouse effect at all. The room's rest tick
 * (stav_klid) asks `DalsiPrikaz` for the next command — from the mouse, the room image
 * or either keyboard handler alike — and then hands that command to
 * `Ovl.AktualizujPanel` (URoom.pas:24800-24812): a fish direction lights its arrow,
 * `akce_switch`/`save`/`load`/`exit`/`restart` light their band (`tlac` -1..-5,
 * Uovl.pas:338-347), and a rest tick that dispatched nothing (`kdo=0`, which is also what
 * a busy fish, a dead one, `not CanSave` or `not CanLoad` reduce a command to) passes 0
 * and puts the panel back. So a held key keeps its button lit, a tap lights it for the
 * move it started, and the light goes out at the first rest tick with nothing to do.
 *
 * The port's pointer handler keeps its own press-until-release light (`ui.panelPressed`),
 * which wins over this one in `panelState`. This module is only the keyboard's half.
 *
 * Pure state, no imports: `movement.ts` and `logicTick.ts` reach it, and the node-only
 * unit tests import those.
 */

let lit = 0;
/**
 * Set by a command that ran OUTSIDE the rest tick. The port runs Space/F2/F3/Backspace
 * straight from keydown, where the original queued them for the next rest tick and lit
 * the button there, so without this the very next rest tick — possibly a millisecond
 * later — would put the light out before a frame could show it. One rest tick of grace
 * stands in for the tick the original would have dispatched it on.
 */
let fresh = false;

/** Light `region` (a `hud.ts` OBLMYSI index) for a command run straight from the keyboard. */
export function lightPanel(region: number): void {
  lit = region;
  fresh = true;
}

/**
 * One rest tick (AktualizujPanel at the end of stav_klid): `dispatched` is the region the
 * held key just drove on this tick, or 0 if it drove nothing.
 */
export function settlePanelLight(dispatched: number): void {
  if (dispatched) {
    lit = dispatched;
    fresh = false;
  } else if (fresh) fresh = false;
  else lit = 0;
}

export function clearPanelLight(): void {
  lit = 0;
  fresh = false;
}

/** The region the keyboard has lit, or 0. */
export function panelLight(): number {
  return lit;
}
