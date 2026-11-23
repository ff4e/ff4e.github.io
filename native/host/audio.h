/*
 * The native host's sound: a small mixer behind an SDL audio stream (audio.c), and the
 * platform's decoder for the AAC the game ships (audio_decode_apple.c on Apple platforms;
 * Media Foundation would take its place on Windows and Xbox). native/js/sdlAudioBackend.ts
 * is the `AudioBackend` that drives them; native/README.md ("Sound") says what each part
 * must match.
 */
#ifndef FF4E_AUDIO_H
#define FF4E_AUDIO_H

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
 * Decode an encoded file (AAC in MP4) to mono float PCM at AUDIO_RATE. On success `*out`
 * is SDL_malloc'ed and owned by the caller. On failure returns false with `err` filled.
 */
bool audio_decode(const void *bytes, size_t n, float **out, int64_t *frames, char *err, size_t errlen);

#endif
