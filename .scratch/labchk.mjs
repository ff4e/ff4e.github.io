import { launchBrowser } from '../tools/ui-lib.mjs';
const b = await launchBrowser({ gl: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', (e) => console.log('PE:', e.message));
p.on('console', (m) => m.type() === 'error' && console.log('CE:', m.text()));
await p.addInitScript(() => {
  try {
    const o = JSON.parse(localStorage.getItem('ff.options') || '{}');
    o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o));
    localStorage.setItem('ff.graphics', 'ai'); localStorage.setItem('ff.renderer', 'webgl');
  } catch {}
});
await p.goto('http://127.0.0.1:5399/tools/ripple-lab.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => { const w = document.getElementById('stage')?.contentWindow; return !!(w && w.__ff); }, { timeout: 60000 });
await p.waitForFunction(() => document.getElementById('state').textContent.includes('room'), { timeout: 40000 });
const get = () => p.evaluate(() => { const t = document.getElementById('stage').contentWindow.__ff; return { ...t.rippleTuning(), waterMs: t.waterAnimMs() }; });
console.log('initial :', JSON.stringify(await get()));
await p.click('#now');                       // shifts offsetTicks
await p.evaluate(() => { const i = document.getElementById('wams'); i.value='33'; i.dispatchEvent(new Event('input')); });
await p.evaluate(() => { const i = [...document.querySelectorAll('#sliders input')][0]; i.value='0.2'; i.dispatchEvent(new Event('input')); });
console.log('perturbed:', JSON.stringify(await get()));
await p.click('#reset');
await p.waitForTimeout(300);
const after = await get();
console.log('after rst:', JSON.stringify(after));
console.log(after.offsetTicks === 0 && after.amp === 0.8 && after.waterMs === 50 ? 'RESET OK (offsetTicks cleared, amp + waterMs restored)' : 'RESET BROKEN');
await b.close();
