// Fish outline-fix comparison gallery.
// For each frame: original NN x4 | current AI (shipped pipeline) | fixed geometric rim @ several stroke widths.
// Output: tools/fish-outline/ (img/*.png + index.html). Serve: npx http-server tools/fish-outline -p 8106
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const OUT = join(toolsDir, 'fish-outline');
const IMG = join(OUT, 'img');
const SCALE = 4;
const MODEL = 'realesr-animevideov3-x4';
const BIN = process.env.REALESRGAN_NCNN;
const STROKES = [2, 3, 4, 5];
const PAD = Number(process.env.PAD || 8);   // transparent margin (source px) added before upscale
const PADS = (process.env.PADS || '8,16,24').split(',').map(Number);

const FRAMES = [
  ['big/right/body_rest_00.png', 'big rest'],
  ['big/right/body_swam_00.png', 'big swim'],
  ['big/right/body_turn_00.png', 'big turn'],
  ['big/right/body_vertical_00.png', 'big vertical'],
  ['small/right/body_rest_00.png', 'small rest'],
  ['small/right/body_swam_00.png', 'small swim'],
];
const FSRC = join(root, 'public', 'enhanced', '_fish');

if (!BIN || !existsSync(BIN)) { console.error('REALESRGAN_NCNN not set/found'); process.exit(1); }
mkdirSync(IMG, { recursive: true });

const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: ['ignore','ignore','inherit'] }); if (r.status !== 0) throw new Error(`${cmd} exit ${r.status}`); };
function probe(png){ const r=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',png],{encoding:'utf8'}); const [w,h]=r.stdout.trim().split(',').map(Number); return {w,h}; }
function dec(png,w,h,work,tag){ const raw=join(work,`${tag}.rgba`); run('ffmpeg',['-y','-v','error','-i',png,'-f','rawvideo','-pix_fmt','rgba',raw]); return new Uint8Array(readFileSync(raw)); }
function enc(rgba,w,h,work,tag,dst){ const raw=join(work,`${tag}.rgba`); writeFileSync(raw,Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength)); run('ffmpeg',['-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-video_size',`${w}x${h}`,'-i',raw,dst]); }
function ai(inP,outP){ run(BIN,['-i',inP,'-o',outP,'-n',MODEL,'-s',String(SCALE),'-f','png','-m',join(dirname(BIN),'models')]); }
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};

function bleed(rgba,w,h){ const out=new Uint8Array(w*h*4); const known=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++){ if(rgba[i*4+3]>=128){ out[i*4]=rgba[i*4];out[i*4+1]=rgba[i*4+1];out[i*4+2]=rgba[i*4+2];known[i]=1; } }
  for(let p=0;p<w+h;p++){ let filled=0; const snap=known.slice();
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const i=y*w+x; if(snap[i])continue; let r=0,g=0,b=0,n=0;
      if(x>0&&snap[i-1]){r+=out[(i-1)*4];g+=out[(i-1)*4+1];b+=out[(i-1)*4+2];n++;}
      if(x<w-1&&snap[i+1]){r+=out[(i+1)*4];g+=out[(i+1)*4+1];b+=out[(i+1)*4+2];n++;}
      if(y>0&&snap[i-w]){r+=out[(i-w)*4];g+=out[(i-w)*4+1];b+=out[(i-w)*4+2];n++;}
      if(y<h-1&&snap[i+w]){r+=out[(i+w)*4];g+=out[(i+w)*4+1];b+=out[(i+w)*4+2];n++;}
      if(n){out[i*4]=Math.round(r/n);out[i*4+1]=Math.round(g/n);out[i*4+2]=Math.round(b/n);known[i]=1;filled++;} }
    if(!filled)break; }
  for(let i=0;i<w*h;i++)out[i*4+3]=255; return out; }
function grey(rgba,w,h){ const out=new Uint8Array(w*h*4); for(let i=0;i<w*h;i++){const a=rgba[i*4+3];out[i*4]=out[i*4+1]=out[i*4+2]=a;out[i*4+3]=255;} return out; }
function padRgba(rgba,w,h,pad){ const W=w+2*pad, H=h+2*pad; const out=new Uint8Array(W*H*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const s=(y*w+x)*4, d=((y+pad)*W+(x+pad))*4; out[d]=rgba[s];out[d+1]=rgba[s+1];out[d+2]=rgba[s+2];out[d+3]=rgba[s+3]; }
  return { rgba: out, w: W, h: H }; }
function cropRgba(rgba,w,h,cx,cy,cw,ch){ const out=new Uint8Array(cw*ch*4);
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){ const s=((y+cy)*w+(x+cx))*4, d=(y*cw+x)*4; out[d]=rgba[s];out[d+1]=rgba[s+1];out[d+2]=rgba[s+2];out[d+3]=rgba[s+3]; }
  return out; }
function insideDist(mask,w,h){ const INF=1e9; const d=new Float64Array(w*h);
  for(let i=0;i<w*h;i++) d[i]=mask[i]?INF:0; const D=1, Dd=Math.SQRT2;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const i=y*w+x; if(!mask[i])continue; let v=d[i];
    if(x>0)v=Math.min(v,d[i-1]+D); if(y>0)v=Math.min(v,d[i-w]+D);
    if(x>0&&y>0)v=Math.min(v,d[i-w-1]+Dd); if(x<w-1&&y>0)v=Math.min(v,d[i-w+1]+Dd); d[i]=v; }
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){ const i=y*w+x; if(!mask[i])continue; let v=d[i];
    if(x<w-1)v=Math.min(v,d[i+1]+D); if(y<h-1)v=Math.min(v,d[i+w]+D);
    if(x<w-1&&y<h-1)v=Math.min(v,d[i+w+1]+Dd); if(x>0&&y<h-1)v=Math.min(v,d[i+w-1]+Dd); d[i]=v; }
  return d; }
function flatten(png,ow,oh,dst){ run('ffmpeg',['-y','-v','error','-f','lavfi','-i',`color=c=0x2b2b2b:s=${ow}x${oh}`,'-i',png,'-filter_complex','[0][1]overlay','-frames:v','1',dst]); }

const rows = [];
for (const [rel, label] of FRAMES) {
  const SRC = join(FSRC, rel);
  if (!existsSync(SRC)) { console.warn('skip missing', rel); continue; }
  const work = mkdtempSync(join(tmpdir(), 'fishgal-'));
  const key = rel.replace(/[\/]/g, '_').replace('.png','');
  try {
    const {w,h} = probe(SRC); const src = dec(SRC,w,h,work,'src');
    const ow = w*SCALE, oh = h*SCALE;
    const variants = [];
    // --- pipeline: colour-AI + matte-AI on an arbitrary RGBA -> {col,m,W4,H4}
    const pipe = (rgba, W, H, tag) => {
      const colP=join(work,`${tag}_col.png`); enc(bleed(rgba,W,H),W,H,work,`${tag}_col`,colP);
      const colA=join(work,`${tag}_colai.png`); ai(colP,colA);
      const mP=join(work,`${tag}_m.png`); enc(grey(rgba,W,H),W,H,work,`${tag}_m`,mP);
      const mA=join(work,`${tag}_mai.png`); ai(mP,mA);
      const W4=W*SCALE, H4=H*SCALE;
      return { col: dec(colA,W4,H4,work,`${tag}_colaid`), m: dec(mA,W4,H4,work,`${tag}_maid`), W4, H4 };
    };
    const combineSmooth = (col,m,W4,H4) => { const o=new Uint8Array(W4*H4*4);
      for(let i=0;i<W4*H4;i++){ o[i*4]=col[i*4];o[i*4+1]=col[i*4+1];o[i*4+2]=col[i*4+2]; o[i*4+3]=Math.round(smooth(0.12,0.6,m[i*4]/255)*255); } return o; };
    const combineGeo = (col,m,W4,H4,S) => { const mask=new Uint8Array(W4*H4);
      for(let i=0;i<W4*H4;i++) mask[i]=m[i*4]>=128?1:0; const dist=insideDist(mask,W4,H4); const o=new Uint8Array(W4*H4*4);
      for(let i=0;i<W4*H4;i++){ const alpha=smooth(0.12,0.6,m[i*4]/255); const ink=Math.min(1,Math.max(0,S-dist[i]+1));
        o[i*4]=Math.round(col[i*4]*(1-ink));o[i*4+1]=Math.round(col[i*4+1]*(1-ink));o[i*4+2]=Math.round(col[i*4+2]*(1-ink)); o[i*4+3]=Math.round(alpha*255); } return o; };
    const emit = (rgba,W4,H4,name,cap,hi) => { const p=join(work,`${name}.png`); enc(rgba,W4,H4,work,name,p);
      const o=join(IMG,`${key}__${name}.png`); flatten(p,W4,H4,o); variants.push([cap, `img/${key}__${name}.png`, hi]); };

    // original NN
    const nnPng=join(work,'nn.png'); run('ffmpeg',['-y','-v','error','-i',SRC,'-vf',`scale=${ow}:${oh}:flags=neighbor`,nnPng]);
    const nnOut=join(IMG,`${key}__orig.png`); flatten(nnPng,ow,oh,nnOut); variants.push(['original', `img/${key}__orig.png`, false]);

    // current AI (unpadded)
    const up = pipe(src, w, h, 'u');
    emit(combineSmooth(up.col,up.m,ow,oh), ow, oh, 'current', 'current AI (pad 0)', false);

    // Martin's trick: sweep transparent-margin sizes -> pipeline -> crop back
    for (const PADn of PADS) {
      const { rgba: psrc, w: pw, h: ph } = padRgba(src, w, h, PADn);
      const pp = pipe(psrc, pw, ph, `p${PADn}`);
      const cx = PADn*SCALE, cy = PADn*SCALE;
      const cropCol = cropRgba(pp.col, pp.W4, pp.H4, cx, cy, ow, oh);
      const cropM   = cropRgba(pp.m,   pp.W4, pp.H4, cx, cy, ow, oh);
      emit(combineSmooth(cropCol,cropM,ow,oh), ow, oh, `pad${PADn}`, `pad ${PADn}px`, true);
    }
    rows.push({ label, variants });
    console.log('done', rel);
  } finally { rmSync(work,{recursive:true,force:true}); }
}

const cols = ['original','current AI (pad 0)', ...PADS.map(p=>`pad ${p}px`)];
const html = `<!doctype html><meta charset=utf8><title>Fish outline fix</title>
<style>
  body{margin:0;background:#151515;color:#ddd;font:13px system-ui,sans-serif}
  header{position:sticky;top:0;background:#1c1c1c;padding:10px 14px;border-bottom:1px solid #333;z-index:5;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  h1{font-size:15px;margin:0;font-weight:600}
  .z{display:flex;gap:8px;align-items:center}
  table{border-collapse:collapse;margin:8px}
  th,td{padding:6px;text-align:center;border:1px solid #262626;vertical-align:top}
  th{position:sticky;top:47px;background:#1c1c1c}
  th.rowlab,td.rowlab{position:sticky;left:0;background:#1c1c1c;text-align:left;font-weight:600;min-width:80px}
  img{display:block;image-rendering:auto;background:#2b2b2b}
  .cap{color:#888;font-size:11px;margin-top:3px}
  .hi{color:#7fd}
</style>
<header>
  <h1>Fish outline fix — padding trick test</h1>
  <div class=z><label>zoom</label><input id=z type=range min=1 max=6 step=0.5 value=3><span id=zl>3×</span></div>
  <div style="color:#8bd">Fish touch the frame edge → upscaler boundary artifacts. Each <b>pad Npx</b> = add an N-px transparent ring, upscale, crop back. Bigger ring = more context. Compare rims.</div>
</header>
<table>
<thead><tr><th class=rowlab>frame</th>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
<tbody>
${rows.map(r=>`<tr><td class=rowlab>${r.label}</td>${r.variants.map(([cap,src,hi])=>`<td><img data-s src="${src}"><div class="cap${hi?' hi':''}">${cap}</div></td>`).join('')}</tr>`).join('\n')}
</tbody></table>
<script>
  const z=document.getElementById('z'), zl=document.getElementById('zl');
  const imgs=[...document.querySelectorAll('img[data-s]')];
  function apply(){ const s=+z.value; zl.textContent=s+'×';
    imgs.forEach(im=>{ if(!im.naturalWidth) { im.onload=apply; return; } im.style.width=(im.naturalWidth*s/4)+'px'; }); }
  z.addEventListener('input',apply); window.addEventListener('load',apply); apply();
</script>`;
writeFileSync(join(OUT,'index.html'), html);
console.log('\nWrote', join(OUT,'index.html'));
