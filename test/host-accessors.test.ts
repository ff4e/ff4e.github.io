/**
 * Every host accessor must expose the variable of the same name.
 *
 * `main.ts` hands each extracted module a `host` object of accessors — 204 of them,
 * the largest being the 144-member wall for `debugHooks.ts`. They are all of the form:
 *
 *     get roomLoading() { return roomLoading; },
 *     set forceRoomRedraw(v: boolean) { forceRoomRedraw = v; },
 *
 * The hazard this guards is a getter wired to the WRONG backing variable. TypeScript
 * catches it only when the types disagree, so `get aiRoom() { return aiRoomNum; }` is a
 * compile error — but this file is full of same-typed neighbours where it would not be:
 * `aiPending` / `enhancedPending` are both `boolean`, and `mapSig` / `panelSig` /
 * `lastRoomSig` are all `string | null`. Swap one of those and it typechecks silently.
 *
 * The game would be unaffected — it reads the real variables. What breaks is the
 * PROBES' view of the game, which is worse than it sounds: a probe would assert against
 * a wrong-but-plausible value, and `tools/capture-digest.mjs` only notices if that field
 * is recorded AND the two variables happen to differ at capture time. Two booleans that
 * are both false during the capture sail straight through.
 *
 * So it is checked here instead. The rule is mechanical and total: for every accessor
 * whose body is a bare return or a bare assignment, the identifier must match the
 * accessor's own name. Accessors with a more involved body are skipped — none exist
 * today, and if one appears it deserves reading rather than a regex.
 *
 * The better fix is to GENERATE the accessor block from the same member list the host
 * interfaces are generated from, at which point identity is true by construction and
 * this test becomes redundant. Until then, this locks in the property.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const file = join(import.meta.dirname, '..', 'src', 'app', 'main.ts');

interface Mismatch {
  kind: 'get' | 'set';
  member: string;
  backing: string;
  line: number;
}

function scan(): { mismatches: Mismatch[]; checked: number } {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile('main.ts', text, ts.ScriptTarget.ESNext, true);
  const mismatches: Mismatch[] = [];
  let checked = 0;
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (n: ts.Node): void => {
    if (ts.isGetAccessor(n) && ts.isIdentifier(n.name)) {
      const first = n.body?.statements[0];
      if (first && ts.isReturnStatement(first) && first.expression && ts.isIdentifier(first.expression)) {
        checked++;
        if (first.expression.text !== n.name.text)
          mismatches.push({ kind: 'get', member: n.name.text, backing: first.expression.text, line: lineOf(n) });
      }
    }
    if (ts.isSetAccessor(n) && ts.isIdentifier(n.name)) {
      const first = n.body?.statements[0];
      if (
        first &&
        ts.isExpressionStatement(first) &&
        ts.isBinaryExpression(first.expression) &&
        first.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(first.expression.left)
      ) {
        checked++;
        if (first.expression.left.text !== n.name.text)
          mismatches.push({ kind: 'set', member: n.name.text, backing: first.expression.left.text, line: lineOf(n) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { mismatches, checked };
}

describe('host accessors in main.ts', () => {
  const { mismatches, checked } = scan();

  it('checks a meaningful number of accessors (a silent zero would pass vacuously)', () => {
    expect(checked).toBeGreaterThan(150);
  });

  it('every accessor exposes the variable of the same name', () => {
    expect(
      mismatches,
      mismatches.length
        ? 'A host accessor is wired to the wrong backing variable. The game is unaffected, but ' +
          'every probe reading it sees the wrong value:\n' +
          mismatches.map((m) => `  main.ts:${m.line}  ${m.kind} ${m.member} → ${m.backing}`).join('\n')
        : '',
    ).toEqual([]);
  });
});
