/**
 * `fishFrame.ts` stays DOM-free at every import depth.
 *
 * A host without a browser (the native QuickJS build) imports `fishFrameFor` instead of
 * restating it — a restated copy has already been wrong once, drawing no fish at rest,
 * because `bodyFrame: 0` means "no fish" to the renderers. That only works while nothing
 * the module pulls in at RUNTIME reaches for the document. A browser global used inside a
 * function would import cleanly in node and fail only when called, so this walks the
 * static import graph (type-only imports are erased and skipped) and checks the
 * identifiers of every file in it — comments and strings are not identifiers, so the
 * docblocks that mention the DOM do not trip it.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BROWSER_NAMES = new Set([
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'createElement',
  'getContext',
  'addEventListener',
  'classList',
  'style',
  'ImageData',
  'OffscreenCanvas',
]);
const BROWSER_PATTERN = /^(HTML\w*Element|Canvas\w*)$/;

/** Every source file `entry` evaluates at runtime, by relative import. */
function runtimeClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      let spec: ts.Expression | undefined;
      if (ts.isImportDeclaration(st) && !st.importClause?.isTypeOnly) spec = st.moduleSpecifier;
      else if (ts.isExportDeclaration(st) && !st.isTypeOnly) spec = st.moduleSpecifier;
      if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith('.')) continue;
      queue.push(resolve(dirname(file), spec.text.replace(/\.js$/, '.ts')));
    }
  }
  return [...seen];
}

function browserIdentifiers(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (BROWSER_NAMES.has(node.text) || BROWSER_PATTERN.test(node.text))) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      hits.push(`${relative(root, file)}:${line + 1} ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe('fishFrame.ts', () => {
  it('reaches no browser API at any import depth', () => {
    const files = runtimeClosure('src/app/fishFrame.ts');
    expect(files.length).toBeGreaterThan(1);
    expect(files.flatMap(browserIdentifiers)).toEqual([]);
  });

  it('draws both fish at rest before any room is loaded', async () => {
    const { fishFrameFor } = await import('../src/app/fishFrame.js');
    expect(fishFrameFor('little').bodyFrame).not.toBe(0);
    expect(fishFrameFor('big').bodyFrame).not.toBe(0);
  });
});
