/*
 * AAC in MP4 -> mono float PCM at AUDIO_RATE, with Apple's decoder (Audio Toolbox's
 * ExtAudioFile). The game ships its music and every speech package this way; see
 * native/README.md ("Sound").
 *
 * The file is read from memory through AudioFile callbacks, so nothing touches the disk.
 * ExtAudioFile drops the encoder's priming and remainder by the file's own packet table,
 * which an MP4 takes from its edit list. Core Audio honours that edit at the movie's
 * millisecond resolution, so the JS side hands this a copy whose durations are restated in
 * the media timescale first (src/platform/nativeAudioTiming.ts, the same fix the iOS
 * app's bridge relies on). What comes out is then the exact audio the encoder was given.
 *
 * The client format is the mixer's (mono float32 at 22050 Hz), so a file at another rate or
 * with two channels would be converted here by Audio Toolbox. None of the shipped files is:
 * they are all mono at 22050 Hz, and pass through unconverted.
 */
#include "audio.h"

#include <AudioToolbox/AudioToolbox.h>
#include <SDL3/SDL.h>

typedef struct {
  const uint8_t *p;
  size_t n;
} Mem;

static OSStatus mem_read(void *user, SInt64 pos, UInt32 want, void *buf, UInt32 *got) {
  const Mem *m = user;
  if (pos < 0 || (size_t)pos > m->n) return kAudioFilePositionError;
  size_t left = m->n - (size_t)pos;
  UInt32 k = want < left ? want : (UInt32)left;
  SDL_memcpy(buf, m->p + pos, k);
  *got = k;
  return noErr;
}

static SInt64 mem_size(void *user) {
  return (SInt64)((const Mem *)user)->n;
}

bool audio_decode(const void *bytes, size_t n, float **out, int64_t *frames, char *err, size_t errlen) {
  Mem mem = {bytes, n};
  AudioFileID file = NULL;
  ExtAudioFileRef ext = NULL;
  float *pcm = NULL;
  OSStatus st = AudioFileOpenWithCallbacks(&mem, mem_read, NULL, mem_size, NULL, kAudioFileM4AType, &file);
  if (st != noErr) {
    SDL_snprintf(err, errlen, "AudioFileOpenWithCallbacks failed (%d)", (int)st);
    return false;
  }
  st = ExtAudioFileWrapAudioFileID(file, false, &ext);
  if (st != noErr) {
    SDL_snprintf(err, errlen, "ExtAudioFileWrapAudioFileID failed (%d)", (int)st);
    AudioFileClose(file);
    return false;
  }
  AudioStreamBasicDescription client = {0};
  client.mSampleRate = AUDIO_RATE;
  client.mFormatID = kAudioFormatLinearPCM;
  client.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
  client.mChannelsPerFrame = 1;
  client.mBitsPerChannel = 32;
  client.mFramesPerPacket = 1;
  client.mBytesPerFrame = 4;
  client.mBytesPerPacket = 4;
  st = ExtAudioFileSetProperty(ext, kExtAudioFileProperty_ClientDataFormat, sizeof client, &client);
  if (st != noErr) {
    SDL_snprintf(err, errlen, "cannot decode to float PCM (%d)", (int)st);
    goto fail;
  }
  /* A capacity hint only (it is in the FILE's rate); the read loop below grows as needed. */
  SInt64 hint = 0;
  UInt32 sz = sizeof hint;
  ExtAudioFileGetProperty(ext, kExtAudioFileProperty_FileLengthFrames, &sz, &hint);
  size_t cap = hint > 0 ? (size_t)hint + 4096 : 1 << 16;
  size_t len = 0;
  pcm = SDL_malloc(cap * sizeof *pcm);
  if (!pcm) {
    SDL_snprintf(err, errlen, "out of memory");
    goto fail;
  }
  for (;;) {
    if (cap - len < 4096) {
      cap *= 2;
      float *grown = SDL_realloc(pcm, cap * sizeof *pcm);
      if (!grown) {
        SDL_snprintf(err, errlen, "out of memory");
        goto fail;
      }
      pcm = grown;
    }
    UInt32 want = (UInt32)(cap - len);
    AudioBufferList list = {.mNumberBuffers = 1};
    list.mBuffers[0].mNumberChannels = 1;
    list.mBuffers[0].mDataByteSize = want * (UInt32)sizeof *pcm;
    list.mBuffers[0].mData = pcm + len;
    st = ExtAudioFileRead(ext, &want, &list);
    if (st != noErr) {
      SDL_snprintf(err, errlen, "ExtAudioFileRead failed (%d)", (int)st);
      goto fail;
    }
    if (want == 0) break;
    len += want;
  }
  ExtAudioFileDispose(ext);
  AudioFileClose(file);
  if (len == 0) {
    SDL_free(pcm);
    SDL_snprintf(err, errlen, "decoded to no audio");
    return false;
  }
  *out = pcm;
  *frames = (int64_t)len;
  return true;
fail:
  SDL_free(pcm);
  ExtAudioFileDispose(ext);
  AudioFileClose(file);
  return false;
}
