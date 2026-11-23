# Native host spike (macOS today; tvOS and Xbox are the point)

> **Experimental. Not shipped, not part of the web or iOS build, and `src/` does not depend on
> it.** Nothing under `native/` is imported by the game; it only imports *from* `src/`. CI
> builds it (the `native-macos` job in `.github/workflows/checks.yml`, on pull requests and
> on main) so a change in `src/` that breaks the native bundle is visible, but no release
> consumes it.

A proof of concept for running the game **without a browser**:

- **QuickJS-ng** runs the game's own TypeScript: the room, its script, the step engine
  and the AI-tier room walk. Nothing is ported; `native/js/scene.ts` imports them from `src/`.
- **SDL3** provides the window, the gamepad and the GPU.
- The AI tier's `AiTarget` seam (`src/render/aiTarget.ts`) is implemented on **SDL GPU**
  (`native/js/nativeAiScreen.ts`, `native/host/shaders.metal`). That is the one thing a
  native host has to own.
- The fish pose is the game's own `fishFrameFor` (`src/app/fishFrame.ts`, DOM-free), fed
  through `src/app/gameState.ts`.
- The off-screen canvases the AI tier builds — the classic-sprite fallback for art with
  no AI file, the mirror's glass mask, LODE's wreck — come from an injected factory
  (`src/render/scratchCanvas.ts`). The browser keeps `document.createElement('canvas')`;
  this host injects `native/js/nativeCanvas.ts`, a CPU buffer that implements only the
  2D calls those canvases make, and rounds translucent pixels through Chromium's
  premultiplied storage exactly as the browser's canvas does (without that, room 9's
  mirror is off by one on three pixels).

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
SDL 3.4.20, libwebp 1.6.0), each from a source archive checked by SHA-256, statically. A clean configure and build
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

## What the spike does not do yet

- A gated check of LODE's wreck. It runs natively now, but `compare.mjs` never reaches
  it: the first swap is at tick 3770, after the whole recorded solution. A one-off run of
  the same harness at ticks 3780 and 3900 was byte-identical. Each run starts a fresh
  process, so the in-place patch upload (one revision behind) is not exercised there.
- Blink, talking heads and the darkness wink-out. `fishFrameFor` handles them, but the
  state it reads for them stays at rest here: `blink` and `darkFlicker` are advanced by
  `tickBlink` in `src/app/logicTick.ts`, and `poslMluv` by the lip sync in
  `src/app/main.ts` from the audio engine. Neither module is DOM-free.
- Everything in `src/app/`: menus, panel, map, subtitles, audio, video and saves.
- The shaders are MSL only. For D3D12 or Vulkan they would be written once in HLSL and
  translated with `SDL_shadercross`.
