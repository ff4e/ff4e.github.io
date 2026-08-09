/**
 * A byte-exact behavioural fingerprint of the running game, comparable ACROSS GIT
 * REVISIONS. This is the safety net for the `main.ts` split.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 * The refactor moves code that the test suite watches through `window.__ff`, and
 * this repo already knows the trap:
 *
 *     "A parity probe cannot catch a refactor that moves the oracle."
 *
 * Everything else available is either aimed elsewhere or self-referential:
 *   - tools/mutate-room-walk.mjs and tools/mutate-gl-room-ai.mjs mutate
 *     src/render/* and src/core/room.ts. Neither can see main.ts.
 *   - test/solutions.test.ts replays 66 FFNG solutions through src/core/stepEngine.ts,
 *     not through main.ts.
 *   - tools/test-gl-live.mjs is byte-exact, but compares GPU against CPU — two
 *     implementations that both live in src/render/. It proves main.ts feeds both
 *     sides the same thing, not that the thing is right.
 *   - The 85 UI probes are the only real coverage of main.ts, and every one of them
 *     asserts on `__ff` — the very state a split moves.
 *
 * So this tool takes its oracle from OUTSIDE the change: the previous revision.
 * Capture on the base commit, capture on the branch, compare. Any difference is
 * either a bug you introduced or a behaviour change you have to justify.
 *
 *     node tools/capture-digest.mjs --out /tmp/before.json   # on the base commit
 *     node tools/capture-digest.mjs --out /tmp/after.json    # on the branch
 *     node tools/capture-digest.mjs --compare /tmp/before.json /tmp/after.json
 *
 * The compare exits non-zero on any difference and prints every key that moved.
 *
 * ── Determinism ────────────────────────────────────────────────────────────────
 * A fingerprint that drifts on its own is worse than none, so:
 *   - `Math.random` is replaced before boot by a seeded mulberry32, so blinks, ambient
 *     chatter and death lines draw the same sequence every time.
 *   - Only wall-clock-INDEPENDENT fields are recorded, and that rule cost real fields.
 *     The game clock is driven by real time (main.ts `loop` never fast-forwards a
 *     backlog), so ANYTHING that counts ticks drifts between runs on a loaded machine.
 *     Measured, by capturing twice in separate processes: `heads` / `mouths` (blink and
 *     lip-sync phase), `lines` / `lastLine` / `chatCount` (dialogue counters), and item
 *     `afaze` (animation phase) all moved. `casHry()` and `playTime()` are elapsed real
 *     time by definition. None of them are recorded.
 *   - That also rules out `roomFrameHash`: it renders at `{ count: 0 }`, but the items
 *     it draws carry their own `afaze`, so a room with an animating item hashes
 *     differently depending on when you looked. `roomBgFrameHash` IS recorded — the
 *     background has no items, and it held identical across runs.
 *   - The renderer is pinned to CPU and each hash is asked for by tier explicitly, so a
 *     machine with or without working WebGL produces the same file.
 *
 * ── What this therefore does and does not prove ────────────────────────────────
 * It covers game STATE (positions, facing, record, move count, save-gating, room
 * flags, hook count) and BACKGROUND pixels, byte-exact, across revisions. It does not
 * cover the pixels of animating items — for those the existing net still applies:
 * test/render-parity.test.ts (72 rooms, resting pose), tools/test-gl-live.mjs
 * (byte-exact live GPU-vs-CPU) and the 85 UI probes. Do not read a clean digest as
 * "the render path is unchanged"; read it as "the game state and the backgrounds are".
 *
 * `--self-check` captures twice in one process and fails if the two disagree. It is a
 * cheap first filter, but it is NOT sufficient on its own — the drift above only shows
 * up between separate processes. When adding a field, run the tool twice and compare
 * the two files.
 *
 * Serving is delegated to tools/preview-server.mjs — the same production build, the
 * same per-run free port as `npm run test:ui`. Never point this at a hand-started dev
 * server on 5173: another worktree may be serving it, and you would fingerprint that
 * one instead.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import {
  PreviewError,
  buildApp,
  startPreview,
  stopPreview,
  urlFor,
} from './preview-server.mjs';
import { launchBrowser, appReady, idle, tickSleep } from './ui-lib.mjs';

const log = (m) => console.log(`[digest] ${m}`);

// ── The scenario ──────────────────────────────────────────────────────────────
// Rooms chosen to spread across the code the split touches, not for coverage of the
// game: UTES is the boot room every session already loads; KOSTE is the two-fish room
// the GL probes use; PRISTAV and BLUDISTE bring a different gspec and item mix. Keep
// this list SHORT — every entry costs a room load in both captures — and never
// reorder it, or two captures stop lining up.
const ROOMS = [7, 6, 3, 20];

const DIR = { up: 1, down: 2, left: 3, right: 4 };

// A fixed opening for every room. Some presses will be refused (a wall, a fish that
// cannot go that way) and that is fine — a refusal is behaviour too, and it is
// recorded in the resulting posHash exactly like a move.
const OPENING = [
  ['little', 'left'],
  ['little', 'left'],
  ['big', 'right'],
  ['little', 'down'],
  ['big', 'right'],
];

const SEED = 0x5eed1998; // any constant; it only has to be the same on both captures.

/** Everything read out of one room, at one moment. */
async function sample(p) {
  return await p.evaluate(() => {
    const ff = window.__ff;
    // Item state is capped: the digest should notice a physics change, not carry a
    // room's whole inventory into every diff.
    // `afaze` is deliberately NOT included — see the note on wall-clock fields above.
    const items = [];
    for (let i = 0; i < 12; i++) {
      const it = ff.itemState(i);
      if (!it) break;
      items.push(`${it.x},${it.y},${it.dir},${it.spec},${it.kind}`);
    }
    return {
      posHash: ff.posHash(),
      record: ff.record(),
      moves: ff.moves(),
      phase: ff.phase(),
      gspec: ff.gspec(),
      vytlacit: ff.vytlacit(),
      items,
      water: ff.water(),
      hookCount: ff.hookCount(),
      roomDepth: ff.roomDepth(),
      canSave: ff.canSave(),
      busy: { little: ff.busy('little'), big: ff.busy('big') },
      bgClassic: ff.roomBgFrameHash('classic'),
      bgEnhanced: ff.roomBgFrameHash('enhanced'),
    };
  });
}

/** Boot-level state: the things that are true before any room is driven. */
async function sampleBoot(p) {
  return await p.evaluate(() => {
    const ff = window.__ff;
    return {
      screen: ff.screen(),
      graphics: ff.graphics(),
      renderer: ff.renderer(),
      hasMap: ff.hasMap(),
      hasPanel: ff.hasPanel(),
      panelOstav: ff.panelOstav(),
      subtitleMode: ff.subtitleMode(),
      volumes: ff.volumes(),
      helpPageCount: ff.helpPageCount(),
      solvedRooms: ff.solvedRooms(),
      cheatedRooms: ff.cheatedRooms(),
      scores: ff.scores(),
      introSeen: ff.introSeen(),
      // The shape of the hook itself. If this moves, every probe in tools/ is
      // affected — which is exactly what the series' "__ff is frozen" rule forbids.
      ffKeys: Object.keys(ff).sort(),
    };
  });
}

async function capture(port) {
  const b = await launchBrowser();
  const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push('PE:' + e.message));

  await p.addInitScript(
    ({ seed }) => {
      try {
        localStorage.clear();
        localStorage.setItem('ff.devEnabled', '1'); // the room dropdown lives behind the dev pane
        localStorage.setItem('ff.renderer', 'cpu'); // the deterministic backend
        localStorage.setItem('ff.graphics', 'classic'); // pin the tier; hashes ask per tier anyway
        localStorage.setItem('ff.options', JSON.stringify({ introSeen: true }));
      } catch {
        /* storage unavailable */
      }
      // mulberry32 — small, fast, and identical in every browser, which a native
      // Math.random is explicitly not.
      let s = seed >>> 0;
      Math.random = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    { seed: SEED },
  );

  await p.goto(urlFor(port), { waitUntil: 'domcontentloaded' });
  await appReady(p);

  const out = { boot: await sampleBoot(p), rooms: {} };

  for (const num of ROOMS) {
    const before = await p.evaluate(() => window.__ff.roomLoads());
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await p.waitForFunction(
      ({ n, before }) =>
        window.__ff.roomLoads() > before && window.__ff.roomNum() === n && !window.__ff.roomLoading(),
      { n: num, before },
    );
    await idle(p);
    await tickSleep(p, 2);

    const atEntry = await sample(p);

    for (const [which, dir] of OPENING) {
      await p.evaluate(({ w, d }) => window.__ff.press(w, d), { w: which, d: DIR[dir] });
      await idle(p);
    }
    await tickSleep(p, 2);
    const afterMoves = await sample(p);

    // Restart must put the room back exactly where it started. Recording it here
    // means the digest also covers the record/restart path, which several of the
    // regions being extracted touch.
    await p.evaluate(() => window.__ff.restart());
    await idle(p);
    await tickSleep(p, 2);
    const afterRestart = await sample(p);

    out.rooms[num] = { atEntry, afterMoves, afterRestart };
  }

  out.consoleErrors = errs;
  await b.close().catch(() => {});
  return out;
}

/** Stable JSON: object keys sorted at every level, so a diff shows real changes only. */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, stable(v[k])]),
    );
  return v;
}

/** Every leaf path where two captures disagree. */
function diff(a, b, path = '', out = []) {
  const isObj = (x) => x && typeof x === 'object';
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${path}/${k}`, out);
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
  return out;
}

function report(deltas, whatA, whatB) {
  if (deltas.length === 0) {
    console.log(`identical: ${whatA} == ${whatB}`);
    return 0;
  }
  console.log(`${deltas.length} difference(s) between ${whatA} and ${whatB}:`);
  for (const d of deltas.slice(0, 80)) console.log('  ' + d);
  if (deltas.length > 80) console.log(`  … and ${deltas.length - 80} more`);
  return 1;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmp = argv.indexOf('--compare');
if (cmp !== -1) {
  const [fa, fb] = argv.slice(cmp + 1, cmp + 3);
  if (!fa || !fb) {
    console.error('usage: capture-digest.mjs --compare BEFORE.json AFTER.json');
    process.exit(2);
  }
  const a = JSON.parse(readFileSync(fa, 'utf8'));
  const b = JSON.parse(readFileSync(fb, 'utf8'));
  process.exit(report(diff(a, b), fa, fb));
}

const outIdx = argv.indexOf('--out');
const outFile = outIdx === -1 ? null : argv[outIdx + 1];
const selfCheck = argv.includes('--self-check');

let port = null;
let code = 0;
try {
  await buildApp(log);
  port = await startPreview({ log });
  log(`capturing (${ROOMS.length} rooms)…`);
  const first = stable(await capture(port));
  if (first.consoleErrors.length) {
    console.error('[digest] the app logged console errors — the capture is not trustworthy:');
    for (const e of first.consoleErrors) console.error('  ' + e);
    code = 1;
  }
  if (selfCheck) {
    log('self-check: capturing a second time…');
    const second = stable(await capture(port));
    code = report(diff(first, second), 'capture 1', 'capture 2') || code;
  }
  const json = JSON.stringify(first, null, 1);
  if (outFile) {
    writeFileSync(outFile, json + '\n');
    log(`wrote ${outFile}`);
  } else {
    process.stdout.write(json + '\n');
  }
} catch (e) {
  console.error(`[digest] ${e instanceof PreviewError ? e.message : (e?.stack ?? e)}`);
  code = 1;
} finally {
  stopPreview();
}
process.exit(code);
