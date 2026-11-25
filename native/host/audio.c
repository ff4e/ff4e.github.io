/*
 * The mixer behind native/js/sdlAudioBackend.ts.
 *
 * Everything the game plays is mono at 22050 Hz (the 1998 effects, the staged speech, the
 * music), so the mixer runs at exactly that rate and does no resampling of its own: a voice
 * advances one sample per output frame, a loop point is a sample index, and the clock is
 * the number of frames mixed. The one conversion — 22050 Hz mono to whatever the output
 * device runs at — is SDL's audio stream (the version CMakeLists.txt pins), on SDL's audio
 * thread. It is deterministic for a given device rate; it is not Chromium's (Web Audio
 * resamples each AudioBufferSourceNode linearly), and nothing the game decides depends on
 * it: the clock and every duration are counted before it, in source samples.
 *
 * What the policy (src/audio/audio.ts) is promised, and how:
 *   - start plays from the next mixed block; gains are plain multipliers (per voice at
 *     start, per bus at any time, then MASTER_GAIN), with no ramps;
 *   - a loop plays [0, loopEnd) once, then [loopStart, loopEnd) for ever;
 *   - stop and the natural end both queue the voice's id, and the JS side delivers onEnded
 *     from the queue (audioEnded) on its next poll — never from inside start or stop;
 *   - the clock (audioClock) is the frames mixed so far. It stops while paused, which
 *     audioBackend.ts allows.
 *
 * Two clocks drive the mixing. With an output (the interactive game) SDL's audio thread
 * pulls blocks as the device consumes them. Without one (`--headless`: the smoke gates and
 * the audio checks) nothing is opened and the game advances the mixer itself, 1764 frames
 * per 80 ms tick (audioAdvance) — so a headless run hears exactly the timeline a player
 * would, tick for tick, at any speed, with no device and no wall clock in it.
 *
 * All mixer state is behind one mutex, held by the audio thread for one block at a time.
 *
 * Keeping the output alive (audio_poll, below): on tvOS the system can take the output away
 * — another app's sound interrupts the audio session, the route changes, media services
 * reset — and SDL 3.4's iOS/tvOS path does not always give it back (native/README.md,
 * "When the sound does not come back"). The mixer does not depend on the SDL stream: its
 * voices and its clock live here. So a dead output is noticed (nothing has asked for sound
 * for STALL_NS) and the streams are simply reopened, with nothing the game hears lost, and
 * while there is no output the clock is driven in real time, silently, as SDL's dummy
 * driver would.
 */
#include "audio.h"

#include <SDL3/SDL.h>
#include <stdarg.h>

#ifdef SDL_PLATFORM_TVOS
void tvos_log_audio(const char *line);                /* platform_tvos.m */
bool tvos_audio_activate(char *err, size_t errlen);
void tvos_audio_describe(char *out, size_t outlen);
#endif

#define MAX_VOICES 256
#define CHUNK 1024
#define NBUS 3

typedef struct {
  float *pcm;
  int64_t frames;
  int refs; /* 1 for the JS object until audioRelease, +1 per voice playing it */
} Buf;

typedef struct {
  Buf *buf;
  uint32_t id; /* 0: the slot is free */
  int64_t pos, loop_start, loop_end;
  float gain;
  int bus;
  bool loop;
} Voice;

static bool want_device;
static const char *mode; /* NULL until audioOpen */
static SDL_Mutex *lock;
static SDL_AudioStream *stream;
static float master = 1.0f;
static float bus_gain[NBUS] = {1, 1, 1};
static bool paused;
static bool suspended; /* the app is in the background (audio_suspend): held, as paused is */
static int64_t clock_frames;
static Voice voices[MAX_VOICES];
static uint32_t next_voice = 1;
static Buf **bufs; /* id - 1 -> buffer; NULL when released */
static int nbufs, capbufs;
static uint32_t *ended;
static int nended, capended;
static float chunk[CHUNK];

/* The output's health (audio_poll). `gen` is each opened stream's userdata: a reopen moves it
   on, and `dead_gen` (audio_test_kill) makes the streams of one generation stop answering. */
static uint32_t gen = 1, dead_gen;
static Uint64 last_feed_ns; /* the device last asked for sound (under `lock`) */
static Uint64 watch_ns;     /* the watchdog counts from here: an open, a reopen, a resume (under `lock`) */
static int64_t fed_frames;  /* frames the device has asked for, ever (under `lock`) */
enum { REQ_NONE, REQ_CHECK, REQ_REOPEN };
static SDL_AtomicInt request_level, session_lost;
static void *request_why; /* SDL_SetAtomicPointer: a static string */
/* The rest is the main thread's (audio_poll). */
#define STALL_NS (750 * SDL_NS_PER_MS)
#define SETTLED_NS (2 * SDL_NS_PER_SECOND)
static bool stalled;
static int attempts, opens = 1, suspends;
static Uint64 last_attempt_ns, stalled_ns, drive_ns;
static double drive_owed;
static float drive_buf[CHUNK];
static void request(int level, const char *why);

static void unref(Buf *b) {
  if (--b->refs > 0) return;
  SDL_free(b->pcm);
  SDL_free(b);
}

static void push_ended(uint32_t id) {
  if (nended == capended) {
    int cap = capended ? capended * 2 : 64;
    uint32_t *grown = SDL_realloc(ended, (size_t)cap * sizeof *ended);
    if (!grown) return; /* an onEnded lost to OOM: bookkeeping only, see audioBackend.ts */
    ended = grown;
    capended = cap;
  }
  ended[nended++] = id;
}

static void end_voice(Voice *v) {
  push_ended(v->id);
  unref(v->buf);
  v->buf = NULL;
  v->id = 0;
}

/* Mix `n` frames into `out`. Called with `lock` held. */
static void mix(float *out, int n) {
  SDL_memset(out, 0, (size_t)n * sizeof *out);
  if (paused || suspended) return;
  for (int k = 0; k < MAX_VOICES; k++) {
    Voice *v = &voices[k];
    if (!v->id) continue;
    const float g = v->gain * bus_gain[v->bus] * master;
    const float *src = v->buf->pcm;
    int64_t pos = v->pos;
    int i = 0;
    if (v->loop) {
      while (i < n) {
        if (pos >= v->loop_end) pos = v->loop_start;
        int64_t run = v->loop_end - pos;
        if (run > n - i) run = n - i;
        for (int64_t j = 0; j < run; j++) out[i++] += src[pos++] * g;
      }
      v->pos = pos;
    } else {
      int64_t run = v->buf->frames - pos;
      if (run > n) run = n;
      for (int64_t j = 0; j < run; j++) out[i++] += src[pos++] * g;
      v->pos = pos;
      if (pos >= v->buf->frames) end_voice(v);
    }
  }
  for (int i = 0; i < n; i++) out[i] = out[i] > 1.0f ? 1.0f : out[i] < -1.0f ? -1.0f : out[i];
  clock_frames += n;
}

static void SDLCALL feed(void *user, SDL_AudioStream *s, int additional, int total) {
  (void)total;
  SDL_LockMutex(lock);
  bool dead = (uint32_t)(uintptr_t)user == dead_gen;
  if (!dead) last_feed_ns = SDL_GetTicksNS();
  SDL_UnlockMutex(lock);
  if (dead) return;
  int frames = additional / (int)sizeof(float);
  while (frames > 0) {
    int k = frames < CHUNK ? frames : CHUNK;
    SDL_LockMutex(lock);
    mix(chunk, k);
    fed_frames += k;
    SDL_UnlockMutex(lock);
    SDL_PutAudioStreamData(s, chunk, k * (int)sizeof(float));
    frames -= k;
  }
}

/* A stream on the default output, of this generation, running. */
static SDL_AudioStream *open_stream(const SDL_AudioSpec *spec, SDL_AudioStreamCallback cb) {
  SDL_AudioStream *s = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, spec, cb, (void *)(uintptr_t)gen);
  if (s) SDL_ResumeAudioStreamDevice(s);
  return s;
}

static const SDL_AudioSpec mix_spec = {SDL_AUDIO_F32, 1, AUDIO_RATE};

/* What the output is, for the log. */
static void log_output(const char *what) {
  SDL_AudioSpec spec = {0};
  int frames = 0;
  SDL_AudioDeviceID id = stream ? SDL_GetAudioStreamDevice(stream) : 0;
  const char *name = id ? SDL_GetAudioDeviceName(id) : NULL;
  if (id) SDL_GetAudioDeviceFormat(id, &spec, &frames);
  audio_log("%s: driver %s, device '%s', %d Hz, %d ch, %d-frame buffer", what, SDL_GetCurrentAudioDriver(),
            name ? name : "?", spec.freq, spec.channels, frames);
}

static bool open_device(void) {
  if (!SDL_InitSubSystem(SDL_INIT_AUDIO)) return false;
  stream = open_stream(&mix_spec, feed);
  if (!stream) {
    SDL_QuitSubSystem(SDL_INIT_AUDIO);
    return false;
  }
  SDL_LockMutex(lock);
  watch_ns = SDL_GetTicksNS();
  SDL_UnlockMutex(lock);
  return true;
}

/* ── The movie's track (audio.h) ─────────────────────────────────────────────────── */

static SDL_AudioStream *mstream; /* on the mixer's output; NULL headless */
static struct {
  float *pcm;
  int64_t frames, pos, fed_before;
  int channels, rate;
  bool on;
  Uint64 request_ns;
} mv;
static float *mchunk;
static int mchunk_cap;

/* Copy `n` frames of the track from its position into `out` (silence past its end), with `lock` held. */
static void movie_pull(float *out, int64_t n) {
  int ch = mv.channels;
  int64_t have = mv.frames - mv.pos;
  if (have < 0) have = 0;
  if (have > n) have = n;
  if (paused || suspended) have = 0;
  if (have) SDL_memcpy(out, mv.pcm + mv.pos * ch, (size_t)(have * ch) * sizeof *out);
  SDL_memset(out + have * ch, 0, (size_t)((n - have) * ch) * sizeof *out);
  if (!paused && !suspended) mv.pos += n; /* the clock runs on past the end: the picture may be longer */
}

static void SDLCALL feed_movie(void *user, SDL_AudioStream *s, int additional, int total) {
  (void)total;
  SDL_LockMutex(lock);
  if (!mv.on || (uint32_t)(uintptr_t)user == dead_gen) {
    SDL_UnlockMutex(lock);
    return;
  }
  int bpf = mv.channels * (int)sizeof(float);
  int n = (additional + bpf - 1) / bpf;
  if (n * mv.channels > mchunk_cap) {
    float *grown = SDL_realloc(mchunk, (size_t)(n * mv.channels) * sizeof *mchunk);
    if (!grown) {
      SDL_UnlockMutex(lock);
      return;
    }
    mchunk = grown;
    mchunk_cap = n * mv.channels;
  }
  mv.fed_before = mv.pos;
  mv.request_ns = SDL_GetTicksNS();
  movie_pull(mchunk, n);
  SDL_UnlockMutex(lock);
  SDL_PutAudioStreamData(s, mchunk, n * bpf);
}

void audio_movie_stop(void) {
  if (mstream) SDL_DestroyAudioStream(mstream); /* closes its device: no callback runs after */
  mstream = NULL;
  SDL_LockMutex(lock);
  SDL_free(mv.pcm);
  SDL_zero(mv);
  SDL_UnlockMutex(lock);
}

bool audio_movie_play(float *pcm, int64_t frames, int channels, int rate, char *err, size_t errlen) {
  audio_movie_stop();
  if (!mode) {
    SDL_free(pcm);
    SDL_snprintf(err, errlen, "the mixer is not open");
    return false;
  }
  SDL_LockMutex(lock);
  mv.pcm = pcm;
  mv.frames = frames;
  mv.channels = channels;
  mv.rate = rate;
  mv.on = true;
  SDL_UnlockMutex(lock);
  if (SDL_strcmp(mode, "manual") == 0) return true;
  /* A logical device of its own on the same output (SDL mixes logical devices): the mixer's
     was opened with SDL_OpenAudioDeviceStream, whose bindings SDL does not let change. */
  const SDL_AudioSpec spec = {SDL_AUDIO_F32, channels, rate};
  mstream = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, feed_movie, (void *)(uintptr_t)gen);
  if (!mstream || !SDL_ResumeAudioStreamDevice(mstream)) {
    SDL_snprintf(err, errlen, "cannot open the movie's audio stream: %s", SDL_GetError());
    audio_movie_stop();
    return false;
  }
  return true;
}

double audio_movie_position(void) {
  SDL_LockMutex(lock);
  double r = -1;
  if (mv.on) {
    if (mstream) {
      double fed = (double)mv.pos / mv.rate;
      r = mv.request_ns ? (double)mv.fed_before / mv.rate + (double)(SDL_GetTicksNS() - mv.request_ns) / 1e9 : 0;
      if (paused || suspended) r = (double)mv.fed_before / mv.rate;
      if (r > fed) r = fed;
    } else {
      r = (double)mv.pos / mv.rate;
    }
  }
  SDL_UnlockMutex(lock);
  return r;
}

int audio_movie_rate(int *channels) {
  SDL_LockMutex(lock);
  int r = mv.on ? mv.rate : 0;
  *channels = mv.channels;
  SDL_UnlockMutex(lock);
  return r;
}

bool audio_movie_advance(int64_t frames, float **capture) {
  if (!mode || SDL_strcmp(mode, "manual") != 0 || frames < 0) return false;
  SDL_LockMutex(lock);
  if (!mv.on) {
    SDL_UnlockMutex(lock);
    return false;
  }
  float *cap = capture ? SDL_malloc((size_t)((frames ? frames : 1) * mv.channels) * sizeof(float)) : NULL;
  if (capture && !cap) {
    SDL_UnlockMutex(lock);
    return false;
  }
  if (cap) movie_pull(cap, frames);
  else if (!paused) mv.pos += frames;
  SDL_UnlockMutex(lock);
  if (capture) *capture = cap;
  return true;
}

/* ── JS bindings ─────────────────────────────────────────────────────────────────── */

static Buf *buf_by_id(JSContext *ctx, JSValueConst v) {
  int32_t id = 0;
  JS_ToInt32(ctx, &id, v);
  return id >= 1 && id <= nbufs ? bufs[id - 1] : NULL;
}

/* Register a buffer and return its id (or 0 on OOM). */
static int add_buf(float *pcm, int64_t frames) {
  Buf *b = SDL_malloc(sizeof *b);
  if (!b) return 0;
  *b = (Buf){pcm, frames, 1};
  for (int i = 0; i < nbufs; i++)
    if (!bufs[i]) {
      bufs[i] = b;
      return i + 1;
    }
  if (nbufs == capbufs) {
    int cap = capbufs ? capbufs * 2 : 256;
    Buf **grown = SDL_realloc(bufs, (size_t)cap * sizeof *bufs);
    if (!grown) {
      SDL_free(b);
      return 0;
    }
    bufs = grown;
    capbufs = cap;
  }
  bufs[nbufs++] = b;
  return nbufs;
}

/* audioOpen(master) -> "device" | "dummy" | "manual": what drives the mixer from now on. */
static JSValue n_audioOpen(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  if (mode) return JS_NewString(ctx, mode);
  double m = 1;
  JS_ToFloat64(ctx, &m, argv[0]);
  master = (float)m;
  if (!want_device) {
    mode = "manual";
  } else if (open_device()) {
    mode = "device";
    log_output("output open");
  } else {
    /* No output to be had: SDL's dummy driver consumes at the device's pace without one, so
       the clock still runs in real time and nothing that waits on a sound waits for ever. */
    SDL_Log("no audio output (%s): using SDL's dummy driver, silently", SDL_GetError());
    SDL_SetHint(SDL_HINT_AUDIO_DRIVER, "dummy");
    if (!open_device()) return JS_ThrowInternalError(ctx, "cannot open audio: %s", SDL_GetError());
    mode = "dummy";
    log_output("output open (silent)");
  }
  return JS_NewString(ctx, mode);
}

/* audioFromPcm16(int16 samples) -> buffer id */
static JSValue n_audioFromPcm16(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  size_t n = 0;
  const int16_t *p = (const int16_t *)JS_GetArrayBuffer(ctx, &n, argv[0]);
  if (!p) return JS_EXCEPTION;
  size_t frames = n / 2;
  float *pcm = SDL_malloc((frames ? frames : 1) * sizeof *pcm);
  if (!pcm) return JS_ThrowOutOfMemory(ctx);
  for (size_t i = 0; i < frames; i++) pcm[i] = p[i] / 32768.0f; /* as the browser's fromPcm16 */
  SDL_LockMutex(lock);
  int id = add_buf(pcm, (int64_t)frames);
  SDL_UnlockMutex(lock);
  if (!id) {
    SDL_free(pcm);
    return JS_ThrowOutOfMemory(ctx);
  }
  return JS_NewInt32(ctx, id);
}

/* audioDecode(bytes, maxFrames) -> [buffer id, frames]; maxFrames > 0 trims to at most that. */
static JSValue n_audioDecode(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  size_t n = 0;
  const uint8_t *p = JS_GetArrayBuffer(ctx, &n, argv[0]);
  if (!p) return JS_EXCEPTION;
  double max = 0;
  JS_ToFloat64(ctx, &max, argv[1]);
  float *pcm = NULL;
  int64_t frames = 0;
  char err[256];
  if (!audio_decode(p, n, &pcm, &frames, err, sizeof err)) return JS_ThrowInternalError(ctx, "audio decode: %s", err);
  if (max > 0 && frames > (int64_t)max) frames = (int64_t)max;
  SDL_LockMutex(lock);
  int id = add_buf(pcm, frames);
  SDL_UnlockMutex(lock);
  if (!id) {
    SDL_free(pcm);
    return JS_ThrowOutOfMemory(ctx);
  }
  JSValue r = JS_NewArray(ctx);
  JS_SetPropertyUint32(ctx, r, 0, JS_NewInt32(ctx, id));
  JS_SetPropertyUint32(ctx, r, 1, JS_NewFloat64(ctx, (double)frames));
  return r;
}

/* audioRelease(buffer id): the JS object is gone; the PCM goes once no voice plays it. */
static JSValue n_audioRelease(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  int32_t id = 0;
  JS_ToInt32(ctx, &id, argv[0]);
  SDL_LockMutex(lock);
  if (id >= 1 && id <= nbufs && bufs[id - 1]) {
    unref(bufs[id - 1]);
    bufs[id - 1] = NULL;
  }
  SDL_UnlockMutex(lock);
  return JS_UNDEFINED;
}

/* audioStart(buffer id, gain, bus, loop, loopStart, loopEnd) -> voice id. Loop points in frames. */
static JSValue n_audioStart(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  double gain = 1, ls = 0, le = 0;
  int32_t bus = 0;
  JS_ToFloat64(ctx, &gain, argv[1]);
  JS_ToInt32(ctx, &bus, argv[2]);
  bool loop = JS_ToBool(ctx, argv[3]);
  JS_ToFloat64(ctx, &ls, argv[4]);
  JS_ToFloat64(ctx, &le, argv[5]);
  if (bus < 0 || bus >= NBUS) return JS_ThrowRangeError(ctx, "audioStart: bad bus %d", bus);
  SDL_LockMutex(lock);
  Buf *b = buf_by_id(ctx, argv[0]);
  if (!b) {
    SDL_UnlockMutex(lock);
    return JS_ThrowReferenceError(ctx, "audioStart: no such buffer");
  }
  uint32_t id = next_voice++;
  if (!next_voice) next_voice = 1;
  Voice *v = NULL;
  for (int k = 0; k < MAX_VOICES && !v; k++)
    if (!voices[k].id) v = &voices[k];
  if (!v || b->frames == 0) {
    /* Nothing to sound: it has ended, and says so the usual way (asynchronously). */
    if (!v) SDL_Log("mixer: all %d voices busy, a sound is dropped", MAX_VOICES);
    push_ended(id);
  } else {
    /* Web Audio's rules for the loop region: loopEnd 0, or past the end, is the end; a
       loopStart not before the end is the start. */
    int64_t end = le > 0 && (int64_t)le <= b->frames ? (int64_t)le : b->frames;
    int64_t start = ls > 0 && (int64_t)ls < end ? (int64_t)ls : 0;
    *v = (Voice){b, id, 0, start, end, (float)gain, bus, loop};
    b->refs++;
  }
  SDL_UnlockMutex(lock);
  return JS_NewFloat64(ctx, id);
}

/* audioStop(voice id): stopping one that has already ended is not an error. */
static JSValue n_audioStop(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  double id = 0;
  JS_ToFloat64(ctx, &id, argv[0]);
  SDL_LockMutex(lock);
  for (int k = 0; k < MAX_VOICES; k++)
    if (voices[k].id && voices[k].id == (uint32_t)id) end_voice(&voices[k]);
  SDL_UnlockMutex(lock);
  return JS_UNDEFINED;
}

static JSValue n_audioBusGain(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  int32_t bus = 0;
  double g = 1;
  JS_ToInt32(ctx, &bus, argv[0]);
  JS_ToFloat64(ctx, &g, argv[1]);
  if (bus < 0 || bus >= NBUS) return JS_ThrowRangeError(ctx, "audioBusGain: bad bus %d", bus);
  SDL_LockMutex(lock);
  bus_gain[bus] = (float)g;
  SDL_UnlockMutex(lock);
  return JS_UNDEFINED;
}

static JSValue n_audioPause(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  SDL_LockMutex(lock);
  paused = JS_ToBool(ctx, argv[0]);
  SDL_UnlockMutex(lock);
  return JS_UNDEFINED;
}

/* audioClock() -> frames mixed so far (22050 per second). */
static JSValue n_audioClock(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  SDL_LockMutex(lock);
  int64_t f = clock_frames;
  SDL_UnlockMutex(lock);
  return JS_NewFloat64(ctx, (double)f);
}

/* audioEnded() -> the ids of the voices that ended (or were stopped) since the last call. */
static JSValue n_audioEnded(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  JSValue r = JS_NewArray(ctx);
  SDL_LockMutex(lock);
  for (int i = 0; i < nended; i++) JS_SetPropertyUint32(ctx, r, (uint32_t)i, JS_NewFloat64(ctx, ended[i]));
  nended = 0;
  SDL_UnlockMutex(lock);
  return r;
}

/* audioVoices() -> how many voices are sounding (for checks and the diagnostics line). */
static JSValue n_audioVoices(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  int n = 0;
  SDL_LockMutex(lock);
  for (int k = 0; k < MAX_VOICES; k++) n += voices[k].id != 0;
  SDL_UnlockMutex(lock);
  return JS_NewInt32(ctx, n);
}

/* audioStatus() -> the output's health, for the checks (audioLifecycleSmoke.ts). */
static JSValue n_audioStatus(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  SDL_LockMutex(lock);
  double fed = (double)fed_frames, clock = (double)clock_frames;
  bool held = suspended, pause = paused;
  SDL_UnlockMutex(lock);
  JSValue r = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, r, "opens", JS_NewInt32(ctx, opens));
  JS_SetPropertyStr(ctx, r, "suspends", JS_NewInt32(ctx, suspends));
  JS_SetPropertyStr(ctx, r, "suspended", JS_NewBool(ctx, held));
  JS_SetPropertyStr(ctx, r, "paused", JS_NewBool(ctx, pause));
  JS_SetPropertyStr(ctx, r, "stalled", JS_NewBool(ctx, stalled));
  JS_SetPropertyStr(ctx, r, "output", JS_NewBool(ctx, stream != NULL));
  JS_SetPropertyStr(ctx, r, "movieOutput", JS_NewBool(ctx, mstream != NULL));
  JS_SetPropertyStr(ctx, r, "fed", JS_NewFloat64(ctx, fed));
  JS_SetPropertyStr(ctx, r, "clock", JS_NewFloat64(ctx, clock));
  return r;
}

/*
 * audioAdvance(frames, capture) -> the mixed frames as float32 when `capture`: the manual
 * clock's whole drive (the headless runs). Refused when a device drives the mixer.
 */
static JSValue n_audioAdvance(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  if (!mode || SDL_strcmp(mode, "manual") != 0) return JS_ThrowInternalError(ctx, "audioAdvance: the mixer is %s", mode ? mode : "not open");
  double f = 0;
  JS_ToFloat64(ctx, &f, argv[0]);
  bool capture = argc > 1 && JS_ToBool(ctx, argv[1]);
  int64_t frames = (int64_t)f;
  float *cap = capture ? SDL_malloc((size_t)(frames > 0 ? frames : 1) * sizeof(float)) : NULL;
  if (capture && !cap) return JS_ThrowOutOfMemory(ctx);
  SDL_LockMutex(lock);
  for (int64_t done = 0; done < frames;) {
    int k = frames - done < CHUNK ? (int)(frames - done) : CHUNK;
    mix(cap ? cap + done : chunk, k);
    done += k;
  }
  SDL_UnlockMutex(lock);
  if (!capture) return JS_UNDEFINED;
  JSValue r = JS_NewArrayBufferCopy(ctx, (const uint8_t *)cap, (size_t)frames * sizeof(float));
  SDL_free(cap);
  return r;
}

void audio_install(JSContext *ctx, JSValue native, bool device) {
  want_device = device;
  lock = SDL_CreateMutex();
  static const struct { const char *name; JSCFunction *fn; int len; } fns[] = {
      {"audioOpen", n_audioOpen, 1},         {"audioFromPcm16", n_audioFromPcm16, 1},
      {"audioDecode", n_audioDecode, 2},     {"audioRelease", n_audioRelease, 1},
      {"audioStart", n_audioStart, 6},       {"audioStop", n_audioStop, 1},
      {"audioBusGain", n_audioBusGain, 2},   {"audioPause", n_audioPause, 1},
      {"audioClock", n_audioClock, 0},       {"audioEnded", n_audioEnded, 0},
      {"audioVoices", n_audioVoices, 0},     {"audioAdvance", n_audioAdvance, 2},
      {"audioStatus", n_audioStatus, 0},
  };
  for (size_t i = 0; i < sizeof fns / sizeof fns[0]; i++)
    JS_SetPropertyStr(ctx, native, fns[i].name, JS_NewCFunction(ctx, fns[i].fn, fns[i].name, fns[i].len));
}

void audio_suspend(bool on) {
  if (!lock) return;
  SDL_LockMutex(lock);
  bool was = suspended;
  suspended = on;
  int64_t clock = clock_frames;
  if (!on) watch_ns = SDL_GetTicksNS(); /* a stall is measured from here, not from before */
  SDL_UnlockMutex(lock);
  if (was == on) return; /* a repeated event changes nothing, and is released once */
  suspends += on;
  /* And stop the devices pulling at all (the mix would be silence): no work in the background. */
  SDL_AudioStream *outs[2] = {stream, mstream};
  for (int i = 0; i < 2; i++) {
    if (!outs[i]) continue;
    if (on) SDL_PauseAudioStreamDevice(outs[i]);
    else SDL_ResumeAudioStreamDevice(outs[i]);
  }
  audio_log("%s, the mixer clock at %.3f s", on ? "suspended for the background" : "resumed in the foreground",
            (double)clock / AUDIO_RATE);
  if (!on) request(REQ_CHECK, "back in the foreground");
}

/* ── Keeping the output alive ────────────────────────────────────────────────────── */

void audio_log(const char *fmt, ...) {
  char line[256];
  va_list ap;
  va_start(ap, fmt);
  SDL_vsnprintf(line, sizeof line, fmt, ap);
  va_end(ap);
#ifdef SDL_PLATFORM_TVOS
  tvos_log_audio(line); /* the unified log, category `audio` (native/README.md) */
#else
  SDL_Log("audio: %s", line);
#endif
}

/* What a notice asks of the main thread: a check (the session reactivated, the watchdog
   decides), or a reopen. Set from any thread; taken by audio_poll. */
static void request(int level, const char *why) {
  SDL_SetAtomicPointer(&request_why, (void *)why);
  for (;;) {
    int cur = SDL_GetAtomicInt(&request_level);
    if (cur >= level || SDL_CompareAndSwapAtomicInt(&request_level, cur, level)) return;
  }
}

void audio_notice(AudioNotice what, const char *detail) {
  static const char *const names[] = {"note", "session lost", "session back", "route change", "media services reset", "device removed"};
  audio_log("%s: %s", names[what], detail);
  switch (what) {
    case AUDIO_LOST: SDL_SetAtomicInt(&session_lost, 1); break;
    case AUDIO_BACK:
    case AUDIO_ROUTE: request(REQ_CHECK, names[what]); break;
    case AUDIO_RESET:
    case AUDIO_REMOVED: request(REQ_REOPEN, names[what]); break;
    case AUDIO_INFO: break;
  }
}

void audio_sdl_event(const SDL_Event *e) {
  if (e->adevice.recording) return;
  char d[96];
  SDL_snprintf(d, sizeof d, "SDL audio device %u", (unsigned)e->adevice.which);
  if (e->type == SDL_EVENT_AUDIO_DEVICE_REMOVED) audio_notice(AUDIO_REMOVED, d);
  else if (e->type == SDL_EVENT_AUDIO_DEVICE_FORMAT_CHANGED) {
    SDL_strlcat(d, " changed format", sizeof d);
    audio_notice(AUDIO_INFO, d);
  }
}

/* Ask the platform for the audio session (tvOS: setActive:YES, which SDL does only once). */
static void activate_session(void) {
#ifdef SDL_PLATFORM_TVOS
  char err[160], route[256];
  bool ok = tvos_audio_activate(err, sizeof err);
  tvos_audio_describe(route, sizeof route);
  if (ok) audio_log("session active: %s", route);
  else audio_log("could not activate the session: %s; %s", err, route);
#endif
}

/* Throw the streams away and open them again: a new SDL device, a new AudioQueue. Both go
   first — they share one physical device, which SDL closes only with its last stream. */
static void reopen(const char *why, Uint64 now) {
  attempts++;
  last_attempt_ns = now;
  audio_log("reopening the output (%s), attempt %d", why, attempts);
  activate_session();
  if (mstream) SDL_DestroyAudioStream(mstream);
  if (stream) SDL_DestroyAudioStream(stream);
  mstream = stream = NULL;
  SDL_LockMutex(lock);
  gen++;
  watch_ns = now;
  bool movie = mv.on;
  const SDL_AudioSpec mspec = {SDL_AUDIO_F32, mv.channels, mv.rate};
  mv.fed_before = mv.pos; /* the movie's clock carries on from where its sound is */
  mv.request_ns = now;
  SDL_UnlockMutex(lock);
  stream = open_stream(&mix_spec, feed);
  opens++;
  if (!stream) {
    audio_log("reopen failed (%s): the mixer keeps time silently until the output is back", SDL_GetError());
    return;
  }
  if (movie && !(mstream = open_stream(&mspec, feed_movie))) audio_log("the movie's stream did not reopen: %s", SDL_GetError());
  log_output("output reopened");
}

/* Mix the wall's time away, silently, while there is no output to ask for it. */
static void drive(Uint64 now) {
  double owed = (double)(now - drive_ns) * AUDIO_RATE / 1e9 + drive_owed;
  int64_t n = (int64_t)owed;
  drive_owed = owed - (double)n;
  drive_ns = now;
  SDL_LockMutex(lock);
  for (int64_t done = 0; done < n;) {
    int k = n - done < CHUNK ? (int)(n - done) : CHUNK;
    mix(drive_buf, k);
    done += k;
  }
  if (mv.on && !paused && !suspended) {
    mv.pos += n * mv.rate / AUDIO_RATE;
    mv.fed_before = mv.pos;
    mv.request_ns = now;
  }
  SDL_UnlockMutex(lock);
}

void audio_poll(void) {
  if (!lock || !mode || SDL_strcmp(mode, "manual") == 0) return;
  Uint64 now = SDL_GetTicksNS();
  SDL_LockMutex(lock);
  bool held = suspended;
  Uint64 fed_at = last_feed_ns, from = SDL_max(last_feed_ns, watch_ns);
  SDL_UnlockMutex(lock);
  if (held) { /* nothing is asked of a backgrounded output; requests wait for the foreground */
    drive_ns = now; /* and the time away is not driven either */
    drive_owed = 0;
    return;
  }
  int req = SDL_SetAtomicInt(&request_level, REQ_NONE);
  if (req != REQ_NONE) {
    const char *why = SDL_GetAtomicPointer(&request_why);
    bool lost = SDL_SetAtomicInt(&session_lost, 0) != 0;
    if (req == REQ_REOPEN || lost || !stream) {
      /* A session the system took away is not trusted to come back by itself (SDL retries
         AudioQueueStart only on three notifications, and never reactivates the session). */
      reopen(lost ? "the session was taken away" : why, now);
      return;
    }
    activate_session(); /* a check: the watchdog below says whether the output is pulling */
  }
  if (now - from < STALL_NS) {
    if (stalled && fed_at > stalled_ns) {
      audio_log("the output is pulling again after %.2f s", (double)(now - stalled_ns) / 1e9);
      stalled = false;
    }
    /* Retries start from the shortest wait again only once a reopened output has kept pulling. */
    if (!stalled && now - last_attempt_ns >= SETTLED_NS) attempts = 0;
    if (stalled) {
      drive(now); /* until the new output has pulled once */
    } else {
      drive_ns = now;
      drive_owed = 0;
    }
    return;
  }
  if (!stalled) {
    stalled = true;
    stalled_ns = now;
    audio_log("the output stopped pulling: nothing asked for sound for %.2f s", (double)(now - from) / 1e9);
  }
  Uint64 wait = attempts == 0 ? 0 : (Uint64)SDL_min(8, 1 << (attempts - 1)) * SDL_NS_PER_SECOND;
  if (now - last_attempt_ns >= wait) reopen("the output stopped pulling", now);
  drive(now);
}

void audio_test_kill(void) {
  if (!lock) return;
  SDL_LockMutex(lock);
  dead_gen = gen;
  SDL_UnlockMutex(lock);
  audio_log("test: the output stops answering (generation %u)", (unsigned)gen);
}

void audio_shutdown(void) {
  audio_movie_stop();
  if (stream) SDL_DestroyAudioStream(stream); /* stops the callback before the state goes */
  stream = NULL;
}
