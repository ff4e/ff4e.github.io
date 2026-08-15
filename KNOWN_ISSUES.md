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

## Room solvability net — confirmed same-layout divergences (real port issues the net flags)

The solutions harness (`test/solutions.test.ts` → `test/solutionsHarness.ts` → the shared
`src/core/stepEngine.ts`) replays known-good FFNG solution move-strings per room and asserts
each ends **won, no death, 0 blocked moves** (currently 63/64 mapped solutions). Run standalone
with `npm run test:solutions` (needs game data at `$FFNG_DATA`).

The room's FFNG level layout was verified to match the port's original `.ffr` exactly
(room size + item positions align, per `fillets-ng-data` 1.0.1 on sources.debian.org), so
this is a genuine behavioural gap, not a corpus/layout mismatch. It is skipped in the
test via `KNOWN_DIVERGENT` in `test/solutionsMapping.ts` and must stay skipped until fixed.

### CHODBA #56 (`corridor`) — autonomous robo-dog / darkness timing
- Layout matches FFNG `corridor` (34×37) exactly.
- The early moves replay fine; the divergence is **deep** in the 3669-move solution, once
  the dark/light switch (`vypinac`) and the two autonomous robo-dogs (`item_light`
  robright/robleft) come into play — their patrol desyncs from the recorded cadence and
  the fish path is then blocked repeatedly.
- **To resolve:** compare the port's dog/darkness behaviour against the **Delphi original**
  (`URoom.pas` CHODBA), not FFNG — the port targets 1998 fidelity, and FFNG's tick/dog
  timing may legitimately differ. Decide port-bug vs FFNG-vs-Delphi difference, then either
  fix the port or record a Delphi-native solution instead.

### WIN #68 (`windoze`) — RESOLVED, and it was never a port bug

Kept here because the diagnosis is the useful part. The port's physics and its `WIN` script
replay the bonus level exactly; three things were wrong or missing around it.

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
   was ported; all three now live in `src/core/stepEngine.ts`.
3. **FFNG and Delphi open the bonus at different moments**, so the corpus string hands
   control to the elderly fish two moves before a Delphi-faithful port can accept it.
   Delphi triggers on a position (`URoom.pas:17944`); FFNG triggers on a *blocked* push
   whose obstacle chain reaches the window (`script/windoze/code.lua:64`, `Rules.cpp:615`),
   and a blocked push is never recorded — so the corpus contains no characters for the
   handover at all. The recording is reordered to enter the bonus at the one point on its
   own route where the big fish reaches Delphi's trigger column through open water; the
   eleven inserted characters and why they are neutral are in
   `test/fixtures/solutions/README.md`.

## Room solvability net — coverage gaps (no committed solution)

These playable rooms have **no known solution** to replay (they were never in the FFNG
`ff-ng-saves` corpus, and the 1998 original ships none). They are simply not asserted.

- **POHON #58** — the FFNG slug `rush` is a *redesigned* 37×37 level with colored pistons,
  **not** the original 41×38 beast-push room, so its moves cannot solve the port's POHON.
  `rush` is intentionally left unmapped in `test/solutionsMapping.ts`; `rush.moves` stays in
  the corpus for the record only.
- **SPUNT #29**, **ZELVA #37**, **BARELY #44** — playable, unsolved.
- **LODE #19**, **GRAL #64** — playable, unsolved. Both are gspec=9 push-out rooms; they
  were previously written off as "loose geometric catch-all rooms many strings reach",
  which turned out to be a tooling artifact (see Resolved, below), not a property of the
  rooms.
- **To resolve:** source a walkthrough (or play the port and capture `srecord` via the
  `__ff` debug hook), then add `<slug>.moves` to `test/fixtures/solutions/` and a pin in
  `SOLUTION_ROOMS`. A brute-force engine solver is infeasible (e.g. SPUNT is 50×35 with 10
  movable objects — the state space is far too large).

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
