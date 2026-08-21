# Fish Fillets 4ever — Delphi-faithful web port

Faithful web port of the **1998 ALTAR Fish Fillets**, ported line-by-line from the original
Delphi engine source (not the FFNG remake). Published as **Fish Fillets 4ever**.
GPL-2.0-or-later.

## Feedback

Play it at **<https://ff4e.github.io/>**. If something goes wrong, or you want something,
open the **Options** panel — right-click the control panel in a room, or the *Options*
corner of the world map — and use the **Send feedback** strip at the bottom of it. It
writes the report for you — what you type, the room you were in, the build, the renderer,
and the **move record** for that room, so the moves that led to the bug can be replayed
instead of guessed at — shows you the finished message, and then offers three ways out,
none of which happen on their own:

- **Open a GitHub issue** — prefills [the bug or idea form](.github/ISSUE_TEMPLATE/).
- **Send an email** — `mailto:` to `fish_fillets@icloud.com`, no account needed.
- **Copy report** — for when neither of those works; paste it wherever you like. (If the
  browser blocks the clipboard, the report is on screen to copy by hand.)

**Nothing is ever sent automatically.** There is no server behind this — the site is static
on GitHub Pages — so a report only leaves the browser when you click one of those three, and
the whole payload is on screen before you do. An *idea* collects only which build it was
written against (version, hash and date); the room and browser diagnostics above are
gathered for bug reports and nowhere else. See
[`src/platform/feedback.ts`](src/platform/feedback.ts) (what a report may contain, and why)
and [`src/app/feedback.ts`](src/app/feedback.ts) (why it lives under the Options panel and
is never painted into the original panel bitmap).

One honest limit: the game's `random()` is **unseeded** (`src/core/script.ts`), so replaying a
move record will not reproduce a bug that depended on a random draw. The record still pins
down everything else.

## Status

The milestone log that used to sit here — M0 to M8, how the engine was translated and in what order —
has moved to **[`HISTORY.md`](HISTORY.md)**.

## Working here

**[`AGENTS.md`](AGENTS.md)** is the orientation for anyone — human or agent — making changes: setup and the
port traps, how much checking a change needs, what each test net actually proves (and what it cannot), the
module-evaluation ordering rule, and the pre-push hygiene. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the
rules; `AGENTS.md` has the things that cost people time to find out.

- **[`MAP.md`](MAP.md)** — the top-level layout and the file-by-file maps of `src/app/` and `src/render/`.
- **[`TESTING.md`](TESTING.md)** — the test suites, what each one actually proves, and how to run them.
- **[`ASSETS.md`](ASSETS.md)** — where the original data comes from and every transcode applied to it.
- **[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md)** — where the port still differs from the original.
- **[`HISTORY.md`](HISTORY.md)** — the M0–M8 milestone log.

## Credits & license

- **Original game:** *Fish Fillets* (1998) by **ALTAR interactive**. This is an unaffiliated
  fan port; all original assets and trademarks belong to their owners.
- **Game data:** derived from the GPL-licensed **[fillets-ng](https://fillets-ng.sourceforge.net/)**
  data.
- **Fonts:** Mulish / Manrope / Jost (SIL OFL 1.1, licenses in `public/fonts/`); GNU FreeFont
  FreeSans (GPL).
- **This port:** licensed **GPL-2.0-or-later** — see [`LICENSE`](LICENSE).

Full attribution: **[CREDITS.md](CREDITS.md)**.
