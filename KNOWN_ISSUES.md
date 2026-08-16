# Fish Fillets port — Known issues

Open/known issues found during the port. Each entry: symptom, what's known, where to look,
next steps. Keep resolved items (with the fix) rather than deleting, so the history is kept.

Severity: 🔴 breaks play · 🟠 visible/audible glitch · 🟡 minor/cosmetic · 🔵 investigation lead

## Test interface: 🟡 `__ff.setRenderer` does less than the real `setRenderer`

- **Symptom:** switching the render backend from a probe does not do everything switching it
  from the game does. No known misbehaviour — filed because it is a silent difference between
  the path the tests exercise and the path a player takes, which is the kind of gap that makes
  a green suite mean less than it looks.
- **What's known (noticed 2026-08-12 while extracting `src/app/renderSettings.ts`):**
  - `setRenderer()` (now `renderSettings.ts`) assigns the backend, calls `enableWebgl()` when
    switching to WebGL, persists `ff.renderer`, syncs the dev-bar select, forces a room repaint
    and wakes the loop, then refreshes the info caption.
  - `__ff.setRenderer` (`debugHooks.ts`) assigns, calls `enableWebgl()` and persists — and stops
    there. No dev-bar sync, no forced repaint, no wake, no caption.
  - So a probe that switches to WebGL and immediately samples a frame may be sampling one the
    old backend painted, unless it waits for a repaint some other way. The probes that do this
    all wait on their own conditions, which is why nothing fails today.
- **Where to look:** `src/app/debugHooks.ts` (`setRenderer` hook), `src/app/renderSettings.ts`
  (`setRenderer`, `setRendererValue`).
- **Next steps:** most likely the hook should just call the real `setRenderer`. Deliberately NOT
  done as part of the `main.ts` decomposition: the probes are the external oracle for that work,
  and changing what a test hook does while using it to prove a refactor is exactly the trap this
  repo has already written down. Worth its own small PR, with the suite re-run to see whether any
  probe was quietly depending on the lighter path.

## Audio: 🟠 KUFRIK demo "beep" right after the steel pipe drops

- **Symptom:** During the KUFRIK automatic demonstration, when the steel pipe (item 4, heavy)
  drops, the falling-steel sound plays fine and *immediately after* a high-volume sustained
  "BEEEEP" plays that "sounds like a broken sound file".
- **What's known (investigated 2026-07-03/04):**
  - The falling-steel sound is `sp-ocel1`. It decodes **perfectly** — a clean metallic clang
    that decays smoothly to silence (peak 15868 → 200, no clipping/garbage tail). NOT the beep.
  - Via the per-sound console log (`🔊 [sound] …`), the beep occurs **right after** `sp-ocel1`
    (@71070ms in one capture) with **no other sound logged** for the beep.
  - Every buffer-source path logs (one-shots `play`, tracked `snd`/`sndcyc`, music
    `music-file`/`music-loop`); buffer rate is correct (22050 Hz). So the beep is **NOT a played
    sound file** — it's an **unlogged Web Audio artifact**.
  - The big fish does NOT die here (no `sp-smrt2` logged), so it's not the death cry.
- **Leading hypothesis:** a **degenerate looping source** — a looping sound (the `kufrik` music
  or a `SndCyc` effect) whose loop region collapses to a tiny segment → it buzzes continuously.
  Logs once when started, then loops silently (matches "sustained beep, nothing logged").
- **Where to look:** `src/audio/audio.ts` (`playMusic` loopStart/loopEnd, `startTracked` loop,
  `snd`/`sndcyc`), `src/app/main.ts` music re-cue (`musiccyc` MusName -999). Debug:
  `__ff.soundLog()`, the `🔊 [sound]` console log (`AudioEngine.logToConsole`).
- **Next steps:** (a) log loop params (`loopStart`/`loopEnd`/`duration`) when a looping source
  starts — a degenerate loop shows `loopStart ≈ loopEnd`; (b) add a ~5 ms fade on stop/kill to
  cheaply kill click/pop artifacts; (c) capture ~3 s of output around the drop and inspect the
  beep's frequency/shape.

## Room solvability net — no confirmed same-layout divergence is open

The solutions harness (`test/solutions.test.ts` → `test/solutionsHarness.ts` → the shared
`src/core/stepEngine.ts`) replays known-good FFNG solution move-strings per room and asserts
each ends **won, no death, 0 blocked moves** (currently 63/63 mapped solutions). Run standalone
with `npm run test:solutions` (the room data is committed under `public/data`).

`KNOWN_DIVERGENT` in `test/solutionsMapping.ts` is **empty**. Both slugs it ever held turned
out not to be port bugs: WIN #68 was a Delphi-vs-FFNG handover-timing difference (resolved,
below) and CHODBA #56 was a corrupt recording (resolved, below). The set is kept because it is
the right place for the next one — but a slug belongs in it only with a measurement showing the
RECORDING is sound and the PORT is what disagrees.

## Room solvability net — coverage gaps (no committed solution)

These playable rooms have **no known solution** to replay (they were never in the FFNG
`ff-ng-saves` corpus, and the 1998 original ships none). They are simply not asserted.

- **CHODBA #56**, **POHON #58** — each has a *plausible-looking* corpus recording that is not
  a usable solution for it. Read the two long notes in `test/solutionsMapping.ts` before
  attempting to pin either; the short versions are in Resolved, below.
- **SPUNT #29**, **ZELVA #37**, **BARELY #44** — playable, unsolved.
- **LODE #19**, **GRAL #64** — playable, unsolved. Both are gspec=9 push-out rooms; they
  were previously written off as "loose geometric catch-all rooms many strings reach",
  which turned out to be a tooling artifact (see Resolved, below), not a property of the
  rooms.
- **To resolve:** source a walkthrough (or play the port and capture `srecord` via the
  `__ff` debug hook), then add `<slug>.moves` to `test/fixtures/solutions/` and a pin in
  `SOLUTION_ROOMS`. A brute-force engine solver is infeasible (e.g. SPUNT is 50×35 with 10
  movable objects — the state space is far too large). **Match on the level TITLE, not the
  slug** — FFNG groups levels under chapter names, which is exactly how POHON got written
  off (below).


## Rendering: 🟡 the `ai` tier's water wobble differs between the two backends

- **Symptom:** in the **AI-upscaled** tier only, the water wobble looks different depending
  on which room compositor painted the frame. On the GPU (WebGL, the default) it is smooth;
  on the canvas-2D fallback it steps in blocks, exactly as the 1998 engine drew it.
  `classic` and `enhanced` are identical on both backends and are unaffected.
- **This is deliberate, not a defect.** The 1998 engine displaced background row `i` by
  `round(wamp/2 · sin(i/wper + count/wspd))` NATIVE pixels — one value per native row,
  rounded to a whole native pixel, advanced once per 12.5 Hz logic tick. Magnified ×4 that
  is a 4-scaled-pixel step, held across runs of a dozen or more scaled rows, lurching eight
  times a second: the one element of a tier built on hi-res art that was still native
  resolution, on screen in 70 of the 72 rooms. None of those three quantizations is part of
  the RULE — they are how a 1998 bitmap index sampled it. `GlAiScreen` therefore evaluates
  the same curve per fragment, at a fractional shift, at `count + alpha`. The tier already
  does exactly this for the spec=1 mirror (`roomAi.ts`, drawMirror: sub-pixel reflection,
  "a free win from having real hi-res art"). Game state, timing and logic are untouched.
- **Why canvas-2D does not follow:** it composites the background as horizontal band blits
  and caches the whole ×S composite on `faze|count`. Matching the spatial half would be
  thousands of `drawImage` calls per rebuild; matching the temporal half would miss that
  cache on *every* display frame and re-blit a 2400×2100 canvas at the display rate. It is
  the fallback path — no WebGL2, context loss, the CPU-only frame effects — and it keeps
  the faithful sampling instead.
- **Side effect worth knowing:** Delphi's `Round` is banker's, so `round(±2.5) = ±2`. The
  quantized peak displacement was 8 scaled px where the data (`wamp/2 = 2.5`) asks for 10.
  The smooth wobble swings ~25 % wider — that is the FFR value finally being honoured, not
  an amplitude change; `wamp`/`wper`/`wspd` are untouched game data.
- **Where to look:** `AiTarget.background` (`src/render/aiTarget.ts`) documents the split;
  `BG_FS` in `src/render/glRoomAi.ts` is the smooth path; `faithfulWobbleShifts` /
  `Canvas2dAiTarget.background` is the faithful one. The rule itself has one definition,
  `waterShift` in `src/render/framebuffer.ts`.
- **How it is guarded:** `tools/test-gl-room-ai.mjs` compares the two backends with
  `wamp = 0` forced (still water), so everything else stays byte-exact at the same gate;
  step 6 then pins the smooth curve against an independent JS reimplementation of the
  shader, scores it against the banded expectation as a negative control, and measures
  smoothness on the pixels alone. `test/roomAi.test.ts` pins the continuous rule against
  the faithful `waterShift` at every band mid-row.
- **The UI does not claim otherwise:** the software-renderer notice says the water is drawn
  at the original resolution, and the dev-bar Renderer picker says the same.
- **Ripple trains are a separate matter, and are a deliberate LIBERTY.** On top of the
  resampled wobble, the GPU path adds a fine wave that rises through the water every few
  seconds (`activeRipples`, `src/render/aiTarget.ts`). The 1998 engine had one sine and no
  more, so unlike everything above this is *not* a resampling of an existing rule — it is
  new motion, added because it was asked for and it looks right. It is confined to the
  `ai` tier and the GPU backend, it scales off the room's own `wamp`/`wper` (no game data
  is edited), and `RIPPLE.amp = 0` restores the pure resampled wobble exactly.
  Tune it live with `tools/ripple-lab.html` on the dev server.

## Audio: 🟡 two 1998 lines whose recordings do not survive anywhere

Found by `tools/sweep-sounds.ts`, which expands every sound name `URoom.pas` can build,
keeps only those passed to a call that actually looks a name up, and diffs the result
against both the release packages and ALTAR's master index in the GPL Delphi source.
Nine names come up; seven are now heard (five were name typos in the original, two are
restored in [`public/restored/`](public/restored/)). These two are not, and cannot be:

- **`mot-v-znovu1` (MOTOR #54, `URoom.pas:16869`).** `addv(30,'mot-v-znovu'+chr(48+random(2)))`
  is a 50/50 pick and only `mot-v-znovu0` shipped. It *was* recorded — ALTAR's master
  `Titl/motor.fft` has it (60416 samples) and the release's `054.ffs` is that stream with
  its 94690 compressed bytes cut out, every later offset shifted by exactly that. The
  audio survives in no distribution, fillets-ng included (`engine/cs` has only
  `mot-v-znovu0`, and `engine/code.lua:125` still rolls the same 50/50). The big fish is
  silent half the time he suggests restarting the engine, here and in FFNG.
- **`steel-x-ticho` (STEEL #55, `URoom.pas:9967-9968`).** `sndcyc('steel-x-ticho',-2)`
  twice, for the press hall's drone. The name is in no package, not in the master index,
  and not in fillets-ng — whose `steel/code.lua` drops the call entirely. The hum appears
  never to have been made; the room's package holds only `steel-m-0/1` and
  `steel-x-redalert`. Kept verbatim in `src/rooms/steel.ts:40-41`.

Neither is fixable without inventing audio, which is out of scope for a faithful port.
Should a build of the 1998 data containing them ever surface, both could be added by
extending the `WANT` table in `tools/build-restored-sounds.ts`.

## Excluded by design (not issues)

- **SCORE #72** — non-playable results screen.

## Resolved

### 🔵 CHODBA #56 (`corridor`) was not a port bug — the recording is impossible — closed 2026-08-16

Filed above for a long time as "the divergence is **deep** in the 3669-move solution, once the
dark/light switch and the two autonomous robo-dogs come into play — their patrol desyncs from
the recorded cadence", with a prescription to compare dog/darkness timing against `URoom.pas`.
Every part of that was wrong, and following it would have started ~3 000 moves from anything.

- **The divergence is not deep. It is move 25 of 3669** — the little fish's very first move,
  right after 24 big-fish moves that replay perfectly. Nothing script-driven has happened yet.
- **The room is the right one.** FFNG's `corridor` is 34×37 like the port's #56, and
  `script/corridor/models.lua` places `fish_small` at (27,6) and `fish_big` at (4,5) — exactly
  where the port's `.ffr` puts its little and big fish. The fish identities are not swapped
  (`ModelFactory.cpp:110`/`118` confirm lowercase = small, uppercase = big).
- **What blocks move 25** is ordinary geometry: the 5-cell heavy pillar plugging the ceiling
  hole at x=30 falls at load and lands at (30,3)–(30,7), sealing the little fish's alcove. That
  is identical in FFNG, so no port change can unblock it.
- **The recording is not a recording.** A fish's X changes only through its own recorded
  left/right move, so a recording's horizontal span is a lower bound on the width of the room
  it came from. `corridor`'s little fish sweeps **1398 columns** of a **34**-column room, in
  ~50 repeats of a `l r×24 d×18` block that never returns left — wider than the widest room in
  the game by 27×. FFNG could not replay it either: `Room::makeMove` throws
  `LoadException("load error - bad move")` on the first refused symbol, and `Unit::goRight`
  only records a symbol for a move that succeeded or a turn. The file is verbatim from
  `alfonz19/ff-ng-saves` `solved/corridor.lua`; what corrupted it upstream is unknown. Only the
  little-fish channel is affected — the big-fish track spans a plausible 24×33.

So CHODBA left `KNOWN_DIVERGENT`, and `corridor` left `SOLUTION_ROOMS`: the room now sits with
the other rooms awaiting a hand-recorded solution. `test/solutionsCorpus.test.ts` pins the span
measurement so the room cannot be re-filed as a port bug, and `ReplayResult` now reports how
many moves were actually **applied** — reading `blocked / steps` as a rate is what made a
case-swapped replay look like a near miss ("6 blocked of 3669" was 6 of 15 applied, after which
a fish died) and put a fish-identity swap on the table in the first place.

### 🔵 POHON #58 is uncovered for an ordinary reason, not because FFNG redesigned it — closed 2026-08-16

`test/solutionsMapping.ts` and this file both said FFNG's `rush` was "a *redesigned* 37×37 level
with colored pistons, **not** the original 41×38 beast-push room". `rush` is indeed not POHON,
but it is not a redesign of it either — and the framing hid the fact that FFNG **does** ship a
faithful POHON:

- `script/propulsion/` is 41×38 with `fish_small` at (32,26) and `fish_big` at (14,12) —
  cell-for-cell the port's #58 — and `worlddesc.lua:787` names it en "The Real Propulsion" /
  cs "Skutečný pohon" under the chapter "UFO", which is `roomTable.ts:82` verbatim.
- `worlddesc.lua:990` names `rush` "Filled Car Park" / "Zaplněné parkoviště" in the chapter
  "Branch of the New Generation" — one of the nine levels FFNG added that the 1998 original
  never had.

So POHON is uncovered simply because `alfonz19/ff-ng-saves` ships no `propulsion` save. The
chapter name is what caused the mix-up, which is the reason the coverage note now says to match
on the level **title**, not the slug.

### 🔴 WIN #68 (`windoze`) — the gspec=5 bonus level was unplayed and unported — fixed 2026-08-16

The room sat in `KNOWN_DIVERGENT` recorded as a port bug, with both fish dying in the bonus.
It was never a port bug: the port's physics and its `WIN` script replay the bonus level
exactly. What was wrong was the decoder, two unported `gspec=5` behaviours, and the
recording, which encodes FFNG's control handover rather than Delphi's. Kept at length
because it is what the answer looks like when a "port bug" turns out not to be one — CHODBA
#56 above was the next such case, and turned out not to be a port bug either.

1. **The move decoder dropped a quarter of the solution.** `solutionsHarness.ts` silently
   discarded any character it could not decode, so the 214 `w/x/y/z` bonus moves (27% of
   the 783) never ran and nothing said so. The decoder now models the elderly pair —
   `w`=up, `x`=down, `y`=left, `z`=right, read off FFNG's model kinds `fish_extra-wxyz` /
   `fish_EXTRA-WXYZ` and `ModelFactory::parseExtraControlSym` — and an undecodable
   character now throws instead of shortening the replay.
2. **gspec=5 was documented as cosmetic and is not.** `URoom.pas:24825-24880` completes
   every move/turn/fall on its first frame while the bonus is running, the `repeat/until`
   at `24927-24928` resolves the whole move-plus-fall chain inside one tick, and
   `26997-26998` takes control away from an elderly fish already parked at x=1. None of it
   was ported; the first two are now in `src/core/stepEngine.ts` and the active-fish switch
   in `src/app/logicTick.ts`.
3. **FFNG and Delphi open the bonus at different moments**, so the corpus string hands
   control to the elderly fish two moves before a Delphi-faithful port can accept it.
   Delphi triggers on a position (`URoom.pas:17944`); FFNG triggers on a *blocked* push
   whose obstacle chain reaches the window (`script/windoze/code.lua:64`, `Rules.cpp:615`),
   and a blocked push is never recorded — so the corpus contains no characters for the
   handover at all. The recording is reordered to enter the bonus at the one point on its
   own route where the big fish reaches Delphi's trigger column through open water; the
   eleven inserted characters and why they are neutral are in
   `test/fixtures/solutions/README.md`.

### 🔴 LODE #19 was missing `gspec:=9` (push-out win condition inert) — fixed 2026-07-27
- `LODE_InitProgramky` (URoom.pas:7930) declares LODE a **push-out room**: you win by
  shoving one of the two gods off the room edge, and the fish are **not** allowed to exit.
  `src/rooms/lode.ts` `init()` ported every other line of that block but dropped `gspec:=9`.
- Two player-visible consequences: the faithful `Spec9` marks (URoom.pas:19488/19640) were
  never consumed, so the cork exit-slide (`stepEngine.ts`, gated on `gspec === 9`) never
  ran and the room could not be won by pushing; and a fish walking off an edge wrongly won
  the room, which the original forbids (`if (gspec<>9)and(kontroluj_okraje>0)`,
  URoom.pas:24295).
- Fix: restore `s.room.gspec = 9` in `src/rooms/lode.ts` `init()`. `vytlacit` needs no
  change — LODE never overrides the default 1 (URoom.pas:1445). Regression coverage in
  `test/lode-pushout.test.ts`. All eight Delphi `gspec:=9` room inits now match the port
  (LODE, SPUNT, ZELVA, BARELY, MAPA, POHON, GRAL, DISKETA), as do gspec 2/3/4/5/42.
- Follow-on 1: restoring gspec=9 exposed an over-broad render gate — the enhanced
  (truecolor) background was gated on `gspec === 0`, so **every** gspec=9 room silently
  fell back to classic art. Only gspec 2/5/42 actually replace the room render, so the
  gate is now `classicOnlyBackground()` (`src/render/enhancedArtSource.ts`), and SPUNT,
  MAPA, POHON, DISKETA, GRAL, ZELVA, BARELY and LODE all show their enhanced background
  again (CPU/GPU parity still byte-exact — `tools/test-gl-room-enh.mjs`).
- Follow-on 2: `tools/map-ffng.ts` replayed physics only, so it saw `gspec = 0` everywhere
  and exited fish from push-out rooms — which is what made LODE/GRAL look like "catch-all"
  rooms and got them excluded from the solvability net. The tool now runs each room's
  `init()` for its `gspec` and suppresses fish exits in gspec=9 rooms; its `CATCHALL` list
  is gone and `test/fixtures/solutions/mapping.tsv` is unchanged by the switch.

### 🟠 Effects played too loud (clipped on loud overlaps) — fixed 2026-07-03
- Effects (landings, death cries, bubbles, room-script `snd`/`sndcyc`) were played at full VOICE
  volume (1.0) instead of the original's `snd_volume = 48/64 = 0.75` (voices stay at
  `talk_volume = 64/64 = 1.0`, RSound.pas:33-35). Loud near-full-scale effects overlapping (e.g.
  the `sp-smrt2` death scream + a landing) summed past 0 dB and hard-clipped.
- Fix: `EFFECT_VOL = 48/64` applied to those effect plays in `src/app/main.ts`; voices (dialogue,
  cutscene, exit cheers) and explicit `SndVol` unchanged. (Did NOT fix the separate "beep" above.)

## Notes

- Per-sound console logging (`🔊 [sound] <name> vol=<v> @<t>ms`) is currently ALWAYS ON
  (`AudioEngine.logToConsole = true`) — spams the console in normal play. Gate behind a toggle
  (default off) once the audio debugging is done.
- The KUFRIK demo (help.cap replay) cannot be fully reproduced headlessly: reaching the demo spot
  needs solving part of the tutorial, and the demo's save/load replays the move record (which only
  exists with real navigation). Verified piecewise, not end-to-end. A real `__ff.showmodeTrace()`
  capture from a live playthrough could seed a faithful end-to-end regression test.
- Two observables have no oracle at all. Found by a mutation-testing pass during the `main.ts`
  decomposition; both predate that work (their read/write sites were unchanged by it).
  - `roomVoicesSettled` / `roomVoicesReady` (`src/app/roomLoad.ts`): no vitest test and no UI probe
    reads them. The dialogue queue is gated on them, so a regression that let an opening
    conversation be consumed while the .ffs was still downloading would be silent.
  - `forceRoomRedraw` (`src/app/framePacing.ts`): removing it from the repaint condition in
    `renderLoop.ts` fails NO probe, because `sig !== lastRoomSig` independently covers the cases the
    probes exercise. It exists for the signature-INVISIBLE transitions (room entry, resize, fit
    change, pointer), which is exactly what nothing tests.
