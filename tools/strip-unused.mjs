#!/usr/bin/env node
/**
 * Delete the imports a file no longer uses.
 *
 * Pulling a region out of `main.ts` leaves its imports behind: the names are gone but
 * the `import` lines are not, and `npm run typecheck` says nothing because
 * `noUnusedLocals` is off (turning it on fails the repo on deliberately unused
 * parameters). After nine extractions `main.ts` was carrying 192 dead imports: 504
 * lines deleted against 34 rewritten, a net 470, and about 1 600 tokens of noise at the
 * top of the file that every reader pays for.
 *
 * It asks the compiler which ones they are (TS6133 / TS6192) and deletes exactly those
 * spans, then repeats — dropping one import can orphan a type only it referenced.
 *
 * Two things it deliberately does NOT do, both of which it got wrong on the first pass
 * and both of which are silent:
 *   - It never deletes a statement's LEADING TRIVIA. `getFullStart()` includes the
 *     comments above a node, so deleting the first import by its full start took the
 *     file docblock and two `//#region` markers with it, and nothing failed.
 *   - It never reformats a surviving import. Only the dead specifiers are cut, so a
 *     multi-line import stays multi-line and the diff is exactly the removal.
 *
 * Usage: node tools/strip-unused.mjs [path]   (default src/app/main.ts)
 * Rewrites in place. Run `npm run typecheck` afterwards, and read the diff.
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2] ?? 'src/app/main.ts';

/** The statement's own span, plus the newline it sits on — but not the comments above it. */
function statementSpan(node, sf, text) {
  const start = node.getStart(sf); // getStart, NOT getFullStart: leading comments stay
  let end = node.getEnd();
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  if (text[end] === '\r') end++;
  if (text[end] === '\n') end++;
  return { start, end, text: '' };
}

for (let pass = 0; pass < 12; pass++) {
  const cfg = ts.getParsedCommandLineOfConfigFile('tsconfig.json', {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, ' '));
    },
  });
  const prog = ts.createProgram([path], { ...cfg.options, noUnusedLocals: true, noEmit: true });
  const sf = prog.getSourceFile(path);
  if (!sf) throw new Error(`no such source file: ${path}`);
  const diags = ts.getPreEmitDiagnostics(prog, sf).filter((d) => d.code === 6133 || d.code === 6192);
  if (diags.length === 0) {
    console.log(`[strip-unused] ${path}: clean after ${pass} pass(es)`);
    break;
  }

  const text = sf.getFullText();
  // 6192 = every name in the declaration is unused, so the whole statement goes.
  // 6133 = one name is unused. Keyed by position, because the same name can appear in
  // more than one import.
  const wholeStatements = new Set();
  const deadPositions = new Set();
  for (const d of diags) {
    if (d.code === 6192) {
      const stmt = sf.statements.find((s) => s.getStart(sf) <= d.start && d.start < s.getEnd());
      if (stmt) wholeStatements.add(stmt);
    } else {
      deadPositions.add(d.start);
    }
  }

  const edits = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (wholeStatements.has(st)) {
      edits.push(statementSpan(st, sf, text));
      continue;
    }
    const clause = st.importClause;
    if (!clause) continue; // side-effect import: no bindings, nothing to be unused
    const bindings = clause.namedBindings;

    // A default or namespace import is the whole clause; if it is dead and there is
    // nothing else in the declaration, the statement goes.
    const defaultDead = clause.name && deadPositions.has(clause.name.getStart(sf));
    const namedDead =
      bindings && ts.isNamedImports(bindings)
        ? bindings.elements.filter((el) => deadPositions.has(el.name.getStart(sf)))
        : [];
    const namespaceDead =
      bindings && ts.isNamespaceImport(bindings) && deadPositions.has(bindings.name.getStart(sf));

    const everythingDead =
      (!clause.name || defaultDead) &&
      (!bindings ||
        namespaceDead ||
        (ts.isNamedImports(bindings) && namedDead.length === bindings.elements.length));
    if (everythingDead && (defaultDead || namespaceDead || namedDead.length > 0)) {
      edits.push(statementSpan(st, sf, text));
      continue;
    }
    // Partial. Delete each RUN of adjacent dead specifiers as one span, so the edits
    // cannot overlap — cutting them one at a time corrupted the list whenever two dead
    // names sat next to each other, and the result still parsed badly enough that only
    // a syntax error gave it away.
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const dead = new Set(namedDead);
    const els = bindings.elements;
    for (let i = 0; i < els.length; ) {
      if (!dead.has(els[i])) { i++; continue; }
      let j = i;
      while (j + 1 < els.length && dead.has(els[j + 1])) j++;
      const after = els[j + 1];
      if (after) {
        // ...up to the next survivor, which takes the separators with it.
        edits.push({ start: els[i].getStart(sf), end: after.getStart(sf), text: '' });
      } else {
        // Trailing run: cut back to the previous survivor, and swallow a dangling comma.
        const before = els[i - 1];
        const start = before ? before.getEnd() : els[i].getStart(sf);
        let end = els[j].getEnd();
        let k = end;
        while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
        if (text[k] === ',') end = k + 1;
        edits.push({ start, end, text: '' });
      }
      i = j + 1;
    }
  }
  if (edits.length === 0) {
    console.log(`[strip-unused] ${path}: ${diags.length} diagnostic(s) left that it cannot place`);
    break;
  }

  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  writeFileSync(path, out);
  console.log(`[strip-unused] ${path}: pass ${pass}, ${edits.length} edit(s)`);
}

// Belt and braces: the leading trivia bug was silent, so say what survived.
const after = readFileSync(path, 'utf8');
console.log(
  `[strip-unused] ${path}: ${after.split('\n').length} lines, ` +
    `${(after.match(/^\/\/#region/gm) ?? []).length} region marker(s)`,
);
