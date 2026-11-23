# Native host (macOS today; tvOS and Xbox are the point)

> **Experimental. Not shipped, not part of the web or iOS build, and `src/` does not depend on
> it.** Nothing under `native/` is imported by the game; it only imports *from* `src/`. CI
> builds it (the `native-macos` job in `.github/workflows/checks.yml`, on pull requests and
> on main) so a change in `src/` that breaks the native bundle is visible, but no release
> consumes it.

The game **without a browser**. It plays a whole game now — room after room, with undo and
saves — on the AI-upscaled tier, without menus, subtitles or sound yet:

- **QuickJS-ng** runs the game's own TypeScript. Nothing is ported: the room, its script and
  the step engine (`src/core/`), the AI-tier room walk (`src/render/`), and the game's own
  flow from `src/app/` — `roomLoad` enters a room, `logicTick.step` is the 80 ms game step,
  `movement`'s held-key state machine turns keys into moves, `undo` takes them back,
  `persist` keeps the solved rooms, scores and best records.
- **SDL3** provides the window, the keyboard, the gamepad and the GPU.
- The AI tier's `AiTarget` seam (`src/render/aiTarget.ts`) is implemented on **SDL GPU**
  (`native/js/nativeAiScreen.ts`, `native/host/shaders.metal`). That is the one thing a
  native host has to own.
- The off-screen canvases the AI tier builds — the classic-sprite fallback for art with
  no AI file, the mirror's glass mask, LODE's wreck — come from an injected factory
  (`src/render/scratchCanvas.ts`). The browser keeps `document.createElement('canvas')`;
  this host injects `native/js/nativeCanvas.ts`, a CPU buffer that implements only the
  2D calls those canvases make, and rounds translucent pixels through Chromium's
  premultiplied storage exactly as the browser's canvas does (without that, room 9's
  mirror is off by one on three pixels).

SDL GPU drives Metal on macOS and tvOS, and D3D12 on Windows and Xbox (GDK). So this
same host is the shape of an Apple TV build and an Xbox build.

### How the browser's flow runs without the browser

`src/` is not changed for the native host and does not know about it. The flow modules
above are bundled as they are; the handful of modules they import that reach the document,
Web Audio or the page layout are swapped, at bundle time, for a module of the same name in
`native/js/seams/` — the move the unit tests make with `vi.mock`, made once for the whole
bundle by an esbuild plugin in `native/build-js.mjs`. Each seam is typed against the module
it replaces (`typeof import(...)`), so `npm run typecheck:native` catches a changed
signature, and the constants it restates are checked against the real literal types.

The swap is fenced. `build-js.mjs` keeps an allowlist of the `src/app/` modules the native
host runs for real, and fails the build when anything else from `src/app/` reaches the
bundle — so a `src/` change that adds an edge from the flow into the DOM shell breaks this
build loudly instead of shipping a module that throws on its first `document`.

What `src/app/main.ts` owns and does not export is restated in `native/js/game.ts`, the
native composition root, each part marked with where it comes from: building a room
(`buildRoom`), the save slots (`saveGame`/`loadGame`), the win bookkeeping, the room part of
the keyboard router, and the frame loop's step (`renderLoop.ts`'s one-step-per-frame rule).
`localStorage` is a JSON file the host owns (`--store FILE`, by default `store.json` in the
user's app-support directory — `~/Library/Application Support/ff4e/Fish Fillets 4ever/` on
macOS), so progress and save slots use the browser game's keys and format.

With no map, a solved room leads to the next: the lowest-numbered room above it that the
map would offer (reachable by the map's own unlock rule, `computeResena`, and not yet
solved), else the lowest-numbered such room; with every registered room solved, the finale
(ZAVER); after ZAVER the game ends. Rooms are numbered leg by leg, so within a leg this is
simply the next room. A session starts where the store says the player left off, or in
`--room N`.

## Build and run (macOS, Apple silicon)

    brew install cmake ninja
    npm run typecheck:native                                   # native/js against current src/
    node native/build-js.mjs                                   # -> native/build/game.js
    cmake -S native -B native/build/cmake -G Ninja -DCMAKE_BUILD_TYPE=Release
    ninja -C native/build/cmake                                # QuickJS-ng, SDL3, libwebp
    native/build/cmake/ff4e-native native/build/game.js --root public --room 3

CMake fetches and builds the three C dependencies at pinned versions (QuickJS-ng v0.17.0,
SDL 3.4.20, libwebp 1.6.0), each from a source archive checked by SHA-256, statically. A clean configure and build
takes under a minute. Nothing from Homebrew but the build tools is used, so a package
upgrade cannot change the pixels `compare.mjs` checks.

Controls, keyboard and gamepad (SDL maps any supported controller to this layout; the
gamepad is turned into the same key codes in `native/host/main.c`, so there is one router):

| | keyboard | gamepad |
| --- | --- | --- |
| little fish | `I` `J` `K` `L` | d-pad, left stick |
| big fish | `W` `A` `S` `D` | right stick |
| active fish | arrows | |
| switch fish | Space, Tab (`1`/`2` select) | Ⓐ |
| undo one move | `-` | Ⓨ |
| restart the room | Backspace | Ⓧ |
| save / load | F2 / F3 | LB / RB |
| quit (there is no map to go back to) | Esc | Ⓑ |

Other flags:

- `--demo` plays every room's recorded solution through the real loop (the browser's
  dev-only `solvemode`) instead of reading input: the game plays itself, room after room.
- `--seconds N` quits after N seconds.
- `--store FILE` keeps progress and save slots in FILE instead of the user's.

From a Rosetta shell, prefix the commands with `arch -arm64`, or the universal tools
build x86_64.

## Does it play? The smoke gate (`native/js/smoke.ts`)

    native/build/cmake/ff4e-native native/build/game.js --root public --headless \
      --smoke all --smoke-player 13,70 --store native/build/smoke-store.json

Every room with a recorded solution (70 of 72: ZAVER and SCORE are the ending and the
results screen) is entered through `roomLoad` and played through `solvemode` — every tick of
the real `logicTick.step`, the moves through the real `tryStep`, the win through the real
auto-return — and must be left by a win, with `ff.solved` on disk saying so. Rooms 13
DRAKAR1 and 70 DISKETA, two that carry script state through undo, are also TYPED key by
key through the router the keyboard and the gamepad use, with a save (F2), two undos, a load
(F3) and an undo into the loaded history on the way, each landing checked against the
record it must land on, and then finished. One frame per room is drawn from the real
flow's state. `--store` is required and wiped: a smoke run never touches the player's
progress. `--smoke-out DIR` keeps those frames.

~20 s locally for all of it. CI runs it in the `native-macos` job, before the parity sweep.

## Is it the same picture? `native/compare.mjs`

    node --import tsx native/compare.mjs --rooms 1,3,10      # or --all for the 72 rooms

This renders the same scene state twice and diffs the two ×S composites:

- through the browser's real `GlAiScreen` (WebGL2, Chromium), via `native/reference.html`;
- through the native host.

The scene is `native/js/scene.ts`: a fixed, headless state built from `src/core/` and
`src/render/`, the same on both sides — not the native game's flow, which needs the seams
and so cannot run in the browser reference. The frame description both sides draw is the
game's (`native/js/frame.ts`, shared with `game.ts`).

It checks three states per room:

- **still**: every primitive except the water wave.
- **wobble**: the per-fragment water at a sub-tick time.
- **played**: after 240 ticks of the room's recorded solution.

For the comparison to be fair, `Math.random` is pinned on both sides (`pinRandom`). Room
scripts draw from it, and V8 and QuickJS have different generators.

It exits non-zero on any differing frame, on a missing or short composite, on a native run
that takes over 60 s, and on any native failure not listed in `KNOWN_GAPS`. That list is
keyed by room and case and is empty today; each entry names the error the failure must
carry. A known gap that starts rendering identically also fails, so the list has to be
updated with the fix. Differing frames leave `-native`, `-webgl` and `-diff` PNGs in
`native/build/compare/`.

Current result: **72 of 72 rooms byte-identical** in all three states: all 216 frames.
CI runs `--all` on a hosted macOS runner, whose Metal device gives the same bytes.

The spike was written at 68/72. Room 56 CHODBA left the list when `scene.ts` stopped
restating `fishFrameFor` and imported the game's: at tick 240 CHODBA is dark, and the
restated copy had no darkness case, so both sides drew a lit idle fish there and agreed
on a wrong picture. The game draws a dark silhouette, which the native host could not
draw until the scratch-canvas factory landed: rooms 9, 56, 68 and 72 healed with it.
Room 66 ZX joined when `backgroundZx` (gspec=42) was ported: the same background pass as
every other room, with the wall's silhouette taking its loading-stripe colour from a
one-texel-per-native-row band texture, as `GlAiScreen` does.

## What it does not do yet

- **Menus, the map, the panel, subtitles, sound, video.** A room's dialogue still runs
  (scripts wait on it as they do in the browser), but every line lasts the browser's
  fallback for a line without audio (`DEFAULT_LINE_TICKS`), is not shown, and is not heard.
  Room entry takes the path the browser's boot load does: art and room data only.
- **KUFRIK's briefcase cutscene and its tutorial demonstration**, and the leg-final story
  pages. The room plays; the demonstration and the pages are not shown.
- **Talking heads.** The fish blink and a dark room's silhouettes wink out (that is
  `logicTick`'s `tickBlink`, which now runs), but the mouths follow the audio's lip sync,
  and there is no audio.
- **Cheats** (no way to type one), the fishing hooks they enable, and haptics.
- **Escape quits** rather than going back to a map.
- A gated check of LODE's wreck in `compare.mjs`. It runs natively (the smoke gate plays
  LODE to the end), but `compare.mjs` never reaches it: the first swap is at tick 3770,
  after the whole recorded solution. A one-off run of the same harness at ticks 3780 and
  3900 was byte-identical. Each run starts a fresh process, so the in-place patch upload
  (one revision behind) is not exercised there.
- The shaders are MSL only. For D3D12 or Vulkan they would be written once in HLSL and
  translated with `SDL_shadercross`.
