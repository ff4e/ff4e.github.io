/**
 * Measurement: which way should the phone be HELD for each room — and how often does that
 * disagree with landscape?
 *
 * The sibling of `tools/measure-touchbar-edge.mjs`, one level up. That tool asks which
 * EDGE the touch bar should take within a landscape viewport; this asks which ORIENTATION
 * the device should be locked to for a room, which is the question
 * `src/app/deviceOrientation.ts` answers and `src/platform/orientationLock.ts` enforces.
 *
 * It brings NO arithmetic of its own — it calls `preferredDeviceOrientation` exactly as
 * the running app does, so a number printed here is a number the game will act on.
 *
 * ── Where the viewports come from ────────────────────────────────────────────
 * `tools/layoutLabHousings.ts`'s `LAB_NATIVE_DEVICES` — the three iPhone families at the
 * size the NATIVE app actually gets, with the cutout each actually reports, measured on
 * the simulator. Playwright's browser registry is deliberately NOT used: the orientation
 * lock is native-only (iOS Safari has no `screen.orientation.lock()` at all), so a browser
 * viewport is not a device this feature can ever run on, and mobile Safari's viewport is
 * a different size rather than the native one minus a number (see that file's header).
 *
 * `land.w`/`land.h` are the device's long and short screen edges, which is the pair the
 * decision is made against — it must not depend on which way the phone happens to be
 * turned, or the lock would chase its own tail.
 *
 * Usage:
 *   npx tsx tools/measure-device-orientation.mjs           # summary per device
 *   npx tsx tools/measure-device-orientation.mjs --rooms   # every room that prefers portrait
 *   npx tsx tools/measure-device-orientation.mjs --csv     # per room, per device
 */
import { execFileSync } from 'node:child_process';
import { preferredDeviceOrientation } from '../src/app/deviceOrientation.ts';
import { visibleRoomArea, TOUCHBAR_H, TOUCHBAR_LEAD, TOUCHBAR_W } from '../src/app/touchBarEdge.ts';
import { LAB_NATIVE_DEVICES } from './layoutLabHousings.ts';

const CELL = 15; // native px per FFR cell
const flag = (name) => process.argv.includes(name);

function rooms() {
  const out = execFileSync('npx', ['tsx', 'tools/dump-ffr.ts', '--all'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const list = [];
  for (const line of out.split('\n')) {
    const m = /^\s*✓\s+\d+\s+(\S+)\s+(\d+)x(\d+)\s/.exec(line);
    if (m) list.push({ name: m[1], w: Number(m[2]) * CELL, h: Number(m[3]) * CELL });
  }
  return list;
}

/**
 * The same three candidate areas `preferredDeviceOrientation` compares, so the report can
 * say by HOW MUCH a room prefers what it prefers rather than only which side won.
 *
 * Restated here rather than exported from the module, because exporting them would widen
 * that module's surface for a scratch tool's benefit — and `test/deviceOrientation.test.ts`
 * pins the two against each other, so a drift between them fails a gate rather than
 * quietly mis-reporting here.
 */
function areas(r, long, short, housing) {
  const landscape = Math.max(
    visibleRoomArea(r.w, r.h, long, short - TOUCHBAR_H, 'fill'),
    visibleRoomArea(r.w, r.h, long - TOUCHBAR_W - Math.max(housing, TOUCHBAR_LEAD), short, 'fill'),
  );
  const portrait = visibleRoomArea(r.w, r.h, short, long - TOUCHBAR_H - housing, 'fill');
  return { landscape, portrait };
}

const all = rooms();
const devices = LAB_NATIVE_DEVICES.filter((d) => d.land);

if (flag('--csv')) {
  console.log('device,room,roomW,roomH,landscapeArea,portraitArea,prefers,gainPct');
}

for (const d of devices) {
  const long = d.land.w;
  const short = d.land.h;
  const housing = d.housing?.left ?? 0;
  const portraitRooms = [];
  for (const r of all) {
    const want = preferredDeviceOrientation(r.w, r.h, long, short, 'fill', 1, housing);
    const { landscape, portrait } = areas(r, long, short, housing);
    const won = want === 'portrait' ? portrait : landscape;
    const lost = want === 'portrait' ? landscape : portrait;
    const gain = lost > 0 ? (won / lost - 1) * 100 : Infinity;
    if (want === 'portrait') portraitRooms.push({ ...r, gain });
    if (flag('--csv')) {
      console.log(
        `${d.name},${r.name},${r.w},${r.h},${Math.round(landscape)},${Math.round(portrait)},${want},${gain.toFixed(1)}`,
      );
    }
  }
  if (flag('--csv')) continue;
  console.log(`\n${d.name} — ${long}x${short}, cutout ${housing}px`);
  console.log(`  ${all.length - portraitRooms.length} of ${all.length} rooms prefer landscape, ${portraitRooms.length} portrait`);
  if (flag('--rooms')) {
    for (const r of portraitRooms.sort((a, b) => b.gain - a.gain)) {
      console.log(`    ${r.name.padEnd(10)} ${r.w}x${r.h}  +${r.gain.toFixed(0)}% of the room visible in portrait`);
    }
  } else if (portraitRooms.length) {
    const best = portraitRooms.reduce((a, b) => (b.gain > a.gain ? b : a));
    console.log(`    biggest win: ${best.name} ${best.w}x${best.h}, +${best.gain.toFixed(0)}% in portrait`);
  }
}
