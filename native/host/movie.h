/*
 * The platform's movie decoder, behind the smallest interface the player needs: frames in
 * presentation order, and the whole audio track as PCM. movie_apple.m implements it with
 * AVFoundation (AVAssetReader; VideoToolbox decodes the H.264, Audio Toolbox the AAC); Media
 * Foundation would take its place on Windows and Xbox, as it would for audio_decode.
 *
 * Everything else — which frame is shown when, the audio track's clock, the texture upload,
 * the JS bindings — is movie.c's and is not per platform.
 */
#ifndef FF4E_MOVIE_H
#define FF4E_MOVIE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct MovieDecoder MovieDecoder;
typedef struct MovieFrame MovieFrame;

typedef struct {
  int width, height;
  double duration;   /* seconds: the movie's, the longer of its tracks, as a <video> reports it */
  double frame_rate; /* nominal, for messages and tests */
} MovieInfo;

/**
 * Open `path` to read its video from `start` seconds on (0: from the first frame). The first
 * frame read is the one shown at `start`, or one before it. NULL with `err` filled on failure.
 */
MovieDecoder *movie_open(const char *path, double start, MovieInfo *info, char *err, size_t errlen);

/** The next frame in presentation order, with its time in seconds; NULL at the end. */
MovieFrame *movie_next_frame(MovieDecoder *m, double *pts);

/** A frame's pixels: BGRA8, opaque, top row first, `*stride` bytes a row. Valid until released. */
const uint8_t *movie_frame_pixels(MovieFrame *f, size_t *stride);
void movie_frame_release(MovieFrame *f);
void movie_close(MovieDecoder *m);

/**
 * The whole audio track of `path`, decoded: interleaved float32 at the track's own rate and
 * channel count, the encoder's priming and padding dropped as the file's edit says. `*pcm` is
 * SDL_malloc'ed and the caller's. False with `*frames` 0 and no error for a movie with no
 * audio; false with `err` filled when it cannot be decoded.
 */
bool movie_decode_audio(const char *path, float **pcm, int64_t *frames, int *channels, int *rate, char *err, size_t errlen);

#endif
