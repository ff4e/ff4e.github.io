/**
 * The UI probes' wait budgets, checked statically.
 *
 * `page.waitForFunction(pageFunction, arg, options)` — an options object passed as the
 * SECOND argument lands in Playwright's `arg` slot, is serialised into the page, and the
 * timeout it declares is silently discarded; the wait really runs on Playwright's 30s
 * default. The mistake is invisible: the probe still passes, and the number in the source
 * says something that was never true.
 *
 * It was made 241 times, across 73 of the 81 probes, and it is the reason the flake audit
 * was hard: the declared budgets bore no relation to the enforced ones. This test is what
 * stops it coming back — including the tempting "tidy-up" of moving those 241 objects into
 * the third slot as written, which would enforce budgets that measurement shows are far
 * too small (16 of them are already exceeded in practice, one of them even when the probe
 * runs alone).
 *
 * The rule: every inline `{ timeout: … }` in a probe goes in the third argument, and its
 * value comes from `budget()` or `tickBudget()` — never a bare literal.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const toolsDir = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', 'tools');
const probeFiles = readdirSync(toolsDir)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .concat(['ui-lib.mjs']);

/** Split a balanced argument list at top level, ignoring nesting and string bodies. */
function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === quote && inner[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  args.push(cur.trim());
  return args.filter((a) => a !== '');
}

interface Wait {
  file: string;
  line: number;
  argIndex: number;
  timeout: string;
}

/** Every `waitForFunction(...)` call in the probes, with where its options object sits. */
function collectWaits(): Wait[] {
  const found: Wait[] = [];
  for (const file of probeFiles) {
    const src = readFileSync(join(toolsDir, file), 'utf8');
    let from = 0;
    for (;;) {
      const pos = src.indexOf('waitForFunction(', from);
      if (pos < 0) break;
      from = pos + 1;
      let depth = 0;
      let end = -1;
      for (let k = pos + 'waitForFunction'.length; k < src.length; k++) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')') {
          depth--;
          if (depth === 0) {
            end = k;
            break;
          }
        }
      }
      if (end < 0) continue;
      const call = src.slice(pos, end + 1);
      const args = splitArgs(call.slice(call.indexOf('(') + 1, -1));
      const argIndex = args.findIndex((a) => /^\{\s*timeout\s*:/.test(a));
      if (argIndex < 0) continue;
      found.push({
        file,
        line: src.slice(0, pos).split('\n').length,
        argIndex,
        timeout: args[argIndex].replace(/\s+/g, ' '),
      });
    }
  }
  return found;
}

describe('UI probe wait budgets', () => {
  const waits = collectWaits();

  it('finds the probes to check', () => {
    // A path or glob mistake would make every check below pass vacuously.
    expect(probeFiles.length).toBeGreaterThan(50);
    expect(waits.length).toBeGreaterThan(200);
  });

  it('never passes the options object where Playwright expects `arg`', () => {
    const misplaced = waits
      .filter((w) => w.argIndex !== 2)
      .map((w) => `${w.file}:${w.line} — options in argument ${w.argIndex + 1}, must be 3 (pass null as arg)`);
    expect(misplaced).toEqual([]);
  });

  it('sizes every timeout with budget() or tickBudget(), never a bare number', () => {
    const literal = waits
      .filter((w) => !/timeout\s*:\s*(budget|tickBudget)\s*\(/.test(w.timeout))
      .map((w) => `${w.file}:${w.line} — ${w.timeout}`);
    expect(literal).toEqual([]);
  });
});
