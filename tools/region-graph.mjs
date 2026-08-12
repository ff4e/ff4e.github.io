#!/usr/bin/env node
/**
 * Why `src/app/main.ts` cannot simply be split into files, measured rather than asserted.
 *
 *     node tools/region-graph.mjs            # the report
 *     node tools/region-graph.mjs --edges    # + every cross-region edge, thinnest first
 *     node tools/region-graph.mjs --json     # machine-readable
 *
 * ── What it measures, and why that is the interesting number ─────────────────
 * The file is divided by regions (`//#region` markers). Treat each region as a
 * candidate module and ask which regions
 * reference which — then the question "can this become N files?" has an answer that is
 * not a matter of taste:
 *
 *   - a DAG of regions splits into modules that import each other, which is ordinary;
 *   - a CYCLE of regions does not. ESM permits circular imports, but `main.ts` is a
 *     top-level-`await` module whose evaluation order is load-bearing (see the
 *     "module-evaluation trap" section of AGENTS.md), so a cycle would have to be paid
 *     for either in circular imports across that boundary or in a host object injected
 *     at every seam — more ceremony than the single mapped file it replaced.
 *
 * So `largest cycle` is the number to watch. While it is 20, the map is the only
 * navigation available. At 0, the regions are a dependency graph and can become files.
 *
 * ── Why edges are counted by how many symbols carry them ─────────────────────
 * A region-to-region edge that exists because of ONE shared constant is not the same
 * obstacle as one carrying a dozen calls, and the difference decides where work is worth
 * spending. The census prints how much of the knot dissolves if the thinnest edges go,
 * which is a plan rather than a complaint.
 *
 * ── What counts as an edge ───────────────────────────────────────────────────
 * A reference, anywhere in region A, to a symbol DECLARED at the top level of main.ts
 * inside region B. Resolved through the TypeScript checker, so shadowed locals and
 * property names of the same spelling do not count. Imports and types are excluded:
 * an import is already a module boundary, and a type carries no runtime coupling.
 *
 * Each edge is classified by what carries it, because the remedies differ:
 *   fn     a function or a const arrow — moves to a module, or inverts to a callback
 *   const  a constant — moves to a module, always, and cheaply
 *   state  a mutable `let` — the expensive kind: it needs an owner, not a new home
 *
 * Only fn/const edges form the graph. A shared `let` is real coupling, but it is coupling
 * to STATE, and the fix (give the state an owner) is different from the fix for a call.
 * Counting it as a call edge would hide that distinction behind one big number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REL = 'src/app/main.ts';

/**
 * Parse the `//#region` markers out of a file and turn them into ranges.
 *
 * This used to live in `tools/gen-map.mjs`, which generated a line-range table into
 * README.md. That table is gone — the app is 37 files now, so the README carries a
 * DIRECTORY map instead and nobody has to keep line numbers honest. The markers
 * themselves stayed, because they are what this measurement is built on and they are
 * useful to grep. This is the one parse of them in the repo.
 */
export function readRegions(text) {
  const lines = text.split('\n');
  const marks = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\/\/#region\s+(.*)$/);
    if (m) marks.push({ line: i + 1, spec: m[1].trim() });
  });
  return marks.map((mk, i) => {
    const parts = mk.spec.split('|').map((s) => s.trim());
    const name = parts.shift() ?? '';
    let anchors = '';
    let hot = false;
    const prose = [];
    for (const p of parts) {
      if (/^anchors:/i.test(p)) anchors = p.replace(/^anchors:\s*/i, '');
      else if (/^hot$/i.test(p)) hot = true;
      else if (p) prose.push(p);
    }
    return {
      name,
      anchors: anchors ? anchors.split(',').map((a) => a.trim()).filter(Boolean) : [],
      desc: prose.join(' — '),
      hot,
      start: mk.line,
      // A region ends where the next one begins; the last runs to the end of the file.
      end: i + 1 < marks.length ? marks[i + 1].line - 1 : lines.length,
    };
  });
}

/**
 * Measure the region graph. Exported so the guard in `test/region-cycle.test.ts` reads
 * the same numbers this command prints, rather than a second implementation of them.
 */
export function analyse() {
  // ── Regions come from the markers, never from hard-coded line numbers ────────
  // An earlier version of this script carried its own table of line ranges and was
  // silently wrong after the first edit that moved a line — which is precisely the
  // failure the generated README map exists to avoid. Same source, one truth.
  const regions = readRegions(fs.readFileSync(path.join(root, REL), 'utf8'));
  const regionAt = (line) => regions.find((r) => line >= r.start && line <= r.end)?.name ?? '(none)';

  const cfg = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config;
  const parsed = ts.parseJsonConfigFileContent(cfg, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFiles().find((f) => f.fileName.endsWith(REL));
  if (!sf) throw new Error(`${REL} is not in the program`);
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  /** True only for declarations that sit at the top level of main.ts itself. */
  function isTopLevel(decl) {
    for (let n = decl.parent; n; n = n.parent) {
      if (ts.isSourceFile(n)) return n === sf;
      if (ts.isFunctionLike(n) || ts.isBlock(n) || ts.isModuleBlock(n)) return false;
    }
    return false;
  }

  // ── What each top-level name is: a function, a constant, or mutable state ────
  const kindOf = new Map();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) kindOf.set(st.name.text, 'fn');
    else if (ts.isVariableStatement(st)) {
      const mutable = !(st.declarationList.flags & ts.NodeFlags.Const);
      for (const d of st.declarationList.declarations) {
        const isFn =
          d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer));
        const kind = mutable ? 'state' : isFn ? 'fn' : 'const';
        if (ts.isIdentifier(d.name)) kindOf.set(d.name.text, kind);
        else for (const el of d.name.elements ?? []) {
          if (el.name && ts.isIdentifier(el.name)) kindOf.set(el.name.text, mutable ? 'state' : 'const');
        }
      }
    }
  }

  const edges = [];
  (function walk(n) {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isBindingElement(p) && p.propertyName === n);
      if (!isPropertyName) {
        const shorthand = ts.isShorthandPropertyAssignment(p) && p.name === n;
        const sym = shorthand ? checker.getShorthandAssignmentValueSymbol(p) : checker.getSymbolAtLocation(n);
        const decls = sym?.declarations ?? [];
        const runtimeLocal =
          decls.length &&
          decls.every(isTopLevel) &&
          !decls.some(
            (d) =>
              ts.isImportSpecifier(d) ||
              ts.isImportClause(d) ||
              ts.isNamespaceImport(d) ||
              ts.isTypeAliasDeclaration(d) ||
              ts.isInterfaceDeclaration(d),
          );
        if (runtimeLocal && kindOf.has(n.text)) {
          const from = regionAt(lineOf(n.getStart(sf)));
          const to = regionAt(lineOf(decls[0].getStart(sf)));
          if (from !== to) edges.push({ from, to, name: n.text, kind: kindOf.get(n.text) });
        }
      }
    }
    ts.forEachChild(n, walk);
  })(sf);

  // ── The region graph, and its strongly-connected components ──────────────────
  /** Group edges into `from → to` with the set of symbols carrying each. */
  function collapse(list) {
    const byPair = new Map();
    for (const e of list) {
      const key = `${e.from}\u0000${e.to}`;
      if (!byPair.has(key)) byPair.set(key, { from: e.from, to: e.to, names: new Set() });
      byPair.get(key).names.add(e.name);
    }
    return [...byPair.values()].map((p) => ({ ...p, names: [...p.names] }));
  }

  /** Tarjan. Returns components of size > 1 (a self-edge is not a cycle worth reporting). */
  function components(pairs) {
    const succ = new Map();
    for (const p of pairs) {
      if (!succ.has(p.from)) succ.set(p.from, new Set());
      succ.get(p.from).add(p.to);
      if (!succ.has(p.to)) succ.set(p.to, new Set());
    }
    let idx = 0;
    const index = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const out = [];
    const strong = (v) => {
      index.set(v, idx);
      low.set(v, idx);
      idx++;
      stack.push(v);
      onStack.add(v);
      for (const w of succ.get(v) ?? []) {
        if (!index.has(w)) {
          strong(w);
          low.set(v, Math.min(low.get(v), low.get(w)));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v), index.get(w)));
        }
      }
      if (low.get(v) === index.get(v)) {
        const comp = [];
        for (;;) {
          const w = stack.pop();
          onStack.delete(w);
          comp.push(w);
          if (w === v) break;
        }
        if (comp.length > 1) out.push(comp);
      }
    };
    for (const v of succ.keys()) if (!index.has(v)) strong(v);
    return out.sort((a, b) => b.length - a.length);
  }

  const callEdges = edges.filter((e) => e.kind !== 'state');
  const pairs = collapse(callEdges);
  const comps = components(pairs);
  const largest = comps[0]?.length ?? 0;
  const core = new Set(comps[0] ?? []);
  const corePairs = pairs.filter((p) => core.has(p.from) && core.has(p.to));
  const byThickness = [...corePairs].sort((a, b) => a.names.length - b.names.length);

  /** How small would the largest cycle be if every edge carried by <= n symbols were gone? */
  function cycleAfterDropping(n) {
    const kept = pairs.filter((p) => p.names.length > n || !(core.has(p.from) && core.has(p.to)));
    return { left: kept.filter((p) => core.has(p.from) && core.has(p.to)).length, cycle: components(kept)[0]?.length ?? 0 };
  }

  // Which symbols carry the most cross-region edges — the hubs worth attacking first.
  const carriers = new Map();
  for (const p of corePairs) for (const nm of p.names) carriers.set(nm, (carriers.get(nm) ?? 0) + 1);
  const hubs = [...carriers.entries()].sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= 3);

  const report = {
    file: REL,
    lines: sf.getLineStarts().length,
    regions: regions.length,
    edges: pairs.length,
    largestCycle: largest,
    cycle: comps[0] ?? [],
    outsideCycle: regions.map((r) => r.name).filter((n) => !core.has(n)),
    coreEdges: corePairs.length,
    singleSymbolEdges: corePairs.filter((p) => p.names.length === 1).length,
    drops: [1, 2, 3, 5].map((n) => ({ n, ...cycleAfterDropping(n) })),
    hubs: hubs.map(([name, count]) => ({ name, count, kind: kindOf.get(name) })),
    stateEdges: collapse(edges.filter((e) => e.kind === 'state')).length,
  };
  return { ...report, edgeList: byThickness };
}

const args = process.argv.slice(2);
const wantEdges = args.includes('--edges');
const wantJson = args.includes('--json');

function print() {
  const report = analyse();
  const { edgeList: byThickness, cycle, largestCycle: largest, hubs } = report;

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${REL}: ${report.lines} lines, ${report.regions} regions`);
    console.log(`region graph: ${report.edges} call/const edges, ${report.stateEdges} shared-state edges`);
    console.log(`\nlargest cycle: ${largest} regions`);
    if (largest) console.log('  ' + cycle.join(' ↔ '));
    console.log(`\noutside every cycle (${report.outsideCycle.length}): ${report.outsideCycle.join(', ')}`);
    if (largest) {
      console.log(`\ninside the core: ${report.coreEdges} edges, ${report.singleSymbolEdges} carried by a single symbol`);
      for (const d of report.drops) {
        console.log(`  drop edges carried by <=${d.n} symbol(s): ${d.left}/${report.coreEdges} left → largest cycle ${d.cycle}`);
      }
      if (hubs.length) {
        console.log('\nsymbols carrying the most core edges:');
        for (const h of report.hubs) console.log(`  ${String(h.count).padStart(2)}  ${h.name.padEnd(24)} ${h.kind}`);
      }
    }
    if (wantEdges) {
      console.log('\n--- core edges, thinnest first ---');
      for (const p of byThickness) {
        console.log(` ${String(p.names.length).padStart(2)}  ${p.from.padEnd(34)} → ${p.to.padEnd(34)} ${p.names.join(', ')}`);
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) print();
