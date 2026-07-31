# Fish Fillets port — Known issues

Open/known issues found during the port. Each entry: symptom, what's known, where to look,
next steps. Keep resolved items (with the fix) rather than deleting, so the history is kept.

Severity: 🔴 breaks play · 🟠 visible/audible glitch · 🟡 minor/cosmetic · 🔵 investigation lead

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
each ends **won, no death, 0 blocked moves** (currently 62/64 mapped solutions). Run standalone
with `npm run test:solutions` (needs game data at `$FFNG_DATA`).

Both rooms' FFNG level layouts were verified to match the port's original `.ffr` exactly
(room size + item positions align, per `fillets-ng-data` 1.0.1 on sources.debian.org), so
these are genuine behavioural gaps, not corpus/layout mismatches. They are skipped in the
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

### WIN #68 (`windoze`) — gspec=5 bonus level
- Layout matches FFNG `windoze` (45×33) exactly.
- Two gaps: (a) the solution uses a **second control-symbol set** (`w/x/y/z`, `W/X/Y/Z`)
  for the bonus "elderly" fish that the move decoder does not model; (b) `win.ts` flags the
  gspec=5 bonus-gameplay/render path as **partly deferred**. Both fish die in the bonus, and
  even a correct `w/x/y/z` direction mapping still dies — so the bonus gameplay itself needs
  completing, not just the decode.
- **To resolve:** model the elderly-fish control set in `decodeMove` (gated to the bonus /
  swapped `littleIdx/bigIdx`), and finish the gspec=5 rescue in `src/rooms/win.ts`.

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
