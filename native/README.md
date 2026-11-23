# Native host spike (macOS today; tvOS and Xbox are the point)

> **Experimental. Not shipped, not part of the web or iOS build, and `src/` does not depend on
> it.** Nothing under `native/` is imported by the game; it only imports *from* `src/`. CI
> builds it (the `native-macos` job in `.github/workflows/checks.yml`) so a change in `src/`
> that breaks the native bundle is visible, but no release consumes it.

A proof of concept for running the game **without a browser**:

- **QuickJS-ng** runs the game's own TypeScript: the room, its script, the step engine
  and the AI-tier room walk. Nothing is ported; `native/js/scene.ts` imports them from `src/`.
- **SDL3** provides the window, the gamepad and the GPU.
- The AI tier's `AiTarget` seam (`src/render/aiTarget.ts`) is implemented on **SDL GPU**
  (`native/js/nativeAiScreen.ts`, `native/host/shaders.metal`). That is the one thing a
  native host has to own.
- The fish pose is the game's own `fishFrameFor` (`src/app/fishFrame.ts`, DOM-free), fed
  through `src/app/gameState.ts`.

SDL GPU drives Metal on macOS and tvOS, and D3D12 on Windows and Xbox (GDK). So this
same host is the shape of an Apple TV build and an Xbox build. It is a spike, not a
product: one room, no menus, no audio, no subtitles.

## Build and run (macOS, Apple silicon)

    brew install cmake ninja
    npm run typecheck:native                                   # native/js against current src/
    node native/build-js.mjs                                   # -> native/build/game.js
    cmake -S native -B native/build/cmake -G Ninja -DCMAKE_BUILD_TYPE=Release
    ninja -C native/build/cmake                                # QuickJS-ng, SDL3, libwebp
    native/build/cmake/ff4e-native native/build/game.js --root public --room 3

CMake fetches and builds the three C dependencies at pinned versions (QuickJS-ng v0.17.0,
SDL 3.4.20, libwebp 1.6.0, the last two by SHA-256), statically. A clean configure and build
takes under a minute. Nothing from Homebrew but the build tools is used, so a package
upgrade cannot change the pixels `compare.mjs` checks.

Controls: arrows, the d-pad or the left stick move the active fish; Space or Ⓐ switches
fish; Esc or Ⓑ quits. Other flags:

- `--demo` plays the room's recorded solution instead of reading the pad.
- `--seconds N` quits after N seconds.

From a Rosetta shell, prefix the commands with `arch -arm64`, or the universal tools
build x86_64.

## Is it the same picture? `native/compare.mjs`

    node --import tsx native/compare.mjs --rooms 1,3,10      # or --all for the 72 rooms

This renders the same scene state twice and diffs the two ×S composites:

- through the browser's real `GlAiScreen` (WebGL2, Chromium), via `native/reference.html`;
- through the native host.

It checks three states per room:

- **still**: every primitive except the water wave.
- **wobble**: the per-fragment water at a sub-tick time.
- **played**: after 240 ticks of the room's recorded solution.

For the comparison to be fair, `Math.random` is pinned on both sides (`pinRandom`). Room
scripts draw from it, and V8 and QuickJS have different generators.

It exits non-zero on any differing frame and on any room that fails natively, except the
rooms in its `KNOWN_GAPS` list (9, 56, 66, 68, 72). A known gap that starts rendering
identically also fails, so the list has to be updated with the fix. Differing frames
leave `-native`, `-webgl` and `-diff` PNGs in `native/build/compare/`.

Current result: **67 of 72 rooms byte-identical** in all three states; 203 of the 216
frames are identical and the other 13 cannot be rendered natively. None differ. CI runs
`--all` on a hosted macOS runner, whose Metal device gives the same bytes.

The spike was written at 68/72. Room 56 CHODBA left the list when `scene.ts` stopped
restating `fishFrameFor` and imported the game's: at tick 240 CHODBA is dark, and the
restated copy had no darkness case, so both sides drew a lit idle fish there and agreed
on a wrong picture. The game draws a dark silhouette, which the native host cannot yet
(see below).

## What the spike does not do yet

- `backgroundZx` (gspec=42), `mirrorGlass` (the spec=1 mirror), LODE's wreck, and items
  with no AI art (the classic-sprite fallback). The last three build canvases through
  the DOM in `src/render/roomAi.ts`; the native target throws on the first two.
- The darkness silhouette (gspec=2, CHODBA). The pose is right now, but `TL_TMA` has no
  AI art, so it takes the same classic-sprite fallback and throws natively, in the
  interactive window as well as in `compare.mjs`.
- Blink, talking heads and the darkness wink-out. `fishFrameFor` handles them, but the
  state it reads for them stays at rest here: `blink` and `darkFlicker` are advanced by
  `tickBlink` in `src/app/logicTick.ts`, and `poslMluv` by the lip sync in
  `src/app/main.ts` from the audio engine. Neither module is DOM-free.
- Everything in `src/app/`: menus, panel, map, subtitles, audio, video and saves.
- The shaders are MSL only. For D3D12 or Vulkan they would be written once in HLSL and
  translated with `SDL_shadercross`.
