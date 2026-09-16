# Fish Fillets 4ever

A faithful web port of **Fish Fillets** (ALTAR interactive, 1998) — the underwater puzzle game where
you move two talking fish around a room without dropping anything on either of them.

### ▶ Play it at **<https://ff4e.github.io/>**

No install, no account, no plugin. It runs in a desktop browser.

![The world map](docs/screenshots/world-map.jpg)

![Mr. Cheops' House, one of the 72 rooms](docs/screenshots/room-pyramida.jpg)

## Why this exists

Fish Fillets was written in 1998, in Delphi, for Windows 95. ALTAR released the game's data under the
GPL in 2002, and the engine source survives — and that source is the only complete description of how
the game actually *behaved*: every push, every fall, every line the two fish say to each other.

This port translates that source, function by function, so the game can be played on the web and on
machines nobody had in 1998 — while behaving exactly as it did then. Where this port differs from the
original, that is a bug, and it is written down.

That is also why FFNG, the well-known remake, was not the starting point. FFNG is a good game and a
*re-implementation*: it rebuilt the puzzles from the outside, in C++, on a new engine. This goes the
other way — outward from ALTAR's own code, keeping the original's names, its quirks and its bugs.

**The one thing deliberately changed is how it looks.** The art was drawn for a 640×480 screen, and on
a modern display that is a small soft rectangle. So the port ships AI-upscaled art: the same pictures,
the same layout, the same everything the game does — just enough resolution to be worth looking at
today. That tier also carries a small colour grade (`contrast 1.05 / saturate 1.10 / brightness 1.03`,
applied at display time). It is not a correction — measured across eight rooms the upscale already has
*more* contrast than the 1998 art and the same saturation — it is a deliberate enrichment, and it is
scoped to the AI tier alone. **Classic and Enhanced are untouched**, so the faithful look is always one
press of `E` away.

**Touch tutorial hints** are another deliberate visual addition: the first room's
cursor-key/Space dialogue illustrates horizontal and vertical swipes followed by a tap,
and the second room's F2/F3 narration pulses the touch bar's Save/Load buttons (the
More button on phones, where those actions live in the overflow). They
repeat with those lines, expire automatically, and never intercept input or change
the dialogue. Desktop and silent solution replays show no hints; reduced-motion mode
uses a static illustration and button highlight instead.
The swipe/tap animation gets at least 2.5 seconds even when voice audio is unavailable;
another line or a screen change still interrupts it without changing dialogue timing.

**Phone layout:** Map is in the upper-left corner, Undo in the lower-right, and More
in the upper-right opens Load, Save, Options and Restart. These controls overlay the
room without reserving a bar, with at least 24 CSS pixels of clearance from rounded
screen edges as well as the cutout/home-indicator insets. Pinch continuously to choose
any zoom from 1x (the full room) to 3x. Zoom remains available only when a standard-view
cell is smaller than 20 CSS pixels.
Move two fingers together to look around the zoomed room; scale and pan follow the
gesture's centre, clamped to the room edges. Releasing one finger freezes inspection
until the other lifts, so it cannot accidentally move or switch a fish. After both lift,
the camera pauses for 350ms, then eases back to the active fish while keeping the chosen zoom.
Pinching past either zoom limit gives a small resisted stretch that settles back on
release; the selected range stays 1x-3x.
**Every room entry resets to 1x.** Zoom is never automatically carried to another room.
Undo keeps the chosen zoom and selects the fish whose most recent move was reversed,
so the camera follows that fish to its restored position.
Changing graphics or briefly opening help in the same room preserves its chosen zoom.
On iPhone, orientation is the player's choice throughout the app: rooms, the map and
movies no longer force portrait or landscape. Wide rooms can be played in portrait;
rotation preserves zoom while the room remains eligible. If it becomes ineligible,
the camera returns to 1x and stays there until the player pinches again.
Enhanced/AI subtitles stay at the screen bottom, clear of the home indicator and Undo.
Their font is always 20 CSS pixels, independent of room size, orientation, zoom, and
graphics tier; long captions wrap instead of shrinking.
Classic retains its original baked-in room subtitles. **iPad and desktop keep their
existing layouts and orientation behavior**, and iPad does not get pinch zoom. Desktop `?touch=on` still previews
the tablet controls; use phone device emulation to preview the phone layout.

**Done** means all 72 rooms playable end to end, the dialogue and voices in place, and every known
deviation from the original either fixed or written down in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).

## What "faithful" means here, in practice

- **The rules are ported, not re-derived.** The push physics, gravity and support graph, the
  fish-size-aware pathfinding, the subtitle scheduler, the idle chatter, the death commentary — each
  is a translation of a named Delphi routine (`posun_objekt`, `padani`, `najdi_smer`, `NovyTitulek`,
  `StdKecej`, `StdSmrt`), and the comment above it says which one.
- **The citations are kept.** Over 500 distinct references like `URoom.pas:15576` sit in the code —
  into `URoom.pas`, `UMain.pas`, `Uovl.pas`, `Ttr.pas`, `Cheaty.pas`, `Help.pas`, `RSound.pas`,
  `USoutez.pas` and `zaklad.pas` — so any behaviour can be checked against the source it came from
  rather than argued about.
- **The quirks are kept too.** The Tetris minigame rotates backwards, Down rotates and Space slams,
  because that is what `Ttr.pas` does. A lone fish dying does not restart the room — the survivor
  keeps playing and comments on it — because that is what the original does.
- **It is checked, not asserted.** 70 of the 72 rooms have a recorded solution that is replayed
  through the engine on every push, and must end won, with no death and no blocked move.
- **The data is the original's data**, extracted from the GPL release rather than re-authored. Audio
  and video are re-encoded for the web (AAC, H.264) because 64 MB of 1998 PCM is a loading screen;
  every one of those transcodes is measured and justified in [`ASSETS.md`](ASSETS.md).

## Where it is now

Playable start to finish. All 72 rooms are in, with their scripts, dialogue, voices, subtitles in
Czech and English, music, the world map and its record panel, saves, the original cheat codes, the
Tetris minigame, and the intro and ending movies. The solvability net replays 70 of the 72 rooms on
every push.

What is left is polish and the known divergences — [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) is the honest
list. [`HISTORY.md`](HISTORY.md) has the milestone log, if you want the order it was all built in.

## Found a bug, or want something?

Open the **Options** panel — right-click the control panel in a room, or the *Options* corner of the
world map — and use the **Send feedback** strip at the bottom. It writes the report for you: what you
type, the room you were in, the build, and the **move record** for that room, so the moves that led to
a bug can be replayed instead of guessed at. Then it offers three ways out —
[a GitHub issue](.github/ISSUE_TEMPLATE/), an email to `fish_fillets@icloud.com`, or copy the text and
put it wherever you like.

**Nothing is ever sent automatically.** There is no server behind this — the site is static on GitHub
Pages — so a report only leaves your browser when you click one of those three, and the whole message
is on screen before you do. An *idea* collects only which build it was written against; the room and
browser diagnostics are gathered for bug reports and nowhere else.
[`src/platform/feedback.ts`](src/platform/feedback.ts) is the code, and says what a report may contain
and why.

## Credits & license

- **Original game:** *Fish Fillets* (1998) by **ALTAR interactive**. This is an unaffiliated
  fan port; all original assets and trademarks belong to their owners.
- **Game data:** derived from the GPL-licensed **[fillets-ng](https://fillets-ng.sourceforge.net/)**
  data.
- **Fonts:** Mulish / Manrope / Jost (SIL OFL 1.1, licenses in `public/fonts/`); GNU FreeFont
  FreeSans (GPL).
- **This port:** licensed **GPL-2.0-or-later** — see [`LICENSE`](LICENSE).

Full attribution: **[CREDITS.md](CREDITS.md)**.

## For developers

Start with **[`AGENTS.md`](AGENTS.md)** — setup, the port traps, how much checking a change needs, and
what each test net actually proves. Then:

| | |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | repo hygiene, commit rules, deploy |
| [`MAP.md`](MAP.md) | the layout, and file-by-file maps of `src/app/` and `src/render/` |
| [`TESTING.md`](TESTING.md) | the suites, what they prove, and what they cost — plus how to test the iOS app on a Simulator and a real phone |
| [`ASSETS.md`](ASSETS.md) | where the original data comes from, and every transcode applied to it |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | where the port still differs from the original |
| [`HISTORY.md`](HISTORY.md) | the M0–M8 milestone log |
