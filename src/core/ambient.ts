/**
 * Small audio-feedback decisions, extracted as pure functions so they can be
 * unit-tested deterministically (the host wires them to Math.random + audio).
 */

/** Pascal-style random: 0..n-1. */
export type Rnd = (n: number) => number;

/**
 * Zvuky_okoli (URoom.pas:23736): the ambient underwater bubble. 5% chance per
 * tick of a random `sp-bubles1..6`, but only if none is already sounding on the
 * bubble channel. Returns the sound name to play, or null.
 */
export function maybeBubble(rnd: Rnd, bubblePlaying: boolean): string | null {
  if (bubblePlaying) return null;
  if (rnd(100) >= 5) return null;
  return `sp-bubles${rnd(6) + 1}`;
}

/** Context for the exit cheer (mirrors the relevant zije[]/venku[] + gum flag). */
export interface CheerCtx {
  aliveOther: boolean; // the partner is still alive
  venkuOther: boolean; // the partner has already exited
  venkuLittle: boolean; // the little fish has exited (for the jo-v-4 variant)
  zvykacka: boolean; // the chewing-gum easter-egg flag is set
}

/**
 * The line a fish says as it swims out (jo-m/jo-v, URoom.pas:24393-24410): only
 * if the partner is alive or already out. The little fish picks jo-m-0..4; the
 * big fish jo-v-0..3, with a 15% chance of jo-v-4 when its partner is already
 * out. If the gum easter egg is armed and the partner is out, the little fish
 * quips `ob-m-zvykacka` instead (and the flag clears).
 */
export function exitCheer(
  which: 'little' | 'big',
  ctx: CheerCtx,
  rnd: Rnd,
): { sound: string | null; clearGum: boolean } {
  if (ctx.zvykacka && ctx.venkuOther) return { sound: 'ob-m-zvykacka', clearGum: true };
  if (!(ctx.aliveOther || ctx.venkuOther)) return { sound: null, clearGum: false };
  if (which === 'little') return { sound: `jo-m-${rnd(5)}`, clearGum: false };
  if (rnd(100) < 15 && ctx.venkuLittle) return { sound: 'jo-v-4', clearGum: false };
  return { sound: `jo-v-${rnd(4)}`, clearGum: false };
}
