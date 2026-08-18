/**
 * Registry of ported per-room scripts, keyed by RoomName (Desc[].Jmeno).
 * Rooms without an entry simply have no scripted behaviour yet.
 *
 * Each room's recorded solution is attached here rather than authored into the room
 * module: the modules are hand-maintained and read whole, so an opaque multi-kB move
 * string in one would be paid for on every change to it, while a generated table nobody
 * opens is free. `ROOM_SOLUTIONS` is that table (`src/rooms/solutions.ts`), keyed by the
 * same `Jmeno`, so the moves still travel with the room's data as `RoomScript.solution`.
 */
import type { RoomScript } from '../core/script.js';
import { ROOM_SOLUTIONS } from './solutions.js';
import { UTES } from './utes.js';
import { PRVNI } from './prvni.js';
import { KUFRIK } from './kufrik.js';
import { SCHODY } from './schody.js';
import { KNIHOVNA } from './knihovna.js';
import { PRAVIDLA } from './pravidla.js';
import { VRAK } from './vrak.js';
import { KOSTE } from './koste.js';
import { WC } from './wc.js';
import { ZRC } from './zrc.js';
import { PARTY1 } from './party1.js';
import { SVATBA } from './svatba.js';
import { POTOPENA } from './potopena.js';
import { LETADLO } from './letadlo.js';
import { DEUTSCHE } from './deutsche.js';
import { BATYSKAF } from './batyskaf.js';
import { DRAKAR1 } from './drakar1.js';
import { PARTY2 } from './party2.js';
import { DRAKAR } from './drakar.js';
import { LODE_ROOM } from './lode.js';
import { ZDVIZ1 } from './zdviz1.js';
import { ZDVIZ2 } from './zdviz2.js';
import { UFO } from './ufo.js';
import { SLOUPY } from './sloupy.js';
import { VES } from './ves.js';
import { PYRAMIDA } from './pyramida.js';
import { DIRY } from './diry.js';
import { SECRET } from './secret.js';
import { VITEJTE1 } from './vitejte1.js';
import { SPUNT } from './spunt.js';
import { RECYCLED } from './recycled.js';
import { NCP } from './ncp.js';
import { KANKAN } from './kankan.js';
import { JEDNICKY } from './jednicky.js';
import { BLUDISTE } from './bludiste.js';
import { MIKRO } from './mikro.js';
import { KORALY } from './koraly.js';
import { ZELVA } from './zelva.js';
import { NOGROUND } from './noground.js';
import { ODPADKY } from './odpadky.js';
import { POCITAC } from './pocitac.js';
import { BATHROOM } from './bathroom.js';
import { SMETAK } from './smetak.js';
import { PUCLIK } from './puclik.js';
import { BARELY } from './barely.js';
import { DELA } from './dela.js';
import { TRUP } from './trup.js';
import { MAPA } from './mapa.js';
import { KUCHYNE } from './kuchyne.js';
import { KAJUTA2 } from './kajuta2.js';
import { VLADOVA } from './vladova.js';
import { KAJUTA1 } from './kajuta1.js';
import { REAKTOR } from './reaktor.js';
import { PAPRSKY } from './paprsky.js';
import { STEEL } from './steel.js';
import { POHON } from './pohon.js';
import { MOTOR } from './motor.js';
import { CHODBA } from './chodba.js';
import { BANKA } from './banka.js';
import { BOTTLES } from './bottles.js';
import { ZAVAL } from './zaval.js';
import { TRUHLA } from './truhla.js';
import { JESKYNE } from './jeskyne.js';
import { GRAL } from './gral.js';
import { PUZZLE } from './puzzle.js';
import { WARCR2 } from './warcr2.js';
import { DISKETA } from './disketa.js';
import { SCORE } from './score.js';
import { TETRIS } from './tetris.js';
import { ZAVER } from './zaver.js';
import { ZX } from './zx.js';
import { WIN } from './win.js';

const RAW_SCRIPTS: Record<string, RoomScript> = {
  [UTES.name]: UTES,
  [PRVNI.name]: PRVNI,
  [KUFRIK.name]: KUFRIK,
  [SCHODY.name]: SCHODY,
  [KNIHOVNA.name]: KNIHOVNA,
  [PRAVIDLA.name]: PRAVIDLA,
  [VRAK.name]: VRAK,
  [KOSTE.name]: KOSTE,
  [WC.name]: WC,
  [ZRC.name]: ZRC,
  [PARTY1.name]: PARTY1,
  [SVATBA.name]: SVATBA,
  [POTOPENA.name]: POTOPENA,
  [LETADLO.name]: LETADLO,
  [DEUTSCHE.name]: DEUTSCHE,
  [BATYSKAF.name]: BATYSKAF,
  [DRAKAR1.name]: DRAKAR1,
  [PARTY2.name]: PARTY2,
  [DRAKAR.name]: DRAKAR,
  [LODE_ROOM.name]: LODE_ROOM,
  [ZDVIZ1.name]: ZDVIZ1,
  [ZDVIZ2.name]: ZDVIZ2,
  [UFO.name]: UFO,
  [SLOUPY.name]: SLOUPY,
  [VES.name]: VES,
  [PYRAMIDA.name]: PYRAMIDA,
  [DIRY.name]: DIRY,
  [SECRET.name]: SECRET,
  [VITEJTE1.name]: VITEJTE1,
  [SPUNT.name]: SPUNT,
  [RECYCLED.name]: RECYCLED,
  [NCP.name]: NCP,
  [KANKAN.name]: KANKAN,
  [JEDNICKY.name]: JEDNICKY,
  [BLUDISTE.name]: BLUDISTE,
  [MIKRO.name]: MIKRO,
  [KORALY.name]: KORALY,
  [ZELVA.name]: ZELVA,
  [NOGROUND.name]: NOGROUND,
  [ODPADKY.name]: ODPADKY,
  [POCITAC.name]: POCITAC,
  [BATHROOM.name]: BATHROOM,
  [SMETAK.name]: SMETAK,
  [PUCLIK.name]: PUCLIK,
  [BARELY.name]: BARELY,
  [DELA.name]: DELA,
  [TRUP.name]: TRUP,
  [MAPA.name]: MAPA,
  [KUCHYNE.name]: KUCHYNE,
  [KAJUTA2.name]: KAJUTA2,
  [VLADOVA.name]: VLADOVA,
  [KAJUTA1.name]: KAJUTA1,
  [REAKTOR.name]: REAKTOR,
  [PAPRSKY.name]: PAPRSKY,
  [STEEL.name]: STEEL,
  [POHON.name]: POHON,
  [MOTOR.name]: MOTOR,
  [CHODBA.name]: CHODBA,
  [BANKA.name]: BANKA,
  [BOTTLES.name]: BOTTLES,
  [ZAVAL.name]: ZAVAL,
  [TRUHLA.name]: TRUHLA,
  [JESKYNE.name]: JESKYNE,
  [GRAL.name]: GRAL,
  [PUZZLE.name]: PUZZLE,
  [WARCR2.name]: WARCR2,
  [DISKETA.name]: DISKETA,
  [SCORE.name]: SCORE,
  [TETRIS.name]: TETRIS,
  [ZAVER.name]: ZAVER,
  [ZX.name]: ZX,
  [WIN.name]: WIN,
};

const SCRIPTS: Record<string, RoomScript> = Object.fromEntries(
  Object.entries(RAW_SCRIPTS).map(([name, s]) => {
    const solution = ROOM_SOLUTIONS[name];
    return [name, solution ? { ...s, solution } : s];
  }),
);

/**
 * What a room's recorded solution is, and why it might not be there. One question in one
 * place, so callers never have to distinguish "no script module" from "no recording".
 *
 * `missing` means no recording exists for that room. That is ZAVER #71 and SCORE #72 — the
 * ending and the results screens, which are not puzzles — and any name that is not a room.
 */
export function solutionFor(name: string): { moves: string; known: 'ok' } | { moves: null; known: 'missing' } {
  const moves = SCRIPTS[name]?.solution;
  return moves ? { moves, known: 'ok' } : { moves: null, known: 'missing' };
}

export function roomScript(name: string): RoomScript | undefined {
  return SCRIPTS[name];
}
