#!/usr/bin/env node
/**
 * Delete the imports a file no longer uses.
 *
 * Pulling a region out of `main.ts` leaves its imports behind: the names are gone but
 * the `import` lines are not, and `npm run typecheck` says nothing because
 * `noUnusedLocals` is off (turning it on fails the repo on deliberately unused
 * parameters). After nine extractions `main.ts` was carrying 192 dead imports — 493
 * lines, about 1 600 tokens of noise at the top of the file that every reader pays for.
 *
 * This asks the compiler which ones they are (TS6133 / TS6192) and removes exactly
 * those, then repeats: dropping one import can orphan a type only it referenced. It
 * never touches a side-effect import (`import './x.js'`) — those have no clause to be
 * unused, so they are invisible to both diagnostics.
 *
 * Usage: node tools/strip-unused.mjs [path]   (default src/app/main.ts)
 * Rewrites the file in place; run `npm run typecheck` afterwards.
 */
import ts from 'typescript';
import { writeFileSync } from 'node:fs';

const path = process.argv[2] ?? 'src/app/main.ts';

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

  // 6192 = every name in the declaration is unused (drop the statement).
  // 6133 = one name is unused (drop that specifier). Keyed by position, because the
  // same name can legitimately appear in more than one import.
  const wholeStatements = new Set();
  const deadSpecifiers = new Set();
  for (const d of diags) {
    if (d.code === 6192) {
      const stmt = sf.statements.find((s) => s.getStart(sf) <= d.start && d.start < s.getEnd());
      if (stmt) wholeStatements.add(stmt);
    } else {
      const m = /'([^']+)' is declared/.exec(ts.flattenDiagnosticMessageText(d.messageText, ' '));
      if (m) deadSpecifiers.add(`${m[1]}@${d.start}`);
    }
  }

  const edits = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    if (wholeStatements.has(st)) {
      edits.push({ start: st.getFullStart(), end: st.getEnd(), text: '' });
      continue;
    }
    const bindings = st.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const keep = bindings.elements.filter(
      (el) => !deadSpecifiers.has(`${el.name.text}@${el.name.getStart(sf)}`),
    );
    if (keep.length === bindings.elements.length) continue;
    if (keep.length === 0) {
      edits.push({ start: st.getFullStart(), end: st.getEnd(), text: '' });
      continue;
    }
    edits.push({
      start: bindings.getStart(sf),
      end: bindings.getEnd(),
      text: `{ ${keep.map((k) => k.getText(sf)).join(', ')} }`,
    });
  }
  if (edits.length === 0) {
    // Anything left is not on a named import (an unused default or namespace import,
    // say) and needs a human. Bail rather than spin.
    console.log(`[strip-unused] ${path}: ${diags.length} left that are not named imports`);
    break;
  }

  let out = sf.getFullText();
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  writeFileSync(path, out);
  console.log(`[strip-unused] ${path}: pass ${pass}, ${edits.length} import(s) rewritten`);
}
