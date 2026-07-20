/**
 * CPU vs WebGL render benchmark. For a set of representative rooms (small →
 * large) it times the per-frame render cost of each backend via __ff.benchRender
 * (which isolates compositing+present from the rAF vsync cap and flushes the GPU
 * with gl.finish() so real execution counts), and prints a comparison table.
 *
 *   Usage: node tools/bench-render.mjs [--enhanced] [--frames N] [--rooms a,b,c]
 *
 * Runs its own headless Chromium with ANGLE. Not a pass/fail test — a report.
 * (Numbers depend heavily on the GPU/driver/DPR of the host; treat as relative.)
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
const args = process.argv.slice(2);
const enhanced = args.includes('--enhanced');
const framesArg = args.indexOf('--frames');
const FRAMES = framesArg >= 0 ? Number(args[framesArg + 1]) : 150;
const roomsArg = args.indexOf('--rooms');
// Default mix: 1 PRVNI (small tutorial), 6 KOSTE (large), 9 ZRC (mirror),
// 20 ZDVIZ1 (rope), 22 DRAKAR1 (many sprites), 66 ZX (band shader).
const ROOMS = roomsArg >= 0 ? args[roomsArg + 1].split(',').map(Number) : [1, 6, 9, 20, 22, 66];

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1400, height: 820 } });
p.on('pageerror', (e) => console.log('PE:', e.message));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {} });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);
await p.evaluate((enh) => window.__ff.setGraphics(enh ? 'enhanced' : 'classic'), enhanced);

// Capability probe.
await p.evaluate(() => window.__ff.enterRoomAwait(1));
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
const cap = await p.evaluate((f) => window.__ff.benchRender('webgl', f), 5);
if (!cap || cap.webgl === false) {
  console.log('SKIP: WebGL2 not available in this environment');
  await b.close();
  process.exit(0);
}

const dpr = await p.evaluate(() => window.devicePixelRatio || 1);
console.log(`\n  Fish Fillets render benchmark — art=${enhanced ? 'enhanced' : 'classic'}  frames=${FRAMES}  dpr=${dpr}`);
console.log('  ' + '─'.repeat(78));
console.log('  room            size        CPU ms/f   WebGL ms/f    CPU fps   GL fps   speedup');
console.log('  ' + '─'.repeat(78));

const rows = [];
for (const num of ROOMS) {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 30, { timeout: 9000 });
  if (enhanced) await p.waitForFunction(() => window.__ff.enhancedLoaded() || window.__ff.count() > 60, { timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(120);
  const cpu = await p.evaluate((f) => window.__ff.benchRender('cpu', f), FRAMES);
  const gl = await p.evaluate((f) => window.__ff.benchRender('webgl', f), FRAMES);
  const name = await p.evaluate(() => { const s = document.getElementById('info').textContent || ''; return s.split('—')[0].trim().slice(0, 12); });
  const size = `${cpu.w}x${cpu.h}`;
  const speed = cpu.median / gl.median;
  rows.push({ num, name, size, cpu: cpu.median, gl: gl.median, cpuFps: cpu.fps, glFps: gl.fps, speed });
  console.log(
    `  ${String(num).padStart(2)} ${name.padEnd(12)} ${size.padStart(9)} ` +
    `${cpu.median.toFixed(3).padStart(9)} ${gl.median.toFixed(3).padStart(11)} ` +
    `${cpu.fps.toFixed(0).padStart(9)} ${gl.fps.toFixed(0).padStart(8)} ` +
    `${speed.toFixed(2).padStart(8)}x`,
  );
}
console.log('  ' + '─'.repeat(78));
const avgSpeed = rows.reduce((a, r) => a + r.speed, 0) / rows.length;
console.log(`  median ms/frame reported; speedup = CPU/WebGL. avg speedup ${avgSpeed.toFixed(2)}x`);
console.log('  (WebGL includes a per-frame gl.finish() GPU flush + DPR-scaled present; CPU includes putImageData.)\n');
await b.close();
