/**
 * The menu smoke's part for the top bar's slide (`barSlide.ts`): run on a clock of its own,
 * moved by hand, in a room with the remote last. The rest of the menu smoke runs the menus
 * with no slide, each state drawn as it rests.
 *
 * It checks what the slide must not change as much as the slide: Back opens the bar at
 * once, a press mid-slide is the bar's, and Back closes it at once — a move made while it
 * slides out moves the fish. The slide draws nothing new (no shape, glyph or icon is
 * rasterised on a frame of it), turns round from where it is when Back is pressed again
 * halfway, and finishes over the map when the bar's World map takes the room away.
 */
import { BAR_SLIDE_MS } from './barSlide.js';
import { BAR_ITEMS, menuOpen, topMenu } from './menus.js';
import { currentCost } from './uiCost.js';
import type { UiOp } from './uiDraw.js';
import { setBarSlide } from './uiLayer.js';
import { t } from './uiStrings.js';

export interface SlideSmoke {
  check(ok: boolean, what: string): void;
  tap(code: string): Promise<void>;
  /** The UI layer as a frame draws it now (over the room or the map), and where its legend begins. */
  paint(): { ops: readonly UiOp[]; legendAt: number; surface: unknown } | null;
  /** Try each direction until the active fish moves; whether one did. */
  moveFish(): Promise<boolean>;
  /** Focus the open bar's World map and press it. */
  pressWorldMap(): Promise<void>;
  /** Where the slide's frames are kept, as `.rgba` (the menu smoke's `--smoke-out`). */
  save(name: string, surface: unknown): void;
}

/** The top bar in a frame's ops: whether it is drawn, how far it is slid (0 at rest), and its bottom edge at rest. */
function barIn(ops: readonly UiOp[], legendAt: number): { drawn: boolean; dy: number; bottom: number } {
  const own = ops.slice(0, legendAt);
  const drawn = own.some((op) => op[0] === 'text' && op[1] === t('worldMap'));
  const slid = own.find((op) => op[0] === 'slide');
  const rects = own.filter((op) => op[0] === 'rect');
  const bottom = Math.max(0, ...rects.map((op) => (op[2] as number) + (op[4] as number)));
  return { drawn, dy: slid ? (slid[2] as number) : 0, bottom };
}

const FRAME_MS = 1000 / 60;

export async function checkBarSlide(s: SlideSmoke): Promise<void> {
  let now = 0;
  setBarSlide(BAR_SLIDE_MS, () => now);
  type Frame = { drawn: boolean; dy: number; bottom: number; rasterised: number; surface: unknown };
  const frame = (): Frame => {
    const r = s.paint();
    const n = currentCost().n;
    return { ...barIn(r?.ops ?? [], r?.legendAt ?? 0), rasterised: n.shapes + n.glyphs + n.icons, surface: r?.surface };
  };
  /** `ms` of 60 Hz frames: the last one, with what all of them rasterised. */
  const run = (ms: number): Frame => {
    let last = frame(), rasterised = 0;
    for (let t = 0; t < ms; t += FRAME_MS) {
      now += Math.min(FRAME_MS, ms - t);
      last = frame();
      rasterised += last.rasterised;
    }
    return { ...last, rasterised };
  };
  try {
    frame();
    await s.tap('RemoteBack');
    s.check(topMenu()?.kind === 'bar', 'with the slide on, Back opens the top bar at once');
    const first = frame();
    s.check(first.drawn && first.dy < 0 && first.bottom + first.dy <= 0,
      `its first frame draws it just above the screen's top edge (moved ${first.dy} px, its bottom at ${first.bottom})`);
    const mid = run(BAR_SLIDE_MS / 3);
    s.save('bar-slide-in', mid.surface);
    s.check(mid.drawn && mid.dy > first.dy && mid.dy < 0 && mid.rasterised === 0,
      `a third of the way in it is ${-mid.dy} px up, eased (most of the way down), and nothing was rasterised for its frames`);
    const sel = (topMenu() as { sel: number }).sel;
    await s.tap('RemoteRight');
    s.check((topMenu() as { sel: number }).sel !== sel, `a press mid-slide is the bar's at once (${BAR_ITEMS[sel]} → ${BAR_ITEMS[(topMenu() as { sel: number }).sel]})`);
    const rest = run(BAR_SLIDE_MS);
    s.check(rest.drawn && rest.dy === 0, 'when the slide ends the bar rests where it is drawn without one');

    await s.tap('RemoteBack');
    s.check(!menuOpen(), 'Back closes it at once');
    const out = run(BAR_SLIDE_MS / 3);
    s.save('bar-slide-out', out.surface);
    s.check(out.drawn && out.dy < 0 && out.rasterised === 0,
      `and it slides out over the room (${-out.dy} px up a third of the way), nothing rasterised for it`);
    s.check(await s.moveFish(), 'a move made while it slides out moves the fish');
    await s.tap('RemoteBack');
    const back = frame();
    s.check(topMenu()?.kind === 'bar' && back.drawn && back.dy === out.dy,
      `Back again halfway turns it round from where it is (${back.dy} px, as it was), not from the top`);
    s.check(run(BAR_SLIDE_MS * 2).dy === 0, '...and it comes down to rest');
    await s.tap('RemoteBack');
    s.check(!run(BAR_SLIDE_MS * 2).drawn, 'closed, it is gone once the slide is over');

    await s.tap('RemoteBack');
    run(BAR_SLIDE_MS * 2);
    await s.pressWorldMap();
    const left = frame();
    const half = run(BAR_SLIDE_MS / 2);
    const gone = run(BAR_SLIDE_MS);
    s.check(left.drawn && half.drawn && half.dy < 0 && !gone.drawn && gone.surface === null,
      `when its World map takes the room away, the bar slides out over the map (${-half.dy} px up halfway), then nothing is drawn`);
  } finally {
    setBarSlide(0);
  }
}
