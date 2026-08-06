/**
 * The UI probes' wait budgets, checked statically.
 *
 * `page.waitForFunction(pageFunction, arg, options)` — an options object passed as the
 * SECOND argument lands in Playwright's `arg` slot, is serialised into the page, and the
 * timeout it declares is silently discarded; the wait really runs on the page default.
 * The mistake is invisible: the probe still passes, and the number in the source says
 * something that was never true. It was made 241 times across 73 of the 81 probes, and it
 * is why the suite's declared budgets bore no relation to its enforced ones.
 *
 * Two rules, both enforced here:
 *
 *   1. An options object goes in the THIRD argument. Pass `null` as `arg` if unused.
 *   2. A timeout is `budget(nominalMs)` or `tickBudget(ticks)` from `ui-lib.mjs`, never a
 *      bare number — and most waits should carry no timeout at all, because `gotoApp` sets
 *      `WAIT_BACKSTOP` as the page default for every one of them.
 *
 * Rule 2 matters as much as rule 1: enforcing the old hand-written numbers exactly as they
 * stood would have been WORSE than ignoring them, because measurement showed 16 of them
 * were already too small in practice — one even when its probe ran alone.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `new URL(...).pathname`: the latter is not a filesystem path once
// the directory contains a space (%20) or the platform is Windows (/C:/...).
const toolsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');
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

interface Call {
  file: string;
  line: number;
  args: string[];
}

/** Every `waitForFunction(...)` call in the probes, with its arguments. */
function waitCalls(): Call[] {
  const found: Call[] = [];
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
      found.push({
        file,
        line: src.slice(0, pos).split('\n').length,
        args: splitArgs(call.slice(call.indexOf('(') + 1, -1)),
      });
    }
  }
  return found;
}

/** An object literal mentioning `timeout`, whatever order its keys happen to be in. */
const isOptionsObject = (arg: string) => arg.startsWith('{') && /\btimeout\s*:/.test(arg);

const HOWTO =
  'Options go in the THIRD argument of waitForFunction (pass null as arg if unused), and a ' +
  'timeout must come from budget(nominalMs) or tickBudget(ticks) in ui-lib.mjs. Most waits ' +
  'need no timeout at all — gotoApp sets WAIT_BACKSTOP as the page default.';

describe('UI probe wait budgets', () => {
  const calls = waitCalls();

  it('finds the probes to check', () => {
    // A path or glob mistake would make every check below pass vacuously.
    expect(probeFiles.length).toBeGreaterThan(50);
    expect(calls.length).toBeGreaterThan(200);
  });

  it('never passes the options object where Playwright expects `arg`', () => {
    const misplaced = calls
      .filter((c) => c.args.some(isOptionsObject) && !isOptionsObject(c.args[2] ?? ''))
      .map(
        (c) => `${c.file}:${c.line} — options object is argument ${c.args.findIndex(isOptionsObject) + 1}, must be 3`,
      );
    expect(misplaced, HOWTO).toEqual([]);
  });

  it('sizes every timeout with budget() or tickBudget(), never a bare number', () => {
    const bare: string[] = [];
    for (const c of calls) {
      const opts = c.args.find(isOptionsObject);
      if (!opts) continue;
      const value = opts.match(/\btimeout\s*:\s*([^,}]+)/)?.[1]?.trim() ?? '';
      if (!/^(budget|tickBudget)\s*\(/.test(value)) bare.push(`${c.file}:${c.line} — timeout: ${value}`);
    }
    expect(bare, HOWTO).toEqual([]);
  });

  it('leaves no options hiding in something these checks cannot read', () => {
    // A third argument that is not an object literal (a variable, a spread) would carry a
    // timeout straight past both rules above without being seen. There are none today.
    const opaque = calls
      .filter((c) => c.args.length > 2 && !c.args[2].startsWith('{'))
      .map((c) => `${c.file}:${c.line} — third argument is not an object literal: ${c.args[2]}`);
    expect(opaque, HOWTO).toEqual([]);
  });
});
