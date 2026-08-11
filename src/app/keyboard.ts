/**
 * Every key binding: the fish keys, the modal precedence that decides who owns the
 * keyboard right now, the typed cheat machine, and the dev toggles.
 *
 * ── What this module is a test of ────────────────────────────────────────────
 * `main.ts` is navigated by a generated map because 20 of its 32 regions were one
 * strongly-connected component (`tools/region-graph.mjs`). Keyboard was never in that
 * component — nothing in the file calls into it — so it was already free to leave, and
 * it stayed anyway. This module is the measurement of why.
 *
 * The answer is in `KeyboardHost` below: **45 names**, against thirteen for `art.ts`.
 * Nearly all of them are commands, and that is not accidental coupling — a key binding
 * table IS the list of everything the game can be told to do, so its context is the
 * game's whole command surface. It cannot be argued down; it can only be reduced by the
 * commands themselves becoming modules that this file imports directly.
 *
 * So read the size of that interface as the price of extracting a region while its
 * neighbours are still one file, and as the reason the cycle work has to come first.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * Module scope stays side-effect-free and the listeners are registered from
 * `initKeyboard()`, at the point in `main.ts` where they were registered before. An
 * imported module is evaluated before any statement of its importer, and `main.ts`
 * refuses to run on a phone before any other side effect — see AGENTS.md, "the
 * module-evaluation trap".
 */

import {
  applyMapCheat,
  applyRoomCheat,
  closeTetris,
  devWinRoom,
  mapCheats,
  roomCheats,
  tetris,
  tetrisModal,
} from './cheats.js';
import { Dir } from '../core/dir.js';
import { select } from './dom.js';
import type { FeedbackUi } from './feedback.js';
import { wake } from './frameClock.js';
import type { IntroPlayer } from './intro.js';
import { mapLaunching } from './roomLaunch.js';
import type { GraphicsLevel, Settings } from '../core/settings.js';
import type { RoomScript, Script } from '../core/script.js';
import type { StepEngine } from '../core/stepEngine.js';
import type { KufrDemo } from '../intro/kufrDemo.js';
import type { Room } from '../core/room.js';
import type { HelpScreens } from '../render/help.js';
import type { TetrisKey } from '../core/tetris.js';

/**
 * This module's view of the game — 45 names, and the point of the exercise.
 *
 * Fifteen of them are state it only READS (which screen is up, which modal owns input,
 * whether the dev pane is armed). Two it writes. The remaining twenty-eight are
 * commands, and that is the shape worth noticing: a key table is a binding of keys to
 * everything the game can be asked to do, so its dependency list is the game's command
 * surface and no amount of restructuring makes it shorter. What WOULD make it shorter is
 * those commands living in modules this file could import — which is what the region
 * cycle in `main.ts` currently prevents.
 */
export interface KeyboardHost {
  // ── State it reads ──────────────────────────────────────────────────────────
  readonly activeScript: { def: RoomScript; s: Script } | null;
  readonly cutscene: KufrDemo | null;
  readonly devEnabled: boolean;
  readonly engine: StepEngine | null;
  readonly feedback: FeedbackUi | null;
  readonly graphics: GraphicsLevel;
  readonly heldKey: string | null;
  readonly helpOpen: boolean;
  /** Only its truthiness is read here: a fast-forward load in progress blocks fish keys. */
  readonly loadmode: unknown;
  readonly mapInfoRoom: number | null;
  readonly mapOverlay: 'none' | 'options' | 'credits';
  readonly renderOnDirty: boolean;
  readonly renderer: 'cpu' | 'webgl';
  readonly room: Room | null;
  readonly screen: 'map' | 'room' | 'intro' | 'legimage';
  // ── State it writes ─────────────────────────────────────────────────────────
  /** KeyRoom held-key state machine: 0 idle, 1 pressed, 2 held, 3 released. */
  heldState: number;
  forceRoomRedraw: boolean;
  // ── Objects ─────────────────────────────────────────────────────────────────
  readonly GRAPHICS_LEVELS: readonly GraphicsLevel[];
  readonly helpScreens: HelpScreens;
  readonly intro: IntroPlayer;
  readonly settings: Settings;
  // ── Commands ────────────────────────────────────────────────────────────────
  readonly atRest: () => boolean;
  readonly beginHeldMove: (code: string, arrow: boolean, which: 'little' | 'big', dir: number) => void;
  readonly clearHeldKey: () => void;
  readonly closeHelp: () => void;
  readonly closeMapInfo: () => void;
  readonly closeMapOverlay: () => void;
  readonly dismissLegImage: () => void;
  readonly enterRoom: (num: number) => void;
  readonly inReplay: () => boolean;
  readonly inShowmode: () => boolean;
  readonly loadGame: () => void;
  readonly previewSubFont: (next?: boolean) => void;
  readonly restartRoom: () => void;
  readonly saveGame: () => void;
  readonly selectFish: (which: 'little' | 'big') => void;
  readonly setDevEnabled: (on: boolean) => void;
  readonly setGraphics: (level: GraphicsLevel) => void;
  readonly setRenderOnDirty: (on: boolean) => void;
  readonly setRenderer: (r: 'cpu' | 'webgl') => void;
  readonly setSubtitleMode: (mode: 'cz' | 'en' | 'off') => void;
  readonly showMap: () => void;
  readonly skipCutscene: () => void;
  readonly subLang: () => 'cz' | 'en';
  readonly swapActive: () => void;
}


/**
 * The fish keys (Uovl.pas:744). IJKL drives the little fish, WASD the big one — the
 * original's two-hand scheme, unchanged.
 */
const KEYS: Record<string, { which: 'little' | 'big'; dir: number }> = {
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
const TETRIS_KEYS: Record<string, TetrisKey> = {
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
const ARROWS: Record<string, number> = {
  ArrowLeft: Dir.left,
  ArrowUp: Dir.up,
  ArrowRight: Dir.right,
  ArrowDown: Dir.down,
};

/** Register the keydown/keyup/blur listeners. Call once, from `main.ts`. */
export function initKeyboard(host: KeyboardHost): void {
  window.addEventListener('keydown', (e) => {
    wake(); // return to 60fps immediately if the idle-loop throttle had us sleeping
    // The feedback form owns the keyboard while it is up. It is a modal <dialog>, so the
    // browser already keeps pointer and focus out of the game — but a keydown inside it
    // still bubbles to window. The fish keys are letters (WASD/IJKL, Uovl.pas:744) and
    // `X` arms the cheat buffer, so typing "the fish sank while I was pushing a crate"
    // swims the fish around behind the form — corrupting the very move record the report
    // is about. Escape is left alone: the dialog's own handler closes it.
    if (host.feedback?.isOpen()) return;
    // A room launch off the map is BLOCKING in the original (Spust runs inside the timer
    // handler, so no message is dispatched until the room is up). Swallow the keyboard
    // for as long as the parchment is on the map — the map's own pointer handlers do the
    // same. Anything else would let Escape, a cheat code or a tier switch act on a map
    // that is already on its way out.
    if (mapLaunching() !== null) {
      e.preventDefault();
      return;
    }
    // While the intro movie plays, swallow input; any key skips the current movie
    // (the original's mouse-down MediaPlayer1.Stop, UMain.pas:1603). Two exceptions:
    // a bare modifier keydown must NOT skip (otherwise arming Ctrl+Alt+D during the
    // intro fires three skips — Ctrl, Alt, D — and blows through the whole sequence),
    // and Ctrl+Alt+D itself toggles the dev pane in place so it can be armed before
    // the game proper without abandoning the movies.
    if (host.intro.playing) {
      if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;
      if (e.ctrlKey && e.altKey && e.code === 'KeyD') {
        e.preventDefault();
        host.setDevEnabled(!host.devEnabled);
        return;
      }
      e.preventDefault();
      host.intro.skip();
      return;
    }
    // Any key dismisses the scrolling credits (UMain.pas FormKeyDown → DoneCredits).
    if (host.mapOverlay === 'credits') {
      e.preventDefault();
      host.closeMapOverlay();
      return;
    }
    // Any key dismisses the leg-completion story page (zrus_obrazek).
    if (host.screen === 'legimage') {
      e.preventDefault();
      host.dismissLegImage();
      return;
    }
    // While the help screens are open, arrows page through them and any other key
    // closes the viewer (Help.pas:Image1Click / FormKeyDown).
    if (host.helpOpen) {
      e.preventDefault();
      const count = host.helpScreens.pages(host.subLang()).length;
      if (e.code === 'ArrowRight') host.helpScreens.next(count);
      else if (e.code === 'ArrowLeft') host.helpScreens.prev(count);
      else host.closeHelp();
      return;
    }
    // While the briefcase demo plays, swallow input; Escape skips it (zrus_kufr).
    // The render/graphics/font toggles are let through so you can switch the
    // backend or art source live (the cutscene frame reads them every tick).
    if (host.cutscene) {
      if (e.code === 'Escape') {
        e.preventDefault();
        host.skipCutscene();
        return;
      }
      if (e.code !== 'KeyR' && e.code !== 'KeyE' && e.code !== 'KeyF') return;
    }
    // While the Tetris minigame is open it owns the keyboard, as its modal window
    // does (FormKeyDown, Ttr.pas:458). Escape closes it (modalresult := mrCancel).
    // Note that Down ROTATES the piece here — the original has no soft drop; Space
    // slams the piece down instead.
    if (tetrisModal()) {
      e.preventDefault();
      if (e.code === 'Escape') {
        closeTetris();
        return;
      }
      const k = tetris ? TETRIS_KEYS[e.code] : undefined;
      if (k && tetris) {
        tetris.key(k);
        host.forceRoomRedraw = true;
      }
      return;
    }
    // Typed cheat codes (ZaznamenejPrikazKlavesou, Uovl.pas:744; the map screen keeps
    // its own buffer, UMain.pas:1750). `X` arms the machine; while a code is part-typed
    // the letters are swallowed, and the first letter that cannot continue any code
    // parks it and falls through to the normal handler below.
    {
      // The original feeds EVERY key through the buffer, so an arrow, Space or
      // Backspace breaks the prefix and parks the machine before doing its normal
      // job (Uovl.pas:748-769). Only letters can extend a code, so anything else is
      // fed as a cancelling key and then handled normally below.
      const entry = host.screen === 'map' ? mapCheats : roomCheats;
      const letter = e.key.length === 1 && /[a-z]/i.test(e.key);
      const r = letter ? entry.press(e.key) : entry.cancel();
      if (r.cheat) {
        if (host.screen === 'map') applyMapCheat(r.cheat);
        else applyRoomCheat(r.cheat);
        return;
      }
      if (r.swallowed) return;
    }
    // Ctrl+Alt+D: enable/disable the developer pane (persisted). This is the ONLY
    // way in/out of dev mode; while enabled it shows the tuning chrome + perf HUD and
    // arms the one-key dev toggles (E/R/P/F/G) below. Kept deliberately obscure so
    // players never trip it — the game is played chrome-free.
    if (e.ctrlKey && e.altKey && e.code === 'KeyD') {
      e.preventDefault();
      host.setDevEnabled(!host.devEnabled);
      return;
    }
    // The single-key dev toggles are armed ONLY while the dev pane is enabled, and only
    // for a BARE keypress. Without the modifier guard these collide with the browser's
    // own shortcuts: Cmd/Ctrl+R (reload) toggled the renderer and persisted it, so the
    // backend flipped CPU/WebGL on every reload — and reloading from the toolbar button,
    // which fires no keydown, did not. Cmd+P (print) silently disabled the idle-FPS
    // saver, Cmd+E changed the graphics tier, Cmd+F the subtitle font, Cmd+G the
    // subtitle language. All of those are persisted, so a single accidental shortcut
    // changed how the game rendered from then on.
    //
    // Ctrl+Alt+D above is deliberately checked BEFORE this and is unaffected: it is the
    // one dev key that is meant to carry modifiers.
    if (host.devEnabled && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.code === 'KeyG') {
        // Cycle subtitles Czech -> English -> off (obltitcz/eng/no).
        host.setSubtitleMode(host.settings.subtitles === 'cz' ? 'en' : host.settings.subtitles === 'en' ? 'off' : 'cz');
        return;
      }
      if (e.code === 'KeyP') {
        // Toggle the idle-FPS saver (render-on-dirty). Also the dev-bar checkbox.
        host.setRenderOnDirty(!host.renderOnDirty);
        return;
      }
      if (e.code === 'KeyE') {
        // Cycle the graphics level classic → enhanced → ai → classic (also the
        // dev-bar Graphics combobox). setGraphics persists + syncs the select.
        const i = host.GRAPHICS_LEVELS.indexOf(host.graphics);
        host.setGraphics(host.GRAPHICS_LEVELS[(i + 1) % host.GRAPHICS_LEVELS.length]!);
        return;
      }
      if (e.code === 'KeyR') {
        // Toggle the render backend CPU <-> WebGL (also on the dev-bar Renderer select).
        host.setRenderer(host.renderer === 'webgl' ? 'cpu' : 'webgl');
        return;
      }
      if (e.code === 'KeyF') {
        // Cycle the vector-subtitle font (Shift+F for previous) and show a sample line.
        host.previewSubFont(!e.shiftKey);
        return;
      }
      if (e.code === 'KeyW' && e.shiftKey) {
        // Genuinely win the current room (also the dev-bar "Win room" button). Uses the
        // real win path, so an end-of-leg room reveals its story page. Spot-check aid.
        // Shift-gated so it never collides with a typed cheat string (e.g. xwemaketherules).
        devWinRoom();
        return;
      }
    }
    // Backspace restarts the room (TRoom.Restart) — the original's Restart action,
    // which the tutorial fish teach ("1st-m-backspace"). It is NOT a single-move undo.
    if (e.code === 'Backspace') {
      e.preventDefault();
      host.restartRoom();
      return;
    }
    if (e.code === 'F2') {
      e.preventDefault();
      if (host.atRest()) host.saveGame();
      return;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      if (host.atRest()) host.loadGame();
      return;
    }

    if (e.code === 'Escape') {
      e.preventDefault();
      if (host.screen === 'map') {
        if (host.mapInfoRoom !== null) host.closeMapInfo(); // close the record panel first (daCancel)
        else if (host.mapOverlay !== 'none') host.closeMapOverlay(); // close an open menu overlay
        else if (host.room) host.enterRoom(Number(select.value));
      } else host.showMap();
      return;
    }
    if (host.screen === 'map') return; // no fish keys on the map
    if (host.activeScript?.s.natvrdo === 1) return; // possessed by ZELVA: input is ignored
    if (host.activeScript?.s.zavermode) return; // ZAVER finale cutscene: only restart/exit above work
    if (host.inShowmode()) return; // KUFRIK demonstration: fish keys blocked (Backspace/Escape end it above)
    if (host.inReplay()) return; // map "Replay" playback: player fish keys are blocked
    if (host.loadmode) return; // fast-forward load in progress: ignore fish keys (Backspace above aborts it)
    if (e.code === 'Space') {
      e.preventDefault();
      host.swapActive(); // akce_switch
      return;
    }
    if (e.code === 'Digit1' || e.code === 'Digit2') {
      e.preventDefault();
      host.selectFish(e.code === 'Digit1' ? 'little' : 'big'); // akce_set
      return;
    }
    const arrow = ARROWS[e.code];
    if (arrow !== undefined) {
      // Arrow keys move the active fish (kdo:=sys); the engine repeats it while held.
      e.preventDefault();
      host.beginHeldMove(e.code, true, host.engine?.active ?? 'little', arrow);
      return;
    }
    const map = KEYS[e.code];
    if (!map) return;
    e.preventDefault();
    host.beginHeldMove(e.code, false, map.which, map.dir); // kdo:=mala/velka
  });

  window.addEventListener('keyup', (e) => {
    wake();
    // FormKeyUp (Uovl.pas:1006): 1→3 (guarantee one dispatch for a tap), otherwise →0.
    if (e.code !== host.heldKey) return;
    if (host.heldState === 1) host.heldState = 3;
    else host.clearHeldKey();
  });

  // Losing focus (alt-tab / clicking another window) or hiding the tab means the OS
  // stops auto-repeat and never delivers the keyup for a held movement key. Drop it
  // ourselves, exactly as a keyup would — otherwise heldState stays "held", the fish
  // keeps swimming, and (because loopThrottleOk requires heldState===0) the render
  // loop never drops to the idle timer and spins at the full display refresh (120fps
  // on a ProMotion panel) until the next room change/restart clears it.
  window.addEventListener('blur', () => host.clearHeldKey());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) host.clearHeldKey();
  });
}
