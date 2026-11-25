# Native host (macOS and Apple TV; Xbox is next)

> **Experimental. Not shipped, not part of the web or iOS build, and `src/` does not depend on
> it.** Nothing under `native/` is imported by the game; it only imports *from* `src/`. Its
> whole gate runs locally as `npm run native:check` (below), which a change to `native/` or to
> `src/` code the bundle imports runs before its PR. The same steps are the `native-macos` job
> in `.github/workflows/checks.yml`, which runs only when started by hand: hosted macOS runners
> queued too long to wait on. No release consumes it.

The game **without a browser**. It plays a whole game now — from the world map, room after
room, with undo, saves, the record panel's Replay and the leg story pages, and with its
sound and subtitles, the intro movies and the credits, KUFRIK's briefcase story and its
tutorial demonstration, and with the TV menus a console needs —
a pause menu, Options, Help, a button legend — playable from a keyboard, a gamepad or a Siri
Remote, on the AI-upscaled tier:

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
- The menus and the button legend are native-only (the web keeps its HTML UI): one
  window-sized `Surface2D` layer over the room or the map — see "The TV menus" below.
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
macOS; on tvOS, which keeps no app data for sure, SDL's choice, `Library/Caches/ff4e/Fish
Fillets 4ever/`: see "Apple TV"), so progress and save slots use the browser game's keys and format. Each write is
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

Of the corner buttons, **Intro**, **Credits** and **Options** are selectable, and Ⓐ on one does
what a click does (`dispatchMapCorner`): the intro movie, the credits roll over the map (see
"Movies and credits"), or the native Options (see "The TV menus"). Exit is left out, as the
controller spec leaves it out: Back at the map is the way out. The story pages are the
upscaled ones (`/enhanced-ai/_story/`).

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
Mulish by default. The language can be changed in the native Options (below), which writes the
same key; the face cannot (Options has no font row), but a stored `ff.subfont` is still read.

Approximate by nature, against the browser's own shaping and scaler — see
`compare-subs.mjs` below for how close, and how a wrong one is caught. Also not reproduced:
the browser eases a row's 2 px scroll over a tick (a CSS transition); natively a row steps,
and the wave runs on the game's clock plus the frame's fraction of a tick rather than on the
compositor's.

### The TV menus (`native/js/uiInput.ts`, `menus.ts`, `uiLayer.ts`)

Native only: the web keeps its HTML UI. Built to the controller spec (#165's, extended for the
Siri Remote; A3–A6 and B1–B5 in it): every press goes through one router (`uiInput.ts`), which
knows the source from the host's code (`Pad…`, `Remote…`, or a DOM key code), and hands the
game the keys the browser's router reads — so every gate of that router still applies.

**The look is the web touch UI's** (`src/styles/nativeMenu.css`, commit af252e9, #158), in the
room's colours: the same reviewed static hue per room (`src/data/nativeMenuHues.ts`) through
the same `menuPalette` (`src/platform/nativeMenuPalette.ts`), imported and parsed into numbers
(`uiPalette.ts`) — the room on screen, or the last one while a room loads and on the map.
Surfaces are its translucent slate glass with the hairline edge and the inset bevel
(`uiGlass.ts`); the pause menu and the confirm prompt carry its rustic carved icons
(`src/styles/nativeMenuIcons.svg`, bundled as text and rasterised natively per colour role —
`rusticIcons.ts`; Resume and Help, which the web has no button for, are drawn in the same
hand). Labels are its ink with its soft dark shadow. Focus is the touch UI's pressed state —
how a held button looks — and, on the Options face, its touch Options' `--menu-accent` outline.

**A menu opens on the frame it is asked for.** Everything a menu draws is rasterised in the
interpreter for the window's size — its icons, its words' glyphs, its glass — and on an Apple
TV QuickJS is several times slower than on a Mac (an A12 core against an M-series one: about
3.5× by single-core benchmarks; the gates take 5×). So:

- A rounded box is drawn as nine pieces: its corners from the mask of a small box with the
  same radius, its straight parts as plain rectangles (`uiDraw.ts`, `sliced`) — pixel for
  pixel the whole mask, but costing its corners, not its area. **This was the 4K pause menu's
  5-second open on the Apple TV:** at 2160 lines its glass was 2¼ million pixels of
  distance tests, 581 ms of a 590 ms first frame on an M4 Mac (Options 136 ms, the confirm
  prompt 146 ms) — seconds on an A12.
- The menus are **rehearsed** before they are needed (`uiLayer.ts`): drawn onto a surface that
  keeps nothing, which fills the caches the real drawing then finds full. All of them when the
  UI starts (after the input source and the safe area are known, for the window it starts in),
  and again whenever what they would draw changes — the window's size, the language, the
  input's glyphs, the screen, a setting a menu shows — then within ~2 ms a frame while no menu
  is up, so play does not hitch (`uiCost.ts`'s `rehearse`). At 2160 lines that takes ~30
  frames on a Mac.
- When a menu opens, its first frame's cost is logged by phase — `ui: pause opened at
  3840×2160, its first frame 0.6 ms: …` — in the device console, and so is the start's.

The menu smoke opens the pause menu, Options, Help and the restart prompt at 3840×2160 inside
tvOS's insets after the room's frames got them ready, and holds each first frame under 10 ms
on the Mac (50 ms at the Apple TV's 5×): 0.5–2 ms there now.

**Every string is in the UI's language** (`uiStrings.ts`): Czech or English, the language the
subtitles and the map's plaques are in (`subLang()`; subtitles off keep the last one chosen),
which on a first run follows the system's. The web has no Czech UI chrome to reuse, so the
Czech words follow ALTAR's own Czech help (`helpText.ts`). Mulish has the Czech diacritics.

- **The pause menu** — Resume · World map · Save · Load · Restart · Options · Help — opens on
  Back in a room (Esc, the pad's ☰, the remote's Back): tvOS requires Back during play to pause
  and show a menu. While any menu is over a room the room is **paused**: no logic step runs and
  the sound holds its place (`setModalPause`, as the browser's Help does). Save, Load and
  Restart ask first ("Save the game?" — Ⓐ / a click / Enter yes, Ⓑ / Back / Esc no; the card
  shows the pad's or the remote's answers as the legend's small hints, the keyboard's none), then send
  F2, F3 or Backspace down the room's router, so a save mid-move or during a replay is refused
  exactly as F2 is on the web. Save and Load are greyed (and skipped by the highlight) when they
  cannot act, by the touch buttons' rule (`buttonAvailability.ts`, pinned): never during
  the KUFRIK demonstration, which teaches them. On Resume the room
  continues from the frame it stopped on.
- **Options** is the original game's Options face — the AI-upscaled panel art the tablets show,
  composited as `AiPanel.drawOptions` composites it — scaled to most of the window, with a focus
  outline on the row and a caption card of the touch UI's glass beside it naming the row and
  its value. Rows: effect, talk
  and music volume (left/right step the 0..12 slider), subtitles (Čeština / English / off),
  Help, and Exit options — the 1998 face's own, and nothing the face has no place for (a
  subtitle-font row was tried and taken out). Every change is persisted to the browser's key
  (`ff.options`) and applied at once: the bus gain, the next line's language and the map's
  plaques (`optionsModel.ts`).
- **Help** is the browser's ten pages (`src/data/helpText.ts`, ALTAR's text and the cropped
  diagrams), typeset natively into the original 640×480 page box by the stylesheet's rules
  (`helpPaint.ts`); left/right page (wrapping), anything else closes. Approximate by nature: the
  line breaks are a greedy wrap's, and there is no italic face natively, so the emphasised
  phrases and the notes are upright.
- **The legend** (A4) shows what each button does on the screen that is up, in the glyphs of
  the last input used — an Xbox pad's or the remote's — as small "[chip] Word" hints shaped
  like the first Xbox WebView prototype's (`xbox-port`'s `.pad-hints`, its 10-foot sizes at
  1080 lines: a 26 px round chip, 18 px words, no card behind them, muted to 75 %), scaled
  with the window and no smaller than at 720 lines. Each chip is the room's glass with its
  symbol in the room's carved-icon colour; the pad's A/B/X/Y keep their hues at that
  lightness, so they stay apart. It goes down the left letterbox margin as a short list when
  that fits, else as one row in the top margin, against the SCREEN's edge, a small fixed
  margin in: 12 px at 1080 lines on a desktop, 20 px (1.9 %) on a TV. Not the title-safe
  area's edge, as the menus keep to: tvOS's insets are the same 80 points at the sides and 60
  above and below on every set, which put the hints far from the edge on the sets that do not
  overscan, as nearly none does now (TestFlight feedback, twice); the 20 px leave a little for
  one that still overscans. On a TV it is laid out against the whole window and sized for its
  height (`legend.ts`, `TV_EDGE`). Otherwise it lies over the picture: one row
  along the top edge on a strip of the touch UI's popup glass, drawn at full strength there,
  as muted light words vanish into the map's parchment. The top, not the bottom: the
  subtitles have the room's bottom, and the map's bottom carries the selected level's name.
  Where it goes depends on the window, the picture and the words only — never on the game's
  state: "Switch fish" always reserves the wider fish picture (the little fish's), so
  switching fish cannot move it between the margin and the top. Items that cannot act are dimmer. With the remote,
  "Switch fish" carries the active fish's picture at the chip's height (B3: the touch badge's
  art and its visibility rule), the only cue to which fish an edge click moves. **The keyboard
  gets no legend, on any screen**, nor answer hints on the confirm prompt: its player knows
  the keys, and keycaps would only cover the picture. With nothing to draw the UI layer is
  not drawn at all.
- **At the map's root, Back leaves the game** (the keyboard's Esc, the remote's Back): tvOS
  requires Back at the top level to go Home, and App Review rejects a game that quits itself.
  So on macOS it quits, and on tvOS the game does nothing with it: each frame the router tells
  the host whether the plain map is up (no record panel, menu, launch or story page), and the
  host turns `SDL_HINT_APPLE_TV_CONTROLLER_UI_EVENTS` on there — the remote's Menu goes to the
  system, which goes Home — and off everywhere else (`systemBack`, `native/host/main.c`). SDL
  sets the view controller's `controllerUserInteractionEnabled` from that hint on every change
  (`SDL_uikitviewcontroller.m`, `SDL_AppleTVControllerUIHintChanged`); the host reads it back
  every frame, sets it itself if it ever disagrees, and logs each change (below). Ownership
  is decided again when Back reaches the root, not only at the last frame: two quick Backs
  drained in one poll can close Options or the record panel and then press Back at the root
  they uncovered, and that second one is the system's too. And on tvOS the game never quits
  itself, whatever the system does with Back (`mapKey`, `uiInput.ts`). The host
  also sets `SDL_HINT_TV_REMOTE_AS_JOYSTICK` to 1 on tvOS rather than rely on SDL's default.
  The pad's Ⓑ still does nothing on the plain map, on purpose.
- **The remote's Back comes from GameController, not SDL.** On TestFlight build 2 Back opened
  the pause menu once in many presses. SDL 3.4 reads the remote's Menu/Back by polling
  `isPressed` once per `SDL_UpdateJoysticks` (`SDL_mfijoystick.m`, the `physicalInputProfile`
  loop of `IOS_MFIJoystickUpdate`), but tvOS runs a gesture recognizer over that button and
  hands the app its press and release together, after the release — GameController's header
  says as much (`GCMicroGamepad.h`, `GCInputMicroGamepadButtonMenu`: "You should avoid polling
  this button every frame … register a pressedChangedHandler"). Both land between two polls,
  and SDL sees nothing; it latches the deprecated `controllerPausedHandler` for exactly this
  (`pause_button_pressed`), but only its pre-tvOS-14 profiles read the latch. So
  `platform_tvos.m` registers the Menu button's `pressedChangedHandler` on every remote, the
  host counts each press and sends it as a whole tap, Back down and up
  (`native_remote_menu`, `remote_menu_drain`), and ignores SDL's polled copy (B). The menu
  smoke shows the loss with SDL's own code — a virtual remote's B pressed and released
  between two polls makes no event, held across one makes two (`__native.remoteBackProbe`) —
  then drives room → Back → pause → Back → room five times through the handler's path, two
  presses in one poll as two taps, and at the map's root, with the system owning Back as on a
  TV, Back left to it — also as the second of two Backs in one poll that first close Options
  (and, in the map smoke, the record panel) — and Back at the root on tvOS never quitting.
- **☰ in a room opens the pause menu**, on every native platform. The controller spec's A3
  has the pad's ☰ open Options directly; its B4 has it open the pause menu on tvOS. A deliberate
  deviation from A3: one native TV UI everywhere, and Options is one row away.

Everything is drawn through `uiDraw.ts`: rectangles, procedurally rasterised glyph shapes
and the carved icons (coverage masks, tinted by `fillMask`), FreeType text in Mulish and images. It also records
what it drew, which is the layout snapshot the menu smoke checks.

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
  have a gain; buses (effect, voice, music) have the Options levels — the browser's persisted
  settings, which the native Options sliders change live — then `MASTER_GAIN`. A loop plays
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
  The 5-second stat line prints the mixer clock against the wall's (×1.000 when healthy). An
  output that stops asking for sound is reopened, the clock meanwhile kept on the wall's time
  (below, "When the sound does not come back").
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

### When the sound does not come back (Apple TV)

TestFlight tvOS build 3: *"sometimes when I close (minify) the app, on reopen the sound goes
completely off. I have to kill the game and then reopen."* What SDL 3.4.20 does with the audio
session on tvOS (`src/audio/coreaudio/SDL_coreaudio.m`, its iOS section):

- it activates the AVAudioSession **once** (`session_active`, set when the first device opens)
  and never again: nothing clears the flag when the system deactivates the session, so SDL
  never calls `setActive:YES` after an interruption;
- an interruption's *began* pauses the AudioQueue and marks it `interrupted`
  (`InterruptionBegin`); the only way back is `InterruptionEnd`, which retries
  `AudioQueueStart` — no reactivation — on three notifications only: the interruption's *ended*,
  `UIApplicationWillEnterForeground` and `UIApplicationDidBecomeActive`. If the start fails at
  each of those moments (the session still inactive, the app not yet active, another app's
  session holding the output), or an *ended* never comes (Apple does not promise one), the queue
  stays paused for good: SDL asks the mixer for nothing more, and the game is silent until it
  is killed;
- route changes and media-services resets are not handled at all on iOS/tvOS (only macOS
  listens for default-device changes);
- closing a device does not deactivate the session either (`COREAUDIO_CloseDevice` →
  `UpdateAudioSession(…, false)` counts the closing device itself), so a reopen alone would
  never call `setActive:YES` again: the host does it itself before every reopen.

The game makes the interruption likely: its session is **solo ambient** (above), not mixable,
so any other app that plays sound while it is in the background — the TV app, Music, a Top
Shelf preview with sound — interrupts it. "Sometimes" is whether that happened while away.
Nothing on our side noticed: `audio_suspend(false)` resumed the SDL streams, which were never
the problem, and the mixer's clock stood still with the dead queue, so `playing()` stalled too.

What the host does now (`audio_poll`, `audio_notice` in `native/host/audio.c`; the session's
side in `platform_tvos.m`):

- every notice the session gives — interruption began/ended, became inactive/active (tvOS 27's
  `AVAudioSessionDidBecomeInactiveNotification` with its source), resumption recommended, route
  changed, media services lost/reset — and every app lifecycle event is logged and handed to the
  mixer;
- back in the foreground, at an interruption's end or a route change, the session is reactivated
  (`setActive:YES`); if the session was taken away meanwhile, the output is **reopened** at once;
- a **watchdog**: an output that has not asked for sound for 750 ms (in the foreground, not
  deliberately paused) is reopened — a new SDL device, so a new AudioQueue — and again after 1,
  2, 4, 8 s, then every 8 s for as long as it stays dead; meanwhile the mixer's clock runs on the wall's time, silently,
  as SDL's dummy driver would, so nothing waiting on a sound waits for ever. A removed SDL
  device and a media-services reset are reopened at once. Both streams (the mixer's and a
  movie's) are reopened together: they share one SDL device, which closes only with its last;
- nothing the game hears is lost: the voices, the music's place and the clock live in the mixer,
  not in the SDL stream. The trip away itself is not counted (`suspended`, released once — a
  repeated lifecycle event changes nothing) — not even when the output was already dead when
  the player left — and a room's pause menu taken for the background stays the game's to
  release.

**The price of taking the session back.** The session is solo ambient, so reactivating it — on
every return, and within ~1 s of an interruption the game outlives on screen — stops whatever
the player had playing (Music, AirPlay) as the game's sound comes back, as launching the game
does. That is deliberate for now: the game's sound is the game. A player who wants their own
music under the game would need the category to change (ambient, mixable), not this rescue.

**Reading the audio log.** Every step above goes to the device's unified log, subsystem
`io.github.ff4e.fishfillets4ever`, category **`audio`**: in Console.app (the Apple TV under
Devices, Start) filter on `subsystem:io.github.ff4e.fishfillets4ever category:audio`, or
search `audio`; with Xcode attached the lines are in its console. A trip away that comes back
healthy reads `app: will enter the background`, `suspended for the background, the mixer clock
at …`, `app: in the foreground`, `resumed in the foreground…`, `session active: category …,
route …`. A rescue reads `session lost: …` or `the output stopped pulling…`, then `reopening the
output (…)`, `output reopened: driver coreaudio, device '…', … Hz` and `the output is pulling
again…`. The line `session active: …` names the route (HDMI, AirPlay, Bluetooth) and whether
other audio is playing. On a Mac the same lines are `SDL_Log`ged, prefixed `audio:`.

**Checked on a Mac** (`--smoke-audio-lifecycle`, `native/js/audioLifecycleSmoke.ts`, ~40 s,
with an output: the Mac's device, or SDL's dummy driver where there is none):

    native/build/cmake/ff4e-native native/build/game.js --root public --headless --audio-output \
      --smoke-audio-lifecycle --store native/build/smoke-audio-life-store.json

`__native.audioLifecycle` (main.c, only with that flag) plays the system's part through the
host's real paths: the app events through the event watch, the session's notices through
`audio_notice` as `platform_tvos.m` sends them, a removed device through SDL's event path, and
`kill` — the streams stop asking for sound, as SDL's paused AudioQueue leaves them. It checks a
trip home and back, Control Center, every event twice, a line spoken across 2 s away (it ends
exactly `delka` of mixer clock after it started, the time away not counted), an output dead on
return with no word (watchdog), an interruption while away with and without its end (reopened
at once), the pause menu across a trip, an output dying in the foreground (and staying dead:
the retry schedule, the clock on the wall's time), an output still dead when the player leaves
(the time away not driven through the mixer on return), the retry still due within 8 s after 32
and 41 failed reopens (`failed:N`), a route change with a live output (kept), a
media-services reset with a movie playing (both streams back, the movie's clock running on) and
a removed device. `npm run native:check` runs it (`audio-life`), as does the manual CI job.
**Waits for a device:** that tvOS really sends these notices in this order,
that `setActive:YES` and a reopen succeed where SDL's restart failed, and the route names.

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

### KUFRIK's briefcase story and tutorial (`native/js/cutsceneScreen.ts`)

Not a movie: the browser paints the story per game tick from the 1998 demo's own frames. What
plays it is imported, not restated — `src/app/cutscenePlay.ts`, split out of `cutscene.ts` for
this (the browser keeps the page half there): the room's script starts the story at the
briefcase's phase 8 (`InitKufrDemo`); `logicTick.step` runs one step of its script per tick,
with the KD-* narration voiced through the `AudioEngine` and captioned, each line holding the
script until its voice has sounded its FFT `delka`; the looping `kufrik` music starts with it
and outlives it; it ends by itself or is skipped. The tutorial demonstration — help.cap replayed
one action a tick once both fish stand at its spot, through its scripted death and restart, the
help lines in the dialogue queue — is the same module's, as is a map Replay holding both back
(`replayAtShowmodeSpot`). Entering KUFRIK holds until the story and the recording are read, as
the browser's entry does (`seams/roomPreload.ts`, its KUFRIK half restated). So it plays exactly
when the browser's does: on every entry, once the player's moves knock the briefcase down.

The picture is the `ai` tier's (`drawCutscene`'s upscaled path): the upscaled suitcase-and-TV
base (×4), with the upscale of the frame on screen over the animation's region — or the 1998
pixels, nearest-neighbour at the same scale, for the one frame shipped without an upscale — on
one 2880×2220 surface, repainted when the frame changes and presented as the map is. Frames are
read from the draw path four ahead, at most eight held, and released when the story ends or is
skipped; until the base is in (a frame or two) the faithful frame shows, upscaled bilinearly.
The captions are a layer of their own (`roomSubtitles.ts`, `cutsceneCaptionOverlay`), sized from
the story's own box as `updateCutsceneCaptions` sizes them, and drawn into a surface that box's
size, so rows still scrolling in from below are clipped to the picture as the browser's
`overflow: hidden` layer clips them.

Skipping is the controller spec's (A3, B2): the pad's Ⓑ, Ⓐ or ☰, the remote's click or Back,
and the keyboard's Esc (the browser's `zrus_kufr`). Every other button is swallowed, as the
browser's router swallows it, so nothing opens a menu over the story. The legend says "Ⓑ Skip"
(the remote's "‹ Skip"; the keyboard, nothing). While the demonstration says how to save and
load (help2, help7, help11), the legend's Save or Load pulses as the touch button does
(`tutorialHint.ts`, with `dialogueHints.ts`'s rules); with the remote, whose Save and Load are in
the pause menu, its Menu pulses.

`--demo` and the smoke gate play KUFRIK's recorded solution as the map's Replay of it, not as a
live run (`PLAYED_AS_REPLAY`, `game.ts`): the solution walks through the tutorial spot, and a
live run that does starts the demonstration, which restarts the room.

### Does KUFRIK play? `--smoke-kufrik`

    native/build/cmake/ff4e-native native/build/game.js --root public --headless \
      --smoke-kufrik --store native/build/smoke-kufrik-store.json [--smoke-out DIR]

`native/js/kufrikSmoke.ts`, 56 checks in ~20 s, through the real flow and input routing.
Entering KUFRIK holds until the story and the recording are read. The solution's first moves,
typed, knock the briefcase down, and the story starts by itself with the `kufrik` music; its
narration is voiced on the voice bus and captioned, each line starting as the one before has
sounded its `delka` as the room's .fft gives it (±1 tick), and the long KD-ufo caption, scrolling
in, leaves no ink outside the story's box in a window taller than the picture (read back from the
GPU); over 200 distinct pictures are shown, the upscaled frame decoded
on at least 90 % of ticks; it plays to its end, its art is released, the music plays on and the
briefcase closes. Other buttons during it open nothing and move nothing; each of the six skips
ends it, stops the narration and keeps the music. Fish at the tutorial spot (put there, as the
browser's probe puts them: the spot is past the steel block's puzzle) start the demonstration
unprompted: the big fish turned left, Save and Load available, all 1605 actions played through
its death and restart, the fish moved by it, 22 help lines voiced in the queue's timing, the
legend's Save and Load (and the remote's Menu) pulsing through help2, help7 and help11 and at no
other time, and the room handed back. The map's Replay of the solution drops the briefcase and
walks both fish through the spot without the story or the demonstration, and wins.

Not proven by a gate: the captions' pixels and positions against the browser's (they are the room
subtitles' renderer in a different box, which `compare-subs.mjs` covers, not compared over the
story), and
help6, which the demonstration queues just before its scripted death and the restart drops
(the restart builds a new script, as `main.ts`'s does; the browser's probe does not ask for it
either).

### Does it play? `--smoke-movie`

    native/build/cmake/ff4e-native native/build/game.js --root public --headless \
      --smoke-movie --store native/build/smoke-movie-store.json

`native/js/movieSmoke.ts`, 28 checks in ~11 s, through the real input routing (`uiInput.ts`, shared
with the interactive loop) and frames: a first
run opens on the splash, which Ⓑ, a stick, a d-pad, Ⓧ, Esc and the remote's Back and edge click do not leave and Ⓐ does, into the
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

    node --import tsx native/compare-media.mjs --self-test      # or --only frames,audio,credits,story

Four comparisons with the browser's own (`native/media-reference.html`), each with a self-test that draws or plays the native side wrong and fails unless every wrong
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
- **KUFRIK's story**: at six ticks of its script run silent on both sides (before the first
  frame, early, the frame shipped without an upscale, mid, the last), the native picture
  (`--story-scene`, `storyScene.ts`) against the browser's `ai` composition of the same tick
  (the upscaled base and frame, or the original pixels through the game's own
  `drawIndexedRegion`). Every draw is a 1:1 or nearest blit of opaque art, so this one is exact:
  the same frame chosen, and max Δ 0. Measured: identical at all six. The self-test shows the
  previous point's picture and red and blue swapped: 10 of 10 rejected.

~40 s. `npm run native:check` runs both gates (`movie-smoke`, `media`), as does the manual CI
job; KUFRIK's story and tutorial have their own smoke (`kufrik-smoke`, above).

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
typecheck, the bundle, the build, the room, map, menu, sound, movie, KUFRIK and store smokes and the four
comparisons, in the CI job's order, one summary line per step (logs in `native/build/check/`).
`-- --only smoke,subs` reruns just those steps after a build. Quote its summary in the PR.
Controls: keyboard, gamepad (SDL maps any supported controller to an Xbox layout) and Siri
Remote. The host sends each as its own codes (`native/host/main.c`); `native/js/uiInput.ts`
decides what they do. The remote is modelled from SDL's source — on tvOS SDL presents it as a
gamepad (`SDL_HINT_TV_REMOTE_AS_JOYSTICK`): the click is A, Play/Pause X, Back B, the touch
surface the left stick; on a 2nd/3rd-generation remote a click on the ring's edge is that
d-pad button and a centre click is A — and has **not** been run on an Apple TV. On the
1st-generation remote (no ring) an edge click is read from where the thumb rests, which needs
absolute d-pad values (`GCMicroGamepad.reportsAbsoluteDpadValues`); SDL leaves them relative,
so the tvOS build sets them itself (`native/host/platform_tvos.m`).

**Swipes** (in menus and on the map; never in a room) are the thumb's TRAVEL, not where it
is: SDL reports the touch surface only as the left stick's axes — the position, with absolute
values, and (0, 0) once the thumb lifts, no touch-down or lift event — so the host hands the
position over each frame (`__native.remoteTouch`) and `native/js/remoteSwipe.ts` measures it
from where the thumb came down: every 0.5 of travel along the dominant axis (a quarter of the
surface's width) is one step that way, so a long swipe keeps stepping as a list scrolls under
it and a fast one takes the steps it covered; a thumb resting on an edge is no swipe. Nothing
counts while a click is held. A click toward the edge a swipe stepped to in the last 300 ms
is that swipe's end — a swipe finishing on the ring — and is dropped where swipes act, so it
is one step, not two; a centre click is always a click, and in a room every click acts.
`test/native-remote-swipe.test.ts` feeds it taps, slow, fast and long swipes and one that
ends at an edge. The host reads those axes RAW (`remote_axis`): SDL maps the remote's y
inverted and `SDL_GetGamepadAxis` rescales an inverted axis in float, so a lifted thumb reads
(0, −1) there, never (0, 0) — the lift was never seen, and every swipe started from the
centre and partly undid itself on the lift (TestFlight build 1). The menu smoke checks the
raw reading through a virtual remote mapped as SDL maps one (`__native.remoteProbe`), and the
tracker also takes anything within 3/32767 of the centre as a lift. On a Mac, `--remote-keys` makes the keyboard a remote, and
the whole keyboard counts as the remote: any other key it sends (a letter, F2) leaves the
remote the last input, so its hints stay up.

| Siri Remote | with `--remote-keys` |
| --- | --- |
| click an edge (held: held) | arrows |
| click the centre (switch fish, select, open) | Return, Space, Tab |
| Play/Pause | `P` |
| Back | Esc, Backspace |
| swipe | Shift+arrow |

| in a room | keyboard | gamepad | Siri Remote |
| --- | --- | --- | --- |
| little fish | `I` `J` `K` `L` | d-pad, left stick | |
| big fish | `W` `A` `S` `D` | right stick | |
| active fish | arrows | | click an edge (held: keeps moving) |
| switch fish | Space, Tab (`1`/`2` select) | Ⓐ | click the centre |
| undo one move | `-` (the character, wherever the layout puts it) | Ⓨ | Play/Pause (held: repeats) |
| restart the room | Backspace | Ⓧ, then Ⓐ to confirm | pause menu |
| save / load | F2 / F3 | LB / RB, then Ⓐ to confirm | pause menu |
| back to the map | | Ⓑ, ⧉ | pause menu |
| pause menu | Esc | ☰ | Back |
| — | | | a swipe does nothing (decided: a stray swipe must not cost a move) |

| on the map | keyboard | gamepad | Siri Remote |
| --- | --- | --- | --- |
| move the selection | arrows, `IJKL`, `WASD` | d-pad, either stick | swipe, or click an edge |
| open (panel / launch / a corner) / press a panel button | Space, Enter | Ⓐ | click the centre |
| Options | (the corner) | ☰ | Play/Pause |
| close the record panel | Esc | Ⓑ | Back |
| leave the game (macOS; tvOS: the system goes Home) | Esc | (nothing, on purpose) | Back |
| continue from a story page, close the credits | any key | any button | any button |

| intro | keyboard | gamepad | Siri Remote |
| --- | --- | --- | --- |
| start, from the splash | Space, Enter | Ⓐ | click the centre |
| skip the movie | any key | any button | any button |

| in a menu | keyboard | gamepad | Siri Remote |
| --- | --- | --- | --- |
| move / change a value / turn a help page | arrows, `IJKL`, `WASD` | d-pad, sticks; LB / RB page | swipe, or click an edge |
| press | Enter, Space | Ⓐ | click the centre |
| back (resume, decline, close) | Esc (in Help: any other key) | Ⓑ, ☰ | Back (in Help: a click too) |

Other flags:

- `--room N` starts in room N instead of on the map.
- `--intro` plays the first-run intro (splash, logo, intro) before the map, as a first run does.
- `--demo` plays every room's recorded solution through the real loop (the browser's
  dev-only `solvemode`) instead of reading input: the game plays itself, room after room,
  from where the store says the player left off.
- `--seconds N` quits after N seconds.
- `--store FILE` keeps progress and save slots in FILE instead of the user's.
- `--tv-store DIR` keeps them as tvOS does (see "Saves on tvOS"), over files in DIR standing in
  for NSUserDefaults and iCloud; `--store` is then the cache file.
- `--audio-log` prints every sound the game starts.
- `--remote-keys` makes the keyboard a Siri Remote (above) and starts the legend in its glyphs,
  as a tvOS build always starts (`__native.tv`); a Mac starts with the keyboard's: none.
- `--tv-safe-area` lays the menus out inside the title-safe insets tvOS gives a TV (scaled to
  the window), and the legend with a TV's edge margin, to see on a Mac where they go on one.
- `--input-log` prints the input log (below, "Reading the remote's input log") to stderr.
- `--startup-probe` checks what the game needs at start except the GPU — the store, the
  assets, the sound — prints one line and quits (`native/js/startupProbe.ts`). It is what runs
  in the Apple TV Simulator, and a `native:check` step.
- `--read-log FILE` lists every asset the run read (see "Apple TV": the app's asset subset).

From a Rosetta shell, prefix the commands with `arch -arm64`, or the universal tools
build x86_64.

## Apple TV

The same host, the same bundle, built for tvOS. It is the iOS app's App Store record (a
universal purchase): the bundle id `io.github.ff4e.fishfillets4ever`, under the existing app.

    npm run native:tvos                       # device build, unsigned: compiles and links?
    npm run native:tvos -- --simulator        # the Apple TV Simulator
    npm run release:testflight:tvos -- --build N        # a signed archive (tools/, read its header)

Every tvOS build, the device's included, needs Xcode's tvOS Simulator runtime: `actool` will
not compile the asset catalog for tvOS without one (`xcodebuild -downloadPlatform tvOS`).

`native/tvos/build.mjs` bundles the JS, stages the assets, has CMake generate an Xcode project
for tvOS from `native/CMakeLists.txt` (`-G Xcode -DCMAKE_SYSTEM_NAME=tvOS`, into
`native/build/tvos/`) and runs `xcodebuild`. **Why CMake's Xcode generator, not a checked-in
Xcode project:** the host's sources and the four pinned, hashed dependencies are listed once,
for every platform — QuickJS-ng, SDL3, libwebp and FreeType all build for tvOS from the same
`FetchContent` pins with no change — and the generated project is what only Xcode can do:
automatic signing, the asset catalog, `xcodebuild archive`. A second project would be a second
list to keep in step. The dependencies' static libraries are marked `SKIP_INSTALL`, so an
archive holds the app alone.

**tvOS 27 and up: the Apple TV 4K 2nd generation (A12) and newer**, the A19 model included.
SDL 3.4's Metal GPU driver needs an A9 GPU or newer on tvOS (`MTLGPUFamilyApple3`, no
opt-out), and the Apple TV HD (A8) runs up to tvOS 26; tvOS has no device capability that
tells an A8 from an A9+, so the OS version is the floor. tvOS 27 also leaves out the 4K 1st
generation (A10X), which SDL could drive — the price of keeping the HD out. The number lives
once, in `native/CMakeLists.txt` (`FF4E_TVOS_DEPLOYMENT_TARGET`; Xcode makes it the app's
`MinimumOSVersion`), which refuses a lower target. **It needs an Xcode with the tvOS 27 SDK:**
`build.mjs`, the release lane and CMake itself stop at once, saying so, when the installed
SDK is older. The no-GPU alert (below) stays, as a defence.

**The app** (`native/tvos/`): `Info.plist` — the remote alone is enough
(`GCSupportsControllerUserInteraction`; the micro and extended gamepad profiles supported,
none required), the puzzle-games category, arm64, a black launch screen (`UILaunchScreen`, the
splash's black), one scene (SDL supplies the scene delegate); `FishFillets.entitlements` —
iCloud key-value storage only (its use is the saves' work, #222); `Assets.xcassets` — the
layered App Icon and the Top Shelf images. **The artwork is a placeholder**, made by
`make-placeholder-art.mjs` from `public/app-icon.png` and `public/cover.webp`; the real
parallax icon and Top Shelf replace its PNGs one for one, same names and sizes.

**What it ships** (`native/tvos/stage.mjs`): `game.js` and the part of `public/` the native
host reads, by rule — the `ai` tier's art, the rooms, their subtitles and the staged speech,
the AAC music, the AI movies, the fonts, the help figures. Not the faithful and `enhanced`
tiers, the 1998 help bitmaps, the WAV originals, the faithful movies, nor the 1998 `.ffs`
speech the `.ffs2` was staged from. **348 MB of 689** (the app, signed and with its asset
catalog: 347 MB on disk; tvOS allows 4 GB). The rules are checked, not trusted:
`native:check` runs every smoke with `--read-log` and then `stage.mjs --check`
(`tvos-assets`), which fails on any file the game read that the app would not ship. (The
smokes' read is a lower bound — ZAVER's art, a story page nobody reached — which is why the
rules are by directory and kind, and the check only ever adds to them.)

**tvOS in the host** (`main.c` and `platform_tvos.m`, under `SDL_PLATFORM_TVOS`):

- *Started with no arguments*: the bundle and the assets are found in the app
  (`SDL_GetBasePath`); launch arguments are the game's.
- *The window* is the screen, at its pixels: 1920×1080, or 3840×2160 on a 4K Apple TV driving
  a 4K set (two pixels a point, `SDL_WINDOW_HIGH_PIXEL_DENSITY`). Everything is laid out for the
  window it gets, as on a Mac; the menus are rehearsed for its size at start (above).
- *Title-safe area.* The menus keep inside the view's `safeAreaInsets` (60 points above and
  below, 80 at the sides; `__native.safeArea`, `native/js/safeArea.ts`): the UI layer is drawn
  into the safe rectangle and laid out for its size, a menu's scrim still dims the whole
  window. The hints do not: the legend and the intro's skip hint hug the screen's edge (the
  legend 20 px in at 1080 lines, the skip hint 18 px off the bottom, as on the web), since
  tvOS's insets are the same large ones whether the set overscans or not. The pictures — the
  room, the map, a movie — stay letterboxed to the whole screen, as a TV game's picture is,
  and so do the subtitles, which are the room's. The menu smoke checks, at 1920×1080 and
  3840×2160 with those insets, that nothing of Options or the pause menu is drawn outside
  them, and that the legend is drawn 20 px (×u) in from the screen's edge.
- *Sound*: the audio session is **solo ambient** (`SDL_HINT_AUDIO_CATEGORY`), not SDL's
  default (playback, mixing with others): the music and the voices are the game, so another
  app's music stops while it plays, as for most games, and nothing asks to keep sounding in
  the background, which the app does not declare. A TV has no silent switch, so ambient's
  difference there is moot.
- *Leaving and coming back.* An SDL event watch — called inside the system's own callback,
  before the app is suspended — holds the mixer and the movie clock where they are and
  pauses the outputs (`audio_suspend`), and the loop stops stepping and drawing (no GPU work is
  allowed in the background). Back, the audio session is reactivated and an output SDL did not
  restore is reopened ("When the sound does not come back", above). The first frame back delivers `!background`, and a room is
  paused as Back pauses it: the pause menu up, the room held (`uiInput.ts`). The map, an open
  menu, the intro and the briefcase story carry on where they stopped. Losing the screen to
  Control Center or Siri is the same event. Nothing needs saving on the way out: every store
  write is made durable when it happens (`n_storeSave`; on tvOS `store.c`). The menu smoke drives `!background` on the map and
  in a room.
- *The store*: NSUserDefaults within its budget, the whole store in a purgeable cache file,
  progress in iCloud key-value storage — see "Saves on tvOS".
- *The remote*: absolute d-pad values on every remote, swipes measured from the thumb's
  travel, Back from GameController's handler (see Controls and "The TV menus").

**Reading the remote's input log.** Every remote button as SDL reports it, Menu/Back as
GameController's handler reports it, each touch on and off the surface, every input event
the host sends (`-> +RemoteBack`), what the router made of each remote press (`route
RemoteBack on room -> menu pause`), the remote's SDL mapping as it connects, and who owns Back
(`ui-events 1 (map root, Back goes Home): controllerUserInteractionEnabled=1`) go to the
device's unified log, subsystem `io.github.ff4e.fishfillets4ever`, category `input`
(`input_log` in `main.c`, `tvos_log` in `platform_tvos.m`). Only presses and changes are
logged, never a line a frame. To read it: on a Mac paired with the Apple TV (Xcode → Window →
Devices and Simulators), open Console.app, pick the Apple TV under Devices, press Start, and
filter on `subsystem:io.github.ff4e.fishfillets4ever category:input` (or search `input`); with
Xcode attached to a run the lines are in its console as well. Without a Mac at hand, the same
log is on the TV: **hold Play/Pause for 5 s on the world map** (its press opens Options, which
the hold closes again) to show its last 14 lines over the top right of the screen
(`native/js/inputOverlay.ts`, newest at the bottom, highlighted); the same hold hides it.
It is off at every launch. On a Mac, `--input-log` prints the log to stderr, and with
`--remote-keys` the hold is a held `P`.
- *No GPU*: SDL GPU (Metal) does not start in the Apple TV Simulator ("Device does not meet
  the hardware requirements"), nor on an A8 Apple TV — which tvOS 27 keeps from installing
  the app. The host then says so in an alert and quits, rather than crash; with
  `--startup-probe` it carries on without one.

**What has run without a device.** In the Apple TV Simulator (tvOS 26.5, `Apple TV 4K (3rd
generation)`): the app installs and launches, the alert above appears, and the startup probe
passes — the bundle evaluated in ~40 ms, `__native.tv` true, the store written under
`Library/Caches`, a device audio output opened, the menu music decoded by Audio Toolbox:

    xcrun simctl launch --console-pty <udid> io.github.ff4e.fishfillets4ever --startup-probe

With a temporary, uncommitted override of the target to 26.5 (this Mac has Xcode 26.6, tvOS
26.5 SDK), the device build compiles, links (arm64) and archives with signing off, and the
Simulator build runs the probe above; with the committed 27.0 the configured project's
`TVOS_DEPLOYMENT_TARGET` is 27.0, and the build stops at the SDK check. Everything
drawn, the remote, the lifecycle and the safe area wait for a device — and so does how the
remote is told from a pad: by a name with "Remote" in it (`is_remote`); the Simulator's
stand-in reports itself as "Gamepad".

**Signing.** The archive is built unsigned, its entitlements (iCloud key-value storage) are
stamped on with a local signature, and the export signs it for the App Store with automatic
signing (`native/tvos/build.mjs`, `tools/release-testflight-tvos.mjs`). Not the iOS lane's
automatically signed archive: that needs a tvOS *development* profile, which Apple makes only
for a team with a registered Apple TV — *"Your team has no devices from which to generate a
provisioning profile"*, 2026-11-24 — while the App Store profile the export makes needs no
device. Every archive-only run also exports locally and checks the result: Apple
Distribution, an App Store profile, and the iCloud entitlement (an unsigned app would export
without it). **What the account holder must do first:** install an Xcode with the tvOS 27
SDK; sign Xcode in to the developer account (Settings → Accounts: without it the local export
fails, *"No Accounts"*); accept the current Program License Agreement (without it the export
fails, *"PLA Update available"*: Apple makes no new profile); add the tvOS platform to the app
in App Store Connect before the first upload. The archive itself is unsigned and never
touches the account. tvOS builds are numbered on their own, from 1: App Store Connect keeps
each platform's versions and builds apart.

**Symbols.** The archive carries the app's dSYM, for App Store Connect to symbolicate a crash
with — build 1 had none (*"Upload Symbols Failed"*): CMake writes "Generate Debug Symbols: NO"
for a Release build whose flags have no `-g`, and pins the products to its own tree, where
`xcodebuild archive` does not look for a dSYM. So the tvOS Release build compiles with `-g`
(every target's, so SDL, QuickJS and libwebp are in the dSYM too, and an archive leaves the
libraries unstripped for the app to link), and the app writes its dSYM where the archive
collects it (`native/CMakeLists.txt`). The app itself ships stripped, as before. The lane
stops unless the archive's dSYM has the app binary's UUID (`dwarfdump --uuid`).

## Does it play? The smoke gate (`native/js/smoke.ts`)

    native/build/cmake/ff4e-native native/build/game.js --root public --headless \
      --smoke all --smoke-player 13,70 --store native/build/smoke-store.json

Every room with a recorded solution (70 of 72: ZAVER and SCORE are the ending and the
results screen) is entered through `roomLoad` and played through `solvemode` — every tick of
the real `logicTick.step`, the moves through the real `tryStep`, the win through the real
auto-return — and must be left by a win, with `ff.solved` on disk saying so. KUFRIK is played
as the map's Replay of its solution instead (see "KUFRIK's briefcase story and tutorial"). Rooms 13
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
Cancel, Ⓑ closes it, two remote Backs in one poll on an Apple TV close it and leave the second
to the system (never a quit), Replay plays the best record and comes back, a leg-final room's win
and its Run both show the story page, and Ⓑ in a room goes back to the map. 22 checks, a
few seconds; CI runs it after the room smoke. Its input goes through the same router as the
window's (`uiInput.ts`).

The menus have one too (`native/js/menuSmoke.ts`, `--smoke-menus --store F`): input events
through the router, checked against the game's own state and the store, never against what
a menu says about itself. On the map: the pad's ☰ opens Options; a volume step is persisted to
`ff.options` and reaches the mixer's bus at once; the subtitle language and its `tit_def` are
persisted; there is no font row, and the subtitles still take their face from `ff.subfont`; Help opens over Options, pages
and closes; the pad's Ⓑ at the root does nothing while Esc and the remote's Back leave; the
Options corner is selectable and opens Options. In a room, with the remote: the centre click
switches fish, an edge click moves the active one (also just after a swipe toward that edge), a swipe moves nothing, Play/Pause undoes
one move and, held, repeats (350 ms, then every 80 ms) with nothing added on release; Back
opens the pause menu and the room stops stepping; a swipe steps its highlight, and a swipe
ending on the ring toward its edge steps it once; Load is greyed and skipped with no save;
Save asks, Back declines, a click saves the move record; Load restores it; Options and Help
open from the pause menu and close back to it; Restart starts over; a save mid-move is
refused as F2 is. With the pad: Ⓧ asks to restart and Ⓑ declines, RB with no save opens
nothing, LB → Ⓐ saves, ☰ opens and closes the pause menu, Ⓑ goes to the map; Esc opens and
closes the pause menu, and its Save prompt (the question alone) is declined by Esc and
answered by Enter; its World map leaves the room. A Play/Pause hold released inside the
pause menu ends there. With the keyboard last, no hints are drawn on any screen (and, on the
map and in a room, no UI layer at all). At 81 window widths across the margin/top switch
the legend is where it was with either fish active. With Czech subtitles the pause menu, the
legend, the confirm prompt and Options are Czech. In windows the map, a room and a story page fill, the
hints lie on their dark strip; in a letterbox margin, they do not. A room's first frame shows
the remote's hints (room 1, and KUFRIK), and so does the room on leaving the pause menu; with
`--remote-keys` a key the host leaves unmapped keeps them. At 3840×2160 inside tvOS's insets
the room's frames get the menus ready, and the pause menu's, Options', Help's and the restart
prompt's first frames are each under 10 ms (above). At 1080 and 2160 lines the TV legend hugs
the screen's edge, 20 px in at 1080 lines (not the title-safe area's): the map's and room 1's
list at its left, UTES's row at its top. Back as an Apple TV delivers it (above, "The remote's
Back comes from GameController"). First, though, what the UI draws
with (`uiAssetSmoke.ts`): every carved icon rasterises with ink in every painted part, the
fast rasteriser's masks equal the exhaustive one's (at 25 px here; `test/native-icons.test.ts`
sweeps 45 sizes under V8), the whole set's time at 2160 lines is
printed (under a bound far above it), and every UI string in both languages has a real glyph
for each character in both of the UI font's weights. 123 checks, ~12 s.

It also checks the **UI layout snapshot**: at 29 states (four of them Czech) the UI layer is drawn into a 1280×720
window (three of them into windows the picture fills; six — the map, room 1 and UTES — into a
1080- and a 2160-line TV, with its title-safe insets) and the list of what it drew — every
rectangle, shape, image and string, with its position and size in whole pixels — must equal
`native/ui-layout.snap.json`. A layout change fails with the first op that moved and writes
the new list to `native/build/ui-layout.snap.new.json`; if intended, rerun with
`--update-snapshot` and review the file's diff. It is not a pixel comparison (the web has no such screens to compare with):
it catches a moved, resized, missing or reworded element, not a wrong colour inside one.
`--smoke-out DIR` keeps each state's pixels (`DIR/ui-<state>.rgba`) and the picture under
it (`DIR/pic-<state>.rgba`: the room's composite or the map), to look at together.

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

## Saves on tvOS (`native/js/tvStore.ts`, `storeBudget.ts`, `progressSync.ts`, `native/host/store.c`)

On a Mac the store is one JSON file (`--store`, or `store.json` in the user's Application
Support), written whole and durably on every change (`shims.ts`). tvOS has no such place:

- "your app can only access 500 KB of persistent storage that is local to the device (using
  the `NSUserDefaults` class). Outside of this limited local storage, all other data must be
  purgeable by the operating system when space is low" — and the cache directory "may be
  deleted" "when space is low and your app is not running" (Apple, *App Programming Guide for
  tvOS*, "Local Storage for Your App Is Limited").
- SDL knows it: on tvOS `SDL_GetPrefPath` returns a directory in **Caches**
  (`src/filesystem/cocoa/SDL_sysfilesystem.m`, "tvOS does not have persistent local
  storage!"). So the file store as it is would lose a player's progress whenever tvOS needed
  the space.
- iCloud's key-value store (`NSUbiquitousKeyValueStore`): "no more than 1024 keys", "1
  megabyte" for all values, "128 characters" a key; a write over a limit fails whole
  (Apple, `NSUbiquitousKeyValueStore`).

**What there is to keep** — measured with the real undo sampler on every recorded solution
(`test/undoRoomHarness.ts`; a slot as `saveGame` writes it, one move before the win):

| | bytes |
| --- | --- |
| a fresh game (`ff.schema`, `ff.options`) | ~0.2 K |
| every room solved: `ff.best` | 50.5 K |
| ... `ff.scores` / `ff.playtime` / `ff.solved` / `ff.options` / `ff.subfont` / `ff.schema` | 0.6 K / 1.0 K / 0.2 K / 0.1 K / 16 / 10 |
| a save slot, median of 70 rooms (without its undo history: 0.7 K) | 15.8 K |
| ... ZAVAL, 156 moves (its script state changes on every move) | 120.9 K |
| ... MAPA 5 983 moves / DISKETA 5 323 / BANKA 1 603 / TRUHLA 2 046 | 82 K / 73 K / 55 K / 41 K |
| ... the largest without its undo history (MAPA: the record is a byte a move) | 6.2 K |
| a save in all 70 rooms (without undo histories: 64 K) | 1.42 M |
| a long session: 2 000 more moves back and forth in ZAVAL / BANKA / UTES | 144 K / 79 K / 32 K |

Progress is small and bounded (~52 K); the save slots are not — the undo history a slot
carries grows with every move made in the room.

**So there are three copies** (`TvStore`), and the game is not told about any of them — it
speaks `localStorage` as on the web, and its save logic (`persist.ts`, `saveGame`) is untouched:

1. **NSUserDefaults** (`ff4e.store`, the store as UTF-8 JSON in an `NSData`): the copy that
   lasts. Written first, on every change, within a **400 000-byte budget** (`TV_BUDGET`; the
   host refuses over 500 000). Progress — every key that is not `ff.save.N` — is always kept
   whole. A save slot keeps its move record and script state whole; its undo history is what
   yields (as `saveGame` already makes it yield to a browser's quota): the *oldest* points go
   until the slot fits **32 KiB** (`TV_SLOT_CAP`), so a load still steps back through the
   newest moves (ZAVAL's 157 points → its newest 30). If the copy is still over budget, the
   other slots lose their history, largest first. Only then: a slot that does not fit even
   bare is refused (the `QuotaExceededError` `saveGame` handles: no "saved"), and a progress
   write — never refused — pushes whole slots out of this copy, largest first. With every
   room solved and a heavy save in 24 rooms the copy is ~398 KB.
2. **The cache file**: the host's ordinary store file, which on tvOS lives in Caches. It holds
   everything, whole undo histories included. Every write goes to NSUserDefaults first (then
   `synchronize`) and to the cache next, with the same write number. At launch the cache is
   used whenever its number is not older: the same write (it is the fuller copy), or a newer
   one — NSUserDefaults lost writes the cache kept (it is fsynced; a power cut just after a
   save), and the NSUserDefaults copy is put right at once. A cache *older* than
   NSUserDefaults missed a write and is not used. A write NSUserDefaults refuses still goes to
   the cache and iCloud (and the write is reported failed, as on a Mac); a launch is never
   stopped by one. While tvOS leaves the cache alone a load
   resumes exactly what was saved; when it has been purged, the NSUserDefaults copy is the
   save.
3. **iCloud's key-value store**: the progress only (`ff.solved`, `ff.cheated`, `ff.scores`,
   `ff.best`, `ff.playtime`, `ff.options`, `ff.subfont`; ~55 KB), so it survives a reinstall
   and is shared with the player's other Apple TVs. iCloud resolves a conflict on a key by
   keeping the newest write, so **no device writes another's key**: each writes its copy under
   `ff4e.progress.<device id>` (the id lives in the NSUserDefaults copy; a reinstall makes a
   new one), and every copy is merged (`progressSync.ts`; the web has one copy and no merge
   rules to mirror — these follow `persist.ts`'s keep-the-best guards):

   | key | merge |
   | --- | --- |
   | `ff.solved`, `ff.cheated` | union |
   | `ff.scores` | the lowest move count per room |
   | `ff.best` | per room, the record of the copy with the lower score (a tie keeps this device's) |
   | `ff.playtime` | per room, the sum of every device's *own* time: each copy also carries every device's own time it knows of (largest wins, as it only grows), so two Apple TVs playing offline add up and what one merged from another is not counted twice; never below what the store holds, so an iCloud that reads empty (signed out, another account) takes nothing away |
   | `ff.options` | per field (`volume.music`, `subtitles`…), the newest *change*: a field carries the time the player last changed it; a first write — a new device's first-run intro writing the defaults — carries none, so it never outweighs settings made elsewhere, and nor does a field the value before lacked (added by a newer version, written as its default); a change is stamped after the field's current stamp, so a device whose clock runs ahead cannot hold a field |
   | `ff.subfont` | the newest write (only the player choosing a font writes it) |

   A value that is not what its key should hold loses to one that is. Each device's copy is
   the merge of all, so near 1 MB the copies it already holds everything of are removed.
   At launch every copy is merged in before the game reads a key. While the game runs,
   iCloud's change notification (another device, or the first download after a reinstall)
   becomes the host's `!kvs` event: the progress keys are merged into the store *and* into
   the running game's own sets (`adoptRemoteProgress`), so the map shows another Apple TV's
   rooms at once; options apply at the next launch. (So on a new Apple TV whose first iCloud
   download comes after launch, the intro still plays once, and the options set elsewhere
   arrive at the next launch — without being overwritten by that intro's defaults.)

An unreadable NSUserDefaults copy is set aside (`ff4e.store.damaged`), never overwritten, and
the game starts from the cache — or, with no cache, from iCloud's progress. On a Mac,
`--tv-store DIR` runs all of this over files that stand in for NSUserDefaults
(`DIR/defaults.json`) and iCloud (`DIR/kvs.json`), with their limits enforced; the cache is
the `--store` file. Saving ZAVAL's 121 KB slot (cutting it to 32 KiB) takes ~45 ms in
QuickJS on an M-series Mac.

**What is checked where.** `test/native-tv-store.test.ts` (V8, ~0.6 s): real ZAVAL slots
(and one 2 000 moves longer) cut to their newest points with record and script state whole;
every room solved with 24 heavy saves under the budget, progress byte for byte; a purged and
a stale cache, and a cache newer than NSUserDefaults (which wins); a refused slot and a
progress write that never is; a damaged defaults copy; the merge table; two Apple TVs writing
only their own keys and taking in each other's; a new Apple TV's first-run defaults not
resetting another's options, and per-field option changes from two devices both kept, a
clock running ahead, a field a newer version adds; play time on two Apple TVs offline adding
up, and never lowered by an empty iCloud; a failed NSUserDefaults write still writing the
cache and not stopping a launch; a reinstall getting every room back. The store smoke (below) runs the real game in QuickJS
over the host's stand-ins. **Needs a device:** that NSUserDefaults really keeps 500 KB on
tvOS, the iCloud round trip and its notification timing (including the first download after
a reinstall), and what tvOS actually purges.

**What the app shell needs.** The iCloud capability with **Key-value storage** (no
CloudKit container): the entitlement `com.apple.developer.ubiquity-kvstore-identifier` =
`$(TeamIdentifierPrefix)$(CFBundleIdentifier)`, i.e. `<TEAM>.io.github.ff4e.fishfillets4ever`
under universal purchase's shared bundle id (an iOS build using the same identifier would
share the store). Apple: to use the store "you must distribute your app through the App
Store or Mac App Store, and you must request the iCloud key-value store entitlement". Nothing
else: NSUserDefaults needs no entitlement, and `store.c` starts the store
(`synchronize`, the change observer) itself.

### Does the store keep? `--smoke-store`

    native/build/cmake/ff4e-native native/build/game.js --root public --headless \
      --smoke-store --tv-store native/build/smoke-tv --store native/build/smoke-tv/store.json

ZAVAL typed to its last move and saved with F2 through the real `saveGame`: the whole
attempt in memory and in the cache, NSUserDefaults holding it within the cap with its record
whole and its newest points; a relaunch with the cache purged finds that save; F3 loads it,
undo steps back through every kept point and stops at the oldest; the room is finished and
the win is in NSUserDefaults and in this device's iCloud copy; another device's copy
arriving (`!kvs`) reaches the running game's sets, its play time adding to this device's;
every room's best record and 24 heavy
saves stay under the budget with progress whole; and the stand-ins refuse what tvOS and
iCloud refuse. 16 checks, ~7 s; the DIR is wiped first. In `native:check` and the
`native-macos` job after the KUFRIK smoke.

## What it does not do yet

- **The faithful side panel** is not drawn: a TV plays from the legend and the pause menu.
- **Run on an Apple TV.** The tvOS app builds, archives (unsigned; signed once the account
  allows: see "Apple TV") and starts in the Simulator up to the GPU, but nothing has run on a
  device: the remote's SDL mapping, Back at the map's root going to the system, the absolute
  d-pad, the audio session, the lifecycle, the safe area, the store's tvOS side
  (NSUserDefaults, iCloud: `store.c`, `store_apple.m`) and the frame rate at 4K are all
  written from documentation and source.
- **Sound, beyond the rooms, the map, the movies and KUFRIK's story:** audio routing, and an
  interruption (a call on a paired device) beyond SDL's own handling — `onGesture`/`onVisible`
  are no-ops here. The AAC is decoded
  on the main thread as a room is entered (~1.2 s for all 100 minutes of speech, so a few
  tens of ms a room); decoded music stays cached for the session, as the browser's does (mono
  float32 at 22050 Hz: ~10 MB a track).
- **The faithful credits** (`src/render/credits.ts`): the native host is the AI tier, so it
  rolls the AI credits only (and plays the faithful movies only where the AI encodes are
  missing, as the web's `ai` tier does).
- **Cheats** (no way to type one), the fishing hooks they enable, and haptics.
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
