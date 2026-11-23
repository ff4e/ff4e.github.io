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

SDL GPU drives Metal on macOS and tvOS, and D3D12 on Windows and Xbox (GDK). So this
same host is the shape of an Apple TV build and an Xbox build. It is a spike, not a
product: one room, no menus, no audio, no subtitles.

## Build and run (macOS, Apple silicon)

    brew install sdl3 webp cmake ninja
    npm run typecheck:native                                   # native/js against current src/
    node native/build-js.mjs                                   # -> native/build/game.js
    cmake -S native -B native/build/cmake -G Ninja -DCMAKE_BUILD_TYPE=Release
    ninja -C native/build/cmake                                # fetches QuickJS-ng v0.17.0
    native/build/cmake/ff4e-native native/build/game.js --root public --room 3

Controls: arrows, the d-pad or the left stick move the active fish; Space or Ⓐ switches
fish; Esc or Ⓑ quits. Other flags:

- `--demo` plays the room's recorded solution instead of reading the pad.
- `--seconds N` quits after N seconds.

From a Rosetta shell, prefix the commands with `arch -arm64`, or the universal tools
build x86_64.

## Is it the same picture? `native/compare.mjs`

    node --import tsx native/compare.mjs --rooms 1,3,10      # or $(seq -s, 1 72)

This renders the same scene state twice and diffs the two ×S composites:

- through the browser's real `GlAiScreen` (WebGL2, Chromium), via `native/reference.html`;
- through the native host.

It checks three states per room:

- **still**: every primitive except the water wave.
- **wobble**: the per-fragment water at a sub-tick time.
- **played**: after 240 ticks of the room's recorded solution.

For the comparison to be fair, `Math.random` is pinned on both sides (`pinRandom`). Room
scripts draw from it, and V8 and QuickJS have different generators.

## What the spike does not do yet

- `backgroundZx` (gspec=42), `mirrorGlass` (the spec=1 mirror), LODE's wreck, and items
  with no AI art (the classic-sprite fallback). The last three build canvases through
  the DOM in `src/render/roomAi.ts`; the native target throws on the first two.
- Talking heads, blink, and the darkness silhouette. `scene.ts` has a subset of
  `fishFrameFor`, because the rest reads app-layer state.
- Everything in `src/app/`: menus, panel, map, subtitles, audio, video and saves.
- The shaders are MSL only. For D3D12 or Vulkan they would be written once in HLSL and
  translated with `SDL_shadercross`.
