/*
 * The native host's sound: a small mixer behind an SDL audio stream (audio.c), and the
 * platform's decoder for the AAC the game ships (audio_decode_apple.c on Apple platforms;
 * Media Foundation would take its place on Windows and Xbox). native/js/sdlAudioBackend.ts
 * is the `AudioBackend` that drives them; native/README.md ("Sound") says what each part
 * must match.
 */
#ifndef FF4E_AUDIO_H
#define FF4E_AUDIO_H

#include <SDL3/SDL_events.h>
#include <quickjs.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/** The rate every sound the game ships is at, and the rate the mixer runs at. */
#define AUDIO_RATE 22050

/**
 * Install the `audio*` functions on the `__native` object. `device` false (the headless
 * runs) means the mixer never opens an output and its clock moves only by `audioAdvance`.
 */
void audio_install(JSContext *ctx, JSValue native, bool device);
void audio_shutdown(void);
/**
 * The app went to the background (`on`) or came back. While suspended nothing is mixed and
 * no clock moves — the mixer's nor the movie's — as while paused, but independently of the
 * game's own pause (`audioPause`), which stays whatever the game set; the outputs are paused
 * too. Safe from an SDL event watch (any thread holding no audio lock).
 */
void audio_suspend(bool on);

/*
 * Keeping the output alive (native/README.md, "When the sound does not come back"). The
 * mixer's voices and clock do not live in the SDL stream, so an output that stops asking for
 * sound — an audio session the system took away and SDL did not restore, a device gone —
 * is replaced by reopening the streams, with nothing the game hears lost. Every step goes to
 * the audio log (tvOS: the unified log, category `audio`; elsewhere SDL_Log).
 */
typedef enum {
  AUDIO_INFO,    /* only logged */
  AUDIO_LOST,    /* the session was interrupted or deactivated: reopen when it is back */
  AUDIO_BACK,    /* the interruption ended, resumption recommended: reactivate, check */
  AUDIO_ROUTE,   /* the route changed (HDMI, AirPlay, Bluetooth): reactivate, check */
  AUDIO_RESET,   /* media services were reset: every audio object is gone, reopen */
  AUDIO_REMOVED, /* SDL says a playback device was removed: reopen */
} AudioNotice;
/** Log `detail` and note what it asks for; acted on by audio_poll. Safe from any thread. */
void audio_notice(AudioNotice what, const char *detail);
/** SDL's audio device events (removed, format changed), from the event loop. */
void audio_sdl_event(const SDL_Event *e);
/**
 * Once per main-loop pass in the foreground: act on notices (reactivate the session, or
 * reopen), and the watchdog — an output that has not asked for sound for 750 ms is reopened
 * (then after 1, 2, 4, 8 s while it stays dead), and the clock meanwhile runs in real time
 * without it, as SDL's dummy driver would, so nothing waiting on a sound waits for ever.
 */
void audio_poll(void);
void audio_log(const char *fmt, ...) SDL_PRINTF_VARARG_FUNC(1);
/** Checks only (`audioLifecycle`): the streams open now stop asking for sound, as a dead output does. */
void audio_test_kill(void);

/**
 * Decode an encoded file (AAC in MP4) to mono float PCM at AUDIO_RATE. On success `*out`
 * is SDL_malloc'ed and owned by the caller. On failure returns false with `err` filled.
 */
bool audio_decode(const void *bytes, size_t n, float **out, int64_t *frames, char *err, size_t errlen);

/*
 * The movie's sound (movie.c): one track at a time, beside the mixer rather than in it. It
 * keeps the movie's own channels — the intro is stereo, and mixed down to the mixer's mono it
 * would lose its side signal (measured: more side than mid) — and its own rate, and plays at
 * gain 1 outside the buses and MASTER_GAIN, as a <video> element is outside the page's Web
 * Audio graph. With an output it is a second logical SDL device on the same output (SDL
 * mixes the two); headless, it moves only by audio_movie_advance, as the mixer does.
 */
/** Play `pcm` (interleaved, `channels` × `frames`, at `rate`; taken over) from now. */
bool audio_movie_play(float *pcm, int64_t frames, int channels, int rate, char *err, size_t errlen);
void audio_movie_stop(void);
/**
 * Where the track is, in seconds of its own audio — the A/V clock — or -1 with none playing.
 * With an output: the frames handed to SDL before its latest request, plus the time since that
 * request, held below what has been handed over (an estimate of what is being heard, one
 * device buffer behind what was fed). Headless: exactly the frames advanced.
 */
double audio_movie_position(void);
/** The playing track's rate, and its channels in `*channels`; 0 with none playing. */
int audio_movie_rate(int *channels);
/** Headless only: play `frames` more; with `capture`, return them (SDL_malloc'ed, interleaved). */
bool audio_movie_advance(int64_t frames, float **capture);

#endif
