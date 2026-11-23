// Metal ports of the AI-tier GLSL in src/render/glRoomAi.ts (GlAiScreen). Each fragment
// function names the GLSL program it ports; the arithmetic is kept line-for-line so the
// two backends can be compared pixel for pixel (native/compare.mjs).
//
// Conventions: every render target and texture is TOP-DOWN (row 0 = top), which is
// Metal's native orientation, so `pos.y` IS the top-down row — the same thing
// GlAiScreen arranges for `gl_FragCoord.y` (glRoomAi.ts header). `tex.read(uint2)` is
// GLSL's `texelFetch`.
#include <metal_stdlib>
using namespace metal;

struct VSOut { float4 pos [[position]]; };

// A rect in TARGET PIXELS (x0, y0, x1, y1), top-down. GlCommon's RECT_VS takes the
// rect in NDC instead; this maps pixels to NDC itself, flipping y because Metal's NDC
// +1 is the TOP row.
struct RectU { float4 rect; float2 size; float2 _pad; };

vertex VSOut vs_rect(uint vid [[vertex_id]], constant RectU& u [[buffer(0)]]) {
  float2 c = float2(vid & 1, vid >> 1);            // triangle strip: (0,0) (1,0) (0,1) (1,1)
  float2 p = mix(u.rect.xy, u.rect.zw, c);
  VSOut o;
  o.pos = float4(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0);
  return o;
}

// QUAD_VS: one oversized triangle covering the viewport.
vertex VSOut vs_full(uint vid [[vertex_id]]) {
  float2 p = float2((vid == 1) ? 3.0 : -1.0, (vid == 2) ? 3.0 : -1.0);
  VSOut o;
  o.pos = float4(p, 0.0, 1.0);
  return o;
}

// FILL_FS
struct FillU { float4 color; };
fragment float4 fs_fill(VSOut in [[stage_in]], constant FillU& u [[buffer(0)]]) {
  return float4(u.color.rgb, 1.0);
}

// BG_FS — wall over the water-wobbled background; with `zx` set, the gspec=42 ZX
// composite (GlAiScreen.backgroundZx goes through the same program the same way).
// `sin`/`exp` are Metal's DEFAULT (fast-math) variants on purpose: that is what ANGLE's
// GLSL→MSL translation emits, so it is what the browser runs on Apple GPUs. With
// `precise::` the composite drifted by 1/255 on a few dozen pixels (SCHODY after 240
// ticks); with the default it is byte-identical (native/compare.mjs).
#define RIPPLE_GPU_SLOTS 3
struct BgU {
  int scale; int bgW; int wobble; int ripN;
  float amp; float per; float phase; int zx;
  float4 rip[RIPPLE_GPU_SLOTS];
  float4 ripPh;                                   // .xyz = uRipPh[0..2]
};
fragment float4 fs_bg(VSOut in [[stage_in]],
                      texture2d<float> uBg [[texture(0)]], texture2d<float> uWall [[texture(1)]],
                      texture2d<float> uBands [[texture(2)]], constant BgU& u [[buffer(0)]]) {
  int x = int(in.pos.x);
  int y = int(in.pos.y);
  float3 bg;
  if (u.wobble == 1) {
    float row = (float(y) + 0.5) / float(u.scale) - 0.5;
    float sh = u.amp * sin(row / u.per + u.phase);
    for (int i = 0; i < RIPPLE_GPU_SLOTS; i++) {
      if (i >= u.ripN) break;
      float e = (row - u.rip[i].x) / u.rip[i].y;
      sh += u.rip[i].z * exp(-0.5 * e * e) * sin(row * u.rip[i].w + u.ripPh[i]);
    }
    sh *= float(u.scale);
    float f = floor(sh);
    int s0 = clamp(x + int(f), 0, u.bgW - 1);
    int s1 = clamp(x + int(f) + 1, 0, u.bgW - 1);
    bg = mix(uBg.read(uint2(s0, y)).rgb, uBg.read(uint2(s1, y)).rgb, sh - f);
  } else {
    bg = uBg.read(uint2(x, y)).rgb;
  }
  float4 w = uWall.read(uint2(x, y));
  // gspec=42: the wall keeps its SHAPE and takes the loading-stripe colour of its NATIVE
  // row (y / scale); the blend is unchanged. `uBands` is one texel per native row.
  float3 wrgb = (u.zx == 1) ? uBands.read(uint2(y / u.scale, 0)).rgb : w.rgb;
  return float4(wrgb * w.a + bg * (1.0 - w.a), 1.0);
}

// SPRITE_FS — straight-RGBA sprite; uMirror flips within [uX, uX+uW-1] (KresliRev).
struct SpriteU { int x; int y; int w; int mirror; };
fragment float4 fs_sprite(VSOut in [[stage_in]], texture2d<float> uSprite [[texture(0)]],
                          constant SpriteU& u [[buffer(0)]]) {
  int fx = int(in.pos.x);
  int fy = int(in.pos.y);
  int j = (u.mirror == 1) ? (u.x + u.w - 1 - fx) : (fx - u.x);
  return uSprite.read(uint2(j, fy - u.y));
}

// DISINT_FS — KresliK's dithered dissolve on the ORIGINAL pixel grid.
struct DisintU { int x; int y; int scale; int nativeW; int rozpad; int _p0; int _p1; int _p2; };
fragment float4 fs_disint(VSOut in [[stage_in]], texture2d<float> uSprite [[texture(0)]],
                          texture2d<uint> uRand [[texture(1)]], constant DisintU& u [[buffer(0)]]) {
  int col = int(in.pos.x) - u.x;
  int row = int(in.pos.y) - u.y;
  int p = ((((row / u.scale) * u.nativeW) & 255) + col / u.scale) & 255;
  if (int(uRand.read(uint2(p, 0)).r) >= u.rozpad) discard_fragment();
  return uSprite.read(uint2(col, row));
}

// MIRROR_FS — KresliZrcadlo's reflection under the mirror's glass. `uSrc` is the
// composite as it was before this pass (see n_mirror in main.c).
struct MirrorU { int rx0; int rx1; int ry0; int ry1; int dx0; int dx1; int k; int mx; int my; int mw; int mh; int _p; };
fragment float4 fs_mirror(VSOut in [[stage_in]], texture2d<float> uSrc [[texture(0)]],
                          texture2d<float> uMask [[texture(1)]], constant MirrorU& u [[buffer(0)]]) {
  int D = int(in.pos.x);
  int sy = int(in.pos.y);
  float4 col = uSrc.read(uint2(D, sy));
  int my = sy - u.my;
  int mx = D - u.mx;
  if (sy >= u.ry0 && sy < u.ry1 && D >= u.dx0 && D < u.dx1 &&
      my >= 0 && my < u.mh && mx >= 0 && mx < u.mw) {
    float g = uMask.read(uint2(mx, my)).r;
    int sX = u.k - D;
    if (g > 0.0 && sX >= u.rx0 && sX < u.rx1) {
      float4 src = uSrc.read(uint2(sX, sy));
      col = float4(g >= 1.0 ? src.rgb : src.rgb * g + col.rgb * (1.0 - g), 1.0);
    }
  }
  return col;
}

// PRESENT_FS — box-downsample the ×S composite into the window. `origin` is the
// letterboxed viewport's top-left in drawable pixels ([[position]] is target-relative).
struct PresentU { float2 size; float2 origin; float2 footprint; int taps; int _p; };
fragment float4 fs_present(VSOut in [[stage_in]], texture2d<float> uTex [[texture(0)]],
                           sampler smp [[sampler(0)]], constant PresentU& u [[buffer(0)]]) {
  float2 uv = (in.pos.xy - u.origin) / u.size;
  float n = float(u.taps);
  float3 acc = float3(0.0);
  for (int j = 0; j < u.taps; j++) {
    for (int i = 0; i < u.taps; i++) {
      float2 o = (float2(float(i), float(j)) + 0.5) / n - 0.5;
      acc += uTex.sample(smp, uv + o * u.footprint).rgb;
    }
  }
  return float4(acc / (n * n), 1.0);
}

// SURFACE — Surface2D's one quad (src/render/surface2d.ts; flush_surf in main.c). Vertices
// carry the dest corner in target pixels, the source texel coordinate (normalised), and a
// premultiplied colour the premultiplied texel is multiplied by. Nearest or bilinear is
// the sampler's business; the blend is the pipeline's.
struct SurfIn { float2 pos [[attribute(0)]]; float2 uv [[attribute(1)]]; float4 col [[attribute(2)]]; };
struct SurfOut { float4 pos [[position]]; float2 uv; float4 col; };
struct SurfU { float2 size; float2 _pad; };

vertex SurfOut vs_surf(SurfIn in [[stage_in]], constant SurfU& u [[buffer(0)]]) {
  SurfOut o;
  o.pos = float4(in.pos.x / u.size.x * 2.0 - 1.0, 1.0 - in.pos.y / u.size.y * 2.0, 0.0, 1.0);
  o.uv = in.uv;
  o.col = in.col;
  return o;
}

fragment float4 fs_surf(SurfOut in [[stage_in]], texture2d<float> uTex [[texture(0)]], sampler smp [[sampler(0)]]) {
  return uTex.sample(smp, in.uv) * in.col;
}
