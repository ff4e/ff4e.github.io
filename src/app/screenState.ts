/**
 * Which screen is showing, and the state of everything layered over it.
 *
 * ── Why this is a module, and why it is a bag rather than an API ─────────────
 * These 37 values were declared at the top level of `main.ts`, which meant no other file
 * could reach them — so anything extracted out of `main.ts` had to be handed them one
 * getter at a time, through a host object. Measured across the file, they are the most
 * far-reaching state in the game: `screen` and `worldMap` and `mapOverlay` are read by
 * two thirds of its regions.
 *
 * That is what made extraction expensive. Pricing it directly (branch
 * `keyboard-extraction-experiment`) it cost about one line of plumbing per line of code
 * relocated, and five of `ArtHost`'s thirteen members were names from this region alone.
 * A module that can `import { ui }` needs no getter for any of them.
 *
 * So this is deliberately a **mutable bag, not an interface**. It is not a design
 * improvement and does not pretend to be one — these were already globals, and this only
 * gives them an owner that other modules can name. Wrapping them in accessors would cost
 * the ceremony this exists to remove, and inventing operations over state whose
 * invariants are not yet understood would be inventing invariants.
 *
 * The short name is not laziness either: with 655 references across `main.ts`, every
 * character of the prefix is about 160 tokens on a file that is read on every change.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * Module scope must stay side-effect-free: `main.ts` refuses to run on a phone before any
 * other side effect, and an imported module is evaluated before any statement of its
 * importer (AGENTS.md, "the module-evaluation trap"). Everything below is a plain value.
 */
import type { DeskyData } from '../data/desky.js';
import type { FfpPanel } from '../data/ffp.js';
import type { InfoButton, InfoPanelAssets } from '../render/mapInfo.js';
import type { Credits } from '../render/credits.js';
import type { MapAction, WorldMap } from '../render/worldMap.js';
import type { VolumeBus } from '../core/settings.js';
import type { FeedbackUi } from './feedback.js';

// Options sub-panel state machine (Ostav, Uovl.pas:184-187): the corner button
// (or a right-click on the panel) scrolls between the normal panel and the options
// sub-panel via the 10 sc-frame animation.
export const O_NORMAL = 0;
export const O_SC_UP = 1;
export const O_OPTIONS = 2;
export const O_SC_DOWN = 3;
export const SCMIN = 6; // scroll frame indices (Uovl.pas:27-29)
export const SCMAX = 15;
export const PANEL_SCROLL_MS = 100; // the original panel Timer interval (UMain.dfm)

/**
 * Where the player is in the control-help pages (Help.pas).
 *
 * Only the position: the pages themselves are text now (`src/data/helpText.ts`) and are
 * built by `helpDom.ts`, so there is nothing left here to load or cache.
 */
export const helpScreens = {
  page: 0,
  /** Advance to the next page, wrapping (Image1Click, Help.pas). */
  next(count: number): void {
    if (count > 0) this.page = (this.page + 1) % count;
  },
  /** Go to the previous page, wrapping. A port addition — the original only goes forward. */
  prev(count: number): void {
    if (count > 0) this.page = (this.page - 1 + count) % count;
  },
};

export const ui = {
  panel: null as FfpPanel | null, // the parsed control-panel graphic (panel.ffp)
  panelPressed: 0, // region currently held down (for the lit-button feedback), or 0
  // Per-frame draw caches: the panel and world-map compositions are re-blitted only
  // when their inputs change (see drawPanel/drawMap). null forces the next repaint.
  panelSig: null as string | null,
  mapSig: null as string | null,
  ostav: O_NORMAL,
  scroll: SCMIN,
  scrollAcc: 0, // wall-clock accumulator to advance one scroll frame per ~100ms tick
  panelDragBus: null as VolumeBus | null, // the slider currently being dragged, if any
  // A menu overlay opened from a map corner (UMain.pas daOptions/daCredits): the
  // Options panel or the scrolling credits, shown over the world map.
  mapOverlay: 'none' as 'none' | 'options' | 'credits',
  credits: null as Credits | null, // the parsed credits assets (lazily loaded)
  aiPanelTried: false,
  aiCreditsTried: false,
  // Last display box the AI credit layers were sized for, so layout() runs on resize
  // rather than every frame.
  creditsLayoutW: 0,
  creditsLayoutH: 0,
  creditMode: -1, // scroll offset while the credits roll (CreditMode); -1 = idle
  creditsStart: 0, // wall-clock time the roll began (drives the scroll)
  // The map corner button under the cursor (dAkce, UMain.pas:1636), lit on hover.
  mapHoverCorner: null as MapAction | null,
  // The world-map record info panel (krokoměr, UMain.pas:1364): clicking an already
  // solved (or cheated) room opens it instead of launching. `mapInfoRoom` is the
  // room whose panel is open (null = closed); `mapInfoHover` the button under the
  // cursor; `mapInfoFaze` the odometer roll frame. `mapHoverRoom` is the room node
  // hovered on the open map (drives the name plaque, drawn on hover too).
  mapInfoRoom: null as number | null,
  mapInfoHover: null as InfoButton | null,
  mapInfoFaze: 0,
  mapInfoOpenAt: 0, // timestamp of openMapInfo, so the odometer rolls on wall-clock time
  mapHoverRoom: null as number | null,
  // Info-panel bitmaps (loaded at boot); the name-plaque data reloads on a language
  // change (typdesek<>tit_def, UMain.pas:1437).
  infoPanelAssets: null as InfoPanelAssets | null,
  deskyData: null as DeskyData | null,
  deskyLang: null as 'cz' | 'en' | null,
  helpOpen: false, // true while the help-screens overlay is shown (akce_help / ToggleHelp)
  // The feedback form (src/app/feedback.ts). Wired at the end of boot; until then, and
  // if its markup is missing, it simply reports itself closed.
  feedback: null as FeedbackUi | null,
  worldMap: null as WorldMap | null, // the branch-map screen
  // AI-upscaled world-map compositor (Phase B), lazily loaded when the map assets
  // load; used ONLY under the `ai` graphics level and only when every AI asset is
  // present (else the map falls back to the faithful CPU composite). The overlay
  // canvas draws the record panel + name plaques at native res, nearest-neighbour-
  // scaled over the hi-res map so digits/text stay crisp.
  mapOverlayCanvas: null as HTMLCanvasElement | null,
  mapOverlayCtx: null as CanvasRenderingContext2D | null,
  screen: 'room' as 'map' | 'room' | 'intro' | 'legimage', // which screen is showing
  // Leg-completion story image (obrazek, UMain.pas:831 zobraz_obrazek): the full-screen
  // "case file" page shown over a frozen map when the last room of a leg (depth 15) is
  // won. `legImage` holds the decoded page (null = none); `legImageNum` is the leg (1..8)
  // for the __ff hook; `legImageDrawn` gates the one-shot blit while it idles on screen.
  legImage: null as { w: number; h: number; rgba: Uint8ClampedArray } | null,
  legImageNum: -1,
  legImageDrawn: false,
  /**
   * The AI-upscaled page for the story image currently on screen, when the `ai` tier is
   * selected and its art loaded. null ⇒ draw the original 640×480 page (every other tier,
   * and any tier if the upscaled file is missing).
   */
  legImageAi: null as ImageBitmap | null,
  // When the page is shown on re-entry (Run/Replay of an already-solved depth-15 room,
  // UMain.pas:958/1030 daClickAndRun), dismissing it must continue into that room rather
  // than return to the map. `legImagePending` holds the deferred launch (null = after-win
  // case → dismiss goes to the map).
  legImagePending: null as { room: number; replay?: string } | null,
  mapRevealStart: 0, // wall-clock time the map reveal animation began (Depth = -3)
};
