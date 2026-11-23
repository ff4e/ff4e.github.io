/**
 * Menu repeat for a held direction: one step at once, another after `firstMs`, then one
 * every `repeatMs` while it is held — 340 ms and 140 ms, the controller spec's (#165's
 * `DirRepeat`, src/platform/gamepad.ts on that branch). A fish move is a held key instead
 * and keeps the game's own cadence; this is for menus and the map.
 */
export class DirRepeat<D extends string = string> {
  private held: D | null = null;
  private nextAt = 0;

  constructor(
    private readonly firstMs = 340,
    private readonly repeatMs = 140,
  ) {}

  /** The step `dir` produces at time `now` (an edge, or a due repeat), else null. */
  step(dir: D | null, now: number): D | null {
    if (dir === null) {
      this.held = null;
      return null;
    }
    if (dir !== this.held) {
      this.held = dir;
      this.nextAt = now + this.firstMs;
      return dir;
    }
    if (now >= this.nextAt) {
      this.nextAt = now + this.repeatMs;
      return dir;
    }
    return null;
  }
}
