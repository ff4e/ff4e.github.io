/**
 * Print the KUFRIK demonstration's recorded timeline as markdown.
 *
 *   npx tsx tools/dump-showmode.ts > timeline.md
 *
 * Everything the demo does, in order — every spoken line, move, swim, fish swap, save,
 * load, restart and idle pause — with its index in `help.cap`, so a pause can be pointed
 * at and lengthened. This is the listing `src/app/showmodeHolds.ts` is written against,
 * and it reads `SHOWMODE_HOLDS` directly so the two cannot drift apart: a hold shows up
 * in the row it extends.
 *
 * Runs of identical consecutive entries are collapsed, because the recording re-issues
 * `akce_go` toward the same target on every idle step — a swim of N cells is N identical
 * entries, and `kdo=0` is the demo simply idling.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFft } from '../src/data/fft.js';
import { AKCE, KDO, parseHelpCap } from '../src/intro/helpCap.js';
import { SHOWMODE_HOLDS } from '../src/app/showmodeHolds.js';
import { FFS_SAMPLE_RATE } from '../src/audio/ffs.js';
import { TALKING_MEZ_SEC } from '../src/audio/audio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.FF_DATA_DIR ?? join(root, 'public', 'data');

// `stageGeometry.ts` cannot be imported here — it pulls in `art.ts` and so the DOM — so the
// tick length is read out of its source rather than copied, which would be free to drift.
const geom = readFileSync(join(root, 'src', 'app', 'stageGeometry.ts'), 'utf8');
const LOGIC_MS = Number(/export const LOGIC_MS = (\d+)/.exec(geom)?.[1]);
if (!LOGIC_MS) throw new Error('LOGIC_MS not found in src/app/stageGeometry.ts');
const LOGIC_SEC = LOGIC_MS / 1000;

const fft = parseFft(new Uint8Array(readFileSync(join(dataDir, 'Title', '002.fft'))));
const cap = parseHelpCap(new Uint8Array(readFileSync(join(dataDir, 'Intro', 'help.cap'))));

const entry = (name: string) => fft.find((e) => e.name === name);
const secs = (name: string): number => (entry(name)?.delka ?? 0) / FFS_SAMPLE_RATE;
/** The tick count `dialogy` reserves the speaker for (main.ts scriptTalk). */
const ticks = (name: string): number => {
  const d = secs(name);
  return d > 0 ? Math.max(1, Math.round((d - TALKING_MEZ_SEC) / LOGIC_SEC)) : 0;
};
const text = (name: string): string => (entry(name)?.cz.text ?? '').trim();
/** showHelpText's addv set (cutscene.ts): the rest are the little fish. */
const BIG_VOICED = new Set([2, 4, 7, 8, 11, 14, 20, 22]);
const who = (k: number): string =>
  k === KDO.little ? 'little' : k === KDO.big ? 'big' : k === KDO.sys ? 'sys' : '—';
const DIR: Record<number, string> = { 1: 'up', 2: 'down', 3: 'left', 4: 'right' };

interface Row {
  i: number;
  n: number;
  akce: number;
  what: string;
  who: string;
  voice: string;
  detail: string;
}

const rows: Row[] = [];
let ht = 0;
for (let i = 0; i < cap.length; i++) {
  const a = cap[i]!;
  const last = rows[rows.length - 1];
  if (a.akce === AKCE.helptext && a.kdo !== KDO.none) {
    ht++;
    const name = `help${ht}`;
    rows.push({
      i,
      n: 1,
      akce: a.akce,
      what: `**${name}**`,
      who: BIG_VOICED.has(ht) ? 'big' : 'little',
      voice: `**${ticks(name)}** (${secs(name).toFixed(2)} s)`,
      detail: text(name),
    });
    continue;
  }
  let what = '';
  let detail = '';
  // The order here mirrors `applyCapAction` (cutscene.ts), and it has to. A recorded
  // RESTART is `kdo=0` — all three restart runs in help.cap are — yet `applyCapAction`
  // tests `akce === restart` BEFORE any `kdo` test, so those entries really do rebuild
  // the room. Test `kdo === none` first, as an earlier version of this tool did, and the
  // three room rebuilds print as ordinary idle pauses: the listing then hides exactly the
  // entries `showmodeHolds.ts` says never to hold near.
  if (a.akce === AKCE.restart) {
    what = '_**restart**_';
    detail = '**kills the voice + subtitle** (TRoom.Restart), and rebuilds the room';
  } else if (a.kdo === KDO.sys && a.akce === AKCE.save) what = '_save (F2)_';
  else if (a.kdo === KDO.sys && a.akce === AKCE.load) {
    what = '_**load (F3)**_';
    detail = '**kills the voice** (TRoom.Load → KillExcept(-999)), and rebuilds the room';
  } else if (a.kdo === KDO.none) what = '_wait_';
  else if (a.akce >= AKCE.up && a.akce <= AKCE.right) {
    what = `move ${DIR[a.akce]}`;
    detail = 'one cell';
  } else if (a.akce === AKCE.go) {
    what = 'swim';
    detail = `toward cell (${a.x},${a.y})`;
  } else if (a.akce === AKCE.set) what = 'select fish';
  else if (a.akce === AKCE.switch) what = 'swap fish';
  else if (a.akce === AKCE.exit) what = '_end of demo_';
  else what = `akce ${a.akce} (ignored — kdo=${a.kdo})`;

  const w = who(a.kdo);
  // `akce` is part of the collapse key as well as the rendered text: without it a restart
  // run merges into the `kdo=0` wait beside it and disappears from the listing.
  if (last && last.akce === a.akce && last.what === what && last.who === w && last.detail === detail) {
    last.n++;
    continue;
  }
  rows.push({ i, n: 1, akce: a.akce, what, who: w, voice: '', detail });
}

/** Extra ticks held anywhere inside a row's index range. */
function heldIn(r: Row): number {
  let held = 0;
  for (const [idx, n] of SHOWMODE_HOLDS) if (idx >= r.i && idx < r.i + r.n) held += n;
  return held;
}

const body = rows.map((r) => {
  const held = heldIn(r);
  if (r.what === '_wait_') {
    const total = r.n + held;
    r.detail = held
      ? `the demo idles — **${total} ticks ≈ ${(total * LOGIC_SEC).toFixed(2)} s** ` +
        `(${r.n} recorded + **${held} held**, see \`showmodeHolds.ts\`)`
      : `the demo idles — ${r.n} tick${r.n > 1 ? 's' : ''} ≈ ${(r.n * LOGIC_SEC).toFixed(2)} s`;
  } else if (held) {
    r.detail += ` — **+${held} ticks held after this** (see \`showmodeHolds.ts\`)`;
  }
  const range = r.n > 1 ? `${r.i}–${r.i + r.n - 1}` : `${r.i}`;
  return `| ${range} | ${r.n > 1 ? `×${r.n}` : ''} | ${r.what} | ${r.who} | ${r.voice} | ${r.detail} |`;
});

const holds = [...SHOWMODE_HOLDS.entries()]
  .map(([i, n]) => `\`${i}\` +${n} ticks (${(n * LOGIC_SEC).toFixed(2)} s)`)
  .join(', ');

console.log(`# KUFRIK demonstration — the full recorded timeline

Generated by \`npx tsx tools/dump-showmode.ts\`, from \`help.cap\` + \`002.fft\` +
\`src/app/showmodeHolds.ts\`. Regenerate it after changing a hold.

Everything the demo does, in order: every spoken line **and** every fish move.

Point at any row and say how much delay to insert — in ticks or in seconds.

## Deliberate holds currently applied

${SHOWMODE_HOLDS.size ? holds : '_none_'}

These are extra idle ticks spent **after** the named entry, and they are the
demonstration's only departure from the 1998 recording. They are already folded into the
rows below, so what you read here is what the demo actually does today.

## What a tick is

**1 tick = ${LOGIC_MS} ms**, i.e. **${1000 / LOGIC_MS} ticks per second** (\`LOGIC_MS\`,
\`stageGeometry.ts\`, citing \`TRoom.Jedeme\`'s 0.08 s wall-clock step). The whole game —
physics, animation, the dialogue queue and this recording — advances on that one clock.

Handy: 1 s = 12.5 ticks · 2 s = 25 · 3 s = 37.5 · 5 s = 62.5.

## What the "voice" column means

Two numbers, and they are **not** the same thing:

- the **bold tick count** is how long the game *reserves the speaker for* — the line counts
  as still being said for that many ticks, and the next queued line cannot start until it
  lapses;
- the **seconds in brackets** are the actual length of the audio file.

The tick count is deliberately **shorter than the audio**, by a fixed
**${TALKING_MEZ_SEC.toFixed(4)} s**:

    ticks = round((audioSeconds − ${TALKING_MEZ_SEC.toFixed(4)}) / ${LOGIC_SEC})

That is \`mez = 10000\` samples at ${FFS_SAMPLE_RATE} Hz (\`RSound.pas:933\`) — the original
stops reporting a voice as "talking" once fewer than 10000 samples remain, so the mouth
stops and the queue moves on a beat before the sample's trailing tail. The port keeps it
(\`TALKING_MEZ_SEC\`, \`audio.ts\`; used in \`main.ts\`, stored as \`voiceEndCount\` in
\`script.ts\`).

**Which one to reason about depends on the question.** For *"did the line finish before X
happened"* use the **ticks**, because that is what the queue and the interruptions act on.
For *"was the audio cut off"* use the **seconds** — a restart or an F3 load kills the
sample itself, tail and all.

## Reading the rest

- \`idx\` is the position in \`help.cap\` (${cap.length} entries). A range means consecutive
  identical entries.
- The demo consumes **one entry per idle tick**, so a delay is simply extra idle ticks
  before an entry. Ticks spent animating a move do **not** consume entries.
- **One \`_wait_\` is exactly one tick — ${LOGIC_MS} ms.** These are the recording's own
  pauses: the cheapest place to add delay is to lengthen one of them.
- A **move or swim entry is not ${LOGIC_MS} ms** — it costs one idle tick to consume, plus
  however many ticks the animation runs, during which no further entries are consumed.
  Measured over the whole demo: 1604 consumed entries take 1752 ticks, ≈1.09 ticks per entry, and
  the excess is all in the moving stretches.
- \`swim toward (x,y)\` is re-issued every idle step until the fish arrives, so ×N ≈ N cells
  of travel.
- The demo never waits for a line: helptext entries arrive faster than the voices, so lines
  queue up and each starts when the previous one's tick count lapses.

| idx | rep | what | who | voice ticks (audio) | detail |
|---|---|---|---|---|---|
${body.join('\n')}`);
