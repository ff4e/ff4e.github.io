#!/usr/bin/env python3
"""Generate src/data/roomTable.ts from the original Delphi zaklad.pas Desc[] array.
Faithful, deterministic transcription (no hand-editing). Run from the port/ dir."""
import re, os
ZAKLAD = os.path.expanduser('~/.cache/ffng-orig/delphi-src/Fillets/zaklad.pas')
src = open(ZAKLAD, 'rb').read().decode('cp1250')
pat = re.compile(r"\(Jmeno:'([^']*)';\s*cHud:\s*(-?\d+);\s*DFFR:\s*(\d+);\s*DFFS:\s*(\d+);\s*pop:\s*'((?:[^']|'')*)'\)")
entries = []
for line in src.splitlines():
    if not line.strip().startswith("(Jmeno:'"):
        continue
    m = pat.search(line)
    if not m:
        raise SystemExit(f"unparsed Desc line: {line!r}")
    name, chud, dffr, dffs, pop = m.groups()
    if name == 'BANKA1':   # {$ifdef scoredemo} demo-only variant; keep the BANKA ($else) build
        continue
    pop = pop.replace("''", "'")
    cz, en = pop.split('^', 1) if '^' in pop else (pop, pop)
    entries.append((name, int(chud), int(dffr), int(dffs), cz.strip(), en.strip()))
if len(entries) != 72:
    raise SystemExit(f"expected 72 rooms, parsed {len(entries)}")

def js(s): return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'

L = []
L.append('// AUTO-GENERATED from the original Delphi source zaklad.pas `Desc[1..72]` array.')
L.append('// Do not edit by hand; regenerate via `python3 tools/gen-room-table.py`.')
L.append('// Source: ~/.cache/ffng-orig/delphi-src/Fillets/zaklad.pas (decoded CP1250 -> UTF-8).')
L.append('//')
L.append('// Fields are faithful to the Pascal record Desc[].:')
L.append('//   jmeno : 8-char room name (Desc[].Jmeno)')
L.append('//   cHud  : control-panel / HUD variant index (Desc[].cHud; -1 = none)')
L.append('//   dffr  : expected byte size of the room 0NN.FFR file (integrity check, URoom.pas:1003)')
L.append('//   dffs  : expected byte size of the room 0NN.FFS file (integrity check, URoom.pas:1011)')
L.append('//   cz/en : room description, split from Desc[].Pop on the "^" separator')
L.append('')
L.append('export interface RoomDesc {')
L.append('  /** 1-based room number, matching the 0NN.FFR / 0NN.FFS / 0NN.FFT file index. */')
L.append('  readonly num: number;')
L.append('  readonly jmeno: string;')
L.append('  readonly cHud: number;')
L.append('  readonly dffr: number;')
L.append('  readonly dffs: number;')
L.append('  readonly cz: string;')
L.append('  readonly en: string;')
L.append('}')
L.append('')
L.append('/** The 72 rooms, in original order (index 0 => room number 1). */')
L.append('export const ROOMS: readonly RoomDesc[] = [')
for i, (name, chud, dffr, dffs, cz, en) in enumerate(entries, 1):
    L.append(f'  {{ num: {i}, jmeno: {js(name)}, cHud: {chud}, dffr: {dffr}, dffs: {dffs}, cz: {js(cz)}, en: {js(en)} }},')
L.append('];')
L.append('')
L.append('/** Look up a room by its 1-based number (1..72). */')
L.append('export function roomByNumber(num: number): RoomDesc | undefined {')
L.append('  return ROOMS[num - 1];')
L.append('}')
L.append('')
L.append('/** Look up a room by its (case-insensitive) Jmeno. */')
L.append('export function roomByName(name: string): RoomDesc | undefined {')
L.append('  const n = name.toUpperCase();')
L.append('  return ROOMS.find((r) => r.jmeno.toUpperCase() === n);')
L.append('}')
L.append('')
open('src/data/roomTable.ts', 'w').write('\n'.join(L))
print(f"wrote src/data/roomTable.ts with {len(entries)} rooms")
