# `public/restored/` — two lines the 1998 release shipped without

Everything under `public/data/` is the 1998 ALTAR release, byte for byte, with **one
documented exception** (`002/help1`'s buzzing tail — see `KNOWN_ISSUES.md` and
`tools/fix-help1-buzz.ts`). **This directory is not.** It holds two dialogue lines that
the released game's code calls for but that its data packages do not contain, restored
from sources that are themselves GPL-licensed. Keeping them here rather than patching
`025.fft`/`063.ffs` is the whole point: what is original stays trivially auditable.

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
either: the packaging step **cut them out of the stream**. Against the authors' master
index, every sound before the missing one sits at an identical offset in both files and
every sound after it shifts by exactly the slot it occupied.

`jeskyne.fft` vs `063.fft` is the clean exhibit: all 25 shared sounds have identical
compressed lengths, the 16 before `jes-v-potvora2` share their offsets, and the 9 after
it shift by exactly its 56781 B. `Pyramida.fft` vs `025.fft` shows the same 106887 B
shift, but that package is not otherwise the released one — all 11 shared sounds carry a
different `kompr`, so 025 was re-compressed at some point. 106887 is the size of the slot
that was removed, not a figure taken from the master record (which says 97687).

A third one, `mot-v-znovu1` (MOTOR, `URoom.pas:16869`), was cut the same way (94690
bytes) and its audio does not survive anywhere, FFNG included. That line stays silent.

## Provenance

- **Audio** — `fillets-ng-data`, GPL v2 (Ivo Danihelka's remake, with ALTAR's
  permission), `sound/pyramid/cs/pyr-m-nudi.ogg` and `sound/cave/cs/jes-v-potvora2.ogg`.
  Decoded to 22050 Hz mono they are **71936** and **46848** samples, matching the `delka`
  in ALTAR's own master index exactly. Together with the matching names and FFNG's
  permission to use ALTAR's assets that is strong evidence these are the 1998 recordings
  rather than remakes — though not proof on its own, since released `delka` values are
  blocky (90% are divisible by 128) and a same-length remake would also match.
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
codec (`tools/lib/ffsEncode.ts`, ported from ALTAR's own compressor
`PrZvuku/Uprevod.pas` — re-encoding all 1818 shipped sounds reproduces the original
192827275 bytes exactly and decodes back bit-identical), asserts the sample counts
against the master index, and writes `restored.fft` + `restored.ffs` in the shipped
format. `test/restored-lines.test.ts` pins the SHA-256 of both files, so a rebuild that
drifts is a test failure rather than a silent change. The
runtime loads the pair like the `x00`/`x02`/`x03` globals; the two names are
room-prefixed and cannot collide with anything.

The audio has been through one lossy generation (ogg), so the re-encoded bodies do not
match the master's byte for byte: 108401 B against the 106887 B slot for `pyr-m-nudi`,
and 57586 B against `jes-v-potvora2`'s 56781 B. Decoded, they are within the codec's own
2-bit quantization of the ogg (max absolute error 3 of 32768) — the difference is the
compressor reacting to a slightly different waveform, not a quality loss on top of it.
