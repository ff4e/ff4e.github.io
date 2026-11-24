/*
 * Movies natively (the intro and the ALTAR logo): the JS bindings over the platform decoder
 * (movie.h) and the movie track beside the mixer (audio.h). native/js/movie.ts is the other
 * side; native/README.md ("Movies") says what each part must match.
 *
 * The player's one rule is the browser's: the picture follows the sound. The audio track is
 * the clock (`movieClock`), and `movieFrame(t)` shows the last frame whose presentation time
 * is not after `t` — decoding forward to it, uploading only that one when several are due at
 * once, and never going back. Nothing here waits for the wall clock: a frame is chosen on
 * every display refresh, so the pacing is the display's.
 */
#include <SDL3/SDL.h>
#include <quickjs.h>

#include "audio.h"
#include "movie.h"

int host_texture_new(int w, int h, bool bgra);
bool host_texture_upload(int id, const void *px, size_t stride);
void host_texture_release(int id);
const char *host_root(void);
void host_note_read(const char *rel);

typedef struct {
  MovieDecoder *dec;
  MovieInfo info;
  char path[2048];
  int tex;
  MovieFrame *next; /* decoded, not yet due */
  double next_pts;
  bool done;        /* no frame after `next` */
  double shown_pts; /* the frame in `tex`; -1 before the first */
  bool audio;       /* this movie owns the movie track */
} Movie;

#define MAX_MOVIES 8
static Movie *movies[MAX_MOVIES + 1]; /* id -> movie; slot 0 unused */
static double advance_acc;            /* headless: the fraction of a frame not yet advanced */

#define ARGI(i) ({ int32_t v_ = 0; JS_ToInt32(ctx, &v_, argv[i]); v_; })
#define ARGF(i) ({ double v_ = 0; JS_ToFloat64(ctx, &v_, argv[i]); v_; })

static Movie *movie_by_id(JSContext *ctx, JSValueConst v) {
  int32_t id = 0;
  JS_ToInt32(ctx, &id, v);
  return id >= 1 && id <= MAX_MOVIES ? movies[id] : NULL;
}

/* `/data/Movie/x.mp4` -> the file under the asset root, as readFile resolves it. */
static bool resolve(JSContext *ctx, JSValueConst v, char *out, size_t n) {
  const char *rel = JS_ToCString(ctx, v);
  if (!rel) return false;
  SDL_snprintf(out, n, "%s/%s", host_root(), rel[0] == '/' ? rel + 1 : rel);
  if (SDL_GetPathInfo(out, NULL)) host_note_read(rel);
  JS_FreeCString(ctx, rel);
  return true;
}

/* movieOpen(path, start = 0) -> { id, width, height, duration, frameRate }; throws on failure. */
static JSValue n_movieOpen(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  int id = 0;
  for (int i = 1; i <= MAX_MOVIES && !id; i++)
    if (!movies[i]) id = i;
  if (!id) return JS_ThrowRangeError(ctx, "movieOpen: %d movies are open already", MAX_MOVIES);
  Movie *m = SDL_calloc(1, sizeof *m);
  if (!m) return JS_ThrowOutOfMemory(ctx);
  if (!resolve(ctx, argv[0], m->path, sizeof m->path)) {
    SDL_free(m);
    return JS_EXCEPTION;
  }
  double start = argc > 1 ? ARGF(1) : 0;
  char err[512];
  m->dec = movie_open(m->path, start, &m->info, err, sizeof err);
  if (!m->dec) {
    JSValue e = JS_ThrowInternalError(ctx, "%s: %s", m->path, err);
    SDL_free(m);
    return e;
  }
  m->shown_pts = -1;
  movies[id] = m;
  JSValue o = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, o, "id", JS_NewInt32(ctx, id));
  JS_SetPropertyStr(ctx, o, "width", JS_NewInt32(ctx, m->info.width));
  JS_SetPropertyStr(ctx, o, "height", JS_NewInt32(ctx, m->info.height));
  JS_SetPropertyStr(ctx, o, "duration", JS_NewFloat64(ctx, m->info.duration));
  JS_SetPropertyStr(ctx, o, "frameRate", JS_NewFloat64(ctx, m->info.frame_rate));
  return o;
}

/*
 * movieFrame(id, t) -> [texture, pts, last]: the frame shown at `t` seconds — the last one
 * whose time is not after `t` — in `texture` (0 while none is due yet), its time, and whether
 * it is the movie's last.
 */
static JSValue n_movieFrame(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  Movie *m = movie_by_id(ctx, argv[0]);
  if (!m) return JS_ThrowReferenceError(ctx, "movieFrame: no such movie");
  double t = ARGF(1);
  MovieFrame *due = NULL;
  double due_pts = 0;
  for (;;) {
    if (!m->next && !m->done) {
      m->next = movie_next_frame(m->dec, &m->next_pts);
      if (!m->next) m->done = true;
    }
    if (!m->next || m->next_pts > t) break;
    movie_frame_release(due); /* overtaken before it was shown: never uploaded */
    due = m->next;
    due_pts = m->next_pts;
    m->next = NULL;
  }
  if (due) {
    size_t stride = 0;
    const uint8_t *px = movie_frame_pixels(due, &stride);
    if (!m->tex) m->tex = host_texture_new(m->info.width, m->info.height, true);
    bool ok = px && stride >= (size_t)m->info.width * 4 && host_texture_upload(m->tex, px, stride);
    movie_frame_release(due);
    if (!ok) return JS_ThrowInternalError(ctx, "movieFrame: cannot upload the frame at %.3f s", due_pts);
    m->shown_pts = due_pts;
  }
  JSValue r = JS_NewArray(ctx);
  JS_SetPropertyUint32(ctx, r, 0, JS_NewInt32(ctx, m->shown_pts >= 0 ? m->tex : 0));
  JS_SetPropertyUint32(ctx, r, 1, JS_NewFloat64(ctx, m->shown_pts));
  JS_SetPropertyUint32(ctx, r, 2, JS_NewBool(ctx, m->done && !m->next && m->shown_pts >= 0));
  return r;
}

/* moviePlay(id) -> whether it has sound: decode its audio track and start it, as the clock, now. */
static JSValue n_moviePlay(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  Movie *m = movie_by_id(ctx, argv[0]);
  if (!m) return JS_ThrowReferenceError(ctx, "moviePlay: no such movie");
  for (int i = 1; i <= MAX_MOVIES; i++)
    if (movies[i]) movies[i]->audio = false;
  float *pcm = NULL;
  int64_t frames = 0;
  int ch = 0, rate = 0;
  char err[512];
  if (!movie_decode_audio(m->path, &pcm, &frames, &ch, &rate, err, sizeof err)) {
    audio_movie_stop();
    if (err[0]) return JS_ThrowInternalError(ctx, "%s: %s", m->path, err);
    return JS_FALSE;
  }
  advance_acc = 0;
  if (!audio_movie_play(pcm, frames, ch, rate, err, sizeof err)) return JS_ThrowInternalError(ctx, "%s", err);
  m->audio = true;
  return JS_TRUE;
}

/* movieClock() -> seconds into the playing movie's sound (the A/V clock), or null with none. */
static JSValue n_movieClock(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  double p = audio_movie_position();
  return p < 0 ? JS_NULL : JS_NewFloat64(ctx, p);
}

/*
 * movieAdvance(ms, capture) -> the frames played, interleaved float32, when `capture`.
 * Headless only: the movie track's clock moves by this alone, as the mixer's moves by
 * audioAdvance. Throws when an output drives it or none is playing.
 */
static JSValue n_movieAdvance(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  double ms = ARGF(0);
  bool capture = argc > 1 && JS_ToBool(ctx, argv[1]);
  int ch = 0;
  int rate = audio_movie_rate(&ch);
  if (!rate) return JS_ThrowInternalError(ctx, "movieAdvance: no movie sound is playing");
  advance_acc += ms * rate / 1000.0;
  int64_t n = (int64_t)advance_acc;
  advance_acc -= (double)n;
  float *cap = NULL;
  if (!audio_movie_advance(n, capture ? &cap : NULL)) return JS_ThrowInternalError(ctx, "movieAdvance: the movie track is driven by an output");
  if (!capture) return JS_UNDEFINED;
  JSValue r = JS_NewArrayBufferCopy(ctx, (const uint8_t *)cap, (size_t)(n * ch) * sizeof(float));
  SDL_free(cap);
  return r;
}

/* movieAudioPcm(path) -> [interleaved float32, channels, rate] | null: the decode alone, for the gate. */
static JSValue n_movieAudioPcm(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  char path[2048];
  if (!resolve(ctx, argv[0], path, sizeof path)) return JS_EXCEPTION;
  float *pcm = NULL;
  int64_t frames = 0;
  int ch = 0, rate = 0;
  char err[512];
  if (!movie_decode_audio(path, &pcm, &frames, &ch, &rate, err, sizeof err)) {
    if (err[0]) return JS_ThrowInternalError(ctx, "%s: %s", path, err);
    return JS_NULL;
  }
  JSValue r = JS_NewArray(ctx);
  JS_SetPropertyUint32(ctx, r, 0, JS_NewArrayBufferCopy(ctx, (const uint8_t *)pcm, (size_t)(frames * ch) * sizeof(float)));
  JS_SetPropertyUint32(ctx, r, 1, JS_NewInt32(ctx, ch));
  JS_SetPropertyUint32(ctx, r, 2, JS_NewInt32(ctx, rate));
  SDL_free(pcm);
  return r;
}

/* movieClose(id): its decoder, its texture, and its sound if it is the one playing. */
static JSValue n_movieClose(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  int32_t id = ARGI(0);
  Movie *m = id >= 1 && id <= MAX_MOVIES ? movies[id] : NULL;
  if (!m) return JS_UNDEFINED;
  if (m->audio) audio_movie_stop();
  movie_frame_release(m->next);
  movie_close(m->dec);
  if (m->tex) host_texture_release(m->tex);
  SDL_free(m);
  movies[id] = NULL;
  return JS_UNDEFINED;
}

void install_movie(JSContext *ctx, JSValue native) {
  static const struct { const char *name; JSCFunction *fn; int len; } fns[] = {
      {"movieOpen", n_movieOpen, 2},   {"movieFrame", n_movieFrame, 2},
      {"moviePlay", n_moviePlay, 1},   {"movieClock", n_movieClock, 0},
      {"movieAdvance", n_movieAdvance, 2}, {"movieAudioPcm", n_movieAudioPcm, 1},
      {"movieClose", n_movieClose, 1},
  };
  for (size_t i = 0; i < sizeof fns / sizeof fns[0]; i++)
    JS_SetPropertyStr(ctx, native, fns[i].name, JS_NewCFunction(ctx, fns[i].fn, fns[i].name, fns[i].len));
}
