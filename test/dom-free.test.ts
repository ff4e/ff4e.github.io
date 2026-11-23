/**
 * The modules a host without a browser (the native QuickJS build) imports from `src/` for
 * their DRAWING stay DOM-free at every import depth:
 *
 *   - `fishFrame.ts`: imported instead of restated — a restated copy has already been
 *     wrong once, drawing no fish at rest, because `bodyFrame: 0` means "no fish" to the
 *     renderers;
 *   - `mapPaintAi.ts` and `zoomedInfoPanel.ts`: one frame of the `ai` world map, painted
 *     through `Surface2D` from state the caller hands in (`mapDraw.ts` is the page's caller);
 *   - `mapSelection.ts`: where a controller's selection goes on that map;
 *   - `subtitles.ts` (the lines, their rows and speaker colours) and the native subtitle
 *     layout and drawing built on it (native/js/subtitleLayout.ts, subtitleDraw.ts) — the
 *     browser keeps DOM text, so nothing on the web would notice a document reach there.
 *
 * That only works while nothing a module pulls in at RUNTIME reaches for the document. A browser global used inside a
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

/**
 * Injection seams: a module whose ONLY browser reach is the default of a factory a host
 * replaces at boot (native/js/main.ts sets both). It is not scanned and not walked into —
 * the browser default behind it is the point of it — and it must keep exporting its setter,
 * or the exemption would cover a module that can no longer be redirected.
 */
const INJECTED: Readonly<Record<string, string>> = {
  'src/render/surface2d.ts': 'setSurfaceFactory',
  'src/render/scratchCanvas.ts': 'setScratchCanvasFactory',
};

/** Every source file `entry` evaluates at runtime, by relative import, short of a seam. */
function runtimeClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (relative(root, file) in INJECTED) continue;
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

const DOM_FREE = [
  'src/app/fishFrame.ts',
  'src/render/mapPaintAi.ts',
  'src/render/zoomedInfoPanel.ts',
  'src/render/mapSelection.ts',
  'src/render/subtitles.ts',
  'native/js/subtitleLayout.ts',
  'native/js/subtitleDraw.ts',
];

describe('DOM-free drawing modules', () => {
  it.each(DOM_FREE)('%s reaches no browser API at any import depth', (entry) => {
    const files = runtimeClosure(entry);
    expect(files.length).toBeGreaterThan(1);
    expect(files.filter((f) => !(relative(root, f) in INJECTED)).flatMap(browserIdentifiers)).toEqual([]);
  });

  it.each(Object.entries(INJECTED))('%s can still be redirected (%s)', (file, setter) => {
    expect(readFileSync(join(root, file), 'utf8')).toMatch(new RegExp(`export function ${setter}\\(`));
  });
});

describe('fishFrame.ts', () => {
  it('draws both fish at rest before any room is loaded', async () => {
    const { fishFrameFor } = await import('../src/app/fishFrame.js');
    expect(fishFrameFor('little').bodyFrame).not.toBe(0);
    expect(fishFrameFor('big').bodyFrame).not.toBe(0);
  });
});
