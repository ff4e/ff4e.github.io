# Native host (macOS today; tvOS and Xbox are the point)

> **Experimental. Not shipped, not part of the web or iOS build, and `src/` does not depend on
> it.** Nothing under `native/` is imported by the game; it only imports *from* `src/`. Its
> whole gate runs locally as `npm run native:check` (below), which a change to `native/` or to
> `src/` code the bundle imports runs before its PR. The same steps are the `native-macos` job
> in `.github/workflows/checks.yml`, which runs only when started by hand: hosted macOS runners
> queued too long to wait on. No release consumes it.

The game **without a browser**. It plays a whole game now — from the world map, room after
room, with undo, saves, the record panel's Replay and the leg story pages, and with its
sound and subtitles, the intro movies and the credits — on the AI-upscaled tier, without
menus yet:

- **QuickJS-ng** runs the game's own TypeScript. Nothing is ported: the room, its script and
  the step engine (`src/core/`), the AI-tier room walk (`src/render/`), and the game's own
  flow from `src/app/` — `roomLoad` enters a room, `logicTick.step` is the 80 ms game step,
  `movement`'s held-key state machine turns keys into moves, `undo` takes them back,
  `persist` keeps the solved rooms, scores and best records.
- **SDL3** provides the window, the keyboard, the gamepad, the GPU and the audio output.
- The sound is the browser's own policy (`src/audio/audio.ts`) over the `AudioBackend` seam
  (`src/audio/audioBackend.ts`), implemented by a small **C mixer** behind an SDL audio
  stream, with **Apple's decoder** for the AAC: see "Sound" below.
- The AI tier's `AiTarget` seam (`src/render/aiTarget.ts`) is implemented on **SDL GPU**
  (`native/js/nativeAiScreen.ts`, `native/host/shaders.metal`). That is the one thing a
  native host has to own.
- The screens around the room — the world map with its record panel, name plaques,
  room-entry parchment and selection ring, and the story pages — draw through `Surface2D`
  (`src/render/surface2d.ts`), which is implemented on **SDL GPU** too
  (`native/js/nativeSurface.ts`, `fs_surf` in `native/host/shaders.metal`): see
  "The world map" below.
- The subtitles are drawn natively too, through `Surface2D` with glyphs from FreeType: see
  "Subtitles" below.
- The intro and logo movies play through **the platform's movie decoder** (AVFoundation
  here) behind a four-call host interface, with the picture following the movie's own sound,
  and the AI credits roll is painted through `Surface2D`: see "Movies and credits" below.
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
`native/js/seams/` (`platform-<name>.ts` for `src/platform/`, `audio-<name>.ts` for
`src/audio/`) — the move the unit tests make with `vi.mock`, made once for the whole
bundle by an esbuild plugin in `native/build-js.mjs`. Each seam is typed against the module
it replaces (`typeof import(...)`), so `npm run typecheck:native` catches a changed
signature, and the constants it restates are checked against the real literal types.

The swap is fenced. `build-js.mjs` keeps an allowlist of the `src/app/` modules the native
host runs for real, and fails the build when anything else from `src/app/` reaches the
bundle — so a `src/` change that adds an edge from the flow into the DOM shell breaks this
build loudly instead of shipping a module that throws on its first `document`.

What `src/app/main.ts` owns and does not export is restated in `native/js/game.ts`, the
native composition root: building a room (`buildRoom`), the save slots
(`saveGame`/`loadGame`), the win bookkeeping, the room part of the keyboard router, and the
frame loop's step (`renderLoop.ts`'s one-step-per-frame rule); a few seams restate small
functions too. Each copy carries a `restates <file> \`<anchor>\` @ <hash>` marker, and
`test/native-restated.test.ts` hashes the source span it names (comments and spacing
ignored): any change to the source fails `npm run test` until the copy has been re-read
against it and the pin updated — the failure prints the new hash.
`localStorage` is a JSON file the host owns (`--store FILE`, by default `store.json` in the
user's app-support directory — `~/Library/Application Support/ff4e/Fish Fillets 4ever/` on
macOS), so progress and save slots use the browser game's keys and format. Each write is
flushed to disk before it replaces the store, and the previous store is kept as
`store.json.bak`. A damaged store falls back to the backup; with both damaged the game
refuses to start and says so, rather than run without saving or overwrite them.

A session starts on the world map (or in `--room N`), and every room is left back to it the
way the browser leaves one: a win goes to the map — through the leg's story page when the
room ends a leg, into ZAVER when that win finishes the game, and through the closing page
after ZAVER — the end of a Replay goes to the map, and so does Escape (Ⓑ). `showMap` and
`returnFromRoom` (`mapNav.ts`), the story pages and the record panel's buttons
(`main.ts`'s `clickMapAt`) are restated in `game.ts` and `mapScreen.ts`, pinned like the
rest.

`--demo` (and the smoke gate) keep the old map-less order instead: a solved room leads to
the lowest-numbered room above it that the map would offer (reachable by the map's own
unlock rule, `computeResena`, and not yet solved), else the lowest-numbered such room; with
every registered room solved, the finale (ZAVER); after ZAVER the run ends. A finished game
(ZAVER solved too) goes on room by room in number order, from room 1.

### The world map (`native/js/mapScreen.ts`)

The picture is the browser's: `src/render/mapPaintAi.ts` paints one `ai` map frame through
`Surface2D` from state the caller hands in, and both `src/app/mapDraw.ts` and the native
map screen call it (`test/dom-free.test.ts` keeps it, and everything it imports, off the
page). The native `Surface2D` holds premultiplied colour in an RGBA8 render target, as a
canvas does, decodes images premultiplied with the canvas's rounding, keeps the canvas's
state (axis-aligned transform, alpha, smoothing, blend, save/restore) in JS, and hands the
host quads, which it batches: one vertex upload and one render pass per run of draws into
a target, with clears, uploads and readbacks ordered among them on the frame's command
buffer.

What replaces the pointer is the controller spec's (A3 "World map", "Record panel"; the
geometry is `src/render/mapSelection.ts`, from the Xbox branch, #165):

- a selection always exists — a room node a click could reach — shown with its name plaque,
  as a hover shows it, and a ring (opaque pixels only, so it is drawn identically
  everywhere);
- a direction moves it to the nearest target that way, one step on the press, a repeat
  after 340 ms, then every 140 ms (`native/js/dirRepeat.ts`); a stick engages at 0.5 of its
  travel and lets go below 0.35;
- Ⓐ opens it: a solved or cheated room's record panel, or an unsolved room — launched as
  the original does, with one frame of the map unlit under the plaque and the parchment,
  which stays in the window while the room loads;
- in the panel, left/right cycle Run → Replay → Cancel (Replay skipped with no record), Ⓐ
  presses, Ⓑ closes; Run or Replay of a solved leg-final room shows the leg's story page
  first, and any button continues from it;
- Ⓑ on the plain map does nothing, on purpose; the default selection is the room last
  played if it is still selectable, else the first room not yet solved.

Of the corner buttons, **Intro** and **Credits** are selectable, and Ⓐ on one does what a
click does (`dispatchMapCorner`): the intro movie, or the credits roll over the map (see
"Movies and credits"). Options and Exit are not: neither screen exists natively, and a
target that does nothing is worse than none (`NATIVE_CORNERS`). The story pages are the upscaled ones (`/enhanced-ai/_story/`).

### Subtitles (`native/js/subtitleLayout.ts`, `subtitleDraw.ts`, `roomSubtitles.ts`)

Native only: the web keeps its DOM subtitles (`src/app/subtitleDom.ts`), unchanged.

What is said, and where its rows are, is the game's own and shared: the talk hook puts each
line into the room's `SubtitleSystem` (`src/render/subtitles.ts`) exactly as the browser's
`scriptTalk` does — the room's subtitle file first, then the audio engine's global packages
(`audio.entry`), in the player's language, nothing during a Replay — and `logicTick.step`
scrolls and expires the rows. That system wraps the text against the original bitmap font
and resolves the speaker's colour; `src/render/subtitleGeom.ts` holds every rule the vector
renderer measures from (size, readable band, fit-to-room, baseline, wave, stroke, bevel).
Both are imported, not restated.

`subtitleLayout.ts` restates the part of `syncDomSubtitles` that composes those rules — its
desktop branch (a TV is neither a phone nor a tablet): the font size held in the band, one
fit per message decided when its rows first appear, the glyphs laid out one advance at a time
and centred, the baseline, the wave as the compositor runs it (`waveDy` sampled into 25
keyframes and interpolated), the bevel placed as the CSS gradient lands on the fill span, and
the `ai` tier's shrink about the layer's bottom centre. In the web renderer that arithmetic is
welded to DOM mechanics (a hidden span measures, `text-align` centres, Web Animations wave,
a CSS transform shrinks), so it is pinned rather than shared: `test/native-restated.test.ts`
fails on any change to `syncDomSubtitles` until the copy is re-read. A unit test
(`test/native-subtitle-layout.test.ts`) holds the copy to `subtitleGeom`.

`subtitleDraw.ts` draws that layout with `Surface2D.fillMask` — a quad whose texels are
premultiplied white × coverage, filled with a colour — the one operation added to the interface for it. Each glyph is
two coverage masks from **FreeType** (`native/host/text.c`): the glyph, and the glyph with the
outline `-webkit-text-stroke` paints under it (its stroker, centred, Skia's miter limit). They
are rasterised at the size they are shown at, the pen kept to a quarter pixel, and cached in an
atlas; the outline goes down in `rgb(5,5,12)`, then the fill one colour per device row (the
bevel is a vertical gradient), glyph by glyph as the browser layers them. FreeType rather than
stb_truetype because the faces are variable fonts drawn at weight 500 and stb_truetype draws
only a font's default instance (Mulish's is a hairline 200); FreeType 2.15.0 is fetched and
pinned by SHA-256 like the other dependencies, built without its optional libraries.

In the game the layer is laid out for the rect the window shows the room in (`presentRect`):
the room's on-screen box, the text sized from a stage that is the whole window (no panel, no
margins: `computeStageScale`), at one texel per window pixel, and `present(overlay)` draws it
over the room. The subtitle language and on/off are the browser's `ff.options` from the store.
With none stored, the native host follows the **system language** — Czech on a Czech system
(`locale`), else English. That is a deliberate difference from the browser, which gives a
desktop English whatever its locale (#149): a TV or a console has no browser language picker,
and its system language is the player's choice. The face is `ff.subfont`, the browser's pick,
Mulish by default. There is no way to change either natively yet (the Options screen is not
built).

Approximate by nature, against the browser's own shaping and scaler — see
`compare-subs.mjs` below for how close, and how a wrong one is caught. Also not reproduced:
the browser eases a row's 2 px scroll over a tick (a CSS transition); natively a row steps,
and the wave runs on the game's clock plus the frame's fraction of a tick rather than on the
compositor's.

## Sound

The policy is the browser's, unchanged: `AudioEngine` (`src/audio/audio.ts`) decides what
plays, on which priority, and what `playing()` / `talking()` tell the game. The native host
supplies only the `AudioBackend` under it (`native/js/sdlAudioBackend.ts`, handed over by
`seams/audioEngine.ts`; the browser's Web Audio backend is seamed out of the bundle by
`seams/audio-webAudioBackend.ts`).

- **The mixer** (`native/host/audio.c`) runs at **22050 Hz, mono** — the rate of every sound
  the game ships (the 1998 effects, the staged speech, the music). So it resamples nothing: a
  voice advances one sample per frame, a loop point is a sample index, and a buffer lasts
  exactly `frames / 22050` s, which is what `audioBackend.ts` requires of `duration`. Voices
  have a gain; buses (effect, voice, music) have the Options levels, read from the browser's
  persisted settings (there are no sliders natively yet); then `MASTER_GAIN`. A loop plays
  `[0, loopEnd)` once, then `[loopStart, loopEnd)` for ever, with Web Audio's rules for
  out-of-range points. The mix is clamped to ±1, as an audio destination clips.
- **The one resampling** — 22050 Hz to the device's rate — is SDL's audio stream, on SDL's
  audio thread, in the SDL version `CMakeLists.txt` pins: deterministic for a given device
  rate. It is not Chromium's (which interpolates each source linearly), and nothing the game
  decides depends on it: the clock and every length are counted before it, in source samples.
- **The clock** (`now()`) is the frames mixed so far. A voice started at `now()` plays its
  last sample as the clock reaches `now() + duration`, which is exactly when the policy's
  `playing()` turns false. It stands still while paused, which `audioBackend.ts` allows.
- **`onEnded`** — a voice's end, or a `stop` — is queued by the mixer and delivered by the
  next poll (once a frame), never from inside `start` or `stop`.
- **Decoding**: the 1998 `.ffs` effects keep the game's own decoder (`src/audio/ffs.ts`, to
  PCM, then `fromPcm16`). The AAC — every speech segment (`decodeSegment`) and the music
  (`decode`) — goes to **Audio Toolbox** (`native/host/audio_decode_apple.c`, ExtAudioFile
  reading from memory), behind one host function (`audio_decode` in `audio.h`) that Media
  Foundation would replace on Windows and Xbox. Each MP4 is first passed through
  `src/platform/nativeAudioTiming.ts`: Core Audio honours the movie's millisecond-rounded
  edit and would cut up to a millisecond off a file (7 samples off `rybky08`'s loop).
  Restated in the media timescale, every one of the 1 797 speech sounds decodes to exactly
  its `delka` and every music track to exactly the original's sample count, aligned with the
  original samples at lag 0 (the gate below checks both). A segment is
  then trimmed to `delka`, as the browser's `trimToSamples` does.
- **Line timing** is the browser's: the talk hook (`game.ts`'s `talk`, restating
  `scriptTalk`) holds a line for `delka` less Talking()'s lead, so a line never depends on
  the mixer. The fish's mouths move with `talking()` (`updateLipSync`, restated in
  `native/js/sound.ts`), so the talking heads came with the sound.
- **With an output** (the interactive game) the device's consumption drives the mixer; when
  none can be opened, SDL's `dummy` driver keeps the clock running in real time, silently.
  The 5-second stat line prints the mixer clock against the wall's (×1.000 when healthy).
  **Headless** (`--headless`: the smoke gates) no output is opened and the game drives the
  mixer itself, 1764 frames per 80 ms step (`soundTime` in `sound.ts`), so a headless run
  hears the timeline a player would, tick for tick, at any speed, with no device in it.

`roomLoad` fetches and installs each room's voice package and starts its music, as in the
browser (`seams/stageState.ts` reports the boot as done, so every entry takes that path), and
a room is not ticked until its sound is in, as the browser does not present one. The global
packages (x00 effects, x03 chatter, x02 death lines, the restored lines) are loaded before
the first room (`loadGlobalSounds`). The map plays the menu music; the story pages `rybky11`.

`--audio-log` prints the policy's sound log (every sound started) to stdout.

### Does it sound right? `--smoke-audio`

    native/build/cmake/ff4e-native native/build/game.js --root public --headless \
      --smoke-audio --store native/build/smoke-audio-store.json

`native/js/audioSmoke.ts`, 79 checks in ~8 s:

1. the mixer on synthetic buffers, sample for sample: gains, the loop region (and Web Audio's
   rules for odd loop points), `stop`, `onEnded` after the mix and never inside
   `start`/`stop`, a bus gain applied live, pause, and 80 ms = 1764 frames;
2. every staged speech package (76), all 1 797 sounds (~100 minutes): the decoder alone,
   untrimmed, gives exactly `delka` samples (the policy's own path trims to `delka`, so it
   could not show a decode that runs long), and so does the policy's path (`decodeFfs2`);
   and one sound of every package aligns with the 1998 samples it was encoded from
   (`src/audio/ffs.ts`) at lag 0, no whole-frame or fine shift fitting better — what a
   decoder that kept the AAC priming would fail even if cut back to the right length;
3. every music track (17): exactly the original's sample count, aligned at lag 0 with the
   original WAV the same way, and the looping voice plays `[loopEnd − 4096, loopEnd)` then
   `[loopStart, loopStart + 4096)` of the track sample for sample against the same track
   played straight through, with the loop points computed as `playMusic` computes them;
4. PRVNI's opening through the real flow, the native twin of `tools/test-voices.mjs`'s
   browser assertion: `1st-v-netusim` starts exactly `1st-m-cotobylo`'s talk ticks + 6 after
   it (14 + 6: ticks 18 and 38), both buffers are `delka` long, `playing()` turns false on
   the tick the mixer plays the last sample, the room is audible, and the little fish's
   mouth moves.

CI runs it after the map smoke. The room smoke and the map smoke run with the sound on too —
every voice, effect and music track of every room, on the headless clock.

Not proven by a gate: how it sounds through a real device. It has been run with an output on
a Mac (the mixer clock tracks the wall at ×1.001–1.002), not listened to critically, and the
SDL resampler's output has not been compared with Chromium's.

## Movies and credits

### When they play (`native/js/introScreen.ts`)

As in the browser (`boot.ts`, `mapNav.ts`): a **first run** opens on the start splash, and Ⓐ
plays the ALTAR logo and then the intro, after which `introSeen` is saved in `ff.options` and
later sessions open on the map; the map's **Intro** corner plays the intro alone, at once.
The game's sound is killed first (KillSnd; the movie carries its own), and the map comes back
after the last movie, with its menu music. `--intro` plays the first-run sequence anyway.

The player is `src/app/intro.ts`'s `IntroPlayer` without the page, restated and pinned: a
queue of movies, each URL resolved as it starts; a movie that cannot be opened or decoded
counts as ended, as the browser's load error does, so a missing file cannot wedge a session.
The AI encodes are used when they are there, as the web's `ai` tier picks them (the HEAD
probe is a file check), else the faithful ones.

Controls are the controller spec's (A3 "Intro movies", B2): on the splash **only Ⓐ** (Space,
Enter) starts — anything else is ignored, as a stray key on the web's splash is, so mashing a
button cannot lose the intro; during a movie **any button** skips it (logo → intro → map),
except a bare modifier and Tab, as on the web. A gamepad's sticks arrive as keys (see
Controls), so a stick pushed past its threshold skips too.

What is drawn is the web's, in its CSS px at the window's density: the splash is the title
cover (`/cover.webp`, min(88vw, 1100px) wide, 38% down, on black) and the start button under it
— "▶ Press Ⓐ to start", Ⓐ as the controller's green chip (spec A4/A5); Mulish stands in for
the web's `system-ui`, and the ▶ and the chip are drawn shapes (`native/js/uiDraw.ts`). A
movie fills the window as `object-fit: contain` does (the host's letterboxed, box-filtered
present), and the web's explicit Skip button is replaced, on a TV, by the hint "Press any
button to skip" along the bottom (A4; no legend during the intro), drawn as an overlay the
size of the window.

### The player (`native/js/movie.ts`, `native/host/movie.c`, `movie.h`)

The decoder is the platform's, behind the smallest interface the player needs
(`native/host/movie.h`): open a file, the next frame in presentation order (BGRA, with its
time), and the whole audio track as PCM. `movie_apple.m` implements it with **AVFoundation**'s
`AVAssetReader` (VideoToolbox decodes the H.264, in hardware, and converts it by the file's
colour description; Audio Toolbox the AAC, its priming dropped by the file's edit). Media
Foundation would implement the same four calls on Windows and Xbox; nothing else is per
platform.

- **The clock is the sound.** The movie's audio track is the A/V clock, as a `<video>`'s is,
  and each display refresh shows the last frame whose time is not after it (`movieFrame`):
  decoded forward, uploaded only if it is new, and only the newest when several fell due at
  once. The picture can neither run ahead of the sound nor fall behind it, and the pacing is
  the display's — the loop runs once per vsync. A movie with no sound would run on the wall
  clock. It has ended (the browser's `ended`) once the clock passes its duration, the longer
  of its tracks; the last frame stays up until then.
- **The sound** plays **beside** the mixer, not in it (`audio_movie_*` in `audio.c`): a second
  logical SDL device on the same output, at the track's own rate and channels. The intro is
  stereo, with more side signal than mid (measured), so the mixer's mono would have lost
  much of it. It plays at gain 1, outside the Options buses and `MASTER_GAIN`, as a
  `<video>` element is outside the page's Web Audio graph. With an output, the clock is the
  frames SDL had taken before its latest request plus the time since that request, held
  below what it has taken: what is being heard, give or take a device buffer (SDL reports no
  output latency; on a TV over HDMI that is a known unknown). Headless, the track moves only
  by `movieAdvance`, so the gates see exact instants.
- **The picture** is a BGRA texture replaced whole once per new frame, through one cycled
  transfer buffer (1920×1440: 11 MB, sixty times a second). Measured on an M-series Mac:
  0.6–0.8 ms of the frame including the copy; the whole 73 s intro decodes headless in ~7 s.

### The credits (`native/js/creditsScreen.ts`)

The `ai` roll (`src/render/creditsAi.ts`) is two DOM layers in the browser — the scroll strip
flipped and translated behind the static frame, moved by the compositor — because a canvas
could not match the compositor byte for byte (#209). Natively there is no compositor to
match, so the same picture is painted into a surface the art's size (2560×1920): the frame's
top-left colour, the strip as ONE flipped quad at the browser's own translation
(`creditsTranslate`, imported) sampled bilinearly as the compositor samples a layer at a
fractional offset, and the static frame over it 1:1. It is presented as the map is.

The timing is `drawCredits`', restated: the roll advances continuously off the wall clock at
4 native px per 100 ms, settles at `maxScroll`, and closes itself once the original's stepped
offset passes `closeAt`; any button closes it first (FormKeyDown → DoneCredits). It is reached
from the map's Credits corner, its art loaded on the press, nothing shown until it is in, and
released when it closes (the strip is ~135 MB decoded), as the browser detaches its layers.
A load failure leaves the map as it was and says so on the console: the browser's load note
has no native counterpart yet.

### Does it play? `--smoke-movie`

    native/build/cmake/ff4e-native native/build/game.js --root public --headless \
      --smoke-movie --store native/build/smoke-movie-store.json

`native/js/movieSmoke.ts`, 25 checks in ~10 s, through the real key routing (`keyRoute.ts`, shared
with the interactive loop) and frames: a first
run opens on the splash, which Ⓑ, a stick, a d-pad and Ⓧ do not leave and Ⓐ does, into the
AI logo with the game's sound killed; four seconds of the logo at 60 refreshes a second on
the headless clock, where **every frame shown is the one the sound has reached** (its time not
after the clock, the next one's after it) and every frame of the ~60 fps movie is shown, and
**the sound played is the movie's own track from its first sample** (within 1e-5 of a second
decode: Apple's AAC decoder is not bit-for-bit repeatable; a one-sample shift differs by
more); any button skips to the intro from its start, a modifier does not, and skipping it
reaches the map with `introSeen` saved, the movie's sound gone and the menu music back; the
next session opens on the map; the Intro corner is reached by directions and plays the intro
without the splash, which played to its end shows its last frame and returns to the map, where
a direction held as Ⓐ started it and let go during it is not still steering (the key-up reaches
the map's router during the intro, and the map forgets held keys when it comes back); the
Credits corner opens the roll, any button closes it, and it closes itself once it has
settled; a movie that cannot be read counts as ended.

### Is it the same movie? `native/compare-media.mjs`

    node --import tsx native/compare-media.mjs --self-test      # or --only frames,audio,credits

Three comparisons with the browser's own (`native/media-reference.html`), all tolerance gates,
each with a self-test that draws or plays the native side wrong and fails unless every wrong
one is rejected:

- **Frames**: at 11 fixed times across both AI movies (mid-frame, where the picture moves), the
  frame Chromium's `<video>` shows after a seek, drawn 1:1, against the one the native player
  shows decoding forward from the start as it plays. Two H.264 decoders are never
  byte-identical, so: the worst 32×32 block's mean |Δ| at most 8, the frame's at most 1.5 (a
  colour-matrix or range error moves every pixel). Measured: the same frame at most 2.7
  (block) and 0.38 (frame) with Chromium on Metal, as the harness runs it (4.7 and 0.76 with Playwright's default GL); the
  frame before or after, at these points, at least 20.4; red and blue swapped, far more.
- **Sound**: the track as the native player plays it against Chromium's decode of the same
  file, in 2-second windows across each movie: the best alignment within ±100 ms must be lag
  0 — not one sample off — at a correlation of at least 0.999, and the decoded length within
  1 ms. Measured: lag 0 everywhere, correlation 1.0000; lengths 671 798 / 671 800 (logo) and
  1 616 993 / 1 616 992 (intro). The self-test shifts it by the AAC priming (1024 samples, 46
  ms) either way and by 1 ms: each is found at its lag.
- **Credits**: the roll at seven times after it opened (the start, fractional offsets mid-strip,
  its end, settled) — the browser's real `AiCredits` layers screenshotted against the native
  surface at 2560×1920: max Δ at most 10 and the worst block at most 0.8. Measured: identical at
  the start, max Δ 6 and block 0.38 elsewhere (bilinear rounding). The self-test draws it a
  native pixel (25 ms) late, the strip unflipped, the static frame missing and the wrong
  backdrop: 23 of 23 rejected.

~30 s. `npm run native:check` runs both gates (`movie-smoke`, `media`), as does the manual CI
job.

Not proven by a gate: lip sync through a real output (the clock's device-buffer estimate, and
any TV's own latency), how the movie sounds after SDL's resampler, the letterboxed scaling of
the movie and the splash's layout (looked at on a Mac, not compared), and a pad's stick
skipping a movie.

## Build and run (macOS, Apple silicon)

    brew install cmake ninja
    npm run typecheck:native                                   # native/js against current src/
    node native/build-js.mjs                                   # -> native/build/game.js
    cmake -S native -B native/build/cmake -G Ninja -DCMAKE_BUILD_TYPE=Release
    ninja -C native/build/cmake                                # QuickJS-ng, SDL3, libwebp, FreeType
    native/build/cmake/ff4e-native native/build/game.js --root public --room 3

CMake fetches and builds the four C dependencies at pinned versions (QuickJS-ng v0.17.0,
SDL 3.4.20, libwebp 1.6.0, FreeType 2.15.0), each from a source archive checked by SHA-256,
statically; the AAC decoder is the system's Audio Toolbox. A clean configure and build
takes under a minute. Nothing from Homebrew but the build tools is used, so a package
upgrade cannot change the pixels `compare.mjs` checks.

**The whole gate in one command:** `npm run native:check` (`native/check.mjs`) runs the
typecheck, the bundle, the build, the room, map, sound and movie smokes and the four
comparisons, in the CI job's order, one summary line per step (logs in `native/build/check/`).
`-- --only smoke,subs` reruns just those steps after a build. Quote its summary in the PR.
Controls, keyboard and gamepad (SDL maps any supported controller to this layout; the
gamepad is turned into the same key codes in `native/host/main.c`, so there is one stream
of keys, read by the room's router in a room and by the map's on the map):

| in a room | keyboard | gamepad |
| --- | --- | --- |
| little fish | `I` `J` `K` `L` | d-pad, left stick |
| big fish | `W` `A` `S` `D` | right stick |
| active fish | arrows | |
| switch fish | Space, Tab (`1`/`2` select) | Ⓐ |
| undo one move | `-` (the character, wherever the layout puts it) | Ⓨ |
| restart the room | Backspace | Ⓧ |
| save / load | F2 / F3 | LB / RB |
| back to the map | Esc | Ⓑ |

| on the map | keyboard | gamepad |
| --- | --- | --- |
| move the selection | arrows, `IJKL`, `WASD` | d-pad, either stick |
| open (panel / launch) / press a panel button | Space, Enter | Ⓐ |
| close the record panel | Esc | Ⓑ |
| continue from a story page, close the credits | any key | any button |

| intro | keyboard | gamepad |
| --- | --- | --- |
| start, from the splash | Space, Enter | Ⓐ |
| skip the movie | any key | any button |

Close the window to quit.

Other flags:

- `--room N` starts in room N instead of on the map.
- `--intro` plays the first-run intro (splash, logo, intro) before the map, as a first run does.
- `--demo` plays every room's recorded solution through the real loop (the browser's
  dev-only `solvemode`) instead of reading input: the game plays itself, room after room,
  from where the store says the player left off.
- `--seconds N` quits after N seconds.
- `--store FILE` keeps progress and save slots in FILE instead of the user's.
- `--audio-log` prints every sound the game starts.

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
record it must land on, and then finished: 72 runs. One frame per room is drawn from the
real flow's state. The sound is on — each room's voices, effects and music, on the headless
mixer clock (see "Sound"), so a script that waits for a sound to end waits as it would in
play — and so are the subtitles: every line the rooms say goes through the real
`SubtitleSystem`, and each drawn frame lays them out and rasterises them. `--store` is
required and wiped: a smoke run never touches the player's progress. `--smoke-out DIR` keeps
those frames, and the subtitles on screen at that moment as a 1280×720 window would show them
(`-subs.rgba`).

Each run starts as it would alone — Math.random seeded per room, the chatter history, blink
state and the room's solved flag put back to rest — so `--smoke N` (or `--smoke-player N`)
reproduces what `--smoke all` reported for room N.

~27 s locally with the sound on, ~40 s on CI, which runs it in the `native-macos` job before
the parity sweep.

The map has a smoke gate of its own (`native/js/mapSmoke.ts`, `--smoke-map --store F`): the
map driven key by key through the real flow — a fresh session opens on the map with room 1
selected, Ⓑ does nothing, Ⓐ launches it, its win comes back with it still selected, a
direction moves the selection, the record panel opens on Run and cycles Run → Replay →
Cancel, Ⓑ closes it, Replay plays the best record and comes back, a leg-final room's win
and its Run both show the story page, and Ⓑ in a room goes back to the map. 21 checks, a
few seconds; CI runs it after the room smoke.

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

## Is it the same map? `native/compare-map.mjs`

    node --import tsx native/compare-map.mjs                  # or --cases fresh,panel

Eight states of the `ai` world map (`native/js/mapScene.ts`), each painted by
`paintAiMap` twice — on a plain 2D canvas in Chromium, as the browser's `#screen` is, and on
the native GPU `Surface2D` — from the same art, loaded through one reader
(`native/js/mapArt.ts`), and diffed.

`src/render/surface2d.ts` says which paths a GPU can match byte for byte (nearest draws at
any integer scale, opaque blits and uploads, a binary destination-in mask) and which only
approximately (smoothing, a fractional alpha, a partial-alpha upload). Cases built from the
first are gated at Δ0. The rest must be byte-identical outside the region only their
approximate path draws, and inside it within Δ2 on at most 0.5% of the frame — just above
what is measured — so a regression in what only they draw still fails. An unknown `--cases`
name fails too. Current result:

| case | what it covers | result |
| --- | --- | --- |
| fresh | base map (lit-region mask), reachable balls | identical |
| progress | lit paths, solved/cheat/pulsing balls, corner hover, upscaled plaque, selection ring | identical |
| native-plaque | the 640×480 overlay scaled ×4 nearest | identical |
| panel | unlit map, record panel art, hovered Run, settled odometer, plaque | identical |
| panel-rolling | the odometer mid-roll, hovered Replay | identical |
| launch | unlit map, plaque, parchment | identical |
| panel-noreplay (approx.) | the disabled Replay's 0.55-alpha wash | identical in practice |
| panel-zoomed (approx.) | the phone's enlarged panel: smoothed mask, partial-alpha shadow, ×1.5 | max Δ 1 on 0.2% of pixels |

The enlarged panel is a phone's and never drawn natively; it is there because it is the
one place the interface's approximate paths are all used. CI runs the comparison after the
room sweep.

The story pages are one opaque nearest blit of the upscaled page — the exact path — and are
not compared separately.

## Is it the same text? `native/compare-subs.mjs`

    node --import tsx native/compare-subs.mjs                  # or --cases wave,retina
    node --import tsx native/compare-subs.mjs --self-test      # the gate must catch wrong frames

Seven subtitle states (`native/js/subtitleScene.ts`): a room's palette and screen, lines from
the game's subtitle files said at given ticks, shown at a given tick in a 1280×720 window. Each is
built by the game's `SubtitleSystem` and drawn twice — by the browser's real renderer,
`syncDomSubtitles`, in its real layer (`native/subs-reference.html`, screenshotted, every
wave animation paused at the case's tick), and by the native one into a GPU surface — over a
mid grey, so the dark outline counts.

Text from two rasterisers is never byte-identical (CoreText draws the browser's, FreeType the
native host's; Chromium also composites each glyph as a layer), so this is a tolerance gate,
built to fail on the wrong text, place or colour rather than on two scalers disagreeing:

- **lines**: the ink split into horizontal bands; the same number, each band's ink box within
  1.5 CSS px of the browser's on every edge (extent, centring, baseline, size, how far a wave
  has got);
- **shape**: both blurred by a CSS pixel, the difference averaged over a 7×7-CSS-px window, the
  worst window at most 38 of 255. Two scalers spread their disagreement thinly along every edge;
  a wrong letter, a missing outline or a misplaced glyph concentrates it;
- **colour**: each band's mean fill colour within 10 of 255 per channel.

`--self-test` also draws each case wrong — one letter changed, the text two device pixels low,
the speaker colour's channels swapped, the text 6% larger, no outline, and (mid-wave) the clock a
tick late — and fails unless every one is rejected. Measured on an M-series Mac:

| case | what it covers | box | local Δ | colour Δ |
| --- | --- | --- | --- | --- |
| two-speakers | Czech diacritics, both fish's colours | 0 | 17.8 | 3.7 |
| wrapped | a room as big as the stage: long lines wrapped and stacked, each message fitted smaller; a digit-coded speaker | 1 | 24.8 | 5.2 |
| quotes | `"` and `` ` `` drawn as … and ’ | 1 | 20.7 | 3.0 |
| wave | mid-wave, letter by letter | 0 | 14.6 | 3.0 |
| narrow | the narrowest room (285 px), wrapped to its width | 0 | 19.4 | 4.0 |
| retina | two speakers at 2 pixels a point | 0.5 | 29.6 | 0.3 |
| freesans | the original FreeSans Bold (a face with a line gap) | 1 | 21.1 | 4.2 |

The wrong frames measure at least local Δ 47.1 (one letter, `o`→`e`), colour Δ 35.3 or box
2 px: 36 of 36 caught. What it cannot see: a colour wrong by less than ~10/255, and anything
the two rasterisers would both draw (it is not a check of the fonts themselves). CI runs it,
with the self-test, after the map comparison.

## What it does not do yet

- **Menus (Options), the panel.** The map's Options and Exit corners are therefore not
  selectable, and the volume levels are the ones the browser persisted (the defaults,
  natively). With no Options screen, the subtitle mode and face can only come from the store.
- **Sound, beyond the rooms, the map and the movies:** the cutscene's (it is not played); an
  audio session for tvOS (interruptions, routing — `onGesture`/`onVisible` are
  no-ops here). The AAC is decoded on the main thread as a room is entered (~1.2 s for all
  100 minutes of speech, so a few tens of ms a room); decoded music stays cached for the
  session, as the browser's does (mono float32 at 22050 Hz: ~10 MB a track).
- **KUFRIK's briefcase cutscene and its tutorial demonstration.** The room plays; the
  demonstration is not shown. (It is not an MP4: the browser paints it per game tick from the demo's
  own frames, `src/app/cutscene.ts`, so the movie player does not bring it.)
- **The faithful credits** (`src/render/credits.ts`): the native host is the AI tier, so it
  rolls the AI credits only (and plays the faithful movies only where the AI encodes are
  missing, as the web's `ai` tier does).
- **Cheats** (no way to type one), the fishing hooks they enable, and haptics.
- **Quitting** is closing the window: on the map Ⓑ does nothing, by design, and Esc is the
  same key. On tvOS the system's Home and Back will own it.
- **The Siri Remote** (the controller spec's part B): the map and the panel would already
  work from its d-pad and click, but the room's one-handed scheme and the pause menu are
  not built.
- The host queues at most 128 key transitions between two frames and drops the rest. A
  human cannot get near that in one frame; a long stall with keys being pressed throughout
  could, and would lose key-ups.
- A gated check of LODE's wreck in `compare.mjs`. It runs natively (the smoke gate plays
  LODE to the end), but `compare.mjs` never reaches it: the first swap is at tick 3770,
  after the whole recorded solution. A one-off run of the same harness at ticks 3780 and
  3900 was byte-identical. Each run starts a fresh process, so the in-place patch upload
  (one revision behind) is not exercised there.
- The shaders are MSL only. For D3D12 or Vulkan they would be written once in HLSL and
  translated with `SDL_shadercross`.
