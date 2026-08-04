# `public/restored/` — two lines the 1998 release shipped without

Everything under `public/data/` is the 1998 ALTAR release, byte for byte. **This
directory is not.** It holds two dialogue lines that the released game's code calls for
but that its data packages do not contain, restored from sources that are themselves
GPL-licensed. Keeping them here rather than patching `025.fft`/`063.ffs` is the whole
point: what is original stays trivially auditable.

| sound | room | Czech |
|---|---|---|
| `pyr-m-nudi` | PYRAMIDA (25) | *"Podívej, ta ženská se snad nudí!"* |
| `jes-v-potvora2` | JESKYNE (63) | *"To je hlavoun duhový."* |

## Why they are missing from the release

`URoom.pas:12662` and `:13049` call them, and `RSound.pas:246-253` resolves a sound by an
exact name match against the room's FFT index — a miss is silence, because the only
fallback (`RSound.pas:705-722`) looks for a loose `.wav` under `Music\`, which holds
nothing but the soundtrack.

They were not lost in our extraction, and they are not a mastering slip in the index
either: the packaging step **cut their audio out of the stream**. In `Pyramida.fft`
(the authors' master) versus the shipped `025.fft`, every sound before `pyr-m-nudi` sits
at an identical offset and every sound after it shifts by exactly 106887 bytes — its own
compressed length. `jeskyne.fft` versus `063.fft` shows the same, shifted by 56781.

A third one, `mot-v-znovu1` (MOTOR, `URoom.pas:16869`), was cut the same way (94690
bytes) and its audio does not survive anywhere, FFNG included. That line stays silent.

## Provenance

- **Audio** — `fillets-ng-data`, GPL v2 (Ivo Danihelka's remake, with ALTAR's
  permission), `sound/pyramid/cs/pyr-m-nudi.ogg` and `sound/cave/cs/jes-v-potvora2.ogg`.
  These are the original 1998 recordings, not remakes: decoded to 22050 Hz mono they are
  **71936** and **46848** samples, matching the `delka` in ALTAR's own master index to
  the sample.
- **Czech subtitles** — ALTAR's master FFT, shipped with the GPL Delphi source release
  (`delphi-src/Fillets/Titl/Pyramida.fft`, `jeskyne.fft`).
- **English subtitles** — `fillets-ng`'s `script/{pyramid,cave}/dialogs_en.lua`. The 1998
  release has no English text for a sound it does not contain.

Both sources are GPL v2, the same licence this port ships under.

## Rebuilding

```
npx tsx tools/build-restored-sounds.ts
```

Needs `ffmpeg`, an FFNG install (`FF_FFNG_DIR`) and the Delphi source tree
(`FF_DELPHI_SRC`). The tool decodes the oggs, re-encodes them with the original FFS
codec (`tools/lib/ffsEncode.ts`, the exact inverse of the runtime decoder — it
reproduces all 1818 shipped sounds byte for byte), asserts the sample counts against the
master index, and writes `restored.fft` + `restored.ffs` in the shipped format. The
runtime loads the pair like the `x00`/`x02`/`x03` globals; the two names are
room-prefixed and cannot collide with anything.

The audio has been through one lossy generation (ogg), which is why the re-encoded
bodies are slightly larger than the master's (108416 vs 106887, 57609 vs 56781).
