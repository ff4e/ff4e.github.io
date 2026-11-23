/*
 * Subtitle glyphs for the native host: FreeType reads the game's subtitle faces
 * (public/fonts, public/enhanced/subtitle.ttf) and rasterises one glyph at a time into
 * coverage masks. Everything about WHERE a glyph goes — the line's size, its centring,
 * the wave, the colours — is decided in JS (native/js/subtitleLayout.ts); this file only
 * answers "how wide is this character" and "what does it cover".
 *
 * Approximate by nature, and measured as such (native/compare-subs.mjs): the browser
 * shapes and rasterises its subtitle text with the platform's own scaler (CoreText on a
 * Mac), this host with FreeType, so the same outline lands on slightly different pixels.
 *
 *   fontLoad(bytes, weight)            -> font id. A variable face is set to `weight` on
 *                                         its `wght` axis; a static one is drawn as it is.
 *   fontAdvances(id, codepoints)       -> each code point's advance, in em (unhinted)
 *   fontMetrics(id)                    -> [ascent, descent, lineGap] in em (hhea)
 *   fontGlyph(id, cp, px, r, fx, fy)   -> { x, y, w, h, fill, stroke }: the glyph at `px`
 *     pixels per em with its pen at (fx, fy) inside a pixel, as two w×h coverage masks
 *     (one byte per pixel, top row first) placed at (x, y) from the pen's pixel, y down.
 *     `fill` is the glyph; `stroke` is the glyph together with a stroke of radius `r`
 *     centred on its outline — what -webkit-text-stroke paints under the subtitle fill.
 */
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_GLYPH_H
#include FT_MULTIPLE_MASTERS_H
#include FT_OUTLINE_H
#include FT_STROKER_H
#include <SDL3/SDL.h>
#include <quickjs.h>
#include <math.h>
#include <string.h>

#define MAX_FONTS 8

static FT_Library ft;
static FT_Stroker stroker;
static struct { FT_Face face; uint8_t *bytes; int upem; } fonts[MAX_FONTS];
static int font_n;

static FT_Face face_of(JSContext *ctx, JSValueConst v) {
  int32_t id = 0;
  JS_ToInt32(ctx, &id, v);
  return id >= 1 && id <= font_n ? fonts[id - 1].face : NULL;
}

static JSValue n_fontLoad(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  size_t n = 0;
  uint8_t *p = JS_GetArrayBuffer(ctx, &n, argv[0]);
  double weight = 0;
  JS_ToFloat64(ctx, &weight, argv[1]);
  if (!p) return JS_EXCEPTION;
  if (!ft && (FT_Init_FreeType(&ft) || FT_Stroker_New(ft, &stroker))) return JS_ThrowTypeError(ctx, "FreeType init failed");
  if (font_n == MAX_FONTS) return JS_ThrowTypeError(ctx, "fontLoad: too many fonts");
  uint8_t *bytes = SDL_malloc(n); /* FreeType reads the face from this memory for as long as it lives */
  memcpy(bytes, p, n);
  FT_Face face = NULL;
  if (FT_New_Memory_Face(ft, bytes, (FT_Long)n, 0, &face)) {
    SDL_free(bytes);
    return JS_ThrowTypeError(ctx, "fontLoad: not a font FreeType can read");
  }
  FT_MM_Var *mm = NULL;
  if ((face->face_flags & FT_FACE_FLAG_MULTIPLE_MASTERS) && !FT_Get_MM_Var(face, &mm)) {
    FT_Fixed coords[16];
    FT_UInt axes = mm->num_axis < 16 ? mm->num_axis : 16;
    for (FT_UInt i = 0; i < axes; i++) {
      coords[i] = mm->axis[i].def;
      if (mm->axis[i].tag == FT_MAKE_TAG('w', 'g', 'h', 't') && weight > 0) coords[i] = (FT_Fixed)(weight * 65536.0);
    }
    FT_Set_Var_Design_Coordinates(face, axes, coords);
    FT_Done_MM_Var(ft, mm);
  }
  /* One pixel per font unit: outlines come out in exact font units (26.6), and every
     size is a transform of them rather than a rounding of FreeType's 1/64-px char size. */
  FT_Set_Char_Size(face, 0, (FT_F26Dot6)face->units_per_EM << 6, 72, 72);
  fonts[font_n].face = face;
  fonts[font_n].bytes = bytes;
  fonts[font_n].upem = face->units_per_EM;
  return JS_NewInt32(ctx, ++font_n);
}

static JSValue n_fontAdvances(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  FT_Face face = face_of(ctx, argv[0]);
  if (!face) return JS_ThrowTypeError(ctx, "fontAdvances: unknown font");
  int64_t len = 0;
  if (JS_GetLength(ctx, argv[1], &len)) return JS_EXCEPTION;
  JSValue out = JS_NewArray(ctx);
  for (int64_t i = 0; i < len; i++) {
    JSValue cp_v = JS_GetPropertyInt64(ctx, argv[1], i);
    int32_t cp = 0;
    JS_ToInt32(ctx, &cp, cp_v);
    JS_FreeValue(ctx, cp_v);
    double adv = 0;
    /* linearHoriAdvance: the unhinted advance, with the variation's HVAR applied, 16.16 */
    if (!FT_Load_Char(face, (FT_ULong)cp, FT_LOAD_NO_HINTING | FT_LOAD_NO_BITMAP))
      adv = (double)face->glyph->linearHoriAdvance / 65536.0 / face->units_per_EM;
    JS_SetPropertyInt64(ctx, out, i, JS_NewFloat64(ctx, adv));
  }
  return out;
}

/* [ascent, descent, lineGap] in em, from the face's hhea: what a CSS line box is made of. */
static JSValue n_fontMetrics(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  FT_Face face = face_of(ctx, argv[0]);
  if (!face) return JS_ThrowTypeError(ctx, "fontMetrics: unknown font");
  double u = face->units_per_EM;
  const double v[3] = {face->ascender / u, -face->descender / u, (face->height - face->ascender + face->descender) / u};
  JSValue a = JS_NewArray(ctx);
  for (uint32_t i = 0; i < 3; i++) JS_SetPropertyUint32(ctx, a, i, JS_NewFloat64(ctx, v[i]));
  return a;
}

/* Rasterise `o` (already placed so its box starts at 0,0) into a w×h gray mask. */
static uint8_t *render(FT_Outline *o, int w, int h) {
  uint8_t *buf = SDL_calloc((size_t)w * (size_t)h, 1);
  FT_Bitmap bm = {0};
  bm.rows = (unsigned)h;
  bm.width = (unsigned)w;
  bm.pitch = w; /* positive: the first row is the top */
  bm.buffer = buf;
  bm.num_grays = 256;
  bm.pixel_mode = FT_PIXEL_MODE_GRAY;
  FT_Outline_Get_Bitmap(ft, o, &bm);
  return buf;
}

static JSValue n_fontGlyph(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  FT_Face face = face_of(ctx, argv[0]);
  int32_t cp = 0;
  double px = 0, r = 0, fx = 0, fy = 0;
  JS_ToInt32(ctx, &cp, argv[1]);
  JS_ToFloat64(ctx, &px, argv[2]);
  JS_ToFloat64(ctx, &r, argv[3]);
  JS_ToFloat64(ctx, &fx, argv[4]);
  JS_ToFloat64(ctx, &fy, argv[5]);
  if (!face || !(px > 0)) return JS_ThrowTypeError(ctx, "fontGlyph: bad args");
  JSValue o = JS_NewObject(ctx);
  FT_Glyph fill = NULL, ring = NULL;
  if (FT_Load_Char(face, (FT_ULong)cp, FT_LOAD_NO_HINTING | FT_LOAD_NO_BITMAP) ||
      face->glyph->format != FT_GLYPH_FORMAT_OUTLINE || face->glyph->outline.n_contours == 0 ||
      FT_Get_Glyph(face->glyph, &fill)) {
    JS_SetPropertyStr(ctx, o, "w", JS_NewInt32(ctx, 0)); /* a space, or a character the face lacks */
    return o;
  }
  FT_Outline *fo = &((FT_OutlineGlyph)fill)->outline;
  double s = px / face->units_per_EM;
  FT_Matrix m = {(FT_Fixed)lround(s * 65536.0), 0, 0, (FT_Fixed)lround(s * 65536.0)};
  FT_Outline_Transform(fo, &m);
  /* FreeType's y is up; the pen's fraction is measured down. */
  FT_Outline_Translate(fo, (FT_Pos)lround(fx * 64.0), (FT_Pos)lround(-fy * 64.0));
  FT_BBox box;
  FT_Outline_Get_CBox(fo, &box);
  FT_Outline *ro = NULL;
  if (r > 0 && !FT_Glyph_Copy(fill, &ring)) {
    FT_Stroker_Set(stroker, (FT_Fixed)lround(r * 64.0), FT_STROKER_LINECAP_BUTT, FT_STROKER_LINEJOIN_MITER_VARIABLE,
                   4 * 0x10000); /* Skia's default miter limit, which a text stroke uses */
    if (!FT_Glyph_Stroke(&ring, stroker, 1)) {
      ro = &((FT_OutlineGlyph)ring)->outline;
      FT_BBox rb;
      FT_Outline_Get_CBox(ro, &rb);
      if (rb.xMin < box.xMin) box.xMin = rb.xMin;
      if (rb.yMin < box.yMin) box.yMin = rb.yMin;
      if (rb.xMax > box.xMax) box.xMax = rb.xMax;
      if (rb.yMax > box.yMax) box.yMax = rb.yMax;
    }
  }
  int x0 = (int)floor(box.xMin / 64.0), x1 = (int)ceil(box.xMax / 64.0);
  int y0 = (int)floor(box.yMin / 64.0), y1 = (int)ceil(box.yMax / 64.0);
  int w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) {
    JS_SetPropertyStr(ctx, o, "w", JS_NewInt32(ctx, 0));
  } else {
    FT_Outline_Translate(fo, -(FT_Pos)x0 * 64, -(FT_Pos)y0 * 64);
    uint8_t *f = render(fo, w, h);
    uint8_t *k = SDL_malloc((size_t)w * (size_t)h);
    if (ro) {
      FT_Outline_Translate(ro, -(FT_Pos)x0 * 64, -(FT_Pos)y0 * 64);
      uint8_t *st = render(ro, w, h);
      /* The stroke layer is the glyph filled AND stroked in one colour: their union. */
      for (int i = 0; i < w * h; i++) k[i] = (uint8_t)(255 - ((255 - f[i]) * (255 - st[i]) + 127) / 255);
      SDL_free(st);
    } else {
      memcpy(k, f, (size_t)w * (size_t)h);
    }
    JS_SetPropertyStr(ctx, o, "x", JS_NewInt32(ctx, x0));
    JS_SetPropertyStr(ctx, o, "y", JS_NewInt32(ctx, -y1));
    JS_SetPropertyStr(ctx, o, "w", JS_NewInt32(ctx, w));
    JS_SetPropertyStr(ctx, o, "h", JS_NewInt32(ctx, h));
    JS_SetPropertyStr(ctx, o, "fill", JS_NewArrayBufferCopy(ctx, f, (size_t)w * (size_t)h));
    JS_SetPropertyStr(ctx, o, "stroke", JS_NewArrayBufferCopy(ctx, k, (size_t)w * (size_t)h));
    SDL_free(f);
    SDL_free(k);
  }
  if (ring) FT_Done_Glyph(ring);
  FT_Done_Glyph(fill);
  return o;
}

void install_text(JSContext *ctx, JSValue native) {
  JS_SetPropertyStr(ctx, native, "fontLoad", JS_NewCFunction(ctx, n_fontLoad, "fontLoad", 2));
  JS_SetPropertyStr(ctx, native, "fontAdvances", JS_NewCFunction(ctx, n_fontAdvances, "fontAdvances", 2));
  JS_SetPropertyStr(ctx, native, "fontMetrics", JS_NewCFunction(ctx, n_fontMetrics, "fontMetrics", 1));
  JS_SetPropertyStr(ctx, native, "fontGlyph", JS_NewCFunction(ctx, n_fontGlyph, "fontGlyph", 6));
}
