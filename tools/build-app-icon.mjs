// Build the iOS app icon and launch image from a vector reconstruction of the game's
// title emblem, and write them straight into the Xcode asset catalog.
//
// Outputs (all committed, so a normal build needs neither Playwright nor this script):
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024x1024, opaque
//   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png    2732x2732, opaque
//
// ── Why a reconstruction rather than an image ─────────────────────────────────
// The emblem exists in this repo only as artwork: `public/cover.webp` carries it inside a
// 2200x528 title splash, over near-black underwater photography, in dark blue line art —
// which is why `tools/build-share-assets.py` has to mask it out by blueness to get a
// favicon. None of that survives being blown up to 1024. The mark is six primitives, so it
// is cheaper and far cleaner to state them.
//
// The proportions are measured, not guessed. They come off a 69x75 capture of the emblem,
// read as a luminance map and then as ink-run profiles down 8 columns; every number below
// is in that capture's pixels, with the ring's centre at (34, 37.5):
//
//     ring        outer 32.9, inner 26.6     -> mid radius 29.75, stroke 6.3
//     body        nose (9.6, 37.5) .. joint (45, 37.5), stroke 4.5, half-height 12.5 at
//                 its widest (x 26), 9 at x 38, 3 at x 44 -- so it tapers away inside the
//                 tail rather than ending on a blunt cap, and is drawn to a point in front
//     tail        apex (46.5, 37.5), right edge x 56 from y 26.5 to 48.5, stroke 4.5
//     eye         centre (18, 36), radius 2.6
//
// The strokes are a shade under the capture's: at 69px every line bleeds a little, and
// carrying that bleed up to 1024 makes the mark look heavier than the original ever was.
//
// The body's two curves are a least-squares fit of one cubic to the capture's measured
// half-heights at x = 14, 20, 26, 32, 38 and 44 (rms 0.05px), which is what gives the mark
// its particular silhouette: the bulge sits well back, not in the middle.
//
// ── What this is, legally ─────────────────────────────────────────────────────
// This is ALTAR's mark for the game, re-drawn. The game data was released by ALTAR under
// the GPL in 2002 and the FFNG data package carries the artwork under GPLv2 with no logo
// exception, so copying it is licensed. Trademark is a separate question that the GPL does
// not answer, and Apple's Guideline 4.1(c) is a brand rule rather than a licence one — see
// `NAMING_RESEARCH.md` in the task hub. Martin decided on 2026-09-06 to ship the emblem
// with that risk accepted. Consequence to keep: the App Store description has to carry the
// ALTAR credit, the GPL line and a source URL, the same way the boot splash already does.
//
// Requires the repo's Playwright (a dev dependency already, for the UI suite).
// Usage: `node tools/build-app-icon.mjs`
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CATALOG = join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');
const ICON = join(CATALOG, 'AppIcon.appiconset', 'AppIcon-512@2x.png');
const SPLASH = join(CATALOG, 'Splash.imageset');

// The mark's colour ramp, light to dark. Gold, sampled off the emblem capture: brightest at
// the top of the ring (#fff37e), through #ffd119 on the flanks, to #e6a408 underneath.
//
// The title art in `public/cover.webp` is blue rather than gold, and a cyan ramp drawn from
// it was tried and rejected. Two reasons it does not carry: the art's own emblem sampled at
// #000049..#021c6c with only its rim catching light, so anything legible on a dark icon has
// to be invented rather than taken; and against the launch screen -- which *is* that art --
// gold is what tells the two apart on the home screen.
const MARK = ['#fff6a4', '#ffd119', '#dd9a04'];

// ── The emblem, in the capture's pixel space ──────────────────────────────────

const C = { x: 34, y: 37.5 }; // ring centre
const D = 66; // ring outer diameter, the unit everything else is expressed against
const RING_R = 29.75;
const RING_W = 5.9;
const LINE_W = 4.5; // body and tail

// The whole mark is drawn larger than the capture's proportions would give it, because at
// icon sizes the original leaves more air around itself than it needs. Only the geometry
// grows: stroke widths are held at the absolute pixel weight they had at GROW = 1, so the
// lines stay exactly as heavy while the ring and the fish inside it get bigger. In the
// capture's own units that means the strokes get proportionally thinner, which is what
// `ringW` / `lineW` below express and what everything derived from them has to follow.
const GROW = 1.05;
const ringW = RING_W / GROW;
const lineW = LINE_W / GROW;

// 0.05 inside the ring's inner edge, so nose and ring fuse the way they do in the original.
// This has to be derived rather than fixed: thinning the strokes moves the ring's inner edge
// outwards and the nose's cap inwards, and a stale constant would leave a gap between them.
const NOSE_X = C.x - RING_R + ringW / 2 + lineW / 2 - 0.05;
const JOINT_X = 45.03; // inside the tail, so the body tapers into it instead of stopping blunt
const TAIL_APEX = 46.5; // right of the joint, so the mitred point lands back on it
const TAIL_X = 56;
const TAIL_H = 11; // half-height of the tail's trailing edge
const EYE = { x: 18, y: 36, r: 2.6 };

// The fitted body curve, as offsets from the centreline. c1 sits right by the joint, which
// is what makes the rear taper; c2 sits just behind the nose, which draws the front to a point.
const c1 = { x: 43.03, d: 12.74 };
const c2 = { x: 12.67, d: 20.35 };

/**
 * Gap between the tail's trailing corner and the inside of the ring, in capture pixels.
 * The corner is a bevel (see the miterlimit note below), so its two vertices are the ends
 * of the half-width offsets of the two edges that meet there; whichever reaches further
 * from the centre is the one that will touch the ring first. Negative means they collide.
 * At the capture's own proportions this is barely positive -- the tail all but touches the
 * ring -- so it is worth watching whenever any of the widths above move.
 */
function tailClearance() {
  const K = { x: TAIL_X, y: C.y - TAIL_H };
  const d = { x: K.x - TAIL_APEX, y: K.y - C.y };
  const len = Math.hypot(d.x, d.y);
  const h = lineW / 2;
  // outward normal of the leading edge, and of the vertical trailing edge
  const corners = [
    { x: K.x + (h * d.y) / len, y: K.y - (h * d.x) / len },
    { x: K.x + h, y: K.y },
  ];
  const reach = Math.max(...corners.map((p) => Math.hypot(p.x - C.x, p.y - C.y)));
  return RING_R - ringW / 2 - reach;
}

/**
 * The emblem as SVG markup, centred on (cx, cy). `size` is the pixel weight the strokes are
 * drawn at -- the ring is `size * GROW` across, not `size`.
 */
function emblem(size, cx, cy) {
  const k = (size * GROW) / D; // geometry
  const kw = size / D; // stroke widths, deliberately not grown
  const at = (v) => (v * k).toFixed(2);
  const w = (v) => (v * kw).toFixed(2);
  const px = (x) => (cx + (x - C.x) * k).toFixed(2);
  const py = (y) => (cy + (y - C.y) * k).toFixed(2);
  const curve = (sign) =>
    `M ${px(JOINT_X)} ${py(C.y)} C ${px(c1.x)} ${py(C.y - sign * c1.d)}, ` +
    `${px(c2.x)} ${py(C.y - sign * c2.d)}, ${px(NOSE_X)} ${py(C.y)}`;
  return `
    <circle cx="${cx}" cy="${cy}" r="${at(RING_R)}" fill="none"
            stroke="url(#mark)" stroke-width="${w(RING_W)}"/>
    <g fill="none" stroke="url(#mark)" stroke-width="${w(LINE_W)}">
      <g stroke-linecap="round">
        <path d="${curve(1)}"/>
        <path d="${curve(-1)}"/>
      </g>
      <!-- Miterlimit 2 is load-bearing: it keeps the apex a point (ratio 1.4) while
           cutting the two trailing corners back to a bevel (ratio 2.9), which is what
           stops them growing spurs into the ring the way the original never does. -->
      <path d="M ${px(TAIL_APEX)} ${py(C.y)} L ${px(TAIL_X)} ${py(C.y - TAIL_H)}
               L ${px(TAIL_X)} ${py(C.y + TAIL_H)} Z"
            stroke-linejoin="miter" stroke-miterlimit="2"/>
    </g>
    <circle cx="${px(EYE.x)}" cy="${py(EYE.y)}" r="${at(EYE.r)}" fill="url(#mark)"/>`;
}

// The ramp is applied across the mark on a diagonal, so the top-left of every stroke catches
// the light and the underside falls away -- the same read the metallic letterforms have.
const DEFS = (seaR, seaY) => `
  <linearGradient id="mark" x1="0.28" y1="0" x2="0.62" y2="1">
    <stop offset="0%" stop-color="${MARK[0]}"/>
    <stop offset="42%" stop-color="${MARK[1]}"/>
    <stop offset="100%" stop-color="${MARK[2]}"/>
  </linearGradient>
  <radialGradient id="sea" cx="50%" cy="${seaY}%" r="${seaR}%">
    <stop offset="0%" stop-color="#0f2138"/>
    <stop offset="60%" stop-color="#081426"/>
    <stop offset="100%" stop-color="#03070f"/>
  </radialGradient>`;

// `seaR` is the reach of the background glow as a percentage of the canvas, `seaY` its
// centre. The glow runs to the corners from above, the way light falls underwater.
const iconDoc = (side, emblemSize, seaR, seaY) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">
     <defs>${DEFS(seaR, seaY)}</defs>
     <rect width="${side}" height="${side}" fill="#03070f"/>
     <rect width="${side}" height="${side}" fill="url(#sea)"/>
     ${emblem(emblemSize, side / 2, side / 2)}
   </svg>`;

// ── The launch image ──────────────────────────────────────────────────────────
// It is not the emblem: it is the screen the game itself puts up first, so that the handover
// from the system launch image to the web view is invisible. That screen is `#intro-cover`
// in index.html -- `public/cover.webp` on black -- so this draws exactly that.
//
// Placing it takes one step of arithmetic, because two different layout systems have to
// agree. The CSS is `background: #000 center 38%/min(88vw, 1100px)`, and a background
// position of 38% is not "centre at 38%": it aligns the image's 38% point with the box's,
// which puts the top at 38% of the leftover height. Meanwhile the storyboard draws this
// square image with `scaleAspectFill`, which on a portrait screen maps the image's full
// height onto the screen's -- so a feature at image y lands at the same fraction of the
// screen, and the horizontal overflow is simply cropped away.
const COVER = readFileSync(join(ROOT, 'public', 'cover.webp'));
const COVER_ASPECT = 2200 / 528;
const REF = { w: 402, h: 874 }; // iPhone 17 Pro, points -- near the narrowest aspect shipped
const coverW = Math.min(0.88 * REF.w, 1100);
const coverH = coverW / COVER_ASPECT;
const pxPerPt = 2732 / REF.h;
const COVER_W = coverW * pxPerPt;
const COVER_CY = (0.38 * (REF.h - coverH) + coverH / 2) * pxPerPt;

const splashDoc = (side) => {
  const w = COVER_W;
  const h = w / COVER_ASPECT;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">
     <rect width="${side}" height="${side}" fill="#000"/>
     <image x="${((side - w) / 2).toFixed(1)}" y="${(COVER_CY - h / 2).toFixed(1)}"
            width="${w.toFixed(1)}" height="${h.toFixed(1)}"
            href="data:image/webp;base64,${COVER.toString('base64')}"/>
   </svg>`;
};

// One file serves every scale: the imageset is single-scale, because three copies of the
// same square would be three copies of the same bytes.
// `mark` is the stroke-weight scale, not the drawn diameter -- see `emblem`. The icon's ring
// ends up 830 * GROW across on a 1024 canvas, which still leaves it a margin all round.
const OUTPUTS = [
  {
    path: ICON,
    side: 1024,
    svg: (side) => iconDoc(side, 830, 78, 34),
  },
  {
    path: join(SPLASH, 'splash-2732x2732.png'),
    side: 2732,
    svg: splashDoc,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
console.log(`emblem ${GROW}x, tail clears the ring by ${tailClearance().toFixed(2)}`);
for (const { path, side, svg } of OUTPUTS) {
  await page.setViewportSize({ width: side, height: side });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:#000}svg{display:block;width:${side}px;height:${side}px}</style>` +
      svg(side),
  );
  // No alpha anywhere: App Store Connect rejects an icon with a transparent channel.
  writeFileSync(path, await page.screenshot({ omitBackground: false, type: 'png' }));
  console.log(`wrote ${relative(ROOT, path)} (${side}x${side})`);
}
await browser.close();
