/**
 * Which sound names can URoom.pas ask for that our data cannot answer?
 *
 *   npx tsx tools/sweep-sounds.ts
 *
 * The 1998 engine resolves a sound by exact byte-for-byte name against the FFT
 * index (RSound.pas:246-253 `Search`), and the only fallback is a loose
 * `Music\<name>.wav` (RSound.pas:705-722, `SoundPath=PathMusic` per UMain.pas:717)
 * which holds nothing but the soundtrack. So a name the code asks for and the data
 * does not hold is a line that never plays — in 1998 or here.
 *
 * Three ways a name reaches Snd/Talk/addm/addv (URoom.pas):
 *   a) a plain literal                        'pyr-m-nudi'
 *   b) literal + chr(BASE+random(N))          'mot-v-znovu'+chr(48+random(2))
 *   c) literal + IntToStr(<runtime expr>)     'z-c-'+inttostr(cas div 1000)
 *
 * (a) is decided by a set lookup. (b) MUST be expanded: collapsing it to its
 * stem and then discarding the stem because a sibling exists is exactly what
 * hides `mot-v-znovu1`. (c) cannot be resolved statically, so the numeric
 * family is reported instead and a hole in its numbering is the signal.
 *
 * A literal is a *stem* iff the next non-space character is '+'.
 *
 * With `--master`, the run also diffs the release packages against ALTAR's own master
 * index in the GPL Delphi source (`Titl/*.fft`). That is what separates "the reference
 * is a typo" from "the recording was cut at packaging time": a name present in the
 * master and absent from the release was recorded, and the release stream shows it
 * being removed (every later offset shifts by exactly its compressed length).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFft } from '../src/data/fft.js';

const PAS = process.env.FF_UROOM ?? join(homedir(), '.cache', 'ffng-orig', 'delphi-src', 'Fillets', 'URoom.pas');
const D = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');

const have = new Set<string>();
const pkgs = [...Array(72)].map((_, i) => String(i + 1).padStart(3, '0')).concat(['x00', 'x01', 'x02', 'x03']);
for (const p of pkgs) {
  const f = join(D, 'Title', `${p}.fft`);
  if (existsSync(f)) for (const e of parseFft(readFileSync(f))) have.add(e.name);
}

const src = readFileSync(PAS, 'latin1');
const lineOf = (i: number): number => src.slice(0, i).split('\n').length;

/** Byte ranges covered by a Pascal { } block comment — names in them are dead code. */
const comments: Array<[number, number]> = [];
for (const m of src.matchAll(/\{[^}]*\}/g)) comments.push([m.index!, m.index! + m[0].length]);
const inComment = (i: number): boolean => comments.some(([a, b]) => i >= a && i < b);

/** A sound id is a hyphenated alphanumeric token. */
const looksLikeSound = (t: string): boolean => /^[A-Za-z0-9]+(-[A-Za-z0-9]+)+$/.test(t);

/**
 * The procedures that actually look a name up (RSound.pas:764-787, URoom.pas:684-694).
 * Filtering on the CALL is what keeps animation scripts out: `setanim`'s argument
 * shares the quote syntax and one of them ('d10-99a3a1…', URoom.pas:21676) happens to
 * contain no '?' and so looks exactly like a hyphenated id.
 */
const SOUND_CALLS = new Set([
  'snd', 'sndcyc', 'sndcycle', 'sndvol', 'sndvolcyc', 'sndvolcycle',
  'talk', 'talkcyc', 'talkcycle', 'music', 'musiccyc', 'musiccycle',
  'addd', 'addm', 'addv', 'mem',
]);

/** The name of the call whose argument list encloses `at`, lowercased. */
function enclosingCall(at: number): string {
  let depth = 0;
  for (let i = at - 1; i >= 0 && at - i < 400; i--) {
    const c = src[i]!;
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        const head = /([A-Za-z_]\w*)\s*$/.exec(src.slice(Math.max(0, i - 40), i));
        return head ? head[1]!.toLowerCase() : '';
      }
      depth--;
    }
  }
  return '';
}

interface Ask { line: number; how: string; dead: boolean }
const asked = new Map<string, Ask>();
const families = new Map<string, { lines: number[]; dead: boolean }>();

for (const m of src.matchAll(/'([^'\n]*)'/g)) {
  const at = m.index!;
  // Only start at the head of a concatenation chain: 'a'+'b'+chr(..) is one name.
  if (/\+\s*$/.test(src.slice(Math.max(0, at - 40), at))) continue;
  if (!SOUND_CALLS.has(enclosingCall(at))) continue;

  const line = lineOf(at);
  const dead = inComment(at);
  let stem = m[1]!;
  let cur = at + m[0].length;
  let how = `'${stem}'`;

  for (;;) {
    const rest = src.slice(cur, cur + 200);
    const lit = /^\s*\+\s*'([^'\n]*)'/.exec(rest);
    if (lit) { stem += lit[1]!; how += `+'${lit[1]}'`; cur += lit[0].length; continue; }

    // chr(...) — the original writes the base and the index in either order,
    // and the index is sometimes a runtime variable rather than random(N).
    const chr = /^\s*\+\s*chr\(([^()]*(?:\([^()]*\)[^()]*)*)\)/i.exec(rest);
    if (chr) {
      const expr = chr[1]!;
      how += `+chr(${expr.trim()})`;
      const ordM = /ord\('(.)'\)/.exec(expr);
      const rnd = /random\((\d+)\)/i.exec(expr);
      const constM = /(?:^|[+\s])(\d+)(?![^()]*\))/.exec(expr.replace(/random\(\d+\)/gi, ''));
      const base = ordM ? ordM[1]!.charCodeAt(0) : constM ? Number(constM[1]) : NaN;
      if (rnd && Number.isFinite(base)) {
        for (let k = 0; k < Number(rnd[1]); k++) {
          const n = stem + String.fromCharCode(base + k);
          if (!asked.has(n)) asked.set(n, { line, how, dead });
        }
      } else if (Number.isFinite(base)) {
        // index is a runtime variable: report the family, not a single name
        if (!families.has(stem)) families.set(stem, { lines: [], dead });
        families.get(stem)!.lines.push(line);
      }
      stem = '';
      break;
    }

    if (/^\s*\+/.test(rest)) {
      // Some other runtime expression — `+IntToStr(...)`, or a plain string variable
      // as in `Snd('sp-bubles'+s,1000)` (URoom.pas:23745, s from str(z,s)). The name
      // cannot be resolved statically, so report the family, never the bare stem.
      if (!families.has(stem)) families.set(stem, { lines: [], dead });
      families.get(stem)!.lines.push(line);
      stem = '';
    }
    break;
  }

  if (stem && looksLikeSound(stem) && !asked.has(stem)) asked.set(stem, { line, how: 'literal', dead });
}

const missing = [...asked.entries()].filter(([n]) => !have.has(n)).sort();
console.log(`names URoom.pas can ask for: ${asked.size}     names our data holds: ${have.size}`);
console.log(`\n=== asked for, ABSENT from our data (${missing.length}) ===`);
for (const [n, a] of missing) {
  console.log(`  ${n.padEnd(22)} URoom.pas:${String(a.line).padEnd(6)} ${a.dead ? '[dead: inside { }] ' : ''}${a.how}`);
}

console.log(`\n=== '<stem>'+IntToStr(...) families — a gap in the CONSECUTIVE run is the signal ===`);
// addd multiplexes on its `zvuk` argument: 'ANIM'/'ANIMWAIT' + an animation script
// are commands, not names (URoom.pas:731,735 — the port mirrors this in script.ts).
const SENTINELS = new Set(['ANIM', 'ANIMWAIT']);
for (const [stem, f] of [...families].sort()) {
  if (SENTINELS.has(stem)) continue;
  const members = [...have]
    .filter((h) => h.startsWith(stem) && /^\d+$/.test(h.slice(stem.length)))
    .map((h) => Number(h.slice(stem.length)))
    .sort((a, b) => a - b);
  if (members.length === 0) {
    // A non-numeric family: 'ANIM'/'ANIMWAIT' are addd's animation sentinels, 'KD-'
    // the cutscene captions. Only a stem with NOTHING behind it is a real signal.
    const related = [...have].filter((h) => h.startsWith(stem)).length;
    console.log(
      `  ${stem.padEnd(22)} URoom.pas:${f.lines.join(',')}  ` +
        (related ? `${related} related names, none numbered` : 'NO name starts with this stem'),
    );
    continue;
  }
  // Only the leading consecutive run is a numbered VARIANT family (`…0`, `…1`, …).
  // Anything beyond it is a sparse vocabulary — ZAVER's spoken numbers jump 20,30,…,
  // 100,200 because Czech composes the rest, and calling 21..29 "missing" is noise.
  let end = members[0]!;
  while (members.includes(end + 1)) end++;
  const dense = members.filter((m) => m <= end);
  const sparse = members.filter((m) => m > end);
  const holes: number[] = [];
  for (let k = members[0]!; k <= end; k++) if (!members.includes(k)) holes.push(k);
  const tail = sparse.length ? `  (+ sparse ${sparse.join(',')})` : '';
  console.log(
    `  ${stem.padEnd(22)} URoom.pas:${f.lines.join(',')}  run ${dense[0]}..${end}${tail}` +
      (holes.length ? `  MISSING ${holes.join(',')}` : ''),
  );
}

if (!process.argv.includes('--master')) {
  console.log(`\n(run with --master to also diff the release against ALTAR's master index)`);
  process.exit(0);
}

// --- --master: release packages vs the authors' master index in the GPL source ---
const MASTER = process.env.FF_DELPHI_SRC
  ? join(process.env.FF_DELPHI_SRC, 'Titl')
  : join(homedir(), '.cache', 'ffng-orig', 'delphi-src', 'Fillets', 'Titl');

if (!existsSync(MASTER)) {
  console.log(`\n(no master index at ${MASTER})`);
  process.exit(0);
}

const master = new Map<string, { file: string; zvuk: number; kompr: number; delka: number }>();
for (const f of readdirSync(MASTER).filter((x) => x.toLowerCase().endsWith('.fft'))) {
  for (const e of parseFft(readFileSync(join(MASTER, f)))) {
    if (!master.has(e.name)) master.set(e.name, { file: f, zvuk: e.zvuk, kompr: e.kompr, delka: e.delka });
  }
}

console.log(`\n=== recorded (in the master index) but NOT in the release ===`);
for (const [n, m] of [...master].filter(([n]) => !have.has(n)).sort()) {
  const askedFor = asked.has(n) ? `URoom.pas:${asked.get(n)!.line}` : 'not referenced';
  console.log(`  ${n.padEnd(22)} ${m.file.padEnd(16)} ${String(m.delka).padStart(7)} samples, ${String(m.kompr).padStart(7)} B  ${askedFor}`);
}
