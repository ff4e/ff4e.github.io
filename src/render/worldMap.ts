/**
 * The world map (UMain.pas PaintBox1Paint): faithful compositing of the branch
 * map and room nodes with the updatuj_soutez progression.
 *
 * The 640x480 map is two layers — mapa-0 (dark) and mapa-1 (lit) — selected
 * per-pixel by the mask: `dest = RTable[maska] ? mapa1 : mapa0` (AsmRadek,
 * UMain.pas:1317); a branch's region lights once it's enabled. Room nodes are
 * then drawn per Resena state: solved (n0), the single reachable "next" room
 * pulsing (n1..n4), and hidden rooms not drawn at all (Vykul, UMain.pas:1522).
 */
import type { Bmp } from '../data/bmp.js';
import {
  BRANCHES,
  BRANCH_MASK,
  KULXY,
  N_BRANCHES,
  computeResena,
  computeHloubka,
  branchEnabled,
  RES_SOLVED,
  RES_REACHABLE,
  RES_CHEAT,
} from '../data/world.js';

export const MAP_W = 640;
export const MAP_H = 480;

/**
 * The four map-corner "buttons" (UMain.pas PaintBox1MouseMove:1636): the mouse
 * position's colour in `maska.bmp` selects a menu action. The colours are Delphi
 * VCL constants; in the shipped mask their palette indices are:
 *   clNavy(12)→intro · clTeal(9)→exit · clOlive(4)→credits · clGreen(10)→options.
 * None collide with the branch-region mask indices (BRANCH_MASK), so the corners
 * are unambiguous. (Exit can't quit a browser tab, so it is left unwired here.)
 */
export type MapAction = 'intro' | 'exit' | 'credits' | 'options';
const CORNER_ACTION: Readonly<Record<number, MapAction>> = {
  12: 'intro',
  9: 'exit',
  4: 'credits',
  10: 'options',
};
/** Reverse of CORNER_ACTION: the mask palette index a corner action lights up. */
const ACTION_MASK: Readonly<Record<MapAction, number>> = {
  intro: 12,
  exit: 9,
  credits: 4,
  options: 10,
};

const NODE_SOLVED = 0; // n0.bmp (kVyresena)
const NODE_CHEAT = 1; // n1.bmp (kCheat)
const HIT_RADIUS = 13; // UMain.pas:1655
/** kPul pulses through Kul[2..5] = n1..n4 (UMain.pas:201-203); we ping-pong n1..n4. */
const PULSE_FRAMES = [1, 2, 3, 4, 3, 2] as const;

export class WorldMap {
  private readonly hloubka = computeHloubka();

  /**
   * The largest reveal depth of any room. Once the reveal counter (`depth`) passes
   * this, the map is fully revealed and further `depth` increases produce identical
   * frames — used by the caller to stop re-rendering after the reveal completes.
   */
  readonly maxDepth = this.hloubka.reduce((m, br) => Math.max(m, ...br), 0);

  constructor(
    private readonly mapa0: Bmp,
    private readonly mapa1: Bmp,
    private readonly maska: Bmp,
    private readonly nodes: readonly Bmp[], // n0..n4
  ) {}

  /** The shared menu palette (mapa-0), also used by the info panel + name plaques. */
  get palette(): readonly { r: number; g: number; b: number }[] {
    return this.mapa0.palette;
  }

  /**
   * Compose the map + nodes to an RGBA buffer for the given solved rooms.
   * `pulse` advances the reachable-node pulse (kPul); `depth` is the reveal
   * counter (UMain.pas Depth) — a branch region lights when depth+1 >= its
   * first room's Hloubka, and a node draws when depth >= its Hloubka. Pass a
   * large depth (default) for a fully-revealed map. `hoverCorner` lights the
   * hovered corner button by flipping its mask region to the lit `mapa-1` layer
   * (UMain.pas:1448 `case dAkce of daIntro: RTable[12]:=1; ...`). `drawNodes`
   * false skips the room balls (Vykul), and `litRegions` false additionally forces
   * the base map fully unlit (RTable all zero) — both used while the record panel is
   * open (InfoMode>0, UMain.pas:1446), leaving only the name plaque + panel.
   */
  render(
    solved: ReadonlySet<number>,
    pulse = 0,
    depth = Number.MAX_SAFE_INTEGER,
    cheated: ReadonlySet<number> = new Set(),
    hoverCorner: MapAction | null = null,
    drawNodes = true,
    litRegions = true,
  ): Uint8ClampedArray {
    const resena = computeResena(solved, cheated);
    // RTable[maskValue] = 1 where that branch's region is enabled AND revealed.
    const rtable = new Uint8Array(16);
    // While the record panel is open Delphi zeroes RTable entirely (InfoMode>0,
    // UMain.pas:1446), so the base map draws fully unlit — no lit branches, no
    // corner highlight, no painted node artwork.
    if (litRegions) {
      for (let b = 0; b < N_BRANCHES; b++) {
        if (branchEnabled(resena, b) && depth + 1 >= this.hloubka[b]![0]!) rtable[BRANCH_MASK[b]!] = 1;
      }
      // Light the hovered corner button (the same lit-layer mechanism as branches).
      if (hoverCorner) rtable[ACTION_MASK[hoverCorner]] = 1;
    }
    // Per-pixel layer select, then palette to RGBA (both maps share the menu palette).
    const n = MAP_W * MAP_H;
    const rgba = new Uint8ClampedArray(n * 4);
    const pal = this.mapa0.palette;
    for (let i = 0; i < n; i++) {
      const idx = rtable[this.maska.pixels[i]!] ? this.mapa1.pixels[i]! : this.mapa0.pixels[i]!;
      const c = pal[idx]!;
      rgba[i * 4] = c.r;
      rgba[i * 4 + 1] = c.g;
      rgba[i * 4 + 2] = c.b;
      rgba[i * 4 + 3] = 255;
    }
    // Room nodes: solved (n0) or the reachable "next" room pulsing (n1..n4),
    // revealed from the start outward as `depth` rises (Hloubka gate). Skipped while
    // the info panel is open (InfoMode>0, UMain.pas:1494 draws only the panel).
    const pulseSprite = PULSE_FRAMES[pulse % PULSE_FRAMES.length]!;
    if (drawNodes)
      for (let b = 0; b < N_BRANCHES; b++) {
      if (!branchEnabled(resena, b)) continue;
      const br = BRANCHES[b]!;
      for (let j = 0; j < br.length; j++) {
        if (this.hloubka[b]![j]! > depth) continue; // not yet revealed
        const state = resena[b]![j]!;
        if (state === RES_SOLVED) this.blitNode(rgba, this.nodes[NODE_SOLVED]!, b, j);
        else if (state === RES_CHEAT) this.blitNode(rgba, this.nodes[NODE_CHEAT]!, b, j);
        else if (state === RES_REACHABLE) this.blitNode(rgba, this.nodes[pulseSprite]!, b, j);
        // hidden rooms (RES_HIDDEN) are not drawn (soutez mode).
      }
    }
    return rgba;
  }

  private blitNode(rgba: Uint8ClampedArray, sprite: Bmp, branch: number, j: number): void {
    const room = BRANCHES[branch]!.start + j;
    const x0 = KULXY[(room - 1) * 2]! - 9;
    const y0 = KULXY[(room - 1) * 2 + 1]! - 9;
    const transparent = sprite.pixels[0]!; // Vykul: top-left pixel is the transparent colour
    for (let sy = 0; sy < sprite.h; sy++) {
      const dy = y0 + sy;
      if (dy < 0 || dy >= MAP_H) continue;
      for (let sx = 0; sx < sprite.w; sx++) {
        const idx = sprite.pixels[sy * sprite.w + sx]!;
        if (idx === transparent) continue;
        const dx = x0 + sx;
        if (dx < 0 || dx >= MAP_W) continue;
        const c = sprite.palette[idx]!;
        const d = (dy * MAP_W + dx) * 4;
        rgba[d] = c.r;
        rgba[d + 1] = c.g;
        rgba[d + 2] = c.b;
        rgba[d + 3] = 255;
      }
    }
  }

  /** The room number at map (x,y) — only reachable-or-solved nodes are clickable. */
  hitTest(x: number, y: number, solved: ReadonlySet<number>, cheated: ReadonlySet<number> = new Set()): number {
    const resena = computeResena(solved, cheated);
    for (let b = 0; b < N_BRANCHES; b++) {
      if (!branchEnabled(resena, b)) continue;
      const br = BRANCHES[b]!;
      for (let j = 0; j < br.length; j++) {
        if (resena[b]![j] === 0) continue; // hidden: not clickable
        const room = br.start + j;
        const dx = x - KULXY[(room - 1) * 2]!;
        const dy = y - KULXY[(room - 1) * 2 + 1]!;
        if (dx * dx + dy * dy < HIT_RADIUS * HIT_RADIUS) return room;
      }
    }
    return 0;
  }

  /** The corner-button action at map (x,y), or null (UMain.pas:1636 mask colour). */
  cornerAction(x: number, y: number): MapAction | null {
    if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return null;
    return CORNER_ACTION[this.maska.pixels[y * MAP_W + x]!] ?? null;
  }
}
